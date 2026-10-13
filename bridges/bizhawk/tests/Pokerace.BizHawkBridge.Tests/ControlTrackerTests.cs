using System;
using System.Linq;
using Newtonsoft.Json.Linq;
using Pokerace.BizHawkBridge.Core;
using Xunit;

namespace Pokerace.BizHawkBridge.Tests;

public class ControlTrackerTests
{
    private static readonly DateTime T0 = new DateTime(2026, 10, 13, 12, 0, 0, DateTimeKind.Utc);
    // One sample per second; frames advanced each second.
    private static ControlTracker Run(params int[] perSecond)
    {
        var tracker = new ControlTracker(); long frame = 1000;
        tracker.Sample(frame, false, T0);
        for (var i = 0; i < perSecond.Length; i++) { frame += perSecond[i]; tracker.Sample(frame, perSecond[i] < 0, T0.AddSeconds(i + 1)); }
        return tracker;
    }

    [Fact] public void NormalSpeedAndSlowPcAndPauseLogNothing() => Assert.Empty(Run(60, 60, 40, 0, 0, 60, 80).Drain());

    [Fact] public void FastForwardIsOneEpisodeWithItsDurationAndMaxSpeed()
    {
        var events = Run(60, 240, 480, 240, 60).Drain();
        var e = Assert.Single(events);
        Assert.Equal("FAST_FORWARD", e["action"]); Assert.Equal(3, e["seconds"]); Assert.Equal(804, e["maxSpeedPercent"]);
    }

    [Fact] public void LongFastForwardIsReportedEveryMinute()
    {
        var events = Run(Enumerable.Repeat(300, 130).ToArray()).Drain();
        Assert.Equal(2, events.Count); Assert.All(events, e => Assert.Equal(60, e["seconds"]));
    }

    [Fact] public void RewindStateLoadAndRebootAreSeparateEvents()
    {
        var tracker = Run(60, -60, -60, 60);
        tracker.StateLoaded(); tracker.Sample(500, false, T0.AddSeconds(5));
        tracker.Sample(10, false, T0.AddSeconds(6));
        var events = tracker.Drain();
        Assert.Equal(new[] { "REWIND", "STATE_LOADED", "REBOOT" }, events.Select(e => (string)e["action"]));
        Assert.Equal(2, events[0]["seconds"]);
        Assert.Empty(tracker.Drain());
    }

    [Fact] public void PokeraceOwnResetIsNotThePlayers()
    {
        var tracker = Run(60); tracker.ExpectReboot(); tracker.Sample(5, false, T0.AddSeconds(2));
        Assert.Empty(tracker.Drain());
    }

    [Fact] public void TheBridgeHandsOverTheEventsOnce()
    {
        var service = new BridgeService(new FakeEmulatorHost { SystemId = "GBA" });
        service.Controls.Sample(0, false, T0); service.Controls.Sample(600, false, T0.AddSeconds(1)); service.Controls.Sample(660, false, T0.AddSeconds(2));
        var first = service.Execute(JObject.FromObject(new { id = "c", type = "getControls" }));
        Assert.Equal("FAST_FORWARD", (string?)first["events"]![0]!["action"]);
        Assert.Empty((JArray)service.Execute(JObject.FromObject(new { id = "d", type = "getControls" }))["events"]!);
    }
}
