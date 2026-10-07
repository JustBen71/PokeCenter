using System.Buffers.Binary;
using System.Text.Json.Nodes;
using Pokerace.Client.Bridge;
using static Pokerace.Client.Games.Pokemon.Gen3.Gen3PokemonDecoder;

namespace Pokerace.Client.Games.Pokemon.Gen3;

/// <summary>
/// Bag items (pret/pokeemerald struct SaveBlock1: bag pockets of ItemSlot {u16 itemId; u16 quantity ^ encryptionKey}).
/// Validated on BPEF v0: a Potion, a Master Ball, TM01 and a Cheri Berry written here appeared in the right pockets
/// with the right quantity. Key items and HMs are never given nor taken (story progression).
/// </summary>
public static class Gen3Items
{
    public const string Capability = "items.write", AddCommand = "game.item.add", TakeCommand = "game.item.take_random";
    private sealed record Pocket(char Code, int Offset, int Slots, int Max);
    private static readonly Pocket Items = new('I', 0x560, 30, 99), Balls = new('P', 0x650, 16, 99), Tms = new('T', 0x690, 64, 99), Berries = new('B', 0x790, 46, 999);
    private static readonly Pocket[] Pockets = [Items, Balls, Tms, Berries];

    /// <summary>Pocket of a giveable item (game ids); null for key items, HMs, the Enigma Berry and unknown ids.</summary>
    private static Pocket? PocketOf(int id) => id switch
    {
        >= 1 and <= 12 => Balls,
        >= 133 and <= 174 => Berries,
        >= 289 and <= 338 => Tms,
        >= 13 and <= 132 or >= 176 and <= 258 => Items,
        _ => null
    };

    public static async Task<JsonObject> ExecuteAsync(string command, IBridgeClient bridge, LocalRomIdentity? identity, JsonObject payload, CancellationToken cancellation)
    {
        var tx = await Gen3Transaction.BeginAsync(bridge, identity, cancellation);
        var memory = new Gen3Memory(bridge);
        var key = (ushort)U32(await memory.ReadAsync(tx.SaveBlock2 + 0xAC, 4, cancellation));
        async Task<byte[]> Read(Pocket p) => await memory.ReadAsync(tx.SaveBlock1 + p.Offset, p.Slots * 4, cancellation);
        ushort Id(byte[] b, int i) => BinaryPrimitives.ReadUInt16LittleEndian(b.AsSpan(i * 4));
        int Quantity(byte[] b, int i) => BinaryPrimitives.ReadUInt16LittleEndian(b.AsSpan(i * 4 + 2)) ^ key;
        void Set(byte[] b, int i, int id, int quantity)
        {
            BinaryPrimitives.WriteUInt16LittleEndian(b.AsSpan(i * 4), (ushort)id);
            BinaryPrimitives.WriteUInt16LittleEndian(b.AsSpan(i * 4 + 2), (ushort)(quantity ^ key)); // an empty slot keeps 0 ^ key, as ClearItemSlots
        }
        Pocket pocket; byte[] before, after; int item, left;
        if (command == AddCommand)
        {
            item = (int)BridgeProtocol.Integer(payload, "itemId");
            pocket = PocketOf(item) ?? throw new ClientException("invalid_item", "This item cannot be given.");
            before = await Read(pocket); after = (byte[])before.Clone();
            // As the game: the existing stack first (until its maximum), otherwise the first empty slot.
            var slot = Enumerable.Range(0, pocket.Slots).FirstOrDefault(i => Id(before, i) == item && Quantity(before, i) < pocket.Max, -1);
            if (slot < 0) slot = Enumerable.Range(0, pocket.Slots).FirstOrDefault(i => Id(before, i) == 0, -1);
            if (slot < 0) throw new ClientException("bag_full", "This bag pocket is full.");
            left = Id(before, slot) == item ? Quantity(before, slot) + 1 : 1;
            Set(after, slot, item, left);
        }
        else
        {
            // Random stack among the takeable ones (never key items, HMs, the Enigma Berry).
            var stacks = new List<(Pocket Pocket, byte[] Bytes, int Slot)>();
            foreach (var p in Pockets)
            {
                var bytes = await Read(p);
                for (var i = 0; i < p.Slots; i++) if (Id(bytes, i) != 0 && PocketOf(Id(bytes, i)) == p && Quantity(bytes, i) > 0) stacks.Add((p, bytes, i));
            }
            if (stacks.Count == 0) throw new ClientException("bag_empty", "Nothing can be taken from the bag.");
            var chosen = stacks[System.Security.Cryptography.RandomNumberGenerator.GetInt32(stacks.Count)];
            pocket = chosen.Pocket; before = chosen.Bytes; after = (byte[])before.Clone();
            item = Id(before, chosen.Slot); left = Quantity(before, chosen.Slot) - 1;
            if (left > 0) Set(after, chosen.Slot, item, left);
            else
            {
                // Emptied: following stacks move up, as the game compacts a pocket.
                Array.Copy(before, (chosen.Slot + 1) * 4, after, chosen.Slot * 4, (pocket.Slots - chosen.Slot - 1) * 4);
                Set(after, pocket.Slots - 1, 0, 0);
            }
        }
        // Same guarded transaction as money and party (pointers, key, money, party), plus the pocket bytes.
        await tx.CommitAsync(cancellation, extra: [Gen3Transaction.Edit(tx.SaveBlock1 + pocket.Offset, before, after)]);
        return new() { ["itemId"] = item, ["pocket"] = pocket.Code.ToString(), ["quantity"] = Math.Max(left, 0) };
    }
}
