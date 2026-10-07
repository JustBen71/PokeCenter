using System.Buffers.Binary;
using System.Text.Json.Nodes;
using Pokerace.Client.Commands;
using Pokerace.Client.Configuration;
using Pokerace.Client.Games;
using Pokerace.Client.Games.Pokemon.Gen3;
using Pokerace.Client.Runtime;
using Xunit;

namespace Pokerace.Client.Tests;

// End of Run on synthetic Gen III memory: defeat detection (blackout, missed blackout, lost commanded battle), fainted
// members deposited in the PC box through the real bridge transaction code, and the reset command.
public sealed class DefeatTests
{
    private static LocalRomIdentity Identity => new((string)Gen3ProfileRegistry.Resource("rom-manifest")["roms"]![0]!["sha256"]!, new string('b', 40));
    private static Gen3MemoryProfile Profile => new Gen3ProfileRegistry().Resolve(Identity.Sha256).Profile!;
    private const long Storage = 0x02030000;
    private static Span<byte> At(GameAdapterTests.MemoryBridge b, long address, int length) => (address >= 0x03000000 ? b.Iwram : b.Ewram).AsSpan((int)(address & 0xFFFFFF), length);
    private static long PartySlot(int slot) => Profile.PartyAddress + (slot - 1) * 100;

    // Overworld, no script, three members (personalities 0, 1, 2) with the given HP.
    private static GameAdapterTests.MemoryBridge Game(params int[] hp)
    {
        var bridge = new GameAdapterTests.MemoryBridge(); var a = Profile.Battle!;
        bridge.Put32(a.GMain + 4, (uint)a.Callback2Overworld);
        At(bridge, a.ScriptContextStatus, 1)[0] = 2;
        At(bridge, Profile.PartyCountAddress, 1)[0] = (byte)hp.Length;
        for (var i = 0; i < hp.Length; i++)
        {
            GameAdapterTests.MemoryBridge.Pokemon((uint)i).CopyTo(At(bridge, PartySlot(i + 1), 100));
            BinaryPrimitives.WriteUInt16LittleEndian(At(bridge, PartySlot(i + 1) + 86, 2), (ushort)hp[i]);
        }
        bridge.Put32(Profile.Defeat!.PokemonStoragePointer, (uint)Storage);
        At(bridge, Storage + 4 + 19, 1)[0] = 2; // box 1 place 1 is taken
        return bridge;
    }
    private static CommandRouter Router(GameAdapterTests.MemoryBridge bridge) => new(bridge, new ClientConfiguration { AllowPokemonPurchases = true }, romIdentity: Identity);
    private static JsonObject Box(int expectedCount) => ClientTests.Command(Gen3Defeat.BoxCommand, payload: new() { ["expectedCount"] = expectedCount });

    [Fact] public void DetectorReportsEachDefeatOnce()
    {
        var d = new Gen3Defeat.Detector();
        string? Step(bool overworld, bool whiteOut, bool battle, byte outcome, params int[] hp) => d.Observe(overworld, whiteOut, battle, outcome, hp);
        Assert.Null(Step(false, false, true, 0, 5));
        Assert.Null(Step(true, false, false, 1, 5));                 // battle won
        Assert.Null(Step(false, false, true, 0, 0));
        Assert.Equal("WHITE_OUT", Step(false, true, false, 2, 0));    // CB2_WhiteOut: 120 frames, seen several times
        Assert.Null(Step(false, true, false, 2, 0));
        Assert.Null(Step(true, false, false, 2, 20));                 // healed at the Pokémon Center
        Assert.Null(Step(false, false, true, 0, 3));
        Assert.Equal("BATTLE_LOST", Step(true, false, false, 2, 20)); // the blackout fell between two observations
        Assert.Null(Step(true, false, false, 2, 20));
        Assert.Null(Step(false, false, true, 0, 3));
        Assert.Equal("BATTLE_LOST", Step(true, false, false, 2, 0, 0)); // commanded battle lost: no blackout, party fainted
        Assert.Null(Step(true, false, false, 2, 0, 0));
        Assert.Null(Step(false, false, false, 0));                   // reset: title screen, new game
        Assert.Null(Step(true, false, false, 0, 20));
        Assert.Equal("PARTY_FAINTED", Step(true, false, false, 0, 0)); // client started after a lost commanded battle
    }

