using System.IO.Compression;
using System.Text.Json.Nodes;
using Pokerace.Client.Games;
using Pokerace.Client.Launcher;
using Xunit;

namespace Pokerace.Client.Tests;

public sealed class AutosaveTests : IDisposable
{
    private readonly string root = Directory.CreateTempSubdirectory("pokerace-autosaves-").FullName;
    private string Launcher => Path.Combine(root, "launcher");
    private string Runtime => Path.Combine(Launcher, "BizHawk-2.11.1");
    private readonly string rom, otherRom;
    private readonly LocalRomIdentity identity;
    public AutosaveTests()
    {
        rom = Path.Combine(root, "emerald.gba"); otherRom = Path.Combine(root, "other.gba");
        File.WriteAllBytes(rom, [1, 2, 3, 4]); File.WriteAllBytes(otherRom, [9, 9, 9]);
        identity = LocalRomIdentity.FromStreamAsync(new MemoryStream(File.ReadAllBytes(rom)), default).Result;
    }
    public void Dispose() => Directory.Delete(root, true);

    // A BizHawk 2.11 mGBA savestate: zip with Core.bin(.zst) = 4-byte prefix, mGBA magic, BIOS checksum, ROM CRC32.
    private static void State(string path, uint crc, bool zst = true)
    {
        var core = new byte[64];
        BitConverter.GetBytes(0x00081020u).CopyTo(core, 0); BitConverter.GetBytes(0x01000009u).CopyTo(core, 4); BitConverter.GetBytes(crc).CopyTo(core, 12);
        using var zip = ZipFile.Open(path, ZipArchiveMode.Create);
        using var entry = zip.CreateEntry(zst ? "Core.bin.zst" : "Core.bin").Open();
        entry.Write(zst ? new ZstdSharp.Compressor().Wrap(core).ToArray() : core);
    }
    private string Save(string name, string? sha256, string? manifest = null, string? under = null)
    {
        var folder = Path.Combine(under ?? Path.Combine(Launcher, "autosaves"), name);
        Directory.CreateDirectory(folder);
        State(Path.Combine(folder, "game.State"), Autosaves.RomCrc(rom));
        File.WriteAllText(Path.Combine(folder, "game.SaveRAM"), "save " + name);
        if (manifest != null || sha256 != null)
            File.WriteAllText(Path.Combine(folder, "manifest.json"), manifest ?? new JsonObject
            {
                ["format"] = 1, ["createdUtc"] = $"2026-10-0{name}T10:00:00.000Z", ["clientVersion"] = "0.2.7",
                ["rom"] = new JsonObject { ["sha256"] = sha256, ["revision"] = "BPEF v0" }, ["bizhawk"] = new JsonObject { ["hash"] = "SHA1:X" },
            }.ToJsonString());
        return Path.Combine(folder, "game.State");
    }

    [Fact] public void NoAutosave() => Assert.Empty(Autosaves.List(Launcher, identity));

    [Fact] public void ThreeAutosavesNewestFirstOnlyOfTheSelectedRom()
    {
        var a = Save("1", identity.Sha256); var c = Save("3", identity.Sha256); var b = Save("2", identity.Sha256);
        Save("4", new string('f', 64));                                      // another ROM
        Save("5", null, manifest: "{ not json");                             // corrupt manifest
        Save("6", null, manifest: """{"format":2,"rom":{"sha256":"x"}}""");  // unknown format
        Assert.Equal([c, b, a], Autosaves.List(Launcher, identity).Select(s => s.State));
        Assert.All(Autosaves.List(Launcher, identity), s => Assert.False(s.Legacy));
    }

    [Fact] public void RestoreBacksUpTheCurrentSaveAndLoadsACopy()
    {
        var state = Save("1", identity.Sha256);
        Directory.CreateDirectory(Path.Combine(Runtime, "GBA", "SaveRAM"));
        File.WriteAllText(Path.Combine(Runtime, "GBA", "SaveRAM", "Pokemon.SaveRAM"), "current progress");
        var load = Autosaves.PrepareRestore(Launcher, Runtime, Assert.Single(Autosaves.List(Launcher, identity)), rom, identity);
        var backup = Path.GetDirectoryName(Path.GetDirectoryName(load))!;
        Assert.Equal(Path.Combine(Launcher, "restore-backups"), Path.GetDirectoryName(backup));
        Assert.Equal("current progress", File.ReadAllText(Path.Combine(backup, "SaveRAM", "Pokemon.SaveRAM")));
        Assert.Equal(File.ReadAllBytes(state), File.ReadAllBytes(load));
        Assert.True(File.Exists(state), "the chosen autosave stays where it was");
        Assert.True(File.Exists(Path.Combine(Runtime, "GBA", "SaveRAM", "Pokemon.SaveRAM")), "never deleted");
    }

    [Fact] public void AFileThatDisappearedAfterSelectionIsRefusedWithoutAnyChange()
    {
        var picked = Assert.Single(Autosaves.List(Launcher, identity).Concat([new Autosave(Save("1", identity.Sha256), DateTime.UtcNow, false)]).Take(1));
        Directory.Delete(Path.GetDirectoryName(picked.State)!, true);
        Assert.Equal("autosave_missing", Assert.Throws<ClientException>(() => Autosaves.PrepareRestore(Launcher, Runtime, picked, rom, identity)).Code);
        Assert.False(Directory.Exists(Path.Combine(Launcher, "restore-backups")));
    }

    [Fact] public void AManifestChangedAfterSelectionIsRefused()
    {
        var picked = Assert.Single(Autosaves.List(Launcher, identity).Concat([new Autosave(Save("1", identity.Sha256), DateTime.UtcNow, false)]));
        File.WriteAllText(Path.Combine(Path.GetDirectoryName(picked.State)!, "manifest.json"), "{}");
        Assert.Equal("autosave_incompatible", Assert.Throws<ClientException>(() => Autosaves.PrepareRestore(Launcher, Runtime, picked, rom, identity)).Code);
    }

    [Theory][InlineData(true)][InlineData(false)]
    public void LegacyAutosavesAreLoadedOnlyIfTheStateWasMadeFromTheSelectedRom(bool zst)
    {
        var legacy = Path.Combine(Runtime, "PokeraceAutosaves");
        var state = Save("1", null, under: legacy);
        File.Delete(state); State(state, Autosaves.RomCrc(rom), zst);
        var save = Assert.Single(Autosaves.List(Launcher, identity));
        Assert.True(save.Legacy);
        Assert.EndsWith("game.State", Autosaves.PrepareRestore(Launcher, Runtime, save, rom, identity));
        Assert.Equal("autosave_incompatible", Assert.Throws<ClientException>(() => Autosaves.PrepareRestore(Launcher, Runtime, save, otherRom, identity)).Code);
        File.WriteAllText(state, "not a savestate");
        Assert.Equal("autosave_incompatible", Assert.Throws<ClientException>(() => Autosaves.PrepareRestore(Launcher, Runtime, save, rom, identity)).Code);
    }

    [Fact] public void TheRealSavestateHeaderIsReadFromABizHawkFile()
    {
        // Layout checked on BizHawk 2.11.1 states of Emerald FR: CRC32 a3fdccb1 at Core.bin offset 0x0C.
        var state = Path.Combine(root, "s.State"); State(state, 0xa3fdccb1);
        Assert.Equal(0xa3fdccb1u, Autosaves.StateRomCrc(state));
        Assert.Equal(0xb63cfbcdu, Autosaves.RomCrc(rom));
    }
}
