using System.Diagnostics;
using Pokerace.Client.Bridge;
using Pokerace.Client.Diagnostics;
using Pokerace.Client.Server;
using Xunit;

namespace Pokerace.Client.Tests;

public sealed class SocketIoCompatibilityTests
{
    [Fact] public async Task DoctorAndHeartbeatUseActualSocketIoAndProductionNamespace()
    {
        var root = new DirectoryInfo(AppContext.BaseDirectory);
        while (root != null && !File.Exists(Path.Combine(root.FullName, "package.json"))) root = root.Parent;
        Assert.NotNull(root);
        var start = new ProcessStartInfo("node") { WorkingDirectory = root.FullName, UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true };
        start.ArgumentList.Add("--import"); start.ArgumentList.Add("tsx");
        start.ArgumentList.Add("native/Pokerace.Client/tools/socketio-fixture.mjs");
        using var process = Process.Start(start)!;
        var errors = process.StandardError.ReadToEndAsync();
        try
        {
            var line = await process.StandardOutput.ReadLineAsync().WaitAsync(TimeSpan.FromSeconds(15));
            Assert.True(line != null, process.HasExited ? await errors : "Socket.IO fixture did not start.");
            var port = (int)System.Text.Json.Nodes.JsonNode.Parse(line)!["port"]!;
            await using var fake = new FakeBridgeServer();
            var config = fake.Configuration(serverPort: port);
            await using var bridge = new BridgeClient(config, () => FakeBridgeServer.Token);
            await using var server = new ServerConnection(config);
            var output = new StringWriter();
            Assert.Equal(0, await DoctorCommand.RunAsync(config, bridge, server, output, default));
            // Wait for namespace cleanup before the same identity connects again.
            using var http = new HttpClient();
            for (var i = 0; i < 100; i++)
            {
                if (await http.GetStringAsync($"http://127.0.0.1:{port}/status") == "[]") break;
                await Task.Delay(20);
            }
            await server.ConnectAsync(default);
            await server.SendAsync("HELLO", ServerProtocol.Hello(config, new(true, true, "GBA", 1)), default);
            var ready = await server.ReceiveAsync(default); Assert.Equal("SERVER_STATUS", ready.Type);
            await server.SendAsync("GAME_STATE", (await GameAdapterTests.SampleObservationAsync()).ToMessage(), default);
            var gameDeadline = DateTime.UtcNow.AddSeconds(5);
            while (true)
            {
                var rows = System.Text.Json.Nodes.JsonNode.Parse(await http.GetStringAsync($"http://127.0.0.1:{port}/public"))!;
                if (rows.AsArray().Count > 0 && rows[0]?["gameState"] is { } game)
                {
                    Assert.Equal(12500, (int)game["trainer"]!["money"]!);
                    Assert.Single(game["party"]!.AsArray());
                    Assert.Equal(2, (int)game["gameStateVersion"]!);
                    Assert.Equal("gen3-party-v1", game["party"]![0]!["artifact"]!["format"]!.GetValue<string>());
                    Assert.Equal(200, game["party"]![0]!["artifact"]!["raw"]!.GetValue<string>().Length);
                    break;
                }
                Assert.True(DateTime.UtcNow < gameDeadline, "Production API did not accept C# GameAdapter state.");
                await Task.Delay(20);
            }
            using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(30));
            var receiving = server.ReceiveAsync(timeout.Token); // services Engine.IO ping/pong while no application event is sent
            // Assert observed protocol traffic, not a 300 ms timing margin on
            // a loaded Windows runner. A client that ignores ping cannot pass.
            var deadline = DateTime.UtcNow.AddSeconds(15);
            while (true)
            {
                var observed = System.Text.Json.Nodes.JsonNode.Parse(await http.GetStringAsync($"http://127.0.0.1:{port}/pongs"))!;
                if ((int)observed["pongs"]! >= 2) break;
                Assert.True(DateTime.UtcNow < deadline, "Two Engine.IO pong packets were not received.");
                if (receiving.IsCompleted) await receiving;
                await Task.Delay(50);
            }
            Assert.False(receiving.IsCompleted);
            timeout.Cancel(); await Assert.ThrowsAnyAsync<OperationCanceledException>(() => receiving);
            Assert.Equal(0, fake.Memory.Writes);
        }
        finally
        {
            if (!process.HasExited) process.Kill(entireProcessTree: true);
            await process.WaitForExitAsync(); await errors;
        }
    }
}
