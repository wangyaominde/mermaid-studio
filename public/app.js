// --- Mermaid Studio App ---
// --- State ---
let currentDiagramId = null;
let diagrams = [];
let templates = {};
let renderTimeout = null;
let selectedType = 'flowchart';
let liveMode = true;
let renderCounter = 0;
let latestRenderId = 0; // For render race condition prevention

// --- Undo/Redo (#4) ---
let undoStack = [];
let redoStack = [];
const MAX_UNDO = 100;
let skipUndoCapture = false;

function captureUndo() {
  if (skipUndoCapture) return;
  const code = cmEditor ? cmEditor.getValue() : document.getElementById('code-editor').value;
  if (undoStack.length > 0 && undoStack[undoStack.length - 1] === code) return;
  undoStack.push(code);
  if (undoStack.length > MAX_UNDO) undoStack.shift();
  redoStack = [];
}

function undo() {
  if (undoStack.length < 2) return;
  const current = undoStack.pop();
  redoStack.push(current);
  const prev = undoStack[undoStack.length - 1];
  skipUndoCapture = true;
  if (cmEditor) cmEditor.setValue(prev);
  else document.getElementById('code-editor').value = prev;
  skipUndoCapture = false;
  renderPreview();
  saveDraft();
}

function redo() {
  if (redoStack.length === 0) return;
  const next = redoStack.pop();
  undoStack.push(next);
  skipUndoCapture = true;
  if (cmEditor) cmEditor.setValue(next);
  else document.getElementById('code-editor').value = next;
  skipUndoCapture = false;
  renderPreview();
  saveDraft();
}

// --- Auth ---
let apiToken = localStorage.getItem('ms_api_token') || '';
let currentUsername = localStorage.getItem('ms_username') || '';

function getToken() {
  return apiToken;
}

function setToken(token) {
  apiToken = token;
  if (token) {
    localStorage.setItem('ms_api_token', token);
  } else {
    localStorage.removeItem('ms_api_token');
  }
}

function setUsername(username) {
  currentUsername = username || '';
  if (username) {
    localStorage.setItem('ms_username', username);
  } else {
    localStorage.removeItem('ms_username');
  }
}

async function checkAuthSetup() {
  if (!apiToken) {
    showAuthModal();
    return;
  }

  // Validate existing token with server
  try {
    const res = await fetch('/api/auth/me', {
      headers: { 'Authorization': `Bearer ${apiToken}` },
    });
    if (res.ok) {
      const data = await res.json();
      setUsername(data.username || '');
      // Connect socket with validated user token
      socket.auth = { token: apiToken };
  
      socket.connect();
      updateUserMenu();
    } else {
      // Token invalid — clear and show login
      setToken('');
      setUsername('');
      showAuthModal();
    }
  } catch {
    // Network error — allow offline use with existing token
    socket.auth = { token: apiToken };

    socket.connect();
    updateUserMenu();
  }
}

