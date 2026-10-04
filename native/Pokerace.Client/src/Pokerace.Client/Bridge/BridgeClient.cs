using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Text.Json.Nodes;
using Pokerace.Client.Configuration;

namespace Pokerace.Client.Bridge;

public sealed class BridgeClient(ClientConfiguration configuration, Func<string?> tokenProvider) : IBridgeClient, ITransactionalBridge
{
    private readonly SemaphoreSlim gate = new(1);
    private TcpClient? tcp;
    private BoundedLineReader? reader;
    private volatile bool connected;
    public bool IsConnected => connected;
    public async Task ConnectAsync(CancellationToken cancellation)
    {
        configuration.Validate();
        await gate.WaitAsync(cancellation);
        try
        {
            if (connected) return;
            Close();
            var token = tokenProvider();
            if (string.IsNullOrWhiteSpace(token) || token.Length < 32)
                throw new ClientException("missing_bridge_token", "Set POKERACE_BRIDGE_TOKEN to the bridge session token (at least 32 characters).");
            using var deadline = CancellationTokenSource.CreateLinkedTokenSource(cancellation);
            deadline.CancelAfter(TimeSpan.FromSeconds(5));
            tcp = new TcpClient { NoDelay = true };
            await tcp.ConnectAsync(IPAddress.Loopback, configuration.BridgePort, deadline.Token);
            reader = new BoundedLineReader(tcp.GetStream());
            var response = await ExchangeAsync(new JsonObject { ["type"] = "hello", ["protocolVersion"] = BridgeProtocol.Version, ["sessionToken"] = token }, deadline.Token);
            if (BridgeProtocol.Integer(response, "protocolVersion") != BridgeProtocol.Version || BridgeProtocol.Text(response, "type") != "hello")
                throw new ClientException("protocol_mismatch", "Unsupported bridge protocol.");
            connected = true;
        }
        catch { Close(); throw; }
        finally { gate.Release(); }
    }
    private void Close() { connected = false; tcp?.Dispose(); tcp = null; reader = null; }
    public async Task DisconnectAsync()
    { await gate.WaitAsync(); try { Close(); } finally { gate.Release(); } }

