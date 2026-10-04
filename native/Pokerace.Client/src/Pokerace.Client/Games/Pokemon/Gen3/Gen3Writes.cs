using System.Text.Json.Nodes;
using Pokerace.Client.Bridge;

namespace Pokerace.Client.Games.Pokemon.Gen3;

/// <summary>
/// Business writes requested by the server ("game.*" commands). Every command carries the state the server
/// observed (expected money, expected party count, expected 100 bytes of the targeted slot): if the game no longer
/// matches, nothing is written and "state_changed" is returned. Replaying a command whose first attempt already
/// succeeded therefore fails instead of debiting or inserting twice, even after a client restart.
/// </summary>
public static class Gen3Writes
{
    public static readonly string[] Commands = ["game.money.add", "game.money.remove", "game.money.set", "game.pokemon.insert", "game.pokemon.remove", "game.pokemon.replace", "game.party.snapshot"];

    public static async Task<JsonObject> ExecuteAsync(string command, IBridgeClient bridge, LocalRomIdentity? identity, JsonObject payload, CancellationToken cancellation)
    {
        var readOnly = command == "game.party.snapshot";
        var tx = await Gen3Transaction.BeginAsync(bridge, identity, cancellation, requireWritableProfile: !readOnly);
        if (readOnly) return Result(tx, tx.Money, tx.Count, tx.Party, verified: false);
        switch (command)
        {
            case "game.money.add":
            case "game.money.remove":
            case "game.money.set":
            {
                ExpectMoney(tx, payload);
                long target = command == "game.money.set" ? Range(payload, "value", 0, 999999) :
                    tx.Money + (command == "game.money.add" ? 1 : -1) * Range(payload, "amount", 1, 999999);
                if (target < 0) throw new ClientException("insufficient_money", "Not enough money in game.");
                if (target > 999999) throw new ClientException("money_overflow", "In-game money is limited to 999999.");
                await tx.CommitAsync(cancellation, money: tx.EncodeMoney(target));
                return Result(tx, (uint)target, tx.Count);
            }
            case "game.pokemon.insert":
            {
                ExpectCount(tx, payload);
                if (tx.Count >= 6) throw new ClientException("party_full", "The party already has six Pokémon.");
                var raw = tx.ValidCopy(BridgeProtocol.Text(payload, "raw"), tx.Count + 1);
                var party = (byte[])tx.Party.Clone(); raw.CopyTo(party, tx.Count * Gen3Transaction.SlotSize);
                await tx.CommitAsync(cancellation, party: party, newCount: tx.Count + 1);
                return Result(tx, tx.Money, tx.Count + 1, party);
            }
            case "game.pokemon.remove":
            {
                var slot = ExpectSlot(tx, payload);
                if (tx.Count <= 1) throw new ClientException("last_pokemon", "Keep at least one Pokémon in the party.");
                // Same layout as the game and the validated Lua: following members move up, the freed slot is zeroed.
                var party = new byte[Gen3Transaction.PartySize];
                Array.Copy(tx.Party, party, (slot - 1) * Gen3Transaction.SlotSize);
                Array.Copy(tx.Party, slot * Gen3Transaction.SlotSize, party, (slot - 1) * Gen3Transaction.SlotSize, (tx.Count - slot) * Gen3Transaction.SlotSize);
                Array.Copy(tx.Party, tx.Count * Gen3Transaction.SlotSize, party, tx.Count * Gen3Transaction.SlotSize, Gen3Transaction.PartySize - tx.Count * Gen3Transaction.SlotSize);
                await tx.CommitAsync(cancellation, party: party, newCount: tx.Count - 1);
                return Result(tx, tx.Money, tx.Count - 1, party);
            }
            case "game.pokemon.replace":
            {
                var slot = ExpectSlot(tx, payload);
                var raw = tx.ValidCopy(BridgeProtocol.Text(payload, "raw"), slot);
                var party = (byte[])tx.Party.Clone(); raw.CopyTo(party, (slot - 1) * Gen3Transaction.SlotSize);
                await tx.CommitAsync(cancellation, party: party);
                return Result(tx, tx.Money, tx.Count, party);
            }
            default: throw new ClientException("unknown_command", "Unknown game command.");
        }
    }

    private static long Range(JsonObject payload, string name, long min, long max)
    {
        var value = BridgeProtocol.Integer(payload, name);
        if (value < min || value > max) throw new ClientException("invalid_payload", $"{name} is out of range.");
        return value;
    }
    private static void ExpectMoney(Gen3Transaction tx, JsonObject payload)
    {
        if (Range(payload, "expectedMoney", 0, 999999) != tx.Money) throw new ClientException("state_changed", "Money changed since the server observation.");
    }
    private static void ExpectCount(Gen3Transaction tx, JsonObject payload)
    {
        if (Range(payload, "expectedCount", 0, 6) != tx.Count) throw new ClientException("state_changed", "Party changed since the server observation.");
    }
    private static int ExpectSlot(Gen3Transaction tx, JsonObject payload)
    {
        ExpectCount(tx, payload);
        var slot = (int)Range(payload, "slot", 1, 6);
        if (slot > tx.Count) throw new ClientException("invalid_slot", "This slot is empty.");
        if (!string.Equals(tx.SlotRaw(slot), BridgeProtocol.Text(payload, "expectedRaw"), StringComparison.OrdinalIgnoreCase))
            throw new ClientException("state_changed", "This Pokémon changed since the server observation.");
        return slot;
    }
    private static JsonObject Result(Gen3Transaction tx, uint money, int count, byte[]? party = null, bool verified = true)
    {
        var bytes = party ?? tx.Party;
        return new()
        {
            ["verified"] = verified, ["money"] = money, ["partyCount"] = count,
            ["party"] = new JsonArray(Enumerable.Range(0, count).Select(i => (JsonNode)Convert.ToHexString(bytes, i * Gen3Transaction.SlotSize, Gen3Transaction.SlotSize).ToLowerInvariant()).ToArray())
        };
    }
}
