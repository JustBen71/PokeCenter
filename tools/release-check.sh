#!/bin/sh
# Blocking checks before a release. Usage: tools/release-check.sh v0.2.6 [--version-only]
#   always : the tag, the launcher version (csproj + ClientVersion) and docs/releases/<tag>.md agree;
#   then   : everything that runs on Linux (shared/API/Web, typecheck, Playwright, native client, bridge unit tests).
# The release workflow runs the version part, then the three test workflows (Windows included) before building.
set -eu
tag=${1:?usage: tools/release-check.sh vX.Y.Z [--version-only]}
root=$(cd "$(dirname "$0")/.." && pwd)
cd "$root"
fail() { echo "✖ $*" >&2; exit 1; }
version=${tag#v}
echo "$tag" | grep -Eq '^v[0-9]+\.[0-9]+\.[0-9]+$' || fail "tag invalide : $tag (attendu vX.Y.Z)"
csproj=$(sed -n 's/.*<Version>\([^<]*\)<\/Version>.*/\1/p' native/Pokerace.Client/src/Pokerace.Client/Pokerace.Client.csproj)
protocol=$(sed -n 's/.*ClientVersion = "\([^"]*\)".*/\1/p' native/Pokerace.Client/src/Pokerace.Client/Server/ServerProtocol.cs)
[ "$csproj" = "$version" ] || fail "Pokerace.Client.csproj <Version> = '$csproj', tag = $tag"
[ "$protocol" = "$version" ] || fail "ServerProtocol.ClientVersion = '$protocol', tag = $tag"
[ -s "docs/releases/$tag.md" ] || fail "notes de version manquantes : docs/releases/$tag.md"
echo "✔ version $version cohérente (tag, csproj, protocole, notes)"
[ "${2:-}" = "--version-only" ] && exit 0

dotnet=$(command -v dotnet || echo "$HOME/.dotnet/dotnet")
npm ci
npm run build
npm run typecheck
npm test
CI=true npm run test:e2e -w @pokerace/web
"$dotnet" test native/Pokerace.Client/Pokerace.Client.sln --configuration Release
"$dotnet" test bridges/bizhawk/tests/Pokerace.BizHawkBridge.Tests/Pokerace.BizHawkBridge.Tests.csproj --configuration Release
echo "✔ $tag : toutes les vérifications Linux sont vertes (Windows : tools/release-check.ps1 ; E2E BizHawk : run-e2e.ps1 -ClientE2E)"
