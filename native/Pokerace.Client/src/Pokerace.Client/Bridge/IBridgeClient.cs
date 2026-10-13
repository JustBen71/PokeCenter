using System.Text.Json.Nodes;

namespace Pokerace.Client.Bridge;

public sealed record BridgeStatus(bool Connected, bool GameLoaded, string? SystemId, int ProtocolVersion);
public sealed record MemoryDomainInfo(string Name, long Size, bool Writable);

public interface IBridgeClient : IAsyncDisposable
{
    bool IsConnected { get; }
    Task ConnectAsync(CancellationToken cancellation);
    Task DisconnectAsync();
    Task PingAsync(CancellationToken cancellation);
    Task<BridgeStatus> GetStatusAsync(CancellationToken cancellation);
    Task<string?> GetSystemAsync(CancellationToken cancellation);
    Task<JsonObject?> GetGameInfoAsync(CancellationToken cancellation);
    Task<IReadOnlyList<MemoryDomainInfo>> GetMemoryDomainsAsync(CancellationToken cancellation);
    Task<byte[]> ReadMemoryAsync(string domain, long address, int length, CancellationToken cancellation);
    Task WriteMemoryAsync(string domain, long address, ReadOnlyMemory<byte> data, CancellationToken cancellation);
    /// <summary>Emulator controls the player used since the last call (speed-up, rewind, savestate loads); null if the bridge cannot tell.</summary>
    Task<JsonArray?> GetControlsAsync(CancellationToken cancellation) => Task.FromResult<JsonArray?>(null);
}

public interface ITransactionalBridge
{
    Task CompareWriteAsync(string gameHash, JsonArray edits, CancellationToken cancellation);
    /// <summary>Archives the running game (savestate + save), erases the save and reboots; returns the archive name.</summary>
    Task<string> ResetGameAsync(string gameHash, CancellationToken cancellation);
}
