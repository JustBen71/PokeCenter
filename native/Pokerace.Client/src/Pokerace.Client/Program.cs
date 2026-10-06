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
            if (args.Length == 0 || args[0] == "play")
                return await Launcher.PlayerLauncher.RunAsync(args.Skip(args.Length == 0 ? 0 : 1).ToArray(), cancellation.Token);
            if (args[0] is "--help" or "help")
            {
                Console.WriteLine("Pokerace.Client play [--rom <path>] [--config <path>] [--port <port>]\nNo arguments: same as play (connection form, then BizHawk and the client). Windows and Linux.\nPokerace.Client configure|doctor [--config <path>]\nPokerace.Client run [--config <path>] [--rom <path>]   (--rom: the ROM loaded in BizHawk, required to read the game outside play)\nBridge token for doctor/run: POKERACE_BRIDGE_TOKEN environment variable.");
                return 0;
            }
            var (path, rom) = ParseOptions(args);
            if (args[0] == "configure")
            {
                if (File.Exists(path)) throw new ClientException("configuration_exists", "Configuration exists; edit it explicitly to preserve identity.");
                Console.Write("Server URL (http://... or https://...): "); var url = Console.ReadLine() ?? "";
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
            // Outside play (Linux, macOS, manual setups) the ROM identity comes from --rom; without it the game is never read.
            Games.LocalRomIdentity? identity = null;
            if (rom != null)
            {
                if (!File.Exists(rom)) throw new ClientException("rom_missing", "Le fichier ROM indiqué par --rom est introuvable.");
                await using var romFile = File.OpenRead(rom);
                identity = await Games.LocalRomIdentity.FromStreamAsync(romFile, cancellation.Token);
            }
            await new ClientRuntime(configuration, bridge, server, new ClientLog(Console.Out), romIdentity: identity, outbox: new Runtime.GameEventOutbox(Runtime.GameEventOutbox.PathNextTo(path))).RunAsync(cancellation.Token);
            return 0;
        }
        catch (OperationCanceledException) when (cancellation.IsCancellationRequested) { return 0; }
        catch (ClientException e) { Console.Error.WriteLine("[FAIL] " + e.Code + ": " + e.Message); WaitBeforeClose(args); return 1; }
        catch (Exception) { Console.Error.WriteLine("[FAIL] Vérifiez la connexion, la configuration et les éventuels messages dans BizHawk."); WaitBeforeClose(args); return 1; }
    }
    /// <summary>configure|doctor|run [--config &lt;path&gt;], plus [--rom &lt;path&gt;] for run.</summary>
    public static (string Config, string? Rom) ParseOptions(string[] args)
    {
        string? config = null, rom = null;
        for (var i = 1; i < args.Length; i += 2)
        {
            if (i + 1 == args.Length) throw new ClientException("invalid_arguments", "Expected [--config <path>] [--rom <path>].");
            if (args[i] == "--config" && config == null) config = args[i + 1];
            else if (args[i] == "--rom" && rom == null && args[0] == "run") rom = Path.GetFullPath(args[i + 1]);
            else throw new ClientException("invalid_arguments", "Expected [--config <path>] [--rom <path>].");
        }
        return (config ?? ConfigurationStore.DefaultPath, rom);
    }
    private static void WaitBeforeClose(string[] args)
    {
        if ((args.Length == 0 || args[0] == "play") && !Console.IsInputRedirected)
        { Console.WriteLine("Appuyez sur Entrée pour fermer."); Console.ReadLine(); }
    }
}
