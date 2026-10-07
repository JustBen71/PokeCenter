using System.Diagnostics;
using System.Net;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Nodes;
using Pokerace.Client.Bridge;
using Pokerace.Client.Configuration;
using Pokerace.Client.Diagnostics;
using Pokerace.Client.Games;
using Pokerace.Client.Runtime;
using Pokerace.Client.Server;

namespace Pokerace.Client.Launcher;

/// <summary>BizHawk with the bridge, plus the native client, for one ROM. Output goes to launcher/session.log, never to the console.</summary>
public sealed class EmulatorSession : IAsyncDisposable
{
    private readonly Process emulator;
    private readonly ClientRuntime runtime;
    private readonly CancellationTokenSource lifetime;
    private readonly Task client;
    private readonly StreamWriter log;
    private readonly BridgeClient bridge;
    private readonly ServerConnection server;
    public string LogPath { get; }

    private EmulatorSession(Process emulator, ClientRuntime runtime, CancellationTokenSource lifetime, Task client, StreamWriter log, BridgeClient bridge, ServerConnection server, string logPath)
    { this.emulator = emulator; this.runtime = runtime; this.lifetime = lifetime; this.client = client; this.log = log; this.bridge = bridge; this.server = server; LogPath = logPath; }

    public ClientStatus Status => runtime.Status;
    public bool EmulatorExited => emulator.HasExited;
    /// <summary>Completes when BizHawk is closed or the client stops.</summary>
    public Task Ended => Task.WhenAny(emulator.WaitForExitAsync(), client);

