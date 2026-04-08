# Mermaid Studio

Let AI create diagrams for you. Mermaid Studio is a diagram editor with a built-in [MCP](https://modelcontextprotocol.io/) server — connect Claude, Cursor, or any MCP-compatible AI and say _"draw me a flowchart"_.

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/wangyaominde/mermaid-studio)

## Why MCP?

Traditional diagram tools require manual drawing. With MCP, AI tools can **create, edit, and manage diagrams programmatically** through a standard protocol:

```
You: "Draw a sequence diagram for OAuth2 login flow"
AI:  creates the diagram → you see it instantly in your browser
You: "Add error handling paths"
AI:  updates the same diagram → preview refreshes in real-time
```

The AI gets 7 tools (`create_diagram`, `update_diagram`, `get_diagram`, `list_diagrams`, `delete_diagram`, `export_diagram`, `get_templates`) and can work with all 9 Mermaid diagram types.

### Connect in 30 Seconds

After registration, click the **MCP** button in the top bar to get a ready-to-paste config:

**Claude Desktop / Claude Code / Cursor:**
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

Each user gets their own workspace — diagrams are isolated, and the AI only sees yours.

> **Note for China / restricted network users:** Cloudflare Workers (`*.workers.dev`) may not be directly accessible in certain regions. You will need a VPN/proxy tool with **enhanced/global mode** that intercepts all system traffic (e.g., Surge Enhanced Mode, Clash TUN mode), as most proxy tools only cover browser traffic and not CLI/Node.js processes.

## Features

- **MCP server** — AI creates/edits diagrams via standard protocol, real-time sync to browser
- **Live editor** — CodeMirror + Mermaid.js preview, 9 diagram types
- **Multi-user** — registration, workspace isolation, token-based auth
- **Real-time** — WebSocket updates via Durable Objects
- **Version history** — 50 versions per diagram, one-click restore
- **Export** — SVG / PNG / batch export
- **Dark mode**
- **Cloudflare Turnstile** — optional anti-bot protection for registration

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

Without Turnstile, registration works without human verification.

## Local Development

```bash
npm run db:migrate:local
npm run dev
```

## MCP Tools

| Tool | Description | Parameters |
|------|-------------|------------|
| `create_diagram` | Create a new diagram | `name`, `type?`, `code` |
| `update_diagram` | Update existing diagram | `diagram_id`, `code`, `name?` |
| `get_diagram` | Get diagram details | `diagram_id` |
| `list_diagrams` | List all diagrams | - |
| `delete_diagram` | Delete a diagram | `diagram_id` |
| `export_diagram` | Export with URL | `diagram_id`, `format?` |
| `get_templates` | Get starter templates | - |

**Supported diagram types:** flowchart, sequence, class, state, ER, gantt, pie, swimlane, mindmap

## Architecture

```
workers/src/
  index.js          Hono router, API routes, auth middleware
  diagrams.js       D1 CRUD for diagrams
  users.js          User auth (PBKDF2 hashing)
  mcp.js            MCP protocol handler (JSON-RPC)
  websocket.js      Durable Object for real-time sync
  templates.js      9 diagram templates
public/             SPA frontend (CodeMirror + Mermaid.js)
migrations/         D1 database schema
```

**Stack:** Cloudflare Workers + D1 + Durable Objects + Hono

## License

MIT
