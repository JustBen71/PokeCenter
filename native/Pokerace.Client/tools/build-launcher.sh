#!/bin/sh
# Linux counterpart of build-launcher.ps1: bridge built against the pinned BizHawk, then one self-contained executable.
# Usage: build-launcher.sh [BizHawkDir]   (needs the .NET 8 SDK: dotnet on PATH or ~/.dotnet/dotnet)
set -eu
root=$(cd "$(dirname "$0")/../../.." && pwd)
dotnet=$(command -v dotnet || echo "$HOME/.dotnet/dotnet")
[ -x "$dotnet" ] || { echo "SDK .NET 8 introuvable : https://dotnet.microsoft.com/download/dotnet/8.0" >&2; exit 1; }
pin="$root/bridges/bizhawk/e2e/bizhawk-version.json"
field() { sed -n "/\"linux\"/,/}/s/.*\"$1\": *\"\([^\"]*\)\".*/\1/p" "$pin"; }
bizhawk=${1:-"$root/bridges/bizhawk/.runtime-linux"}
if [ ! -f "$bizhawk/dll/BizHawk.Client.Common.dll" ]; then
  mkdir -p "$bizhawk"
  archive="$bizhawk.tar.gz"
  [ -f "$archive" ] || curl -fL -o "$archive" "$(field downloadUrl)"
  echo "$(field sha256)  $archive" | sha256sum -c - >/dev/null || { echo "BizHawk SHA-256 incorrect : supprimez $archive" >&2; exit 1; }
  tar xzf "$archive" -C "$bizhawk" --strip-components=1
fi
"$dotnet" build "$root/bridges/bizhawk/src/Pokerace.BizHawkBridge/Pokerace.BizHawkBridge.csproj" --configuration Release "-p:BizHawkDir=$bizhawk"
output="$root/native/Pokerace.Client/artifacts/launcher-linux-x64"
"$dotnet" publish "$root/native/Pokerace.Client/src/Pokerace.Client/Pokerace.Client.csproj" --configuration Release --runtime linux-x64 \
  --self-contained true -p:PublishSingleFile=true -p:BundleBridge=true -p:DebugType=None -o "$output"
echo "Prêt : $output/Pokerace.Client"
