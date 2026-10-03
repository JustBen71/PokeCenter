using System.Security.Cryptography;
using System.Text.Json.Nodes;

namespace Pokerace.Client.Games;

// Kept exclusively in process memory. SHA-256 is the manifest identity; the separately
// computed SHA-1 is only a correlation with BizHawk's loaded-game metadata.
public sealed record LocalRomIdentity(string Sha256, string Sha1)
{
    public static async Task<LocalRomIdentity> FromStreamAsync(Stream rom, CancellationToken cancellation)
    {
        rom.Position = 0;
        var sha256 = Convert.ToHexString(await SHA256.HashDataAsync(rom, cancellation)).ToLowerInvariant();
        rom.Position = 0;
        var sha1 = Convert.ToHexString(await SHA1.HashDataAsync(rom, cancellation)).ToLowerInvariant();
        return new(sha256, sha1);
    }
    public bool MatchesLoadedGame(JsonObject? game)
    {
        var hash = game?["hash"]?.GetValue<string>();
        return hash != null && new[] { Sha256, "SHA256:" + Sha256, Sha1, "SHA1:" + Sha1 }
            .Any(expected => string.Equals(hash, expected, StringComparison.OrdinalIgnoreCase));
    }
}
