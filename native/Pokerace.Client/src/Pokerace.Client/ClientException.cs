namespace Pokerace.Client;

public sealed class ClientException(string code, string message) : Exception(message)
{
    public string Code { get; } = code;
}
