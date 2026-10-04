using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Nodes;
using Pokerace.Client.Bridge;
using Pokerace.Client.Configuration;

namespace Pokerace.Client.Commands;

public sealed class CommandRouter(IBridgeClient bridge, ClientConfiguration configuration, int capacity = 4096, Pokerace.Client.Games.LocalRomIdentity? romIdentity = null)
{
    private readonly object sync = new();
    private readonly Dictionary<Guid, (string Fingerprint, Task<CommandResult> Task)> cache = new();
    public Task<CommandResult> RouteAsync(JsonObject message, CancellationToken lifetime)
    {
        CommandContext command;
        try { command = CommandContext.Parse(message); }
        catch (ClientException e)
        {
            return Task.FromResult(new CommandResult(CommandResult.ReadId(message), false, ErrorCode: e.Code));
        }
        var fingerprint = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(command.Command + "\n" + Canonical(command.Payload).ToJsonString())));
        lock (sync)
        {
            if (cache.TryGetValue(command.Id, out var previous))
                return previous.Fingerprint == fingerprint ? previous.Task : Task.FromResult(Failure(command, "command_id_reused"));
            // Fail closed instead of evicting write IDs and allowing them to execute twice.
            if (cache.Count >= capacity) return Task.FromResult(Failure(command, "command_cache_full"));
            var completion = new TaskCompletionSource<CommandResult>(TaskCreationOptions.RunContinuationsAsynchronously);
            cache.Add(command.Id, (fingerprint, completion.Task));
            _ = ExecuteAndCompleteAsync(command, completion, lifetime);
            return completion.Task;
        }
    }
    private static JsonNode Canonical(JsonNode node) => node switch
    {
        JsonObject obj => new JsonObject(obj.OrderBy(p => p.Key, StringComparer.Ordinal).Select(p => new KeyValuePair<string, JsonNode?>(p.Key, p.Value == null ? null : Canonical(p.Value)))),
        JsonArray array => new JsonArray(array.Select(n => n == null ? null : Canonical(n)).ToArray()),
        _ => node.DeepClone()
    };
    private static CommandResult Failure(CommandContext command, string code) => new(command.Id.ToString("D"), false, ErrorCode: code);
    private async Task ExecuteAndCompleteAsync(CommandContext command, TaskCompletionSource<CommandResult> completion, CancellationToken lifetime)
    {
        try
        {
            var result = await ExecuteAsync(command, lifetime);
            completion.TrySetResult(new(command.Id.ToString("D"), true, result));
        }
        catch (ClientException e) { completion.TrySetResult(Failure(command, e.Code)); }
        catch (OperationCanceledException) { completion.TrySetResult(Failure(command, "outcome_unknown")); }
        catch (Exception) { completion.TrySetResult(Failure(command, "bridge_transport_error")); }
    }
    private async Task<JsonObject> ExecuteAsync(CommandContext command, CancellationToken cancellation)
    {
        if (command.Command == "pokemon.purchase")
        {
            if (!configuration.AllowPokemonPurchases) throw new ClientException("writes_disabled", "Pokemon purchases disabled locally.");
            return await Pokerace.Client.Games.Pokemon.Gen3.Gen3Purchase.ExecuteAsync(bridge, romIdentity, command.Payload, cancellation);
        }
        // Business writes go through the game adapter only; "allowPokemonPurchases" is the local switch for all of them.
        if (Pokerace.Client.Games.Pokemon.Gen3.Gen3Writes.Commands.Contains(command.Command))
        {
            if (command.Command != "game.party.snapshot" && !configuration.AllowPokemonPurchases) throw new ClientException("writes_disabled", "Game writes disabled locally.");
            return await Pokerace.Client.Games.Pokemon.Gen3.Gen3Writes.ExecuteAsync(command.Command, bridge, romIdentity, command.Payload, cancellation);
        }
        if (command.Command == "bridge.writeMemory" && !configuration.AllowMemoryWrites)
            throw new ClientException("writes_disabled", "Memory writes are disabled locally.");
        if (!new[] { "bridge.ping", "bridge.getStatus", "bridge.getSystem", "bridge.getGameInfo", "bridge.listMemoryDomains", "bridge.readMemory", "bridge.writeMemory" }.Contains(command.Command))
            throw new ClientException("unknown_command", "Unknown generic command.");
        if (!bridge.IsConnected) throw new ClientException("bridge_disconnected", "Bridge disconnected.");
        var payload = command.Payload;
        switch (command.Command)
        {
            case "bridge.ping": await bridge.PingAsync(cancellation); return new() { ["type"] = "pong" };
            case "bridge.getStatus":
                var status = await bridge.GetStatusAsync(cancellation);
                return new() { ["connected"] = status.Connected, ["gameLoaded"] = status.GameLoaded, ["systemId"] = status.SystemId, ["protocolVersion"] = status.ProtocolVersion };
            case "bridge.getSystem": return new() { ["systemId"] = await bridge.GetSystemAsync(cancellation) };
            case "bridge.getGameInfo": return new() { ["game"] = await bridge.GetGameInfoAsync(cancellation) };
            case "bridge.listMemoryDomains":
                var domains = await bridge.GetMemoryDomainsAsync(cancellation);
                return new() { ["domains"] = new JsonArray(domains.Select(d => (JsonNode)new JsonObject { ["name"] = d.Name, ["size"] = d.Size, ["writable"] = d.Writable }).ToArray()) };
            case "bridge.readMemory":
                var length = BridgeProtocol.Integer(payload, "length");
                if (length is < 1 or > BridgeProtocol.MaxTransfer) throw new ClientException("invalid_range", "Invalid length.");
                var bytes = await bridge.ReadMemoryAsync(BridgeProtocol.Text(payload, "domain"), BridgeProtocol.Integer(payload, "address"), (int)length, cancellation);
                return new() { ["data"] = Convert.ToHexString(bytes).ToLowerInvariant() };
            case "bridge.writeMemory":
                var data = BridgeProtocol.Hex(BridgeProtocol.Text(payload, "data"));
                await bridge.WriteMemoryAsync(BridgeProtocol.Text(payload, "domain"), BridgeProtocol.Integer(payload, "address"), data, cancellation);
                return new() { ["written"] = data.Length, ["verified"] = true };
            default: throw new InvalidOperationException();
        }
    }
}
