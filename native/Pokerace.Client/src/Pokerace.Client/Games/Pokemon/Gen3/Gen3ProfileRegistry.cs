using System.Text.Json.Nodes;

namespace Pokerace.Client.Games.Pokemon.Gen3;

public sealed record Gen3MemoryProfile(string ProfileId, string Language, string Revision, long SaveBlock1Pointer,
    long SaveBlock2Pointer, long PartyAddress, long PartyCountAddress);

public sealed class Gen3ProfileRegistry(Func<string, JsonObject>? resource = null)
{
    public static JsonObject Resource(string name)
    {
        using var stream = typeof(Gen3ProfileRegistry).Assembly.GetManifestResourceStream("Games." + name + ".json")
            ?? throw new InvalidDataException("Missing bundled game data.");
        return JsonNode.Parse(stream)!.AsObject();
    }
    public (string Status, Gen3MemoryProfile? Profile) Resolve(string sha256)
    {
        var load = resource ?? Resource;
        var entry = load("rom-manifest")["roms"]!.AsArray().FirstOrDefault(r =>
            string.Equals(r!["sha256"]!.GetValue<string>(), sha256, StringComparison.OrdinalIgnoreCase));
        if (entry == null) return ("unknown_rom", null);
        if (entry["validated"]?.GetValue<bool>() != true) return ("profile_not_validated", null);
        var id = entry["profileId"]!.GetValue<string>();
        var p = load(id);
        if (p["status"]?.GetValue<string>() != "read-validated" || p["profileId"]?.GetValue<string>() != id ||
            p["language"]?.GetValue<string>() != entry["language"]?.GetValue<string>() ||
            p["revision"]?.GetValue<string>() != entry["revision"]?.GetValue<string>()) return ("profile_not_validated", null);
        var profile = new Gen3MemoryProfile(id, p["language"]!.GetValue<string>(), p["revision"]!.GetValue<string>(),
            (long)p["saveBlock1Pointer"]!, (long)p["saveBlock2Pointer"]!, (long)p["partyAddress"]!, (long)p["partyCountAddress"]!);
        if (!Gen3Memory.IsMapped(profile.SaveBlock1Pointer, 4) || !Gen3Memory.IsMapped(profile.SaveBlock2Pointer, 4) ||
            !Gen3Memory.IsMapped(profile.PartyAddress, 600) || !Gen3Memory.IsMapped(profile.PartyCountAddress, 1)) return ("profile_not_validated", null);
        return ("ready", profile);
    }
}
