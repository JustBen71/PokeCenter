// Integration fixture: real Socket.IO + the production /client registration, on loopback only.
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { registerNativeClients } from '../../../apps/api/src/native-clients.ts';
let pongs = 0;
const http = createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');
  if (req.url === '/status') return res.end(JSON.stringify(registry.snapshot()));
  if (req.url === '/public') return res.end(JSON.stringify(registry.publicSnapshot()));
  if (req.url === '/pongs') return res.end(JSON.stringify({ pongs }));
  res.statusCode = 404; res.end('{}');
});
const io = new Server(http, { transports: ['websocket'], pingInterval: 500, pingTimeout: 10000 });
io.engine.on('connection', socket => {
  pongs = 0;
  socket.on('packet', packet => { if (packet.type === 'pong') pongs++; });
});
const registry = registerNativeClients(io, { roomCode: 'test-room', accountsRequired: false }, () => undefined);
http.listen(0, '127.0.0.1', () => console.log(JSON.stringify({ port: http.address().port })));
process.on('SIGTERM', () => io.close(() => process.exit(0)));
