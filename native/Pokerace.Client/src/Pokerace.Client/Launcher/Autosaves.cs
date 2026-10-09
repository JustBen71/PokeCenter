using System.IO.Compression;
using System.Text.Json.Nodes;
using Pokerace.Client.Games;

namespace Pokerace.Client.Launcher;

/// <summary>A copy made by the bridge every 5 minutes. Legacy: made by 0.2.3–0.2.6, without manifest.json.</summary>
public sealed record Autosave(string State, DateTime CreatedUtc, bool Legacy);

/// <summary>
/// Autosaves: &lt;launcher&gt;/autosaves/&lt;UTC&gt;/{game.State, game.SaveRAM} (0.2.6+), plus manifest.json since 0.2.7;
/// legacy ones in &lt;launcher&gt;/BizHawk-*/PokeraceAutosaves/&lt;UTC&gt;/ (0.2.3–0.2.5).
/// Before a restore, &lt;launcher&gt;/restore-backups/&lt;UTC&gt;/ receives the current in-game saves (SaveRAM/) and the chosen copy (autosave/),
/// which BizHawk then loads: the bridge's rotation of 3 copies can never delete it. Nothing there is ever deleted by Pokérace.
/// </summary>
public static class Autosaves
{
    public const int ManifestFormat = 1;

    /// <summary>Copies of the selected ROM, newest first; legacy ones are listed and checked at restore time.</summary>
    public static IReadOnlyList<Autosave> List(string directory, LocalRomIdentity rom) =>
        (Directory.Exists(directory) ? Directory.GetDirectories(directory, "BizHawk-*").Select(d => Path.Combine(d, "PokeraceAutosaves")) : [])
        .Append(EmulatorSession.AutosavesDirectory(directory)).Where(Directory.Exists).SelectMany(Directory.GetDirectories)
        .Select(folder => Read(folder, rom)).OfType<Autosave>().OrderByDescending(a => a.CreatedUtc).ToList();

    private static Autosave? Read(string folder, LocalRomIdentity rom)
    {
        var state = Path.Combine(folder, "game.State");
        if (!File.Exists(state)) return null;
        var manifest = Path.Combine(folder, "manifest.json");
        if (!File.Exists(manifest)) return new(state, File.GetLastWriteTimeUtc(state), true);
        try
        {
            var m = JsonNode.Parse(File.ReadAllText(manifest))!;
            if ((int?)m["format"] != ManifestFormat || !string.Equals((string?)m["rom"]?["sha256"], rom.Sha256, StringComparison.OrdinalIgnoreCase)) return null;
            return new(state, DateTime.Parse((string)m["createdUtc"]!, null, System.Globalization.DateTimeStyles.AdjustToUniversal | System.Globalization.DateTimeStyles.AssumeUniversal), false);
        }
        catch (Exception) { return null; } // corrupt manifest: never offered
    }

    /// <summary>Checks the copy, backs up the current in-game saves and the copy; returns the savestate BizHawk must load.</summary>
    public static string PrepareRestore(string directory, string runtime, Autosave save, string romPath, LocalRomIdentity rom)
    {
        if (!File.Exists(save.State)) throw new ClientException("autosave_missing", "Cette sauvegarde automatique n'existe plus. Rien n'a été modifié.");
        if (save.Legacy ? StateRomCrc(save.State) != RomCrc(romPath) : Read(Path.GetDirectoryName(save.State)!, rom) == null)
            throw new ClientException("autosave_incompatible", save.Legacy
                ? "Cette ancienne sauvegarde automatique (sans manifeste) ne peut pas être reliée avec certitude à la ROM sélectionnée : elle n'est pas chargée. Rien n'a été modifié."
                : "Cette sauvegarde automatique a été faite avec une autre ROM : elle n'est pas chargée. Rien n'a été modifié.");
        var backup = Path.Combine(directory, "restore-backups", DateTime.UtcNow.ToString("yyyyMMdd'T'HHmmssfff'Z'"));
        if (Directory.Exists(backup)) throw new ClientException("restore_backup_exists", "Réessayez dans un instant.");
        var saveRam = Path.Combine(runtime, "GBA", "SaveRAM");
        if (Directory.Exists(saveRam)) Copy(saveRam, Path.Combine(backup, "SaveRAM"));
        Copy(Path.GetDirectoryName(save.State)!, Path.Combine(backup, "autosave"));
        return Path.Combine(backup, "autosave", "game.State");
    }

    private static void Copy(string from, string to)
    {
        Directory.CreateDirectory(to);
        foreach (var file in Directory.GetFiles(from)) File.Copy(file, Path.Combine(to, Path.GetFileName(file)), overwrite: false);
    }

    /// <summary>CRC32 of the ROM that made a BizHawk 2.11 mGBA savestate (mGBA header in Core.bin), null if unreadable.</summary>
    public static uint? StateRomCrc(string state)
    {
        try
        {
            using var zip = ZipFile.OpenRead(state);
            var entry = zip.GetEntry("Core.bin") ?? zip.GetEntry("Core.bin.zst");
            if (entry == null) return null;
            using var raw = entry.Open();
            using var core = entry.Name.EndsWith(".zst") ? new ZstdSharp.DecompressionStream(raw) : raw;
            var head = new byte[16];
            if (core.ReadAtLeast(head, head.Length, false) < head.Length) return null;
            // 4-byte BizHawk prefix, then mGBA: version magic 0x010000xx, BIOS checksum, ROM CRC32.
            if ((BitConverter.ToUInt32(head, 4) & 0xFFFFFF00) != 0x01000000) return null;
            return BitConverter.ToUInt32(head, 12);
        }
        catch (Exception) { return null; }
    }

    public static uint RomCrc(string rom)
    {
        uint crc = ~0u;
        foreach (var b in File.ReadAllBytes(rom)) { crc ^= b; for (var k = 0; k < 8; k++) crc = (crc >> 1) ^ (0xEDB88320u & (uint)-(int)(crc & 1)); }
        return ~crc;
    }
}
