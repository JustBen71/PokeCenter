using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
using BizHawk.Client.Common;
using BizHawk.Emulation.Common;
using Pokerace.BizHawkBridge.Core;

namespace Pokerace.BizHawkBridge;

[ExternalTool("Pokerace BizHawk Bridge")]
public sealed class BridgeForm : Form, IExternalToolForm
{
    // BizHawk reinjects these properties on every core/game change (ToolManager.Restart).
    public ApiContainer? APIs { get; set; }
    [OptionalService] public IMemoryDomains? MemoryDomains { get; set; }
    [RequiredService] public IEmulator Emulator { get; set; } = null!;
    [OptionalService] public ISaveRam? SaveRam { get; set; }
    private TcpBridgeServer? server;
    // Every 5 minutes, on the emulator thread: a copy of the game (savestate + in-game save), the last 3 kept.
    private readonly System.Windows.Forms.Timer autosave = new System.Windows.Forms.Timer { Interval = 5 * 60 * 1000 };
    // Once a second: the emulator controls used by the player (speed-up, rewind, savestate loads) for the admin logs.
    private readonly System.Windows.Forms.Timer controls = new System.Windows.Forms.Timer { Interval = 1000 };
    private IEmuClientApi? watchedClient;
    private readonly Label status = new Label { Dock = DockStyle.Fill, AutoSize = false };
    public BridgeForm()
    {
        Text = "Pokérace — BizHawk Bridge"; Width = 440; Height = 130;
        Controls.Add(status);
    }
    protected override void OnHandleCreated(EventArgs e)
    {
        // Start once the dispatcher has a window handle, independently of
        // whether the external tool window is visible.
        base.OnHandleCreated(e);
        if (server != null) return;
        try
        {
            var token = Environment.GetEnvironmentVariable("POKERACE_BRIDGE_TOKEN") ?? "";
            var rawPort = Environment.GetEnvironmentVariable("POKERACE_BRIDGE_PORT") ?? "43821";
            if (!int.TryParse(rawPort, out var port) || port < 1 || port > 65535) throw new ArgumentException("Invalid port.");
            var service = new BridgeService(new BizHawkHostAdapter(this), Environment.GetEnvironmentVariable("POKERACE_LOST_GAMES_DIR"), Environment.GetEnvironmentVariable("POKERACE_AUTOSAVES_DIR"),
                new Newtonsoft.Json.Linq.JObject { ["clientVersion"] = Environment.GetEnvironmentVariable("POKERACE_CLIENT_VERSION"),
                    ["romSha256"] = Environment.GetEnvironmentVariable("POKERACE_ROM_SHA256"), ["romRevision"] = Environment.GetEnvironmentVariable("POKERACE_ROM_REVISION") });
            server = new TcpBridgeServer(port, token, service, new FormDispatcher(this), log: Log);
            server.Start();
            autosave.Tick += (_, _) => { try { service.Autosave(); } catch (Exception) { Log("Autosave failed; the previous copies are kept."); } };
            autosave.Start();
            controls.Tick += (_, _) => { try { SampleControls(service.Controls); } catch (Exception) { } };
            controls.Start();
            status.Text = "Bridge actif sur 127.0.0.1:" + server.Port + "\nProtocole 1 — authentification requise.";
        }
        catch (Exception)
        {
            server?.Dispose(); server = null;
            status.Text = "Bridge arrêté : vérifier le port et POKERACE_BRIDGE_TOKEN (32 caractères minimum).";
            Log("Startup failed: check configuration and port availability.");
        }
    }
    private void SampleControls(ControlTracker tracker)
    {
        // BizHawk may hand out a new client API after a core change: follow it for the savestate-loaded event.
        var client = APIs?.EmuClient;
        if (client != watchedClient)
        {
            if (watchedClient != null) watchedClient.StateLoaded -= OnStateLoaded;
            if (client != null) client.StateLoaded += OnStateLoaded;
            watchedClient = client; stateTracker = tracker;
        }
        if (client == null || APIs!.Emulation.GetGameInfo() is not IGameInfo game || game.IsNullInstance()) return;
        tracker.Sample(Emulator.Frame, client.IsRewinding(), DateTime.UtcNow);
    }
    private ControlTracker? stateTracker;
    private void OnStateLoaded(object? sender, StateLoadedEventArgs e) => stateTracker?.StateLoaded();
    // Informative window only: it must not take the keyboard from the game, or BizHawk's hotkeys (save slots…) stop
    // working until the player clicks the game window (seen under Linux/Mono).
    protected override bool ShowWithoutActivation => true;
    protected override void OnShown(EventArgs e)
    {
        base.OnShown(e);
        Application.OpenForms.Cast<Form>().FirstOrDefault(f => f != this && f.GetType().Name == "MainForm")?.Activate();
    }
    private static void Log(string message)
    {
        try
        {
            var path = Environment.GetEnvironmentVariable("POKERACE_BRIDGE_LOG");
            if (!string.IsNullOrWhiteSpace(path)) File.AppendAllText(path, DateTime.UtcNow.ToString("O") + " " + message + Environment.NewLine);
        }
        catch (Exception) { }
    }
    protected override void Dispose(bool disposing)
    {
        if (disposing) { controls.Dispose(); if (watchedClient != null) watchedClient.StateLoaded -= OnStateLoaded; autosave.Dispose(); server?.Dispose(); }
        base.Dispose(disposing);
    }
    public bool IsActive => IsHandleCreated && !IsDisposed;
    public bool IsLoaded => IsActive;
    public bool AskSaveChanges() => true;
    public void Restart() { /* Host adapter resolves the freshly injected services per request. */ }
    public void UpdateValues(ToolFormUpdateType type) { }
}

