// D1-based diagram CRUD operations (replaces lib/diagrams.js filesystem version)

const DEFAULT_WORKSPACE = 'default';
const MAX_VERSIONS = 50;

function validateWorkspace(ws) {
  if (!ws || typeof ws !== 'string') return DEFAULT_WORKSPACE;
  if (!/^[a-zA-Z0-9_-]+$/.test(ws)) return DEFAULT_WORKSPACE;
  return ws;
}

function generateId() {
  const chars = '0123456789abcdef';
  let id = '';
  const arr = new Uint8Array(4);
  crypto.getRandomValues(arr);
  for (const b of arr) {
    id += chars[b >> 4] + chars[b & 0xf];
  }
  return id;
}

export async function createDiagram(db, workspace, { name, type, code }) {
  const ws = validateWorkspace(workspace);
  const id = generateId();
  const now = new Date().toISOString();

  await db.batch([
    db.prepare(
      'INSERT INTO diagrams (id, workspace, name, type, code, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).bind(id, ws, name, type || 'flowchart', code, now, now),
    db.prepare(
      'INSERT INTO diagram_versions (diagram_id, workspace, name, type, code, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind(id, ws, name, type || 'flowchart', code, now),
  ]);

  return { id, name, type: type || 'flowchart', code, createdAt: now, updatedAt: now };
}

export async function getDiagram(db, workspace, id) {
  const ws = validateWorkspace(workspace);
  const row = await db.prepare(
    'SELECT id, name, type, code, created_at as createdAt, updated_at as updatedAt FROM diagrams WHERE id = ? AND workspace = ?'
  ).bind(id, ws).first();
  return row || null;
}

export async function updateDiagram(db, workspace, id, { code, name, type }) {
  const ws = validateWorkspace(workspace);
  const existing = await getDiagram(db, ws, id);
  if (!existing) return null;

  const updatedName = name !== undefined ? name : existing.name;
  const updatedType = type !== undefined ? type : existing.type;
  const updatedCode = code !== undefined ? code : existing.code;
  const now = new Date().toISOString();

  await db.batch([
    db.prepare(
      'UPDATE diagrams SET name = ?, type = ?, code = ?, updated_at = ? WHERE id = ? AND workspace = ?'
    ).bind(updatedName, updatedType, updatedCode, now, id, ws),
    db.prepare(
      'INSERT INTO diagram_versions (diagram_id, workspace, name, type, code, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind(id, ws, updatedName, updatedType, updatedCode, now),
  ]);

  // Trim old versions (keep latest MAX_VERSIONS)
  await db.prepare(`
    DELETE FROM diagram_versions WHERE diagram_id = ? AND id NOT IN (
      SELECT id FROM diagram_versions WHERE diagram_id = ? ORDER BY created_at DESC LIMIT ?
    )
  `).bind(id, id, MAX_VERSIONS).run();

  return { id, name: updatedName, type: updatedType, code: updatedCode, createdAt: existing.createdAt, updatedAt: now };
}

export async function deleteDiagram(db, workspace, id) {
  const ws = validateWorkspace(workspace);
  // Check existence first — don't rely on meta.changes
  const existing = await getDiagram(db, ws, id);
  if (!existing) return false;

  await db.batch([
    db.prepare('DELETE FROM diagram_versions WHERE diagram_id = ? AND workspace = ?').bind(id, ws),
    db.prepare('DELETE FROM diagrams WHERE id = ? AND workspace = ?').bind(id, ws),
  ]);
  return true;
}

export async function listDiagrams(db, workspace) {
  const ws = validateWorkspace(workspace);
  const { results } = await db.prepare(
    'SELECT id, name, type, created_at as createdAt, updated_at as updatedAt FROM diagrams WHERE workspace = ? ORDER BY updated_at DESC'
  ).bind(ws).all();
  return results || [];
}

export async function getVersions(db, workspace, id) {
  const ws = validateWorkspace(workspace);
  const { results } = await db.prepare(
    'SELECT id, created_at as timestamp FROM diagram_versions WHERE diagram_id = ? AND workspace = ? ORDER BY created_at DESC'
  ).bind(id, ws).all();
  return (results || []).map(r => ({ file: r.id.toString(), timestamp: r.timestamp }));
}

export async function getVersion(db, workspace, id, versionId) {
  const ws = validateWorkspace(workspace);
  const row = await db.prepare(
    'SELECT name, type, code, created_at as createdAt FROM diagram_versions WHERE id = ? AND diagram_id = ? AND workspace = ?'
  ).bind(parseInt(versionId), id, ws).first();
  return row || null;
}

export { DEFAULT_WORKSPACE, validateWorkspace };
