using System.Buffers.Binary;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Nodes;
using Pokerace.Client.Bridge;
using static Pokerace.Client.Games.Pokemon.Gen3.Gen3PokemonDecoder;

namespace Pokerace.Client.Games.Pokemon.Gen3;

/// <summary>Battle addresses of one validated profile (emulator/profiles/*.json, "battle" section, with their evidence).</summary>
public sealed record Gen3BattleAddresses(long GMain, long Callback2Overworld, long ScriptContextStatus, long ScriptContext, long LockFieldControls,
    long BattleTypeFlags, long TrainerBattleOpponentA, long SpecialVar8004, long BattleOutcome, long RomSpecialTrainerBattleReturn, long RomReleaseAllEnd,
    int SaveBlock1SecretBases, int SaveBlock1Vars, int SecretBaseSlot)
{
    public static Gen3BattleAddresses? From(JsonObject? battle)
    {
        if (battle?["status"]?.GetValue<string>() != "write-validated") return null;
        long L(string key) => (long)battle[key]!;
        var a = new Gen3BattleAddresses(L("gMain"), L("callback2Overworld"), L("scriptContextStatus"), L("scriptContext"), L("lockFieldControls"),
            L("battleTypeFlags"), L("trainerBattleOpponentA"), L("specialVar8004"), L("battleOutcome"), L("romSpecialTrainerBattleReturn"), L("romReleaseAllEnd"),
            (int)L("saveBlock1SecretBases"), (int)L("saveBlock1Vars"), (int)L("secretBaseSlot"));
        var ram = new[] { (a.GMain, 8), (a.ScriptContextStatus, 1), (a.ScriptContext, ContextSize), (a.LockFieldControls, 1), (a.BattleTypeFlags, 4), (a.TrainerBattleOpponentA, 2), (a.SpecialVar8004, 2), (a.BattleOutcome, 1) };
        var rom = new[] { a.Callback2Overworld, a.RomSpecialTrainerBattleReturn, a.RomReleaseAllEnd };
        return ram.All(r => Gen3Memory.IsMapped(r.Item1, r.Item2)) && rom.All(r => r is >= 0x08000000 and < 0x0A000000) && a.SecretBaseSlot is >= 1 and < 20 ? a : null;
    }
    public const int ContextSize = 0x74;
}

/// <summary>
/// Battle state kept on disk so a client restart in the middle of a battle still restores the temporary RAM and
/// reports the result of the same encounterId. No memory dump: only the 162 bytes it replaced and the ids.
/// </summary>
public sealed class BattleEncounterStore(string? path)
{
    public sealed record Active(string EncounterId, string StartedAt, string State, string SlotOriginal, string VarOriginal);
    public sealed record Last(string EncounterId, string Outcome);
    private sealed record Saved(Active? Active, Last? Last);
    private readonly object gate = new();
    private Saved saved = path != null && File.Exists(path) ? JsonSerializer.Deserialize<Saved>(File.ReadAllText(path)) ?? new(null, null) : new(null, null);
    public Active? Current { get { lock (gate) return saved.Active; } }
    public Last? Previous { get { lock (gate) return saved.Last; } }
    // Named after the configuration file: two clients configured in the same folder never share their battles.
    public static string PathNextTo(string configPath) => System.IO.Path.ChangeExtension(System.IO.Path.GetFullPath(configPath), null) + ".battles.json";
    public void Start(Active active) => Save(saved with { Active = active });
    public void Advance(string state) { lock (gate) if (saved.Active != null) Save(saved with { Active = saved.Active with { State = state } }); }
    public void Finish(string encounterId, string outcome) => Save(new(null, new(encounterId, outcome)));
    public void Abandon() => Save(saved with { Active = null });
    private void Save(Saved next)
    {
        lock (gate)
        {
            saved = next;
            if (path == null) return;
            Directory.CreateDirectory(System.IO.Path.GetDirectoryName(System.IO.Path.GetFullPath(path))!);
            File.WriteAllText(path + ".tmp", JsonSerializer.Serialize(next));
            File.Move(path + ".tmp", path, true);
        }
    }
}

