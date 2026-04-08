// Durable Object for WebSocket connections per workspace
// Replaces Socket.IO for real-time diagram updates
// Uses Hibernation API — survives DO eviction

export class WebSocketDO {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request) {
    const url = new URL(request.url);

    // WebSocket upgrade
    if (request.headers.get('Upgrade') === 'websocket') {
      const workspace = url.searchParams.get('workspace') || 'default';
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);

      // Accept with workspace as tag — persists across hibernation
      this.state.acceptWebSocket(server, [workspace]);

      // Send workspace info
      server.send(JSON.stringify({ event: 'workspace:info', data: { workspace } }));

      return new Response(null, { status: 101, webSocket: client });
    }

    // Broadcast message (called from API routes)
    if (request.method === 'POST' && url.pathname === '/broadcast') {
      const { event, data, workspace } = await request.json();
      this.broadcast(event, data, workspace);
      return new Response('ok');
    }

    return new Response('Not found', { status: 404 });
  }

  broadcast(event, data, workspace) {
    const message = JSON.stringify({ event, data });
    // Use getWebSockets(tag) — works even after hibernation
    const sockets = workspace
      ? this.state.getWebSockets(workspace)
      : this.state.getWebSockets();
    for (const ws of sockets) {
      try {
        ws.send(message);
      } catch {
        // Connection is dead, runtime will clean it up
      }
    }
  }

  webSocketMessage(ws, message) {
    // No client-to-server messages expected
  }

  webSocketClose(ws, code, reason, wasClean) {
    // Runtime automatically removes closed sockets from getWebSockets()
  }

  webSocketError(ws, error) {
    ws.close();
  }
}
