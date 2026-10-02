using System.Text.Json;

namespace Pokerace.Client.Diagnostics;

public sealed class ClientLog(TextWriter output)
{
    private readonly object sync = new();
    // Callers supply constant event/code strings only. Never log remote bodies or exceptions.
    public void Write(string level, string eventName, string? code = null)
    {
        lock (sync) output.WriteLine(JsonSerializer.Serialize(new { at = DateTimeOffset.UtcNow, level, @event = eventName, code }));
    }
}
