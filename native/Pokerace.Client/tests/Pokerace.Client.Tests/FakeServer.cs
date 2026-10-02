using System.Collections.Concurrent;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json.Nodes;
using System.Threading.Channels;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Pokerace.Client.Bridge;

namespace Pokerace.Client.Tests;

public sealed class FakeServer : IAsyncDisposable
{
    private readonly WebApplication app;
    private readonly ConcurrentDictionary<int, Peer> peers = new();
    private readonly Channel<JsonObject> messages = Channel.CreateUnbounded<JsonObject>();
    private int connections, pongs;
    public int Connections => Volatile.Read(ref connections);
    public int Pongs => Volatile.Read(ref pongs);
    public int ProtocolVersion { get; set; } = 1;
    public int Port { get; private set; }
    private FakeServer()
    {
        var builder = WebApplication.CreateBuilder(); builder.Logging.ClearProviders(); builder.WebHost.UseUrls("http://127.0.0.1:0");
        app = builder.Build(); app.UseWebSockets();
        app.Map("/socket.io/", HandleAsync);
    }
    public static async Task<FakeServer> StartAsync()
    {
        var server = new FakeServer(); await server.app.StartAsync();
        server.Port = new Uri(server.app.Services.GetRequiredService<IServer>().Features.Get<IServerAddressesFeature>()!.Addresses.Single()).Port;
        return server;
    }
    private async Task HandleAsync(HttpContext context)
    {
        if (!context.WebSockets.IsWebSocketRequest || context.Request.Query["EIO"] != "4") { context.Response.StatusCode = 400; return; }
        using var socket = await context.WebSockets.AcceptWebSocketAsync();
        var peer = new Peer(socket);
        var id = Interlocked.Increment(ref connections);
        try
        {
            await peer.SendAsync("0{\"sid\":\"fixture\",\"pingInterval\":25000,\"pingTimeout\":20000,\"upgrades\":[],\"maxPayload\":65536}");
            var connect = await ReadAsync(socket);
            if (!connect.StartsWith("40/client,", StringComparison.Ordinal)) return;
            var auth = BridgeProtocol.Parse(connect[10..]);
            if ((string?)auth["roomCode"] != "test-room") { await peer.SendAsync("44/client,{\"message\":\"rejected\"}"); return; }
            await peer.SendAsync("40/client,{\"sid\":\"namespace\"}");
            peers[id] = peer;
            await peer.SendAsync(Event("SERVER_STATUS", new() { ["type"] = "SERVER_STATUS", ["protocolVersion"] = ProtocolVersion, ["connected"] = true, ["ready"] = false }));
            while (socket.State == WebSocketState.Open)
            {
                var frame = await ReadAsync(socket);
                if (frame == "3") { Interlocked.Increment(ref pongs); continue; }
                if (frame.StartsWith("43/client,", StringComparison.Ordinal)) continue;
                var array = (JsonArray)JsonNode.Parse(frame[10..])!;
                var payload = (JsonObject)array[1]!;
                if ((string?)array[0] == "HELLO") await peer.SendAsync(Event("SERVER_STATUS", new() { ["type"] = "SERVER_STATUS", ["protocolVersion"] = ProtocolVersion, ["connected"] = true, ["ready"] = true }));
                messages.Writer.TryWrite((JsonObject)payload.DeepClone());
            }
        }
        catch (Exception) { }
        finally { peers.TryRemove(id, out _); }
    }
    public static string Event(string type, JsonObject payload) => "42/client," + new JsonArray(JsonValue.Create(type), payload.DeepClone()).ToJsonString();
    public Task SendAsync(JsonObject command) => peers.OrderBy(p => p.Key).Last().Value.SendAsync(Event("COMMAND", command));
    public Task PingAsync() => peers.OrderBy(p => p.Key).Last().Value.SendAsync("2");
    public void DropConnections()
    {
        foreach (var peer in peers.Values)
        {
            try { peer.Socket.Abort(); }
            catch (Exception e) when (e is ObjectDisposedException or NullReferenceException) { /* Kestrel may already have recycled a closing connection. */ }
        }
    }
    public async Task<JsonObject> WaitForAsync(Func<JsonObject, bool> predicate)
    {
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(10));
        while (true) { var message = await messages.Reader.ReadAsync(timeout.Token); if (predicate(message)) return message; }
    }
    private static async Task<string> ReadAsync(WebSocket socket)
    {
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(15));
        using var message = new MemoryStream(); var buffer = new byte[4096];
        while (true)
        {
            var part = await socket.ReceiveAsync(buffer.AsMemory(), timeout.Token);
            if (part.MessageType != WebSocketMessageType.Text) throw new IOException();
            message.Write(buffer, 0, part.Count);
            if (part.EndOfMessage) return Encoding.UTF8.GetString(message.ToArray());
        }
    }
    public async ValueTask DisposeAsync()
    { DropConnections(); await app.StopAsync(); await app.DisposeAsync(); }
    private sealed class Peer(WebSocket socket)
    {
        public WebSocket Socket => socket;
        private readonly SemaphoreSlim gate = new(1);
        public async Task SendAsync(string frame)
        {
            await gate.WaitAsync();
            try { await socket.SendAsync(Encoding.UTF8.GetBytes(frame).AsMemory(), WebSocketMessageType.Text, true, CancellationToken.None); }
            finally { gate.Release(); }
        }
    }
}
