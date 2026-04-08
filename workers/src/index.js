// Cloudflare Workers entry point — Hono-based router
// Replaces server.js (Express) for Cloudflare deployment

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import {
  createDiagram, getDiagram, updateDiagram, deleteDiagram,
  listDiagrams, getVersions, getVersion, DEFAULT_WORKSPACE, validateWorkspace,
} from './diagrams.js';
import { getTemplates } from './templates.js';
import * as users from './users.js';
import { handleMcpRequest } from './mcp.js';
import { WebSocketDO } from './websocket.js';

export { WebSocketDO };

const app = new Hono();

// --- Auto-migrate: create tables on first request ---
let migrated = false;
async function ensureTables(db) {
  if (migrated) return;
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS diagrams (
      id TEXT PRIMARY KEY, workspace TEXT NOT NULL, name TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'flowchart', code TEXT NOT NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_diagrams_workspace ON diagrams(workspace)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_diagrams_updated ON diagrams(workspace, updated_at)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS diagram_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, diagram_id TEXT NOT NULL,
      workspace TEXT NOT NULL, name TEXT NOT NULL, type TEXT NOT NULL,
      code TEXT NOT NULL, created_at TEXT NOT NULL,
      FOREIGN KEY (diagram_id) REFERENCES diagrams(id) ON DELETE CASCADE)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_versions_diagram ON diagram_versions(diagram_id)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS users (
      username TEXT PRIMARY KEY, password_hash TEXT NOT NULL, salt TEXT NOT NULL,
      token TEXT NOT NULL UNIQUE, workspace TEXT NOT NULL, created_at TEXT NOT NULL)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_users_token ON users(token)`),
  ]);
  migrated = true;
}

app.use('*', async (c, next) => {
  if (c.env.DB) await ensureTables(c.env.DB);
  return next();
});

// --- Config helpers ---

function getTokenFromRequest(c) {
  const authHeader = c.req.header('Authorization');
  if (authHeader && authHeader.startsWith('Bearer ')) return authHeader.slice(7);
  return c.req.query('token') || '';
}

async function isValidToken(db, token) {
  return await users.isUserToken(db, token);
}

async function getWorkspace(db, token) {
  const ws = await users.getWorkspaceForToken(db, token);
  return ws || DEFAULT_WORKSPACE;
}

// --- Broadcast helper ---
async function broadcast(env, event, data, workspace) {
  try {
    const id = env.WEBSOCKET.idFromName('global');
    const stub = env.WEBSOCKET.get(id);
    await stub.fetch(new Request('http://internal/broadcast', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event, data, workspace }),
    }));
  } catch (e) {
    console.error('Broadcast error:', e.message);
  }
}

// --- Auth middleware ---
app.use('/api/*', async (c, next) => {
  const db = c.env.DB;
  const path = new URL(c.req.url).pathname;

  // Export endpoint is public
  if (c.req.method === 'GET' && /^\/api\/diagrams\/[^/]+\/export$/.test(path)) {
    c.set('workspace', c.req.query('workspace') || DEFAULT_WORKSPACE);
    return next();
  }

  // Templates don't need auth
  if (c.req.method === 'GET' && path === '/api/templates') return next();

  // Auth routes (register/login) don't need token
  if (path.startsWith('/api/auth/') && path !== '/api/auth/me' && path !== '/api/auth/change-password' && path !== '/api/auth/regenerate-token') {
    return next();
  }

  const token = getTokenFromRequest(c);
  if (!token || !(await isValidToken(db, token))) {
    return c.json({ error: 'Unauthorized', message: 'Please register or login first.' }, 401);
  }

  c.set('workspace', await getWorkspace(db, token));
  return next();
});

// --- MCP auth middleware ---
app.use('/mcp', async (c, next) => {
  if (new URL(c.req.url).pathname === '/health') return next();

  const db = c.env.DB;
  const token = getTokenFromRequest(c);

  if (!token || !(await isValidToken(db, token))) {
    return c.json({ error: 'Unauthorized. Register a user and use the token.' }, 401);
  }

  c.set('workspace', await getWorkspace(db, token));
  return next();
});

// --- HTML with auth script injection ---
function getInjectedHtml(c, html) {
  const siteKey = c.env.TURNSTILE_SITE_KEY || '';
  const script = `<script>window.__TURNSTILE_SITE_KEY__ = '${siteKey}';</script>`;
  return html.replace('<head>', '<head>' + script);
}

// --- Serve index.html with injected script ---
app.get('/', async (c) => {
  const asset = await c.env.ASSETS.fetch(new Request(new URL('/index.html', c.req.url)));
  if (!asset.ok) return asset;
  const html = await asset.text();
  return c.html(getInjectedHtml(c, html), {
    headers: { 'Cache-Control': 'no-cache, no-store, must-revalidate' },
  });
});

app.get('/index.html', async (c) => {
  const asset = await c.env.ASSETS.fetch(new Request(new URL('/index.html', c.req.url)));
  if (!asset.ok) return asset;
  const html = await asset.text();
  return c.html(getInjectedHtml(c, html), {
    headers: { 'Cache-Control': 'no-cache, no-store, must-revalidate' },
  });
});

// --- WebSocket upgrade ---
app.get('/ws', async (c) => {
  const upgradeHeader = c.req.header('Upgrade');
  if (upgradeHeader !== 'websocket') {
    return c.text('Expected WebSocket', 426);
  }

  // Auth check
  const db = c.env.DB;
  const token = c.req.query('token') || '';

  if (!token || !(await isValidToken(db, token))) {
    return c.text('Unauthorized', 401);
  }

  const workspace = await getWorkspace(db, token);
  const id = c.env.WEBSOCKET.idFromName('global');
  const stub = c.env.WEBSOCKET.get(id);

  const url = new URL(c.req.url);
  url.pathname = '/ws';
  url.searchParams.set('workspace', workspace);

  return stub.fetch(new Request(url.toString(), {
    headers: c.req.raw.headers,
  }));
});

// --- Auth routes ---
app.post('/api/auth/register', async (c) => {
  try {
    const { username, password, turnstileToken } = await c.req.json();

    // Validate Turnstile token
    const secretKey = c.env.TURNSTILE_SECRET_KEY;
    if (secretKey) {
      if (!turnstileToken) {
        return c.json({ error: 'Please complete the verification.' }, 400);
      }
      const verifyRes = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `secret=${encodeURIComponent(secretKey)}&response=${encodeURIComponent(turnstileToken)}`,
      });
      const verifyData = await verifyRes.json();
      if (!verifyData.success) {
        return c.json({ error: 'Verification failed. Please try again.' }, 400);
      }
    }

    const result = await users.register(c.env.DB, username, password);
    if (result.error) return c.json({ error: result.error }, 400);
    return c.json(result);
  } catch (e) {
    return c.json({ error: e.message }, 500);
  }
});

app.post('/api/auth/login', async (c) => {
  try {
    const { username, password } = await c.req.json();
    const result = await users.login(c.env.DB, username, password);
    if (result.error) return c.json({ error: result.error }, 401);
    return c.json(result);
  } catch (e) {
    return c.json({ error: e.message }, 500);
  }
});

app.post('/api/auth/change-password', async (c) => {
  try {
    const token = getTokenFromRequest(c);
    if (!token) return c.json({ error: 'Not authenticated' }, 401);
    const { oldPassword, newPassword } = await c.req.json();
    if (!oldPassword || !newPassword) {
      return c.json({ error: 'Old password and new password are required' }, 400);
    }
    const result = await users.changePassword(c.env.DB, token, oldPassword, newPassword);
    if (result.error) return c.json({ error: result.error }, 400);
    return c.json(result);
  } catch (e) {
    return c.json({ error: e.message }, 500);
  }
});

app.get('/api/auth/me', async (c) => {
  const token = getTokenFromRequest(c);
  const user = await users.getUserByToken(c.env.DB, token);
  if (user) {
    return c.json({ username: user.username, workspace: user.workspace, token: user.token });
  }
  return c.json({ error: 'Not authenticated' }, 401);
});

app.post('/api/auth/regenerate-token', async (c) => {
  try {
    const token = getTokenFromRequest(c);
    if (!token) return c.json({ error: 'Not authenticated' }, 401);
    const result = await users.regenerateToken(c.env.DB, token);
    if (result.error) return c.json({ error: result.error }, 400);
    return c.json(result);
  } catch (e) {
    return c.json({ error: e.message }, 500);
  }
});

// --- Diagram CRUD ---
const VALID_TYPES = ['flowchart', 'swimlane', 'stateDiagram', 'sequence', 'classDiagram', 'gantt', 'erDiagram', 'pie', 'mindmap'];
const MAX_NAME_LENGTH = 200;
const MAX_CODE_LENGTH = 100000;

app.get('/api/workspace', (c) => {
  return c.json({ workspace: c.get('workspace') });
});

app.post('/api/diagrams', async (c) => {
  try {
    const { name, code, type } = await c.req.json();
    if (!name || !code) return c.json({ error: 'name and code are required' }, 400);
    if (typeof name !== 'string' || name.length > MAX_NAME_LENGTH) {
      return c.json({ error: `name must be a string under ${MAX_NAME_LENGTH} chars` }, 400);
    }
    if (typeof code !== 'string' || code.length > MAX_CODE_LENGTH) {
      return c.json({ error: `code must be a string under ${MAX_CODE_LENGTH} chars` }, 400);
    }
    const safeType = VALID_TYPES.includes(type) ? type : 'flowchart';
    const workspace = c.get('workspace');
    const baseUrl = c.env.BASE_URL || new URL(c.req.url).origin;
    const diagram = await createDiagram(c.env.DB, workspace, { name, type: safeType, code });
    const result = { ...diagram, url: `${baseUrl}/#/diagram/${diagram.id}` };
    await broadcast(c.env, 'diagram:created', result, workspace);
    return c.json(result);
  } catch (e) {
    return c.json({ error: e.message }, 500);
  }
});

