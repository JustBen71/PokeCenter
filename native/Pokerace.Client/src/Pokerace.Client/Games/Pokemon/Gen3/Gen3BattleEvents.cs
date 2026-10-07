using System.Text.Json.Nodes;

namespace Pokerace.Client.Games.Pokemon.Gen3;

/// <summary>Game statistics of one validated profile (emulator/profiles/*.json, "events" section, with its evidence).</summary>
public sealed record Gen3EventAddresses(int SaveBlock1GameStats)
{
    public static Gen3EventAddresses? From(JsonObject? events) =>
        events?["status"]?.GetValue<string>() == "read-validated" && (int?)events["saveBlock1GameStats"] is int offset and > 0 and < 0x3D00 ? new(offset) : null;
}

/// <summary>
/// Battle and step events (pret/pokeemerald), from what each observation reads: the in-battle flag (gMain.inBattle),
/// gBattleTypeFlags, gBattleOutcome, the money and the party. A battle is its in-battle span: a party member whose HP
/// drops to 0 meanwhile is POKEMON_FAINTED; the end is BATTLE_ENDED; a trainer battle won is also TRAINER_VICTORY
/// with the money it brought. Steps: GAME_STAT_STEPS (gameStats[5] ^ encryptionKey), sent every 100 steps.
/// </summary>
public static class Gen3BattleEvents
{
    public static readonly string[] Capabilities = ["events.trainer_victory", "events.pokemon_fainted", "events.battle_ended", "steps.read"];
    private const uint BattleTypeTrainer = 1 << 3;
    private const int StatSteps = 5, StepsEvery = 100;
    public sealed record Member(uint Personality, int Slot, int SpeciesId, int Hp);

    public sealed class Detector
    {
        private bool inBattle, trainer;
        private uint moneyBefore;
        private readonly Dictionary<uint, int> hp = [];
        private long? lastSteps;

        public List<(string Kind, JsonObject Data)> Observe(bool battle, uint battleTypeFlags, byte outcome, uint money, IReadOnlyList<Member> party)
        {
            var events = new List<(string, JsonObject)>();
            if (battle && !inBattle) { trainer = false; moneyBefore = money; hp.Clear(); foreach (var m in party) hp[m.Personality] = m.Hp; }
            if (battle)
            {
                trainer |= (battleTypeFlags & BattleTypeTrainer) != 0;
                foreach (var m in party)
                {
                    if (hp.TryGetValue(m.Personality, out var before) && before > 0 && m.Hp == 0)
                        events.Add(("POKEMON_FAINTED", new() { ["slot"] = m.Slot, ["speciesId"] = m.SpeciesId }));
                    hp[m.Personality] = m.Hp;
                }
            }
            else if (inBattle)
            {
                // B_OUTCOME_WON 1, LOST 2, DREW 3, RAN 4, PLAYER_TELEPORTED 5, MON_FLED 6, CAUGHT 7, NO_SAFARI_BALLS 8, FORFEITED 9, MON_TELEPORTED 10.
                var result = outcome switch { 1 => "WIN", 2 => "LOSS", 4 or 5 or 9 => "FLEE", _ => "OTHER" };
                events.Add(("BATTLE_ENDED", new() { ["outcome"] = result, ["conscious"] = party.Count(m => m.Hp > 0) }));
                if (outcome == 1 && trainer)
                    events.Add(("TRAINER_VICTORY", new() { ["moneyBefore"] = (long)moneyBefore, ["moneyAfter"] = (long)money, ["baseReward"] = money > moneyBefore ? (long)(money - moneyBefore) : 0L }));
            }
            inBattle = battle;
            return events;
        }

        /// <summary>STEPS_CHANGED at the first reading and every 100 steps (a new game restarts low: the server takes it as a new baseline).</summary>
        public JsonObject? Steps(uint steps)
        {
            if (lastSteps is { } last && steps / StepsEvery == last / StepsEvery && steps >= last) return null;
            lastSteps = steps;
            return new() { ["absolute"] = (long)steps };
        }
    }

    public static int StepsOffset(Gen3EventAddresses events) => events.SaveBlock1GameStats + StatSteps * 4;
}
