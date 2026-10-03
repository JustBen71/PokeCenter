using System.Security.Cryptography;
using Pokerace.Client.Launcher;
using Xunit;

namespace Pokerace.Client.Tests;

public sealed class LauncherTests
{
    [Fact] public void PathsAreArgumentsAndIdentityConfigIsExplicit()
    {
        var options = LaunchOptions.Parse(["--rom", "ROM avec espaces & caractères.gba", "--config", "other/client.json", "--configure"]);
        Assert.EndsWith("ROM avec espaces & caractères.gba", options.Rom);
        Assert.Equal(Path.GetFullPath("other/client.json"), options.ConfigPath);
        Assert.True(options.Configure);
    }
    [Theory]
    [InlineData("--rom")]
    [InlineData("--unknown")]
    public void MissingAndUnknownArgumentsAreRejected(string argument) => Assert.Throws<ClientException>(() => LaunchOptions.Parse([argument]));
    [Fact] public void DuplicateArgumentsAreRejected() => Assert.Throws<ClientException>(() => LaunchOptions.Parse(["--rom", "a.nes", "--rom", "b.nes"]));
    [Fact] public async Task CorruptArchiveIsRejectedBeforeInstallation()
    {
        var path = Path.GetTempFileName();
        try
        {
            await File.WriteAllBytesAsync(path, [1, 2, 3]);
            var hash = Convert.ToHexString(SHA256.HashData(new byte[] { 1, 2, 3 }));
            await BizHawkInstaller.VerifyArchiveAsync(path, hash, default);
            await File.WriteAllBytesAsync(path, [1, 2, 4]);
            var error = await Assert.ThrowsAsync<ClientException>(() => BizHawkInstaller.VerifyArchiveAsync(path, hash, default));
            Assert.Equal("download_hash_mismatch", error.Code);
        }
        finally { File.Delete(path); }
    }
}
