using System.Text.Json.Nodes;
using Pokerace.Client.Bridge;
using Pokerace.Client.Server;

namespace Pokerace.Client.Commands;

public sealed record CommandContext(Guid Id, string Command, JsonObject Payload)
{
    public static CommandContext Parse(JsonObject message)
    {
        if (BridgeProtocol.Text(message, "type") != "COMMAND") throw new ClientException("invalid_command", "Expected COMMAND.");
        if (!Guid.TryParseExact(BridgeProtocol.Text(message, "commandId"), "D", out var id) || id == Guid.Empty)
            throw new ClientException("invalid_command_id", "commandId must be a nonempty UUID.");
        ServerProtocol.CheckVersion(message);
        if (message["payload"] is not JsonObject payload) throw new ClientException("invalid_command", "Expected payload object.");
        return new(id, BridgeProtocol.Text(message, "command"), (JsonObject)payload.DeepClone());
    }
}
