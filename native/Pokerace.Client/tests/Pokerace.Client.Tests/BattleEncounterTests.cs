using System.Buffers.Binary;
using System.Text.Json.Nodes;
using Pokerace.Client.Commands;
using Pokerace.Client.Configuration;
using Pokerace.Client.Games;
using Pokerace.Client.Games.Pokemon.Gen3;
using Xunit;

namespace Pokerace.Client.Tests;

// Commanded battles on synthetic Gen III memory: overworld safe state, arming in one compareWrite through the real bridge
// transaction code, battle running, back on the overworld with gBattleOutcome, restoration after the save blocks moved.
public sealed class BattleEncounterTests
{
    private static LocalRomIdentity Identity => new((string)Gen3ProfileRegistry.Resource("rom-manifest")["roms"]![0]!["sha256"]!, new string('b', 40));
    private static Gen3MemoryProfile Profile => new Gen3ProfileRegistry().Resolve(Identity.Sha256).Profile!;
    private static Gen3BattleAddresses A => Profile.Battle!;
    private const long Sb1 = 0x02001000;
    private static long Slot(long sb1) => sb1 + A.SaveBlock1SecretBases + A.SecretBaseSlot * 0xA0;
    private static long Var(long sb1) => sb1 + A.SaveBlock1Vars + 0x54 * 2;
    private static Span<byte> At(GameAdapterTests.MemoryBridge b, long address, int length) => (address >= 0x03000000 ? b.Iwram : b.Ewram).AsSpan((int)(address & 0xFFFFFF), length);

    private static GameAdapterTests.MemoryBridge Overworld()
    {
        var bridge = new GameAdapterTests.MemoryBridge(); bridge.SetParty(1);
        bridge.Put32(A.GMain + 4, (uint)A.Callback2Overworld);
        At(bridge, A.ScriptContextStatus, 1)[0] = 2; // CONTEXT_SHUTDOWN
        bridge.Put32(A.ScriptContext + 92, 0x081DB39C); bridge.Put32(A.ScriptContext + 96, 0x081DB728);
        At(bridge, Slot(Sb1), 9).Fill(0xFF); At(bridge, Slot(Sb1), 2).Clear(); // an empty secret base
        BinaryPrimitives.WriteUInt16LittleEndian(At(bridge, Var(Sb1), 2), 7);
        return bridge;
    }
    private static JsonObject Spec(string? id = null, string name = "TIMÉO", string sprite = "cooltrainer_m") => new()
    {
        ["encounterId"] = id ?? Guid.NewGuid().ToString("D"), ["trainer"] = new JsonObject { ["name"] = name, ["spriteId"] = sprite },
        ["party"] = new JsonArray(new JsonObject { ["speciesId"] = 263, ["level"] = 42, ["moves"] = new JsonArray(53, 339), ["heldItem"] = 13, ["nature"] = 3, ["ev"] = 40, ["personality"] = 28 },
            new JsonObject { ["speciesId"] = 19, ["level"] = 3, ["moves"] = new JsonArray(33), ["heldItem"] = 0, ["nature"] = 7, ["ev"] = 0 }),
        ["options"] = new JsonObject { ["rewardMode"] = "GAME_DEFAULT" }
    };
    private static JsonObject Start(JsonObject spec) => ClientTests.Command(Gen3BattleEncounter.Command, payload: spec);
    private static CommandRouter Router(GameAdapterTests.MemoryBridge bridge, BattleEncounterStore store, bool writes = true) =>
        new(bridge, new ClientConfiguration { AllowPokemonPurchases = writes }, romIdentity: Identity, battles: store);
    private static async Task<GameSnapshot> Observe(GameAdapterTests.MemoryBridge bridge, BattleEncounterStore store) =>
        (await new GameAdapterManager(bridge, Identity, true, store).ObserveAsync(new(true, true, "GBA", 1), default)).State!;

    [Fact] public async Task CapabilityAndSafeStateAreAnnouncedOnlyWithLocalConsentAndABattleProfile()
    {
        await using var bridge = Overworld();
        var store = new BattleEncounterStore(null);
        var state = await Observe(bridge, store);
        Assert.Contains("battle.trainer.start", state.Capabilities);
        Assert.Equal(new BattleStateSnapshot(true, false, null, null), state.Battle);
        Assert.DoesNotContain("battle.trainer.start", (await new GameAdapterManager(bridge, Identity, false, store).ObserveAsync(new(true, true, "GBA", 1), default)).State!.Capabilities);
        // A script running, controls locked or another screen: not safe.
        At(bridge, A.LockFieldControls, 1)[0] = 1;
        Assert.False((await Observe(bridge, store)).Battle!.Safe);
    }

