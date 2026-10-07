using System;
using System.IO;
using System.Linq;
using Newtonsoft.Json.Linq;

namespace Pokerace.BizHawkBridge.Core;

public sealed class BridgeService
{
    // Lost games kept on disk (savestate + in-game save) before an automatic reset; the oldest are deleted.
    public const int KeptLostGames = 3;
    private readonly IEmulatorHost host;
    private readonly string lostGamesDirectory;
    public BridgeService(IEmulatorHost host, string? lostGamesDirectory = null)
    {
        this.host = host;
        this.lostGamesDirectory = lostGamesDirectory ?? Path.Combine(Environment.CurrentDirectory, "PokeraceLostGames");
    }

    public JObject Execute(JObject request)
    {
        var id = request["id"];
        try
        {
            object result;
            switch (Protocol.Text(request, "type"))
            {
                case "ping": result = new { type = "pong" }; break;
                case "getStatus": result = new { bridge = "pokerace-bizhawk", protocolVersion = Protocol.Version, connected = true, systemId = host.SystemId, gameLoaded = host.IsGameLoaded }; break;
                case "getSystem": result = new { systemId = host.SystemId }; break;
                case "getGameInfo": result = new { game = host.GetGameInfo() }; break;
                case "listMemoryDomains":
                    RequireGame();
                    result = new { domains = host.GetMemoryDomains().Select(d => new { name = d.Name, size = d.Size, writable = d.Writable }).ToArray() };
                    break;
                case "readMemory":
                {
                    var domain = Domain(request);
                    var address = Protocol.Integer(request, "address");
                    var length = Protocol.Integer(request, "length");
                    Range(domain, address, length);
                    result = new { data = Protocol.Hex(Read(domain, address, (int)length)) };
                    break;
                }
                case "writeMemory":
                {
                    var domain = Domain(request);
                    var address = Protocol.Integer(request, "address");
                    var data = Protocol.Hex(Protocol.Text(request, "data"));
                    Range(domain, address, data.Length);
                    if (!domain.Writable) throw new BridgeException("read_only", "Memory domain is read-only.");
                    var written = 0;
                    try
                    {
                        for (; written < data.Length; written++) domain.WriteByte(address + written, data[written]);
                        if (!Read(domain, address, data.Length).SequenceEqual(data))
                            throw new BridgeException("verification_failed", "Read-back differs; memory may have changed.");
                    }
                    catch (BridgeException) { throw; }
                    catch (Exception) { throw new BridgeException("write_failed", "Write or read-back failed after " + written + " completed byte writes; memory may have changed."); }
                    result = new { written = data.Length, verified = true };
                    break;
                }
                case "compareWrite":
                {
                    RequireSameGame(request);
                    var edits = request["edits"] as JArray;
                    if (edits == null || edits.Count < 1 || edits.Count > 12) throw new BridgeException("invalid_data", "Invalid transaction.");
                    var operations = edits.Select(node => {
                        var item = node as JObject ?? throw new BridgeException("invalid_data", "Invalid edit.");
                        var domain = Domain(item); var address = Protocol.Integer(item, "address");
                        var expected = Protocol.Hex(Protocol.Text(item, "expected"));
                        var data = (item["data"] == null || item["data"]!.Type == JTokenType.Null) ? expected : Protocol.Hex(Protocol.Text(item, "data"));
                        Range(domain, address, expected.Length);
                        if (expected.Length != data.Length || !domain.Writable) throw new BridgeException("invalid_data", "Invalid edit range.");
                        return new { domain, address, expected, data };
                    }).ToArray();
                    for (var i = 0; i < operations.Length; i++)
                    {
                        var op = operations[i];
                        if (operations.Take(i).Any(other => other.domain.Name == op.domain.Name && op.address < other.address + other.expected.Length && other.address < op.address + op.expected.Length))
                            throw new BridgeException("invalid_data", "Overlapping edits.");
                        if (!Read(op.domain, op.address, op.expected.Length).SequenceEqual(op.expected)) throw new BridgeException("state_changed", "Game state changed.");
                    }
                    // Execute on the emulator dispatcher in one turn: no emulated frame between checks and writes.
                    try
                    {
                        foreach (var op in operations.Where(op => !op.expected.SequenceEqual(op.data)))
                            for (var i = 0; i < op.data.Length; i++) op.domain.WriteByte(op.address + i, op.data[i]);
                        foreach (var op in operations)
                            if (!Read(op.domain, op.address, op.data.Length).SequenceEqual(op.data)) throw new InvalidOperationException();
                    }
                    catch (Exception)
                    {
                        try { foreach (var op in operations.Where(op => !op.expected.SequenceEqual(op.data))) for (var i = 0; i < op.expected.Length; i++) op.domain.WriteByte(op.address + i, op.expected[i]); }
                        catch (Exception) { }
                        throw new BridgeException("write_failed", "Transaction could not be verified; inspect game before retrying.");
                    }
                    result = new { verified = true }; break;
                }
                case "resetGame":
                {
                    // Archive first: if the savestate or the save copy fails, nothing is erased.
                    RequireSameGame(request);
                    var folder = Path.Combine(lostGamesDirectory, DateTime.UtcNow.ToString("yyyyMMdd'T'HHmmssfff'Z'"));
                    Directory.CreateDirectory(folder);
                    try { host.ArchiveGame(folder); }
                    catch (Exception) { try { Directory.Delete(folder, true); } catch (Exception) { } throw new BridgeException("archive_failed", "The game could not be archived; nothing was erased."); }
                    foreach (var old in Directory.GetDirectories(lostGamesDirectory).OrderByDescending(d => Path.GetFileName(d), StringComparer.Ordinal).Skip(KeptLostGames))
                        try { Directory.Delete(old, true); } catch (Exception) { }
                    try { host.EraseSaveAndReboot(); }
                    catch (Exception) { throw new BridgeException("reset_failed", "Game archived but the reset failed; inspect the emulator."); }
                    result = new { archive = Path.GetFileName(folder), kept = KeptLostGames };
                    break;
                }
                default: throw new BridgeException("unknown_command", "Unknown request type.");
            }
            return Protocol.Ok(id, result);
        }
        catch (BridgeException e) { return Protocol.Error(id, e.Code, e.Message); }
        catch (Exception) { return Protocol.Error(id, "host_error", "Emulator operation failed."); }
    }

