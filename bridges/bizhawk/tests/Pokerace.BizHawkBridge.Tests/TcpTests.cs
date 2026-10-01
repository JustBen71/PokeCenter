using System.Net;
using System.Net.Sockets;
using System.Text;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Pokerace.BizHawkBridge.Core;
using Pokerace.BizHawkBridge.Cli;
using Xunit;

namespace Pokerace.BizHawkBridge.Tests;

public sealed class TcpTests
{
    private const string Token = "test-token-012345678901234567890123456789";
    private static TcpBridgeServer Start(FakeEmulatorHost host, TimeSpan? timeout = null, IEmulatorDispatcher? dispatcher = null)
    {
        var server = new TcpBridgeServer(0, Token, new BridgeService(host), dispatcher ?? new ImmediateDispatcher(), timeout);
        server.Start(); return server;
    }
    private static object Hello(string token = Token, int version = 1) => new { type = "hello", protocolVersion = version, sessionToken = token };
    private static async Task<BridgeClient> Connect(TcpBridgeServer server)
    {
        var client = new BridgeClient(); await client.ConnectAsync(server.Port); await client.CallAsync(Hello()); return client;
    }
    private static async Task<JObject> Exchange(TcpClient client, string text)
    {
        await client.GetStream().WriteAsync(Encoding.UTF8.GetBytes(text + "\n"));
        return await Response(client);
    }
    private static async Task<JObject> Response(TcpClient client)
    {
        using var reader = new StreamReader(client.GetStream(), Encoding.UTF8, false, 1024, true);
        return JObject.Parse((await reader.ReadLineAsync().WaitAsync(TimeSpan.FromSeconds(5)))!);
    }
    [Fact] public async Task RealTcpWriteReadAndRestore()
    {
        var host = new FakeEmulatorHost(); using var server = Start(host); using var client = await Connect(server);
        Assert.Equal("pong", (string?)(await client.CallAsync(new { type = "ping" }))["type"]);
        var write = await client.CallAsync(new { type = "writeMemory", domain = "RAM", address = 123, data = "abcdef" });
        Assert.True((bool)write["verified"]!);
        Assert.Equal("abcdef", (string?)(await client.CallAsync(new { type = "readMemory", domain = "RAM", address = 123, length = 3 }))["data"]);
        await client.CallAsync(new { type = "writeMemory", domain = "RAM", address = 123, data = "000000" });
        Assert.Equal(new byte[3], ((FakeMemoryDomain)host.Domains[0]).Bytes.Skip(123).Take(3));
    }
    [Theory] [InlineData("readMemory")] [InlineData("writeMemory")]
    public async Task CannotAccessMemoryWithoutHandshake(string command)
    {
        var host = new FakeEmulatorHost(); using var server = Start(host); using var client = new TcpClient();
        await client.ConnectAsync(IPAddress.Loopback, server.Port);
        var result = await Exchange(client, JsonConvert.SerializeObject(new { id = "one", type = command, domain = "RAM", address = 0, length = 1, data = "ab" }));
        Assert.Equal("handshake_required", (string?)result["error"]?["code"]);
        Assert.Equal(0, ((FakeMemoryDomain)host.Domains[0]).Writes);
    }
    [Theory] [InlineData("bad", 1, "unauthorized")] [InlineData(Token, 2, "protocol_mismatch")]
    public async Task RejectsBadHandshake(string token, int version, string code)
    {
        using var server = Start(new FakeEmulatorHost()); using var client = new TcpClient(); await client.ConnectAsync(IPAddress.Loopback, server.Port);
        Assert.Equal(code, (string?)(await Exchange(client, JsonConvert.SerializeObject(Hello(token, version))))["error"]?["code"]);
    }
    [Fact] public async Task MalformedRequestDoesNotKillAuthenticatedSession()
    {
        using var server = Start(new FakeEmulatorHost()); using var client = new TcpClient(); await client.ConnectAsync(IPAddress.Loopback, server.Port);
        await Exchange(client, JsonConvert.SerializeObject(Hello()));
        Assert.False((bool)(await Exchange(client, "{"))["ok"]!);
        Assert.Equal("pong", (string?)(await Exchange(client, "{\"type\":\"ping\"}"))["type"]);
    }
    [Fact] public async Task FragmentedAndCoalescedLines()
    {
        using var server = Start(new FakeEmulatorHost()); using var client = new TcpClient(); await client.ConnectAsync(IPAddress.Loopback, server.Port);
        var hello = JsonConvert.SerializeObject(Hello()) + "\n{\"type\":\"ping\"}\n";
        await client.GetStream().WriteAsync(Encoding.UTF8.GetBytes(hello.Substring(0, 8)));
        await client.GetStream().WriteAsync(Encoding.UTF8.GetBytes(hello.Substring(8)));
        using var reader = new StreamReader(client.GetStream());
        Assert.True((bool)JObject.Parse((await reader.ReadLineAsync().WaitAsync(TimeSpan.FromSeconds(5)))!)["ok"]!);
        Assert.Equal("pong", (string?)JObject.Parse((await reader.ReadLineAsync().WaitAsync(TimeSpan.FromSeconds(5)))!)["type"]);
    }
    [Fact] public async Task RejectsOversizedLine()
    {
        using var server = Start(new FakeEmulatorHost()); using var client = new TcpClient(); await client.ConnectAsync(IPAddress.Loopback, server.Port);
        Assert.Equal("request_too_large", (string?)(await Exchange(client, new string('a', Protocol.MaxBytes + 1)))["error"]?["code"]);
    }
    [Fact] public async Task RejectsInvalidUtf8()
    {
        using var server = Start(new FakeEmulatorHost()); using var client = new TcpClient(); await client.ConnectAsync(IPAddress.Loopback, server.Port);
        await client.GetStream().WriteAsync(new byte[] { 0xff, 10 });
        Assert.Equal("invalid_utf8", (string?)(await Response(client))["error"]?["code"]);
    }
    [Fact] public async Task RejectsSecondClient()
    {
        using var server = Start(new FakeEmulatorHost()); using var first = await Connect(server);
        using var second = new TcpClient(); await second.ConnectAsync(IPAddress.Loopback, server.Port);
        Assert.Equal("busy", (string?)(await Response(second))["error"]?["code"]);
        Assert.Equal("pong", (string?)(await first.CallAsync(new { type = "ping" }))["type"]);
    }
    [Fact] public async Task IdleConnectionHasDeadline()
    {
        using var server = Start(new FakeEmulatorHost(), TimeSpan.FromMilliseconds(150));
        using var client = new TcpClient(); await client.ConnectAsync(IPAddress.Loopback, server.Port);
        Assert.Equal("timeout", (string?)(await Response(client))["error"]?["code"]);
    }
    [Fact] public async Task ShutdownClosesPendingRead()
    {
        using var server = Start(new FakeEmulatorHost()); using var client = await Connect(server);
        server.Dispose(); await server.Completion.WaitAsync(TimeSpan.FromSeconds(5));
    }
    [Fact] public async Task DoctorWritesAndRestoresExplicitRange()
    {
        var host = new FakeEmulatorHost(); var memory = (FakeMemoryDomain)host.Domains[0];
        new byte[] { 0x11, 0x22, 0x33, 0x44 }.CopyTo(memory.Bytes, 256);
        using var server = Start(host);
        var previous = Environment.GetEnvironmentVariable("POKERACE_BRIDGE_TOKEN");
        try
        {
            Environment.SetEnvironmentVariable("POKERACE_BRIDGE_TOKEN", Token);
            var output = new StringWriter();
            var code = await Program.RunAsync(new[] { "doctor", "--port", server.Port.ToString(), "--domain", "RAM", "--address", "0x100", "--data", "deadbeef", "--expect", "11223344", "--write-test" }, output);
            Assert.Equal(0, code); Assert.Contains("[OK] RESTORE + READ_BACK 11223344", output.ToString());
            Assert.Equal(new byte[] { 0x11, 0x22, 0x33, 0x44 }, memory.Bytes.Skip(256).Take(4));
        }
        finally { Environment.SetEnvironmentVariable("POKERACE_BRIDGE_TOKEN", previous); }
    }
    [Fact] public async Task DoctorDefaultNeverWrites()
    {
        var host = new FakeEmulatorHost(); using var server = Start(host);
        var previous = Environment.GetEnvironmentVariable("POKERACE_BRIDGE_TOKEN");
        try
        {
            Environment.SetEnvironmentVariable("POKERACE_BRIDGE_TOKEN", Token);
            var output = new StringWriter();
            Assert.Equal(0, await Program.RunAsync(new[] { "doctor", "--port", server.Port.ToString() }, output));
            Assert.Contains("[SKIP] WRITE_MEMORY", output.ToString()); Assert.Equal(0, ((FakeMemoryDomain)host.Domains[0]).Writes);
        }
        finally { Environment.SetEnvironmentVariable("POKERACE_BRIDGE_TOKEN", previous); }
    }
    [Theory] [InlineData(false)] [InlineData(true)]
    public async Task DoctorReportsFailedWriteAndRestorationOutcome(bool partialFailure)
    {
        var host = new FakeEmulatorHost(); var memory = (FakeMemoryDomain)host.Domains[0];
        memory.IgnoreWrites = !partialFailure;
        memory.FailAfterWrites = partialFailure ? 2 : int.MaxValue;
        using var server = Start(host);
        var previous = Environment.GetEnvironmentVariable("POKERACE_BRIDGE_TOKEN");
        try
        {
            Environment.SetEnvironmentVariable("POKERACE_BRIDGE_TOKEN", Token);
            var output = new StringWriter();
            var code = await Program.RunAsync(new[] { "doctor", "--port", server.Port.ToString(), "--domain", "RAM", "--address", "0", "--data", "deadbeef", "--write-test" }, output);
            Assert.Equal(1, code);
            Assert.Contains(partialFailure ? "[FAIL] RESTORE" : "[OK] RESTORE + READ_BACK 00000000", output.ToString());
            Assert.DoesNotContain(Token, output.ToString());
        }
        finally { Environment.SetEnvironmentVariable("POKERACE_BRIDGE_TOKEN", previous); }
    }
    [Fact] public async Task DoctorReportsUnavailableBridge()
    {
        var socket = new TcpListener(IPAddress.Loopback, 0); socket.Start(); var port = ((IPEndPoint)socket.LocalEndpoint).Port; socket.Stop();
        var previous = Environment.GetEnvironmentVariable("POKERACE_BRIDGE_TOKEN");
        try
        {
            Environment.SetEnvironmentVariable("POKERACE_BRIDGE_TOKEN", Token);
            var output = new StringWriter();
            Assert.Equal(1, await Program.RunAsync(new[] { "doctor", "--port", port.ToString() }, output));
            Assert.Contains("Bridge non joignable", output.ToString());
        }
        finally { Environment.SetEnvironmentVariable("POKERACE_BRIDGE_TOKEN", previous); }
    }
}
