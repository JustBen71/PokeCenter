using Pokerace.Client.Bridge;
using Pokerace.Client.Configuration;
using Pokerace.Client.Server;

namespace Pokerace.Client.Diagnostics;

public static class DoctorCommand
{
    public static async Task<int> RunAsync(ClientConfiguration config, IBridgeClient bridge, IServerConnection server, TextWriter output, CancellationToken cancellation)
    {
        await output.WriteLineAsync("Pokérace Client Doctor");
        var stage = "Configuration";
        try
        {
            config.Validate();
            await output.WriteLineAsync("[OK] Configuration loaded\n[OK] Server URL valid");
            stage = "Bridge TCP/protocol";
            await bridge.ConnectAsync(cancellation);
            await bridge.PingAsync(cancellation);
            var status = await bridge.GetStatusAsync(cancellation);
            await output.WriteLineAsync("[OK] Bridge TCP reachable\n[OK] Bridge protocol v1\n[OK] Emulator: BizHawk");
            stage = "System / memory domains";
            var system = await bridge.GetSystemAsync(cancellation);
            await bridge.GetGameInfoAsync(cancellation);
            if (status.GameLoaded)
            {
                var domains = await bridge.GetMemoryDomainsAsync(cancellation);
                await output.WriteLineAsync("[OK] System: " + System.Text.Json.JsonSerializer.Serialize(system) + "\n[OK] Memory domains accessible: " + domains.Count);
            }
            else await output.WriteLineAsync("[SKIP] No game loaded; memory domains unavailable");
            await output.WriteLineAsync("[SKIP] Memory writes: doctor never writes RAM");
            stage = "Server WebSocket/protocol";
            await server.ConnectAsync(cancellation);
            await server.SendAsync("HELLO", ServerProtocol.Hello(config, status), cancellation);
            using var deadline = CancellationTokenSource.CreateLinkedTokenSource(cancellation);
            deadline.CancelAfter(TimeSpan.FromSeconds(5));
            var accepted = await server.ReceiveAsync(deadline.Token);
            if (accepted.Type != "SERVER_STATUS") throw new ClientException("invalid_protocol", "Expected HELLO acknowledgement.");
            ServerProtocol.CheckVersion(accepted.Payload);
            if (!BridgeProtocol.Boolean(accepted.Payload, "ready")) throw new ClientException("server_rejected", "Server did not accept HELLO.");
            await output.WriteLineAsync("[OK] Server WebSocket reachable\n[OK] Server protocol v1\nClient operational.");
            return 0;
        }
        catch (Exception e)
        {
            await output.WriteLineAsync("[FAIL] " + stage + " (" + (e is ClientException ce ? ce.Code : "connection_failed") + ")");
            return 1;
        }
        finally { await server.DisconnectAsync(); await bridge.DisconnectAsync(); }
    }
}
