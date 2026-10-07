using System.Buffers.Binary;
using System.Text.Json.Nodes;
using Pokerace.Client.Commands;
using Pokerace.Client.Configuration;
using Pokerace.Client.Games;
using Pokerace.Client.Games.Pokemon.Gen3;
using Xunit;

namespace Pokerace.Client.Tests;

// Bag items on synthetic Gen III memory (SaveBlock1 at 0x02001000, key 0x12345678), through the real bridge transaction.
public sealed class ItemTests
{
    private static LocalRomIdentity Identity => new((string)Gen3ProfileRegistry.Resource("rom-manifest")["roms"]![0]!["sha256"]!, new string('b', 40));
    private const long Sb1 = 0x02001000; private const ushort Key = 0x5678;
    private static (int Id, int Quantity) Slot(GameAdapterTests.MemoryBridge b, int pocket, int i)
    {
        var at = (int)(Sb1 - 0x02000000) + pocket + i * 4;
        return (BinaryPrimitives.ReadUInt16LittleEndian(b.Ewram.AsSpan(at)), BinaryPrimitives.ReadUInt16LittleEndian(b.Ewram.AsSpan(at + 2)) ^ Key);
    }
    private static void Put(GameAdapterTests.MemoryBridge b, int pocket, int i, int id, int quantity)
    {
        var at = (int)(Sb1 - 0x02000000) + pocket + i * 4;
        BinaryPrimitives.WriteUInt16LittleEndian(b.Ewram.AsSpan(at), (ushort)id); BinaryPrimitives.WriteUInt16LittleEndian(b.Ewram.AsSpan(at + 2), (ushort)(quantity ^ Key));
    }
    private static GameAdapterTests.MemoryBridge Game() { var b = new GameAdapterTests.MemoryBridge(); b.SetParty(1); return b; }
    private static Task<CommandResult> Run(GameAdapterTests.MemoryBridge b, string command, JsonObject payload, bool writes = true) =>
        new CommandRouter(b, new ClientConfiguration { AllowPokemonPurchases = writes }, romIdentity: Identity).RouteAsync(ClientTests.Command(command, payload: payload), default);

    [Fact] public async Task AddStacksThenUsesTheFirstEmptySlotOfTheRightPocket()
    {
        await using var b = Game();
        Assert.True((await Run(b, Gen3Items.AddCommand, new() { ["itemId"] = 13 })).Ok);
        var again = await Run(b, Gen3Items.AddCommand, new() { ["itemId"] = 13 });
        Assert.Equal(2, (int)again.Result!["quantity"]!);
        Assert.Equal((13, 2), Slot(b, 0x560, 0));
        Assert.True((await Run(b, Gen3Items.AddCommand, new() { ["itemId"] = 1 })).Ok);    // Master Ball → Poké Balls pocket
        Assert.True((await Run(b, Gen3Items.AddCommand, new() { ["itemId"] = 289 })).Ok);  // TM01 → TM pocket
        Assert.True((await Run(b, Gen3Items.AddCommand, new() { ["itemId"] = 133 })).Ok);  // Cheri Berry → Berries
        Assert.Equal((1, 1), Slot(b, 0x650, 0)); Assert.Equal((289, 1), Slot(b, 0x690, 0)); Assert.Equal((133, 1), Slot(b, 0x790, 0));
    }

    [Fact] public async Task KeyItemsHmsFullPocketsAndConsentAreRefused()
    {
        await using var b = Game();
        foreach (var id in new[] { 259, 339, 175, 0, 400 }) Assert.Equal("invalid_item", (await Run(b, Gen3Items.AddCommand, new() { ["itemId"] = id })).ErrorCode);
        for (var i = 0; i < 16; i++) Put(b, 0x650, i, 4, 99);
        Assert.Equal("bag_full", (await Run(b, Gen3Items.AddCommand, new() { ["itemId"] = 4 })).ErrorCode);
        Assert.Equal("writes_disabled", (await Run(b, Gen3Items.AddCommand, new() { ["itemId"] = 13 }, writes: false)).ErrorCode);
        Assert.Equal(0, b.Transactions);
    }

    [Fact] public async Task TakeRemovesOneOfARandomTakeableStackAndCompactsThePocket()
    {
        await using var b = Game();
        Put(b, 0x5D8, 0, 259, 1);  // key item: never taken
        Put(b, 0x690, 0, 339, 1);  // HM01: never taken
        Put(b, 0x560, 0, 13, 1); Put(b, 0x560, 1, 17, 1);
        var taken = await Run(b, Gen3Items.TakeCommand, new());
        Assert.True(taken.Ok, taken.ErrorCode);
        var gone = (int)taken.Result!["itemId"]!;
        Assert.Contains(gone, new[] { 13, 17 });
        Assert.Equal((gone == 13 ? 17 : 13, 1), Slot(b, 0x560, 0)); // compacted
        Assert.Equal(0, Slot(b, 0x560, 1).Id);
        Assert.True((await Run(b, Gen3Items.TakeCommand, new())).Ok);
        Assert.Equal("bag_empty", (await Run(b, Gen3Items.TakeCommand, new())).ErrorCode);
        Assert.Equal((259, 1), Slot(b, 0x5D8, 0)); Assert.Equal((339, 1), Slot(b, 0x690, 0));
    }
}
