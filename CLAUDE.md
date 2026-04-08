# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Mermaid Studio is an online Mermaid.js diagram editor deployed on Cloudflare Workers. It has a web UI for interactive editing and an MCP (Model Context Protocol) endpoint that lets AI tools create/edit diagrams programmatically.

## Commands

```bash
npm install              # Install dependencies
npm run dev              # Start local Workers dev server
npm run deploy           # Deploy to Cloudflare Workers
npm run db:migrate       # Apply D1 migrations (remote)
npm run db:migrate:local # Apply D1 migrations (local dev)
```

No test framework or linter is configured.

## Architecture

**Single entry point on Cloudflare Workers:**

- `workers/src/index.js` — Hono-based router with REST API, WebSocket (via Durable Objects), MCP endpoint, and static asset serving. All on a single origin.

**Worker modules:**

- `workers/src/diagrams.js` — CRUD operations for diagrams using D1 (SQLite). Scoped by workspace.
- `workers/src/users.js` — User registration, login, password management using D1. Passwords hashed with PBKDF2.
- `workers/src/templates.js` — Static template definitions for 9 diagram types.
- `workers/src/mcp.js` — MCP protocol handler (JSON-RPC over Streamable HTTP). No external SDK dependency.
- `workers/src/websocket.js` — Durable Object for WebSocket connections. Uses Hibernation API with workspace tags for broadcast.

**Frontend (`public/`):**

- `index.html` + `app.js` + `style.css` — Single-page app with a code editor (CodeMirror) and Mermaid preview. Native WebSocket for real-time updates.
- Hash-based routing: `/#/diagram/:id` to view a specific diagram.

**Auth & workspace model:**

- All access requires user registration/login. Each user gets a unique token and workspace (`user-{username}`).
- No pre-configured API tokens — authentication is entirely user-based.
- WebSocket broadcasts are scoped to workspace via Durable Object tags.
- Registration is protected by Cloudflare Turnstile (human verification).
- Users can regenerate their API token if compromised.

**Infrastructure (Cloudflare):**

- **D1** — SQLite database for diagrams, versions, and users.
- **Durable Objects** — WebSocket connections with Hibernation API.
- **Assets** — Static files served from `public/`.
- **Secrets** — `TURNSTILE_SECRET_KEY` stored via `wrangler secret`.

## Key Configuration

| Setting | Location | Purpose |
|---|---|---|
| `BASE_URL` | `wrangler.toml` [vars] | Public URL for generated links (auto-detected if empty) |
| `TURNSTILE_SITE_KEY` | `wrangler.toml` [vars] | Cloudflare Turnstile site key (public) |
| `TURNSTILE_SECRET_KEY` | `wrangler secret` | Cloudflare Turnstile secret key |

## Database

D1 database `mermaid-studio-db` with tables: `diagrams`, `diagram_versions`, `users`. Schema in `migrations/0001_init.sql`.

## Backup

The original Node.js version is preserved at git tag `v1.0-nodejs`.