app.get('/api/diagrams', async (c) => {
  try {
    const list = await listDiagrams(c.env.DB, c.get('workspace'));
    return c.json(list);
  } catch (e) {
    return c.json({ error: e.message }, 500);
  }
});

// Batch export (must be before :id route)
app.get('/api/diagrams/batch/export', async (c) => {
  try {
    const workspace = c.get('workspace');
    const list = await listDiagrams(c.env.DB, workspace);
    const results = [];
    for (const item of list) {
      const diagram = await getDiagram(c.env.DB, workspace, item.id);
      if (diagram) results.push({ id: diagram.id, name: diagram.name, code: diagram.code, type: diagram.type });
    }
    return c.json(results);
  } catch (e) {
    return c.json({ error: e.message }, 500);
  }
});

app.get('/api/diagrams/:id', async (c) => {
  try {
    const workspace = c.get('workspace');
    const baseUrl = c.env.BASE_URL || new URL(c.req.url).origin;
    const diagram = await getDiagram(c.env.DB, workspace, c.req.param('id'));
    if (!diagram) return c.json({ error: 'Diagram not found' }, 404);
    return c.json({ ...diagram, url: `${baseUrl}/#/diagram/${diagram.id}` });
  } catch (e) {
    return c.json({ error: e.message }, 500);
  }
});

