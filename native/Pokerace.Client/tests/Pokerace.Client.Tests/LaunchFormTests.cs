using Pokerace.Client.Configuration;
using Pokerace.Client.Games;
using Pokerace.Client.Launcher;
using Pokerace.Client.Runtime;
using Pokerace.Client.Bridge;
using Spectre.Console.Testing;
using Xunit;

namespace Pokerace.Client.Tests;

// The connection form never ends the launcher on a typo or a refused connection: the player fixes the field and goes on.
public sealed class LaunchFormTests
{
    [Fact]
    public async Task TyposAndARefusedRoomAreFixedWithoutRestarting()
    {
        var rom = Path.GetTempFileName();
        try
        {
            var console = new TestConsole().Interactive();
            console.Profile.Width = 160;
            void Type(string text) => console.Input.PushTextWithEnter(text);
            void Enter() => console.Input.PushKey(ConsoleKey.Enter);
            // First launch: every field is asked; invalid values are asked again.
            Type("pas une adresse"); Type("88.184.14.248:47500");   // port taken from the address
            Type(""); Type("Ben");
            Type("mauvais");
            Type("/introuvable.gba"); Type("\"" + rom + "\"");      // a dragged file arrives quoted
            Enter();                                                // Se connecter → room refused
            Enter(); Type("bon-code");                              // the menu now points at the room code
            Enter();                                                // Se connecter → plays
            for (var i = 0; i < 6; i++) console.Input.PushKey(ConsoleKey.DownArrow);
            Enter();                                                // Quitter

            var checkedRooms = new List<string>();
            var played = new List<(ClientConfiguration Configuration, string Rom)>();
            var saved = 0;
            var form = new LaunchForm(console,
                (configuration, _) => { checkedRooms.Add(configuration.RoomCode);
                    return configuration.RoomCode == "mauvais" ? throw new ClientException("server_rejected", "refused") : Task.CompletedTask; },
                (configuration, path, _, _) => { played.Add((configuration, path)); return Task.CompletedTask; });
            await form.RunAsync(null, LaunchFields.From(null, null, null), (_, _) => saved++, CancellationToken.None);

            Assert.Equal(["mauvais", "bon-code"], checkedRooms);
            var (playedWith, playedRom) = Assert.Single(played);
            Assert.Equal("http://88.184.14.248:47500", playedWith.ServerUrl);
            Assert.Equal("Ben", playedWith.PlayerName);
            Assert.Equal(Path.GetFullPath(rom), playedRom);
            Assert.Equal(1, saved);
            var output = console.Output;
            Assert.Contains("Adresse invalide", output);
            Assert.Contains("Le pseudo doit faire", output);
            Assert.Contains("Fichier introuvable", output);
            Assert.Contains("Port 47500 repris", output);
            Assert.Contains("code du salon incorrect", output);
            Assert.Contains("ROM non reconnue", output);
        }
        finally { File.Delete(rom); }
    }

    [Fact]
    public async Task UnreachableServerSendsThePlayerBackToThePort()
    {
        var rom = Path.GetTempFileName();
        try
        {
            var console = new TestConsole().Interactive();
            console.Profile.Width = 160;
            var existing = new ClientConfiguration { ServerUrl = "http://localhost:3000", PlayerName = "Ben", RoomCode = "salon" };
            console.Input.PushKey(ConsoleKey.Enter);                 // Se connecter → refused connection
            console.Input.PushKey(ConsoleKey.Enter); console.Input.PushTextWithEnter("abc"); console.Input.PushTextWithEnter("8080"); // port field
            console.Input.PushKey(ConsoleKey.Enter);                 // Se connecter → ok
            for (var i = 0; i < 6; i++) console.Input.PushKey(ConsoleKey.DownArrow);
            console.Input.PushKey(ConsoleKey.Enter);
            var urls = new List<string>();
            var form = new LaunchForm(console,
                (configuration, _) => { urls.Add(configuration.ServerUrl);
                    return urls.Count == 1 ? throw new HttpRequestException("x", new System.Net.Sockets.SocketException((int)System.Net.Sockets.SocketError.ConnectionRefused)) : Task.CompletedTask; },
                (_, _, _, _) => Task.CompletedTask);
            var result = await form.RunAsync(existing, LaunchFields.From(existing, rom, null), (_, _) => { }, CancellationToken.None);
            Assert.Equal(["http://localhost:3000", "http://localhost:8080"], urls);
            Assert.Equal(existing.PlayerId, result!.PlayerId);   // the player's identity is kept
            Assert.Contains("Connexion refusée", console.Output);
            Assert.Contains("Le port doit être un nombre", console.Output);
        }
        finally { File.Delete(rom); }
    }