function showAuthModal() {
  let modal = document.getElementById('auth-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'auth-modal';
    modal.className = 'modal-overlay';
    modal.style.display = 'flex';
    modal.style.zIndex = '9999';
    modal.innerHTML = `
      <div class="modal auth-modal-content">
        <div class="auth-tabs">
          <button class="auth-tab active" data-tab="login" onclick="switchAuthTab('login')">Login</button>
          <button class="auth-tab" data-tab="register" onclick="switchAuthTab('register')">Register</button>
        </div>

        <div id="auth-login-form" class="auth-form">
          <div class="auth-field">
            <label>Username</label>
            <input id="login-username" type="text" placeholder="Enter username" autocomplete="username" />
          </div>
          <div class="auth-field">
            <label>Password</label>
            <input id="login-password" type="password" placeholder="Enter password" autocomplete="current-password" />
          </div>
          <div id="login-error" class="auth-error"></div>
          <button class="btn btn-primary auth-submit" onclick="handleLogin()">Login</button>
        </div>

        <div id="auth-register-form" class="auth-form" style="display:none">
          <div class="auth-field">
            <label>Username</label>
            <input id="register-username" type="text" placeholder="3-32 chars, letters/numbers/_/-" autocomplete="username" />
          </div>
          <div class="auth-field">
            <label>Password</label>
            <input id="register-password" type="password" placeholder="At least 6 characters" autocomplete="new-password" />
            <div class="password-strength" id="password-strength" style="display:none">
              <div class="strength-bar"><div class="strength-fill" id="strength-fill"></div></div>
              <span class="strength-text" id="strength-text"></span>
            </div>
          </div>
          <div class="auth-field">
            <label>Confirm Password</label>
            <input id="register-password2" type="password" placeholder="Confirm password" autocomplete="new-password" />
          </div>
          <div id="turnstile-container" class="auth-field"></div>
          <div id="register-error" class="auth-error"></div>
          <button class="btn btn-primary auth-submit" onclick="handleRegister()">Register</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    // Enter key handlers
    modal.querySelector('#login-password').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') handleLogin();
    });
    modal.querySelector('#login-username').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') modal.querySelector('#login-password').focus();
    });
    modal.querySelector('#register-password2').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') handleRegister();
    });
    // Password strength indicator
    modal.querySelector('#register-password').addEventListener('input', (e) => {
      updatePasswordStrength(e.target.value);
    });
  }
  modal.style.display = 'flex';
  setTimeout(() => {
    const el = modal.querySelector('#login-username');
    if (el) el.focus();
  }, 100);
}

let turnstileWidgetId = null;
let turnstileScriptLoaded = false;

function loadTurnstileScript() {
  if (turnstileScriptLoaded || !window.__TURNSTILE_SITE_KEY__) return;
  turnstileScriptLoaded = true;
  const s = document.createElement('script');
  s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
  s.async = true;
  document.head.appendChild(s);
}

function switchAuthTab(tab) {
  document.querySelectorAll('.auth-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.tab === tab);
  });
  document.getElementById('auth-login-form').style.display = tab === 'login' ? 'block' : 'none';
  document.getElementById('auth-register-form').style.display = tab === 'register' ? 'block' : 'none';
  document.getElementById('login-error').textContent = '';
  document.getElementById('register-error').textContent = '';

  // Load and render Turnstile widget on register tab (only if site key is configured)
  if (tab === 'register' && window.__TURNSTILE_SITE_KEY__) {
    loadTurnstileScript();
  }
  if (tab === 'register' && typeof turnstile !== 'undefined' && window.__TURNSTILE_SITE_KEY__) {
    const container = document.getElementById('turnstile-container');
    if (container && turnstileWidgetId === null) {
      turnstileWidgetId = turnstile.render(container, {
        sitekey: window.__TURNSTILE_SITE_KEY__,
        theme: darkMode ? 'dark' : 'light',
      });
    }
  }
}

function getPasswordStrength(password) {
  if (!password) return { score: 0, label: '', color: '' };
  let score = 0;
  if (password.length >= 6) score++;
  if (password.length >= 10) score++;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++;
  if (/\d/.test(password)) score++;
  if (/[^a-zA-Z0-9]/.test(password)) score++;

  if (score <= 1) return { score: 1, label: 'Weak', color: 'var(--red)' };
  if (score <= 3) return { score: 2, label: 'Medium', color: 'var(--orange)' };
  return { score: 3, label: 'Strong', color: 'var(--green)' };
}

function updatePasswordStrength(password) {
  const container = document.getElementById('password-strength');
  const fill = document.getElementById('strength-fill');
  const text = document.getElementById('strength-text');
  if (!container) return;

  if (!password) {
    container.style.display = 'none';
    return;
  }

  container.style.display = 'flex';
  const { score, label, color } = getPasswordStrength(password);
  fill.style.width = `${(score / 3) * 100}%`;
  fill.style.background = color;
  text.textContent = label;
  text.style.color = color;
}

async function handleLogin() {
  const username = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value;
  const errorEl = document.getElementById('login-error');
  const btn = document.querySelector('#auth-login-form .auth-submit');
  errorEl.textContent = '';

  if (!username || !password) {
    errorEl.textContent = 'Please enter username and password.';
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Logging in...';
  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();
    if (!res.ok) {
      errorEl.textContent = data.error || 'Login failed';
      return;
    }
    onAuthSuccess(data);
  } catch (e) {
    errorEl.textContent = 'Connection error';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Login';
  }
}

async function handleRegister() {
  const username = document.getElementById('register-username').value.trim();
  const password = document.getElementById('register-password').value;
  const password2 = document.getElementById('register-password2').value;
  const errorEl = document.getElementById('register-error');
  const btn = document.querySelector('#auth-register-form .auth-submit');
  errorEl.textContent = '';

  if (!username || !password) {
    errorEl.textContent = 'Please fill in all fields.';
    return;
  }
  if (password !== password2) {
    errorEl.textContent = 'Passwords do not match.';
    return;
  }

  // Get Turnstile token (only if site key is configured)
  let turnstileToken = '';
  if (window.__TURNSTILE_SITE_KEY__ && typeof turnstile !== 'undefined' && turnstileWidgetId !== null) {
    turnstileToken = turnstile.getResponse(turnstileWidgetId);
    if (!turnstileToken) {
      errorEl.textContent = 'Please complete the verification.';
      return;
    }
  }

  btn.disabled = true;
  btn.textContent = 'Registering...';
  try {
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, turnstileToken }),
    });
    const data = await res.json();
    if (!res.ok) {
      errorEl.textContent = data.error || 'Registration failed';
      if (typeof turnstile !== 'undefined' && turnstileWidgetId !== null) turnstile.reset(turnstileWidgetId);
      return;
    }
    onAuthSuccess(data);
  } catch (e) {
    errorEl.textContent = 'Connection error';
    if (typeof turnstile !== 'undefined' && turnstileWidgetId !== null) turnstile.reset(turnstileWidgetId);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Register';
  }
}

function onAuthSuccess(data) {
  setToken(data.token);
  setUsername(data.username);
  const modal = document.getElementById('auth-modal');
  if (modal) modal.style.display = 'none';
  // Connect socket with user token — binds to user's workspace
  socket.auth = { token: data.token };
  if (socket.connected) socket.disconnect();
  socket.connect();
  loadDiagrams();
  loadTemplates();
  loadWorkspaceInfo();
  updateUserMenu();
  toast('Welcome, ' + data.username + '!');
}

function updateUserMenu() {
  const menu = document.getElementById('user-menu');
  const badge = document.getElementById('user-badge');
  if (menu && apiToken) {
    menu.style.display = 'flex';
    if (badge) badge.textContent = currentUsername || 'User';
  }
  // Update dropdown info
  const dropdownName = document.getElementById('dropdown-username');
  const dropdownWs = document.getElementById('dropdown-workspace');
  if (dropdownName) dropdownName.textContent = currentUsername || 'User';
  if (dropdownWs) dropdownWs.textContent = displayWorkspace(currentWorkspace) || '';
}

function toggleUserDropdown() {
  const dropdown = document.getElementById('user-dropdown');
  if (!dropdown) return;
  const isOpen = dropdown.style.display !== 'none';
  dropdown.style.display = isOpen ? 'none' : 'block';
  // Update workspace info in dropdown
  const dropdownWs = document.getElementById('dropdown-workspace');
  if (dropdownWs && currentWorkspace) dropdownWs.textContent = displayWorkspace(currentWorkspace);
}

// Close dropdown when clicking outside
document.addEventListener('click', (e) => {
  const dropdown = document.getElementById('user-dropdown');
  const badge = document.getElementById('user-badge');
  if (dropdown && dropdown.style.display !== 'none' && !e.target.closest('.user-dropdown-wrapper')) {
    dropdown.style.display = 'none';
  }
});

function logout() {
  setToken('');
  setUsername('');
  currentWorkspace = '';
  const menu = document.getElementById('user-menu');
  if (menu) menu.style.display = 'none';
  const wsBadge = document.getElementById('workspace-badge');
  if (wsBadge) wsBadge.style.display = 'none';
  const dropdown = document.getElementById('user-dropdown');
  if (dropdown) dropdown.style.display = 'none';
  socket.disconnect();
  showAuthModal();
}

function showChangePasswordModal() {
  const dropdown = document.getElementById('user-dropdown');
  if (dropdown) dropdown.style.display = 'none';
  document.getElementById('current-password').value = '';
  document.getElementById('new-password').value = '';
  document.getElementById('new-password2').value = '';
  document.getElementById('password-change-error').textContent = '';
  const strengthEl = document.getElementById('new-password-strength');
  if (strengthEl) strengthEl.style.display = 'none';
  document.getElementById('password-modal').style.display = 'flex';
  document.getElementById('current-password').focus();

  // Wire up enter keys and strength indicator (one-time)
  const newPwInput = document.getElementById('new-password');
  if (!newPwInput._strengthWired) {
    document.getElementById('current-password').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') document.getElementById('new-password').focus();
    });
    document.getElementById('new-password2').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') handleChangePassword();
    });
    newPwInput.addEventListener('input', (e) => {
      const pw = e.target.value;
      const container = document.getElementById('new-password-strength');
      const fill = document.getElementById('new-strength-fill');
      const text = document.getElementById('new-strength-text');
      if (!pw) { container.style.display = 'none'; return; }
      container.style.display = 'flex';
      const { score, label, color } = getPasswordStrength(pw);
      fill.style.width = `${(score / 3) * 100}%`;
      fill.style.background = color;
      text.textContent = label;
      text.style.color = color;
    });
    newPwInput._strengthWired = true;
  }
}

async function handleChangePassword() {
  const oldPw = document.getElementById('current-password').value;
  const newPw = document.getElementById('new-password').value;
  const newPw2 = document.getElementById('new-password2').value;
  const errorEl = document.getElementById('password-change-error');
  const btn = document.getElementById('change-password-btn');
  errorEl.textContent = '';

  if (!oldPw || !newPw) {
    errorEl.textContent = 'Please fill in all fields.';
    return;
  }
  if (newPw !== newPw2) {
    errorEl.textContent = 'New passwords do not match.';
    return;
  }
  if (newPw.length < 6) {
    errorEl.textContent = 'New password must be at least 6 characters.';
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Changing...';
  try {
    const res = await fetch('/api/auth/change-password', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${getToken()}`,
      },
      body: JSON.stringify({ oldPassword: oldPw, newPassword: newPw }),
    });
    const data = await res.json();
    if (!res.ok) {
      errorEl.textContent = data.error || 'Failed to change password';
      return;
    }
    // Update token (server rotates it on password change)
    setToken(data.token);
    socket.auth = { token: data.token };

    socket.disconnect().connect();
    closeModal('password-modal');
    toast('Password changed successfully');
  } catch (e) {
    errorEl.textContent = 'Connection error';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Change Password';
  }
}