app.put('/api/diagrams/:id', async (c) => {
  try {
    const workspace = c.get('workspace');
    const baseUrl = c.env.BASE_URL || new URL(c.req.url).origin;
    const body = await c.req.json();
    const diagram = await updateDiagram(c.env.DB, workspace, c.req.param('id'), body);
    if (!diagram) return c.json({ error: 'Diagram not found' }, 404);
    const result = { ...diagram, url: `${baseUrl}/#/diagram/${diagram.id}` };
    await broadcast(c.env, 'diagram:updated', result, workspace);
    return c.json(result);
  } catch (e) {
    return c.json({ error: e.message }, 500);
  }
});

app.delete('/api/diagrams/:id', async (c) => {
  try {
    const workspace = c.get('workspace');
    const id = c.req.param('id');
    const ok = await deleteDiagram(c.env.DB, workspace, id);
    if (!ok) return c.json({ error: 'Diagram not found' }, 404);
    await broadcast(c.env, 'diagram:deleted', { id }, workspace);
    return c.json({ success: true });
  } catch (e) {
    return c.json({ error: e.message }, 500);
  }
});

// --- Version history ---
app.get('/api/diagrams/:id/versions', async (c) => {
  try {
    const workspace = c.get('workspace');
    const id = c.req.param('id');
    const diagram = await getDiagram(c.env.DB, workspace, id);
    if (!diagram) return c.json({ error: 'Diagram not found' }, 404);
    const versions = await getVersions(c.env.DB, workspace, id);
    return c.json(versions);
  } catch (e) {
    return c.json({ error: e.message }, 500);
  }
});

