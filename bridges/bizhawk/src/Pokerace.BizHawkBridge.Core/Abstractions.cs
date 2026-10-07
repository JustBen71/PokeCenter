using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;

namespace Pokerace.BizHawkBridge.Core;

public interface IMemoryDomainAdapter
{
    string Name { get; }
    long Size { get; }
    bool Writable { get; }
    byte ReadByte(long address);
    void WriteByte(long address, byte value);
}

// All members are invoked together on the emulator thread, never cached across requests.
public interface IEmulatorHost
{
    bool IsGameLoaded { get; }
    string? SystemId { get; }
    object? GetGameInfo();
    IReadOnlyList<IMemoryDomainAdapter> GetMemoryDomains();
    /// <summary>Writes a savestate and a copy of the in-game save into <paramref name="directory"/>; throws if either fails.</summary>
    void ArchiveGame(string directory);
    /// <summary>Erases the in-game save and reboots the core: the game starts with no save.</summary>
    void EraseSaveAndReboot();
}

public interface IEmulatorDispatcher
{
    Task<T> InvokeAsync<T>(Func<T> action, CancellationToken cancellation);
}

public sealed class BridgeException : Exception
{
    public string Code { get; }
    public BridgeException(string code, string message) : base(message) => Code = code;
}
