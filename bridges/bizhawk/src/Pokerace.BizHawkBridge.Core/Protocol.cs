using System;
using System.IO;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace Pokerace.BizHawkBridge.Core;

public static class Protocol
{
    public const int Version = 1;
    public const int MaxBytes = 65536;
    public const int MaxTransfer = 4096;

    public static JObject Parse(string line)
    {
        try
        {
            using var input = new StringReader(line);
            using var reader = new JsonTextReader(input) { MaxDepth = 16, DateParseHandling = DateParseHandling.None };
            var value = JObject.Load(reader, new JsonLoadSettings { DuplicatePropertyNameHandling = DuplicatePropertyNameHandling.Error });
            if (reader.Read()) throw new JsonReaderException();
            if (value["id"] != null && value["id"]!.Type != JTokenType.String)
                throw new BridgeException("invalid_request", "id must be a string.");
            Text(value, "type");
            return value;
        }
        catch (JsonException) { throw new BridgeException("invalid_json", "Expected one JSON object with unique properties."); }
    }

    public static string Text(JObject request, string name)
    {
        if (request[name]?.Type != JTokenType.String || string.IsNullOrEmpty((string?)request[name]))
            throw new BridgeException("invalid_request", name + " must be a nonempty string.");
        return (string)request[name]!;
    }

    public static long Integer(JObject request, string name)
    {
        if (request[name]?.Type != JTokenType.Integer || !long.TryParse(request[name]!.ToString(), out var value))
            throw new BridgeException("invalid_request", name + " must be a signed 64-bit integer.");
        return value;
    }

    public static byte[] Hex(string text)
    {
        if (text.Length == 0 || text.Length % 2 != 0 || text.Length > MaxTransfer * 2)
            throw new BridgeException("invalid_data", "Hex data must contain 1..4096 complete bytes.");
        var bytes = new byte[text.Length / 2];
        for (var i = 0; i < bytes.Length; i++)
        {
            var a = Digit(text[i * 2]); var b = Digit(text[i * 2 + 1]);
            if (a < 0 || b < 0) throw new BridgeException("invalid_data", "Invalid hexadecimal data.");
            bytes[i] = (byte)((a << 4) | b);
        }
        return bytes;
    }

    private static int Digit(char c) => c >= '0' && c <= '9' ? c - '0' : c >= 'a' && c <= 'f' ? c - 'a' + 10 : c >= 'A' && c <= 'F' ? c - 'A' + 10 : -1;
    public static string Hex(byte[] data) => BitConverter.ToString(data).Replace("-", "").ToLowerInvariant();
    public static JObject Ok(JToken? id, object payload)
    {
        var result = JObject.FromObject(payload);
        result["id"] = id?.DeepClone(); result["ok"] = true;
        return result;
    }
    public static JObject Error(JToken? id, string code, string message) => new JObject
    {
        ["id"] = id?.DeepClone(), ["ok"] = false,
        ["error"] = new JObject { ["code"] = code, ["message"] = message }
    };
}
