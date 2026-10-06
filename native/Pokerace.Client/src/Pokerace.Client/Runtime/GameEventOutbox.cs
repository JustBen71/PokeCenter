using System.Text.Json;
using System.Text.Json.Nodes;
using Pokerace.Client.Server;

namespace Pokerace.Client.Runtime;

/// <summary>
/// Game events waiting for the server's GAME_EVENT_ACK. Kept on disk (atomic write) so an event that may give a
/// reward survives a network cut or a client restart; it is re-sent with the same eventId until acknowledged,
/// and the server never applies it twice. No memory address is stored, only the event payload.
/// </summary>
public sealed class GameEventOutbox
{
    public const int Capacity = 200;
    private readonly string? path;
    private readonly object gate = new();
    private readonly List<JsonObject> items;

    public GameEventOutbox(string? path)
    {
        this.path = path;
        items = path != null && File.Exists(path)
            ? (JsonNode.Parse(File.ReadAllText(path)) as JsonArray ?? []).OfType<JsonObject>().Take(Capacity).Select(i => (JsonObject)i.DeepClone()).ToList()
            : [];
    }

    // Named after the configuration file: two clients configured in the same folder never share their outbox.
    public static string PathNextTo(string configPath) => Path.ChangeExtension(Path.GetFullPath(configPath), null) + ".game-events.json";

    /// <summary>Records a new event; null when the outbox is full (the server has been unreachable for too long).</summary>
    public JsonObject? Enqueue(string kind, JsonObject data)
    {
        var payload = ServerProtocol.Message("GAME_EVENT");
        payload["eventVersion"] = 1;
        payload["eventId"] = Guid.NewGuid().ToString("D");
        payload["kind"] = kind;
        payload["observedAt"] = DateTime.UtcNow.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'");
        payload["data"] = data.DeepClone();
        lock (gate)
        {
            if (items.Count >= Capacity) return null;
            items.Add(payload); Save();
        }
        return (JsonObject)payload.DeepClone();
    }

    public IReadOnlyList<JsonObject> Pending() { lock (gate) return items.Select(i => (JsonObject)i.DeepClone()).ToList(); }

    /// <summary>Removes an acknowledged (or permanently refused) event. Unknown ids are ignored.</summary>
    public bool Acknowledge(string eventId)
    {
        lock (gate)
        {
            var removed = items.RemoveAll(i => (string?)i["eventId"] == eventId) > 0;
            if (removed) Save();
            return removed;
        }
    }

    private void Save()
    {
        if (path == null) return;
        Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(path))!);
        var temporary = path + ".tmp";
        File.WriteAllText(temporary, new JsonArray(items.Select(i => (JsonNode)i.DeepClone()).ToArray()).ToJsonString(new JsonSerializerOptions { WriteIndented = false }));
        File.Move(temporary, path, true);
    }
}
