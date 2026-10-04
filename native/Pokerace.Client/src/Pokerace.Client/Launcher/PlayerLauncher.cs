using Pokerace.Client.Games;
using System.Diagnostics;
using System.Net;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Pokerace.Client.Bridge;
using Pokerace.Client.Configuration;
using Pokerace.Client.Diagnostics;
using Pokerace.Client.Runtime;
using Pokerace.Client.Server;

namespace Pokerace.Client.Launcher;

public sealed record LaunchOptions(string ConfigPath, string? Rom, bool Configure)
{
    public static LaunchOptions Parse(string[] args)
    {
        var path = ConfigurationStore.DefaultPath; string? rom = null; var configure = false;
        var seen = new HashSet<string>();
        for (var i = 0; i < args.Length; i++)
        {
            var option = args[i];
            if (!seen.Add(option)) throw new ClientException("invalid_arguments", "Option répétée.");
            if (option == "--configure") { configure = true; continue; }
            if (option is not ("--config" or "--rom") || ++i == args.Length)
                throw new ClientException("invalid_arguments", "play [--rom <fichier>] [--config <fichier>] [--configure]");
            if (option == "--config") path = args[i]; else rom = args[i];
        }
        return new(Path.GetFullPath(path), rom == null ? null : Path.GetFullPath(rom), configure);
    }
}

