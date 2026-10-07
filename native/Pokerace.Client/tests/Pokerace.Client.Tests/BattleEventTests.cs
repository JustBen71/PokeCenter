using Pokerace.Client.Games.Pokemon.Gen3;
using Xunit;

namespace Pokerace.Client.Tests;

// Battle and step events from successive observations (in-battle flag, battle type, outcome, money, party HP).
public sealed class BattleEventTests
{
    private static Gen3BattleEvents.Member M(uint pid, int slot, int hp) => new(pid, slot, 250 + (int)pid, hp);
    private static string Kinds(List<(string Kind, System.Text.Json.Nodes.JsonObject Data)> e) => string.Join(",", e.Select(x => x.Kind));

    [Fact]
    public void TrainerBattleWonWithAFaintedMember()
    {
        var d = new Gen3BattleEvents.Detector();
        Assert.Empty(d.Observe(false, 0, 0, 1000, [M(1, 1, 30), M(2, 2, 20)]));
        Assert.Empty(d.Observe(true, 8, 0, 1000, [M(1, 1, 30), M(2, 2, 20)]));
        // Switched order in battle does not matter: members are followed by personality.
        var faint = d.Observe(true, 8, 0, 1000, [M(2, 1, 0), M(1, 2, 12)]);
        Assert.Equal("POKEMON_FAINTED", Kinds(faint));
        Assert.Equal(1, (int)faint[0].Data["slot"]!); Assert.Equal(252, (int)faint[0].Data["speciesId"]!);
        Assert.Empty(d.Observe(true, 8, 0, 1000, [M(2, 1, 0), M(1, 2, 12)]));
        var end = d.Observe(false, 8, 1, 1360, [M(2, 1, 0), M(1, 2, 12)]);
        Assert.Equal("BATTLE_ENDED,TRAINER_VICTORY", Kinds(end));
        Assert.Equal("WIN", (string)end[0].Data["outcome"]!); Assert.Equal(1, (int)end[0].Data["conscious"]!);
        Assert.Equal(1000, (long)end[1].Data["moneyBefore"]!); Assert.Equal(1360, (long)end[1].Data["moneyAfter"]!); Assert.Equal(360, (long)end[1].Data["baseReward"]!);
        Assert.Empty(d.Observe(false, 8, 1, 1360, [M(2, 1, 0), M(1, 2, 12)]));
    }

    [Fact]
    public void WildBattlesAreNotTrainerVictories()
    {
        var d = new Gen3BattleEvents.Detector();
        d.Observe(true, 0, 0, 500, [M(1, 1, 30)]);
        Assert.Equal("BATTLE_ENDED", Kinds(d.Observe(false, 0, 1, 500, [M(1, 1, 30)])));
        d.Observe(true, 0, 0, 500, [M(1, 1, 30)]);
        var fled = d.Observe(false, 0, 4, 500, [M(1, 1, 30)]);
        Assert.Equal("FLEE", (string)fled[0].Data["outcome"]!);
        d.Observe(true, 8, 0, 500, [M(1, 1, 30)]);
        Assert.Equal("LOSS", (string)d.Observe(false, 8, 2, 250, [M(1, 1, 0)])[0].Data["outcome"]!);
    }

    [Fact]
    public void StepsEveryHundredAndANewGameIsSentAtOnce()
    {
        var d = new Gen3BattleEvents.Detector();
        Assert.Equal(86, (long)d.Steps(86)!["absolute"]!);
        Assert.Null(d.Steps(99));
        Assert.Equal(100, (long)d.Steps(100)!["absolute"]!);
        Assert.Null(d.Steps(150));
        Assert.Equal(3, (long)d.Steps(3)!["absolute"]!);
    }
}
