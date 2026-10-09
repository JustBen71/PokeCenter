using System.Text.Json.Nodes;
using Pokerace.Client.Commands;
using Pokerace.Client.Configuration;
using Pokerace.Client.Games;
using Pokerace.Client.Games.Pokemon.Gen3;
using Xunit;

namespace Pokerace.Client.Tests;

// Business writes on synthetic Gen III memory, through the real bridge compareWrite implementation.
public sealed class GameWriteTests
{
    private static LocalRomIdentity Identity => new((string)Gen3ProfileRegistry.Resource("rom-manifest")["roms"]![0]!["sha256"]!, new string('b', 40));
    private static string Hex(byte[] b) => Convert.ToHexString(b).ToLowerInvariant();
    private static GameAdapterTests.MemoryBridge Bridge(params uint[] pids)
    {
        var bridge = new GameAdapterTests.MemoryBridge(); bridge.SetParty(0);
        var profile = new Gen3ProfileRegistry().Resolve(Identity.Sha256).Profile!;
        for (var i = 0; i < pids.Length; i++) GameAdapterTests.MemoryBridge.Pokemon(pids[i]).CopyTo(bridge.Ewram, (int)profile.PartyAddress - 0x02000000 + i * 100);
        bridge.Ewram[(int)profile.PartyCountAddress - 0x02000000] = (byte)pids.Length;
        return bridge;
    }
    private static CommandRouter Router(GameAdapterTests.MemoryBridge bridge, bool writes = true) => new(bridge, new ClientConfiguration { AllowPokemonPurchases = writes }, romIdentity: Identity);
    private static JsonObject Command(string name, JsonObject payload) => ClientTests.Command(name, payload: payload);
    private static async Task<GameSnapshot> Observe(GameAdapterTests.MemoryBridge bridge) => (await new GameAdapterManager(bridge, Identity, true).ObserveAsync(new(true, true, "GBA", 1), default)).State!;

    [Fact] public async Task WriteCapabilitiesAreAnnouncedOnlyWithLocalConsent()
    {
        await using var bridge = Bridge(0);
        Assert.Equal(Gen3GameAdapter.ReadCapabilities, (await new GameAdapterManager(bridge, Identity).ObserveAsync(new(true, true, "GBA", 1), default)).State!.Capabilities);
        var state = await Observe(bridge);
        Assert.Contains("money.write", state.Capabilities); Assert.Contains("pokemon.insert", state.Capabilities); Assert.Equal(state.Capabilities, state.Adapter.Capabilities);
    }

    [Fact] public async Task ExactHashKeepsWritesButARevisionFallbackIsReadOnly()
    {
        Assert.Equal(Gen3ProfileRegistry.ExactHash, new Gen3ProfileRegistry().Resolve(Identity).Profile!.Match);
        // PokeraceEmeraud.gba, a randomized BPEF v0 validated in BizHawk 2.11.1 (docs/rom-compatibility.md): exact hash, writes kept.
        var validated = new Gen3ProfileRegistry().Resolve(Identity with { Sha256 = "0a326524d8ac012af5a5978ca1b447453d338452e56b86364093a7466942aca5", Revision = "BPEF v0" }).Profile!;
        Assert.Equal(Gen3ProfileRegistry.ExactHash, validated.Match); Assert.True(validated.AllowWrites);
        // Unknown SHA-256 (randomized ROM) with the header of the validated BPEF v0: read, never written.
        var randomized = Identity with { Sha256 = new string('0', 64), Revision = "BPEF v0" };
        var (status, profile) = new Gen3ProfileRegistry().Resolve(randomized);
        Assert.Equal("ready", status); Assert.Equal(Gen3ProfileRegistry.RevisionFallback, profile!.Match); Assert.False(profile.AllowWrites);
        await using var bridge = Bridge(0);
        var state = (await new GameAdapterManager(bridge, randomized, true, new BattleEncounterStore(null), new Pokerace.Client.Runtime.GameEventOutbox(null)).ObserveAsync(new(true, true, "GBA", 1), default)).State!;
        Assert.Single(state.Party);
        Assert.Equal(Gen3GameAdapter.ReadCapabilities.Concat(Gen3BattleEvents.Capabilities), state.Capabilities);
        Assert.DoesNotContain(state.Capabilities, c => c.EndsWith(".write") || c.Contains("insert") || c.Contains("remove") || c.Contains("replace") || c.Contains("reset") || c.Contains("battle.trainer") || c.Contains("box"));
        var before = (byte[])bridge.Ewram.Clone();
        var router = new CommandRouter(bridge, new ClientConfiguration { AllowPokemonPurchases = true, AllowMemoryWrites = true }, romIdentity: randomized);
        foreach (var (name, payload) in new (string, JsonObject)[] {
            ("game.money.add", new() { ["amount"] = 500, ["expectedMoney"] = 12500 }),
            ("game.pokemon.remove", new() { ["slot"] = 1, ["expectedCount"] = 1 }),
            ("pokemon.purchase", new() { ["price"] = 100, ["expectedMoney"] = 12500, ["expectedCount"] = 1, ["raw"] = Convert.ToHexString(GameAdapterTests.MemoryBridge.Pokemon(0)) }),
            (Gen3Items.AddCommand, new() { ["itemId"] = 13 }),
            ("bridge.writeMemory", new() { ["domain"] = "EWRAM", ["address"] = 0, ["data"] = "01" }) })
            Assert.Equal("rom_not_validated", (await router.RouteAsync(Command(name, payload), default)).ErrorCode);
        Assert.Equal("reset_unavailable", (await router.RouteAsync(Command(Gen3Defeat.ResetCommand, new()), default)).ErrorCode);
        Assert.True((await router.RouteAsync(Command("game.party.snapshot", new()), default)).Ok, "reading stays available");
        Assert.Equal(before, bridge.Ewram);
    }

