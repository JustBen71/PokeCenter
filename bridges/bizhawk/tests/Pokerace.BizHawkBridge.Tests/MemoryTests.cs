using Newtonsoft.Json.Linq;
using Pokerace.BizHawkBridge.Core;
using Xunit;

namespace Pokerace.BizHawkBridge.Tests;

public sealed class MemoryTests
{
    private readonly FakeEmulatorHost host = new FakeEmulatorHost();
    private FakeMemoryDomain Memory => (FakeMemoryDomain)host.Domains[0];
    private JObject Run(object request) => new BridgeService(host).Execute(JObject.FromObject(request));
    private JObject Read(long address = 0, long length = 4, string domain = "RAM") => Run(new { id = "r", type = "readMemory", domain, address, length });
    private JObject Write(long address = 0, string data = "deadbeef") => Run(new { id = "w", type = "writeMemory", domain = "RAM", address, data });
    private static void Error(JObject result, string code)
    { Assert.False((bool)result["ok"]!); Assert.Equal(code, (string?)result["error"]?["code"]); }

    [Fact] public void ReadsExactLowercaseHex()
    {
        new byte[] { 1, 2, 3, 4, 5, 6 }.CopyTo(Memory.Bytes, 0x1000);
        Assert.Equal("010203040506", (string?)Read(0x1000, 6)["data"]);
    }
    [Fact] public void WritesVerifiesAndReads()
    {
        var result = Write(0x2000, "DEADBEEF");
        Assert.True((bool)result["verified"]!);
        Assert.Equal(4, (int)result["written"]!);
        Assert.Equal(new byte[] { 0xde, 0xad, 0xbe, 0xef }, Memory.Bytes.Skip(0x2000).Take(4));
        Assert.Equal("deadbeef", (string?)Read(0x2000)["data"]);
    }
    [Fact] public void MultipleBlocksRemainIndependent()
    {
        foreach (var (address, data) in new[] { (0x3000, "00112233"), (0x3010, "4455667788"), (0x3fff, "aabbcc") })
        { Assert.True((bool)Write(address, data)["ok"]!); Assert.Equal(Protocol.Hex(data), Memory.Bytes.Skip(address).Take(data.Length / 2)); }
        Assert.Equal("00112233", (string?)Read(0x3000)["data"]);
        Assert.Equal("4455667788", (string?)Read(0x3010, 5)["data"]);
    }
    [Theory]
    [InlineData(-1, 1)] [InlineData(65535, 2)] [InlineData(long.MaxValue, 2)]
    [InlineData(0, 0)] [InlineData(0, -1)] [InlineData(0, 4097)]
    public void RejectsInvalidRange(long address, long length) => Error(Read(address, length), "invalid_range");
    [Fact] public void LastByteIsValid() { Assert.True((bool)Write(65535, "ab")["ok"]!); Assert.Equal("ab", (string?)Read(65535, 1)["data"]); }
    [Fact] public void WriteRangeRejectedBeforeMutation() { Error(Write(65535), "invalid_range"); Assert.Equal(0, Memory.Writes); }
    [Fact] public void UnknownDomain() => Error(Read(domain: "missing"), "unknown_domain");
    [Fact] public void ReadOnly() { Memory.Writable = false; Error(Write(), "read_only"); Assert.Equal(0, Memory.Writes); }
    [Theory] [InlineData("")] [InlineData("a")] [InlineData("zz")] [InlineData("ab cd")]
    public void RejectsInvalidHex(string data) { Assert.False((bool)Write(data: data)["ok"]!); Assert.Equal(0, Memory.Writes); }
    [Fact] public void DetectsSilentWriteFailure() { Memory.IgnoreWrites = true; Error(Write(), "verification_failed"); }
    [Fact] public void DetectsPartialWrite() { Memory.FailAfterWrites = 2; Error(Write(), "write_failed"); Assert.Equal(2, Memory.Writes); Assert.Equal((byte)0xde, Memory.Bytes[0]); }
    [Fact] public void DetectsPostWriteReadFailure() { Memory.FailReadAfterWrite = true; Error(Write(), "write_failed"); }
    [Fact] public void GameLifecycleAndDomainReplacement()
    {
        host.IsGameLoaded = false; host.SystemId = null; Error(Read(), "no_game");
        Assert.False((bool)Run(new { type = "getStatus" })["gameLoaded"]!);
        host.IsGameLoaded = true; host.SystemId = "GBA"; Assert.True((bool)Write()["ok"]!);
        host.IsGameLoaded = false; Error(Read(), "no_game");
        host.IsGameLoaded = true; host.SystemId = "NES";
        host.Domains.Clear(); host.Domains.Add(new FakeMemoryDomain { Name = "New RAM" });
        Error(Read(), "unknown_domain");
        Assert.Equal("NES", (string?)Run(new { type = "getSystem" })["systemId"]);
        Assert.Equal("00000000", (string?)Read(domain: "New RAM")["data"]);
    }
    [Fact] public void ListsActualDomainProperties()
    {
        host.Domains.Add(new FakeMemoryDomain { Name = "ROM", Writable = false });
        var domains = (JArray)Run(new { type = "listMemoryDomains" })["domains"]!;
        Assert.Equal(2, domains.Count); Assert.False((bool)domains[1]["writable"]!); Assert.Equal(65536, (long)domains[0]["size"]!);
    }
    [Fact] public void ReturnsGameInfo() => Assert.Equal("Fixture", (string?)Run(new { type = "getGameInfo" })["game"]?["name"]);
    [Fact] public void UnknownCommand() => Error(Run(new { type = "invented" }), "unknown_command");
    [Theory] [InlineData("{\"type\":\"ping\",\"type\":\"writeMemory\"}")] [InlineData("[]")] [InlineData("{}")] [InlineData("{\"type\":\"ping\"} {}")]
    public void RejectsMalformedProtocol(string json) => Assert.Throws<BridgeException>(() => Protocol.Parse(json));
}
