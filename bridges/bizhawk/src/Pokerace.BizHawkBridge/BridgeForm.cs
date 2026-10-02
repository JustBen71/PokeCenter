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
    private TcpBridgeServer? server;
    private readonly Label status = new Label { Dock = DockStyle.Fill, AutoSize = false };
    public BridgeForm()
    {
        Text = "Pokérace — BizHawk Bridge"; Width = 440; Height = 130;
        Controls.Add(status);
    }
    protected override void OnHandleCreated(EventArgs e)
    {
        // The hidden CI launch can defer Shown until shutdown. Start once the
        // dispatcher has a window handle, independently of window visibility.
        base.OnHandleCreated(e);
        if (server != null) return;
        try
        {
            var token = Environment.GetEnvironmentVariable("POKERACE_BRIDGE_TOKEN") ?? "";
            var rawPort = Environment.GetEnvironmentVariable("POKERACE_BRIDGE_PORT") ?? "43821";
            if (!int.TryParse(rawPort, out var port) || port < 1 || port > 65535) throw new ArgumentException("Invalid port.");
            server = new TcpBridgeServer(port, token, new BridgeService(new BizHawkHostAdapter(this)), new FormDispatcher(this), log: Log);
            server.Start();
            status.Text = "Bridge actif sur 127.0.0.1:" + server.Port + "\nProtocole 1 — authentification requise.";
        }
        catch (Exception)
        {
            server?.Dispose(); server = null;
            status.Text = "Bridge arrêté : vérifier le port et POKERACE_BRIDGE_TOKEN (32 caractères minimum).";
            Log("Startup failed: check configuration and port availability.");
        }
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
        if (disposing) server?.Dispose();
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
