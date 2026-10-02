using Pokerace.Client.Diagnostics;

namespace Pokerace.Client.Bridge;

public sealed class BridgeConnectionManager(IBridgeClient bridge, ClientLog log, TimeSpan? pollInterval = null, TimeSpan? initialBackoff = null)
{
    private BridgeStatus snapshot = new(false, false, null, BridgeProtocol.Version);
    public BridgeStatus Snapshot => Volatile.Read(ref snapshot);
    public async Task RunAsync(CancellationToken cancellation)
    {
        var failures = 0;
        try
        {
            while (!cancellation.IsCancellationRequested)
            {
                try
                {
                    await bridge.ConnectAsync(cancellation);
                    var status = await bridge.GetStatusAsync(cancellation);
                    if (!status.Connected) throw new ClientException("bridge_disconnected", "Bridge unavailable.");
                    if (!Snapshot.Connected) log.Write("INFO", "bridge_connected");
                    Volatile.Write(ref snapshot, status);
                    failures = 0;
                    await Task.Delay(pollInterval ?? TimeSpan.FromSeconds(2), cancellation);
                }
                catch (OperationCanceledException) when (cancellation.IsCancellationRequested) { break; }
                catch (Exception e)
                {
                    Volatile.Write(ref snapshot, new(false, false, null, BridgeProtocol.Version));
                    await bridge.DisconnectAsync();
                    log.Write("WARN", "bridge_disconnected", e is ClientException ce ? ce.Code : "transport_error");
                    await Task.Delay(Backoff(++failures, initialBackoff), cancellation);
                }
            }
        }
        catch (OperationCanceledException) when (cancellation.IsCancellationRequested) { }
        finally
        {
            Volatile.Write(ref snapshot, new(false, false, null, BridgeProtocol.Version));
            await bridge.DisconnectAsync();
        }
    }
    public static TimeSpan Backoff(int failures, TimeSpan? initial = null) => TimeSpan.FromMilliseconds(
        Math.Min(30000, (initial ?? TimeSpan.FromSeconds(1)).TotalMilliseconds * Math.Pow(2, Math.Min(failures - 1, 5))) * (0.9 + Random.Shared.NextDouble() * 0.2));
}
