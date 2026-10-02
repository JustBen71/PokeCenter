using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace Pokerace.Client.Bridge;

public static class BridgeProtocol
{
    public const int Version = 1;
    public const int MaxTransfer = 4096;
    public const int MaxMessageBytes = 65536;
    public static JsonObject Parse(string json)
    {
        try
        {
            using var doc = JsonDocument.Parse(json, new JsonDocumentOptions { MaxDepth = 16 });
            CheckDuplicates(doc.RootElement);
            return JsonNode.Parse(json) as JsonObject ?? throw new JsonException();
        }
        catch (Exception e) when (e is JsonException or ArgumentException)
        { throw new ClientException("invalid_protocol", "Invalid JSON object or duplicate fields."); }
    }
    private static void CheckDuplicates(JsonElement element)
    {
        if (element.ValueKind == JsonValueKind.Object)
        {
            var names = new HashSet<string>(StringComparer.Ordinal);
            foreach (var property in element.EnumerateObject())
            { if (!names.Add(property.Name)) throw new JsonException(); CheckDuplicates(property.Value); }
        }
        else if (element.ValueKind == JsonValueKind.Array)
            foreach (var item in element.EnumerateArray()) CheckDuplicates(item);
    }
    public static string Text(JsonObject value, string key) => value[key] is JsonValue v && v.TryGetValue<string>(out var text) && text.Length > 0
        ? text : throw new ClientException("invalid_protocol", "Missing or invalid field: " + key);
    public static long Integer(JsonObject value, string key)
    {
        if (value[key] is JsonValue v)
        {
            if (v.TryGetValue<long>(out var number)) return number;
            if (v.TryGetValue<int>(out var small)) return small;
        }
        throw new ClientException("invalid_protocol", "Missing or invalid integer: " + key);
    }
    public static bool Boolean(JsonObject value, string key) => value[key] is JsonValue v && v.TryGetValue<bool>(out var flag)
        ? flag : throw new ClientException("invalid_protocol", "Missing or invalid boolean: " + key);
    public static byte[] Hex(string value)
    {
        if (value.Length is < 2 or > MaxTransfer * 2 || value.Length % 2 != 0)
            throw new ClientException("invalid_data", "Expected 1..4096 complete hexadecimal bytes.");
        try { return Convert.FromHexString(value); }
        catch (FormatException) { throw new ClientException("invalid_data", "Invalid hexadecimal data."); }
    }
    public static void Range(string domain, long address, int length)
    {
        if (string.IsNullOrWhiteSpace(domain) || domain.Length > 256 || address < 0 || length is < 1 or > MaxTransfer || address > long.MaxValue - length)
            throw new ClientException("invalid_range", "Invalid memory domain or range.");
    }
}

internal sealed class BoundedLineReader(Stream stream)
{
    private readonly byte[] buffer = new byte[4096];
    private int position, count;
    public async Task<string> ReadAsync(CancellationToken cancellation)
    {
        using var line = new MemoryStream();
        while (true)
        {
            if (position == count)
            {
                count = await stream.ReadAsync(buffer, cancellation); position = 0;
                if (count == 0) throw new IOException("Bridge closed connection.");
            }
            var b = buffer[position++];
            if (b == 10) return new UTF8Encoding(false, true).GetString(line.ToArray()).TrimEnd('\r');
            if (line.Length >= BridgeProtocol.MaxMessageBytes) throw new ClientException("invalid_protocol", "Bridge response is too large.");
            line.WriteByte(b);
        }
    }
}