    [Fact]
    public async Task AnAutosaveIsRestartedOnlyAfterConfirmation()
    {
        var rom = Path.GetTempFileName(); var save = Path.GetTempFileName();
        try
        {
            var console = new TestConsole().Interactive();
            console.Profile.Width = 160;
            var existing = new ClientConfiguration { ServerUrl = "http://localhost:3000", PlayerName = "Ben", RoomCode = "salon" };
            void Restore() { console.Input.PushKey(ConsoleKey.DownArrow); console.Input.PushKey(ConsoleKey.Enter); console.Input.PushKey(ConsoleKey.Enter); }
            Restore(); console.Input.PushTextWithEnter("n");         // refused: back to the form
            Restore(); console.Input.PushTextWithEnter("o");         // confirmed: plays from the copy
            for (var i = 0; i < 7; i++) console.Input.PushKey(ConsoleKey.DownArrow);
            console.Input.PushKey(ConsoleKey.Enter);                 // Quitter
            var states = new List<string?>();
            var form = new LaunchForm(console, (_, _) => Task.CompletedTask, (_, _, state, _) => { states.Add(state); return Task.CompletedTask; },
                autosaves: () => [save]);
            await form.RunAsync(existing, LaunchFields.From(existing, rom, null), (_, _) => { }, CancellationToken.None);
            Assert.Equal([save], states);
            Assert.Contains("ce qui a été joué depuis sera perdu", console.Output);
        }
        finally { File.Delete(rom); File.Delete(save); }
    }

    [Theory]
    [InlineData("88.184.14.248", null)]
    [InlineData("", "Adresse invalide")]
    [InlineData("http//x", "Adresse invalide")]
    public void AddressIsChecked(string text, string? error) => Assert.Equal(error, LaunchFields.AddressError(text)?[..16]);

    [Fact]
    public void FieldsComeFromTheSavedConfiguration()
    {
        var fields = LaunchFields.From(new ClientConfiguration { ServerUrl = "https://race.example.com:8443", PlayerName = "Ben", RoomCode = "c" }, "r.gba", null);
        Assert.Equal(("https://race.example.com", 8443), (fields.Address, fields.Port));
        Assert.Equal("https://race.example.com:8443", fields.ServerUrl);
        Assert.Equal(3000, LaunchFields.From(new ClientConfiguration { ServerUrl = "http://h:8080" }, null, 3000).Port);   // --port wins
        Assert.Equal("rom", fields with { Rom = null } is var f ? f.Problem()?.Field : null);
        Assert.Equal("port", (fields with { Port = null }).Problem()?.Field);
    }

    [Fact]
    public void DashboardExplainsEachState()
    {
        var configuration = new ClientConfiguration { ServerUrl = "http://localhost:3000", PlayerName = "Ben", RoomCode = "salon" };
        var party = new PokemonSnapshot(1, 255, "Poussifeu", "POUSSIFEU", 5, 19, 19, false);
        var state = new GameSnapshot(2, new("pokemon.emerald.gen3", "ready", "p", []), new("pokemon", 3, "emerald", "fr", "v0"),
            new("A", 561, 0, 1), new(0, 16, "Route 101"), [party], new(1, []), [], "");
        string Render(ClientStatus status, bool exited, bool quitting)
        {
            var console = new TestConsole(); console.Profile.Width = 200;
            console.Write(PlayerLauncher.Dashboard(status, exited, configuration, quitting, "session.log"));
            return console.Output;
        }
        var playing = Render(new(true, null, new(true, true, "GBA", 1), new(state.Adapter, state)), false, false);
        Assert.Contains("Connecté à http://localhost:3000", playing);
        Assert.Contains("ROM chargée", playing);
        Assert.Contains("561 ₽ · Route 101 · POUSSIFEU N5", playing);
        var refused = Render(new(false, "server_rejected", new(false, false, null, 0), GameObservation.Unavailable("no_game")), true, true);
        Assert.Contains("salon refuse", refused);
        Assert.Contains("BizHawk est fermé", refused);
        Assert.Contains("En attente du jeu", refused);
    }
}
