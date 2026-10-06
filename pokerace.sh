#!/bin/sh
# Linux counterpart of pokerace.cmd: connection form, then BizHawk and the client.
# Port given directly: ./pokerace.sh 3000   or   ./pokerace.sh --port 3000
here=$(cd "$(dirname "$0")" && pwd)
exe="$here/native/Pokerace.Client/artifacts/launcher-linux-x64/Pokerace.Client"
[ -x "$exe" ] || "$here/native/Pokerace.Client/tools/build-launcher.sh" || { echo "La préparation du lanceur a échoué (voir ci-dessus)."; exit 1; }
case "${1:-}" in ''|*[!0-9]*) ;; *) set -- --port "$@" ;; esac
exec "$exe" play "$@"
