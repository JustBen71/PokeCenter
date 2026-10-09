using Pokerace.Client.Configuration;
using Pokerace.Client.Runtime;
using Pokerace.Client.Server;
using Spectre.Console;
using Spectre.Console.Rendering;

namespace Pokerace.Client.Launcher;

public sealed record LaunchOptions(string ConfigPath, string? Rom, int? Port = null)
{
    public static LaunchOptions Parse(string[] args)
    {
        var path = ConfigurationStore.DefaultPath; string? rom = null; int? port = null;
        var seen = new HashSet<string>();
        for (var i = 0; i < args.Length; i++)
        {
            var option = args[i];
            if (!seen.Add(option)) throw new ClientException("invalid_arguments", "Option répétée.");
            if (option == "--configure") continue; // older shortcuts: the form is always shown now
            if (option is not ("--config" or "--rom" or "--port") || ++i == args.Length)
                throw new ClientException("invalid_arguments", "play [--rom <fichier>] [--config <fichier>] [--port <1-65535>]");
            if (option == "--port") port = ParsePort(args[i]) ?? throw new ClientException("invalid_arguments", "Le port doit être un nombre entre 1 et 65535.");
            else if (option == "--config") path = args[i]; else rom = args[i];
        }
        return new(Path.GetFullPath(path), rom == null ? null : Path.GetFullPath(rom), port);
    }
    /// <summary>
    /// Accepts what players actually type: "88.184.14.248", "88.184.14.248:47500", "http://host/" or "https://host".
    /// Returns "scheme://host[:port]" (no path), or null when it cannot be a server address.
    /// </summary>
    public static string? NormalizeServerUrl(string? value)
    {
        var text = value?.Trim().TrimEnd('/') ?? "";
        if (text.Length == 0 || text.Any(char.IsWhiteSpace)) return null;
        if (!text.Contains("://", StringComparison.Ordinal)) text = "http://" + text;
        if (!Uri.TryCreate(text, UriKind.Absolute, out var uri) || uri.Scheme is not ("http" or "https") || uri.Host.Length == 0 ||
            uri.UserInfo.Length != 0 || uri.Query.Length != 0 || uri.Fragment.Length != 0 || uri.AbsolutePath != "/") return null;
        return uri.GetLeftPart(UriPartial.Authority);
    }
    public static int? ParsePort(string? value) => int.TryParse(value, out var port) && port is >= 1 and <= 65535 ? port : null;
    // Same server, another port: http://host:8080 -> http://host:3000 (no path, as the configuration requires).
    public static string WithPort(string serverUrl, int port)
    {
        if (!Uri.TryCreate(NormalizeServerUrl(serverUrl) ?? "", UriKind.Absolute, out var uri))
            throw new ClientException("invalid_configuration", "Adresse du serveur invalide. Exemple : http://88.184.14.248 — corrigez-la dans le formulaire.");
        return new UriBuilder(uri) { Port = port }.Uri.GetLeftPart(UriPartial.Authority);
    }
}

public static class PlayerLauncher
{
    public static async Task<int> RunAsync(string[] args, CancellationToken cancellation)
    {
        var options = LaunchOptions.Parse(args);
        var directory = Path.Combine(Path.GetDirectoryName(options.ConfigPath)!, "launcher");
        Directory.CreateDirectory(directory);
        FileStream sessionLock;
        try { sessionLock = new FileStream(Path.Combine(directory, "session.lock"), FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None); }
        catch (IOException) { throw new ClientException("launcher_running", "Une session Pokerace est déjà ouverte pour cette configuration."); }
        using var heldLock = sessionLock;
        // CI and scripts drive play through a redirected stdin: no form, the saved configuration and --rom are used.
        if (Console.IsInputRedirected) return await HeadlessAsync(options, directory, cancellation);

        Console.OutputEncoding = System.Text.Encoding.UTF8; // ✔ ✖ ₽ in the Windows console
        var console = AnsiConsole.Console;
        ClientConfiguration? existing = null;
        if (File.Exists(options.ConfigPath))
        {
            try { existing = ConfigurationStore.Load(options.ConfigPath); }
            catch (ClientException) { console.MarkupLine("[yellow]Réglages précédents illisibles : ils seront remplacés.[/]"); }
        }
        var romFile = Path.Combine(directory, "rom.txt");
        var rom = options.Rom ?? (File.Exists(romFile) ? File.ReadAllText(romFile).Trim() : null);
        var form = new LaunchForm(console, (configuration, token) => ServerConnection.ResolveRoomAsync(configuration, token),
            (configuration, path, state, token) => PlayAsync(console, configuration, path, state, directory, token),
            RomPicker.Available ? RomPicker.ChooseAsync : null, () => EmulatorSession.Autosaves(directory));
        await form.RunAsync(existing, LaunchFields.From(existing, rom, options.Port), (configuration, path) =>
        {
            ConfigurationStore.Save(options.ConfigPath, configuration);
            File.WriteAllText(romFile, path);
        }, cancellation);
        return 0;
    }