    [Fact] public async Task PartyWritesHappenOnlyInTheSafeStateAndNothingIsWrittenOtherwise()
    {
        await using var bridge = Bridge(0); var router = Router(bridge);
        var a = new Gen3ProfileRegistry().Resolve(Identity).Profile!.Battle!;
        Span<byte> At(long address) => (address >= 0x03000000 ? bridge.Iwram : bridge.Ewram).AsSpan((int)(address & 0xFFFFFF), 1);
        Task<Pokerace.Client.Commands.CommandResult> Insert(int count) => router.RouteAsync(Command("game.pokemon.insert",
            new() { ["raw"] = Hex(GameAdapterTests.MemoryBridge.Pokemon(7)), ["expectedCount"] = count }), default);
        var states = new (string Name, Action Enter)[]
        {
            ("battle or map change", () => bridge.Free(false)),                  // main callback is not the overworld one
            ("script or dialogue", () => At(a.ScriptContextStatus)[0] = 0),      // a script is running
            ("menu", () => At(a.LockFieldControls)[0] = 1),                      // field controls locked (start menu…)
        };
        foreach (var (name, enter) in states)
        {
            enter();
            var before = (byte[])bridge.Ewram.Clone();
            var refused = await Insert(1);
            Assert.Equal("not_safe", refused.ErrorCode); Assert.Equal(before, bridge.Ewram);
            bridge.Free(true); At(a.LockFieldControls)[0] = 0;
        }
        Assert.True((await Insert(1)).Ok, "free again: a new attempt is applied");
        Assert.Equal(2, (await Observe(bridge)).Party.Length);
    }

    [Fact] public async Task MoneyAddRemoveAndSetAreVerifiedAndNeverAppliedTwice()
    {
        await using var bridge = Bridge(0); var router = Router(bridge);
        var add = Command("game.money.add", new() { ["amount"] = 500, ["expectedMoney"] = 12500 });
        var first = await router.RouteAsync(add, default);
        Assert.True(first.Ok); Assert.Equal(13000u, first.Result!["money"]!.GetValue<uint>());
        Assert.True((await router.RouteAsync(add, default)).Ok); Assert.Equal(1, bridge.Transactions);
        // A new command id with the old observation is refused: the money no longer matches.
        var replay = await router.RouteAsync(Command("game.money.add", new() { ["amount"] = 500, ["expectedMoney"] = 12500 }), default);
        Assert.Equal("state_changed", replay.ErrorCode); Assert.Equal(13000u, (await Observe(bridge)).Trainer.Money);
        Assert.Equal("insufficient_money", (await router.RouteAsync(Command("game.money.remove", new() { ["amount"] = 13001, ["expectedMoney"] = 13000 }), default)).ErrorCode);
        Assert.True((await router.RouteAsync(Command("game.money.remove", new() { ["amount"] = 3000, ["expectedMoney"] = 13000 }), default)).Ok);
        Assert.Equal("money_overflow", (await router.RouteAsync(Command("game.money.add", new() { ["amount"] = 999999, ["expectedMoney"] = 10000 }), default)).ErrorCode);
        Assert.True((await router.RouteAsync(Command("game.money.set", new() { ["value"] = 42, ["expectedMoney"] = 10000 }), default)).Ok);
        Assert.Equal(42u, (await Observe(bridge)).Trainer.Money); Assert.Equal(3, bridge.Transactions);
    }

