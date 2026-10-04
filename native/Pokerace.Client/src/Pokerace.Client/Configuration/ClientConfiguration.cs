using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;

namespace Pokerace.Client.Configuration;

public sealed record ClientConfiguration
{
    public string ServerUrl { get; init; } = "https://race.example.com";
    public string RoomCode { get; init; } = "";
    public string PlayerName { get; init; } = "";
    [JsonRequired] public string PlayerId { get; init; } = "p-" + Guid.NewGuid().ToString("N");
    public string BridgeHost { get; init; } = "127.0.0.1";
    public int BridgePort { get; init; } = 43821;
    public bool AllowMemoryWrites { get; init; }
    public bool AllowPokemonPurchases { get; init; } = true;
    public bool AllowInsecureLocalServer { get; init; }
    public int HeartbeatSeconds { get; init; } = 5;

    public void Validate()
    {
        if (!Uri.TryCreate(ServerUrl, UriKind.Absolute, out var uri) ||
            uri.UserInfo.Length != 0 || uri.Query.Length != 0 || uri.Fragment.Length != 0 || uri.AbsolutePath != "/" ||
            uri.Scheme is not ("https" or "wss" or "http" or "ws"))
            throw new ClientException("invalid_configuration", "Server URL must use HTTP/HTTPS or WS/WSS (no credentials, query or path).");
        if (BridgeHost != "127.0.0.1" || BridgePort is < 1 or > 65535)
            throw new ClientException("invalid_configuration", "Bridge must use 127.0.0.1 and a valid port.");
        if (string.IsNullOrEmpty(PlayerId) || !Regex.IsMatch(PlayerId, "^[a-z0-9][a-z0-9_-]{1,39}$") || string.IsNullOrWhiteSpace(PlayerName) || PlayerName.Trim().Length > 32 || PlayerName.Any(char.IsControl))
            throw new ClientException("invalid_configuration", "Player identity is invalid.");
        if (string.IsNullOrWhiteSpace(RoomCode) || RoomCode.Length > 128 || HeartbeatSeconds is < 1 or > 60)
            throw new ClientException("invalid_configuration", "Room code or heartbeat interval is invalid.");
    }
}

public static class ConfigurationStore
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web)
    { WriteIndented = true, UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow };
    public static string DefaultPath => Path.Combine(
        OperatingSystem.IsWindows() ? Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData) :
        OperatingSystem.IsMacOS() ? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "Library", "Application Support") :
        Environment.GetEnvironmentVariable("XDG_CONFIG_HOME") is { } xdg && Path.IsPathFullyQualified(xdg) ? xdg :
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".config"), "Pokerace", "client.json");

    public static ClientConfiguration Load(string path)
    {
        try
        {
            if (new FileInfo(path).Length > 16384) throw new JsonException();
            var configuration = JsonSerializer.Deserialize<ClientConfiguration>(File.ReadAllText(path), Json) ?? throw new JsonException();
            configuration.Validate(); return configuration;
        }
        catch (ClientException) { throw; }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException or JsonException)
        { throw new ClientException("invalid_configuration", "Cannot load configuration. Run configure or check the JSON file."); }
    }
    public static void Save(string path, ClientConfiguration configuration)
    {
        configuration.Validate();
        var full = Path.GetFullPath(path);
        Directory.CreateDirectory(Path.GetDirectoryName(full)!);
        var temp = full + "." + Guid.NewGuid().ToString("N") + ".tmp";
        try
        {
            var options = new FileStreamOptions { Mode = FileMode.CreateNew, Access = FileAccess.Write };
            if (!OperatingSystem.IsWindows()) options.UnixCreateMode = UnixFileMode.UserRead | UnixFileMode.UserWrite;
            using (var stream = new FileStream(temp, options)) JsonSerializer.Serialize(stream, configuration, Json);
            File.Move(temp, full, true);
        }
        finally { if (File.Exists(temp)) File.Delete(temp); }
    }
}