// --- MCP Config ---
function getMcpEndpoint() {
  return `${location.origin}/mcp`;
}

function generateMcpConfigs() {
  const endpoint = getMcpEndpoint();

  // All clients use mcp-remote as bridge (OAuth auto-auth)
  const claude = {
    mcpServers: {
      'mermaid-studio': {
        command: 'npx',
        args: ['-y', 'mcp-remote@latest', endpoint]
      }
    }
  };

  const claudeCode = {
    mcpServers: {
      'mermaid-studio': {
        command: 'npx',
        args: ['-y', 'mcp-remote@latest', endpoint]
      }
    }
  };

  const cursor = {
    mcpServers: {
      'mermaid-studio': {
        command: 'npx',
        args: ['-y', 'mcp-remote@latest', endpoint]
      }
    }
  };

  return { claude, 'claude-code': claudeCode, cursor };
}

function copyMcpEntry() {
  const endpoint = getMcpEndpoint();
  const entry = {
    'mermaid-studio': {
      command: 'npx',
      args: ['-y', 'mcp-remote@latest', endpoint]
    }
  };
  const text = JSON.stringify(entry, null, 2);
  const inner = text.split('\n').slice(1, -1).map(l => l.slice(2)).join('\n');
  navigator.clipboard.writeText(inner).then(() => {
    toast('Copied! Paste inside "mcpServers": { } in your config');
  });
}

let mcpTokenRevealed = false;

function maskToken(token) {
  if (!token || token.length < 12) return '••••••••';
  return token.slice(0, 4) + '••••••••••••' + token.slice(-4);
}

function toggleTokenReveal() {
  mcpTokenRevealed = !mcpTokenRevealed;
  const el = document.getElementById('mcp-token-display');
  const btn = document.getElementById('mcp-token-reveal-btn');
  const token = getToken();
  el.textContent = mcpTokenRevealed ? token : maskToken(token);
  btn.textContent = mcpTokenRevealed ? 'Hide' : 'Show';
}

function copyMcpToken() {
  navigator.clipboard.writeText(getToken()).then(() => toast('Token copied!'));
}

function showMcpConfigModal() {
  const endpoint = getMcpEndpoint();
  const configs = generateMcpConfigs();

  document.getElementById('mcp-endpoint-display').textContent = endpoint;
  document.getElementById('mcp-code-claude').textContent = JSON.stringify(configs.claude, null, 2);
  document.getElementById('mcp-code-claude-code').textContent = JSON.stringify(configs['claude-code'], null, 2);
  document.getElementById('mcp-code-cursor').textContent = JSON.stringify(configs.cursor, null, 2);

  document.getElementById('mcp-modal').style.display = 'flex';
  switchMcpTab('claude');
}

function switchMcpTab(tab) {
  document.querySelectorAll('.mcp-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.config === tab);
  });
  ['claude', 'claude-code', 'cursor'].forEach(t => {
    const el = document.getElementById(`mcp-config-${t}`);
    if (el) el.style.display = t === tab ? 'block' : 'none';
  });
}

function copyMcpConfig(tab) {
  const configs = generateMcpConfigs();
  const text = JSON.stringify(configs[tab], null, 2);
  navigator.clipboard.writeText(text).then(() => {
    toast('Configuration copied!');
  });
}

async function regenerateToken() {
  if (!confirm('Regenerate token? The old token will be invalidated immediately.')) return;
  const result = await api('/auth/regenerate-token', { method: 'POST' });
  if (result && result.token) {
    setToken(result.token);
    // Reconnect WebSocket with new token
    socket.auth = { token: result.token };

    socket.disconnect();
    socket.connect();
    // Refresh MCP modal content
    showMcpConfigModal();
    toast('Token regenerated');
  } else {
    toast(result?.error || 'Failed to regenerate token');
  }
}

