using System.Diagnostics;
using System.Formats.Tar;
using System.IO.Compression;
using System.Reflection;
using System.Security.Cryptography;
using System.Text.Json.Nodes;

namespace Pokerace.Client.Launcher;

public static class BizHawkInstaller
{
    public static Stream Resource(string name) => Assembly.GetExecutingAssembly().GetManifestResourceStream("Launcher." + name)
        ?? throw new ClientException("launcher_not_bundled", "Utilisez la distribution avec lanceur (pokerace.cmd ou pokerace.sh depuis les sources).");

    public static async Task VerifyArchiveAsync(string path, string expectedHash, CancellationToken cancellation)
    {
        await using var file = File.OpenRead(path);
        var hash = Convert.ToHexString(await SHA256.HashDataAsync(file, cancellation));
        if (!hash.Equals(expectedHash, StringComparison.OrdinalIgnoreCase))
            throw new ClientException("download_hash_mismatch", $"Archive BizHawk incorrecte. Supprimez {Path.GetFileName(path)} du dossier du lanceur et relancez.");
    }

    /// <summary>BizHawk only ships for Windows and Linux x64; Linux runs it with Mono.</summary>
    public static void CheckPlatform()
    {
        if (OperatingSystem.IsWindows()) return;
        if (!OperatingSystem.IsLinux())
            throw new ClientException("unsupported_platform", "BizHawk n'existe que pour Windows et Linux : le jeu ne peut pas être lancé sur ce système.");
        if (FindOnPath("mono") == null)
            throw new ClientException("mono_missing", "BizHawk a besoin de Mono sous Linux. Installez-le puis cliquez à nouveau sur « Se connecter » :\n" +
                "  Debian/Ubuntu : sudo apt install mono-complete\n  Fedora : sudo dnf install mono-complete\n  Arch : sudo pacman -S mono");
    }

    /// <summary>Downloads (first launch), verifies and unpacks the pinned BizHawk, installs the bridge; returns the BizHawk folder.</summary>
    public static async Task<string> PrepareAsync(string directory, CancellationToken cancellation, IProgress<double>? download = null)
    {
        CheckPlatform();
        // Check packaging before downloading anything.
        using var bridge = Resource("Pokerace.BizHawkBridge.dll");
        using var core = Resource("Pokerace.BizHawkBridge.Core.dll");
        using var pinStream = Resource("bizhawk-version.json");
        var root = (await JsonNode.ParseAsync(pinStream, cancellationToken: cancellation))!;
        var pin = OperatingSystem.IsWindows() ? root : root["linux"]!;
        var archive = Path.Combine(directory, OperatingSystem.IsWindows() ? "bizhawk.zip" : "bizhawk-linux.tar.gz");
        Directory.CreateDirectory(directory);
        if (!File.Exists(archive))
        {
            var temp = archive + "." + Guid.NewGuid().ToString("N") + ".part";
            try
            {
                using var http = new HttpClient { Timeout = TimeSpan.FromMinutes(10) };
                using var response = await http.GetAsync((string)pin["downloadUrl"]!, HttpCompletionOption.ResponseHeadersRead, cancellation);
                response.EnsureSuccessStatusCode();
                var total = response.Content.Headers.ContentLength;
                await using (var input = await response.Content.ReadAsStreamAsync(cancellation))
                await using (var output = File.Create(temp))
                {
                    var buffer = new byte[81920]; long done = 0; int read;
                    while ((read = await input.ReadAsync(buffer, cancellation)) > 0)
                    {
                        await output.WriteAsync(buffer.AsMemory(0, read), cancellation);
                        done += read; if (total > 0) download?.Report((double)done / total.Value);
                    }
                }
                await VerifyArchiveAsync(temp, (string)pin["sha256"]!, cancellation);
                File.Move(temp, archive);
            }
            finally { if (File.Exists(temp)) File.Delete(temp); }
        }
        download?.Report(1);
        await VerifyArchiveAsync(archive, (string)pin["sha256"]!, cancellation);
        var runtime = Path.Combine(directory, "BizHawk-" + (string)root["version"]!);
        if (OperatingSystem.IsWindows()) ZipFile.ExtractToDirectory(archive, runtime, overwriteFiles: true);
        else
        {
            // The Linux archive holds a single BizHawk-<version>-linux-x64/ folder; unpack its content into runtime.
            var unpack = runtime + ".unpack";
            if (Directory.Exists(unpack)) Directory.Delete(unpack, true);
            Directory.CreateDirectory(unpack);
            await using (var gzip = new GZipStream(File.OpenRead(archive), CompressionMode.Decompress))
                await TarFile.ExtractToDirectoryAsync(gzip, unpack, overwriteFiles: true, cancellation);
            // Merged over the existing folder like on Windows: never delete it, it holds the player's saves
            // (GBA/SaveRAM, GBA/State), BizHawk's own files and the Pokérace archives.
            var inner = Directory.GetDirectories(unpack).Single();
            foreach (var file in Directory.EnumerateFiles(inner, "*", SearchOption.AllDirectories))
            {
                var target = Path.Combine(runtime, Path.GetRelativePath(inner, file));
                Directory.CreateDirectory(Path.GetDirectoryName(target)!);
                File.Move(file, target, overwrite: true);
            }
            Directory.Delete(unpack, true);
        }
        var external = Path.Combine(runtime, "ExternalTools");
        Directory.CreateDirectory(external);
        await using (var output = File.Create(Path.Combine(external, "Pokerace.BizHawkBridge.dll"))) await bridge.CopyToAsync(output, cancellation);
        await using (var output = File.Create(Path.Combine(external, "Pokerace.BizHawkBridge.Core.dll"))) await core.CopyToAsync(output, cancellation);
        return runtime;
    }

    /// <summary>EmuHawk.exe on Windows; on Linux the official EmuHawkMono.sh, which sets the library path and runs Mono.</summary>
    public static ProcessStartInfo StartInfo(string runtime) => OperatingSystem.IsWindows()
        ? new ProcessStartInfo(Path.Combine(runtime, "EmuHawk.exe")) { WorkingDirectory = runtime, UseShellExecute = false }
        : new ProcessStartInfo("/bin/sh") { ArgumentList = { Path.Combine(runtime, "EmuHawkMono.sh") }, WorkingDirectory = runtime, UseShellExecute = false };

    public static string? FindOnPath(string program) =>
        (Environment.GetEnvironmentVariable("PATH") ?? "").Split(Path.PathSeparator, StringSplitOptions.RemoveEmptyEntries)
            .Select(dir => Path.Combine(dir, program)).FirstOrDefault(File.Exists);
}
