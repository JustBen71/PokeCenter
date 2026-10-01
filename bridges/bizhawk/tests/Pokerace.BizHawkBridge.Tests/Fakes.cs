using Pokerace.BizHawkBridge.Core;

namespace Pokerace.BizHawkBridge.Tests;

public sealed class FakeMemoryDomain : IMemoryDomainAdapter
{
    public string Name { get; set; } = "RAM";
    public long Size => Bytes.Length;
    public bool Writable { get; set; } = true;
    public byte[] Bytes { get; } = new byte[65536];
    public bool IgnoreWrites { get; set; }
    public int FailAfterWrites { get; set; } = int.MaxValue;
    public bool FailReadAfterWrite { get; set; }
    public int Writes { get; private set; }
    public byte ReadByte(long address) => FailReadAfterWrite && Writes > 0 ? throw new IOException() : Bytes[address];
    public void WriteByte(long address, byte value)
    {
        if (Writes >= FailAfterWrites) throw new IOException();
        Writes++;
        if (!IgnoreWrites) Bytes[address] = value;
    }
}

public sealed class FakeEmulatorHost : IEmulatorHost
{
    public bool IsGameLoaded { get; set; } = true;
    public string? SystemId { get; set; } = "TEST";
    public List<IMemoryDomainAdapter> Domains { get; } = new List<IMemoryDomainAdapter> { new FakeMemoryDomain() };
    public object? GetGameInfo() => IsGameLoaded ? new { name = "Fixture", systemId = SystemId } : null;
    public IReadOnlyList<IMemoryDomainAdapter> GetMemoryDomains() => Domains;
}

public sealed class ImmediateDispatcher : IEmulatorDispatcher
{
    public Task<T> InvokeAsync<T>(Func<T> action, CancellationToken cancellation)
    { cancellation.ThrowIfCancellationRequested(); return Task.FromResult(action()); }
}
