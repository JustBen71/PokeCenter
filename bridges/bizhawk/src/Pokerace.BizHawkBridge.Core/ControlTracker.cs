using System;
using System.Collections.Generic;

namespace Pokerace.BizHawkBridge.Core;

/// <summary>
/// What the player does with the emulator's controls, for the admin logs: speed-up (fast forward, turbo, speed above
/// 100 %), rewind, savestate loads and core reboots. Sampled about once a second on the emulator thread; the client
/// drains the finished episodes. Thresholds are lenient: a slow PC never looks like a speed-up.
/// </summary>
public sealed class ControlTracker
{
    public const double GbaFps = 59.7275, FastFactor = 1.5;
    public const int MaxEpisodeSeconds = 60, MaxPending = 100;
    private readonly Queue<Dictionary<string, object>> pending = new Queue<Dictionary<string, object>>();
    private long? lastFrame; private DateTime lastAt;
    private string? episode; private double episodeSeconds, episodeMax;
    private bool stateLoaded, expectedReboot;

    public void StateLoaded() => stateLoaded = true;
    /// <summary>A reboot asked by Pokérace itself (game reset after a defeat) is not the player's.</summary>
    public void ExpectReboot() => expectedReboot = true;

    public void Sample(long frame, bool rewinding, DateTime now)
    {
        if (lastFrame is not { } previous) { lastFrame = frame; lastAt = now; stateLoaded = false; return; }
        var seconds = (now - lastAt).TotalSeconds;
        lastFrame = frame; lastAt = now;
        if (seconds <= 0) return;
        if (stateLoaded) { stateLoaded = false; Close(); Add("STATE_LOADED"); return; }
        if (frame < previous && frame < 120 && !rewinding)
        {
            Close();
            if (expectedReboot) expectedReboot = false; else Add("REBOOT");
            return;
        }
        var speed = (frame - previous) / seconds / GbaFps;
        var kind = rewinding || frame < previous ? "REWIND" : speed >= FastFactor ? "FAST_FORWARD" : null;
        if (kind != episode) Close();
        if (kind == null) return;
        episode = kind; episodeSeconds += seconds; episodeMax = Math.Max(episodeMax, Math.Abs(speed));
        if (episodeSeconds >= MaxEpisodeSeconds) Close();
    }

    /// <summary>Finished events, oldest first; an episode still running is reported once it ends (or every minute).</summary>
    public List<Dictionary<string, object>> Drain()
    {
        var all = new List<Dictionary<string, object>>(pending);
        pending.Clear();
        return all;
    }

    private void Close()
    {
        if (episode == null) return;
        Add(episode, new Dictionary<string, object> { ["seconds"] = (int)Math.Round(episodeSeconds), ["maxSpeedPercent"] = (int)Math.Round(episodeMax * 100) });
        episode = null; episodeSeconds = 0; episodeMax = 0;
    }

    private void Add(string action, Dictionary<string, object>? data = null)
    {
        var item = data ?? new Dictionary<string, object>();
        item["action"] = action;
        if (pending.Count >= MaxPending) pending.Dequeue();
        pending.Enqueue(item);
    }
}
