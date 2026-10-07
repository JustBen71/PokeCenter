using Newtonsoft.Json.Linq;
using Pokerace.BizHawkBridge.Core;
using Xunit;

namespace Pokerace.BizHawkBridge.Tests;

public sealed class ResetTests : IDisposable
{
    private readonly FakeEmulatorHost host = new FakeEmulatorHost { SystemId = "GBA" };
    private readonly string root = Path.Combine(Path.GetTempPath(), "pokerace-lost-" + Guid.NewGuid().ToString("N"));
    private JObject Reset(string hash = "abc123") => new BridgeService(host, root).Execute(JObject.FromObject(new { id = "x", type = "resetGame", gameHash = hash }));
    public void Dispose() { if (Directory.Exists(root)) Directory.Delete(root, true); }

    [Fact] public void ArchivesThenResetsAndKeepsTheLastThree()
    {
        var archives = new List<string>();
        for (var i = 0; i < 5; i++) { var r = Reset(); Assert.True((bool)r["ok"]!); archives.Add((string)r["archive"]!); Thread.Sleep(5); }
        Assert.Equal(5, host.Resets);
        Assert.Equal(archives.Skip(2), Directory.GetDirectories(root).Select(Path.GetFileName).OrderBy(n => n, StringComparer.Ordinal));
        Assert.All(Directory.GetDirectories(root), d => Assert.True(File.Exists(Path.Combine(d, "game.SaveRAM"))));
    }
    [Fact] public void NothingIsErasedWhenTheArchiveFails()
    {
        host.FailArchive = true;
        var r = Reset();
        Assert.Equal("archive_failed", (string?)r["error"]?["code"]);
        Assert.Equal(0, host.Resets);
        Assert.Empty(Directory.GetDirectories(root));
    }
    [Fact] public void RefusesAnotherGame()
    {
        Assert.Equal("state_changed", (string?)Reset("other")["error"]?["code"]);
        Assert.Equal(0, host.Resets);
    }
}
