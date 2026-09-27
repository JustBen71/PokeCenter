"""Interactive Windows launcher. ROMs and saves never leave this computer."""
import argparse
import json
import os
import re
from pathlib import Path
import socket
import subprocess
import sys
import time
import uuid
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "emulator"))
from roms import identify


def discover(roots, on_error=None):
    """Do not traverse junctions, symlinks or protected folders."""
    found = set()
    seen = set()
    for root in roots:
        for directory, folders, files in os.walk(root, onerror=on_error, followlinks=False):
            key = os.path.normcase(os.path.abspath(directory))
            if key in seen:
                folders[:] = []
                continue
            seen.add(key)
            folders[:] = [name for name in folders if not (Path(directory) / name).is_symlink()
                          and not (hasattr(Path, "is_junction") and (Path(directory) / name).is_junction())
                          and name not in {"AppData", "node_modules", ".git", ".cache"}]
            for name in files:
                if Path(name).suffix.lower() in {".gba", ".gb", ".gbc"}:
                    found.add(str((Path(directory) / name).absolute()))
    return sorted(found, key=str.casefold)


def default_roots():
    users = Path(os.environ.get("SystemDrive", "C:")) / "Users"
    # Explicit fallbacks also work when listing Users itself is denied.
    home = Path.home()
    return [users, home / "Documents/ROM", home / "OneDrive/Documents/ROM", home / "Downloads"]


def lua_value(value):
    if value is None:
        return "nil"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return str(value)
    if isinstance(value, str):
        return '"' + value.replace('\\', '\\\\').replace('"', '\\"').replace('\n', '\\n').replace('\r', '\\r') + '"'
    if isinstance(value, list):
        return "{" + ",".join(lua_value(item) for item in value) + "}"
    return "{" + ",".join("[" + lua_value(str(k)) + "]=" + lua_value(v) for k, v in value.items()) + "}"


def make_script(info, port, session, destination, autosave_path=None):
    data = json.loads((ROOT / "emulator/profiles/game-data.json").read_text("utf-8"))
    settings = {"identity": info, "port": port, "session": session, "data": data, "autosavePath": str(autosave_path) if autosave_path else None}
    p = info['profile']
    game = {"name": "pokemon-emerald", "romStatus": info['status'], "header": info['header'],
            "romSha256": info['sha'], "language": p['language'] if p else None,
            "profileId": p['profileId'] if p else None, "revision": p['revision'] if p else None}
    empty = {"protocolVersion": 1, "playerId": "placeholder", "game": game, "trainer": None,
             "location": None, "party": [], "observedAt": "1970-01-01T00:00:00Z", "diagnostic": info['diagnostic']}
    settings['progression'] = json.loads((ROOT / 'emulator/profiles/progression.json').read_text('utf-8'))
    settings['gameJson'] = json.dumps(game, ensure_ascii=False)
    settings['diagnosticJson'] = json.dumps(empty, ensure_ascii=False)
    settings['waitingJson'] = json.dumps({**empty, 'diagnostic': 'Jeu en chargement ou Ã©tat mÃ©moire invalide.'}, ensure_ascii=False)
    source = "POKERACE_CONFIG=" + lua_value(settings) + "\n"
    source += (ROOT / "emulator/lua/extractor.lua").read_text("utf-8")
    Path(destination).write_text(source, encoding="utf-8")




