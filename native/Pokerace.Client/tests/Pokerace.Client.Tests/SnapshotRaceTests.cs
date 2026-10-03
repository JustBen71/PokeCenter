using System.Text.Json.Nodes;
using Pokerace.Client.Bridge;
using Pokerace.Client.Configuration;
using Pokerace.Client.Diagnostics;
using Pokerace.Client.Runtime;
using Pokerace.Client.Server;
using Xunit;

namespace Pokerace.Client.Tests;

public sealed class SnapshotRaceTests
{
    [Fact] public async Task ConnectionDuringInitialStatusSendIsNotLost()
    {
        await using var bridge = new GatedBridge();
        await using var server = new GatedServer(bridge);
        using var cancel = new CancellationTokenSource(TimeSpan.FromSeconds(5));
        var runtime = new ClientRuntime(new ClientConfiguration(), bridge, server, new ClientLog(TextWriter.Null), TimeSpan.FromMilliseconds(10));
        var running = runtime.RunAsync(cancel.Token);
        try { await server.ConnectedStatus.Task.WaitAsync(TimeSpan.FromSeconds(2)); }
        finally { cancel.Cancel(); await running; }
    }

    private sealed class GatedBridge : IBridgeClient
    {
        internal readonly TaskCompletionSource Release = new(TaskCreationOptions.RunContinuationsAsynchronously);
        internal readonly TaskCompletionSource SecondPoll = new(TaskCreationOptions.RunContinuationsAsynchronously);
        private int polls;
        public bool IsConnected { get; private set; }
        public async Task ConnectAsync(CancellationToken cancellation) { await Release.Task.WaitAsync(cancellation); IsConnected = true; }
        public Task<BridgeStatus> GetStatusAsync(CancellationToken cancellation)
        {
            if (Interlocked.Increment(ref polls) == 2) SecondPoll.TrySetResult();
            return Task.FromResult(new BridgeStatus(true, true, "NES", 1));
        }
        public Task DisconnectAsync() { IsConnected = false; return Task.CompletedTask; }
        public Task PingAsync(CancellationToken cancellation) => Task.CompletedTask;
        public Task<string?> GetSystemAsync(CancellationToken cancellation) => throw new NotSupportedException();
        public Task<JsonObject?> GetGameInfoAsync(CancellationToken cancellation) => throw new NotSupportedException();
        public Task<IReadOnlyList<MemoryDomainInfo>> GetMemoryDomainsAsync(CancellationToken cancellation) => throw new NotSupportedException();
        public Task<byte[]> ReadMemoryAsync(string domain, long address, int length, CancellationToken cancellation) => throw new NotSupportedException();
        public Task WriteMemoryAsync(string domain, long address, ReadOnlyMemory<byte> data, CancellationToken cancellation) => throw new NotSupportedException();
        public ValueTask DisposeAsync() => ValueTask.CompletedTask;
    }
    private sealed class GatedServer(GatedBridge bridge) : IServerConnection
    {
        internal readonly TaskCompletionSource ConnectedStatus = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public bool IsConnected { get; private set; }
        public Task ConnectAsync(CancellationToken cancellation) { IsConnected = true; return Task.CompletedTask; }
        public Task DisconnectAsync() { IsConnected = false; return Task.CompletedTask; }
        public async Task SendAsync(string type, JsonObject payload, CancellationToken cancellation)
        {
            if (type != "BRIDGE_STATUS") return;
            if ((bool)payload["bridge"]!["connected"]!) { ConnectedStatus.TrySetResult(); return; }
            bridge.Release.TrySetResult();
            // Hold the first send until the manager has published its first
            // connected snapshot and started polling again. No timing guess.
            await bridge.SecondPoll.Task.WaitAsync(cancellation);
        }
        public async Task<ServerMessage> ReceiveAsync(CancellationToken cancellation) { await Task.Delay(Timeout.Infinite, cancellation); throw new InvalidOperationException(); }
        public Task SendTransportAckAsync(string id, JsonObject payload, CancellationToken cancellation) => throw new NotSupportedException();
        public ValueTask DisposeAsync() => ValueTask.CompletedTask;
    }
}
