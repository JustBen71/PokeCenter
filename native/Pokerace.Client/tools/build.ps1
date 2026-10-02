param(
    [ValidateSet('win-x64', 'linux-x64', 'osx-x64', 'osx-arm64')]
    [string]$Runtime = 'win-x64',
    [string]$Dotnet = 'dotnet'
)
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
& $Dotnet publish (Join-Path $root 'src/Pokerace.Client/Pokerace.Client.csproj') --configuration Release `
    --runtime $Runtime --self-contained true -o (Join-Path $root "artifacts/$Runtime")
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Copy-Item -LiteralPath (Join-Path $root 'client.example.json') -Destination (Join-Path $root "artifacts/$Runtime/client.example.json")
Write-Host "Client prêt dans $root/artifacts/$Runtime"