public static class PlayerLauncher
{
    public static async Task<int> RunAsync(string[] args, CancellationToken cancellation)
    {
        if (!OperatingSystem.IsWindows()) throw new ClientException("unsupported_platform", "Le lanceur BizHawk fourni cible Windows x64.");
        var options = LaunchOptions.Parse(args);
        var directory = Path.Combine(Path.GetDirectoryName(options.ConfigPath)!, "launcher");
        Directory.CreateDirectory(directory);
        FileStream sessionLock;
        try { sessionLock = new FileStream(Path.Combine(directory, "session.lock"), FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None); }
        catch (IOException) { throw new ClientException("launcher_running", "Une session Pokerace est déjà ouverte pour cette configuration."); }
        using var heldLock = sessionLock;
        Console.WriteLine("Pokérace — BizHawk + client\nConnexion à votre serveur existant. Aucun serveur local n'est lancé.");
        var configuration = Configure(options);
        var rom = options.Rom ?? await ChooseRomAsync(cancellation);
        if (string.IsNullOrWhiteSpace(rom)) { Console.WriteLine("Choix de ROM annulé."); return 0; }
        if (!File.Exists(rom)) throw new ClientException("rom_missing", "Le fichier ROM sélectionné est introuvable.");
        await using var romFile = new FileStream(rom, FileMode.Open, FileAccess.Read, FileShare.Read);
        var identity = await LocalRomIdentity.FromStreamAsync(romFile, cancellation);
        var runtime = await BizHawkInstaller.PrepareAsync(directory, cancellation);
        var token = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32));
        var reservation = new TcpListener(IPAddress.Loopback, 0); reservation.Start();
        var port = ((IPEndPoint)reservation.LocalEndpoint).Port; reservation.Stop();
        configuration = configuration with { BridgePort = port };
        var emulatorConfig = await PrepareEmulatorConfigAsync(directory, runtime, cancellation);
        var start = new ProcessStartInfo(Path.Combine(runtime, "EmuHawk.exe"))
        {
            WorkingDirectory = runtime, UseShellExecute = false,
            WindowStyle = Environment.GetEnvironmentVariable("GITHUB_ACTIONS") == "true" ? ProcessWindowStyle.Hidden : ProcessWindowStyle.Normal
        };
        start.ArgumentList.Add("--config=" + emulatorConfig);
        start.ArgumentList.Add("--open-ext-tool-dll=Pokerace.BizHawkBridge");
        start.ArgumentList.Add(Path.GetFullPath(rom));
        start.Environment["POKERACE_BRIDGE_TOKEN"] = token;
        start.Environment["POKERACE_BRIDGE_PORT"] = port.ToString();
        start.Environment["POKERACE_BRIDGE_LOG"] = Path.Combine(directory, "bridge.log");
        using var emulator = Process.Start(start) ?? throw new ClientException("emulator_start_failed", "Impossible de démarrer BizHawk.");
        using var lifetime = CancellationTokenSource.CreateLinkedTokenSource(cancellation);
        try
        {
            var exited = emulator.WaitForExitAsync(CancellationToken.None);
            using (var ready = CancellationTokenSource.CreateLinkedTokenSource(lifetime.Token))
            {
                ready.CancelAfter(TimeSpan.FromSeconds(90));
                await WaitForBridgeAsync(configuration, token, emulator, ready.Token);
            }
            Console.WriteLine("ROM chargée. Connexion du client à " + configuration.ServerUrl);
            Console.WriteLine("Fermez BizHawk ou appuyez sur Entrée ici pour arrêter la session.");
            await using var bridge = new BridgeClient(configuration, () => token);
            await using var server = new ServerConnection(configuration);
            var client = new ClientRuntime(configuration, bridge, server, new ClientLog(Console.Out), romIdentity: identity).RunAsync(lifetime.Token);
            var stop = Task.Run(() => Console.ReadLine());
            await Task.WhenAny(client, exited, stop);
            lifetime.Cancel();
            try { await client; } catch (OperationCanceledException) when (lifetime.IsCancellationRequested) { }
            if (emulator.HasExited && emulator.ExitCode != 0) throw new ClientException("emulator_failed", "BizHawk s'est arrêté avec une erreur.");
            return 0;
        }
        finally
        {
            lifetime.Cancel();
            if (!emulator.HasExited)
            {
                EmulatorWindows.Close(emulator.Id);
                try { await emulator.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(15)); }
                catch (TimeoutException) { throw new ClientException("emulator_close_pending", "Le client est arrêté. Fermez BizHawk après avoir sauvegardé votre partie."); }
            }
        }
    }

    public static ClientConfiguration Configure(LaunchOptions options, TextReader? input = null, TextWriter? output = null)
    {
        var existing = File.Exists(options.ConfigPath) ? ConfigurationStore.Load(options.ConfigPath) : null;
        if (input == null && Console.IsInputRedirected && existing != null && !options.Configure) return existing;
        if (input == null && Console.IsInputRedirected) throw new ClientException("configuration_required", "Lancez une première fois Pokerace en mode interactif pour configurer le serveur.");
        input ??= Console.In; output ??= Console.Out;
        output.WriteLine("Utilisez le pseudo du compte créé sur le portail de votre serveur.");
        string Ask(string label, string? current, bool secret = false)
        {
            output.Write(label + (current == null ? "" : secret ? " [Entrée pour conserver]" : " [" + current + "]") + " : ");
            var answer = input.ReadLine()?.Trim();
            return string.IsNullOrEmpty(answer) ? current ?? "" : answer;
        }
        var value = (existing ?? new ClientConfiguration()) with
        {
            ServerUrl = existing != null && !options.Configure ? existing.ServerUrl : Ask("Adresse HTTP ou HTTPS du serveur", existing?.ServerUrl),
            PlayerName = existing != null && !options.Configure ? existing.PlayerName : Ask("Pseudo", existing?.PlayerName),
            RoomCode = Ask("Code du salon à rejoindre (voir le portail)", existing?.RoomCode, secret: true)
        };
        ConfigurationStore.Save(options.ConfigPath, value);
        output.WriteLine("Réglages enregistrés. Pour les modifier : Pokerace.Client.exe play --configure");
        return value;
    }

    private static async Task<string?> ChooseRomAsync(CancellationToken cancellation)
    {
        // Constant command: file paths are returned as data, never interpolated into PowerShell code.
        const string picker = "[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); Add-Type -AssemblyName System.Windows.Forms; $d=New-Object System.Windows.Forms.OpenFileDialog; $d.Title='Choisissez la ROM à ouvrir dans BizHawk'; $d.Filter='ROM et archives|*.gba;*.gb;*.gbc;*.nds;*.nes;*.sfc;*.smc;*.n64;*.z64;*.v64;*.sms;*.gg;*.md;*.gen;*.zip;*.7z|Tous les fichiers|*.*'; $d.CheckFileExists=$true; if($d.ShowDialog() -eq 'OK'){[Console]::Write($d.FileName)}; $d.Dispose()";
        var start = new ProcessStartInfo(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "WindowsPowerShell", "v1.0", "powershell.exe"))
        { UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true, StandardOutputEncoding = Encoding.UTF8 };
        foreach (var arg in new[] { "-NoProfile", "-STA", "-EncodedCommand", Convert.ToBase64String(Encoding.Unicode.GetBytes(picker)) }) start.ArgumentList.Add(arg);
        using var pickerProcess = Process.Start(start)!;
        using var registration = cancellation.Register(() => { try { if (!pickerProcess.HasExited) pickerProcess.Kill(); } catch (InvalidOperationException) { } });
        var output = pickerProcess.StandardOutput.ReadToEndAsync(cancellation);
        var errors = pickerProcess.StandardError.ReadToEndAsync(cancellation);
        await pickerProcess.WaitForExitAsync(cancellation); await errors;
        if (pickerProcess.ExitCode != 0) throw new ClientException("rom_picker_failed", "Impossible d'ouvrir le sélecteur de ROM. Utilisez play --rom <fichier>.");
        return (await output).Trim();
    }

    private static async Task<string> PrepareEmulatorConfigAsync(string directory, string runtime, CancellationToken cancellation)
    {
        var path = Path.Combine(directory, "bizhawk.config.json");
        var config = File.Exists(path) ? JsonNode.Parse(await File.ReadAllTextAsync(path, cancellation))!.AsObject() : new JsonObject
        { ["LastWrittenFrom"] = "2.11.1", ["FirstBoot"] = false, ["DispMethod"] = 1, ["SkipOutdatedOsCheck"] = true, ["SkipSuperuserPrivsCheck"] = true };
        var dll = Path.GetFullPath(Path.Combine(runtime, "ExternalTools", "Pokerace.BizHawkBridge.dll"));
        var trust = config["TrustedExtTools"] as JsonObject ?? new JsonObject();
        trust[dll] = "SHA512:" + Convert.ToHexString(SHA512.HashData(await File.ReadAllBytesAsync(dll, cancellation)));
        if (config["TrustedExtTools"] == null) config["TrustedExtTools"] = trust;
        if (EmulatorWindows.AudioDeviceCount() == 0) { config["SoundOutputMethod"] = "Dummy"; config["SoundEnabled"] = false; }
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
