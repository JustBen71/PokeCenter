using System.Buffers.Binary;
using System.Text;
using System.Text.Json.Nodes;

namespace Pokerace.Client.Games.Pokemon.Gen3;

public sealed class Gen3PokemonDecoder(JsonObject data, string language)
{
    private static readonly string[] Orders = ["GAEM", "GAME", "GEAM", "GEMA", "GMAE", "GMEA", "AGEM", "AGME", "AEGM", "AEMG", "AMGE", "AMEG", "EGAM", "EGMA", "EAGM", "EAMG", "EMGA", "EMAG", "MGAE", "MGEA", "MAGE", "MAEG", "MEGA", "MEAG"];
    public static ushort U16(ReadOnlySpan<byte> b) => BinaryPrimitives.ReadUInt16LittleEndian(b);
    public static uint U32(ReadOnlySpan<byte> b) => BinaryPrimitives.ReadUInt32LittleEndian(b);
    public string Text(ReadOnlySpan<byte> bytes)
    {
        var text = new StringBuilder();
        foreach (var b in bytes) { if (b == 255) break; text.Append(data["characters"]![b.ToString()]?.GetValue<string>() ?? "?"); }
        return text.ToString().Trim();
    }
    public PokemonSnapshot Decode(ReadOnlySpan<byte> bytes, int slot)
    {
        if (bytes.Length != 100 || slot is < 1 or > 6) throw new InvalidDataException("Invalid party structure.");
        var pid = U32(bytes); var ot = U32(bytes[4..]); var key = pid ^ ot;
        Span<byte> decrypted = stackalloc byte[48];
        for (var i = 0; i < 12; i++) BinaryPrimitives.WriteUInt32LittleEndian(decrypted[(i * 4)..], U32(bytes[(32 + i * 4)..]) ^ key);
        var checksum = 0;
        for (var i = 0; i < 24; i++) checksum += U16(decrypted[(i * 2)..]);
        if ((checksum & 65535) != U16(bytes[28..])) throw new InvalidDataException("Invalid Pokemon checksum.");
        var internalSpecies = U16(decrypted[(Orders[pid % 24].IndexOf('G') * 12)..]);
        var species = data["internalToNational"]![internalSpecies.ToString()]?.GetValue<int>() ?? 0;
        var level = bytes[84]; var hp = U16(bytes[86..]); var maxHp = U16(bytes[88..]);
        if (species is < 1 or > 386 || level is < 1 or > 100 || maxHp is < 1 or > 999 || hp > maxHp)
            throw new InvalidDataException("Invalid Pokemon fields.");
        var nickname = Text(bytes.Slice(8, 10));
        return new(slot, species, data["species"]![language]![species.ToString()]!.GetValue<string>(), nickname.Length == 0 ? null : nickname,
            level, hp, maxHp, ((ot & 65535) ^ (ot >> 16) ^ (pid & 65535) ^ (pid >> 16)) < 8, Convert.ToHexString(bytes).ToLowerInvariant());
    }
}
