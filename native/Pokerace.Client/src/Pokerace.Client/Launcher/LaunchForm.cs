using Pokerace.Client.Configuration;
using Pokerace.Client.Games;
using Pokerace.Client.Games.Pokemon.Gen3;
using Pokerace.Client.Server;
using Spectre.Console;

namespace Pokerace.Client.Launcher;

/// <summary>What the player fills in. Each field is checked on its own, so a typo never ends the launcher.</summary>
public sealed record LaunchFields(string Address, int? Port, string Player, string Room, string? Rom)
{
    public static LaunchFields From(ClientConfiguration? configuration, string? rom, int? port)
    {
        var url = configuration == null ? null : LaunchOptions.NormalizeServerUrl(configuration.ServerUrl);
        var (address, savedPort) = url == null ? ("", (int?)null) : Split(url);
        return new(address, port ?? savedPort, configuration?.PlayerName ?? "", configuration?.RoomCode ?? "", rom);
    }
    /// <summary>"http://host:port" → ("http://host", port).</summary>
    public static (string Address, int Port) Split(string url)
    {
        var uri = new Uri(url);
        return (new UriBuilder(uri) { Port = -1 }.Uri.GetLeftPart(UriPartial.Authority), uri.Port);
    }
    public static string? AddressError(string text) => LaunchOptions.NormalizeServerUrl(text) == null
        ? "Adresse invalide. Exemples : 88.184.14.248, race.example.com ou https://race.example.com" : null;
    public static string? PortError(string text) => LaunchOptions.ParsePort(text.Trim()) == null ? "Le port doit être un nombre entre 1 et 65535 (ex. 3000)." : null;
    public static string? PlayerError(string text) => text.Trim().Length is 0 or > 32 || text.Any(char.IsControl)
        ? "Le pseudo doit faire de 1 à 32 caractères : celui de votre compte sur le portail." : null;
    public static string? RoomError(string text) => text.Trim().Length is 0 or > 128 ? "Indiquez le code du salon affiché sur le portail." : null;
    public static string? RomError(string? path) => string.IsNullOrWhiteSpace(path) ? "Choisissez la ROM du jeu." : !File.Exists(path) ? "Fichier introuvable : " + path : null;

    /// <summary>The first field to fix before connecting and why, or null.</summary>
    public (string Field, string Message)? Problem() =>
        AddressError(Address) is { } address ? ("address", address) : Port == null ? ("port", "Indiquez le port du serveur.")
        : PlayerError(Player) is { } player ? ("player", player) : RoomError(Room) is { } room ? ("room", room)
        : RomError(Rom) is { } rom ? ("rom", rom) : null;
    public string ServerUrl => LaunchOptions.WithPort(LaunchOptions.NormalizeServerUrl(Address)!, Port!.Value);
    public ClientConfiguration Apply(ClientConfiguration? existing) =>
        (existing ?? new ClientConfiguration()) with { ServerUrl = ServerUrl, PlayerName = Player.Trim(), RoomCode = Room.Trim() };
}

