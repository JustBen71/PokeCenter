using System.Net.Http;
using System.Net.Sockets;
using System.Net.WebSockets;

namespace Pokerace.Client.Server;

// Turns network failures into stable codes and a French hint, so a player knows what to fix.
public static class ConnectionErrors
{
    public static string Code(Exception error) => error switch
    {
        ClientException client => client.Code,
        OperationCanceledException or TimeoutException => "server_timeout",
        _ => Socket(error) switch
        {
            SocketError.HostNotFound or SocketError.NoData or SocketError.TryAgain => "server_not_found",
            SocketError.ConnectionRefused => "server_refused",
            SocketError.TimedOut or SocketError.HostUnreachable or SocketError.NetworkUnreachable => "server_timeout",
            _ => error is HttpRequestException or WebSocketException ? "server_unreachable" : "transport_error"
        }
    };

    public static string Hint(string code, string serverUrl) => code switch
    {
        "server_not_found" => $"Adresse introuvable : « {serverUrl} ». Vérifiez l'adresse (ex. http://88.184.14.248, sans le port) puis le port demandé au lancement.",
        "server_refused" => $"Connexion refusée par {serverUrl} : le port est fermé ou le serveur arrêté. Vérifiez le port saisi.",
        "server_timeout" => $"Pas de réponse de {serverUrl} : serveur éteint, port non redirigé par la box ou pare-feu.",
        "server_unreachable" => $"Serveur injoignable à {serverUrl}. Vérifiez l'adresse, le port et votre connexion Internet.",
        "server_rejected" => "Serveur joint, mais le salon refuse : code du salon incorrect ou compte absent du salon. Rejoignez le salon sur le portail avec le même pseudo.",
        _ => $"Connexion au serveur {serverUrl} interrompue ({code}). Nouvelle tentative automatique."
    };

    private static SocketError? Socket(Exception? error)
    {
        for (var current = error; current != null; current = current.InnerException)
            if (current is SocketException socket) return socket.SocketErrorCode;
        return null;
    }
}
