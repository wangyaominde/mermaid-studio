-- Diagrams table
CREATE TABLE IF NOT EXISTS diagrams (
  id TEXT PRIMARY KEY,
  workspace TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'flowchart',
  code TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_diagrams_workspace ON diagrams(workspace);
CREATE INDEX IF NOT EXISTS idx_diagrams_updated ON diagrams(workspace, updated_at);

-- Diagram version history
CREATE TABLE IF NOT EXISTS diagram_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  diagram_id TEXT NOT NULL,
  workspace TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  code TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (diagram_id) REFERENCES diagrams(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_versions_diagram ON diagram_versions(diagram_id);

-- Users table
CREATE TABLE IF NOT EXISTS users (
  username TEXT PRIMARY KEY,
  password_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  workspace TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_users_token ON users(token);