function copyToClipboard(text) {
  navigator.clipboard.writeText(text).then(() => {
    toast('Copied!');
  });
}

const typeIcons = {
  flowchart: '📊', swimlane: '🏊', stateDiagram: '🔄', sequence: '🔀',
  classDiagram: '🏗', gantt: '📅', erDiagram: '🗄', pie: '🥧', mindmap: '🧠'
};

const typeNames = {
  flowchart: '流程图', swimlane: '泳道图', stateDiagram: '状态图', sequence: '时序图',
  classDiagram: '类图', gantt: '甘特图', erDiagram: 'ER图', pie: '饼图', mindmap: '思维导图'
};

// --- Dark Mode (#2) ---
let darkMode = localStorage.getItem('ms_dark_mode') === 'true' ||
  (!localStorage.getItem('ms_dark_mode') && window.matchMedia('(prefers-color-scheme: dark)').matches);

function applyTheme() {
  document.documentElement.setAttribute('data-theme', darkMode ? 'dark' : 'light');
  const btn = document.getElementById('theme-btn');
  if (btn) btn.textContent = darkMode ? '☀️' : '🌙';

  // Update mermaid theme
  mermaid.initialize({
    startOnLoad: false,
    theme: 'base',
    securityLevel: 'loose',
    flowchart: { useMaxWidth: true, htmlLabels: true, curve: 'basis', padding: 16 },
    sequence: { useMaxWidth: true },
    themeVariables: darkMode ? {
      darkMode: true,
      background: '#1a1d23',
      fontFamily: 'Inter, -apple-system, sans-serif',
      fontSize: '14px',
      primaryColor: '#2a3a5c',
      primaryTextColor: '#e2e8f0',
      primaryBorderColor: '#4f6ef7',
      lineColor: '#64748b',
      secondaryColor: '#1a2e1a',
      secondaryTextColor: '#e2e8f0',
      secondaryBorderColor: '#34a853',
      tertiaryColor: '#2e2a1a',
      tertiaryTextColor: '#e2e8f0',
      tertiaryBorderColor: '#fbbc04',
      noteBkgColor: '#2a2d35',
      noteTextColor: '#94a3b8',
      noteBorderColor: '#374151',
      edgeLabelBackground: '#1a1d23',
      clusterBkg: '#2a2d35',
      clusterBorder: '#374151',
      titleColor: '#e2e8f0',
    } : {
      darkMode: false,
      background: '#ffffff',
      fontFamily: 'Inter, -apple-system, sans-serif',
      fontSize: '14px',
      primaryColor: '#e8edff',
      primaryTextColor: '#1a1d21',
      primaryBorderColor: '#4f6ef7',
      lineColor: '#9aa0a6',
      secondaryColor: '#f0fdf4',
      secondaryTextColor: '#1a1d21',
      secondaryBorderColor: '#34a853',
      tertiaryColor: '#fef3e2',
      tertiaryTextColor: '#1a1d21',
      tertiaryBorderColor: '#fbbc04',
      noteBkgColor: '#f8f9fb',
      noteTextColor: '#5f6368',
      noteBorderColor: '#e2e5e9',
      edgeLabelBackground: '#ffffff',
      clusterBkg: '#f8f9fb',
      clusterBorder: '#e2e5e9',
      titleColor: '#1a1d21',
    }
  });
}

function toggleTheme() {
  darkMode = !darkMode;
  localStorage.setItem('ms_dark_mode', darkMode);
  applyTheme();
  // Update CodeMirror theme
  if (cmEditor) {
    cmEditor.setOption('theme', darkMode ? 'material-darker' : 'default');
  }
  // Re-render preview with new theme
  renderPreview();
}

// --- CodeMirror (#1) ---
let cmEditor = null;

function initCodeMirror() {
  const textarea = document.getElementById('code-editor');
  if (typeof CodeMirror === 'undefined') return;

  cmEditor = CodeMirror.fromTextArea(textarea, {
    mode: 'markdown',
    theme: darkMode ? 'material-darker' : 'default',
    lineNumbers: true,
    matchBrackets: true,
    autoCloseBrackets: true,
    tabSize: 2,
    indentWithTabs: false,
    lineWrapping: true,
    undoDepth: 0, // Disable CM undo - we use our own stack (#4/#5 conflict fix)
    placeholder: 'Enter Mermaid diagram code here...',
  });

  cmEditor.setSize('100%', '100%');

  cmEditor.on('change', () => {
    if (!skipUndoCapture) captureUndo();
    const countEl = document.getElementById('char-count');
    if (countEl) countEl.textContent = `${cmEditor.getValue().length} chars`;
    clearTimeout(renderTimeout);
    renderTimeout = setTimeout(() => {
      renderPreview();
      saveDraft();
    }, 500);
  });
}

// --- Auto-save / localStorage draft (#3) ---
function saveDraft() {
  const code = cmEditor ? cmEditor.getValue() : document.getElementById('code-editor').value;
  const name = document.getElementById('diagram-name').value;
  if (code || name) {
    localStorage.setItem('ms_draft', JSON.stringify({
      code,
      name,
      diagramId: currentDiagramId,
      savedAt: Date.now()
    }));
    const indicator = document.getElementById('draft-indicator');
    if (indicator) indicator.style.display = 'inline';
  }
}

function loadDraft() {
  const raw = localStorage.getItem('ms_draft');
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function clearDraft() {
  localStorage.removeItem('ms_draft');
  const indicator = document.getElementById('draft-indicator');
  if (indicator) indicator.style.display = 'none';
}

// --- Init ---
applyTheme();

// --- WebSocket ---
const socket = (() => {
  let ws = null;
  const handlers = {};
  const wrapper = {
    auth: { token: getToken() },
    connected: false,
    on(event, fn) {
      if (!handlers[event]) handlers[event] = [];
      handlers[event].push(fn);
    },
    connect() {
      if (ws) { try { ws.close(); } catch {} }
      const token = wrapper.auth.token || getToken();
      if (!token) return wrapper;
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      ws = new WebSocket(`${proto}//${location.host}/ws?token=${encodeURIComponent(token)}`);
      ws.onopen = () => {
        wrapper.connected = true;
        (handlers['connect'] || []).forEach(fn => fn());
      };
      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          if (msg.event && handlers[msg.event]) {
            handlers[msg.event].forEach(fn => fn(msg.data));
          }
        } catch {}
      };
      ws.onerror = () => {
        (handlers['connect_error'] || []).forEach(fn => fn(new Error('WebSocket error')));
      };
      ws.onclose = () => {
        wrapper.connected = false;
        (handlers['disconnect'] || []).forEach(fn => fn());
      };
      return wrapper;
    },
    disconnect() {
      if (ws) { try { ws.close(); } catch {} ws = null; }
      wrapper.connected = false;
      return wrapper;
    },
  };
  return wrapper;
})();

