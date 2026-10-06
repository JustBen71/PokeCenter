using System.Text.Json.Nodes;
using Pokerace.Client.Bridge;
using Pokerace.Client.Diagnostics;
using Pokerace.Client.Runtime;
using Pokerace.Client.Server;
using Xunit;

namespace Pokerace.Client.Tests;

public sealed class GameEventTests
{
    private static string TempFile() => Path.Combine(Path.GetTempPath(), "pokerace-outbox-" + Guid.NewGuid().ToString("N"), "game-events.json");

    [Fact] public void OutboxSurvivesARestartAndForgetsAcknowledgedEvents()
    {
        var path = TempFile();
        try
        {
            var outbox = new GameEventOutbox(path);
            var first = outbox.Enqueue("TRAINER_VICTORY", new() { ["moneyBefore"] = 100, ["moneyAfter"] = 400, ["baseReward"] = 300 })!;
            var second = outbox.Enqueue("STEPS_CHANGED", new() { ["absolute"] = 1200 })!;
            Assert.Equal("GAME_EVENT", (string?)first["type"]); Assert.Equal(1, (int?)first["eventVersion"]);
            Assert.Matches(@"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$", (string?)first["observedAt"]);
            Assert.NotEqual((string?)first["eventId"], (string?)second["eventId"]);
            // Client restart: the same events, with the same ids, are still waiting.
            var restarted = new GameEventOutbox(path);
            Assert.Equal(new[] { (string?)first["eventId"], (string?)second["eventId"] }, restarted.Pending().Select(e => (string?)e["eventId"]));
            Assert.True(restarted.Acknowledge((string)first["eventId"]!)); Assert.False(restarted.Acknowledge("unknown"));
            Assert.Equal((string?)second["eventId"], (string?)Assert.Single(new GameEventOutbox(path).Pending())["eventId"]);
            Assert.DoesNotContain("address", File.ReadAllText(path));
        }
        finally { Directory.Delete(Path.GetDirectoryName(path)!, true); }
    }

    [Fact] public void OutboxIsBounded()
    {
        var outbox = new GameEventOutbox(null);
        for (var i = 0; i < GameEventOutbox.Capacity; i++) Assert.NotNull(outbox.Enqueue("STEPS_CHANGED", new() { ["absolute"] = i }));
        Assert.Null(outbox.Enqueue("STEPS_CHANGED", new() { ["absolute"] = 999 }));
    }

    [Fact] public async Task UnacknowledgedEventIsResentWithTheSameIdAfterReconnectionThenForgotten()
    {
        await using var fake = new FakeBridgeServer(); await using var server = await FakeServer.StartAsync();
        var config = fake.Configuration(serverPort: server.Port);
        await using var bridge = new BridgeClient(config, () => FakeBridgeServer.Token);
        await using var connection = new ServerConnection(config);
        var outbox = new GameEventOutbox(null);
        var offline = outbox.Enqueue("TRAINER_VICTORY", new() { ["moneyBefore"] = 100, ["moneyAfter"] = 400, ["baseReward"] = 300 })!;
        using var cancellation = new CancellationTokenSource(TimeSpan.FromSeconds(20));
        var runtime = new ClientRuntime(config, bridge, connection, new ClientLog(TextWriter.Null), TimeSpan.FromMilliseconds(30), TimeSpan.FromMilliseconds(30), outbox: outbox);
        var running = runtime.RunAsync(cancellation.Token);
        try
        {
            // Recorded while offline: sent right after the connection handshake.
            var sent = await server.WaitForAsync(m => (string?)m["type"] == "GAME_EVENT");
            Assert.Equal((string?)offline["eventId"], (string?)sent["eventId"]);
            // Lost ACK: after the reconnection the very same event comes back.
            server.DropConnections();
            await RuntimeTests.UntilAsync(() => server.Connections >= 2);
            var resent = await server.WaitForAsync(m => (string?)m["type"] == "GAME_EVENT");
            Assert.Equal(sent.ToJsonString(), resent.ToJsonString());
            // An event recorded while connected is sent on the next tick, once.
            var live = runtime.Outbox.Enqueue("STEPS_CHANGED", new() { ["absolute"] = 42 })!;
            Assert.Equal((string?)live["eventId"], (string?)(await server.WaitForAsync(m => (string?)m["type"] == "GAME_EVENT"))["eventId"]);
            await server.SendRawAsync(FakeServer.Event("GAME_EVENT_ACK", new() { ["type"] = "GAME_EVENT_ACK", ["protocolVersion"] = 1, ["eventId"] = offline["eventId"]!.DeepClone(), ["ok"] = true }));
            await server.SendRawAsync(FakeServer.Event("GAME_EVENT_ACK", new() { ["type"] = "GAME_EVENT_ACK", ["protocolVersion"] = 1, ["eventId"] = live["eventId"]!.DeepClone(), ["ok"] = false, ["error"] = new JsonObject { ["code"] = "capability_missing" } }));
            await RuntimeTests.UntilAsync(() => runtime.Outbox.Pending().Count == 0);
            Assert.True(runtime.Status.ServerConnected, "an event ACK is a known message, not a protocol error");
        }
        finally { cancellation.Cancel(); await running.WaitAsync(TimeSpan.FromSeconds(5)); }
    }
}
