using System.Text.Json.Nodes;
using Pokerace.Client.Bridge;
using Pokerace.Client.Commands;
using Pokerace.Client.Configuration;
using Pokerace.Client.Diagnostics;
using Pokerace.Client.Server;
using Xunit;

namespace Pokerace.Client.Tests;

public sealed class ClientTests
{
    internal static JsonObject Command(string command = "bridge.readMemory", string? id = null, JsonObject? payload = null) => new()
    { ["type"] = "COMMAND", ["protocolVersion"] = 1, ["commandId"] = id ?? Guid.NewGuid().ToString("D"), ["command"] = command,
        ["payload"] = payload ?? new() { ["domain"] = "RAM", ["address"] = 256, ["length"] = 4 } };
    [Fact] public async Task RealBridgeProtocolAndTcpReadWriteReadBack()
    {
        await using var fake = new FakeBridgeServer(); await using var bridge = new BridgeClient(fake.Configuration(true), () => FakeBridgeServer.Token);
        await bridge.ConnectAsync(default); await bridge.PingAsync(default);
        Assert.Equal("TEST", await bridge.GetSystemAsync(default));
        Assert.Equal(2, (await bridge.GetMemoryDomainsAsync(default)).Count);
        Assert.Equal("Fixture", (string?)(await bridge.GetGameInfoAsync(default))?["name"]);
        await bridge.WriteMemoryAsync("RAM", 256, new byte[] { 0xde, 0xad, 0xbe, 0xef }, default);
        Assert.Equal(new byte[] { 0xde, 0xad, 0xbe, 0xef }, await bridge.ReadMemoryAsync("RAM", 256, 4, default));
        Assert.Equal(new byte[] { 0xde, 0xad, 0xbe, 0xef }, fake.Memory.Bytes.Skip(256).Take(4));
    }
    [Fact] public async Task WriteProtectionAppliesBelowRouter()
    {
        await using var fake = new FakeBridgeServer(); await using var bridge = new BridgeClient(fake.Configuration(), () => FakeBridgeServer.Token);
        await bridge.ConnectAsync(default);
        var error = await Assert.ThrowsAsync<ClientException>(() => bridge.WriteMemoryAsync("RAM", 0, new byte[] { 1 }, default));
        Assert.Equal("writes_disabled", error.Code); Assert.Equal(0, fake.Memory.Writes);
    }
    [Fact] public async Task ServerCannotEnableWrites()
    {
        await using var fake = new FakeBridgeServer(); await using var bridge = new BridgeClient(fake.Configuration(), () => FakeBridgeServer.Token);
        await bridge.ConnectAsync(default); var router = new CommandRouter(bridge, fake.Configuration());
        var request = Command("bridge.writeMemory", payload: new() { ["domain"] = "RAM", ["address"] = 0, ["data"] = "ab", ["allowMemoryWrites"] = true });
        Assert.Equal("writes_disabled", (await router.RouteAsync(request, default)).ErrorCode); Assert.Equal(0, fake.Memory.Writes);
    }
    [Fact] public async Task ConcurrentDuplicateExecutesOnce()
    {
        await using var fake = new FakeBridgeServer(); await using var bridge = new BridgeClient(fake.Configuration(true), () => FakeBridgeServer.Token);
        await bridge.ConnectAsync(default); var router = new CommandRouter(bridge, fake.Configuration(true));
        var request = Command("bridge.writeMemory", payload: new() { ["domain"] = "RAM", ["address"] = 0, ["data"] = "deadbeef" });
        var results = await Task.WhenAll(Enumerable.Range(0, 20).Select(_ => router.RouteAsync(request, default)));
        Assert.All(results, result => Assert.True(result.Ok)); Assert.Equal(4, fake.Memory.Writes);
        request["payload"]!["data"] = "00112233";
        Assert.Equal("command_id_reused", (await router.RouteAsync(request, default)).ErrorCode); Assert.Equal(4, fake.Memory.Writes);
    }
    [Fact] public async Task FailedWriteIsNotRetried()
    {
        await using var fake = new FakeBridgeServer(); fake.Memory.FailAfterWrites = 2;
        await using var bridge = new BridgeClient(fake.Configuration(true), () => FakeBridgeServer.Token);
        await bridge.ConnectAsync(default); var router = new CommandRouter(bridge, fake.Configuration(true));
        var request = Command("bridge.writeMemory", payload: new() { ["domain"] = "RAM", ["address"] = 0, ["data"] = "deadbeef" });
        Assert.False((await router.RouteAsync(request, default)).Ok);
        fake.Memory.FailAfterWrites = 100;
        Assert.False((await router.RouteAsync(request, default)).Ok); Assert.Equal(2, fake.Memory.Writes);
    }
    [Fact] public async Task CacheFailsClosedInsteadOfEvictingCommands()
    {
        await using var fake = new FakeBridgeServer(); await using var bridge = new BridgeClient(fake.Configuration(), () => FakeBridgeServer.Token);
        await bridge.ConnectAsync(default); var router = new CommandRouter(bridge, fake.Configuration(), 1);
        var first = Command("bridge.ping"); Assert.True((await router.RouteAsync(first, default)).Ok);
        Assert.Equal("command_cache_full", (await router.RouteAsync(Command("bridge.ping"), default)).ErrorCode);
        Assert.True((await router.RouteAsync(first, default)).Ok);
    }
    [Theory] [InlineData("bad")] [InlineData("00000000-0000-0000-0000-000000000000")]
    public async Task RejectsInvalidCommandId(string id)
    {
        await using var fake = new FakeBridgeServer(); await using var bridge = new BridgeClient(fake.Configuration(), () => FakeBridgeServer.Token);
        var result = await new CommandRouter(bridge, fake.Configuration()).RouteAsync(Command(id: id), default);
        Assert.Equal("invalid_command_id", result.ErrorCode);
    }
    [Fact] public async Task RejectsUnknownClientProtocol()
    {
        await using var fake = new FakeBridgeServer(); await using var bridge = new BridgeClient(fake.Configuration(), () => FakeBridgeServer.Token);
        var request = Command(); request["protocolVersion"] = 2;
        Assert.Equal("protocol_mismatch", (await new CommandRouter(bridge, fake.Configuration()).RouteAsync(request, default)).ErrorCode);
    }
    [Fact] public async Task RejectsWrongBridgeToken()
    {
        await using var fake = new FakeBridgeServer(); await using var bridge = new BridgeClient(fake.Configuration(), () => new string('a', 32));
        Assert.Equal("unauthorized", (await Assert.ThrowsAsync<ClientException>(() => bridge.ConnectAsync(default))).Code); Assert.False(bridge.IsConnected);
    }
    [Theory] [InlineData("ROM", 0, 1, "read_only")] [InlineData("missing", 0, 1, "unknown_domain")] [InlineData("RAM", 65536, 1, "invalid_range")]
    public async Task PropagatesBridgeErrors(string domain, long address, int length, string expected)
    {
        await using var fake = new FakeBridgeServer(); await using var bridge = new BridgeClient(fake.Configuration(true), () => FakeBridgeServer.Token);
        await bridge.ConnectAsync(default);
        Assert.Equal(expected, (await Assert.ThrowsAsync<ClientException>(() => bridge.WriteMemoryAsync(domain, address, new byte[length], default))).Code);
    }
    [Theory] [InlineData("http://example.com")] [InlineData("https://user:secret@example.com")] [InlineData("https://example.com/?token=secret")] [InlineData("https://example.com/path")]
    public void RejectsUnsafeServerConfiguration(string url)
    { Assert.Throws<ClientException>(() => new ClientConfiguration { ServerUrl = url, PlayerName = "Test", RoomCode = "room", AllowInsecureLocalServer = true }.Validate()); }
    [Fact] public void RejectsNonLoopbackBridge() => Assert.Throws<ClientException>(() => new ClientConfiguration { BridgeHost = "192.168.1.2", PlayerName = "Test", RoomCode = "room" }.Validate());
    [Fact] public void ConfigurationRoundtripPreservesIdentityAndDefaultWriteProtection()
    {
        var folder = Path.Combine(Path.GetTempPath(), "pokerace-tests-" + Guid.NewGuid()); Directory.CreateDirectory(folder);
        var path = Path.Combine(folder, "client.json");
        try
        {
            var original = new ClientConfiguration { PlayerName = "Test", RoomCode = "room" };
            ConfigurationStore.Save(path, original); var loaded = ConfigurationStore.Load(path);
            Assert.Equal(original.PlayerId, loaded.PlayerId); Assert.False(loaded.AllowMemoryWrites);
            Assert.DoesNotContain("sessionToken", File.ReadAllText(path));
            if (!OperatingSystem.IsWindows()) Assert.Equal(UnixFileMode.UserRead | UnixFileMode.UserWrite, File.GetUnixFileMode(path));
        }
        finally { File.Delete(path); Directory.Delete(folder); }
    }
    [Fact] public async Task DoctorNeverWritesEvenWhenWritesAllowed()
    {
        await using var fake = new FakeBridgeServer(); await using var server = await FakeServer.StartAsync();
        var config = fake.Configuration(true, server.Port);
        await using var bridge = new BridgeClient(config, () => FakeBridgeServer.Token); await using var connection = new ServerConnection(config);
        var output = new StringWriter();
        Assert.Equal(0, await DoctorCommand.RunAsync(config, bridge, connection, output, default));
        Assert.Equal(0, fake.Memory.Writes); Assert.Contains("Client operational", output.ToString());
        Assert.DoesNotContain(FakeBridgeServer.Token, output.ToString()); Assert.DoesNotContain(config.RoomCode, output.ToString());
    }
    [Theory]
    [InlineData("{\"serverUrl\":\"https://example.com\",\"roomCode\":\"room\",\"playerName\":\"Test\"}")]
    [InlineData("{\"serverUrl\":\"https://example.com\",\"roomCode\":\"room\",\"playerName\":null,\"playerId\":\"p-test\"}")]
    [InlineData("{\"serverUrl\":\"https://example.com\",\"roomCode\":\"room\",\"playerName\":\"Test\",\"playerId\":\"p-test\",\"adminToken\":\"never-store\"}")]
    public void RejectsMissingIdentityNullNameAndAdministratorSecret(string json)
    {
        var path = Path.GetTempFileName();
        try { File.WriteAllText(path, json); Assert.Equal("invalid_configuration", Assert.Throws<ClientException>(() => ConfigurationStore.Load(path)).Code); }
        finally { File.Delete(path); }
    }
    [Fact] public async Task DoctorReportsBridgeUnavailable()
    {
        int port; await using (var fake = new FakeBridgeServer()) port = fake.Port;
        var config = new ClientConfiguration { BridgePort = port, PlayerName = "Test", RoomCode = "room" };
        await using var bridge = new BridgeClient(config, () => FakeBridgeServer.Token); await using var connection = new ServerConnection(config);
        var output = new StringWriter();
        Assert.Equal(1, await DoctorCommand.RunAsync(config, bridge, connection, output, default)); Assert.Contains("[FAIL] Bridge TCP/protocol", output.ToString());
    }
    [Fact] public async Task RejectsUnknownServerProtocol()
    {
        await using var fake = new FakeBridgeServer(); await using var server = await FakeServer.StartAsync(); server.ProtocolVersion = 2;
        await using var connection = new ServerConnection(fake.Configuration(serverPort: server.Port));
        Assert.Equal("protocol_mismatch", (await Assert.ThrowsAsync<ClientException>(() => connection.ConnectAsync(default))).Code);
    }
}
