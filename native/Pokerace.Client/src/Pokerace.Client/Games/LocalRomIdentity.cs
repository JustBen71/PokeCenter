using System.Security.Cryptography;
using System.Text.Json.Nodes;

namespace Pokerace.Client.Games;

// Kept exclusively in process memory. SHA-256 is the manifest identity; the separately
// computed SHA-1 is only a correlation with BizHawk's loaded-game metadata.
// Revision ("BPEF v0") comes from the GBA header: randomizers change the hash but keep it.
public sealed record LocalRomIdentity(string Sha256, string Sha1, string? Revision = null)
{
    public static async Task<LocalRomIdentity> FromStreamAsync(Stream rom, CancellationToken cancellation)
    {
        rom.Position = 0;
        var sha256 = Convert.ToHexString(await SHA256.HashDataAsync(rom, cancellation)).ToLowerInvariant();
        rom.Position = 0;
        var sha1 = Convert.ToHexString(await SHA1.HashDataAsync(rom, cancellation)).ToLowerInvariant();
        var header = new byte[0xBD];
        rom.Position = 0;
        var read = await rom.ReadAtLeastAsync(header, header.Length, false, cancellation);
        var code = System.Text.Encoding.ASCII.GetString(header, 0xAC, 4);
        var revision = read == header.Length && code.All(char.IsAsciiLetterOrDigit) ? $"{code} v{header[0xBC]}" : null;
        return new(sha256, sha1, revision);
    }
    public bool MatchesLoadedGame(JsonObject? game)
    {
        var hash = game?["hash"]?.GetValue<string>();
        return hash != null && new[] { Sha256, "SHA256:" + Sha256, Sha1, "SHA1:" + Sha1 }
            .Any(expected => string.Equals(hash, expected, StringComparison.OrdinalIgnoreCase));
    }
}
