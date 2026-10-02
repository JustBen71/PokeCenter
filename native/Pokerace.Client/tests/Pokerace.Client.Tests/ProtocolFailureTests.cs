using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Text.Json.Nodes;
using Pokerace.Client.Bridge;
using Pokerace.Client.Commands;
using Pokerace.Client.Server;
using Xunit;

namespace Pokerace.Client.Tests;

public sealed class ProtocolFailureTests
{
    [Theory] [InlineData("json")] [InlineData("missing_id")] [InlineData("version")]
    [InlineData("oversized")] [InlineData("unknown_reply")]
    public async Task InvalidBridgeHandshakeFailsCleanly(string fault)
    {
        await using var peer = new ScriptedBridge(request => fault switch
        {
            "json" => "{invalid",
            "missing_id" => "{\"ok\":true,\"type\":\"hello\",\"protocolVersion\":1}",
            "version" => new JsonObject { ["id"] = request["id"]!.DeepClone(), ["ok"] = true, ["type"] = "hello", ["protocolVersion"] = 2 }.ToJsonString(),
            "oversized" => new string('x', 65537),
            _ => new JsonObject { ["id"] = request["id"]!.DeepClone(), ["ok"] = true, ["type"] = "unknown", ["protocolVersion"] = 1 }.ToJsonString()
        });
        await using var fake = new FakeBridgeServer();
        await using var bridge = new BridgeClient(fake.Configuration() with { BridgePort = peer.Port }, () => FakeBridgeServer.Token);
        await Assert.ThrowsAsync<ClientException>(() => bridge.ConnectAsync(default)); Assert.False(bridge.IsConnected);
    }
    [Fact] public async Task InterruptedWriteHasCachedUnknownOutcome()
    {
        var writeRequests = 0;
        await using var peer = new ScriptedBridge(request =>
        {
            if ((string?)request["type"] == "hello") return new JsonObject { ["id"] = request["id"]!.DeepClone(), ["ok"] = true, ["type"] = "hello", ["protocolVersion"] = 1 }.ToJsonString();
            Interlocked.Increment(ref writeRequests);
            return null; // peer loses the connection after receiving the write, before returning its result
        });
        await using var fake = new FakeBridgeServer(); var config = fake.Configuration(true) with { BridgePort = peer.Port };
        await using var bridge = new BridgeClient(config, () => FakeBridgeServer.Token);
        await bridge.ConnectAsync(default); var router = new CommandRouter(bridge, config);
        var command = ClientTests.Command("bridge.writeMemory", payload: new() { ["domain"] = "RAM", ["address"] = 0, ["data"] = "deadbeef" });
        var result = await router.RouteAsync(command, default);
        Assert.False(result.Ok); Assert.False(bridge.IsConnected);
        Assert.Equal(result, await router.RouteAsync(command, default)); Assert.Equal(1, writeRequests);
    }
    [Theory] [InlineData("json")] [InlineData("event")] [InlineData("oversized")]
    public async Task InvalidServerFramesFailCleanly(string fault)
    {
        await using var fake = new FakeBridgeServer(); await using var server = await FakeServer.StartAsync();
        await using var connection = new ServerConnection(fake.Configuration(serverPort: server.Port));
        await connection.ConnectAsync(default);
        var frame = fault switch { "json" => "42/client,[invalid", "event" => "45/client,[]", _ => "42/client,[\"COMMAND\",{\"type\":\"COMMAND\",\"padding\":\"" + new string('x', 65536) + "\"}]" };
        var sending = server.SendRawAsync(frame);
        await Assert.ThrowsAsync<ClientException>(() => connection.ReceiveAsync(default)); await sending;
    }
    [Fact] public async Task MissingPayloadReturnsCorrelatedError()
    {
        await using var fake = new FakeBridgeServer(); await using var bridge = new BridgeClient(fake.Configuration(), () => FakeBridgeServer.Token);
        var request = ClientTests.Command(); request.Remove("payload");
        var result = await new CommandRouter(bridge, fake.Configuration()).RouteAsync(request, default);
        Assert.False(result.Ok); Assert.Equal((string?)request["commandId"], result.CommandId); Assert.Equal("invalid_command", result.ErrorCode);
    }

    private sealed class ScriptedBridge : IAsyncDisposable
    {
        private readonly TcpListener listener = new(IPAddress.Loopback, 0);
        private readonly CancellationTokenSource shutdown = new();
        private readonly Task run;
        public int Port => ((IPEndPoint)listener.LocalEndpoint).Port;
        public ScriptedBridge(Func<JsonObject, string?> respond)
        { listener.Start(); run = ServeAsync(respond); }
        private async Task ServeAsync(Func<JsonObject, string?> respond)
        {
            try
            {
                using var client = await listener.AcceptTcpClientAsync(shutdown.Token);
                using var reader = new StreamReader(client.GetStream());
                while (true)
                {
                    var request = await reader.ReadLineAsync(shutdown.Token); if (request == null) return;
                    var response = respond(BridgeProtocol.Parse(request)); if (response == null) return;
                    await client.GetStream().WriteAsync(Encoding.UTF8.GetBytes(response + "\n"), shutdown.Token);
                }
            }
            catch (Exception e) when (e is IOException or OperationCanceledException or SocketException) { }
        }
        public async ValueTask DisposeAsync() { shutdown.Cancel(); listener.Stop(); await run; shutdown.Dispose(); }
    }
}