    private async Task<JsonObject> ExchangeAsync(JsonObject request, CancellationToken cancellation)
    {
        var id = Guid.NewGuid().ToString("D"); request["id"] = id;
        var bytes = Encoding.UTF8.GetBytes(request.ToJsonString() + "\n");
        await tcp!.GetStream().WriteAsync(bytes, cancellation);
        var result = BridgeProtocol.Parse(await reader!.ReadAsync(cancellation));
        if (BridgeProtocol.Text(result, "id") != id) throw new ClientException("invalid_protocol", "Bridge response ID mismatch.");
        if (!BridgeProtocol.Boolean(result, "ok"))
        {
            var code = result["error"] is JsonObject error ? BridgeProtocol.Text(error, "code") : "bridge_error";
            // Only known codes are propagated; remote messages can contain arbitrary data/secrets.
            if (!new[] { "state_changed", "no_game", "unknown_domain", "read_only", "invalid_range", "invalid_data", "write_failed", "verification_failed", "host_error", "timeout", "protocol_mismatch", "unauthorized" }.Contains(code)) code = "bridge_error";
            throw new ClientException(code, "Bridge rejected the operation: " + code);
        }
        return result;
    }
    private async Task<JsonObject> CallAsync(JsonObject request, CancellationToken cancellation)
    {
        await gate.WaitAsync(cancellation);
        try
        {
            if (!connected) throw new ClientException("bridge_disconnected", "Bridge is disconnected.");
            using var deadline = CancellationTokenSource.CreateLinkedTokenSource(cancellation);
            deadline.CancelAfter(TimeSpan.FromSeconds(10));
            return await ExchangeAsync(request, deadline.Token);
        }
        catch (ClientException e) when (e.Code is not ("invalid_protocol" or "protocol_mismatch" or "timeout")) { throw; }
        catch { Close(); throw; }
        finally { gate.Release(); }
    }
    public async Task PingAsync(CancellationToken cancellation)
    {
        var result = await CallAsync(new JsonObject { ["type"] = "ping" }, cancellation);
        if (BridgeProtocol.Text(result, "type") != "pong") throw new ClientException("invalid_protocol", "Expected pong.");
    }
    public async Task<BridgeStatus> GetStatusAsync(CancellationToken cancellation)
    {
        var result = await CallAsync(new JsonObject { ["type"] = "getStatus" }, cancellation);
        if (BridgeProtocol.Integer(result, "protocolVersion") != BridgeProtocol.Version || BridgeProtocol.Text(result, "bridge") != "pokerace-bizhawk")
            throw new ClientException("protocol_mismatch", "Unsupported bridge identity/protocol.");
        return new(BridgeProtocol.Boolean(result, "connected"), BridgeProtocol.Boolean(result, "gameLoaded"), OptionalSystem(result), BridgeProtocol.Version);
    }
    private static string? OptionalSystem(JsonObject value) => value.ContainsKey("systemId") && value["systemId"] == null ? null : BridgeProtocol.Text(value, "systemId");
    public async Task<string?> GetSystemAsync(CancellationToken cancellation) => OptionalSystem(await CallAsync(new JsonObject { ["type"] = "getSystem" }, cancellation));
    public async Task<JsonObject?> GetGameInfoAsync(CancellationToken cancellation)
    {
        var result = await CallAsync(new JsonObject { ["type"] = "getGameInfo" }, cancellation);
        if (!result.ContainsKey("game") || result["game"] is not (null or JsonObject)) throw new ClientException("invalid_protocol", "Invalid game info.");
        return (JsonObject?)result["game"]?.DeepClone();
    }
    public async Task<IReadOnlyList<MemoryDomainInfo>> GetMemoryDomainsAsync(CancellationToken cancellation)
    {
        var response = await CallAsync(new JsonObject { ["type"] = "listMemoryDomains" }, cancellation);
        if (response["domains"] is not JsonArray domains) throw new ClientException("invalid_protocol", "Invalid memory domains.");
        return domains.Select(node =>
        {
            if (node is not JsonObject domain) throw new ClientException("invalid_protocol", "Invalid memory domain.");
            var size = BridgeProtocol.Integer(domain, "size");
            if (size < 0) throw new ClientException("invalid_protocol", "Invalid domain size.");
            return new MemoryDomainInfo(BridgeProtocol.Text(domain, "name"), size, BridgeProtocol.Boolean(domain, "writable"));
        }).ToArray();
    }
    public async Task<byte[]> ReadMemoryAsync(string domain, long address, int length, CancellationToken cancellation)
    {
        BridgeProtocol.Range(domain, address, length);
        var response = await CallAsync(new JsonObject { ["type"] = "readMemory", ["domain"] = domain, ["address"] = address, ["length"] = length }, cancellation);
        var bytes = BridgeProtocol.Hex(BridgeProtocol.Text(response, "data"));
        if (bytes.Length != length) throw new ClientException("invalid_protocol", "Unexpected read length.");
        return bytes;
    }
    public async Task WriteMemoryAsync(string domain, long address, ReadOnlyMemory<byte> data, CancellationToken cancellation)
    {
        if (!configuration.AllowMemoryWrites) throw new ClientException("writes_disabled", "Memory writes are disabled locally.");
        BridgeProtocol.Range(domain, address, data.Length);
        var response = await CallAsync(new JsonObject { ["type"] = "writeMemory", ["domain"] = domain, ["address"] = address, ["data"] = Convert.ToHexString(data.Span).ToLowerInvariant() }, cancellation);
        if (!BridgeProtocol.Boolean(response, "verified") || BridgeProtocol.Integer(response, "written") != data.Length)
            throw new ClientException("verification_failed", "Bridge did not confirm a verified write.");
    }
    public async Task CompareWriteAsync(string gameHash, JsonArray edits, CancellationToken cancellation)
    {
        if (!configuration.AllowPokemonPurchases) throw new ClientException("writes_disabled", "Pokemon purchases are disabled.");
        var response = await CallAsync(new JsonObject { ["type"] = "compareWrite", ["gameHash"] = gameHash, ["edits"] = edits }, cancellation);
        if (!BridgeProtocol.Boolean(response, "verified")) throw new ClientException("verification_failed", "Purchase not verified.");
    }
    public async ValueTask DisposeAsync() { await DisconnectAsync(); gate.Dispose(); }
}