    private static async Task PlayAsync(IAnsiConsole console, ClientConfiguration configuration, string rom, string? state, string directory, CancellationToken cancellation)
    {
        EmulatorSession? session = null;
        await console.Status().Spinner(Spinner.Known.Dots).StartAsync("Préparation…", async context =>
        {
            var step = new Progress<string>(text => { context.Status(Markup.Escape(text) + "…"); });
            var download = new Progress<double>(f => { if (f < 1) context.Status($"Téléchargement de BizHawk… {f:P0}"); });
            session = await EmulatorSession.StartAsync(configuration, rom, directory, step, download, cancellation, state);
        });
        await using (session!)
        {
            var quit = false;
            await console.Live(Dashboard(session!, configuration, quit)).AutoClear(false).StartAsync(async context =>
            {
                while (!session!.Ended.IsCompleted && !cancellation.IsCancellationRequested)
                {
                    while (Console.KeyAvailable)
                        if (Console.ReadKey(true).Key is ConsoleKey.Q or ConsoleKey.Escape && !quit) { quit = true; session.RequestEmulatorClose(); }
                    context.UpdateTarget(Dashboard(session, configuration, quit));
                    try { await Task.WhenAny(session.Ended, Task.Delay(500, cancellation)); } catch (OperationCanceledException) { }
                }
                context.UpdateTarget(Dashboard(session, configuration, quit));
            });
            console.MarkupLine(session!.EmulatorExited ? "[grey]BizHawk est fermé : session terminée. Vous pouvez relancer depuis le formulaire.[/]" : "[grey]Arrêt de la session…[/]");
        }
    }

    /// <summary>Live view: server, BizHawk and the game as read by the client.</summary>
    public static IRenderable Dashboard(EmulatorSession session, ClientConfiguration configuration, bool quitting) =>
        Dashboard(session.Status, session.EmulatorExited, configuration, quitting, session.LogPath);

    public static IRenderable Dashboard(ClientStatus status, bool emulatorExited, ClientConfiguration configuration, bool quitting, string logPath)
    {
        static string Ok(string text) => "[green]✔[/] " + text;
        static string Ko(string text) => "[red]✖[/] " + text;
        static string Wait(string text) => "[yellow]…[/] " + text;
        var url = Markup.Escape(configuration.ServerUrl);
        var server = status.ServerConnected ? Ok($"Connecté à {url} — salon {Markup.Escape(configuration.RoomCode)}")
            : status.LastError is { } code ? Ko(Markup.Escape(ConnectionErrors.Hint(code, configuration.ServerUrl))) : Wait($"Connexion à {url}");
        var emulator = emulatorExited ? Ko("BizHawk est fermé") : status.Bridge.Connected && status.Bridge.GameLoaded ? Ok("BizHawk ouvert, ROM chargée")
            : status.Bridge.Connected ? Wait("BizHawk ouvert, aucune ROM chargée") : Wait("Connexion au bridge de BizHawk");
        var game = status.Game.State is { } state && status.Game.Adapter.Status == "ready"
            ? Ok($"{Markup.Escape(state.Trainer.Name)} · {state.Trainer.Money:N0} ₽ · {Markup.Escape(state.Location.Label)} · " +
                (state.Party.Length == 0 ? "aucun Pokémon" : string.Join(", ", state.Party.Select(p => Markup.Escape(p.Nickname ?? p.SpeciesName) + " N" + p.Level))))
            : Wait(GameStatus(status.Game.Adapter.Status));
        var grid = new Grid().AddColumn(new GridColumn().NoWrap()).AddColumn();
        grid.AddRow("[bold]Serveur[/]", server).AddRow("[bold]BizHawk[/]", emulator).AddRow("[bold]Partie[/]", game);
        var footer = quitting
            ? OperatingSystem.IsWindows() ? "[yellow]Fermeture de BizHawk…[/]" : "[yellow]Fermez la fenêtre BizHawk pour terminer : la sauvegarde du jeu est écrite à sa fermeture.[/]"
            : "[grey]Q ou Échap : terminer la session (sauvegardez d'abord dans le jeu). Journal : " + Markup.Escape(logPath) + "[/]";
        return new Panel(new Rows(grid, new Markup(footer))) { Header = new PanelHeader("[bold yellow] Pokérace — en jeu [/]"), Border = BoxBorder.Rounded, Expand = true };
    }

    public static string GameStatus(string adapter) => adapter switch
    {
        "no_game" => "En attente du jeu",
        "read_error" => "Partie pas encore lancée (écran titre ou nouvelle partie en cours)",
        "rom_identity_unavailable" => "La ROM ouverte dans BizHawk n'est pas celle choisie",
        "unsupported_system" => "Ce système n'est pas lu par Pokérace",
        "memory_domain_unavailable" => "Mémoire du jeu inaccessible",
        "unknown_rom" or "profile_not_validated" => "ROM non reconnue : la partie ne peut pas être lue",
        _ => "Lecture du jeu : " + adapter
    };

    private static async Task<int> HeadlessAsync(LaunchOptions options, string directory, CancellationToken cancellation)
    {
        if (!File.Exists(options.ConfigPath)) throw new ClientException("configuration_required", "Lancez une première fois Pokerace en mode interactif pour configurer le serveur.");
        var configuration = ConfigurationStore.Load(options.ConfigPath);
        if (options.Port is { } port) configuration = configuration with { ServerUrl = LaunchOptions.WithPort(configuration.ServerUrl, port) };
        var rom = options.Rom ?? throw new ClientException("rom_required", "Sans clavier, indiquez la ROM avec --rom <fichier>.");
        Console.WriteLine("Pokérace — BizHawk + client. Connexion à " + configuration.ServerUrl);
        await using var session = await EmulatorSession.StartAsync(configuration, rom, directory, new Progress<string>(Console.WriteLine), null, cancellation);
        Console.WriteLine("ROM chargée. Entrée (stdin) ou fermeture de BizHawk : fin de session. Journal : " + session.LogPath);
        await Task.WhenAny(session.Ended, Task.Run(() => Console.ReadLine(), CancellationToken.None));
        session.RequestEmulatorClose();
        return 0;
    }
}
