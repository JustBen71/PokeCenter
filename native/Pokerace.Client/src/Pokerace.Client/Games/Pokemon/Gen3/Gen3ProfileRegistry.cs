using System.Text.Json.Nodes;

namespace Pokerace.Client.Games.Pokemon.Gen3;

public sealed record Gen3MemoryProfile(string ProfileId, string Language, string Revision, long SaveBlock1Pointer,
    long SaveBlock2Pointer, long PartyAddress, long PartyCountAddress, bool AllowWrites = false, Gen3BattleAddresses? Battle = null, Gen3DefeatAddresses? Defeat = null,
    Gen3EventAddresses? Events = null, string Match = Gen3ProfileRegistry.ExactHash);

public sealed class Gen3ProfileRegistry(Func<string, JsonObject>? resource = null)
{
    // EXACT_HASH: this very ROM was validated, every capability of the profile applies.
    // REVISION_FALLBACK: unknown ROM (randomized) with the header of a validated revision: read only, never written.
    public const string ExactHash = "EXACT_HASH", RevisionFallback = "REVISION_FALLBACK";
    public static JsonObject Resource(string name)
    {
        using var stream = typeof(Gen3ProfileRegistry).Assembly.GetManifestResourceStream("Games." + name + ".json")
            ?? throw new InvalidDataException("Missing bundled game data.");
        return JsonNode.Parse(stream)!.AsObject();
    }
    public (string Status, Gen3MemoryProfile? Profile) Resolve(LocalRomIdentity identity) => Resolve(identity.Sha256, identity.Revision);
    // Exact hash first; otherwise a header match (randomized ROM of a known revision, same RAM layout).
    public (string Status, Gen3MemoryProfile? Profile) Resolve(string sha256, string? revision = null)
    {
        var load = resource ?? Resource;
        var roms = load("rom-manifest")["roms"]!.AsArray();
        var entry = roms.FirstOrDefault(r => string.Equals(r!["sha256"]!.GetValue<string>(), sha256, StringComparison.OrdinalIgnoreCase));
        var match = ExactHash;
        if (entry == null && revision != null)
        {
            entry = roms.FirstOrDefault(r => r!["revision"]?.GetValue<string>() == revision && r["validated"]?.GetValue<bool>() == true);
            match = RevisionFallback;
        }
        if (entry == null) return ("unknown_rom", null);
        if (entry["validated"]?.GetValue<bool>() != true) return ("profile_not_validated", null);
        var id = entry["profileId"]!.GetValue<string>();
        var p = load(id);
        if (p["status"]?.GetValue<string>() != "read-validated" || p["profileId"]?.GetValue<string>() != id ||
            p["language"]?.GetValue<string>() != entry["language"]?.GetValue<string>() ||
            p["revision"]?.GetValue<string>() != entry["revision"]?.GetValue<string>()) return ("profile_not_validated", null);
        var profile = new Gen3MemoryProfile(id, p["language"]!.GetValue<string>(), p["revision"]!.GetValue<string>(),
            (long)p["saveBlock1Pointer"]!, (long)p["saveBlock2Pointer"]!, (long)p["partyAddress"]!, (long)p["partyCountAddress"]!,
            p["allowWrites"]?.GetValue<bool>() == true, Gen3BattleAddresses.From(p["battle"] as JsonObject), Gen3DefeatAddresses.From(p["defeat"] as JsonObject),
            Gen3EventAddresses.From(p["events"] as JsonObject));
        if (!Gen3Memory.IsMapped(profile.SaveBlock1Pointer, 4) || !Gen3Memory.IsMapped(profile.SaveBlock2Pointer, 4) ||
            !Gen3Memory.IsMapped(profile.PartyAddress, 600) || !Gen3Memory.IsMapped(profile.PartyCountAddress, 1)) return ("profile_not_validated", null);
        return ("ready", match == ExactHash ? profile : profile with { AllowWrites = false, Match = RevisionFallback });
    }
}