socket.on('connect', () => {
  console.log('🔌 WebSocket connected');
});

// --- Workspace info ---
let currentWorkspace = '';

function displayWorkspace(ws) {
  return ws ? ws.replace(/^user-/, '') : ws;
}

socket.on('workspace:info', (data) => {
  currentWorkspace = data.workspace || '';
  const badge = document.getElementById('workspace-badge');
  if (badge && currentWorkspace) {
    badge.textContent = displayWorkspace(currentWorkspace);
    badge.style.display = 'inline-flex';
  }
});

async function loadWorkspaceInfo() {
  const result = await api('/workspace');
  if (result && result.workspace) {
    currentWorkspace = result.workspace;
    const badge = document.getElementById('workspace-badge');
    if (badge) {
      badge.textContent = displayWorkspace(currentWorkspace);
      badge.style.display = 'inline-flex';
    }
  }
}

socket.on('connect_error', (error) => {
  console.error('🔌 WebSocket connection error:', error.message);
});

socket.on('diagram:created', (data) => {
  showNotification(`📊 New diagram: ${data.name}`);
  loadDiagrams();
  if (liveMode) {
    loadDiagramWithAnimation(data.id);
  }
});

socket.on('diagram:updated', (data) => {
  showNotification(`✏️ Diagram updated: ${data.name}`);
  loadDiagrams();
  if (currentDiagramId === data.id) {
    if (cmEditor) cmEditor.setValue(data.code);
    else document.getElementById('code-editor').value = data.code;
    if (data.name) document.getElementById('diagram-name').value = data.name;
    renderPreviewWithAnimation();
  } else if (liveMode) {
    loadDiagramWithAnimation(data.id);
  }
});

