using System.Text.Json.Nodes;
using Pokerace.Client.Bridge;
using static Pokerace.Client.Games.Pokemon.Gen3.Gen3PokemonDecoder;

namespace Pokerace.Client.Games.Pokemon.Gen3;

/// <summary>Defeat addresses of one validated profile (emulator/profiles/*.json, "defeat" section, with their evidence).</summary>
public sealed record Gen3DefeatAddresses(long Callback2WhiteOut, long InBattleFlags, long PokemonStoragePointer)
{
    public static Gen3DefeatAddresses? From(JsonObject? defeat)
    {
        if (defeat?["status"]?.GetValue<string>() != "write-validated") return null;
        var a = new Gen3DefeatAddresses((long)defeat["callback2WhiteOut"]!, (long)defeat["inBattleFlags"]!, (long)defeat["pokemonStoragePointer"]!);
        return a.Callback2WhiteOut is >= 0x08000000 and < 0x0A000000 && Gen3Memory.IsMapped(a.InBattleFlags, 1) && Gen3Memory.IsMapped(a.PokemonStoragePointer, 4) ? a : null;
    }
}

/// <summary>
/// End of Run in the game (pret/pokeemerald): every blackout goes through CB2_WhiteOut (120 frames, then the party is
/// healed and warped). A lost commanded battle does not black out: its party stays fainted on the overworld.
/// The detector reports one PLAYER_DEFEATED per defeat; the fainted members of a party still standing go to the PC box.
/// </summary>
public static class Gen3Defeat
{
    public const string EventCapability = "events.player_defeated", BoxCommand = "game.party.box_fainted", BoxCapability = "party.box_fainted",
        ResetCommand = "game.reset", ResetCapability = "game.reset";
    private const int BoxCount = 14, BoxSize = 30, BoxMonSize = 80, MaxMovedPerCommand = 4; // 6 transaction edits + 2 guards + 4 slots = 12
    private const byte OutcomeLost = 2;

    /// <summary>Observation-to-observation state: WHITE_OUT, BATTLE_LOST (whiteout missed between two reads) or PARTY_FAINTED, once.</summary>
    public sealed class Detector
    {
        private bool wasInBattle, latched;
        public string? Observe(bool onOverworld, bool whiteOut, bool inBattle, byte outcome, int[] partyHp)
        {
            var cause = whiteOut ? "WHITE_OUT"
                : wasInBattle && !inBattle && outcome == OutcomeLost ? "BATTLE_LOST"
                : onOverworld && !inBattle && partyHp.Length > 0 && partyHp.All(hp => hp == 0) ? "PARTY_FAINTED" : null;
            var report = cause != null && !latched;
            // Released once the player is back on the overworld with a team standing (new game included).
            latched = cause != null || (latched && !onOverworld);
            wasInBattle = inBattle;
            return report ? cause : null;
        }
    }

    public static async Task<string?> ObserveAsync(Gen3Memory memory, Gen3MemoryProfile profile, Detector detector, CancellationToken cancellation)
    {
        if (profile.Battle is not { } battle || profile.Defeat is not { } defeat) return null;
        var callback2 = U32((await memory.ReadAsync(battle.GMain + 4, 4, cancellation)).AsSpan());
        var inBattle = ((await memory.ReadAsync(defeat.InBattleFlags, 1, cancellation))[0] & 2) != 0;
        var outcome = (await memory.ReadAsync(battle.BattleOutcome, 1, cancellation))[0];
        var count = Math.Min((int)(await memory.ReadAsync(profile.PartyCountAddress, 1, cancellation))[0], 6);
        var party = count > 0 ? await memory.ReadAsync(profile.PartyAddress, count * 100, cancellation) : [];
        var hp = Enumerable.Range(0, count).Select(i => (int)U16(party.AsSpan(i * 100 + 86))).ToArray();
        return detector.Observe(callback2 == battle.Callback2Overworld, callback2 == defeat.Callback2WhiteOut, inBattle, outcome, hp);
    }

