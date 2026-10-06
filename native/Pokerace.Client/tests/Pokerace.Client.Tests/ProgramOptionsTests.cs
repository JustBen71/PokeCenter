using Pokerace.Client.Configuration;
using Xunit;

namespace Pokerace.Client.Tests;

// Outside play, run needs --rom: without the ROM identity the Gen III adapter never reads the game (Linux test, Oct. 2026).
public sealed class ProgramOptionsTests
{
    [Fact]
    public void RunAcceptsConfigAndRomInAnyOrder()
    {
        Assert.Equal(("c.json", Path.GetFullPath("e.gba")), Program.ParseOptions(["run", "--rom", "e.gba", "--config", "c.json"]));
        Assert.Equal(("c.json", Path.GetFullPath("e.gba")), Program.ParseOptions(["run", "--config", "c.json", "--rom", "e.gba"]));
        Assert.Equal((ConfigurationStore.DefaultPath, (string?)null), Program.ParseOptions(["run"]));
    }

    [Theory]
    [InlineData("doctor", "--rom", "e.gba")]
    [InlineData("run", "--rom")]
    [InlineData("run", "--rom", "a.gba", "--rom", "b.gba")]
    [InlineData("run", "--port", "3000")]
    public void RejectsInvalidOptions(params string[] args) =>
        Assert.Equal("invalid_arguments", Assert.Throws<ClientException>(() => Program.ParseOptions(args)).Code);
}
