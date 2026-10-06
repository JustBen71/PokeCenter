// Run only against the disposable bridge/ROM started by bridges/bizhawk/e2e/run-e2e.ps1.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, copyFile, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { startE2EServer } from './e2e-server.mjs';

assert.equal(process.env.RUNNER_ENVIRONMENT, 'github-hosted', 'Disposable GitHub runner required');
assert.ok(process.env.POKERACE_BRIDGE_TOKEN);
const fixture = JSON.parse(await readFile(new URL('../../../bridges/bizhawk/e2e/test-config.json', import.meta.url)));
// Free port chosen by the OS, then passed verbatim to the client configuration.
const server = await startE2EServer({ roomCode: 'e2e-room' });
const { registry } = server;
const directory = await mkdtemp(join(tmpdir(), 'pokerace-client-e2e-'));
let child;
const launcher = process.argv.includes('--launcher');
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
  assert.equal((await fetch(`${server.url}/health`)).status, 200, 'Test server not ready');
  const config = join(directory, 'client.json');
  await writeFile(config, JSON.stringify({
    serverUrl: server.url, allowInsecureLocalServer: true,
    playerId: 'e2e-client', playerName: 'E2E', roomCode: 'e2e-room',
    bridgeHost: '127.0.0.1', bridgePort: Number(process.env.POKERACE_BRIDGE_PORT), allowMemoryWrites: true
  }));
  const dll = fileURLToPath(new URL('../src/Pokerace.Client/bin/Release/net8.0/Pokerace.Client.dll', import.meta.url));
  if (launcher) {
    await mkdir(join(directory, 'launcher'));
    await copyFile(fileURLToPath(new URL('../../../bridges/bizhawk/.runtime/bizhawk.zip', import.meta.url)), join(directory, 'launcher', 'bizhawk.zip'));
  }
  const executable = launcher ? fileURLToPath(new URL('../artifacts/launcher-win-x64/Pokerace.Client.exe', import.meta.url)) : process.argv[2] ?? 'dotnet';
  const args = launcher ? ['play', '--rom', fileURLToPath(new URL('../../../bridges/bizhawk/.runtime/pokerace-test.nes', import.meta.url)), '--config', config] : [dll, 'run', '--config', config];
  child = spawn(executable, args, { stdio: [launcher ? 'pipe' : 'ignore', 'inherit', 'inherit'], windowsHide: true });
  let startError;
  child.on('error', error => { startError = error; });
  const deadline = Date.now() + (launcher ? 120000 : 30000);
  let joined = false;
  while (!registry.snapshot().some(s => s.ready && s.bridge?.bridge.connected && s.bridge?.system === fixture.expectedSystemId && s.game?.adapter.status === 'unsupported_system')) {
    if (startError) throw startError;
    assert.equal(child.exitCode, null, 'Client exited before readiness');
    if (!joined && registry.snapshot().some(s => s.ready)) { joined = true; console.log(`E2E_CLIENT_JOINED ${server.url}`); }
    assert.ok(Date.now() < deadline, joined ? 'Client joined but bridge/adapter readiness timeout' : `Client readiness timeout: no client joined ${server.url}`);
    await delay(100);
  }
  assert.equal(registry.publicSnapshot()[0].gameState, null, 'NES must not activate Pokemon reads');
  console.log('E2E_ADAPTER_UNSUPPORTED_SYSTEM_VERIFIED');
  await readExpected(fixture.initialBytes);
  changed = true; // Restore even if the write ACK is lost.
  await command('writeMemory', { ...payload, data: fixture.writeBytes });
  await readExpected(fixture.writeBytes);
  await command('writeMemory', { ...payload, data: fixture.initialBytes });
  await readExpected(fixture.initialBytes);
  changed = false;
  console.log(launcher ? 'E2E_LAUNCHER_MEMORY_VERIFIED' : 'E2E_BIZHAWK_CLIENT_VERIFIED: server -> client -> bridge -> ROM; read/write/read/restore');
} finally {
  try {
    if (changed) { await command('writeMemory', { ...payload, data: fixture.initialBytes }); await readExpected(fixture.initialBytes); }
  } finally {
    if (child && child.exitCode === null) {
      const exited = new Promise(resolve => child.once('exit', resolve));
      if (launcher) child.stdin.end('\n'); else child.kill();
      const shutdownTimeout = new AbortController();
      try {
        await Promise.race([exited, delay(25000, null, { signal: shutdownTimeout.signal }).then(() => { throw new Error('Launcher shutdown timeout'); })]);
        if (launcher) { assert.equal(child.exitCode, 0); console.log('E2E_LAUNCHER_VERIFIED: single executable + real BizHawk + client + ROM + shutdown'); }
      } finally { shutdownTimeout.abort(); if (child.exitCode === null && child.signalCode === null) child.kill(); }
    }
    await server.close();
    await rm(directory, { recursive: true, force: true });
  }
}