    [Fact] public void SpecIsValidatedAgainAndEncodedAsTheGameSecretBaseRecord()
    {
        var data = Gen3ProfileRegistry.Resource("game-data");
        var spec = Gen3BattleEncounter.ParseSpec(Spec(name: "TIMÉO", sprite: "cooltrainer_m"), data);
        var record = Gen3BattleEncounter.Record(spec, "fr");
        Assert.Equal(0xA0, record.Length);
        Assert.Equal(0, record[1] >> 4 & 1); Assert.Equal(4, record[9]); Assert.Equal(3, record[13]); // male, Cooltrainer (index 4), French
        Assert.Equal(new byte[] { 0xCE, 0xC3, 0xC7, 0x06, 0xC9, 0xFF, 0xFF }, record[2..9]); // T I M É O
        Assert.Equal(28u, BinaryPrimitives.ReadUInt32LittleEndian(record.AsSpan(0x34)));
        Assert.Equal(new ushort[] { 53, 339, 0, 0 }, Enumerable.Range(0, 4).Select(i => BinaryPrimitives.ReadUInt16LittleEndian(record.AsSpan(0x4C + i * 2))));
        Assert.Equal(288, BinaryPrimitives.ReadUInt16LittleEndian(record.AsSpan(0x7C))); // Zigzaton: national 263 = internal 288
        Assert.Equal(13, BinaryPrimitives.ReadUInt16LittleEndian(record.AsSpan(0x88)));
        Assert.Equal(new byte[] { 42, 3 }, record[0x94..0x96]); Assert.Equal(40, record[0x9A]);
        Assert.Equal(7u, BinaryPrimitives.ReadUInt32LittleEndian(record.AsSpan(0x38)) % 25); // derived personality keeps the nature
        Assert.Equal(1, Gen3BattleEncounter.ParseSpec(Spec(sprite: "school_kid_f"), data).Gender);
        foreach (var bad in new Action<JsonObject>[] {
            s => s["trainer"]!["spriteId"] = "rival", s => s["trainer"]!["name"] = "😀", s => s["trainer"]!["name"] = "TROPLONG",
            s => s["party"]![0]!["speciesId"] = 387, s => s["party"]![0]!["personality"] = 29, s => s["party"]![0]!["moves"] = new JsonArray(33, 33),
            s => s["party"]![0]!["level"] = 101, s => s["party"] = new JsonArray(), s => s["encounterId"] = "x" })
        { var spec2 = Spec(); bad(spec2); Assert.Equal("invalid_battle", Assert.Throws<ClientException>(() => Gen3BattleEncounter.ParseSpec(spec2, data)).Code); }
    }