    [Fact] public async Task ObservationQueuesOnePlayerDefeatedEvent()
    {
        await using var bridge = Game(20, 0, 20);
        var outbox = new GameEventOutbox(null); var manager = new GameAdapterManager(bridge, Identity, true, new BattleEncounterStore(null), outbox);
        var state = (await manager.ObserveAsync(new(true, true, "GBA", 1), default)).State!;
        Assert.Contains(Gen3Defeat.EventCapability, state.Capabilities);
        Assert.Contains(Gen3Defeat.BoxCapability, state.Capabilities);
        // The first observation only gives the step baseline (STEPS_CHANGED), no defeat.
        Assert.Equal("STEPS_CHANGED", (string?)Assert.Single(outbox.Pending())["kind"]);
        Assert.Contains("steps.read", state.Capabilities);
        bridge.Put32(Profile.Battle!.GMain + 4, (uint)Profile.Defeat!.Callback2WhiteOut);
        for (var i = 0; i < 3; i++) { try { await manager.ObserveAsync(new(true, true, "GBA", 1), default); } catch (Exception) { } }
        var e = Assert.Single(outbox.Pending(), p => (string?)p["kind"] == "PLAYER_DEFEATED");
        Assert.Equal("PLAYER_DEFEATED", (string?)e["kind"]);
        Assert.Equal("WHITE_OUT", (string?)e["data"]!["cause"]);
        Assert.DoesNotContain(Gen3Defeat.EventCapability, (await new GameAdapterManager(bridge, Identity, false, new(null), outbox).ObserveAsync(new(true, true, "GBA", 1), default)).State!.Capabilities);
    }

    [Fact] public async Task FaintedMembersGoToTheFirstEmptyBoxSlotAndThePartyIsCompacted()
    {
        await using var bridge = Game(20, 0, 20);
        var pid1 = At(bridge, PartySlot(2), 100).ToArray(); var pid2 = At(bridge, PartySlot(3), 100).ToArray();
        var result = await Router(bridge).RouteAsync(Box(3), default);
        Assert.True(result.Ok, result.ErrorCode);
        var moved = Assert.Single(result.Result!["moved"]!.AsArray())!;
        Assert.Equal((2, 1, 2), ((int)moved["slot"]!, (int)moved["box"]!, (int)moved["place"]!));
        Assert.Equal(2, At(bridge, Profile.PartyCountAddress, 1)[0]);
        Assert.Equal(pid2, At(bridge, PartySlot(2), 100).ToArray());
        Assert.All(At(bridge, PartySlot(3), 100).ToArray(), b => Assert.Equal(0, b));
        Assert.Equal(pid1[..80], At(bridge, Storage + 4 + 80, 80).ToArray());
        // A replay never moves twice: the observed count no longer matches.
        Assert.Equal("state_changed", (await Router(bridge).RouteAsync(Box(3), default)).ErrorCode);
        Assert.Empty((await Router(bridge).RouteAsync(Box(2), default)).Result!["moved"]!.AsArray());
    }

    [Fact] public async Task BoxRefusesOutsideTheOverworldAndForAWholeFaintedParty()
    {
        await using (var bridge = Game(20, 0))
        {
            At(bridge, Profile.Battle!.LockFieldControls, 1)[0] = 1;
            Assert.Equal("not_safe", (await Router(bridge).RouteAsync(Box(2), default)).ErrorCode);
            Assert.Equal(0, bridge.Transactions);
        }
        await using (var bridge = Game(0, 0))
            Assert.Equal("party_fainted", (await Router(bridge).RouteAsync(Box(2), default)).ErrorCode);
    }

    [Fact] public async Task ResetGoesThroughTheBridgeOnlyWithLocalConsent()
    {
        await using var bridge = Game(20);
        Assert.Equal("writes_disabled", (await new CommandRouter(bridge, new ClientConfiguration { AllowPokemonPurchases = false }, romIdentity: Identity).RouteAsync(ClientTests.Command(Gen3Defeat.ResetCommand, payload: new()), default)).ErrorCode);
        var result = await Router(bridge).RouteAsync(ClientTests.Command(Gen3Defeat.ResetCommand, payload: new()), default);
        Assert.True(result.Ok, result.ErrorCode);
        Assert.Equal("20261007T000000000Z", (string?)result.Result!["archive"]);
        Assert.Equal(1, bridge.Resets);
    }
}
