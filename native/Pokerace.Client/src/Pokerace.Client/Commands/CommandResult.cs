using System.Text.Json.Nodes;
using Pokerace.Client.Server;

namespace Pokerace.Client.Commands;

public sealed record CommandResult(string? CommandId, bool Ok, JsonObject? Result = null, string? ErrorCode = null)
{
    public static string? ReadId(JsonObject message) => message["commandId"] is JsonValue v && v.TryGetValue<string>(out var raw) && Guid.TryParseExact(raw, "D", out var id)
        ? id.ToString("D") : null;
    public JsonObject ToMessage()
    {
        var message = ServerProtocol.Message("COMMAND_ACK");
        message["commandId"] = CommandId;
        message["ok"] = Ok;
        if (Ok) message["result"] = Result?.DeepClone() ?? new JsonObject();
        else message["error"] = new JsonObject { ["code"] = ErrorCode };
        return message;
    }
}