    private void RequireGame()
    {
        if (!host.IsGameLoaded) throw new BridgeException("no_game", "No game is loaded.");
    }
    private void RequireSameGame(JObject request)
    {
        RequireGame();
        var info = host.GetGameInfo();
        if (host.SystemId != "GBA" || info == null || !string.Equals((string?)JObject.FromObject(info)["hash"], Protocol.Text(request, "gameHash"), StringComparison.OrdinalIgnoreCase))
            throw new BridgeException("state_changed", "Loaded game changed.");
    }
    private IMemoryDomainAdapter Domain(JObject request)
    {
        RequireGame();
        var name = Protocol.Text(request, "domain");
        return host.GetMemoryDomains().FirstOrDefault(d => d.Name == name)
            ?? throw new BridgeException("unknown_domain", "Memory domain does not exist.");
    }
    private static void Range(IMemoryDomainAdapter domain, long address, long length)
    {
        if (length < 1 || length > Protocol.MaxTransfer || address < 0 || address > domain.Size || length > domain.Size - address)
            throw new BridgeException("invalid_range", "Range is outside the domain or exceeds 4096 bytes.");
    }
    private static byte[] Read(IMemoryDomainAdapter domain, long address, int length)
    {
        var result = new byte[length];
        for (var i = 0; i < length; i++) result[i] = domain.ReadByte(address + i);
        return result;
    }
}
