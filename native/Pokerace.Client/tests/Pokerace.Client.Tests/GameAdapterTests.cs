using System.Buffers.Binary;
using System.Text.Json.Nodes;
using Pokerace.Client.Bridge;
using Pokerace.Client.Games;
using Pokerace.Client.Games.Pokemon.Gen3;
using Xunit;

namespace Pokerace.Client.Tests;

public sealed class GameAdapterTests
{
    private static string KnownHash => (string)Gen3ProfileRegistry.Resource("rom-manifest")["roms"]![0]!["sha256"]!;
    private static Gen3MemoryProfile Profile => new Gen3ProfileRegistry().Resolve(KnownHash).Profile!;
    private static LocalRomIdentity Identity => new(KnownHash, new string('b', 40));
    private static BridgeStatus Loaded => new(true, true, "GBA", 1);
    internal static async Task<GameObservation> SampleObservationAsync()
    {
        await using var bridge = new MemoryBridge(); bridge.SetParty(1);
        return await new GameAdapterManager(bridge, Identity).ObserveAsync(Loaded, default);
    }

    [Fact] public void ExactHashAndValidationAreRequired()
    {
        var registry = new Gen3ProfileRegistry();
        Assert.Equal("ready", registry.Resolve(KnownHash).Status);
        Assert.Equal("unknown_rom", registry.Resolve("0" + KnownHash[1..]).Status);
        var unvalidated = new Gen3ProfileRegistry(name => { var data = Gen3ProfileRegistry.Resource(name); if (name == "rom-manifest") data["roms"]![0]!["validated"] = false; return data; });
        Assert.Equal("profile_not_validated", unvalidated.Resolve(KnownHash).Status);
        var candidate = new Gen3ProfileRegistry(name => { var data = Gen3ProfileRegistry.Resource(name); if (name == Profile.ProfileId) data["status"] = "candidate"; return data; });
        Assert.Equal("profile_not_validated", candidate.Resolve(KnownHash).Status);
    }
    [Fact] public async Task RandomizedRomIsRecognizedByHeader()
    {
        var rom = new byte[0x200];
        "BPEF"u8.CopyTo(rom.AsSpan(0xAC));
        var identity = await LocalRomIdentity.FromStreamAsync(new MemoryStream(rom), default);
        Assert.Equal("BPEF v0", identity.Revision);
        Assert.Equal("ready", new Gen3ProfileRegistry().Resolve(identity).Status);
        rom[0xBC] = 1;
        Assert.Equal("unknown_rom", new Gen3ProfileRegistry().Resolve(await LocalRomIdentity.FromStreamAsync(new MemoryStream(rom), default)).Status);
        "BPEE"u8.CopyTo(rom.AsSpan(0xAC)); rom[0xBC] = 0;
        Assert.Equal("unknown_rom", new Gen3ProfileRegistry().Resolve(await LocalRomIdentity.FromStreamAsync(new MemoryStream(rom), default)).Status);
    }
    [Theory]
    [InlineData("no_game")][InlineData("unsupported_system")][InlineData("rom_identity_unavailable")][InlineData("unknown_rom")][InlineData("memory_domain_unavailable")]
    public async Task UnsupportedStatesNeverReadProfileMemory(string expected)
    {
        await using var bridge = new MemoryBridge();
        var identity = expected == "rom_identity_unavailable" ? null : expected == "unknown_rom" ? Identity with { Sha256 = "0" + KnownHash[1..] } : Identity;
        var status = expected == "no_game" ? Loaded with { GameLoaded = false } : expected == "unsupported_system" ? Loaded with { SystemId = "NES" } : Loaded;
        if (expected == "memory_domain_unavailable") bridge.Domains = [];
        var result = await new GameAdapterManager(bridge, identity).ObserveAsync(status, default);
        Assert.Equal(expected, result.Adapter.Status); Assert.Equal(0, bridge.Reads); Assert.Null(result.State);
    }
    [Fact] public async Task IdentityUsesFileSha256AndRejectsDifferentLoadedGame()
    {
        using var rom = new MemoryStream([1, 2, 3]);
        var identity = await LocalRomIdentity.FromStreamAsync(rom, default);
        using var other = new MemoryStream([1, 2, 4]);
        Assert.NotEqual(identity.Sha256, (await LocalRomIdentity.FromStreamAsync(other, default)).Sha256);
        Assert.True(identity.MatchesLoadedGame(new JsonObject { ["hash"] = "SHA1:" + identity.Sha1 }));
        Assert.False(identity.MatchesLoadedGame(new JsonObject { ["hash"] = new string('a', 40) }));
        await using var bridge = new MemoryBridge { Hash = new string('c', 40) };
        Assert.Equal("rom_identity_unavailable", (await new GameAdapterManager(bridge, Identity).ObserveAsync(Loaded, default)).Adapter.Status);
        Assert.Equal(0, bridge.Reads);
    }
    [Theory][InlineData(0)][InlineData(1)][InlineData(6)]
    public async Task ReadsTrainerMoneyLocationPartyAndProgression(int count)
    {
        await using var bridge = new MemoryBridge(); bridge.SetParty(count);
        var result = (await new GameAdapterManager(bridge, Identity).ObserveAsync(Loaded, default)).State!;
        Assert.Equal("A", result.Trainer.Name); Assert.Equal(12500u, result.Trainer.Money);
        Assert.Equal(3723, result.Trainer.PlayTimeSeconds); Assert.Equal(count, result.Trainer.PartyCount);
        Assert.Equal(count, result.Party.Length); Assert.Equal(9, result.Location.MapNumber);
        Assert.Contains("starter", result.Progression.Completed);
        Assert.All(result.Capabilities, c => Assert.EndsWith(".read", c));
        if (count > 0) { Assert.True(result.Party[0].Shiny); Assert.Equal(0, result.Party[0].CurrentHp); Assert.Equal(1, result.Party[0].SpeciesId); }
        var json = new GameObservation(result.Adapter, result).ToMessage().ToJsonString();
        foreach (var forbidden in new[] { "sha256", "address", KnownHash, "romPath" }) Assert.DoesNotContain(forbidden, json);
    }
    [Theory][InlineData("checksum")][InlineData("empty")][InlineData("hp")][InlineData("count")][InlineData("pointer")][InlineData("money")]
    public async Task InvalidStructuresRejectEntireSnapshot(string corruption)
    {
        await using var bridge = new MemoryBridge(); bridge.SetParty(1);
        if (corruption == "checksum") bridge.Ewram[(int)Profile.PartyAddress - 0x02000000 + 28] ^= 1;
        if (corruption == "empty") Array.Clear(bridge.Ewram, (int)Profile.PartyAddress - 0x02000000, 100);
        if (corruption == "hp") bridge.Ewram[(int)Profile.PartyAddress - 0x02000000 + 86] = 255;
        if (corruption == "count") bridge.Ewram[(int)Profile.PartyCountAddress - 0x02000000] = 7;
        if (corruption == "pointer") Array.Clear(bridge.Iwram, (int)Profile.SaveBlock1Pointer - 0x03000000, 4);
        if (corruption == "money") bridge.Put32(0x02001000 + 0x490, 1000000 ^ 0x12345678);
        await Assert.ThrowsAsync<InvalidDataException>(() => new GameAdapterManager(bridge, Identity).ObserveAsync(Loaded, default));
    }
    [Theory][InlineData(0u)][InlineData(1u)][InlineData(2u)][InlineData(3u)][InlineData(4u)][InlineData(5u)][InlineData(6u)][InlineData(7u)][InlineData(8u)][InlineData(9u)][InlineData(10u)][InlineData(11u)][InlineData(12u)][InlineData(13u)][InlineData(14u)][InlineData(15u)][InlineData(16u)][InlineData(17u)][InlineData(18u)][InlineData(19u)][InlineData(20u)][InlineData(21u)][InlineData(22u)][InlineData(23u)]
    public void DecodesAllSubstructurePermutations(uint pid)
    {
        var decoded = new Gen3PokemonDecoder(Gen3ProfileRegistry.Resource("game-data"), "fr").Decode(MemoryBridge.Pokemon(pid), 1);
        Assert.Equal(1, decoded.SpeciesId); Assert.Equal(5, decoded.Level);
    }
    [Fact] public async Task GameChangeDisconnectAndReconnectRevalidateIdentity()
    {
        await using var bridge = new MemoryBridge(); var manager = new GameAdapterManager(bridge, Identity);
        Assert.Equal("ready", (await manager.ObserveAsync(Loaded, default)).Adapter.Status);
        Assert.Equal("no_game", (await manager.ObserveAsync(Loaded with { Connected = false }, default)).Adapter.Status);
        var reads = bridge.Reads; bridge.Hash = "another-game";
        Assert.Equal("rom_identity_unavailable", (await manager.ObserveAsync(Loaded, default)).Adapter.Status); Assert.Equal(reads, bridge.Reads);
        bridge.Hash = Identity.Sha1;
        Assert.Equal("ready", (await manager.ObserveAsync(Loaded, default)).Adapter.Status);
    }
    [Fact] public async Task ReadErrorsArePublishedAndRecoverWithoutStoppingLoop()
    {
        await using var bridge = new MemoryBridge { Fail = true }; var manager = new GameAdapterManager(bridge, Identity);
        using var cancel = new CancellationTokenSource(TimeSpan.FromSeconds(5)); var running = manager.RunAsync(() => Loaded, cancel.Token);
        try
        {
            while (manager.Snapshot.Adapter.Status != "read_error") await Task.Delay(10, cancel.Token);
            bridge.Fail = false;
            while (manager.Snapshot.Adapter.Status != "ready") await Task.Delay(10, cancel.Token);
        }
        finally { cancel.Cancel(); await running; }
    }
    [Fact] public async Task TimestampDoesNotCauseDuplicateContent()
    {
        await using var bridge = new MemoryBridge(); var manager = new GameAdapterManager(bridge, Identity);
        var a = await manager.ObserveAsync(Loaded, default);
        Assert.Equal(a.ContentKey(), (a with { State = a.State! with { ObservedAt = "later" } }).ContentKey());
    }

