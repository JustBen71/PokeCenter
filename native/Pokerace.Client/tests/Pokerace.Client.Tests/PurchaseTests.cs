using System.Text.Json.Nodes;
using Pokerace.Client.Commands;
using Pokerace.Client.Configuration;
using Pokerace.Client.Games;
using Pokerace.Client.Games.Pokemon.Gen3;
using Xunit;

namespace Pokerace.Client.Tests;
public sealed class PurchaseTests
{
    private static LocalRomIdentity Identity => new((string)Gen3ProfileRegistry.Resource("rom-manifest")["roms"]![0]!["sha256"]!, new string('b',40));
    private static JsonObject Purchase() => ClientTests.Command("pokemon.purchase",payload:new() { ["price"]=100,["expectedMoney"]=12500,["expectedCount"]=1,["raw"]=Convert.ToHexString(GameAdapterTests.MemoryBridge.Pokemon(0)) });
    [Fact] public async Task SoloPurchaseDebitsAndAddsExactlyOnceAndPreservesExactCopy()
    {
        await using var bridge=new GameAdapterTests.MemoryBridge();bridge.SetParty(1);
        var router=new CommandRouter(bridge,new ClientConfiguration(),romIdentity:Identity);
        var command=Purchase();Assert.True((await router.RouteAsync(command,default)).Ok);
        Assert.True((await router.RouteAsync(command,default)).Ok);Assert.Equal(1,bridge.Transactions);
        var state=(await new GameAdapterManager(bridge,Identity).ObserveAsync(new(true,true,"GBA",1),default)).State!;
        Assert.Equal(12400u,state.Trainer.Money);Assert.Equal(2,state.Party.Length);
        Assert.Equal(Convert.ToHexString(GameAdapterTests.MemoryBridge.Pokemon(0)).ToLowerInvariant(),state.Party[1].Artifact!.Raw);
    }
    [Theory][InlineData("money")][InlineData("party")][InlineData("rom")]
    public async Task ChangedStateCannotBeDebited(string change)
    {
        await using var bridge=new GameAdapterTests.MemoryBridge();bridge.SetParty(1);
        bridge.BeforeTransaction=()=>{if(change=="money")bridge.Put32(0x02001490,12000^0x12345678);else if(change=="party")bridge.SetParty(2);else bridge.Hash="another-rom";};
        var result=await new CommandRouter(bridge,new ClientConfiguration(),romIdentity:Identity).RouteAsync(Purchase(),default);
        Assert.False(result.Ok);Assert.Equal("state_changed",result.ErrorCode);Assert.Equal(0,bridge.Transactions);
    }
    [Fact] public async Task PurchaseCanBeDisabledLocally()
    {
        await using var bridge=new GameAdapterTests.MemoryBridge();bridge.SetParty(1);
        var result=await new CommandRouter(bridge,new ClientConfiguration { AllowPokemonPurchases=false },romIdentity:Identity).RouteAsync(Purchase(),default);
        Assert.False(result.Ok);Assert.Equal("writes_disabled",result.ErrorCode);Assert.Equal(0,bridge.Reads);
    }
}