internal sealed class BizHawkHostAdapter : IEmulatorHost
{
    private readonly BridgeForm form;
    public BizHawkHostAdapter(BridgeForm form) => this.form = form;
    public bool IsGameLoaded => form.APIs?.Emulation.GetGameInfo() is IGameInfo game && !game.IsNullInstance();
    public string? SystemId => IsGameLoaded ? form.Emulator.SystemId : null;
    public object? GetGameInfo()
    {
        var game = form.APIs?.Emulation.GetGameInfo();
        return game == null || game.IsNullInstance() ? null : new { name = game.Name, systemId = form.Emulator.SystemId, hash = game.Hash, region = game.Region };
    }
    public IReadOnlyList<IMemoryDomainAdapter> GetMemoryDomains() => form.MemoryDomains == null
        ? Array.Empty<IMemoryDomainAdapter>()
        : form.MemoryDomains.Select(d => (IMemoryDomainAdapter)new DomainAdapter(d)).ToArray();
    public void ArchiveGame(string directory)
    {
        var save = form.SaveRam?.CloneSaveRam() ?? throw new InvalidOperationException("No in-game save.");
        File.WriteAllBytes(Path.Combine(directory, "game.SaveRAM"), save);
        var state = Path.Combine(directory, "game.State");
        form.APIs!.SaveState.Save(state, true);
        if (!File.Exists(state)) throw new InvalidOperationException("Savestate not written.");
    }
    public void EraseSaveAndReboot()
    {
        // Erased flash reads 0xFF: the game sees no save. Only the cartridge memory (largest power of two) is erased:
        // mGBA appends the real-time clock after it (16 bytes for Emerald), wiping it shows "internal battery dry".
        // The reboot flushes this save to disk, then reloads it.
        var save = form.SaveRam?.CloneSaveRam() ?? throw new InvalidOperationException("No in-game save.");
        var cartridge = 1; while (cartridge * 2 <= save.Length) cartridge *= 2;
        for (var i = 0; i < cartridge; i++) save[i] = 0xFF;
        form.SaveRam.StoreSaveRam(save);
        form.APIs!.EmuClient.RebootCore();
    }
    private sealed class DomainAdapter : IMemoryDomainAdapter
    {
        private readonly MemoryDomain domain;
        public DomainAdapter(MemoryDomain domain) => this.domain = domain;
        public string Name => domain.Name;
        public long Size => domain.Size;
        public bool Writable => domain.Writable;
        public byte ReadByte(long address)
        {
            domain.Enter();
            try { return domain.PeekByte(address); } finally { domain.Exit(); }
        }
        public void WriteByte(long address, byte value)
        {
            domain.Enter();
            try { domain.PokeByte(address, value); } finally { domain.Exit(); }
        }
    }
}

internal sealed class FormDispatcher : IEmulatorDispatcher
{
    private readonly Control control;
    public FormDispatcher(Control control) => this.control = control;
    public async Task<T> InvokeAsync<T>(Func<T> action, CancellationToken cancellation)
    {
        var completion = new TaskCompletionSource<T>(TaskCreationOptions.RunContinuationsAsynchronously);
        var started = 0;
        using (cancellation.Register(() =>
        {
            if (Interlocked.CompareExchange(ref started, 2, 0) == 0) completion.TrySetCanceled();
        }))
        {
            if (!cancellation.IsCancellationRequested)
            {
                try
                {
                    control.BeginInvoke(new Action(() =>
                    {
                        if (Interlocked.CompareExchange(ref started, 1, 0) != 0) return;
                        try { completion.TrySetResult(action()); }
                        catch (Exception e) { completion.TrySetException(e); }
                    }));
                }
                catch (Exception e) { completion.TrySetException(e); }
            }
            return await completion.Task.ConfigureAwait(false);
        }
    }
}