public sealed record BattleStateSnapshot(bool Safe, bool InBattle, string? ActiveEncounterId, BattleLastSnapshot? Last);
public sealed record BattleLastSnapshot(string EncounterId, string Outcome);

/// <summary>
/// Commanded trainer battle in Emerald, through the game's own secret-base battle flow (pret/pokeemerald):
/// the opponent comes from a SaveBlock1 secret-base record (CreateSecretBaseEnemyParty at AllocateBattleResources),
/// the global script context runs ROM bytes "special DoSpecialTrainerBattle; waitstate; return" then "releaseall; end".
/// Everything is armed in one compareWrite, refused unless the player is on the overworld with no script running.
/// The battle is real: XP, money, KO and consequences are the game's; only the temporary record and var are restored.
/// </summary>
public static class Gen3BattleEncounter
{
    public const string Command = "game.battle.start", Capability = "battle.trainer.start";
    private const int RecordSize = 0xA0, VarCurrentSecretBase = 0x4054, TrainerSecretBase = 1024, SpecialBattleSecretBase = 1;
    private const uint BattleTypeTrainerSecretBase = 0x08000008;
    private static readonly string[] MaleSprites = ["youngster", "bug_catcher", "rich_boy", "camper", "cooltrainer_m"];
    private static readonly string[] FemaleSprites = ["lass", "school_kid_f", "lady", "picnicker", "cooltrainer_f"];
    private static readonly TimeSpan StartTimeout = TimeSpan.FromSeconds(20);

    public sealed record Mon(int InternalSpecies, int Level, int[] Moves, int HeldItem, uint Personality, int Ev);
    public sealed record Spec(string EncounterId, byte[] Name, int Gender, int ClassIndex, Mon[] Party);
    public sealed record Field(uint Callback2, byte Status, byte Lock, byte Mode)
    {
        public bool Safe(Gen3BattleAddresses a) => Callback2 == a.Callback2Overworld && Status == 2 && Lock == 0 && Mode == 0;
    }

    /// <summary>Validates the server spec again (never trusting the wire) and maps it to Gen III values.</summary>
    public static Spec ParseSpec(JsonObject payload, JsonObject gameData)
    {
        static Exception Invalid(string what) => new ClientException("invalid_battle", "Invalid battle: " + what);
        if (!Guid.TryParse((string?)payload["encounterId"], out var id)) throw Invalid("encounterId");
        var trainer = payload["trainer"] as JsonObject ?? throw Invalid("trainer");
        var sprite = (string?)trainer["spriteId"] ?? "";
        var gender = Array.IndexOf(MaleSprites, sprite) >= 0 ? 0 : Array.IndexOf(FemaleSprites, sprite) >= 0 ? 1 : throw Invalid("sprite");
        var classIndex = gender == 0 ? Array.IndexOf(MaleSprites, sprite) : Array.IndexOf(FemaleSprites, sprite);
        var codes = gameData["characters"]!.AsObject().Where(c => c.Key != "255").GroupBy(c => c.Value!.GetValue<string>()).ToDictionary(g => g.Key, g => byte.Parse(g.First().Key));
        var name = ((string?)trainer["name"] ?? "").Normalize(System.Text.NormalizationForm.FormC).Trim();
        var text = System.Globalization.StringInfo.GetTextElementEnumerator(name); var nameBytes = new List<byte>();
        while (text.MoveNext()) nameBytes.Add(codes.TryGetValue((string)text.Current, out var b) ? b : throw Invalid("name"));
        if (nameBytes.Count is < 1 or > 7) throw Invalid("name");
        var internalOf = gameData["internalToNational"]!.AsObject().ToDictionary(e => e.Value!.GetValue<int>(), e => int.Parse(e.Key));
        var party = (payload["party"] as JsonArray ?? throw Invalid("party")).Select(node =>
        {
            var m = node as JsonObject ?? throw Invalid("party");
            int I(string key, int min, int max) { var v = m[key]?.GetValue<int>() ?? throw Invalid(key); return v >= min && v <= max ? v : throw Invalid(key); }
            var species = I("speciesId", 1, 386); var nature = I("nature", 0, 24);
            var moves = (m["moves"] as JsonArray ?? throw Invalid("moves")).Select(x => x!.GetValue<int>()).ToArray();
            if (moves.Length is < 1 or > 4 || moves.Any(x => x is < 1 or > 354) || moves.Distinct().Count() != moves.Length) throw Invalid("moves");
            uint personality;
            // Read from the JSON text: the same for wire values and for values built in memory.
            if (m["personality"] is JsonValue p) { personality = long.TryParse(p.ToJsonString(), out var v) && v is >= 0 and <= uint.MaxValue ? (uint)v : throw Invalid("personality"); if (personality % 25 != nature) throw Invalid("personality"); }
            else { var random = BinaryPrimitives.ReadUInt32LittleEndian(RandomNumberGenerator.GetBytes(4)) % 171798691u; personality = random * 25 + (uint)nature; }
            return new Mon(internalOf.TryGetValue(species, out var internalSpecies) ? internalSpecies : throw Invalid("species"),
                I("level", 1, 100), moves, I("heldItem", 0, 376), personality, I("ev", 0, 255));
        }).ToArray();
        if (party.Length is < 1 or > 6) throw Invalid("party");
        return new(id.ToString("D"), nameBytes.ToArray(), gender, classIndex, party);
    }

