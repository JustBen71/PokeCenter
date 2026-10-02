using System.Net.WebSockets;
using System.Text;
using System.Text.Json.Nodes;
using Pokerace.Client.Bridge;
using Pokerace.Client.Configuration;

namespace Pokerace.Client.Server;

// Text-only Socket.IO protocol 5 / Engine.IO 4 over WebSocket, /client namespace.
// No polling, binary payloads, compression or permissive TLS certificate callbacks.
public sealed class ServerConnection(ClientConfiguration configuration) : IServerConnection
{
    private ClientWebSocket? socket;
    private readonly SemaphoreSlim sendGate = new(1);
    private TimeSpan receiveTimeout = TimeSpan.FromSeconds(45);
    private volatile bool connected;
    public bool IsConnected => connected && socket?.State == WebSocketState.Open;
    public async Task ConnectAsync(CancellationToken cancellation)
    {
        configuration.Validate();
        await DisconnectAsync();
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(cancellation);
        deadline.CancelAfter(TimeSpan.FromSeconds(10));
        var uri = new UriBuilder(configuration.ServerUrl);
        uri.Scheme = uri.Scheme is "https" or "wss" ? "wss" : "ws";
        uri.Path = "/socket.io/"; uri.Query = "EIO=4&transport=websocket";
        socket = new ClientWebSocket();
        try
        {
            await socket.ConnectAsync(uri.Uri, deadline.Token);
            var open = await ReadFrameAsync(deadline.Token);
            if (!open.StartsWith('0')) throw new ClientException("invalid_protocol", "Expected Engine.IO handshake.");
            var handshake = BridgeProtocol.Parse(open[1..]);
            BridgeProtocol.Text(handshake, "sid");
            var interval = BridgeProtocol.Integer(handshake, "pingInterval");
            var timeout = BridgeProtocol.Integer(handshake, "pingTimeout");
            if (interval is < 1 or > 120000 || timeout is < 1 or > 120000) throw new ClientException("invalid_protocol", "Invalid server heartbeat timing.");
            receiveTimeout = TimeSpan.FromMilliseconds(interval + timeout);
            var auth = new JsonObject { ["playerId"] = configuration.PlayerId, ["playerName"] = configuration.PlayerName,
                ["accountName"] = configuration.PlayerName, ["roomCode"] = configuration.RoomCode, ["protocolVersion"] = ServerProtocol.Version };
            await SendFrameAsync("40/client," + auth.ToJsonString(), deadline.Token);
            var accepted = false;
            while (true)
            {
                var frame = await ReadFrameAsync(deadline.Token);
                if (frame == "2") { await SendFrameAsync("3", deadline.Token); continue; }
                if (frame.StartsWith("44/client,", StringComparison.Ordinal)) throw new ClientException("server_rejected", "Server rejected authentication or protocol.");
                if (frame.StartsWith("40/client,", StringComparison.Ordinal))
                { BridgeProtocol.Text(BridgeProtocol.Parse(frame[10..]), "sid"); accepted = true; continue; }
                if (!accepted) throw new ClientException("invalid_protocol", "Namespace handshake missing.");
                var message = DecodeEvent(frame);
                if (message.Type != "SERVER_STATUS") throw new ClientException("invalid_protocol", "Expected SERVER_STATUS handshake.");
                ServerProtocol.CheckVersion(message.Payload);
                if (!BridgeProtocol.Boolean(message.Payload, "connected")) throw new ClientException("server_rejected", "Server is not ready.");
                connected = true; return;
            }
        }
        catch { await DisconnectAsync(); throw; }
    }
    public async Task<ServerMessage> ReceiveAsync(CancellationToken cancellation)
    {
        while (IsConnected)
        {
            var frame = await ReadFrameAsync(cancellation);
            if (frame == "2") { await SendFrameAsync("3", cancellation); continue; }
            if (frame is "1" or "41/client,") throw new IOException("Server disconnected.");
            return DecodeEvent(frame);
        }
        throw new IOException("Server disconnected.");
    }
    private static ServerMessage DecodeEvent(string frame)
    {
        const string prefix = "42/client,";
        if (!frame.StartsWith(prefix, StringComparison.Ordinal)) throw new ClientException("invalid_protocol", "Unsupported Socket.IO packet.");
        var tail = frame[prefix.Length..];
        var arrayStart = tail.IndexOf('[');
        if (arrayStart < 0 || arrayStart > 12 || tail[..arrayStart].Any(c => c is < '0' or > '9'))
            throw new ClientException("invalid_protocol", "Malformed Socket.IO event.");
        try
        {
            if (JsonNode.Parse(tail[arrayStart..], documentOptions: new() { MaxDepth = 16 }) is not JsonArray { Count: 2 } array || array[1] is not JsonObject payload)
                throw new ClientException("invalid_protocol", "Expected event name and object.");
            var type = array[0]?.GetValue<string>() ?? throw new InvalidOperationException();
            payload = BridgeProtocol.Parse(payload.ToJsonString());
            if (type != BridgeProtocol.Text(payload, "type")) throw new ClientException("invalid_protocol", "Event type mismatch.");
            return new(type, payload, arrayStart == 0 ? null : tail[..arrayStart]);
        }
        catch (Exception e) when (e is System.Text.Json.JsonException or InvalidOperationException or ArgumentException)
        { throw new ClientException("invalid_protocol", "Malformed Socket.IO event payload."); }
    }
    public Task SendAsync(string type, JsonObject payload, CancellationToken cancellation) =>
        SendFrameAsync("42/client," + new JsonArray(JsonValue.Create(type), payload.DeepClone()).ToJsonString(), cancellation);
    public Task SendTransportAckAsync(string id, JsonObject payload, CancellationToken cancellation)
    {
        if (id.Length is < 1 or > 12 || id.Any(c => c is < '0' or > '9')) throw new ClientException("invalid_protocol", "Invalid transport ACK ID.");
        return SendFrameAsync("43/client," + id + new JsonArray(payload.DeepClone()).ToJsonString(), cancellation);
    }
    private async Task SendFrameAsync(string frame, CancellationToken cancellation)
    {
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(cancellation);
        deadline.CancelAfter(TimeSpan.FromSeconds(5));
        await sendGate.WaitAsync(deadline.Token);
        try
        {
            var bytes = Encoding.UTF8.GetBytes(frame);
            if (bytes.Length > BridgeProtocol.MaxMessageBytes) throw new ClientException("invalid_protocol", "Message too large.");
            await (socket ?? throw new IOException()).SendAsync(bytes.AsMemory(), WebSocketMessageType.Text, true, deadline.Token);
        }
        finally { sendGate.Release(); }
    }
    private async Task<string> ReadFrameAsync(CancellationToken cancellation)
    {
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(cancellation);
        deadline.CancelAfter(receiveTimeout);
        using var message = new MemoryStream();
        var buffer = new byte[4096];
        while (true)
        {
            var part = await (socket ?? throw new IOException()).ReceiveAsync(buffer.AsMemory(), deadline.Token);
            if (part.MessageType != WebSocketMessageType.Text) throw new IOException("WebSocket closed or unsupported binary frame.");
            if (message.Length + part.Count > BridgeProtocol.MaxMessageBytes) throw new ClientException("invalid_protocol", "Message too large.");
            message.Write(buffer, 0, part.Count);
            if (part.EndOfMessage) return new UTF8Encoding(false, true).GetString(message.ToArray());
        }
    }
    public Task DisconnectAsync()
    { connected = false; socket?.Abort(); socket?.Dispose(); socket = null; return Task.CompletedTask; }
    public async ValueTask DisposeAsync() { await DisconnectAsync(); sendGate.Dispose(); }
}
