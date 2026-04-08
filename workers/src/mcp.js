// MCP (Model Context Protocol) handler for Cloudflare Workers
// Implements Streamable HTTP transport for MCP over standard fetch API
// Replaces mcp-http-server.js

import { createDiagram, getDiagram, updateDiagram, deleteDiagram, listDiagrams } from './diagrams.js';
import { getTemplates } from './templates.js';

// JSON-RPC helpers
function jsonRpcResponse(id, result) {
  return { jsonrpc: '2.0', id, result };
}

function jsonRpcError(id, code, message) {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

// MCP server info
const SERVER_INFO = {
  name: 'mermaid-studio',
  version: '1.0.0',
};

const CAPABILITIES = {
  tools: {},
};

// Tool definitions
const TOOLS = [
  {
    name: 'create_diagram',
    description: 'Create a new Mermaid diagram',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Diagram name' },
        type: { type: 'string', description: 'Diagram type: flowchart, swimlane, stateDiagram, sequence, classDiagram, gantt, erDiagram, pie, mindmap' },
        code: { type: 'string', description: 'Mermaid diagram code' },
      },
      required: ['name', 'code'],
    },
  },
  {
    name: 'update_diagram',
    description: 'Update an existing diagram',
    inputSchema: {
      type: 'object',
      properties: {
        diagram_id: { type: 'string', description: 'Diagram ID' },
        code: { type: 'string', description: 'New Mermaid diagram code' },
        name: { type: 'string', description: 'New name' },
      },
      required: ['diagram_id', 'code'],
    },
  },
  {
    name: 'get_diagram',
    description: 'Get diagram details',
    inputSchema: {
      type: 'object',
      properties: {
        diagram_id: { type: 'string', description: 'Diagram ID' },
      },
      required: ['diagram_id'],
    },
  },
  {
    name: 'list_diagrams',
    description: 'List all diagrams in the workspace',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'delete_diagram',
    description: 'Delete a diagram',
    inputSchema: {
      type: 'object',
      properties: {
        diagram_id: { type: 'string', description: 'Diagram ID' },
      },
      required: ['diagram_id'],
    },
  },
  {
    name: 'export_diagram',
    description: 'Export a diagram (returns diagram code and export URL)',
    inputSchema: {
      type: 'object',
      properties: {
        diagram_id: { type: 'string', description: 'Diagram ID' },
        format: { type: 'string', enum: ['svg', 'png'], description: 'Export format' },
      },
      required: ['diagram_id'],
    },
  },
  {
    name: 'get_templates',
    description: 'Get available diagram templates',
    inputSchema: { type: 'object', properties: {} },
  },
];

// Execute a tool call
async function executeTool(db, workspace, baseUrl, broadcastFn, name, args) {
  switch (name) {
    case 'create_diagram': {
      const diagram = await createDiagram(db, workspace, {
        name: args.name,
        type: args.type || 'flowchart',
        code: args.code,
      });
      const url = `${baseUrl}/#/diagram/${diagram.id}`;
      await broadcastFn('diagram:created', { ...diagram, url }, workspace);
      return JSON.stringify({ diagram_id: diagram.id, url, name: diagram.name, type: diagram.type, workspace }, null, 2);
    }
    case 'update_diagram': {
      const diagram = await updateDiagram(db, workspace, args.diagram_id, {
        code: args.code,
        name: args.name,
      });
      if (!diagram) return 'Error: Diagram not found';
      const url = `${baseUrl}/#/diagram/${diagram.id}`;
      await broadcastFn('diagram:updated', { ...diagram, url }, workspace);
      return JSON.stringify({ diagram_id: diagram.id, url, workspace }, null, 2);
    }
    case 'get_diagram': {
      const diagram = await getDiagram(db, workspace, args.diagram_id);
      if (!diagram) return 'Error: Diagram not found';
      return JSON.stringify({
        name: diagram.name, type: diagram.type, code: diagram.code,
        url: `${baseUrl}/#/diagram/${diagram.id}`, workspace,
        createdAt: diagram.createdAt, updatedAt: diagram.updatedAt,
      }, null, 2);
    }
    case 'list_diagrams': {
      const list = await listDiagrams(db, workspace);
      return JSON.stringify(list.map(d => ({
        diagram_id: d.id, name: d.name, type: d.type,
        url: `${baseUrl}/#/diagram/${d.id}`, updatedAt: d.updatedAt,
      })), null, 2);
    }
    case 'delete_diagram': {
      const ok = await deleteDiagram(db, workspace, args.diagram_id);
      if (ok) await broadcastFn('diagram:deleted', { id: args.diagram_id }, workspace);
      return ok ? 'Diagram deleted successfully' : 'Error: Diagram not found';
    }
    case 'export_diagram': {
      const diagram = await getDiagram(db, workspace, args.diagram_id);
      if (!diagram) return 'Error: Diagram not found';
      const fmt = args.format || 'svg';
      return JSON.stringify({
        diagram_id: diagram.id, name: diagram.name, code: diagram.code, format: fmt,
        export_url: `${baseUrl}/api/diagrams/${diagram.id}/export?format=${fmt}&workspace=${workspace}`,
        view_url: `${baseUrl}/#/diagram/${diagram.id}`,
      }, null, 2);
    }
    case 'get_templates': {
      const templates = getTemplates();
      return JSON.stringify(Object.entries(templates).map(([key, t]) => ({
        type: key, name: t.name, code: t.code,
      })), null, 2);
    }
    default:
      return `Error: Unknown tool "${name}"`;
  }
}

