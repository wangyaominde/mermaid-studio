// D1-based user management (replaces lib/users.js filesystem version)

const USERNAME_RE = /^[a-zA-Z0-9_-]{3,32}$/;
const PASSWORD_MIN_LENGTH = 6;

async function hashPassword(password, salt) {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: encoder.encode(salt), iterations: 100000, hash: 'SHA-512' },
    keyMaterial, 512
  );
  return Array.from(new Uint8Array(bits)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function generateSalt() {
  const arr = new Uint8Array(32);
  crypto.getRandomValues(arr);
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
}

function generateToken() {
  const arr = new Uint8Array(32);
  crypto.getRandomValues(arr);
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
}

function validateUsername(username) {
  if (!username || typeof username !== 'string') return 'Username is required';
  if (!USERNAME_RE.test(username)) return 'Username must be 3-32 characters, only letters, numbers, _ and -';
  return null;
}

function validatePassword(password) {
  if (!password || typeof password !== 'string') return 'Password is required';
  if (password.length < PASSWORD_MIN_LENGTH) return `Password must be at least ${PASSWORD_MIN_LENGTH} characters`;
  return null;
}

export async function register(db, username, password) {
  const usernameErr = validateUsername(username);
  if (usernameErr) return { error: usernameErr };

  const passwordErr = validatePassword(password);
  if (passwordErr) return { error: passwordErr };

  // Check duplicate (case-insensitive)
  const existing = await db.prepare(
    'SELECT username FROM users WHERE LOWER(username) = LOWER(?)'
  ).bind(username).first();
  if (existing) return { error: 'Username already exists' };

  const salt = generateSalt();
  const passwordHash = await hashPassword(password, salt);
  const token = generateToken();
  const workspace = `user-${username}`;
  const now = new Date().toISOString();

  await db.prepare(
    'INSERT INTO users (username, password_hash, salt, token, workspace, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(username, passwordHash, salt, token, workspace, now).run();

  return { username, token, workspace };
}

export async function login(db, username, password) {
  if (!username || !password) return { error: 'Username and password are required' };

  const user = await db.prepare(
    'SELECT username, password_hash, salt, token, workspace FROM users WHERE LOWER(username) = LOWER(?)'
  ).bind(username).first();
  if (!user) return { error: 'Invalid username or password' };

  const hash = await hashPassword(password, user.salt);
  if (hash !== user.password_hash) return { error: 'Invalid username or password' };

  return { username: user.username, token: user.token, workspace: user.workspace };
}

export async function changePassword(db, token, oldPassword, newPassword) {
  const user = await getUserByToken(db, token);
  if (!user) return { error: 'Not authenticated' };

  const oldHash = await hashPassword(oldPassword, user.salt);
  if (oldHash !== user.password_hash) return { error: 'Current password is incorrect' };

  const passwordErr = validatePassword(newPassword);
  if (passwordErr) return { error: passwordErr };

  const newSalt = generateSalt();
  const newHash = await hashPassword(newPassword, newSalt);
  const newToken = generateToken();

  await db.prepare(
    'UPDATE users SET salt = ?, password_hash = ?, token = ? WHERE username = ?'
  ).bind(newSalt, newHash, newToken, user.username).run();

  return { username: user.username, token: newToken, workspace: user.workspace };
}

export async function getUserByToken(db, token) {
  if (!token) return null;
  return await db.prepare(
    'SELECT username, password_hash, salt, token, workspace FROM users WHERE token = ?'
  ).bind(token).first();
}

export async function isUserToken(db, token) {
  const user = await getUserByToken(db, token);
  return !!user;
}

export async function regenerateToken(db, token) {
  const user = await getUserByToken(db, token);
  if (!user) return { error: 'Not authenticated' };

  const newToken = generateToken();
  await db.prepare(
    'UPDATE users SET token = ? WHERE username = ?'
  ).bind(newToken, user.username).run();

  return { username: user.username, token: newToken, workspace: user.workspace };
}

export async function getWorkspaceForToken(db, token) {
  const user = await getUserByToken(db, token);
  return user ? user.workspace : null;
}
