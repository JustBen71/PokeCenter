using System.Diagnostics;
using System.Text;

namespace Pokerace.Client.Launcher;

// Native file dialog when the desktop offers one; the form falls back to a typed path otherwise.
public static class RomPicker
{
    public static bool Available => OperatingSystem.IsWindows() || Linux() != null;

    /// <summary>The chosen file, null when cancelled or when no dialog is available.</summary>
    public static async Task<string?> ChooseAsync(string? current, CancellationToken cancellation)
    {
        ProcessStartInfo start;
        if (OperatingSystem.IsWindows())
        {
            // Constant command: file paths are returned as data, never interpolated into PowerShell code.
            const string picker = "[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); Add-Type -AssemblyName System.Windows.Forms; $d=New-Object System.Windows.Forms.OpenFileDialog; $d.Title='Choisissez la ROM à ouvrir dans BizHawk'; $d.Filter='ROM et archives|*.gba;*.gb;*.gbc;*.nds;*.nes;*.sfc;*.smc;*.n64;*.z64;*.v64;*.sms;*.gg;*.md;*.gen;*.zip;*.7z|Tous les fichiers|*.*'; $d.CheckFileExists=$true; if($d.ShowDialog() -eq 'OK'){[Console]::Write($d.FileName)}; $d.Dispose()";
            start = new ProcessStartInfo(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "WindowsPowerShell", "v1.0", "powershell.exe"));
            foreach (var arg in new[] { "-NoProfile", "-STA", "-EncodedCommand", Convert.ToBase64String(Encoding.Unicode.GetBytes(picker)) }) start.ArgumentList.Add(arg);
        }
        else if (Linux() is { } tool)
        {
            start = new ProcessStartInfo(tool);
            var folder = current != null && Path.GetDirectoryName(current) is { Length: > 0 } dir ? dir + "/" : "";
            var args = Path.GetFileName(tool) == "zenity"
                ? new[] { "--file-selection", "--title=Choisissez la ROM à ouvrir dans BizHawk", "--file-filter=ROM | *.gba *.gb *.gbc *.nes *.zip *.7z", "--file-filter=Tous les fichiers | *", "--filename=" + folder }
                : new[] { "--getopenfilename", folder.Length > 0 ? folder : ".", "*.gba *.gb *.gbc *.nes *.zip *.7z|ROM", "--title", "Choisissez la ROM à ouvrir dans BizHawk" };
            foreach (var arg in args) start.ArgumentList.Add(arg);
        }
        else return null;
        start.UseShellExecute = false; start.CreateNoWindow = true;
        start.RedirectStandardOutput = true; start.RedirectStandardError = true; start.StandardOutputEncoding = Encoding.UTF8;
        using var process = Process.Start(start)!;
        using var registration = cancellation.Register(() => { try { if (!process.HasExited) process.Kill(); } catch (InvalidOperationException) { } });
        var output = process.StandardOutput.ReadToEndAsync(cancellation);
        var errors = process.StandardError.ReadToEndAsync(cancellation);
        await process.WaitForExitAsync(cancellation); await errors;
        var path = (await output).Trim();
        return process.ExitCode == 0 && path.Length > 0 ? path : null;
    }

    private static string? Linux()
    {
        if (!OperatingSystem.IsLinux()) return null;
        var desktop = !string.IsNullOrEmpty(Environment.GetEnvironmentVariable("DISPLAY")) || !string.IsNullOrEmpty(Environment.GetEnvironmentVariable("WAYLAND_DISPLAY"));
        return desktop ? BizHawkInstaller.FindOnPath("zenity") ?? BizHawkInstaller.FindOnPath("kdialog") : null;
    }
}