// Handle a single JSON-RPC request
async function handleRpcRequest(db, workspace, baseUrl, broadcastFn, sessionId, req) {
  const { id, method, params } = req;

  switch (method) {
    case 'initialize':
      return jsonRpcResponse(id, {
        protocolVersion: '2025-03-26',
        serverInfo: SERVER_INFO,
        capabilities: CAPABILITIES,
      });

    case 'notifications/initialized':
      return null; // No response for notifications

    case 'tools/list':
      return jsonRpcResponse(id, { tools: TOOLS });

    case 'tools/call': {
      const { name, arguments: args } = params;
      try {
        const result = await executeTool(db, workspace, baseUrl, broadcastFn, name, args || {});
        return jsonRpcResponse(id, {
          content: [{ type: 'text', text: result }],
        });
      } catch (e) {
        return jsonRpcResponse(id, {
          content: [{ type: 'text', text: `Error: ${e.message}` }],
          isError: true,
        });
      }
    }

    case 'ping':
      return jsonRpcResponse(id, {});

    default:
      return jsonRpcError(id, -32601, `Method not found: ${method}`);
  }
}

// MCP session store (per-isolate, cleared on restart — acceptable for stateless Workers)
const sessions = new Map();

export async function handleMcpRequest(request, db, workspace, baseUrl, broadcastFn) {
  const method = request.method;

  if (method === 'DELETE') {
    const sessionId = request.headers.get('mcp-session-id');
    if (sessionId && sessions.has(sessionId)) {
      sessions.delete(sessionId);
      return new Response('', { status: 204 });
    }
    return Response.json({ error: 'No session.' }, { status: 400 });
  }

  if (method === 'GET') {
    // SSE endpoint for server-to-client notifications (keep-alive)
    const sessionId = request.headers.get('mcp-session-id');
    if (!sessionId || !sessions.has(sessionId)) {
      return Response.json({ error: 'No session. Send POST /mcp first.' }, { status: 400 });
    }

    // Return a simple SSE stream that stays open
    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    const encoder = new TextEncoder();

    // Send initial comment to keep connection alive
    writer.write(encoder.encode(': keepalive\n\n'));

    // Store writer for potential future server-initiated messages
    sessions.get(sessionId).sseWriter = writer;

    return new Response(readable, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Mcp-Session-Id': sessionId,
      },
    });
  }

  if (method === 'POST') {
    const body = await request.json();
    const existingSessionId = request.headers.get('mcp-session-id');

    let sessionId = existingSessionId;
    if (existingSessionId && sessions.has(existingSessionId)) {
      // Existing session
    } else {
      // New session
      sessionId = crypto.randomUUID();
      sessions.set(sessionId, { workspace, createdAt: Date.now() });
    }

    // Handle batch or single request
    const isBatch = Array.isArray(body);
    const requests = isBatch ? body : [body];
    const responses = [];

    for (const req of requests) {
      const resp = await handleRpcRequest(db, workspace, baseUrl, broadcastFn, sessionId, req);
      if (resp !== null) responses.push(resp);
    }

    if (responses.length === 0) {
      return new Response('', {
        status: 202,
        headers: { 'Mcp-Session-Id': sessionId },
      });
    }

    const result = isBatch ? responses : responses[0];
    return Response.json(result, {
      headers: {
        'Content-Type': 'application/json',
        'Mcp-Session-Id': sessionId,
      },
    });
  }

  return Response.json({ error: 'Method not allowed' }, { status: 405 });
}