    /// <summary>The SaveBlock1 secret-base record the game turns into the opponent (struct SecretBase, 0xA0 bytes).</summary>
    public static byte[] Record(Spec spec, string language)
    {
        var r = new byte[RecordSize];
        r[1] = (byte)(spec.Gender << 4);
        for (var i = 0; i < 7; i++) r[2 + i] = i < spec.Name.Length ? spec.Name[i] : (byte)0xFF;
        r[9] = (byte)spec.ClassIndex; // trainerId[0] % 5 selects the trainer class (and sprite) of that gender
        r[13] = (byte)(language == "fr" ? 3 : 2);
        const int party = 0x34;
        for (var i = 0; i < spec.Party.Length; i++)
        {
            var m = spec.Party[i];
            BinaryPrimitives.WriteUInt32LittleEndian(r.AsSpan(party + i * 4), m.Personality);
            for (var j = 0; j < m.Moves.Length; j++) BinaryPrimitives.WriteUInt16LittleEndian(r.AsSpan(party + 24 + (i * 4 + j) * 2), (ushort)m.Moves[j]);
            BinaryPrimitives.WriteUInt16LittleEndian(r.AsSpan(party + 72 + i * 2), (ushort)m.InternalSpecies);
            BinaryPrimitives.WriteUInt16LittleEndian(r.AsSpan(party + 84 + i * 2), (ushort)m.HeldItem);
            r[party + 96 + i] = (byte)m.Level; r[party + 102 + i] = (byte)m.Ev;
        }
        return r;
    }

    public static async Task<Field> ReadFieldAsync(Gen3Memory memory, Gen3BattleAddresses a, CancellationToken cancellation)
    {
        var main = await memory.ReadAsync(a.GMain, 8, cancellation);
        var context = await memory.ReadAsync(a.ScriptContext, 2, cancellation);
        return new(U32(main.AsSpan(4)), (await memory.ReadAsync(a.ScriptContextStatus, 1, cancellation))[0], (await memory.ReadAsync(a.LockFieldControls, 1, cancellation))[0], context[1]);
    }

    private static JsonObject Edit(long address, byte[] expected, byte[]? data = null) => new()
    {
        ["domain"] = address >= 0x03000000 ? "IWRAM" : "EWRAM", ["address"] = address - (address >= 0x03000000 ? 0x03000000 : 0x02000000),
        ["expected"] = Convert.ToHexString(expected), ["data"] = data == null ? null : Convert.ToHexString(data)
    };
    private static byte[] U16Bytes(int v) { var b = new byte[2]; BinaryPrimitives.WriteUInt16LittleEndian(b, (ushort)v); return b; }
    private static byte[] U32Bytes(uint v) { var b = new byte[4]; BinaryPrimitives.WriteUInt32LittleEndian(b, v); return b; }

