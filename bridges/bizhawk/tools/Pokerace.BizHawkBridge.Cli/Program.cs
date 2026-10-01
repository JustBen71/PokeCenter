using System.Globalization;
using System.Net;
using System.Net.Sockets;
using System.Text;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Pokerace.BizHawkBridge.Core;

namespace Pokerace.BizHawkBridge.Cli;

public static class Program
{
    public static Task<int> Main(string[] args) => RunAsync(args, Console.Out);
    public static async Task<int> RunAsync(string[] args, TextWriter output)
    {
        try
        {
            if (args.Length == 0) throw new ArgumentException("Commands: doctor, status, system, domains, read <domain> <address> <length>, write <domain> <address> <hex>. Options: --port, --domain, --address, --length, --data, --expect, --write-test. Set POKERACE_BRIDGE_TOKEN.");
            var options = new Dictionary<string, string>(StringComparer.Ordinal);
            var positional = new List<string>();
            for (var i = 1; i < args.Length; i++)
            {
                if (args[i] == "--write-test") options.Add(args[i], "true");
                else if (args[i].StartsWith("--", StringComparison.Ordinal))
                {
                    var key = args[i];
                    if (!new[] { "--port", "--domain", "--address", "--length", "--data", "--expect" }.Contains(key) || ++i == args.Length) throw new ArgumentException("Invalid option.");
                    options.Add(key, args[i]);
                }
                else positional.Add(args[i]);
            }
            var token = Environment.GetEnvironmentVariable("POKERACE_BRIDGE_TOKEN");
            if (string.IsNullOrWhiteSpace(token)) throw new ArgumentException("Set POKERACE_BRIDGE_TOKEN before connecting.");
            var port = int.Parse(options.GetValueOrDefault("--port", Environment.GetEnvironmentVariable("POKERACE_BRIDGE_PORT") ?? "43821"), CultureInfo.InvariantCulture);
            using var client = new BridgeClient();
            await client.ConnectAsync(port);
            await output.WriteLineAsync("[OK] Connexion TCP localhost");
            await client.CallAsync(new { type = "hello", protocolVersion = 1, sessionToken = token });
            await output.WriteLineAsync("[OK] Handshake");
            if (args[0] == "doctor")
            {
                if (positional.Count != 0) throw new ArgumentException("doctor accepts named options only.");
                await DoctorAsync(client, options, output);
            }
            else
            {
                object request = args[0] switch
                {
                    "status" when positional.Count == 0 => new { type = "getStatus" },
                    "system" when positional.Count == 0 => new { type = "getSystem" },
                    "domains" when positional.Count == 0 => new { type = "listMemoryDomains" },
                    "read" when positional.Count == 3 => new { type = "readMemory", domain = positional[0], address = Address(positional[1]), length = Address(positional[2]) },
                    "write" when positional.Count == 3 => new { type = "writeMemory", domain = positional[0], address = Address(positional[1]), data = positional[2] },
                    _ => throw new ArgumentException("Unknown command or invalid arguments.")
                };
                await output.WriteLineAsync((await client.CallAsync(request)).ToString(Formatting.None));
            }
            return 0;
        }
        catch (Exception e)
        {
            // Do not print arbitrary exception details or request data, which could contain secrets.
            var message = e is SocketException || e is TimeoutException ? "Bridge non joignable ou délai dépassé." :
                e is ArgumentException || e is BridgeException ? e.Message : "Diagnostic échoué (connexion, réponse ou configuration invalide).";
            await output.WriteLineAsync("[FAIL] " + message);
            return 1;
        }
    }

    private static long Address(string value) => value.StartsWith("0x", StringComparison.OrdinalIgnoreCase)
        ? long.Parse(value.Substring(2), NumberStyles.AllowHexSpecifier, CultureInfo.InvariantCulture)
        : long.Parse(value, CultureInfo.InvariantCulture);