    /// <summary>
    /// game.party.box_fainted: the party members at 0 HP go to the first empty PC box slots, as a PC deposit (the 80
    /// box bytes are copied verbatim, the party is compacted). Overworld only, at least one member standing, and the
    /// observed party count must still match. At most 4 per command: the server sends another one for the rest.
    /// </summary>
    public static async Task<JsonObject> BoxFaintedAsync(IBridgeClient bridge, LocalRomIdentity? identity, JsonObject payload, CancellationToken cancellation)
    {
        var tx = await Gen3Transaction.BeginAsync(bridge, identity, cancellation, "box_unavailable");
        if (tx.Profile.Battle is not { } battle || tx.Profile.Defeat is not { } defeat) throw new ClientException("box_unavailable", "Box addresses are not validated for this ROM.");
        var expected = BridgeProtocol.Integer(payload, "expectedCount");
        if (expected != tx.Count) throw new ClientException("state_changed", "Party changed since the server observation.");
        var memory = new Gen3Memory(bridge);
        var main = await memory.ReadAsync(battle.GMain, 8, cancellation);
        if (!(await Gen3BattleEncounter.ReadFieldAsync(memory, battle, cancellation)).Safe(battle)) throw new ClientException("not_safe", "The player is not free on the overworld.");
        var members = Enumerable.Range(1, tx.Count).Select(tx.DecodeSlot).ToArray();
        var fainted = members.Where(m => m.CurrentHp == 0).Take(MaxMovedPerCommand).ToArray();
        if (fainted.Length == 0) return new() { ["moved"] = new JsonArray(), ["partyCount"] = tx.Count };
        if (members.All(m => m.CurrentHp == 0)) throw new ClientException("party_fainted", "The whole party fainted: this is a defeat.");
        var pointer = await memory.ReadAsync(defeat.PokemonStoragePointer, 4, cancellation);
        var storage = U32(pointer);
        if (!Gen3Memory.IsMapped(storage + 4, BoxCount * BoxSize * BoxMonSize)) throw new ClientException("state_changed", "PC storage unavailable.");
        var boxes = new byte[BoxCount * BoxSize * BoxMonSize];
        for (var offset = 0; offset < boxes.Length; offset += 4000)
            (await memory.ReadAsync(storage + 4 + offset, Math.Min(4000, boxes.Length - offset), cancellation)).CopyTo(boxes, offset);
        // An empty slot has no species (BoxPokemon.hasSpecies, bit 1 of byte 19), as after ZeroBoxMonData.
        var free = Enumerable.Range(0, BoxCount * BoxSize).Where(s => (boxes[s * BoxMonSize + 19] & 2) == 0).Take(fainted.Length).ToArray();
        if (free.Length < fainted.Length) throw new ClientException("box_full", "The PC boxes are full.");
        var edits = new List<JsonObject>
        {
            Gen3Transaction.Edit(defeat.PokemonStoragePointer, pointer), // the storage did not move (map load)
            Gen3Transaction.Edit(battle.GMain + 4, main[4..8])           // still on the overworld
        };
        var moved = new JsonArray();
        for (var i = 0; i < fainted.Length; i++)
        {
            var at = free[i] * BoxMonSize;
            edits.Add(Gen3Transaction.Edit(storage + 4 + at, boxes[at..(at + BoxMonSize)], tx.Party[((fainted[i].Slot - 1) * 100)..((fainted[i].Slot - 1) * 100 + BoxMonSize)]));
            moved.Add(new JsonObject
            {
                ["slot"] = fainted[i].Slot, ["speciesId"] = fainted[i].SpeciesId, ["speciesName"] = fainted[i].SpeciesName, ["nickname"] = fainted[i].Nickname,
                ["level"] = fainted[i].Level, ["box"] = free[i] / BoxSize + 1, ["place"] = free[i] % BoxSize + 1
            });
        }
        var party = new byte[Gen3Transaction.PartySize];
        var kept = members.Where(m => !fainted.Contains(m)).ToArray();
        for (var i = 0; i < kept.Length; i++) Array.Copy(tx.Party, (kept[i].Slot - 1) * 100, party, i * 100, 100);
        await tx.CommitAsync(cancellation, party: party, newCount: kept.Length, extra: edits);
        return new() { ["moved"] = moved, ["partyCount"] = kept.Length };
    }

    /// <summary>game.reset: the bridge archives the game (savestate + save, 3 kept), erases the save and reboots the core.</summary>
    public static async Task<JsonObject> ResetAsync(IBridgeClient bridge, LocalRomIdentity? identity, CancellationToken cancellation)
    {
        if (identity == null || bridge is not ITransactionalBridge transaction) throw new ClientException("reset_unavailable", "Launch a recognized ROM with the updated bridge.");
        var game = await bridge.GetGameInfoAsync(cancellation);
        if (!identity.MatchesLoadedGame(game) || new Gen3ProfileRegistry().Resolve(identity).Profile?.Defeat == null)
            throw new ClientException("reset_unavailable", "ROM identity unavailable.");
        return new() { ["archive"] = await transaction.ResetGameAsync(game!["hash"]!.GetValue<string>(), cancellation) };
    }
}
