using System.Threading.Channels;
using Pokerace.Client.Bridge;
using Pokerace.Client.Commands;
using Pokerace.Client.Configuration;
using Pokerace.Client.Diagnostics;
using Pokerace.Client.Server;

namespace Pokerace.Client.Runtime;

public sealed class ClientRuntime(ClientConfiguration configuration, IBridgeClient bridge, IServerConnection server, ClientLog log,
    TimeSpan? pollInterval = null, TimeSpan? retryInterval = null)
{
    private readonly BridgeConnectionManager manager = new(bridge, log, pollInterval, retryInterval);
    private readonly CommandRouter router = new(bridge, configuration);
    private readonly Channel<(ServerMessage Message, long Session)> commands = Channel.CreateBounded<(ServerMessage, long)>(64);
    private long session;
    public async Task RunAsync(CancellationToken cancellation)
    {
        using var lifetime = CancellationTokenSource.CreateLinkedTokenSource(cancellation);
        var bridgeTask = manager.RunAsync(lifetime.Token);
        var commandTask = ProcessCommandsAsync(lifetime.Token);
        try { await ServerLoopAsync(lifetime.Token); }
        finally
        {
            lifetime.Cancel(); commands.Writer.TryComplete();
            await server.DisconnectAsync();
            await Task.WhenAll(bridgeTask, commandTask);
        }
    }
    private async Task ServerLoopAsync(CancellationToken cancellation)
    {
        var failures = 0;
        while (!cancellation.IsCancellationRequested)
        {
            using var connection = CancellationTokenSource.CreateLinkedTokenSource(cancellation);
            Task? receive = null, heartbeat = null;
            try
            {
                await server.ConnectAsync(connection.Token);
                Interlocked.Increment(ref session);
                failures = 0;
                log.Write("INFO", "server_connected");
                await server.SendAsync("HELLO", ServerProtocol.Hello(configuration, manager.Snapshot), connection.Token);
                var clientStatus = ServerProtocol.Message("CLIENT_STATUS");
                clientStatus["connected"] = true; clientStatus["allowMemoryWrites"] = configuration.AllowMemoryWrites;
                await server.SendAsync("CLIENT_STATUS", clientStatus, connection.Token);
                await server.SendAsync("BRIDGE_STATUS", ServerProtocol.BridgeStatusMessage(manager.Snapshot), connection.Token);
                await server.SendAsync("HEARTBEAT", ServerProtocol.Heartbeat(manager.Snapshot), connection.Token);
                receive = ReceiveCommandsAsync(connection.Token);
                heartbeat = HeartbeatAsync(connection.Token);
                await await Task.WhenAny(receive, heartbeat);
            }
            catch (OperationCanceledException) when (cancellation.IsCancellationRequested) { break; }
            catch (Exception e) { log.Write("WARN", "server_disconnected", e is ClientException ce ? ce.Code : "transport_error"); }
            finally
            {
                connection.Cancel(); await server.DisconnectAsync();
                foreach (var task in new[] { receive, heartbeat })
                    if (task != null) { try { await task; } catch (Exception) { } }
            }
            try { await Task.Delay(BridgeConnectionManager.Backoff(++failures, retryInterval), cancellation); }
            catch (OperationCanceledException) when (cancellation.IsCancellationRequested) { break; }
        }
    }
    private async Task ReceiveCommandsAsync(CancellationToken cancellation)
    {
        while (true)
        {
            var message = await server.ReceiveAsync(cancellation);
            if (message.Type == "SERVER_STATUS")
            {
                ServerProtocol.CheckVersion(message.Payload);
                if (!BridgeProtocol.Boolean(message.Payload, "connected")) throw new ClientException("server_disconnected", "Server reported disconnection.");
                continue;
            }
            if (message.Type != "COMMAND") throw new ClientException("invalid_protocol", "Unknown server event.");
            if (!commands.Writer.TryWrite((message, Interlocked.Read(ref session))))
            {
                var failure = new CommandResult(CommandResult.ReadId(message.Payload), false, ErrorCode: "client_busy").ToMessage();
                await server.SendAsync("COMMAND_ACK", failure, cancellation);
                if (message.TransportAckId != null) await server.SendTransportAckAsync(message.TransportAckId, failure, cancellation);
            }
        }
    }
    private async Task HeartbeatAsync(CancellationToken cancellation)
    {
        var previous = manager.Snapshot;
        var heartbeatAt = DateTimeOffset.UtcNow.AddSeconds(configuration.HeartbeatSeconds);
        while (true)
        {
            await Task.Delay(pollInterval ?? TimeSpan.FromMilliseconds(250), cancellation);
            var current = manager.Snapshot;
            if (current != previous)
            {
                await server.SendAsync("BRIDGE_STATUS", ServerProtocol.BridgeStatusMessage(current), cancellation);
                previous = current;
            }
            if (DateTimeOffset.UtcNow >= heartbeatAt)
            {
                await server.SendAsync("HEARTBEAT", ServerProtocol.Heartbeat(current), cancellation);
                heartbeatAt = DateTimeOffset.UtcNow.AddSeconds(configuration.HeartbeatSeconds);
            }
        }
    }
    private async Task ProcessCommandsAsync(CancellationToken lifetime)
    {
        try
        {
            await foreach (var item in commands.Reader.ReadAllAsync(lifetime))
            {
                // Commands belong to the client lifetime, not the server connection lifetime.
                // A dropped ACK never causes an automatic memory-write retry.
                var result = await router.RouteAsync(item.Message.Payload, lifetime);
                log.Write(result.Ok ? "INFO" : "WARN", "command_completed", result.ErrorCode);
                if (!server.IsConnected || item.Session != Interlocked.Read(ref session)) continue;
                try
                {
                    await server.SendAsync("COMMAND_ACK", result.ToMessage(), lifetime);
                    if (item.Message.TransportAckId != null) await server.SendTransportAckAsync(item.Message.TransportAckId, result.ToMessage(), lifetime);
                }
                catch (Exception) { log.Write("WARN", "ack_delivery_failed"); }
            }
        }
        catch (OperationCanceledException) when (lifetime.IsCancellationRequested) { }
    }
}