    public static async Task<EmulatorSession> StartAsync(ClientConfiguration configuration, string rom, string directory,
        IProgress<string> step, IProgress<double>? download, CancellationToken cancellation)
    {
        if (!File.Exists(rom)) throw new ClientException("rom_missing", "Le fichier ROM sélectionné est introuvable.");
        LocalRomIdentity identity;
        await using (var romFile = new FileStream(rom, FileMode.Open, FileAccess.Read, FileShare.Read))
            identity = await LocalRomIdentity.FromStreamAsync(romFile, cancellation);
        step.Report("Préparation de BizHawk (téléchargement au premier lancement)");
        var folder = await BizHawkInstaller.PrepareAsync(directory, cancellation, download);
        var token = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32));
        var reservation = new TcpListener(IPAddress.Loopback, 0); reservation.Start();
        var port = ((IPEndPoint)reservation.LocalEndpoint).Port; reservation.Stop();
        configuration = configuration with { BridgePort = port };
        var start = BizHawkInstaller.StartInfo(folder);
        start.ArgumentList.Add("--config=" + await PrepareEmulatorConfigAsync(directory, folder, cancellation));
        start.ArgumentList.Add("--open-ext-tool-dll=Pokerace.BizHawkBridge");
        start.ArgumentList.Add(Path.GetFullPath(rom));
        start.Environment["POKERACE_BRIDGE_TOKEN"] = token;
        start.Environment["POKERACE_BRIDGE_PORT"] = port.ToString();
        start.Environment["POKERACE_BRIDGE_LOG"] = Path.Combine(directory, "bridge.log");
        start.RedirectStandardOutput = true; start.RedirectStandardError = true;
        if (Environment.GetEnvironmentVariable("GITHUB_ACTIONS") == "true") start.WindowStyle = ProcessWindowStyle.Hidden;
        var logPath = Path.Combine(directory, "session.log");
        var log = new StreamWriter(logPath, append: false) { AutoFlush = true };
        var sync = TextWriter.Synchronized(log);
        step.Report("Lancement de BizHawk");
        var emulator = Process.Start(start) ?? throw new ClientException("emulator_start_failed", "Impossible de démarrer BizHawk.");
        emulator.OutputDataReceived += (_, e) => { if (e.Data != null) sync.WriteLine("[bizhawk] " + e.Data); };
        emulator.ErrorDataReceived += (_, e) => { if (e.Data != null) sync.WriteLine("[bizhawk] " + e.Data); };
        emulator.BeginOutputReadLine(); emulator.BeginErrorReadLine();
        try
        {
            step.Report("Chargement de la ROM dans BizHawk");
            using (var ready = CancellationTokenSource.CreateLinkedTokenSource(cancellation))
            {
                ready.CancelAfter(TimeSpan.FromSeconds(90));
                try { await WaitForBridgeAsync(configuration, token, emulator, ready.Token); }
                catch (OperationCanceledException) when (!cancellation.IsCancellationRequested)
                { throw new ClientException("emulator_timeout", "BizHawk n'a pas chargé la ROM en 90 secondes. Détails : " + logPath); }
            }
            step.Report("Connexion du client au serveur");
            var bridge = new BridgeClient(configuration, () => token);
            var server = new ServerConnection(configuration);
            var runtime = new ClientRuntime(configuration, bridge, server, new ClientLog(sync), romIdentity: identity, notices: sync,
                outbox: new GameEventOutbox(Path.Combine(Path.GetDirectoryName(Path.GetFullPath(directory))!, "game-events.json")),
                battles: new Games.Pokemon.Gen3.BattleEncounterStore(Path.Combine(Path.GetDirectoryName(Path.GetFullPath(directory))!, "battle-encounters.json")));
            var lifetime = CancellationTokenSource.CreateLinkedTokenSource(cancellation);
            return new EmulatorSession(emulator, runtime, lifetime, runtime.RunAsync(lifetime.Token), log, bridge, server, logPath);
        }
        catch
        {
            if (!emulator.HasExited) emulator.Kill(true);
            emulator.Dispose(); await log.DisposeAsync();
            throw;
        }
    }

    /// <summary>Asks BizHawk to close normally (Windows). On Linux the player closes BizHawk: killing it would lose the in-game save.</summary>
    public bool RequestEmulatorClose()
    {
        if (emulator.HasExited) return true;
        if (!OperatingSystem.IsWindows()) return false;
        EmulatorWindows.Close(emulator.Id);
        return true;
    }

    public async ValueTask DisposeAsync()
    {
        lifetime.Cancel();
        try { await client; } catch (OperationCanceledException) { }
        try { await emulator.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(15)); }
        catch (TimeoutException) { throw new ClientException("emulator_close_pending", "Le client est arrêté. Fermez BizHawk après avoir sauvegardé votre partie."); }
        finally
        {
            await bridge.DisposeAsync(); await server.DisposeAsync();
            emulator.Dispose(); lifetime.Dispose(); await log.DisposeAsync();
        }
    }

    private static async Task<string> PrepareEmulatorConfigAsync(string directory, string folder, CancellationToken cancellation)
    {
        var path = Path.Combine(directory, "bizhawk.config.json");
        var config = File.Exists(path) ? JsonNode.Parse(await File.ReadAllTextAsync(path, cancellation))!.AsObject() : new JsonObject
        { ["LastWrittenFrom"] = "2.11.1", ["FirstBoot"] = false, ["SkipOutdatedOsCheck"] = true, ["SkipSuperuserPrivsCheck"] = true };
        // Windows: GDI+. Linux: OpenGL; GDI+ under Mono can freeze BizHawk waiting for an X event (libgdiplus/cairo, MIT-SHM).
        config["DispMethod"] = OperatingSystem.IsWindows() ? 1 : 0;
        // The in-game save is written to disk every minute, not only when BizHawk closes (a crash would lose it).
        config["AutosaveSaveRAM"] = true; config["FlushSaveRamFrames"] = 60 * 60;
        var dll = Path.GetFullPath(Path.Combine(folder, "ExternalTools", "Pokerace.BizHawkBridge.dll"));
        var trust = config["TrustedExtTools"] as JsonObject ?? new JsonObject();
        trust[dll] = "SHA512:" + Convert.ToHexString(SHA512.HashData(await File.ReadAllBytesAsync(dll, cancellation)));
        if (config["TrustedExtTools"] == null) config["TrustedExtTools"] = trust;
        // Without an audio device BizHawk blocks on a modal error before loading the bridge.
        var noAudio = OperatingSystem.IsWindows() ? EmulatorWindows.AudioDeviceCount() == 0
            : !Directory.Exists("/dev/snd") || Directory.GetFiles("/dev/snd", "pcm*").Length == 0;
        if (noAudio) { config["SoundOutputMethod"] = "Dummy"; config["SoundEnabled"] = false; }
        await File.WriteAllTextAsync(path, config.ToJsonString(new JsonSerializerOptions { WriteIndented = true }), cancellation);
        return path;
    }

    private static async Task WaitForBridgeAsync(ClientConfiguration config, string token, Process emulator, CancellationToken cancellation)
    {
        while (true)
        {
            cancellation.ThrowIfCancellationRequested();
            if (emulator.HasExited) throw new ClientException("emulator_exited", "BizHawk s'est fermé avant le chargement de la ROM.");
            await using var bridge = new BridgeClient(config, () => token);
            try { await bridge.ConnectAsync(cancellation); if ((await bridge.GetStatusAsync(cancellation)).GameLoaded) return; }
            catch (Exception e) when (e is ClientException or IOException or SocketException) { }
            await Task.Delay(250, cancellation);
        }
    }
}
