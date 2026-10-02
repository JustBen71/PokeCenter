// Integration fixture: real Socket.IO + the production /client registration, on loopback only.
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { registerNativeClients } from '../../../apps/api/src/native-clients.ts';
const http = createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');
  if (req.url === '/status') return res.end(JSON.stringify(registry.snapshot()));
  res.statusCode = 404; res.end('{}');
});
const io = new Server(http, { transports: ['websocket'], pingInterval: 500, pingTimeout: 1000 });
const registry = registerNativeClients(io, { roomCode: 'test-room', accountsRequired: false }, () => undefined);
http.listen(0, '127.0.0.1', () => console.log(JSON.stringify({ port: http.address().port })));
process.on('SIGTERM', () => io.close(() => process.exit(0)));
