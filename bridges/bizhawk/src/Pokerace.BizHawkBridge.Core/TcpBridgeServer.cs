using System;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace Pokerace.BizHawkBridge.Core;

public sealed class TcpBridgeServer : IDisposable
{
    private readonly TcpListener listener;
    private readonly CancellationTokenSource shutdown = new CancellationTokenSource();
    private readonly string token;
    private readonly BridgeService service;
    private readonly IEmulatorDispatcher dispatcher;
    private readonly TimeSpan timeout;
    private readonly Action<string>? log;
    private Task active = Task.CompletedTask;
    private int disposed;
    public Task Completion { get; private set; } = Task.CompletedTask;
    public int Port => ((IPEndPoint)listener.LocalEndpoint).Port;

    public TcpBridgeServer(int port, string token, BridgeService service, IEmulatorDispatcher dispatcher,
        TimeSpan? timeout = null, Action<string>? log = null)
    {
        if (string.IsNullOrWhiteSpace(token) || token.Length < 32) throw new ArgumentException("Session token must contain at least 32 characters.", nameof(token));
        if (port < 0 || port > 65535) throw new ArgumentOutOfRangeException(nameof(port));
        this.token = token; this.service = service; this.dispatcher = dispatcher;
        this.timeout = timeout ?? TimeSpan.FromSeconds(15); this.log = log;
        if (this.timeout <= TimeSpan.Zero) throw new ArgumentOutOfRangeException(nameof(timeout));
        listener = new TcpListener(IPAddress.Loopback, port);
    }

    public void Start()
    {
        listener.Start(4);
        Completion = AcceptAsync();
        Log("Listening on 127.0.0.1:" + Port);
    }

    private async Task AcceptAsync()
    {
        try
        {
            while (!shutdown.IsCancellationRequested)
            {
                var client = await listener.AcceptTcpClientAsync().ConfigureAwait(false);
                if (!active.IsCompleted)
                {
                    using (client)
                    using (var deadline = CancellationTokenSource.CreateLinkedTokenSource(shutdown.Token))
                    {
                        deadline.CancelAfter(TimeSpan.FromSeconds(1));
                        using (deadline.Token.Register(client.Close))
                        {
                            try { await SendAsync(client.GetStream(), Protocol.Error(null, "busy", "One client is already active."), deadline.Token).ConfigureAwait(false); }
                            catch (Exception) { /* Peer may already have disconnected. */ }
                        }
                    }
                }
                else active = ServeAsync(client);
            }
        }
        catch (Exception) when (shutdown.IsCancellationRequested) { }
        catch (Exception) { Log("Listener failed."); shutdown.Cancel(); }
        finally { await active.ConfigureAwait(false); }
    }

    private async Task ServeAsync(TcpClient client)
    {
        using (client)
        using (shutdown.Token.Register(client.Close))
        {
            try
            {
                client.NoDelay = true;
                var stream = client.GetStream();
                var session = new BridgeSession(token, service, dispatcher);
                var reader = new BoundedLineReader(stream);
                while (!shutdown.IsCancellationRequested)
                {
                    using var deadline = CancellationTokenSource.CreateLinkedTokenSource(shutdown.Token);
                    deadline.CancelAfter(timeout);
                    string? line;
                    try { line = await reader.ReadAsync(deadline.Token).ConfigureAwait(false); }
                    catch (BridgeException e)
                    {
                        await SendWithDeadlineAsync(stream, Protocol.Error(null, e.Code, e.Message), client).ConfigureAwait(false);
                        return;
                    }
                    catch (OperationCanceledException)
                    {
                        await SendWithDeadlineAsync(stream, Protocol.Error(null, "timeout", "Request deadline expired."), client).ConfigureAwait(false);
                        return;
                    }
                    if (line == null) return;
                    var result = await session.HandleAsync(line, deadline.Token).ConfigureAwait(false);
                    await SendWithDeadlineAsync(stream, result, client).ConfigureAwait(false);
                    if (!session.Authenticated || deadline.IsCancellationRequested) return;
                }
            }
            catch (Exception) { if (!shutdown.IsCancellationRequested) Log("Client disconnected or transport failed."); }
        }
    }

    private async Task SendWithDeadlineAsync(NetworkStream stream, JObject response, TcpClient client)
    {
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(shutdown.Token);
        deadline.CancelAfter(TimeSpan.FromSeconds(2));
        using (deadline.Token.Register(client.Close)) await SendAsync(stream, response, deadline.Token).ConfigureAwait(false);
    }
    private static async Task SendAsync(NetworkStream stream, JObject response, CancellationToken cancellation)
    {
        var bytes = Encoding.UTF8.GetBytes(response.ToString(Formatting.None) + "\n");
        await stream.WriteAsync(bytes, 0, bytes.Length, cancellation).ConfigureAwait(false);
    }
    private void Log(string text) { try { log?.Invoke(text); } catch (Exception) { } }
    public void Dispose()
    {
        if (Interlocked.Exchange(ref disposed, 1) != 0) return;
        shutdown.Cancel(); listener.Stop();
        // Never wait on the UI thread: a pending dispatched request must be cancellable.
        _ = Completion.ContinueWith(_ => shutdown.Dispose(), TaskScheduler.Default);
    }
}

internal sealed class BoundedLineReader
{
    private readonly Stream stream;
    private readonly byte[] buffer = new byte[4096];
    private int offset, count;
    private static readonly Encoding Utf8 = new UTF8Encoding(false, true);
    public BoundedLineReader(Stream stream) => this.stream = stream;
    public async Task<string?> ReadAsync(CancellationToken cancellation)
    {
        using var line = new MemoryStream();
        while (true)
        {
            if (offset == count)
            {
                // .NET Framework NetworkStream does not cancel an in-flight ReadAsync.
                // Race the read; the caller sends a timeout then closes this connection.
                var read = stream.ReadAsync(buffer, 0, buffer.Length, cancellation);
                var cancelled = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
                using (cancellation.Register(() => cancelled.TrySetResult(true)))
                {
                    if (await Task.WhenAny(read, cancelled.Task).ConfigureAwait(false) != read)
                    {
                        _ = read.ContinueWith(t => { _ = t.Exception; }, TaskContinuationOptions.OnlyOnFaulted);
                        throw new OperationCanceledException(cancellation);
                    }
                }
                count = await read.ConfigureAwait(false); offset = 0;
                if (count == 0)
                {
                    if (line.Length != 0) throw new BridgeException("truncated_request", "Request must end with newline.");
                    return null;
                }
            }
            var value = buffer[offset++];
            if (value == 10)
            {
                try { return Utf8.GetString(line.ToArray()).TrimEnd('\r'); }
                catch (DecoderFallbackException) { throw new BridgeException("invalid_utf8", "Request must be UTF-8."); }
            }
            if (line.Length >= Protocol.MaxBytes) throw new BridgeException("request_too_large", "Request exceeds 65536 bytes.");
            line.WriteByte(value);
        }
    }
}
