using System.Text.Json.Nodes;
using Pokerace.Client.Bridge;

namespace Pokerace.Client.Games.Pokemon.Gen3;

// Auction purchase: debit and insertion in the same verified transaction (kept for existing servers).
public static class Gen3Purchase
{
    public static async Task<JsonObject> ExecuteAsync(IBridgeClient bridge, LocalRomIdentity? identity, JsonObject payload, CancellationToken cancellation)
    {
        var price = BridgeProtocol.Integer(payload, "price");
        var expectedMoney = BridgeProtocol.Integer(payload, "expectedMoney");
        var expectedCount = BridgeProtocol.Integer(payload, "expectedCount");
        if (price < 1 || price > expectedMoney || expectedMoney > 999999 || expectedCount < 1 || expectedCount >= 6)
            throw new ClientException("invalid_purchase", "Invalid purchase preconditions.");
        var tx = await Gen3Transaction.BeginAsync(bridge, identity, cancellation, "purchase_unavailable", requireWritableProfile: false);
        var raw = tx.ValidCopy(BridgeProtocol.Text(payload, "raw"), (int)expectedCount + 1);
        if (tx.Money != expectedMoney || tx.Count != expectedCount) throw new ClientException("state_changed", "Money or party changed.");
        var party = (byte[])tx.Party.Clone(); raw.CopyTo(party, (int)expectedCount * Gen3Transaction.SlotSize);
        await tx.CommitAsync(cancellation, money: tx.EncodeMoney(expectedMoney - price), party: party, newCount: (int)expectedCount + 1);
        return new() { ["verified"] = true, ["money"] = expectedMoney - price, ["partyCount"] = expectedCount + 1 };
    }
}
