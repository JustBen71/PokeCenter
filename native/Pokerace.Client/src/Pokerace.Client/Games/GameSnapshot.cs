using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;

namespace Pokerace.Client.Games;

public sealed record GameAdapterState(string? Id, string Status, string? ProfileId, string[] Capabilities);
public sealed record GameIdentity(string Family, int Generation, string Title, string Language, string Revision);
public sealed record TrainerSnapshot(string Name, uint Money, int PlayTimeSeconds, int PartyCount);
public sealed record LocationSnapshot(int MapGroup, int MapNumber, string Label);
// Common fields for every generation; Artifact carries the generation-specific copy used by writes (e.g. gen3-party-v1).
public sealed record PokemonArtifactSnapshot(string Format, string Raw)
{
    public const string Gen3Party = "gen3-party-v1";
}
public sealed record PokemonSnapshot(int Slot, int SpeciesId, string SpeciesName, string? Nickname, int Level, int CurrentHp, int MaxHp, bool Shiny,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] PokemonArtifactSnapshot? Artifact = null);
public sealed record ProgressionSnapshot(int Version, string[] Completed);
public sealed record GameSnapshot(int GameStateVersion, GameAdapterState Adapter, GameIdentity Game, TrainerSnapshot Trainer,
    LocationSnapshot Location, PokemonSnapshot[] Party, ProgressionSnapshot Progression, string[] Capabilities, string ObservedAt);
public sealed record GameObservation(GameAdapterState Adapter, GameSnapshot? State)
{
    // Version 2 = generic multi-generation contract (packages/shared/src/native-client.ts).
    public const int GameStateVersion = 2;
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    public static GameObservation Unavailable(string status, string? profileId = null) =>
        new(new(profileId == null ? null : "pokemon.emerald.gen3", status, profileId, []), null);
    public JsonObject ToMessage() => new()
    {
        ["type"] = "GAME_STATE", ["protocolVersion"] = 1, ["gameStateVersion"] = GameStateVersion,
        ["adapter"] = JsonSerializer.SerializeToNode(Adapter, Json), ["state"] = JsonSerializer.SerializeToNode(State, Json)
    };
    public string ContentKey() => JsonSerializer.Serialize(this with { State = State == null ? null : State with { ObservedAt = "" } }, Json);
}
public interface IGameAdapter
{
    Task<GameSnapshot> ReadAsync(CancellationToken cancellation);
}