    [Fact] public async Task InsertAppendsTheExactCopyAndRefusesAFullParty()
    {
        await using var bridge = Bridge(0, 1); var router = Router(bridge);
        var copy = Hex(GameAdapterTests.MemoryBridge.Pokemon(7));
        var result = await router.RouteAsync(Command("game.pokemon.insert", new() { ["raw"] = copy, ["expectedCount"] = 2 }), default);
        Assert.True(result.Ok); Assert.Equal(3, result.Result!["partyCount"]!.GetValue<int>());
        var state = await Observe(bridge); Assert.Equal(3, state.Party.Length); Assert.Equal(copy, state.Party[2].Artifact!.Raw);
        Assert.Equal("state_changed", (await router.RouteAsync(Command("game.pokemon.insert", new() { ["raw"] = copy, ["expectedCount"] = 2 }), default)).ErrorCode);
        Assert.Equal("invalid_pokemon", (await router.RouteAsync(Command("game.pokemon.insert", new() { ["raw"] = new string('0', 200), ["expectedCount"] = 3 }), default)).ErrorCode);
        await using var full = Bridge(0, 1, 2, 3, 4, 5);
        Assert.Equal("party_full", (await Router(full).RouteAsync(Command("game.pokemon.insert", new() { ["raw"] = copy, ["expectedCount"] = 6 }), default)).ErrorCode);
    }

    [Fact] public async Task RemoveShiftsFollowingMembersAndKeepsTheLastPokemon()
    {
        await using var bridge = Bridge(10, 11, 12); var router = Router(bridge);
        var middle = Hex(GameAdapterTests.MemoryBridge.Pokemon(11));
        Assert.Equal("state_changed", (await router.RouteAsync(Command("game.pokemon.remove", new() { ["slot"] = 2, ["expectedRaw"] = Hex(GameAdapterTests.MemoryBridge.Pokemon(12)), ["expectedCount"] = 3 }), default)).ErrorCode);
        Assert.True((await router.RouteAsync(Command("game.pokemon.remove", new() { ["slot"] = 2, ["expectedRaw"] = middle, ["expectedCount"] = 3 }), default)).Ok);
        var state = await Observe(bridge);
        Assert.Equal([Hex(GameAdapterTests.MemoryBridge.Pokemon(10)), Hex(GameAdapterTests.MemoryBridge.Pokemon(12))], state.Party.Select(p => p.Artifact!.Raw).ToArray());
        var profile = new Gen3ProfileRegistry().Resolve(Identity.Sha256).Profile!;
        Assert.All(bridge.Ewram.AsSpan((int)profile.PartyAddress - 0x02000000 + 200, 100).ToArray(), b => Assert.Equal(0, b));
        await using var single = Bridge(3);
        Assert.Equal("last_pokemon", (await Router(single).RouteAsync(Command("game.pokemon.remove", new() { ["slot"] = 1, ["expectedRaw"] = Hex(GameAdapterTests.MemoryBridge.Pokemon(3)), ["expectedCount"] = 1 }), default)).ErrorCode);
        Assert.Equal("invalid_slot", (await router.RouteAsync(Command("game.pokemon.remove", new() { ["slot"] = 3, ["expectedRaw"] = middle, ["expectedCount"] = 2 }), default)).ErrorCode);
    }

    [Fact] public async Task ReplaceOverwritesOnlyTheExpectedSlot()
    {
        await using var bridge = Bridge(20, 21); var router = Router(bridge);
        var copy = Hex(GameAdapterTests.MemoryBridge.Pokemon(99));
        Assert.True((await router.RouteAsync(Command("game.pokemon.replace", new() { ["slot"] = 2, ["expectedRaw"] = Hex(GameAdapterTests.MemoryBridge.Pokemon(21)), ["raw"] = copy, ["expectedCount"] = 2 }), default)).Ok);
        var state = await Observe(bridge);
        Assert.Equal(Hex(GameAdapterTests.MemoryBridge.Pokemon(20)), state.Party[0].Artifact!.Raw); Assert.Equal(copy, state.Party[1].Artifact!.Raw); Assert.Equal(12500u, state.Trainer.Money);
    }

    [Fact] public async Task LocalSwitchBlocksWritesButNotSnapshots()
    {
        await using var bridge = Bridge(0); var router = Router(bridge, writes: false);
        Assert.Equal("writes_disabled", (await router.RouteAsync(Command("game.money.add", new() { ["amount"] = 1, ["expectedMoney"] = 12500 }), default)).ErrorCode);
        Assert.Equal(0, bridge.Reads);
        var snapshot = await router.RouteAsync(Command("game.party.snapshot", new()), default);
        Assert.True(snapshot.Ok); Assert.Equal(12500u, snapshot.Result!["money"]!.GetValue<uint>()); Assert.Single(snapshot.Result!["party"]!.AsArray());
        Assert.Equal(0, bridge.Transactions);
    }

    [Fact] public async Task AWriteIsRefusedWhenTheGameChangesBeforeTheTransaction()
    {
        await using var bridge = Bridge(0); var router = Router(bridge);
        bridge.BeforeTransaction = () => bridge.Put32(0x02001490, 11000 ^ 0x12345678);
        var result = await router.RouteAsync(Command("game.money.remove", new() { ["amount"] = 100, ["expectedMoney"] = 12500 }), default);
        Assert.Equal("state_changed", result.ErrorCode); Assert.Equal(0, bridge.Transactions);
        Assert.Equal(11000u, (await Observe(bridge)).Trainer.Money);
    }
}
