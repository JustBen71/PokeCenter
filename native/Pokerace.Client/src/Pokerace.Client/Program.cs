using Pokerace.Client.Bridge;
using Pokerace.Client.Configuration;
using Pokerace.Client.Diagnostics;
using Pokerace.Client.Runtime;
using Pokerace.Client.Server;

namespace Pokerace.Client;

public static class Program
{
    public static async Task<int> Main(string[] args)
    {
        using var cancellation = new CancellationTokenSource();
        Console.CancelKeyPress += (_, e) => { e.Cancel = true; cancellation.Cancel(); };
        try
        {
            if (args.Length == 0 || args[0] is "--help" or "help")
            {
                Console.WriteLine("Pokerace.Client configure|doctor|run [--config <path>]\nBridge token: POKERACE_BRIDGE_TOKEN environment variable.");
                return 0;
            }
            if (args.Length != 1 && (args.Length != 3 || args[1] != "--config")) throw new ClientException("invalid_arguments", "Expected [--config <path>].");
            var path = args.Length == 3 ? args[2] : ConfigurationStore.DefaultPath;
            if (args[0] == "configure")
            {
                if (File.Exists(path)) throw new ClientException("configuration_exists", "Configuration exists; edit it explicitly to preserve identity.");
                Console.Write("Server URL (https://...): "); var url = Console.ReadLine() ?? "";
                Console.Write("Player name: "); var name = Console.ReadLine() ?? "";
                Console.Write("Room code: "); var room = Console.ReadLine() ?? "";
                ConfigurationStore.Save(path, new() { ServerUrl = url, PlayerName = name, RoomCode = room });
                Console.WriteLine("Configuration saved. Memory writes disabled."); return 0;
            }
            if (args[0] is not ("doctor" or "run")) throw new ClientException("invalid_arguments", "Unknown command.");
            var configuration = ConfigurationStore.Load(path);
            await using var bridge = new BridgeClient(configuration, () => Environment.GetEnvironmentVariable("POKERACE_BRIDGE_TOKEN"));
            await using var server = new ServerConnection(configuration);
            if (args[0] == "doctor") return await DoctorCommand.RunAsync(configuration, bridge, server, Console.Out, cancellation.Token);
            await new ClientRuntime(configuration, bridge, server, new ClientLog(Console.Out)).RunAsync(cancellation.Token);
            return 0;
        }
        catch (OperationCanceledException) when (cancellation.IsCancellationRequested) { return 0; }
        catch (ClientException e) { Console.Error.WriteLine("[FAIL] " + e.Code + ": " + e.Message); return 1; }
        catch (Exception) { Console.Error.WriteLine("[FAIL] Client failed; check configuration and connectivity."); return 1; }
    }
}