    [Fact] public async Task StartArmsTheGameScriptOnceThenFollowsTheBattleAndRestoresAfterTheSaveBlocksMoved()
    {
        await using var bridge = Overworld();
        var path = Path.Combine(Path.GetTempPath(), "pokerace-battle-" + Guid.NewGuid().ToString("N") + ".json");
        try
        {
            var store = new BattleEncounterStore(path); var router = Router(bridge, store);
            var slotBefore = At(bridge, Slot(Sb1), 0xA0).ToArray();
            // Not on the overworld: refused, nothing written.
            bridge.Put32(A.GMain + 4, 0x08038421);
            Assert.Equal("not_safe", (await router.RouteAsync(Start(Spec()), default)).ErrorCode);
            Assert.Equal(0, bridge.Transactions); Assert.Null(store.Current);
            bridge.Put32(A.GMain + 4, (uint)A.Callback2Overworld);
            Assert.Equal("writes_disabled", (await Router(bridge, store, writes: false).RouteAsync(Start(Spec()), default)).ErrorCode);

            var id = Guid.NewGuid().ToString("D");
            var started = await router.RouteAsync(Start(Spec(id)), default);
            Assert.True(started.Ok, started.ErrorCode); Assert.Equal("STARTING", (string?)started.Result!["state"]); Assert.Equal(1, bridge.Transactions);
            Assert.Equal(Gen3BattleEncounter.Record(Gen3BattleEncounter.ParseSpec(Spec(id), Gen3ProfileRegistry.Resource("game-data")), "fr")[..0x34], At(bridge, Slot(Sb1), 0x34).ToArray());
            Assert.Equal(A.SecretBaseSlot, BinaryPrimitives.ReadUInt16LittleEndian(At(bridge, Var(Sb1), 2)));
            Assert.Equal(1, BinaryPrimitives.ReadUInt16LittleEndian(At(bridge, A.SpecialVar8004, 2)));
            Assert.Equal(1024, BinaryPrimitives.ReadUInt16LittleEndian(At(bridge, A.TrainerBattleOpponentA, 2)));
            Assert.Equal(0x08000008u, BinaryPrimitives.ReadUInt32LittleEndian(At(bridge, A.BattleTypeFlags, 4)));
            var context = At(bridge, A.ScriptContext, 16).ToArray();
            Assert.Equal(new byte[] { 1, 1 }, context[..2]);
            Assert.Equal((uint)A.RomSpecialTrainerBattleReturn, BinaryPrimitives.ReadUInt32LittleEndian(context.AsSpan(8)));
            Assert.Equal((uint)A.RomReleaseAllEnd, BinaryPrimitives.ReadUInt32LittleEndian(context.AsSpan(12)));
            Assert.Equal(1, At(bridge, A.LockFieldControls, 1)[0]); Assert.Equal(0, At(bridge, A.ScriptContextStatus, 1)[0]);
            // Same encounter again (lost ACK, new command id): its state, never a second battle; another one: busy.
            var replay = await router.RouteAsync(ClientTests.Command(Gen3BattleEncounter.Command, Guid.NewGuid().ToString("D"), Spec(id)), default);
            Assert.Equal("STARTING", (string?)replay.Result!["state"]); Assert.Equal(1, bridge.Transactions);
            Assert.Equal("battle_busy", (await router.RouteAsync(Start(Spec()), default)).ErrorCode);

            // The game runs the battle: another main callback.
            At(bridge, A.ScriptContextStatus, 1)[0] = 1; bridge.Put32(A.GMain + 4, 0x08038421);
            Assert.Equal(new BattleStateSnapshot(false, true, id, null), (await Observe(bridge, store)).Battle);
            Assert.Equal("RUNNING", new BattleEncounterStore(path).Current!.State);
            // Back on the overworld after a win; the save blocks moved during the battle (MoveSaveBlocks_ResetHeap).
            const long moved = 0x02010000;
            At(bridge, Sb1, 0x2800).CopyTo(At(bridge, moved, 0x2800)); bridge.Put32(Profile.SaveBlock1Pointer, (uint)moved);
            bridge.Put32(A.GMain + 4, (uint)A.Callback2Overworld); At(bridge, A.ScriptContextStatus, 1)[0] = 2;
            At(bridge, A.LockFieldControls, 1)[0] = 0; At(bridge, A.ScriptContext, 2)[1] = 0; At(bridge, A.BattleOutcome, 1)[0] = 1;
            var after = (await Observe(bridge, store)).Battle!;
            Assert.Equal(new BattleStateSnapshot(true, false, null, new BattleLastSnapshot(id, "WIN")), after);
            Assert.Equal(slotBefore, At(bridge, Slot(moved), 0xA0).ToArray());
            Assert.Equal(7, BinaryPrimitives.ReadUInt16LittleEndian(At(bridge, Var(moved), 2)));
            // A client restart keeps the result: the server can still reconcile it.
            Assert.Equal("WIN", new BattleEncounterStore(path).Previous!.Outcome);
            var ended = await Router(bridge, new BattleEncounterStore(path)).RouteAsync(Start(Spec(id)), default);
            Assert.Equal("ENDED", (string?)ended.Result!["state"]); Assert.Equal("WIN", (string?)ended.Result!["outcome"]);
        }
        finally { File.Delete(path); }
    }

    [Fact] public async Task AStartWithoutAnyBattleIsAbortedAndRestored()
    {
        await using var bridge = Overworld();
        var store = new BattleEncounterStore(null);
        var slotBefore = At(bridge, Slot(Sb1), 0xA0).ToArray();
        var id = Guid.NewGuid().ToString("D");
        Assert.True((await Router(bridge, store).RouteAsync(Start(Spec(id)), default)).Ok);
        // The script ended on the overworld and no battle screen ever appeared, long after the start.
        store.Start(store.Current! with { StartedAt = DateTimeOffset.UtcNow.AddMinutes(-1).ToString("O") });
        At(bridge, A.ScriptContextStatus, 1)[0] = 2; At(bridge, A.LockFieldControls, 1)[0] = 0; At(bridge, A.ScriptContext, 2)[1] = 0;
        Assert.Equal(new BattleLastSnapshot(id, "ABORTED"), (await Observe(bridge, store)).Battle!.Last);
        Assert.Equal(slotBefore, At(bridge, Slot(Sb1), 0xA0).ToArray());
    }
}