    private static async Task DoctorAsync(BridgeClient client, Dictionary<string, string> options, TextWriter output)
    {
        foreach (var command in new[] { "ping", "getStatus", "getSystem", "listMemoryDomains" })
        {
            var response = await client.CallAsync(new { type = command });
            await output.WriteLineAsync("[OK] " + command + " " + response.ToString(Formatting.None));
        }
        var write = options.ContainsKey("--write-test");
        if (!options.TryGetValue("--domain", out var domain) || !options.TryGetValue("--address", out var rawAddress))
        {
            if (write || options.Keys.Any(k => k is "--domain" or "--address" or "--data" or "--expect" or "--length"))
                throw new ArgumentException("Provide both --domain and --address for memory diagnostics.");
            await output.WriteLineAsync("[SKIP] READ_MEMORY : fournir --domain et --address pour une lecture contrôlée.");
            await output.WriteLineAsync("[SKIP] WRITE_MEMORY : aucune zone de test explicite.");
            return;
        }
        var address = Address(rawAddress);
        if (write && !options.ContainsKey("--data")) throw new ArgumentException("--write-test requires --data.");
        var data = write ? Protocol.Hex(Protocol.Hex(options["--data"])) : null;
        var length = data != null ? data.Length / 2 : Address(options.GetValueOrDefault("--length", "1"));
        var original = (string)(await client.CallAsync(new { type = "readMemory", domain, address, length }))["data"]!;
        await output.WriteLineAsync("[OK] READ_MEMORY " + original);
        if (options.TryGetValue("--expect", out var expected) && original != Protocol.Hex(Protocol.Hex(expected)))
            throw new BridgeException("sentinel_mismatch", "Initial bytes do not match expected sentinel.");
        if (!write) { await output.WriteLineAsync("[SKIP] WRITE_MEMORY : --write-test absent."); return; }
        var attempted = false;
        try
        {
            attempted = true;
            await client.CallAsync(new { type = "writeMemory", domain, address, data });
            await output.WriteLineAsync("[OK] WRITE_MEMORY + vérification interne");
            var readBack = (string?)(await client.CallAsync(new { type = "readMemory", domain, address, length }))["data"];
            if (readBack != data) throw new BridgeException("readback_mismatch", "Independent read-back differs.");
            await output.WriteLineAsync("[OK] READ_BACK " + readBack);
        }
        finally
        {
            if (attempted)
            {
                try
                {
                    await client.CallAsync(new { type = "writeMemory", domain, address, data = original });
                    var restored = (string?)(await client.CallAsync(new { type = "readMemory", domain, address, length }))["data"];
                    if (restored != original) throw new BridgeException("restore_failed", "Restored bytes differ.");
                    await output.WriteLineAsync("[OK] RESTORE + READ_BACK " + restored);
                }
                catch (Exception)
                {
                    await output.WriteLineAsync("[FAIL] RESTORE : restauration non confirmée, mémoire potentiellement modifiée.");
                    throw;
                }
            }
        }
    }
}

public sealed class BridgeClient : IDisposable
{
    private readonly TcpClient client = new TcpClient();
    private StreamReader? reader;
    private StreamWriter? writer;
    private int sequence;
    public async Task ConnectAsync(int port)
    {
        await client.ConnectAsync(IPAddress.Loopback, port).WaitAsync(TimeSpan.FromSeconds(5));
        reader = new StreamReader(client.GetStream(), new UTF8Encoding(false, true));
        writer = new StreamWriter(client.GetStream(), new UTF8Encoding(false)) { AutoFlush = true, NewLine = "\n" };
    }
    public async Task<JObject> CallAsync(object value)
    {
        var request = JObject.FromObject(value);
        var id = (++sequence).ToString(CultureInfo.InvariantCulture);
        request["id"] = id;
        await writer!.WriteLineAsync(request.ToString(Formatting.None)).WaitAsync(TimeSpan.FromSeconds(5));
        var line = await reader!.ReadLineAsync().WaitAsync(TimeSpan.FromSeconds(20));
        var response = JObject.Parse(line ?? throw new IOException("Disconnected."));
        if ((string?)response["id"] != id || response["ok"]?.Type != JTokenType.Boolean) throw new IOException("Invalid response.");
        if (!(bool)response["ok"]!) throw new BridgeException("remote_error", "Bridge error: " + (string?)response["error"]?["code"]);
        return response;
    }
    public void Dispose() { client.Dispose(); reader?.Dispose(); writer?.Dispose(); }
}