app.get('/api/diagrams/:id/versions/:versionId', async (c) => {
  try {
    const workspace = c.get('workspace');
    const version = await getVersion(c.env.DB, workspace, c.req.param('id'), c.req.param('versionId'));
    if (!version) return c.json({ error: 'Version not found' }, 404);
    return c.json(version);
  } catch (e) {
    return c.json({ error: e.message }, 500);
  }
});

app.post('/api/diagrams/:id/restore/:versionId', async (c) => {
  try {
    const workspace = c.get('workspace');
    const baseUrl = c.env.BASE_URL || new URL(c.req.url).origin;
    const id = c.req.param('id');
    const version = await getVersion(c.env.DB, workspace, id, c.req.param('versionId'));
    if (!version) return c.json({ error: 'Version not found' }, 404);
    const diagram = await updateDiagram(c.env.DB, workspace, id, { code: version.code, name: version.name });
    if (!diagram) return c.json({ error: 'Diagram not found' }, 404);
    const result = { ...diagram, url: `${baseUrl}/#/diagram/${diagram.id}` };
    await broadcast(c.env, 'diagram:updated', result, workspace);
    return c.json(result);
  } catch (e) {
    return c.json({ error: e.message }, 500);
  }
});

// --- Export (public) ---
app.get('/api/diagrams/:id/export', async (c) => {
  try {
    const workspace = c.get('workspace');
    const diagram = await getDiagram(c.env.DB, workspace, c.req.param('id'));
    if (!diagram) return c.json({ error: 'Diagram not found' }, 404);
    const format = c.req.query('format') || 'svg';
    return c.json({ id: diagram.id, code: diagram.code, format, name: diagram.name });
  } catch (e) {
    return c.json({ error: e.message }, 500);
  }
});

// --- Templates ---
app.get('/api/templates', (c) => {
  return c.json(getTemplates());
});

// --- MCP endpoint ---
app.all('/mcp', async (c) => {
  const workspace = c.get('workspace');
  const baseUrl = c.env.BASE_URL || new URL(c.req.url).origin;
  const broadcastFn = (event, data, ws) => broadcast(c.env, event, data, ws);
  return handleMcpRequest(c.req.raw, c.env.DB, workspace, baseUrl, broadcastFn);
});

app.get('/health', (c) => {
  return c.json({ status: 'ok', runtime: 'cloudflare-workers' });
});

// --- SPA fallback: serve index.html for non-API routes ---
app.get('*', async (c) => {
  // Try serving as static asset first
  const url = new URL(c.req.url);
  if (url.pathname !== '/' && !url.pathname.startsWith('/api/') && !url.pathname.startsWith('/mcp')) {
    const asset = await c.env.ASSETS.fetch(c.req.raw);
    if (asset.ok) return asset;
  }
  // Fallback to index.html with injected auth script
  const asset = await c.env.ASSETS.fetch(new Request(new URL('/index.html', c.req.url)));
  if (!asset.ok) return asset;
  const html = await asset.text();
  return c.html(getInjectedHtml(c, html), {
    headers: { 'Cache-Control': 'no-cache, no-store, must-revalidate' },
  });
});

export default app;
