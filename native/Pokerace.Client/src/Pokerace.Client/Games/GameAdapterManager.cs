using Pokerace.Client.Bridge;
using Pokerace.Client.Games.Pokemon.Gen3;

namespace Pokerace.Client.Games;

public sealed class GameAdapterManager(IBridgeClient bridge, LocalRomIdentity? identity, bool writesEnabled = false, BattleEncounterStore? battles = null)
{
    private GameObservation latest = GameObservation.Unavailable("no_game");
    private IGameAdapter? adapter;
    public GameObservation Snapshot => Volatile.Read(ref latest);
    public async Task<GameObservation> ObserveAsync(BridgeStatus status, CancellationToken cancellation)
    {
        if (!status.Connected || !status.GameLoaded) return GameObservation.Unavailable("no_game");
        if (status.SystemId != "GBA") return GameObservation.Unavailable("unsupported_system");
        if (identity == null) return GameObservation.Unavailable("rom_identity_unavailable");
        var (result, profile) = new Gen3ProfileRegistry().Resolve(identity.Sha256);
        if (profile == null) return GameObservation.Unavailable(result);
        if (!identity.MatchesLoadedGame(await bridge.GetGameInfoAsync(cancellation))) return GameObservation.Unavailable("rom_identity_unavailable");
        if (!Gen3Memory.HasDomains(await bridge.GetMemoryDomainsAsync(cancellation))) return GameObservation.Unavailable("memory_domain_unavailable", profile.ProfileId);
        adapter ??= new Gen3GameAdapter(bridge, profile, writesEnabled, battles);
        var snapshot = await adapter.ReadAsync(cancellation);
        // Do not publish a previous game's data if the user switched ROMs during reads.
        if (!identity.MatchesLoadedGame(await bridge.GetGameInfoAsync(cancellation))) return GameObservation.Unavailable("rom_identity_unavailable");
        return new(snapshot.Adapter, snapshot);
    }
    public async Task RunAsync(Func<BridgeStatus> status, CancellationToken cancellation)
    {
        try
        {
            while (!cancellation.IsCancellationRequested)
            {
                GameObservation current;
                try { current = await ObserveAsync(status(), cancellation); }
                catch (OperationCanceledException) when (cancellation.IsCancellationRequested) { break; }
                catch (Exception) { current = GameObservation.Unavailable("read_error", latest.Adapter.ProfileId); }
                Volatile.Write(ref latest, current);
                await Task.Delay(TimeSpan.FromMilliseconds(750), cancellation);
            }
        }
        catch (OperationCanceledException) when (cancellation.IsCancellationRequested) { }
    }
}
