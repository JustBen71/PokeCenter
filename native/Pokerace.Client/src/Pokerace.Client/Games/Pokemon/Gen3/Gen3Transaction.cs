using System.Buffers.Binary;
using System.Text.Json.Nodes;
using Pokerace.Client.Bridge;
using static Pokerace.Client.Games.Pokemon.Gen3.Gen3PokemonDecoder;

namespace Pokerace.Client.Games.Pokemon.Gen3;

/// <summary>
/// One verified Gen III write: identity and memory checks, a consistent read of money and party, then a single
/// bridge compareWrite. The bridge re-checks every "expected" byte (pointers, key, money, party, counter) on the
/// emulator thread before writing and reads everything back, so a game that changed in between is never written.
/// Offsets are the ones already validated by the read adapter and the purchase (no new address).
/// </summary>
public sealed class Gen3Transaction
{
    public const int SlotSize = 100, PartySize = 600;
    private readonly ITransactionalBridge transaction;
    private readonly string gameHash;
    private readonly byte[] ptr1, ptr2, key, moneyBytes, count;
    public Gen3MemoryProfile Profile { get; }
    public long SaveBlock1 { get; }
    public long SaveBlock2 { get; }
    public uint Money { get; }
    public int Count => count[0];
    public byte[] Party { get; }
    public Gen3PokemonDecoder Decoder { get; }

    private Gen3Transaction(ITransactionalBridge transaction, string gameHash, Gen3MemoryProfile profile, byte[] ptr1, byte[] ptr2, byte[] key, byte[] money, byte[] count, byte[] party)
    {
        this.transaction = transaction; this.gameHash = gameHash; Profile = profile;
        this.ptr1 = ptr1; this.ptr2 = ptr2; this.key = key; moneyBytes = money; this.count = count; Party = party;
        SaveBlock1 = U32(ptr1); SaveBlock2 = U32(ptr2); Money = U32(money) ^ U32(key);
        Decoder = new Gen3PokemonDecoder(Gen3ProfileRegistry.Resource("game-data"), profile.Language);
    }

    public static async Task<Gen3Transaction> BeginAsync(IBridgeClient bridge, LocalRomIdentity? identity, CancellationToken cancellation, string unavailableCode = "write_unavailable", bool requireWritableProfile = true, bool write = true)
    {
        if (identity == null || bridge is not ITransactionalBridge transaction) throw new ClientException(unavailableCode, "Launch a recognized ROM with the updated bridge.");
        var (_, profile) = new Gen3ProfileRegistry().Resolve(identity);
        var game = await bridge.GetGameInfoAsync(cancellation);
        if (profile == null || !identity.MatchesLoadedGame(game) || await bridge.GetSystemAsync(cancellation) != "GBA" || !Gen3Memory.HasDomains(await bridge.GetMemoryDomainsAsync(cancellation)))
            throw new ClientException(unavailableCode, "ROM identity or memory domains unavailable.");
        // Purchases predate write-validated profiles (requireWritableProfile: false) but still never write a fallback ROM.
        if (write && profile.Match != Gen3ProfileRegistry.ExactHash) throw new ClientException("rom_not_validated", "This exact ROM is not validated: read only.");
        if (requireWritableProfile && !profile.AllowWrites) throw new ClientException("profile_read_only", "This ROM profile is validated for reading only.");
        var memory = new Gen3Memory(bridge);
        var ptr1 = await memory.ReadAsync(profile.SaveBlock1Pointer, 4, cancellation);
        var ptr2 = await memory.ReadAsync(profile.SaveBlock2Pointer, 4, cancellation);
        var sb1 = U32(ptr1); var sb2 = U32(ptr2);
        if (sb1 < 0x02000000 || sb1 + 0x494 > 0x02040000 || sb2 < 0x02000000 || sb2 + 0xB0 > 0x02040000) throw new ClientException("state_changed", "Save blocks unavailable.");
        var key = await memory.ReadAsync(sb2 + 0xAC, 4, cancellation);
        var money = await memory.ReadAsync(sb1 + 0x490, 4, cancellation);
        var count = await memory.ReadAsync(profile.PartyCountAddress, 1, cancellation);
        if (count[0] > 6) throw new ClientException("state_changed", "Party counter is invalid.");
        var party = await memory.ReadAsync(profile.PartyAddress, PartySize, cancellation);
        var tx = new Gen3Transaction(transaction, game!["hash"]!.GetValue<string>(), profile, ptr1, ptr2, key, money, count, party);
        if (tx.Money > 999999) throw new ClientException("state_changed", "Money is out of range.");
        // Never rewrite a party we cannot read back: every current member must decode.
        for (var i = 0; i < tx.Count; i++) tx.DecodeSlot(i + 1);
        return tx;
    }

    public PokemonSnapshot DecodeSlot(int slot)
    {
        try { return Decoder.Decode(Party.AsSpan((slot - 1) * SlotSize, SlotSize), slot); }
        catch (Exception e) when (e is not ClientException) { throw new ClientException("state_changed", "Party data is invalid."); }
    }
    public string SlotRaw(int slot) => Convert.ToHexString(Party, (slot - 1) * SlotSize, SlotSize).ToLowerInvariant();

    // Validates a copy received from the server before it can reach the game.
    public byte[] ValidCopy(string hex, int slot)
    {
        var raw = BridgeProtocol.Hex(hex);
        if (raw.Length != SlotSize) throw new ClientException("invalid_pokemon", "A party Pokémon is exactly 100 bytes.");
        try { Decoder.Decode(raw, slot); }
        catch (Exception e) when (e is not ClientException) { throw new ClientException("invalid_pokemon", "Pokémon copy is invalid."); }
        return raw;
    }

    public byte[] EncodeMoney(long value)
    {
        if (value is < 0 or > 999999) throw new ClientException("invalid_money", "Money must stay between 0 and 999999.");
        var bytes = new byte[4]; BinaryPrimitives.WriteUInt32LittleEndian(bytes, (uint)value ^ U32(key)); return bytes;
    }

    public static JsonObject Edit(long address, byte[] before, byte[]? after = null) => new()
    {
        ["domain"] = address >= 0x03000000 ? "IWRAM" : "EWRAM", ["address"] = address - (address >= 0x03000000 ? 0x03000000 : 0x02000000),
        ["expected"] = Convert.ToHexString(before), ["data"] = after == null ? null : Convert.ToHexString(after)
    };

    // Pointers and key are always part of the comparison, so a save load or a new game aborts the write.
    // "extra" edits join the same atomic compareWrite (12 edits at most, these 6 included).
    public Task CommitAsync(CancellationToken cancellation, byte[]? money = null, byte[]? party = null, int? newCount = null, IEnumerable<JsonObject>? extra = null)
    {
        var edits = new JsonArray(Edit(Profile.SaveBlock1Pointer, ptr1), Edit(Profile.SaveBlock2Pointer, ptr2), Edit(SaveBlock2 + 0xAC, key),
            Edit(SaveBlock1 + 0x490, moneyBytes, money), Edit(Profile.PartyAddress, Party, party), Edit(Profile.PartyCountAddress, count, newCount == null ? null : [(byte)newCount]));
        foreach (var edit in extra ?? []) edits.Add(edit);
        return transaction.CompareWriteAsync(gameHash, edits, cancellation);
    }
}
