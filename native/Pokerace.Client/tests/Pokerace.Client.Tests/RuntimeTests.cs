using System.Text.Json.Nodes;
using Pokerace.Client.Bridge;
using Pokerace.Client.Diagnostics;
using Pokerace.Client.Runtime;
using Pokerace.Client.Server;
using Xunit;

namespace Pokerace.Client.Tests;

public sealed class RuntimeTests
{
    internal static async Task UntilAsync(Func<bool> condition)
    {
        using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(10));
        while (!condition()) await Task.Delay(20, deadline.Token);
    }
    [Fact] public async Task ReconnectsServerAndReplaysCachedAckWithoutSecondWrite()
    {
        await using var fake = new FakeBridgeServer(); await using var server = await FakeServer.StartAsync();
        var config = fake.Configuration(true, server.Port);
        await using var bridge = new BridgeClient(config, () => FakeBridgeServer.Token);
        await using var connection = new ServerConnection(config);
        var logs = new StringWriter();
        using var cancellation = new CancellationTokenSource(TimeSpan.FromSeconds(20));
        var runtime = new ClientRuntime(config, bridge, connection, new ClientLog(logs), TimeSpan.FromMilliseconds(30), TimeSpan.FromMilliseconds(30));
        var running = runtime.RunAsync(cancellation.Token);
        try
        {
            var hello = await server.WaitForAsync(m => (string?)m["type"] == "HELLO");
            Assert.Equal(1, (int?)hello["protocolVersion"]); Assert.Null(hello["emulator"]?["version"]);
            await UntilAsync(() => bridge.IsConnected);
            var id = Guid.NewGuid().ToString("D");
            var command = ClientTests.Command("bridge.writeMemory", id, new() { ["domain"] = "RAM", ["address"] = 123, ["data"] = "deadbeef" });
            await server.SendAsync(command);
            var ack = await server.WaitForAsync(m => (string?)m["commandId"] == id);
            Assert.True((bool)ack["ok"]!); Assert.Equal(4, fake.Memory.Writes);
            await server.PingAsync(); await UntilAsync(() => server.Pongs > 0);
            server.DropConnections();
            await UntilAsync(() => server.Connections >= 2);
            await server.WaitForAsync(m => (string?)m["type"] == "HELLO");
            await server.WaitForAsync(m => (string?)m["type"] == "BRIDGE_STATUS");
            await server.WaitForAsync(m => (string?)m["type"] == "HEARTBEAT");
            await server.SendAsync(command);
            var duplicate = await server.WaitForAsync(m => (string?)m["commandId"] == id);
            Assert.Equal(ack.ToJsonString(), duplicate.ToJsonString()); Assert.Equal(4, fake.Memory.Writes);
        }
        finally { cancellation.Cancel(); await running.WaitAsync(TimeSpan.FromSeconds(5)); }
        Assert.DoesNotContain(config.RoomCode, logs.ToString()); Assert.DoesNotContain(FakeBridgeServer.Token, logs.ToString());
        Assert.DoesNotContain("deadbeef", logs.ToString());
    }
    [Fact] public async Task BridgeRestartIsReportedAndClientSurvives()
    {
        var fake = new FakeBridgeServer(); var port = fake.Port;
        await using var server = await FakeServer.StartAsync();
        var config = fake.Configuration(serverPort: server.Port);
        await using var bridge = new BridgeClient(config, () => FakeBridgeServer.Token);
        await using var connection = new ServerConnection(config);
        using var cancellation = new CancellationTokenSource(TimeSpan.FromSeconds(20));
        var running = new ClientRuntime(config, bridge, connection, new ClientLog(TextWriter.Null), TimeSpan.FromMilliseconds(40), TimeSpan.FromMilliseconds(30)).RunAsync(cancellation.Token);
        FakeBridgeServer? restarted = null;
        try
        {
            await server.WaitForAsync(m => (string?)m["type"] == "BRIDGE_STATUS" && (bool?)m["bridge"]?["connected"] == true);
            await fake.DisposeAsync();
            await server.WaitForAsync(m => (string?)m["type"] == "BRIDGE_STATUS" && (bool?)m["bridge"]?["connected"] == false);
            Assert.False(running.IsCompleted);
            restarted = new FakeBridgeServer(port); restarted.Host.SystemId = "SECOND";
            await server.WaitForAsync(m => (string?)m["type"] == "BRIDGE_STATUS" && (bool?)m["bridge"]?["connected"] == true && (string?)m["system"] == "SECOND");
            var command = ClientTests.Command(); await server.SendAsync(command);
            Assert.True((bool)(await server.WaitForAsync(m => (string?)m["commandId"] == (string?)command["commandId"]))["ok"]!);
        }
        finally
        {
            cancellation.Cancel(); await running.WaitAsync(TimeSpan.FromSeconds(5));
            await fake.DisposeAsync(); if (restarted != null) await restarted.DisposeAsync();
        }
    }
    [Fact] public async Task GameCloseAndReloadAreReportedWithoutRestartingClient()
    {
        await using var fake = new FakeBridgeServer(); await using var server = await FakeServer.StartAsync();
        var config = fake.Configuration(serverPort: server.Port);
        await using var bridge = new BridgeClient(config, () => FakeBridgeServer.Token);
        await using var connection = new ServerConnection(config);
        using var cancellation = new CancellationTokenSource(TimeSpan.FromSeconds(15));
        var running = new ClientRuntime(config, bridge, connection, new ClientLog(TextWriter.Null), TimeSpan.FromMilliseconds(40)).RunAsync(cancellation.Token);
        try
        {
            await server.WaitForAsync(m => (string?)m["type"] == "BRIDGE_STATUS" && (bool?)m["bridge"]?["gameLoaded"] == true);
            fake.Host.IsGameLoaded = false; fake.Host.SystemId = null;
            await server.WaitForAsync(m => (string?)m["type"] == "BRIDGE_STATUS" && (bool?)m["bridge"]?["gameLoaded"] == false);
            fake.Host.IsGameLoaded = true; fake.Host.SystemId = "NDS";
            await server.WaitForAsync(m => (string?)m["type"] == "BRIDGE_STATUS" && (string?)m["system"] == "NDS");
        }
        finally { cancellation.Cancel(); await running.WaitAsync(TimeSpan.FromSeconds(5)); }
    }
}
