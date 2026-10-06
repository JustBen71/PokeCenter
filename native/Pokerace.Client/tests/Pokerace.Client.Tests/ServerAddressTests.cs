using System.Diagnostics;
using System.Net;
using System.Net.Sockets;
using System.Text.Json.Nodes;
using Pokerace.Client.Bridge;
using Pokerace.Client.Configuration;
using Pokerace.Client.Diagnostics;
using Pokerace.Client.Launcher;
using Pokerace.Client.Runtime;
using Pokerace.Client.Server;
using Xunit;

namespace Pokerace.Client.Tests;

// Server address building, connection error causes and the E2E test server join.
// Regression for the BizHawk E2E "Client readiness timeout": the E2E server never
// answered POST /api/rooms/resolve, so the client always ended in server_timeout.
public sealed class ServerAddressTests
{
    [Theory]
    [InlineData("127.0.0.1", "http://127.0.0.1")]
    [InlineData("127.0.0.1:3000", "http://127.0.0.1:3000")]
    [InlineData("localhost", "http://localhost")]
    [InlineData("localhost:3000", "http://localhost:3000")]
    [InlineData("http://127.0.0.1", "http://127.0.0.1")]
    [InlineData("http://127.0.0.1:3000", "http://127.0.0.1:3000")]
    [InlineData("http://127.0.0.1:3000/", "http://127.0.0.1:3000")]
    [InlineData("https://example.local", "https://example.local")]
    [InlineData("https://pokerace.example.com", "https://pokerace.example.com")]
    [InlineData("88.184.14.248:8080", "http://88.184.14.248:8080")]
    [InlineData("HTTP://LOCALHOST:3000", "http://localhost:3000")]
    [InlineData("[::1]:3000", "http://[::1]:3000")]
    public void AddressesAreNormalizedOnceWithoutLosingThePort(string typed, string expected)
    {
        var url = LaunchOptions.NormalizeServerUrl(typed);
        Assert.Equal(expected, url);
        // Idempotent: normalizing again must not add a second scheme or drop the port.
        Assert.Equal(url, LaunchOptions.NormalizeServerUrl(url));
        new ClientConfiguration { ServerUrl = url!, PlayerName = "Ben", RoomCode = "salon" }.Validate();
    }

    [Theory]
    [InlineData("127.0.0.1:abc")]
    [InlineData("127.0.0.1:70000")]
    [InlineData("http://http://127.0.0.1")]
    [InlineData("http://127.0.0.1/socket.io/")]
    [InlineData("http://user:pass@127.0.0.1")]
    [InlineData("http://127.0.0.1?room=x")]
    [InlineData("ws://127.0.0.1")]
    [InlineData("127.0.0 .1")]
    [InlineData("   ")]
    [InlineData(null)]
    public void InvalidAddressesAreRejected(string? typed) => Assert.Null(LaunchOptions.NormalizeServerUrl(typed));

    [Theory]
    [InlineData("http://127.0.0.1", 3000, "http://127.0.0.1:3000")]
    [InlineData("http://127.0.0.1:3000", 3000, "http://127.0.0.1:3000")]
    [InlineData("127.0.0.1:8080", 3000, "http://127.0.0.1:3000")]
    [InlineData("http://127.0.0.1:3000", 80, "http://127.0.0.1")]
    [InlineData("https://example.local", 8443, "https://example.local:8443")]
    public void PortReplacesTheExistingOneInsteadOfBeingAppended(string server, int port, string expected) =>
        Assert.Equal(expected, LaunchOptions.WithPort(server, port));

    // "host:port" typed in the form fills the port field instead of falling back to 80 (see LaunchFormTests).
    [Fact] public void TypedPortIsSplitFromTheAddress() =>
        Assert.Equal(("http://127.0.0.1", 47500), LaunchFields.Split(LaunchOptions.NormalizeServerUrl("127.0.0.1:47500")!));

    [Fact] public void EveryErrorCodeHasItsOwnHint()
    {
        const string url = "http://127.0.0.1:3000";
        var hints = new[] { "server_not_found", "server_refused", "server_timeout", "server_unreachable", "server_rejected", "invalid_configuration" }
            .Select(code => ConnectionErrors.Hint(code, url)).ToArray();
        Assert.Equal(hints.Length, hints.Distinct().Count());
        Assert.Contains("introuvable", hints[0]);
        Assert.Contains("refusée", hints[1]);
        Assert.Contains("Pas de réponse", hints[2]);
        Assert.Contains("salon", hints[4]);
        Assert.All(hints.Take(4), hint => Assert.Contains(url, hint));
        Assert.Equal("invalid_configuration", ConnectionErrors.Code(new ClientException("invalid_configuration", "x")));
        Assert.Equal("server_unreachable", ConnectionErrors.Code(new HttpRequestException("x")));
        Assert.Equal("transport_error", ConnectionErrors.Code(new IOException("x")));
    }

    [Fact] public async Task ClosedPortIsReportedAsRefused()
    {
        var listener = new TcpListener(IPAddress.Loopback, 0); listener.Start();
        var port = ((IPEndPoint)listener.LocalEndpoint).Port; listener.Stop();
        await using var server = new ServerConnection(Config($"http://127.0.0.1:{port}"));
        var error = await Assert.ThrowsAnyAsync<Exception>(() => server.ConnectAsync(default));
        Assert.Equal("server_refused", ConnectionErrors.Code(error));
    }

