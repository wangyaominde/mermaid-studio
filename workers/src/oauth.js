// OAuth 2.0 for MCP (Streamable HTTP)
// Implements: RFC 8414 metadata, RFC 7591 dynamic registration,
// Authorization Code + PKCE (S256)

import * as users from './users.js';

// --- Helpers ---

function generateId() {
  const arr = new Uint8Array(32);
  crypto.getRandomValues(arr);
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function computeS256(codeVerifier) {
  const encoder = new TextEncoder();
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(codeVerifier));
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// --- OAuth Metadata (RFC 8414) ---

export function getMetadata(baseUrl) {
  return {
    issuer: baseUrl,
    authorization_endpoint: `${baseUrl}/oauth/authorize`,
    token_endpoint: `${baseUrl}/oauth/token`,
    registration_endpoint: `${baseUrl}/oauth/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    scopes_supported: ['mcp'],
  };
}

// --- Dynamic Client Registration (RFC 7591) ---

export async function handleRegister(db, body) {
  const redirectUris = body.redirect_uris;
  if (!redirectUris || !Array.isArray(redirectUris) || redirectUris.length === 0) {
    return { error: 'invalid_client_metadata', error_description: 'redirect_uris is required' };
  }

  const clientId = generateId();
  const clientSecret = generateId();
  const clientName = body.client_name || 'MCP Client';
  const now = new Date().toISOString();

  await db.prepare(
    'INSERT INTO oauth_clients (client_id, client_secret, redirect_uris, client_name, created_at) VALUES (?, ?, ?, ?, ?)'
  ).bind(clientId, clientSecret, JSON.stringify(redirectUris), clientName, now).run();

  return {
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uris: redirectUris,
    client_name: clientName,
    grant_types: ['authorization_code'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
  };
}

// --- Authorization Endpoint ---

function renderLoginPage(params, error) {
  const { client_id, redirect_uri, state, code_challenge, code_challenge_method, scope } = params;
  const errorHtml = error ? `<div class="error">${error}</div>` : '';

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Mermaid Studio - 授权登录</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0f172a; color: #e2e8f0; min-height: 100vh; display: flex; align-items: center; justify-content: center; }
  .card { background: #1e293b; border-radius: 16px; padding: 40px; width: 100%; max-width: 400px; box-shadow: 0 25px 50px rgba(0,0,0,0.4); }
  .logo { text-align: center; margin-bottom: 24px; font-size: 24px; font-weight: 700; }
  .logo span { color: #60a5fa; }
  .subtitle { text-align: center; color: #94a3b8; margin-bottom: 32px; font-size: 14px; }
  label { display: block; font-size: 14px; font-weight: 500; margin-bottom: 6px; color: #cbd5e1; }
  input[type="text"], input[type="password"] { width: 100%; padding: 10px 14px; background: #0f172a; border: 1px solid #334155; border-radius: 8px; color: #e2e8f0; font-size: 15px; margin-bottom: 16px; outline: none; transition: border-color 0.2s; }
  input:focus { border-color: #60a5fa; }
  button { width: 100%; padding: 12px; background: #3b82f6; color: #fff; border: none; border-radius: 8px; font-size: 15px; font-weight: 600; cursor: pointer; transition: background 0.2s; }
  button:hover { background: #2563eb; }
  .error { background: #7f1d1d; color: #fca5a5; padding: 10px 14px; border-radius: 8px; margin-bottom: 16px; font-size: 14px; }
  .hint { text-align: center; color: #64748b; font-size: 12px; margin-top: 16px; }
</style>
</head>
<body>
<div class="card">
  <div class="logo"><span>Mermaid</span> Studio</div>
  <div class="subtitle">授权 MCP 客户端访问你的工作区</div>
  ${errorHtml}
  <form method="POST">
    <input type="hidden" name="client_id" value="${escAttr(client_id || '')}">
    <input type="hidden" name="redirect_uri" value="${escAttr(redirect_uri || '')}">
    <input type="hidden" name="state" value="${escAttr(state || '')}">
    <input type="hidden" name="code_challenge" value="${escAttr(code_challenge || '')}">
    <input type="hidden" name="code_challenge_method" value="${escAttr(code_challenge_method || '')}">
    <input type="hidden" name="scope" value="${escAttr(scope || '')}">
    <label for="username">用户名</label>
    <input type="text" id="username" name="username" required autocomplete="username">
    <label for="password">密码</label>
    <input type="password" id="password" name="password" required autocomplete="current-password">
    <button type="submit">授权登录</button>
  </form>
  <div class="hint">登录后将授权 MCP 客户端访问你的 Mermaid Studio 工作区</div>
</div>
</body>
</html>`;
}

function escAttr(s) {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export async function handleAuthorizeGet(c) {
  const q = c.req.query();
  const db = c.env.DB;

  // Validate client_id
  if (q.client_id) {
    const client = await db.prepare('SELECT client_id FROM oauth_clients WHERE client_id = ?').bind(q.client_id).first();
    if (!client) {
      return c.html(renderLoginPage(q, '无效的 client_id'), 400);
    }
  }

  return c.html(renderLoginPage(q, null));
}

export async function handleAuthorizePost(c) {
  const db = c.env.DB;
  const body = await c.req.parseBody();

  const { client_id, redirect_uri, state, code_challenge, code_challenge_method, username, password } = body;

  // Validate client
  if (!client_id) {
    return c.html(renderLoginPage(body, '缺少 client_id'), 400);
  }
  const client = await db.prepare('SELECT redirect_uris FROM oauth_clients WHERE client_id = ?').bind(client_id).first();
  if (!client) {
    return c.html(renderLoginPage(body, '无效的 client_id'), 400);
  }

  // Validate redirect_uri
  const registeredUris = JSON.parse(client.redirect_uris);
  if (!redirect_uri || !registeredUris.includes(redirect_uri)) {
    return c.html(renderLoginPage(body, '无效的 redirect_uri'), 400);
  }

  // Validate PKCE
  if (!code_challenge || code_challenge_method !== 'S256') {
    return c.html(renderLoginPage(body, '需要 PKCE (S256)'), 400);
  }

  // Login
  const result = await users.login(db, username, password);
  if (result.error) {
    return c.html(renderLoginPage(body, result.error), 200);
  }

  // Generate auth code
  const code = generateId();
  const expiresAt = Date.now() + 10 * 60 * 1000; // 10 minutes

  await db.prepare(
    'INSERT INTO oauth_codes (code, client_id, redirect_uri, code_challenge, user_token, workspace, expires_at, used) VALUES (?, ?, ?, ?, ?, ?, ?, 0)'
  ).bind(code, client_id, redirect_uri, code_challenge, result.token, result.workspace, expiresAt).run();

  // Redirect back with code
  const url = new URL(redirect_uri);
  url.searchParams.set('code', code);
  if (state) url.searchParams.set('state', state);

  return c.redirect(url.toString(), 302);
}

// --- Token Endpoint ---

export async function handleToken(db, body) {
  const { grant_type, code, client_id, redirect_uri, code_verifier } = body;

  if (grant_type !== 'authorization_code') {
    return { status: 400, body: { error: 'unsupported_grant_type' } };
  }

  if (!code || !client_id || !code_verifier) {
    return { status: 400, body: { error: 'invalid_request', error_description: 'Missing required parameters' } };
  }

  // Look up code
  const record = await db.prepare(
    'SELECT * FROM oauth_codes WHERE code = ? AND client_id = ? AND used = 0'
  ).bind(code, client_id).first();

  if (!record) {
    return { status: 400, body: { error: 'invalid_grant', error_description: 'Invalid or expired code' } };
  }

  // Check expiration
  if (Date.now() > record.expires_at) {
    await db.prepare('DELETE FROM oauth_codes WHERE code = ?').bind(code).run();
    return { status: 400, body: { error: 'invalid_grant', error_description: 'Code expired' } };
  }

  // Check redirect_uri
  if (redirect_uri && redirect_uri !== record.redirect_uri) {
    return { status: 400, body: { error: 'invalid_grant', error_description: 'redirect_uri mismatch' } };
  }

  // Verify PKCE
  const computed = await computeS256(code_verifier);
  if (computed !== record.code_challenge) {
    return { status: 400, body: { error: 'invalid_grant', error_description: 'PKCE verification failed' } };
  }

  // Mark code as used
  await db.prepare('UPDATE oauth_codes SET used = 1 WHERE code = ?').bind(code).run();

  // Clean up expired codes
  await db.prepare('DELETE FROM oauth_codes WHERE expires_at < ?').bind(Date.now()).run();

  return {
    status: 200,
    body: {
      access_token: record.user_token,
      token_type: 'bearer',
      scope: 'mcp',
    },
  };
}