socket.on('diagram:deleted', (data) => {
  showNotification(`🗑 Diagram deleted`);
  loadDiagrams();
  if (currentDiagramId === data.id) {
    currentDiagramId = null;
    document.getElementById('diagram-name').value = '';
    if (cmEditor) cmEditor.setValue('');
    else document.getElementById('code-editor').value = '';
    document.getElementById('preview').innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">📊</div>
        <h3>Start creating</h3>
        <p>Write Mermaid code on the left or pick a template to begin</p>
      </div>`;
    location.hash = '';
  }
});

socket.on('disconnect', () => {
  console.log('🔌 WebSocket disconnected');
});

// --- Notification ---
function showNotification(msg, duration = 3000) {
  const existing = document.querySelector('.live-notification');
  if (existing) existing.remove();

  const el = document.createElement('div');
  el.className = 'live-notification';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => {
    el.style.animation = 'slideOut 0.3s ease-out forwards';
    setTimeout(() => el.remove(), 300);
  }, duration);
}

// --- Live Mode ---
function toggleLiveMode() {
  liveMode = !liveMode;
  const btn = document.getElementById('live-btn');
  const body = document.body;

  if (liveMode) {
    btn.classList.add('active');
    btn.textContent = '📡 Live ON';
    body.classList.add('live-mode');
    showNotification('📡 Live mode enabled - auto-tracking diagram changes');
  } else {
    btn.classList.remove('active');
    btn.textContent = '📡 Live';
    body.classList.remove('live-mode');
    showNotification('📡 Live mode disabled');
  }
}

// --- Animated rendering ---
async function renderPreviewWithAnimation() {
  const container = document.querySelector('.preview-container');

  container.classList.add('updating');
  container.classList.remove('updated');

  await new Promise(r => setTimeout(r, 300));
  await renderPreview();
  applyMermaidAnimations();

  container.classList.remove('updating');
  container.classList.add('updated');
  setTimeout(() => container.classList.remove('updated'), 500);
}

async function loadDiagramWithAnimation(id) {
  const container = document.querySelector('.preview-container');
  container.classList.add('updating');
  await new Promise(r => setTimeout(r, 300));

  const diagram = await api(`/diagrams/${id}`);
  if (diagram.error) {
    container.classList.remove('updating');
    return;
  }

  currentDiagramId = diagram.id;
  document.getElementById('diagram-name').value = diagram.name;
  if (cmEditor) cmEditor.setValue(diagram.code);
  else document.getElementById('code-editor').value = diagram.code;
  location.hash = `#/diagram/${id}`;

  await renderPreview();
  applyMermaidAnimations();

  container.classList.remove('updating');
  container.classList.add('updated');
  setTimeout(() => container.classList.remove('updated'), 500);

  highlightActive();
}

function applyMermaidAnimations() {
  const preview = document.getElementById('preview');
  const svg = preview.querySelector('svg');
  if (!svg) return;

  const nodes = svg.querySelectorAll('.node');
  const edges = svg.querySelectorAll('.edgePath path');
  const labels = svg.querySelectorAll('.edgeLabel, .nodeLabel');
  const totalElements = nodes.length + edges.length + labels.length;
  if (totalElements === 0) return;

  const TOTAL_DURATION = 1.0;
  const nodeDelay = totalElements > 1 ? TOTAL_DURATION / totalElements : 0;
  let idx = 0;

  nodes.forEach((node) => {
    const delay = idx * nodeDelay;
    node.style.opacity = '0';
    node.style.transform = 'scale(0)';
    node.style.transformOrigin = 'center center';
    node.style.transformBox = 'fill-box';
    node.style.animation = `nodePopIn 0.35s ease-out ${delay}s forwards`;
    idx++;
  });

  edges.forEach((edge) => {
    const delay = idx * nodeDelay;
    const length = edge.getTotalLength ? edge.getTotalLength() : 1000;
    edge.style.strokeDasharray = length;
    edge.style.strokeDashoffset = length;
    edge.style.animation = `edgeDrawIn 0.4s ease-out ${delay}s forwards`;
    idx++;
  });

  labels.forEach((label) => {
    const delay = idx * nodeDelay;
    label.style.opacity = '0';
    label.style.animation = `labelFadeIn 0.25s ease-out ${delay}s forwards`;
    idx++;
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  await checkAuthSetup();
  initCodeMirror();
  loadDiagrams();
  loadTemplates();
  loadWorkspaceInfo();
  setupEditor();
  handleRoute();
  window.addEventListener('hashchange', handleRoute);

  // Restore draft (#3)
  const draft = loadDraft();
  if (draft && !location.hash.match(/#\/diagram\/.+/) && draft.code) {
    if (cmEditor) cmEditor.setValue(draft.code);
    else document.getElementById('code-editor').value = draft.code;
    if (draft.name) document.getElementById('diagram-name').value = draft.name;
    if (draft.diagramId) currentDiagramId = draft.diagramId;
    renderPreview();
    toast('Draft restored');
  }

  // Initialize undo stack
  captureUndo();
});

// --- Routing ---
function handleRoute() {
  const hash = location.hash;
  const match = hash.match(/#\/diagram\/(.+)/);
  if (match) {
    loadDiagram(match[1]);
  }
}

// --- API ---
async function api(path, opts = {}) {
  const token = getToken();
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  try {
    const res = await fetch(`/api${path}`, {
      headers,
      ...opts,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });

    if (res.status === 401) {
      showAuthModal();
      return { error: 'Unauthorized' };
    }

    return res.json();
  } catch (e) {
    console.error('API error:', e);
    toast('Network error', 'error');
    return { error: e.message };
  }
}

async function loadDiagrams() {
  const result = await api('/diagrams');
  if (Array.isArray(result)) {
    diagrams = result;
    renderDiagramList();
  }
}

async function loadTemplates() {
  const result = await api('/templates');
  if (result && !result.error) {
    templates = result;
    renderTemplates();
    renderTypeSelector();
  }
}

async function loadDiagram(id) {
  const diagram = await api(`/diagrams/${id}`);
  if (diagram.error) {
    toast('Diagram not found', 'error');
    return;
  }
  currentDiagramId = diagram.id;
  document.getElementById('diagram-name').value = diagram.name;
  if (cmEditor) cmEditor.setValue(diagram.code);
  else document.getElementById('code-editor').value = diagram.code;
  location.hash = `#/diagram/${id}`;
  clearDraft();
  renderPreview();
  highlightActive();
  // Reset undo stack for new diagram
  undoStack = [diagram.code];
  redoStack = [];
}

async function saveDiagram() {
  const name = document.getElementById('diagram-name').value || 'Untitled';
  const code = cmEditor ? cmEditor.getValue() : document.getElementById('code-editor').value;

  if (!code.trim()) {
    toast('Please enter some diagram code', 'error');
    return;
  }

  if (currentDiagramId) {
    await api(`/diagrams/${currentDiagramId}`, {
      method: 'PUT',
      body: { name, code },
    });
    toast('Saved ✓');
  } else {
    const result = await api('/diagrams', {
      method: 'POST',
      body: { name, type: detectType(code), code },
    });
    currentDiagramId = result.id;
    location.hash = `#/diagram/${result.id}`;
    toast('Created ✓');
  }
  clearDraft();
  loadDiagrams();
}

async function deleteDiagramById(id) {
  if (!confirm('Delete this diagram?')) return;
  await api(`/diagrams/${id}`, { method: 'DELETE' });
  if (currentDiagramId === id) {
    currentDiagramId = null;
    document.getElementById('diagram-name').value = '';
    if (cmEditor) cmEditor.setValue('');
    else document.getElementById('code-editor').value = '';
    document.getElementById('preview').innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">📊</div>
        <h3>Start creating</h3>
        <p>Write Mermaid code on the left or pick a template to begin</p>
      </div>`;
    location.hash = '';
  }
  loadDiagrams();
  toast('Deleted');
}

// --- Rendering ---
async function renderPreview() {
  const code = cmEditor ? cmEditor.getValue().trim() : document.getElementById('code-editor').value.trim();
  const preview = document.getElementById('preview');
  const errorEl = document.getElementById('error-display');
  const timeEl = document.getElementById('render-time');

  if (!code) {
    preview.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">📊</div>
        <h3>Start creating</h3>
        <p>Write Mermaid code in the editor or pick a template to begin</p>
      </div>`;
    errorEl.style.display = 'none';
    return;
  }

  if (typeof mermaid === 'undefined') return;

  const currentRenderId = ++latestRenderId;
  const start = performance.now();
  try {
    renderCounter++;
    const renderId = `mermaid-preview-${renderCounter}`;
    const { svg } = await mermaid.render(renderId, code);
    // Only update if this is still the latest render request (race condition fix)
    if (currentRenderId !== latestRenderId) return;
    preview.innerHTML = svg;
    errorEl.style.display = 'none';
    const ms = (performance.now() - start).toFixed(0);
    timeEl.textContent = `${ms}ms`;
  } catch (e) {
    if (currentRenderId !== latestRenderId) return;
    errorEl.textContent = e.message || 'Syntax error';
    errorEl.style.display = 'block';
    timeEl.textContent = '';
    renderCounter++;
  }
}

// --- Diagram list with search (#5) ---
function filterDiagrams() {
  renderDiagramList();
}

function renderDiagramList() {
  const list = document.getElementById('diagram-list');
  const searchInput = document.getElementById('diagram-search');
  const query = searchInput ? searchInput.value.toLowerCase().trim() : '';

  let filtered = diagrams;
  if (query) {
    filtered = diagrams.filter(d =>
      d.name.toLowerCase().includes(query) ||
      (typeNames[d.type] || d.type).toLowerCase().includes(query)
    );
  }

  if (!filtered.length) {
    list.innerHTML = `
      <div class="empty-state" style="padding:32px 16px">
        <div class="empty-state-icon">${query ? '🔍' : '📂'}</div>
        <p style="font-size:13px">${query ? 'No matching diagrams found' : 'No diagrams yet. Create one to get started!'}</p>
      </div>`;
    return;
  }

  list.innerHTML = filtered.map(d => `
    <div class="diagram-item ${d.id === currentDiagramId ? 'active' : ''}" data-id="${escHtml(d.id)}">
      <div class="diagram-item-info">
        <div class="diagram-item-name">${escHtml(d.name)}</div>
        <div class="diagram-item-meta">${timeAgo(d.updatedAt)}</div>
      </div>
      <span class="diagram-item-type">${typeIcons[d.type] || '📊'} ${typeNames[d.type] || d.type}</span>
      <div class="diagram-item-actions">
        <button class="btn btn-sm btn-danger btn-icon diagram-delete-btn" title="Delete">🗑</button>
      </div>
    </div>
  `).join('');

  // Attach event listeners safely (XSS fix - no inline onclick)
  list.querySelectorAll('.diagram-item').forEach(el => {
    const id = el.dataset.id;
    el.addEventListener('click', () => loadDiagram(id));
    const delBtn = el.querySelector('.diagram-delete-btn');
    if (delBtn) {
      delBtn.addEventListener('click', (e) => { e.stopPropagation(); deleteDiagramById(id); });
    }
  });
}

function highlightActive() {
  document.querySelectorAll('.diagram-item').forEach(el => {
    el.classList.toggle('active', el.onclick?.toString().includes(currentDiagramId));
  });
  renderDiagramList();
}

function renderTemplates() {
  const grid = document.getElementById('template-grid');
  grid.innerHTML = Object.entries(templates).map(([key, t]) => `
    <div class="template-card" onclick="useTemplate('${key}')">
      <div class="template-card-icon">${typeIcons[key] || '📊'}</div>
      <div class="template-card-name">${t.name}</div>
    </div>
  `).join('');
}

function renderTypeSelector() {
  const sel = document.getElementById('type-selector');
  sel.innerHTML = Object.entries(typeNames).map(([key, name]) => `
    <button class="btn ${key === selectedType ? 'active' : ''}" onclick="selectType('${key}')">${typeIcons[key]} ${name}</button>
  `).join('');
}

// --- Actions ---
function useTemplate(key) {
  const t = templates[key];
  if (!t) return;
  currentDiagramId = null;
  document.getElementById('diagram-name').value = t.name;
  if (cmEditor) cmEditor.setValue(t.code);
  else document.getElementById('code-editor').value = t.code;
  location.hash = '';
  renderPreview();
  switchTab('diagrams');
  toast(`Loaded template: ${t.name}`);
  undoStack = [t.code];
  redoStack = [];
}

function selectType(type) {
  selectedType = type;
  renderTypeSelector();
}

function showNewDiagramModal() {
  document.getElementById('new-name').value = '';
  selectedType = 'flowchart';
  renderTypeSelector();
  document.getElementById('new-modal').style.display = 'flex';
  document.getElementById('new-name').focus();
}

async function createNewDiagram() {
  const name = document.getElementById('new-name').value || 'Untitled';
  const t = templates[selectedType];
  const code = t ? t.code : 'flowchart TD\n    A[Start] --> B[End]';

  const result = await api('/diagrams', {
    method: 'POST',
    body: { name, type: selectedType, code },
  });

  closeModal('new-modal');
  currentDiagramId = result.id;
  document.getElementById('diagram-name').value = name;
  if (cmEditor) cmEditor.setValue(code);
  else document.getElementById('code-editor').value = code;
  location.hash = `#/diagram/${result.id}`;
  renderPreview();
  loadDiagrams();
  clearDraft();
  toast('Created ✓');
  undoStack = [code];
  redoStack = [];
}

function showShareModal() {
  if (!currentDiagramId) {
    toast('Save the diagram first', 'error');
    return;
  }
  const url = `${location.origin}/#/diagram/${currentDiagramId}`;
  document.getElementById('share-url').value = url;
  document.getElementById('share-modal').style.display = 'flex';
}

function copyShareLink() {
  const input = document.getElementById('share-url');
  input.select();
  navigator.clipboard.writeText(input.value);
  toast('Link copied ✓');
}

async function exportSVG() {
  const svg = document.querySelector('#preview svg');
  if (!svg) { toast('Nothing to export', 'error'); return; }
  const blob = new Blob([svg.outerHTML], { type: 'image/svg+xml' });
  downloadBlob(blob, `${document.getElementById('diagram-name').value || 'diagram'}.svg`);
  toast('SVG exported ✓');
}

async function exportPNG() {
  const svg = document.querySelector('#preview svg');
  if (!svg) { toast('Nothing to export', 'error'); return; }

  const canvas = document.createElement('canvas');
  const bbox = svg.getBoundingClientRect();
  const scale = 2;
  canvas.width = bbox.width * scale;
  canvas.height = bbox.height * scale;
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);

  const img = new Image();
  const svgData = new XMLSerializer().serializeToString(svg);
  const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(svgBlob);

  img.onload = () => {
    ctx.fillStyle = darkMode ? '#1a1d23' : '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, bbox.width, bbox.height);
    URL.revokeObjectURL(url);
    canvas.toBlob(blob => {
      downloadBlob(blob, `${document.getElementById('diagram-name').value || 'diagram'}.png`);
      toast('PNG exported ✓');
    });
  };
  img.src = url;
}

// --- Batch export (#13) ---
async function batchExport() {
  const result = await api('/diagrams/batch/export');
  if (!result || result.error || !result.length) {
    toast('No diagrams to export', 'error');
    return;
  }

  // Export all as a JSON file containing all diagram codes
  const exportData = result.map(d => ({
    name: d.name,
    type: d.type,
    code: d.code,
  }));
  const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
  downloadBlob(blob, `mermaid-studio-export-${new Date().toISOString().slice(0, 10)}.json`);
  toast(`Exported ${result.length} diagrams ✓`);
}

function downloadBlob(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

// --- Version history (#12) ---
async function showVersionsModal() {
  if (!currentDiagramId) {
    toast('Save the diagram first', 'error');
    return;
  }
  const versions = await api(`/diagrams/${currentDiagramId}/versions`);
  const list = document.getElementById('versions-list');

  if (!versions.length) {
    list.innerHTML = '<p style="color:var(--text-muted);font-size:13px">No version history yet.</p>';
  } else {
    list.innerHTML = versions.map(v => {
      const display = v.timestamp.replace(/T/, ' ').replace(/Z\.json$/, '').replace(/-/g, (m, i) => i > 9 ? ':' : '-');
      return `
        <div class="version-item">
          <span class="version-time">${escHtml(display)}</span>
          <button class="btn btn-sm btn-accent" data-file="${escHtml(v.file)}">Restore</button>
        </div>`;
    }).join('');

    // Attach restore handlers safely
    list.querySelectorAll('.version-item button[data-file]').forEach(btn => {
      btn.addEventListener('click', () => restoreVersion(btn.dataset.file));
    });
  }

  document.getElementById('versions-modal').style.display = 'flex';
}

async function restoreVersion(file) {
  if (!confirm('Restore this version? Current changes will be saved as a new version.')) return;
  const result = await api(`/diagrams/${currentDiagramId}/restore/${file}`, { method: 'POST' });
  if (result.error) {
    toast('Failed to restore', 'error');
    return;
  }
  if (cmEditor) cmEditor.setValue(result.code);
  else document.getElementById('code-editor').value = result.code;
  if (result.name) document.getElementById('diagram-name').value = result.name;
  renderPreview();
  closeModal('versions-modal');
  toast('Version restored ✓');
}

// --- Modal helpers ---
function closeModal(id) {
  document.getElementById(id).style.display = 'none';
}

function getOpenModal() {
  const modals = ['share-modal', 'new-modal', 'versions-modal', 'shortcuts-modal', 'mcp-modal', 'auth-modal', 'password-modal'];
  for (const id of modals) {
    const el = document.getElementById(id);
    if (el && el.style.display !== 'none' && el.style.display !== '') return id;
  }
  return null;
}

// --- Editor setup ---
function setupEditor() {
  const editor = document.getElementById('code-editor');
  const countEl = document.getElementById('char-count');

  // If CodeMirror is active, the textarea is hidden
  if (cmEditor) {
    countEl.textContent = `${cmEditor.getValue().length} chars`;
    return;
  }

  editor.addEventListener('input', () => {
    countEl.textContent = `${editor.value.length} chars`;
    captureUndo();
    clearTimeout(renderTimeout);
    renderTimeout = setTimeout(() => {
      renderPreview();
      saveDraft();
    }, 500);
  });

  // Tab key support
  editor.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const start = editor.selectionStart;
      const end = editor.selectionEnd;
      editor.value = editor.value.substring(0, start) + '  ' + editor.value.substring(end);
      editor.selectionStart = editor.selectionEnd = start + 2;
      editor.dispatchEvent(new Event('input'));
    }
  });

  // Divider drag
  const divider = document.getElementById('divider');
  const editorPane = document.getElementById('editor-pane');
  const previewPane = document.getElementById('preview-pane');

  let isDragging = false;
  divider.addEventListener('mousedown', () => { isDragging = true; });
  document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    const container = document.querySelector('.split-pane');
    const rect = container.getBoundingClientRect();
    const pct = ((e.clientX - rect.left) / rect.width) * 100;
    if (pct > 20 && pct < 80) {
      editorPane.style.flex = `0 0 ${pct}%`;
      previewPane.style.flex = '1';
    }
  });
  document.addEventListener('mouseup', () => { isDragging = false; });
}