    /// <summary>
    /// Handles game.battle.start. The same encounterId is never started twice: an encounter in progress or finished
    /// returns its state. A game that is not in a safe state refuses with "not_safe" and nothing is written.
    /// </summary>
    public static async Task<JsonObject> StartAsync(IBridgeClient bridge, LocalRomIdentity? identity, JsonObject payload, BattleEncounterStore store, CancellationToken cancellation)
    {
        var tx = await Gen3Transaction.BeginAsync(bridge, identity, cancellation, "battle_unavailable");
        var a = tx.Profile.Battle ?? throw new ClientException("battle_unavailable", "Battle addresses are not validated for this ROM.");
        var spec = ParseSpec(payload, Gen3ProfileRegistry.Resource("game-data"));
        if (store.Previous?.EncounterId == spec.EncounterId) return new() { ["state"] = "ENDED", ["outcome"] = store.Previous.Outcome };
        if (store.Current is { } current)
            return current.EncounterId == spec.EncounterId ? new() { ["state"] = current.State } : throw new ClientException("battle_busy", "Another battle is in progress.");
        var memory = new Gen3Memory(bridge);
        var main = await memory.ReadAsync(a.GMain, 8, cancellation);
        var status = await memory.ReadAsync(a.ScriptContextStatus, 1, cancellation);
        var lockField = await memory.ReadAsync(a.LockFieldControls, 1, cancellation);
        var context = await memory.ReadAsync(a.ScriptContext, Gen3BattleAddresses.ContextSize, cancellation);
        if (!new Field(U32(main.AsSpan(4)), status[0], lockField[0], context[1]).Safe(a)) throw new ClientException("not_safe", "The player is not free on the overworld.");
        var slot = tx.SaveBlock1 + a.SaveBlock1SecretBases + a.SecretBaseSlot * RecordSize;
        var varAddress = tx.SaveBlock1 + a.SaveBlock1Vars + (VarCurrentSecretBase - 0x4000) * 2;
        var slotBefore = await memory.ReadAsync(slot, RecordSize, cancellation);
        var varBefore = await memory.ReadAsync(varAddress, 2, cancellation);
        var newContext = (byte[])context.Clone();
        newContext[0] = 1; newContext[1] = 1; newContext[2] = 0; // stackDepth 1, SCRIPT_MODE_BYTECODE
        BinaryPrimitives.WriteUInt32LittleEndian(newContext.AsSpan(4), 0); // nativePtr
        BinaryPrimitives.WriteUInt32LittleEndian(newContext.AsSpan(8), (uint)a.RomSpecialTrainerBattleReturn); // scriptPtr
        BinaryPrimitives.WriteUInt32LittleEndian(newContext.AsSpan(12), (uint)a.RomReleaseAllEnd); // stack[0], popped by "return"
        var edits = new JsonArray(
            Edit(tx.Profile.SaveBlock1Pointer, U32Bytes((uint)tx.SaveBlock1)), // save blocks did not move
            Edit(a.GMain + 4, main[4..8]),                                      // still on the overworld
            Edit(slot, slotBefore, Record(spec, tx.Profile.Language)),
            Edit(varAddress, varBefore, U16Bytes(a.SecretBaseSlot)),
            Edit(a.SpecialVar8004, await memory.ReadAsync(a.SpecialVar8004, 2, cancellation), U16Bytes(SpecialBattleSecretBase)),
            Edit(a.TrainerBattleOpponentA, await memory.ReadAsync(a.TrainerBattleOpponentA, 2, cancellation), U16Bytes(TrainerSecretBase)),
            Edit(a.BattleTypeFlags, await memory.ReadAsync(a.BattleTypeFlags, 4, cancellation), U32Bytes(BattleTypeTrainerSecretBase)),
            Edit(a.ScriptContext, context, newContext),
            Edit(a.LockFieldControls, lockField, [1]),
            Edit(a.ScriptContextStatus, status, [0])); // CONTEXT_RUNNING: the field loop runs it on the next frame
        // Recorded before writing: a crash right after the write still knows what to restore.
        store.Start(new(spec.EncounterId, DateTimeOffset.UtcNow.ToString("O"), "STARTING", Convert.ToHexString(slotBefore), Convert.ToHexString(varBefore)));
        try { await ((ITransactionalBridge)bridge).CompareWriteAsync((string)(await bridge.GetGameInfoAsync(cancellation))!["hash"]!, edits, cancellation); }
        catch (ClientException e) when (e.Code == "state_changed") { store.Abandon(); throw new ClientException("not_safe", "The game moved before the battle could start."); }
        return new() { ["state"] = "STARTING" };
    }

