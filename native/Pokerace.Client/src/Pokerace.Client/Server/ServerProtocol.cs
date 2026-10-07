using System.Runtime.InteropServices;
using System.Text.Json.Nodes;
using Pokerace.Client.Bridge;
using Pokerace.Client.Configuration;

namespace Pokerace.Client.Server;

public static class ServerProtocol
{
    public const int Version = 1;
    public const string ClientVersion = "0.2.1";
    public const string Namespace = "/client";
    public static JsonObject Message(string type) => new() { ["type"] = type, ["protocolVersion"] = Version };
    public static JsonObject BridgeState(BridgeStatus status) => new()
    { ["type"] = "bizhawk", ["connected"] = status.Connected, ["protocolVersion"] = status.Connected ? status.ProtocolVersion : null, ["gameLoaded"] = status.GameLoaded };
    public static JsonObject Hello(ClientConfiguration configuration, BridgeStatus status)
    {
        var result = Message("HELLO");
        result["clientVersion"] = ClientVersion;
        result["playerId"] = configuration.PlayerId;
        result["platform"] = (OperatingSystem.IsWindows() ? "windows" : OperatingSystem.IsMacOS() ? "macos" : "linux") + "-" + RuntimeInformation.ProcessArchitecture.ToString().ToLowerInvariant();
        result["bridge"] = BridgeState(status);
        result["emulator"] = status.Connected ? new JsonObject { ["name"] = "BizHawk" } : null;
        result["system"] = status.SystemId;
        return result;
    }
    public static JsonObject BridgeStatusMessage(BridgeStatus status)
    { var result = Message("BRIDGE_STATUS"); result["bridge"] = BridgeState(status); result["system"] = status.SystemId; return result; }
    public static JsonObject Heartbeat(BridgeStatus status)
    { var result = Message("HEARTBEAT"); result["clientVersion"] = ClientVersion; result["bridgeConnected"] = status.Connected; result["system"] = status.SystemId; return result; }
    public static void CheckVersion(JsonObject value)
    {
        if (BridgeProtocol.Integer(value, "protocolVersion") != Version)
            throw new ClientException("protocol_mismatch", "Unsupported server protocol version.");
    }
}

public sealed record ServerMessage(string Type, JsonObject Payload, string? TransportAckId = null);