def read_config(path=None, force=False, prompt=None):
    path = Path(path or ROOT / "deploy/player/player.env")
    prompt = prompt or input
    env = os.environ.copy()
    saved = {}
    for line in (path.read_text("utf-8-sig").splitlines() if path.is_file() else []):
        if line.strip() and not line.lstrip().startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            saved[key.strip()] = value.strip()
    env.update(saved)
    env["PLAYER_NAME"] = env.get("ACCOUNT_NAME") or env.get("PLAYER_NAME", "")
    first_run = force or not env.get("PLAYER_NAME") or not env.get("ROOM_CODE")
    if first_run:
        server = env.get("SERVER_URL", "http://localhost:8080")
        if "race.example.com" in server:
            server = "http://localhost:8080"
        while True:
            value = prompt(f"Adresse du serveur [{server}] : ").strip() or server
            parsed = urlsplit(value)
            if parsed.scheme in ("http", "https") and parsed.netloc and not any(c in value for c in '\r\n'):
                env["SERVER_URL"] = value.rstrip("/")
                break
            print("Indiquez une adresse http:// ou https://.")
        for key, label, maximum in (("PLAYER_NAME", "Nom du compte créé sur le portail", 32), ("ROOM_CODE", "Code du salon", 128)):
            previous = env.get(key, "")
            while True:
                hint = f" [{previous}]" if key == "PLAYER_NAME" and previous else ""
                if key == "ROOM_CODE" and previous:
                    hint = " [EntrÃ©e pour conserver le code enregistrÃ©]"
                value = prompt(label + hint + " : ").strip() or previous
                if value and len(value) <= maximum and not any(ord(c) < 32 or ord(c) == 127 for c in value):
                    env[key] = value
                    break
                print(f"Renseignez entre 1 et {maximum} caractÃ¨res.")
    env["ACCOUNT_NAME"] = env["PLAYER_NAME"]
    # Local installation ID stays stable across launches, independently of the nickname.
    previous_id = saved.get("PLAYER_ID", "")
    env["PLAYER_ID"] = previous_id if re.fullmatch(r"[a-z0-9][a-z0-9_-]{1,39}", previous_id) else ("p-" + uuid.uuid4().hex)
    env.pop("PLAYER_TOKEN", None)
    saved.pop("PLAYER_TOKEN", None)
    for key in ("SERVER_URL", "PLAYER_NAME", "ACCOUNT_NAME", "ROOM_CODE", "PLAYER_ID"):
        saved[key] = env[key]
    saved.setdefault("MGBA_PATH", r"C:\Program Files\mGBA\mGBA.exe")
    env["MGBA_PATH"] = saved["MGBA_PATH"]
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(f"{key}={value}" for key, value in saved.items()) + "\n", encoding="utf-8")
    if first_run:
        print("Configuration enregistrÃ©e. Elle sera rÃ©utilisÃ©e au prochain lancement.")
    return env