    /// <summary>
    /// Follows the active encounter at each observation: STARTING until the battle screen appears, RUNNING until the
    /// player is back on the overworld, then reads gBattleOutcome, restores the temporary record and var, and keeps
    /// the result for the server. Returns what the client publishes in GAME_STATE.
    /// </summary>
    public static async Task<BattleStateSnapshot> TrackAsync(IBridgeClient bridge, Gen3MemoryProfile profile, Gen3BattleAddresses a, BattleEncounterStore store, CancellationToken cancellation)
    {
        var memory = new Gen3Memory(bridge);
        var field = await ReadFieldAsync(memory, a, cancellation);
        if (store.Current is { } active)
        {
            var onOverworld = field.Callback2 == a.Callback2Overworld;
            if (active.State == "STARTING" && !onOverworld) store.Advance("RUNNING");
            else if (active.State == "STARTING" && field.Safe(a) && DateTimeOffset.UtcNow - DateTimeOffset.Parse(active.StartedAt) > StartTimeout)
                await FinishAsync(bridge, profile, a, store, active, "ABORTED", cancellation); // the script ended without any battle
            else if (active.State == "RUNNING" && field.Safe(a))
            {
                var outcome = (await memory.ReadAsync(a.BattleOutcome, 1, cancellation))[0] switch { 1 => "WIN", 2 => "LOSS", 3 => "DRAW", _ => "UNKNOWN" };
                await FinishAsync(bridge, profile, a, store, active, outcome, cancellation);
            }
        }
        var current = store.Current;
        return new(field.Safe(a) && current == null, current?.State == "RUNNING" || (current != null && field.Callback2 != a.Callback2Overworld),
            current?.EncounterId, store.Previous is { } last ? new(last.EncounterId, last.Outcome) : null);
    }

    private static async Task FinishAsync(IBridgeClient bridge, Gen3MemoryProfile profile, Gen3BattleAddresses a, BattleEncounterStore store, BattleEncounterStore.Active active, string outcome, CancellationToken cancellation)
    {
        // Save blocks move during a battle: the record and the var are found again through the current pointer.
        var memory = new Gen3Memory(bridge);
        var ptr = await memory.ReadAsync(profile.SaveBlock1Pointer, 4, cancellation);
        var sb1 = U32(ptr);
        var slot = sb1 + a.SaveBlock1SecretBases + a.SecretBaseSlot * RecordSize;
        var varAddress = sb1 + a.SaveBlock1Vars + (VarCurrentSecretBase - 0x4000) * 2;
        await ((ITransactionalBridge)bridge).CompareWriteAsync((string)(await bridge.GetGameInfoAsync(cancellation))!["hash"]!, new JsonArray(
            Edit(profile.SaveBlock1Pointer, ptr),
            Edit(slot, await memory.ReadAsync(slot, RecordSize, cancellation), Convert.FromHexString(active.SlotOriginal)),
            Edit(varAddress, await memory.ReadAsync(varAddress, 2, cancellation), Convert.FromHexString(active.VarOriginal))), cancellation);
        store.Finish(active.EncounterId, outcome);
    }
}
