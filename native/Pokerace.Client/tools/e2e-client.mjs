// Run only against the disposable bridge/ROM started by bridges/bizhawk/e2e/run-e2e.ps1.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { Server } from 'socket.io';
import { registerNativeClients } from '../../../apps/api/src/native-clients.ts';

assert.equal(process.env.RUNNER_ENVIRONMENT, 'github-hosted', 'Disposable GitHub runner required');
assert.ok(process.env.POKERACE_BRIDGE_TOKEN);
const fixture = JSON.parse(await readFile(new URL('../../../bridges/bizhawk/e2e/test-config.json', import.meta.url)));
const http = createServer();
const io = new Server(http, { transports: ['websocket'] });
const registry = registerNativeClients(io, { roomCode: 'e2e-room', accountsRequired: false }, () => undefined);
const directory = await mkdtemp(join(tmpdir(), 'pokerace-client-e2e-'));
let child;
let changed = false;
const payload = { domain: fixture.preferredDomain, address: Number(fixture.testAddress) };
async function command(name, values) {
  const result = await registry.sendCommand('e2e-client', {
    type: 'COMMAND', protocolVersion: 1, commandId: randomUUID(), command: 'bridge.' + name, payload: values
  });
  assert.equal(result.ok, true, result.error?.code);
  return result.result;
}
async function readExpected(data) {
  const result = await command('readMemory', { ...payload, length: data.length / 2 });
  assert.equal(result.data.toLowerCase(), data.toLowerCase());
}
try {
  await new Promise(resolve => http.listen(0, '127.0.0.1', resolve));
  const config = join(directory, 'client.json');
  await writeFile(config, JSON.stringify({
    serverUrl: `http://127.0.0.1:${http.address().port}`, allowInsecureLocalServer: true,
    playerId: 'e2e-client', playerName: 'E2E', roomCode: 'e2e-room',
    bridgeHost: '127.0.0.1', bridgePort: Number(process.env.POKERACE_BRIDGE_PORT), allowMemoryWrites: true
  }));
  const dll = fileURLToPath(new URL('../src/Pokerace.Client/bin/Release/net8.0/Pokerace.Client.dll', import.meta.url));
  child = spawn(process.argv[2] ?? 'dotnet', [dll, 'run', '--config', config], { stdio: ['ignore', 'inherit', 'inherit'], windowsHide: true });
  let startError;
  child.on('error', error => { startError = error; });
  const deadline = Date.now() + 30000;
  while (!registry.snapshot().some(s => s.ready && s.bridge?.bridge.connected && s.bridge?.system === fixture.expectedSystemId)) {
    if (startError) throw startError;
    assert.equal(child.exitCode, null, 'Client exited before readiness');
    assert.ok(Date.now() < deadline, 'Client readiness timeout');
    await delay(100);
  }
  await readExpected(fixture.initialBytes);
  changed = true; // Restore even if the write ACK is lost.
  await command('writeMemory', { ...payload, data: fixture.writeBytes });
  await readExpected(fixture.writeBytes);
  await command('writeMemory', { ...payload, data: fixture.initialBytes });
  await readExpected(fixture.initialBytes);
  changed = false;
  console.log('E2E_BIZHAWK_CLIENT_VERIFIED: server -> client -> bridge -> ROM; read/write/read/restore');
} finally {
  try {
    if (changed) { await command('writeMemory', { ...payload, data: fixture.initialBytes }); await readExpected(fixture.initialBytes); }
  } finally {
    if (child && child.exitCode === null) {
      const exited = new Promise(resolve => child.once('exit', resolve));
      child.kill();
      await exited;
    }
    await new Promise(resolve => io.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
}
