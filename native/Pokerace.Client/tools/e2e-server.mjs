// Disposable test server for client E2E: real Socket.IO + the production /client
// registration, plus the HTTP routes the client calls before opening the socket.
// A bare http.createServer() never answers POST /api/rooms/resolve, so the client
// waited 10 s and reported server_timeout: every non-Socket.IO request is answered here.
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { registerNativeClients } from '../../../apps/api/src/native-clients.ts';

export async function startE2EServer({ roomCode, host = '127.0.0.1', port = 0, socket = {} } = {}) {
  if (!roomCode) throw new Error('roomCode required');
  let registry;
  const http = createServer((req, res) => {
    const json = (status, body) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(body)); };
    const path = (req.url ?? '').split('?')[0];
    if (req.method === 'GET' && path === '/health') return json(200, { ok: true });
    if (req.method === 'GET' && path === '/status') return json(200, registry.snapshot());
    if (req.method === 'GET' && path === '/public') return json(200, registry.publicSnapshot());
    if (req.method === 'POST' && path === '/api/rooms/resolve') {
      let body = '';
      req.setEncoding('utf8');
      req.on('data', chunk => { body += chunk; if (body.length > 4096) req.destroy(); });
      req.on('end', () => {
        let code;
        try { code = JSON.parse(body).roomCode; } catch { return json(400, { error: 'invalid json' }); }
        // Same contract as apps/api/src/rooms.ts: wrong code -> 403, otherwise the Socket.IO path.
        return code === roomCode ? json(200, { socketPath: '/socket.io/' }) : json(403, { error: 'room refused' });
      });
      return;
    }
    return json(404, {});
  });
  const io = new Server(http, { transports: ['websocket'], ...socket });
  registry = registerNativeClients(io, { roomCode, accountsRequired: false }, () => undefined);
  await new Promise((resolve, reject) => { http.once('error', reject); http.listen(port, host, resolve); });
  const actual = http.address().port;
  return {
    io, registry, port: actual, url: `http://${host}:${actual}`,
    close: () => new Promise(resolve => io.close(() => resolve()))
  };
}

// CLI used by the .NET tests: prints {"port":N} once the server answers /health.
if (process.argv[1]?.endsWith('e2e-server.mjs')) {
  const roomIndex = process.argv.indexOf('--room');
  const roomCode = roomIndex > 0 ? process.argv[roomIndex + 1] : 'e2e-room';
  const server = await startE2EServer({ roomCode });
  const health = await fetch(`${server.url}/health`);
  if (!health.ok) throw new Error('health check failed');
  console.log(JSON.stringify({ port: server.port }));
  const stop = () => server.close().then(() => process.exit(0));
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
}
