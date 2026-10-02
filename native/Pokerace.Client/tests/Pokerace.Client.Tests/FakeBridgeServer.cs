using Pokerace.BizHawkBridge.Core;
using Pokerace.BizHawkBridge.Tests;
using Pokerace.Client.Configuration;

namespace Pokerace.Client.Tests;

public sealed class FakeBridgeServer : IAsyncDisposable
{
    public const string Token = "client-tests-012345678901234567890123456789";
    private readonly TcpBridgeServer server;
    public FakeEmulatorHost Host { get; } = new();
    public FakeMemoryDomain Memory => (FakeMemoryDomain)Host.Domains[0];
    public int Port => server.Port;
    public FakeBridgeServer(int port = 0)
    {
        Host.Domains.Add(new FakeMemoryDomain { Name = "ROM", Writable = false });
        server = new(port, Token, new BridgeService(Host), new ImmediateDispatcher());
        server.Start();
    }
    public ClientConfiguration Configuration(bool writes = false, int serverPort = 1) => new()
    {
        PlayerId = "p-test", PlayerName = "Tester", RoomCode = "test-room",
        BridgePort = Port, AllowMemoryWrites = writes,
        ServerUrl = "http://127.0.0.1:" + serverPort, AllowInsecureLocalServer = true, HeartbeatSeconds = 1
    };
    public async ValueTask DisposeAsync() { server.Dispose(); await server.Completion.WaitAsync(TimeSpan.FromSeconds(5)); }
}
