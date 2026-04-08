# Mermaid Studio

Online Mermaid.js diagram editor with MCP support, deployed on Cloudflare Workers.

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/wangyaominde/mermaid-studio)

## Features

- Code editor (CodeMirror) + live Mermaid preview
- 9 diagram types (flowchart, sequence, class, state, ER, gantt, pie, swimlane, mindmap)
- Real-time collaboration via WebSocket (Durable Objects)
- MCP endpoint for AI tools (Claude, Cursor, etc.)
- User registration with workspace isolation
- Version history (50 versions per diagram)
- Export SVG / PNG
- Dark mode
- Cloudflare Turnstile anti-bot protection (optional)

## Deploy Your Own

### 1. Create D1 Database

```bash
npm install
npx wrangler login
npx wrangler d1 create mermaid-studio-db
```

Copy the returned `database_id` into `wrangler.toml`.

### 2. Run Migrations

```bash
npm run db:migrate
```

### 3. Deploy

```bash
npm run deploy
```

### 4. (Optional) Add Turnstile Protection

Create a Turnstile widget at [Cloudflare Dashboard](https://dash.cloudflare.com/?to=/:account/turnstile), then:

```bash
# Add site key to wrangler.toml [vars]
# TURNSTILE_SITE_KEY = "your-site-key"

# Set secret key
npx wrangler secret put TURNSTILE_SECRET_KEY
```

Without Turnstile configured, registration works normally without human verification.

## Local Development

```bash
npm run db:migrate:local
npm run dev
```

## MCP Configuration

After registration, click the **MCP** button in the top bar to get your config. Example:

```json
{
  "mcpServers": {
    "mermaid-studio": {
      "url": "https://your-worker.workers.dev/mcp",
      "headers": {
        "Authorization": "Bearer your-token"
      }
    }
  }
}
```

### MCP Tools

| Tool | Description | Parameters |
|------|-------------|------------|
| `create_diagram` | Create diagram | `name`, `type?`, `code` |
| `update_diagram` | Update diagram | `diagram_id`, `code`, `name?` |
| `get_diagram` | Get diagram | `diagram_id` |
| `list_diagrams` | List all | - |
| `delete_diagram` | Delete diagram | `diagram_id` |
| `export_diagram` | Export diagram | `diagram_id`, `format?` |
| `get_templates` | Get templates | - |

## API

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/auth/register` | No | Register |
| POST | `/api/auth/login` | No | Login |
| GET | `/api/auth/me` | Yes | Current user |
| POST | `/api/auth/change-password` | Yes | Change password |
| POST | `/api/auth/regenerate-token` | Yes | Regenerate API token |
| POST | `/api/diagrams` | Yes | Create diagram |
| GET | `/api/diagrams` | Yes | List diagrams |
| GET | `/api/diagrams/:id` | Yes | Get diagram |
| PUT | `/api/diagrams/:id` | Yes | Update diagram |
| DELETE | `/api/diagrams/:id` | Yes | Delete diagram |
| GET | `/api/diagrams/:id/versions` | Yes | Version history |
| GET | `/api/diagrams/:id/export` | No | Export (public) |
| GET | `/api/templates` | No | Templates |
| ALL | `/mcp` | Yes | MCP endpoint |
| GET | `/ws` | Yes | WebSocket |

## Architecture

```
wrangler.toml              # Cloudflare Workers config
workers/src/
  index.js                 # Hono router + all API routes
  diagrams.js              # D1 CRUD for diagrams
  users.js                 # D1 user auth (PBKDF2)
  templates.js             # 9 diagram templates
  mcp.js                   # MCP protocol (JSON-RPC)
  websocket.js             # Durable Object for WebSocket
public/
  index.html               # SPA
  app.js                   # Frontend logic
  style.css                # Styles
  vendor/                  # CodeMirror, Mermaid.js
migrations/
  0001_init.sql            # D1 schema
```

**Infrastructure:** Cloudflare Workers + D1 (SQLite) + Durable Objects + Assets

## License

MIT
