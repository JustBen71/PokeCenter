using Pokerace.Client.Bridge;

namespace Pokerace.Client.Games.Pokemon.Gen3;

public sealed class Gen3Memory(IBridgeClient bridge)
{
    // BizHawk 2.11.1 mGBA: domain offsets are relative, not GBA bus addresses.
    // https://github.com/TASEmulators/BizHawk/blob/2.11.1/src/BizHawk.Emulation.Cores/Consoles/Nintendo/GBA/MGBAHawk.IMemoryDomains.cs
    public static bool IsMapped(long address, int length) => length > 0 &&
        ((address >= 0x02000000 && address + length <= 0x02040000) || (address >= 0x03000000 && address + length <= 0x03008000));
    public static bool HasDomains(IReadOnlyList<MemoryDomainInfo> domains) =>
        domains.Any(d => d.Name == "EWRAM" && d.Size == 0x40000) && domains.Any(d => d.Name == "IWRAM" && d.Size == 0x8000);
    public async Task<byte[]> ReadAsync(long address, int length, CancellationToken cancellation)
    {
        if (!IsMapped(address, length) || length > 4096) throw new InvalidDataException("Invalid game memory range.");
        var internalRam = address >= 0x03000000;
        var bytes = await bridge.ReadMemoryAsync(internalRam ? "IWRAM" : "EWRAM", address - (internalRam ? 0x03000000 : 0x02000000), length, cancellation);
        if (bytes.Length != length) throw new InvalidDataException("Incomplete game read.");
        return bytes;
    }
}