    internal sealed class MemoryBridge : IBridgeClient, ITransactionalBridge
    {
        public readonly byte[] Ewram = new byte[0x40000], Iwram = new byte[0x8000];
        public Action? BeforeTransaction;
        public int Transactions;
        public int Reads; public bool Fail; public string Hash = Identity.Sha1;
        public IReadOnlyList<MemoryDomainInfo> Domains = [new("EWRAM", 0x40000, true), new("IWRAM", 0x8000, true)];
        public MemoryBridge()
        {
            Put32(Profile.SaveBlock1Pointer, 0x02001000); Put32(Profile.SaveBlock2Pointer, 0x02003000);
            Array.Fill(Ewram, (byte)255, 0x3000, 7); Ewram[0x3000] = 0xBB;
            Ewram[0x300E] = 1; Ewram[0x3010] = 2; Ewram[0x3011] = 3;
            Put32(0x020030AC, 0x12345678); Put32(0x02001490, 12500 ^ 0x12345678);
            Ewram[0x1005] = 9;
            var progression = Gen3ProfileRegistry.Resource("progression"); var flag = (int)progression["objectives"]![0]!["flags"]![0]!;
            Ewram[0x1000 + (int)progression["flagsOffset"]! + flag / 8] |= (byte)(1 << (flag % 8));
        }
        public void Put32(long address, uint value) => BinaryPrimitives.WriteUInt32LittleEndian((address >= 0x03000000 ? Iwram : Ewram).AsSpan((int)(address & 0xFFFFFF)), value);
        public void SetParty(int count)
        {
            Ewram[(int)Profile.PartyCountAddress - 0x02000000] = (byte)count;
            for (var i = 0; i < count; i++) Pokemon(0).CopyTo(Ewram, (int)Profile.PartyAddress - 0x02000000 + i * 100);
        }
        public static byte[] Pokemon(uint pid)
        {
            string[] orders = ["GAEM", "GAME", "GEAM", "GEMA", "GMAE", "GMEA", "AGEM", "AGME", "AEGM", "AEMG", "AMGE", "AMEG", "EGAM", "EGMA", "EAGM", "EAMG", "EMGA", "EMAG", "MGAE", "MGEA", "MAGE", "MAEG", "MEGA", "MEAG"];
            var b = new byte[100]; BinaryPrimitives.WriteUInt32LittleEndian(b, pid);
            Array.Fill(b, (byte)255, 8, 10); b[28] = 1; b[84] = 5; b[88] = 20;
            var plain = new byte[48]; plain[orders[pid % 24].IndexOf('G') * 12] = 1;
            for (var i = 0; i < 12; i++) BinaryPrimitives.WriteUInt32LittleEndian(b.AsSpan(32 + i * 4), BinaryPrimitives.ReadUInt32LittleEndian(plain.AsSpan(i * 4)) ^ pid);
            return b;
        }
        public bool IsConnected => true;
        public Task ConnectAsync(CancellationToken c) => Task.CompletedTask;
        public Task DisconnectAsync() => Task.CompletedTask;
        public Task PingAsync(CancellationToken c) => Task.CompletedTask;
        public Task<BridgeStatus> GetStatusAsync(CancellationToken c) => Task.FromResult(Loaded);
        public Task<string?> GetSystemAsync(CancellationToken c) => Task.FromResult<string?>("GBA");
        public Task<JsonObject?> GetGameInfoAsync(CancellationToken c) => Task.FromResult<JsonObject?>(new() { ["hash"] = Hash });
        public Task<IReadOnlyList<MemoryDomainInfo>> GetMemoryDomainsAsync(CancellationToken c) => Task.FromResult(Domains);
        public Task<byte[]> ReadMemoryAsync(string domain, long address, int length, CancellationToken c)
        {
            Reads++; if (Fail) throw new IOException("Synthetic failure");
            Assert.True(domain is "EWRAM" or "IWRAM"); return Task.FromResult((domain == "EWRAM" ? Ewram : Iwram).AsSpan((int)address, length).ToArray());
        }
        public Task WriteMemoryAsync(string d, long a, ReadOnlyMemory<byte> data, CancellationToken c) => throw new Xunit.Sdk.XunitException("Read-only adapter attempted a write");
        public Task CompareWriteAsync(string hash, JsonArray edits, CancellationToken c)
        {
            BeforeTransaction?.Invoke();
            var service = new Pokerace.BizHawkBridge.Core.BridgeService(new TransactionHost(this));
            var response = service.Execute(Newtonsoft.Json.Linq.JObject.Parse(new JsonObject { ["type"] = "compareWrite", ["gameHash"] = hash, ["edits"] = edits }.ToJsonString()));
            if (!(bool)response["ok"]!) throw new ClientException((string)response["error"]!["code"]!, "Transaction rejected");
            Transactions++; return Task.CompletedTask;
        }
        public int Resets;
        public Task<string> ResetGameAsync(string hash, CancellationToken c)
        {
            if (hash != Hash) throw new ClientException("state_changed", "Loaded game changed.");
            Resets++; return Task.FromResult("20261007T000000000Z");
        }
        private sealed class Domain(string name, byte[] bytes) : Pokerace.BizHawkBridge.Core.IMemoryDomainAdapter
        {
            public string Name => name; public long Size => bytes.Length; public bool Writable => true;
            public byte ReadByte(long address) => bytes[address]; public void WriteByte(long address, byte value) => bytes[address] = value;
        }
        private sealed class TransactionHost(MemoryBridge bridge) : Pokerace.BizHawkBridge.Core.IEmulatorHost
        {
            public bool IsGameLoaded => true; public string SystemId => "GBA";
            public object GetGameInfo() => new { hash = bridge.Hash };
            public IReadOnlyList<Pokerace.BizHawkBridge.Core.IMemoryDomainAdapter> GetMemoryDomains() => [new Domain("EWRAM", bridge.Ewram), new Domain("IWRAM", bridge.Iwram)];
            public void ArchiveGame(string directory) => throw new NotSupportedException();
            public void EraseSaveAndReboot() => throw new NotSupportedException();
        }
        public ValueTask DisposeAsync() => ValueTask.CompletedTask;
    }
}
