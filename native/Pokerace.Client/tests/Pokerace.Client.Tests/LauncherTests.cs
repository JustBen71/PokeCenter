using System.Security.Cryptography;
using Pokerace.Client.Launcher;
using Xunit;
using Pokerace.Client.Configuration;

namespace Pokerace.Client.Tests;

public sealed class LauncherTests
{
    [Theory]
    [InlineData("88.184.14.248", "http://88.184.14.248")]
    [InlineData(" 88.184.14.248:47500/ ", "http://88.184.14.248:47500")]
    [InlineData("http://88.184.14.248:47500/", "http://88.184.14.248:47500")]
    [InlineData("https://race.example.com", "https://race.example.com")]
    [InlineData("http//88.184.14.248", null)]
    [InlineData("ftp://host", null)]
    [InlineData("", null)]
    public void TypedServerAddressesAreNormalized(string typed, string? expected) => Assert.Equal(expected, LaunchOptions.NormalizeServerUrl(typed));
    [Fact] public void ConnectionFailuresGiveAReadableCause()
    {
        Assert.Equal("server_not_found", Pokerace.Client.Server.ConnectionErrors.Code(new HttpRequestException("x", new System.Net.Sockets.SocketException((int)System.Net.Sockets.SocketError.HostNotFound))));
        Assert.Equal("server_refused", Pokerace.Client.Server.ConnectionErrors.Code(new HttpRequestException("x", new System.Net.Sockets.SocketException((int)System.Net.Sockets.SocketError.ConnectionRefused))));
        Assert.Equal("server_timeout", Pokerace.Client.Server.ConnectionErrors.Code(new TaskCanceledException()));
        Assert.Equal("server_rejected", Pokerace.Client.Server.ConnectionErrors.Code(new ClientException("server_rejected", "x")));
        Assert.Contains("http://88.184.14.248:47500", Pokerace.Client.Server.ConnectionErrors.Hint("server_not_found", "http://88.184.14.248:47500"));
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
