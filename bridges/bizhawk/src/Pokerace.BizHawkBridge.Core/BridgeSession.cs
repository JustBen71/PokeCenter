using System;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;

namespace Pokerace.BizHawkBridge.Core;

public sealed class BridgeSession
{
    private readonly string token;
    private readonly BridgeService service;
    private readonly IEmulatorDispatcher dispatcher;
    public bool Authenticated { get; private set; }
    public BridgeSession(string token, BridgeService service, IEmulatorDispatcher dispatcher)
    { this.token = token; this.service = service; this.dispatcher = dispatcher; }

    public async Task<JObject> HandleAsync(string line, CancellationToken cancellation)
    {
        JToken? id = null;
        try
        {
            var request = Protocol.Parse(line);
            id = request["id"];
            if (!Authenticated)
            {
                if (Protocol.Text(request, "type") != "hello") throw new BridgeException("handshake_required", "First request must be hello.");
                if (Protocol.Integer(request, "protocolVersion") != Protocol.Version) throw new BridgeException("protocol_mismatch", "Expected protocolVersion 1.");
                if (!TokenEquals(token, Protocol.Text(request, "sessionToken"))) throw new BridgeException("unauthorized", "Handshake rejected.");
                Authenticated = true;
                return Protocol.Ok(id, new { type = "hello", protocolVersion = Protocol.Version });
            }
            cancellation.ThrowIfCancellationRequested();
            return await dispatcher.InvokeAsync(() => service.Execute(request), cancellation).ConfigureAwait(false);
        }
        catch (BridgeException e) { return Protocol.Error(id, e.Code, e.Message); }
        catch (OperationCanceledException) { return Protocol.Error(id, "timeout", "Request cancelled or timed out."); }
        catch (Exception) { return Protocol.Error(id, "internal_error", "Request failed."); }
    }

    private static bool TokenEquals(string expected, string actual)
    {
        // Compare fixed-size digests; neither tokens nor request bodies are logged.
        using var sha = System.Security.Cryptography.SHA256.Create();
        var a = sha.ComputeHash(Encoding.UTF8.GetBytes(expected));
        var b = sha.ComputeHash(Encoding.UTF8.GetBytes(actual));
        var difference = 0;
        for (var i = 0; i < a.Length; i++) difference |= a[i] ^ b[i];
        return difference == 0;
    }
}
