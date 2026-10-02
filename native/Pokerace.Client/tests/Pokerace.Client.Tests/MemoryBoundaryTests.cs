using Pokerace.Client.Bridge;
using Xunit;

namespace Pokerace.Client.Tests;

public sealed class MemoryBoundaryTests
{
    [Theory] [InlineData(0)] [InlineData(65535)]
    public async Task OneByteAtEachBoundary(long address)
    {
        await using var fake = new FakeBridgeServer();
        await using var bridge = new BridgeClient(fake.Configuration(true), () => FakeBridgeServer.Token);
        await bridge.ConnectAsync(default);
        await bridge.WriteMemoryAsync("RAM", address, new byte[] { 0xab }, default);
        Assert.Equal(new byte[] { 0xab }, await bridge.ReadMemoryAsync("RAM", address, 1, default));
    }
    [Fact] public async Task IndependentBlocksReadBackExactly()
    {
        await using var fake = new FakeBridgeServer();
        await using var bridge = new BridgeClient(fake.Configuration(true), () => FakeBridgeServer.Token);
        await bridge.ConnectAsync(default);
        var blocks = new[] { (0x1000L, "deadbeef"), (0x2000L, "01020304"), (0x3000L, "aabbccdd") };
        Assert.Equal(new byte[4], await bridge.ReadMemoryAsync("RAM", 0x1000, 4, default));
        foreach (var (address, hex) in blocks) await bridge.WriteMemoryAsync("RAM", address, Convert.FromHexString(hex), default);
        foreach (var (address, hex) in blocks) Assert.Equal(Convert.FromHexString(hex), await bridge.ReadMemoryAsync("RAM", address, 4, default));
    }
    [Theory] [InlineData(-1, 1)] [InlineData(65536, 1)] [InlineData(65535, 2)]
    [InlineData(0, 0)] [InlineData(0, 4097)] [InlineData(long.MaxValue, 1)]
    public async Task InvalidRangesNeverWrite(long address, int length)
    {
        await using var fake = new FakeBridgeServer();
        await using var bridge = new BridgeClient(fake.Configuration(true), () => FakeBridgeServer.Token);
        await bridge.ConnectAsync(default);
        Assert.Equal("invalid_range", (await Assert.ThrowsAsync<ClientException>(() => bridge.ReadMemoryAsync("RAM", address, length, default))).Code);
        Assert.Equal("invalid_range", (await Assert.ThrowsAsync<ClientException>(() => bridge.WriteMemoryAsync("RAM", address, new byte[length], default))).Code);
        Assert.Equal(0, fake.Memory.Writes);
    }
}
