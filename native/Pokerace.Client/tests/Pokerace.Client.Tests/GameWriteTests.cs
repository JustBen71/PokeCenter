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
