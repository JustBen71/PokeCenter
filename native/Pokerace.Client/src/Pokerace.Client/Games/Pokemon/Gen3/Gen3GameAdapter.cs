using Pokerace.Client.Bridge;
using static Pokerace.Client.Games.Pokemon.Gen3.Gen3PokemonDecoder;

namespace Pokerace.Client.Games.Pokemon.Gen3;

public sealed class Gen3GameAdapter(IBridgeClient bridge, Gen3MemoryProfile profile, bool writesEnabled = false, BattleEncounterStore? battles = null) : IGameAdapter
{
    public static readonly string[] ReadCapabilities = ["trainer.read", "money.read", "party.read", "location.read", "progression.read"];
    public static readonly string[] WriteCapabilities = ["money.write", "party.write", "pokemon.insert", "pokemon.remove", "pokemon.replace"];
    // Writes are announced only for a write-validated profile, a transactional bridge and local consent.
    private readonly string[] capabilities = writesEnabled && profile.AllowWrites && bridge is ITransactionalBridge
        ? ReadCapabilities.Concat(WriteCapabilities).Concat(profile.Battle != null && battles != null ? [Gen3BattleEncounter.Capability] : []).ToArray() : ReadCapabilities;
    private readonly Gen3Memory memory = new(bridge);
    private readonly System.Text.Json.Nodes.JsonObject data = Gen3ProfileRegistry.Resource("game-data");
    private readonly System.Text.Json.Nodes.JsonObject progression = Gen3ProfileRegistry.Resource("progression");
    public async Task<GameSnapshot> ReadAsync(CancellationToken cancellation)
    {
        var ptr1 = await memory.ReadAsync(profile.SaveBlock1Pointer, 4, cancellation);
        var ptr2 = await memory.ReadAsync(profile.SaveBlock2Pointer, 4, cancellation);
        var sb1 = U32(ptr1); var sb2 = U32(ptr2);
        var flagOffset = (int)progression["flagsOffset"]!;
        var objectives = progression["objectives"]!.AsArray();
        var flagLength = objectives.SelectMany(o => o!["flags"]!.AsArray()).Max(f => (int)f!) / 8 + 1;
        if (sb1 < 0x02000000 || sb1 + flagOffset + flagLength > 0x02040000 || sb2 < 0x02000000 || sb2 + 0xB0 > 0x02040000)
            throw new InvalidDataException("Save blocks unavailable.");
        var trainer = await memory.ReadAsync(sb2, 0xB0, cancellation);
        var location = await memory.ReadAsync(sb1 + 4, 2, cancellation);
        var money = U32(await memory.ReadAsync(sb1 + 0x490, 4, cancellation)) ^ U32(trainer.AsSpan(0xAC));
        var count = (await memory.ReadAsync(profile.PartyCountAddress, 1, cancellation))[0];
        var decoder = new Gen3PokemonDecoder(data, profile.Language);
        var name = decoder.Text(trainer.AsSpan(0, 7)); var hours = U16(trainer.AsSpan(14));
        if (name.Length == 0 || name.Contains('?') || hours > 9999 || trainer[16] > 59 || trainer[17] > 59 || count > 6 || money > 999999)
            throw new InvalidDataException("Invalid trainer fields.");
        var party = new PokemonSnapshot[count];
        if (count > 0)
        {
            var bytes = await memory.ReadAsync(profile.PartyAddress, count * 100, cancellation);
            for (var i = 0; i < count; i++) party[i] = decoder.Decode(bytes.AsSpan(i * 100, 100), i + 1);
        }
        var flags = await memory.ReadAsync(sb1 + flagOffset, flagLength, cancellation);
        var completed = objectives.Where(o => o!["flags"]!.AsArray().Any(f => (flags[(int)f! / 8] & (1 << ((int)f! % 8))) != 0)).Select(o => (string)o!["id"]!).ToArray();
        // Save loads and party edits between requests invalidate this observation.
        if (!ptr1.SequenceEqual(await memory.ReadAsync(profile.SaveBlock1Pointer, 4, cancellation)) ||
            !ptr2.SequenceEqual(await memory.ReadAsync(profile.SaveBlock2Pointer, 4, cancellation)) ||
            count != (await memory.ReadAsync(profile.PartyCountAddress, 1, cancellation))[0]) throw new InvalidDataException("Game changed during observation.");
        var battle = capabilities.Contains(Gen3BattleEncounter.Capability) ? await Gen3BattleEncounter.TrackAsync(bridge, profile, profile.Battle!, battles!, cancellation) : null;
        var adapter = new GameAdapterState("pokemon.emerald.gen3", "ready", profile.ProfileId, capabilities);
        return new(GameObservation.GameStateVersion, adapter, new("pokemon", 3, "emerald", profile.Language, profile.Revision),
            new(name, money, hours * 3600 + trainer[16] * 60 + trainer[17], count),
            new(location[0], location[1], data["maps"]![profile.Language]![$"{location[0]}:{location[1]}"]?.GetValue<string>() ?? $"Zone inconnue ({location[0]}:{location[1]})"),
            party, new(1, completed), capabilities, DateTimeOffset.UtcNow.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'"), battle);
    }
}