def main():
    parser = argparse.ArgumentParser(description="Client PokÃ©race : recherche et lancement de ROM")
    parser.add_argument("--root", action="append", help="Dossier Ã  rechercher (rÃ©pÃ©table)")
    parser.add_argument("--rom", type=Path, help="Lancer directement ce fichier")
    parser.add_argument("--list", action="store_true", help="Lister sans lancer")
    parser.add_argument("--configure", action="store_true", help="Changer le serveur, le pseudo ou le code du salon")
    args = parser.parse_args()
    env = read_config(force=args.configure) if not args.list else None
    if args.configure:
        return
    errors = []
    if args.rom:
        rom = args.rom.resolve(strict=True)
    else:
        print("Recherche des ROM dans Usersâ€¦ Les dossiers protÃ©gÃ©s sont ignorÃ©s.", flush=True)
        paths = discover(args.root or default_roots(), errors.append)
        for index, path in enumerate(paths, 1):
            print(f"{index:3}. {Path(path).name}\n     {path}")
        if errors:
            print(f"{len(errors)} dossier(s) inaccessible(s). Utilisez --root pour un dossier prÃ©cis.")
        if args.list:
            return
        if not paths:
            raise RuntimeError("Aucune ROM trouvÃ©e. Utilisez --root ou --rom avec son chemin.")
        while True:
            answer = input("NumÃ©ro de la ROM (q pour quitter) : ").strip()
            if answer.lower() == "q":
                return
            if answer.isdigit() and 1 <= int(answer) <= len(paths):
                rom = Path(paths[int(answer) - 1])
                break
            print("Choix invalide.")
    mgba = Path(env.get("MGBA_PATH", r"C:\Program Files\mGBA\mGBA.exe"))
    if not mgba.is_file():
        raise RuntimeError("MGBA_PATH ne dÃ©signe pas un exÃ©cutable mGBA.")
    info = identify(rom, env.get("ROM_MANIFEST_PATH"))
    print(f"ROM : {rom}\nStatut : {info['status']}\n{info['diagnostic'] or info['profile']['revision']}")
    runtime = ROOT / ".player-runtime"
    runtime.mkdir(exist_ok=True)
    (runtime / "last-rom.json").write_text(json.dumps({"path": str(rom), **info}, ensure_ascii=False, indent=2), encoding="utf-8")
    # Exclusive lock: one player client per checkout. Never connect to another game's Lua.
    lock = open(runtime / "client.lock", "a+b")
    if os.name == "nt":
        import msvcrt
        lock.seek(0); lock.write(b"0"); lock.flush(); lock.seek(0)
        try:
            msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
        except OSError:
            raise RuntimeError("Un client PokÃ©race est dÃ©jÃ  lancÃ©.")
    import secrets
    session = secrets.token_hex(16)
    with socket.socket() as port_socket:
        port_socket.bind(("127.0.0.1", 0))
        port = port_socket.getsockname()[1]
    script = runtime / f"session-{session}.lua"
    import zlib
    try:
        from .autosave import choose_backup
    except ImportError:
        from autosave import choose_backup
    backup_folder = runtime / "backups" / info['sha']
    backup_folder.mkdir(parents=True, exist_ok=True)
    rom_crc = zlib.crc32(rom.read_bytes())
    resume = choose_backup(backup_folder, rom_crc)
    staging = backup_folder / f"pending-{session}.ss1"
    make_script(info, port, session, script, staging)
    env.update(AUTOSAVE_DIR=str(backup_folder), AUTOSAVE_STAGING=str(staging), ROM_CRC32=str(rom_crc))
    ready = runtime / f"ready-{session}"
    env.update(LUA_HOST="127.0.0.1", LUA_PORT=str(port), LUA_SESSION=session, ROM_PATH=str(rom), LUA_READY_FILE=str(ready))
    help_result = subprocess.run([str(mgba), "--help"], capture_output=True, text=True, timeout=10)
    try:
        from .mgba_loader import direct_command
    except ImportError:
        from mgba_loader import direct_command
    command = direct_command(mgba, rom, script, help_result.stdout + help_result.stderr, state=resume)
    game = subprocess.Popen(command, cwd=ROOT)
    agent = None
    try:
        # Agent checks session greeting before sending any command or telemetry.
        agent = subprocess.Popen([sys.executable, str(ROOT / "apps/agent/agent.py")], env=env, cwd=ROOT)
        deadline = time.monotonic() + 25
        while not ready.is_file():
            if time.monotonic() > deadline or game.poll() is not None or agent.poll() is not None:
                raise RuntimeError("Lua n'a pas confirmÃ© son dÃ©marrage. Aucun Ã©tat de jeu n'est annoncÃ© actif.")
            time.sleep(.2)
        print("mGBA ouvert, connexion Lua vÃ©rifiÃ©e. Fermez mGBA pour arrÃªter le client.")
        print(f"Sauvegarde automatique toutes les 5 minutes, 3 états conservés : {backup_folder}")
        while game.poll() is None:
            if agent.poll() is not None:
                raise RuntimeError("L'agent s'est arrÃªtÃ©. Consultez le diagnostic ci-dessus.")
            time.sleep(.5)
    finally:
        if agent and agent.poll() is None:
            agent.terminate(); agent.wait(timeout=10)
        script.unlink(missing_ok=True)
        ready.unlink(missing_ok=True)
        lock.close()


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("Client arrÃªtÃ©. Sauvegardez et fermez mGBA normalement.")
    except Exception as exc:
        print(f"Erreur : {exc}", file=sys.stderr)
        sys.exit(1)