// --- Keyboard shortcuts (#15) ---
document.addEventListener('keydown', (e) => {
  const mod = e.ctrlKey || e.metaKey;

  // Esc to close modals
  if (e.key === 'Escape') {
    const modal = getOpenModal();
    if (modal) {
      closeModal(modal);
      e.preventDefault();
      return;
    }
  }

  // Don't handle shortcuts when typing in inputs (except CodeMirror)
  const tag = e.target.tagName;
  const isInput = (tag === 'INPUT' || tag === 'TEXTAREA') && !e.target.closest('.CodeMirror');

  if (mod && e.key === 's') {
    e.preventDefault();
    saveDiagram();
    return;
  }

  if (mod && e.key === 'n') {
    e.preventDefault();
    showNewDiagramModal();
    return;
  }

  if (mod && e.key === 'e') {
    e.preventDefault();
    exportSVG();
    return;
  }

  if (mod && e.key === '/') {
    e.preventDefault();
    toggleSidebar();
    return;
  }

  if (mod && e.key === 'd') {
    e.preventDefault();
    toggleTheme();
    return;
  }

  // ? to show shortcuts (only when not in input)
  if (e.key === '?' && !isInput && !e.target.closest('.CodeMirror')) {
    document.getElementById('shortcuts-modal').style.display = 'flex';
    return;
  }
});