    [Fact] public async Task UnansweredRoomResolveIsReportedAsTimeout()
    {
        // Accepts TCP but never answers HTTP: exactly what the old E2E server did.
        var listener = new TcpListener(IPAddress.Loopback, 0); listener.Start();
        var accepted = new List<TcpClient>();
        var accepting = Task.Run(async () => { try { while (true) accepted.Add(await listener.AcceptTcpClientAsync()); } catch (Exception) { } });
        try
        {
            await using var server = new ServerConnection(Config($"http://127.0.0.1:{((IPEndPoint)listener.LocalEndpoint).Port}"));
            using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(1));
            var error = await Assert.ThrowsAnyAsync<Exception>(() => server.ConnectAsync(timeout.Token));
            Assert.Equal("server_timeout", ConnectionErrors.Code(error));
        }
        finally { listener.Stop(); await accepting; foreach (var client in accepted) client.Dispose(); }
    }

    [Fact] public async Task RealClientJoinsTheE2EServerOnThePortChosenByTheTest()
    {
        using var fixture = await NodeE2EServer.StartAsync("e2e-room");
        await using var fake = new FakeBridgeServer();
        // The address goes through the launcher normalization, as a player would type it.
        var config = fake.Configuration(serverPort: fixture.Port) with
        { ServerUrl = LaunchOptions.NormalizeServerUrl($"127.0.0.1:{fixture.Port}")!, RoomCode = "e2e-room", PlayerId = "e2e-client" };
        Assert.Equal($"http://127.0.0.1:{fixture.Port}", config.ServerUrl);
        await using var bridge = new BridgeClient(config, () => FakeBridgeServer.Token);
        await using var connection = new ServerConnection(config);
        var logs = new StringWriter();
        using var cancellation = new CancellationTokenSource(TimeSpan.FromSeconds(30));
        var running = new ClientRuntime(config, bridge, connection, new ClientLog(logs), TimeSpan.FromMilliseconds(50), TimeSpan.FromMilliseconds(50)).RunAsync(cancellation.Token);
        try
        {
            var deadline = DateTime.UtcNow.AddSeconds(15);
            while (true)
            {
                var rows = JsonNode.Parse(await fixture.Http.GetStringAsync("/status"))!.AsArray();
                if (rows.Any(r => (string?)r?["playerId"] == "e2e-client" && (bool?)r?["ready"] == true && (bool?)r?["bridge"]?["bridge"]?["connected"] == true)) break;
                Assert.True(DateTime.UtcNow < deadline, "Client did not become READY on the E2E server.\n" + logs);
                await Task.Delay(100);
            }
            Assert.DoesNotContain("server_timeout", logs.ToString());
        }
        finally { cancellation.Cancel(); try { await running.WaitAsync(TimeSpan.FromSeconds(5)); } catch (OperationCanceledException) { } }
    }

    [Fact] public async Task WrongRoomCodeIsReportedAsRejectedNotTimeout()
    {
        using var fixture = await NodeE2EServer.StartAsync("e2e-room");
        await using var server = new ServerConnection(Config($"http://127.0.0.1:{fixture.Port}") with { RoomCode = "mauvais-code" });
        var error = await Assert.ThrowsAsync<ClientException>(() => server.ConnectAsync(default));
        Assert.Equal("server_rejected", ConnectionErrors.Code(error));
    }

    private static ClientConfiguration Config(string url) => new()
    { ServerUrl = url, PlayerId = "p-test", PlayerName = "Tester", RoomCode = "test-room", AllowInsecureLocalServer = true };
}

// Starts native/Pokerace.Client/tools/e2e-server.mjs and always stops it.
internal sealed class NodeE2EServer : IDisposable
{
    private readonly Process process;
    public int Port { get; }
    public HttpClient Http { get; }
    private NodeE2EServer(Process process, int port)
    { this.process = process; Port = port; Http = new HttpClient { BaseAddress = new Uri($"http://127.0.0.1:{port}") }; }
    public static async Task<NodeE2EServer> StartAsync(string room)
    {
        var root = new DirectoryInfo(AppContext.BaseDirectory);
        while (root != null && !File.Exists(Path.Combine(root.FullName, "package.json"))) root = root.Parent;
        Assert.NotNull(root);
        var start = new ProcessStartInfo("node") { WorkingDirectory = root.FullName, UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true };
        foreach (var arg in new[] { "--import", "tsx", "native/Pokerace.Client/tools/e2e-server.mjs", "--room", room }) start.ArgumentList.Add(arg);
        var process = Process.Start(start)!;
        var errors = process.StandardError.ReadToEndAsync();
        try
        {
            var line = await process.StandardOutput.ReadLineAsync().WaitAsync(TimeSpan.FromSeconds(20));
            if (line == null) throw new InvalidOperationException("E2E server did not start: " + await errors);
            return new NodeE2EServer(process, (int)JsonNode.Parse(line)!["port"]!);
        }
        catch { if (!process.HasExited) process.Kill(entireProcessTree: true); process.Dispose(); throw; }
    }
    public void Dispose()
    {
        Http.Dispose();
        if (!process.HasExited) process.Kill(entireProcessTree: true);
        process.WaitForExit(5000); process.Dispose();
    }
}