/// <summary>The connection form: one menu line per field, validation on input, and a server check before anything is launched.</summary>
public sealed class LaunchForm(IAnsiConsole console, Func<ClientConfiguration, CancellationToken, Task> checkRoom,
    Func<ClientConfiguration, string, Autosave?, CancellationToken, Task> play, Func<string?, CancellationToken, Task<string?>>? pickRom = null,
    Func<string, CancellationToken, Task<IReadOnlyList<Autosave>>>? autosaves = null)
{
    private const string Connect = "connect", Restore = "restore", Quit = "quit";
    private string? romLabel;

    /// <summary>Runs until the player quits; returns the last saved configuration.</summary>
    public async Task<ClientConfiguration?> RunAsync(ClientConfiguration? existing, LaunchFields fields, Action<ClientConfiguration, string> save, CancellationToken cancellation)
    {
        Header();
        // First launch (or missing values): ask every empty field once, then show the form.
        if (LaunchFields.AddressError(fields.Address) != null) fields = await EditAsync("address", fields, cancellation);
        if (fields.Port == null) fields = await EditAsync("port", fields, cancellation);
        if (LaunchFields.PlayerError(fields.Player) != null) fields = await EditAsync("player", fields, cancellation);
        if (LaunchFields.RoomError(fields.Room) != null) fields = await EditAsync("room", fields, cancellation);
        if (LaunchFields.RomError(fields.Rom) != null) fields = await EditAsync("rom", fields, cancellation);
        string? next = Connect;
        while (true)
        {
            cancellation.ThrowIfCancellationRequested();
            var choice = await console.PromptAsync(Menu(fields, next), cancellation);
            if (choice == Quit) return existing;
            Autosave? state = null;
            if (choice == Restore)
            {
                if (LaunchFields.RomError(fields.Rom) is { } romError) { console.MarkupLine("[red]✖ " + Markup.Escape(romError) + "[/]"); next = "rom"; continue; }
                state = await PickAutosaveAsync(fields.Rom!, cancellation); if (state == null) { next = Connect; continue; } choice = Connect;
            }
            if (choice != Connect) { fields = await EditAsync(choice, fields, cancellation); next = Connect; continue; }
            if (fields.Problem() is { } problem)
            {
                console.MarkupLine("[red]✖ " + Markup.Escape(problem.Message) + "[/]");
                next = problem.Field; continue;
            }
            var configuration = fields.Apply(existing);
            try
            {
                await console.Status().Spinner(Spinner.Known.Dots).StartAsync("Vérification du serveur et du code du salon…",
                    async _ =>
                    {
                        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(cancellation);
                        deadline.CancelAfter(TimeSpan.FromSeconds(10));
                        try { await checkRoom(configuration, deadline.Token); }
                        catch (OperationCanceledException) when (!cancellation.IsCancellationRequested) { throw new ClientException("server_timeout", "No answer."); }
                    });
            }
            catch (Exception e) when (e is not OperationCanceledException || !cancellation.IsCancellationRequested)
            {
                var code = ConnectionErrors.Code(e);
                Problem(code is "invalid_protocol" or "transport_error" ? $"Réponse inattendue de {configuration.ServerUrl} : est-ce bien le serveur Pokérace ?" : ConnectionErrors.Hint(code, configuration.ServerUrl));
                next = code == "server_rejected" ? "room" : code is "server_refused" or "server_timeout" ? "port" : "address";
                continue;
            }
            save(configuration, fields.Rom!);
            existing = configuration;
            console.MarkupLine($"[green]✔ Serveur joint et salon accepté[/] ({Markup.Escape(configuration.ServerUrl)})");
            try { await play(configuration, fields.Rom!, state, cancellation); }
            catch (ClientException e) { Problem(e.Message); }
            next = Connect;
            Header();
        }
    }

    /// <summary>After a crash: one of the copies made every 5 minutes, confirmed because the current progress is replaced.</summary>
    // Only copies of the selected ROM are listed; the current in-game save is backed up before BizHawk loads the copy.
    private async Task<Autosave?> PickAutosaveAsync(string rom, CancellationToken cancellation)
    {
        var saves = await autosaves!(rom, cancellation);
        if (saves.Count == 0) { console.MarkupLine("[yellow]Aucune sauvegarde automatique pour cette ROM : elles sont faites toutes les 5 minutes pendant le jeu.[/]"); return null; }
        static string Label(Autosave s) { var at = s.CreatedUtc.ToLocalTime(); var ago = (int)(DateTime.Now - at).TotalMinutes;
            return $"{at:dd/MM HH:mm}  (il y a {(ago < 60 ? ago + " min" : ago / 60 + " h " + ago % 60 + " min")})" + (s.Legacy ? "  — ancienne copie, vérifiée au lancement" : ""); }
        var cancel = new Autosave("", default, false);
        var picked = await console.PromptAsync(new SelectionPrompt<Autosave>().Title("Reprendre la partie à quelle sauvegarde automatique ?")
            .UseConverter(s => s == cancel ? "Annuler" : Label(s)).AddChoices(saves.Append(cancel)), cancellation);
        if (picked == cancel) return null;
        var ok = await console.PromptAsync(new ConfirmationPrompt($"[yellow]La partie reprendra au {Markup.Escape(Label(picked))} : ce qui a été joué depuis sera perdu (sauvegarde en jeu comprise). La sauvegarde actuelle est d'abord copiée dans restore-backups. Continuer ?[/]") { DefaultValue = false, Yes = 'o', No = 'n' }, cancellation);
        return ok ? picked : null;
    }

    private void Header() => console.Write(new Rule("[bold yellow]Pokérace[/] — connexion au serveur et lancement du jeu").LeftJustified());
    private void Problem(string text) => console.Write(new Panel(Markup.Escape(text)) { Header = new PanelHeader("[red] Impossible de continuer [/]"), Border = BoxBorder.Rounded, BorderStyle = new Style(Color.Red) });

    private SelectionPrompt<string> Menu(LaunchFields f, string? highlighted)
    {
        string Value(string? text, bool ok) => ok ? Markup.Escape(text!) : "[red]à renseigner[/]";
        (string Key, string Label)[] rows =
        [
            (Connect, "[bold green]▶ Se connecter et lancer le jeu[/]"),
            .. autosaves == null ? [] : new[] { (Restore, "  ↺ Reprendre une sauvegarde automatique (après un crash)") },
            ("address", "  Serveur        " + Value(f.Address, LaunchFields.AddressError(f.Address) == null)),
            ("port", "  Port           " + Value(f.Port?.ToString(), f.Port != null)),
            ("player", "  Pseudo         " + Value(f.Player, LaunchFields.PlayerError(f.Player) == null)),
            ("room", "  Code du salon  " + Value(f.Room, LaunchFields.RoomError(f.Room) == null)),
            ("rom", "  ROM            " + (LaunchFields.RomError(f.Rom) == null ? Markup.Escape(Path.GetFileName(f.Rom!)) + " " + (romLabel ??= RomLabel(f.Rom!)) : "[red]à choisir[/]")),
            (Quit, "  Quitter"),
        ];
        var labels = rows.ToDictionary(r => r.Key, r => r.Label);
        var prompt = new SelectionPrompt<string>()
            .Title("Flèches pour choisir, [bold]Entrée[/] pour valider. Choisissez un champ pour le modifier.")
            .UseConverter(key => labels[key]).AddChoices(rows.Select(r => r.Key));
        if (highlighted != null) prompt.DefaultValue(highlighted);
        return prompt;
    }

    private async Task<LaunchFields> EditAsync(string field, LaunchFields f, CancellationToken cancellation)
    {
        switch (field)
        {
            case "address":
                var typed = await Ask("Adresse du serveur (ex. 88.184.14.248)", f.Address, LaunchFields.AddressError, cancellation);
                var url = new Uri(LaunchOptions.NormalizeServerUrl(typed)!);
                var (address, port) = LaunchFields.Split(url.ToString());
                // A port typed with the address (host:port) fills the port field too.
                var withPort = !url.IsDefaultPort || typed.Contains(":" + url.Port);
                if (withPort) console.MarkupLine($"[grey]Port {port} repris de l'adresse.[/]");
                return f with { Address = address, Port = withPort ? port : f.Port ?? port };
            case "port":
                return f with { Port = int.Parse((await Ask("Port du serveur (ex. 3000 ; demandez-le à l'organisateur)", f.Port?.ToString() ?? "", LaunchFields.PortError, cancellation)).Trim()) };
            case "player":
                return f with { Player = (await Ask("Pseudo (le même que votre compte sur le portail)", f.Player, LaunchFields.PlayerError, cancellation)).Trim() };
            case "room":
                return f with { Room = (await Ask("Code du salon (affiché sur le portail)", f.Room, LaunchFields.RoomError, cancellation)).Trim() };
            default:
                string? rom = null;
                if (pickRom != null)
                {
                    console.MarkupLine("[grey]Une fenêtre s'ouvre pour choisir la ROM…[/]");
                    rom = await pickRom(f.Rom, cancellation);
                    if (rom == null) console.MarkupLine("[grey]Aucune fenêtre de choix disponible ou choix annulé : indiquez le chemin du fichier.[/]");
                }
                rom ??= (await Ask("Chemin de la ROM (vous pouvez glisser le fichier dans cette fenêtre)", f.Rom ?? "", text => LaunchFields.RomError(Unquote(text)), cancellation));
                rom = Path.GetFullPath(Unquote(rom));
                romLabel = RomLabel(rom);
                console.MarkupLine("ROM : " + Markup.Escape(Path.GetFileName(rom)) + " " + romLabel);
                return f with { Rom = rom };
        }
    }

    private Task<string> Ask(string question, string current, Func<string, string?> error, CancellationToken cancellation)
    {
        // Invalid input is asked again with its error; Enter keeps a valid current value.
        var prompt = new TextPrompt<string>(Markup.Escape(question) + " :").AllowEmpty()
            .Validate(text => error(text) is { } problem ? ValidationResult.Error("[red]" + Markup.Escape(problem) + "[/]") : ValidationResult.Success());
        if (current.Length > 0 && error(current) == null) prompt.DefaultValue(current);
        return console.PromptAsync(prompt, cancellation);
    }

    // Dragging a file into a terminal pastes a quoted path.
    private static string Unquote(string text) => text.Trim().Trim('"', '\'');

    /// <summary>Recognised ROM or a warning; the hash is computed locally and never sent.</summary>
    public static string RomLabel(string path)
    {
        try
        {
            using var stream = File.OpenRead(path);
            var identity = LocalRomIdentity.FromStreamAsync(stream, CancellationToken.None).GetAwaiter().GetResult();
            var (_, profile) = new Gen3ProfileRegistry().Resolve(identity);
            return profile == null ? "[yellow]⚠ ROM non reconnue : Pokérace ne pourra pas lire la partie[/]"
                : $"[green]✔ Pokémon Émeraude ({Markup.Escape(profile.Language)}, {Markup.Escape(profile.Revision)}) reconnue[/]";
        }
        catch (IOException) { return "[red]✖ fichier illisible[/]"; }
        catch (UnauthorizedAccessException) { return "[red]✖ fichier illisible[/]"; }
    }
}