// --- UI helpers ---
function switchTab(tab) {
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  document.getElementById('diagrams-tab').style.display = tab === 'diagrams' ? 'block' : 'none';
  document.getElementById('templates-tab').style.display = tab === 'templates' ? 'block' : 'none';
  // Hide search when on templates tab
  const searchEl = document.querySelector('.sidebar-search');
  if (searchEl) searchEl.style.display = tab === 'diagrams' ? 'block' : 'none';
}

function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('collapsed');
}

function detectType(code) {
  const first = code.trim().split('\n')[0].toLowerCase();
  if (first.startsWith('flowchart') || first.startsWith('graph')) return 'flowchart';
  if (first.startsWith('sequencediagram')) return 'sequence';
  if (first.startsWith('statediagram')) return 'stateDiagram';
  if (first.startsWith('classdiagram')) return 'classDiagram';
  if (first.startsWith('gantt')) return 'gantt';
  if (first.startsWith('erdiagram')) return 'erDiagram';
  if (first.startsWith('pie')) return 'pie';
  if (first.startsWith('mindmap')) return 'mindmap';
  if (code.includes('subgraph')) return 'swimlane';
  return 'flowchart';
}

function showTokenSettings() {
  showMcpConfigModal();
}

function toast(msg, type = 'success') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

function escHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function timeAgo(date) {
  const diff = Date.now() - new Date(date).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}
