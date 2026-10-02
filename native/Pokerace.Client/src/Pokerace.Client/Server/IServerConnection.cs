using System.Text.Json.Nodes;

namespace Pokerace.Client.Server;

public interface IServerConnection : IAsyncDisposable
{
    bool IsConnected { get; }
    Task ConnectAsync(CancellationToken cancellation);
    Task<ServerMessage> ReceiveAsync(CancellationToken cancellation);
    Task SendAsync(string type, JsonObject payload, CancellationToken cancellation);
    Task SendTransportAckAsync(string id, JsonObject payload, CancellationToken cancellation);
    Task DisconnectAsync();
}
