using System.IO.Compression;
using System.Reflection;
using System.Security.Cryptography;
using System.Text.Json.Nodes;

namespace Pokerace.Client.Launcher;

public static class BizHawkInstaller
{
    public static Stream Resource(string name) => Assembly.GetExecutingAssembly().GetManifestResourceStream("Launcher." + name)
        ?? throw new ClientException("launcher_not_bundled", "Utilisez la distribution Windows avec lanceur (ou pokerace.cmd depuis les sources).");

    public static async Task VerifyArchiveAsync(string path, string expectedHash, CancellationToken cancellation)
    {
        await using var file = File.OpenRead(path);
        var hash = Convert.ToHexString(await SHA256.HashDataAsync(file, cancellation));
        if (!hash.Equals(expectedHash, StringComparison.OrdinalIgnoreCase))
            throw new ClientException("download_hash_mismatch", "Archive BizHawk incorrecte. Supprimez bizhawk.zip du dossier du lanceur et relancez.");
    }

    public static async Task<string> PrepareAsync(string directory, CancellationToken cancellation)
    {
        // Check packaging before downloading anything.
        using var bridge = Resource("Pokerace.BizHawkBridge.dll");
        using var core = Resource("Pokerace.BizHawkBridge.Core.dll");
        using var pinStream = Resource("bizhawk-version.json");
        var pin = (await JsonNode.ParseAsync(pinStream, cancellationToken: cancellation))!;
        var archive = Path.Combine(directory, "bizhawk.zip");
        Directory.CreateDirectory(directory);
        if (!File.Exists(archive))
        {
            Console.WriteLine("Téléchargement de BizHawk " + (string?)pin["version"] + " (premier lancement)...");
            var temp = archive + "." + Guid.NewGuid().ToString("N") + ".part";
            try
            {
                using var http = new HttpClient { Timeout = TimeSpan.FromMinutes(10) };
                using var response = await http.GetAsync((string)pin["downloadUrl"]!, HttpCompletionOption.ResponseHeadersRead, cancellation);
                response.EnsureSuccessStatusCode();
                await using (var output = File.Create(temp)) await response.Content.CopyToAsync(output, cancellation);
                await VerifyArchiveAsync(temp, (string)pin["sha256"]!, cancellation);
                File.Move(temp, archive);
            }
            finally { if (File.Exists(temp)) File.Delete(temp); }
        }
        await VerifyArchiveAsync(archive, (string)pin["sha256"]!, cancellation);
        var runtime = Path.Combine(directory, "BizHawk-" + (string)pin["version"]!);
        Console.WriteLine("Préparation de BizHawk et du bridge...");
        ZipFile.ExtractToDirectory(archive, runtime, overwriteFiles: true);
        var external = Path.Combine(runtime, "ExternalTools");
        Directory.CreateDirectory(external);
        await using (var output = File.Create(Path.Combine(external, "Pokerace.BizHawkBridge.dll"))) await bridge.CopyToAsync(output, cancellation);
        await using (var output = File.Create(Path.Combine(external, "Pokerace.BizHawkBridge.Core.dll"))) await core.CopyToAsync(output, cancellation);
        return runtime;
    }
}
