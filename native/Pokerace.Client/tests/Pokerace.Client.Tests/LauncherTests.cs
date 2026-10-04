using System.Security.Cryptography;
using Pokerace.Client.Launcher;
using Xunit;
using Pokerace.Client.Configuration;

namespace Pokerace.Client.Tests;

public sealed class LauncherTests
{
    [Theory]
    [InlineData("nouveau-salon", "nouveau-salon")]
    [InlineData("", "ancien-salon")]
    public void EveryInteractiveLaunchAsksForRoomAndPreservesIdentity(string answer, string expected)
    {
        var path = Path.GetTempFileName();
        try
        {
            var initial = new ClientConfiguration { ServerUrl = "http://localhost:8080", PlayerName = "Ben", RoomCode = "ancien-salon" };
            ConfigurationStore.Save(path, initial);
            var output = new StringWriter();
            var result = PlayerLauncher.Configure(new LaunchOptions(path, null, false), new StringReader(answer + "\n"), output);
            Assert.Contains("Code du salon", output.ToString());
            Assert.Equal(expected, result.RoomCode);
            Assert.Equal(initial.PlayerId, result.PlayerId);
            Assert.Equal(initial.ServerUrl, result.ServerUrl);
            Assert.Equal("Ben", result.PlayerName);
            Assert.Equal(expected, ConfigurationStore.Load(path).RoomCode);
        }
        finally { File.Delete(path); }
    }
    [Theory]
    [InlineData("salon\n3000\n", null, "http://localhost:3000")]
    [InlineData("salon\n\n", null, "http://localhost:8080")]
    [InlineData("salon\nabc\n4000\n", null, "http://localhost:4000")]
    [InlineData("salon\n", 5000, "http://localhost:5000")]
    public void PortIsAskedAtEachLaunchOrGivenOnTheCommandLine(string answers, int? argument, string expected)
    {
        var path = Path.GetTempFileName();
        try
        {
            ConfigurationStore.Save(path, new ClientConfiguration { ServerUrl = "http://localhost:8080", PlayerName = "Ben", RoomCode = "ancien" });
            var output = new StringWriter();
            var result = PlayerLauncher.Configure(new LaunchOptions(path, null, false, argument), new StringReader(answers), output);
            Assert.Equal(expected, result.ServerUrl);
            Assert.Equal(expected, ConfigurationStore.Load(path).ServerUrl);
            Assert.Equal(argument == null, output.ToString().Contains("Port du serveur"));
        }
        finally { File.Delete(path); }
    }
    [Fact] public void PortOptionIsValidated()
    {
        Assert.Equal(3000, LaunchOptions.Parse(["--port", "3000"]).Port);
        Assert.Throws<ClientException>(() => LaunchOptions.Parse(["--port", "0"]));
        Assert.Throws<ClientException>(() => LaunchOptions.Parse(["--port", "http"]));
        Assert.Equal("https://race.example.com:8443", LaunchOptions.WithPort("https://race.example.com", 8443));
        Assert.Equal("https://race.example.com", LaunchOptions.WithPort("https://race.example.com:8443", 443));
    }
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
