"""ROM identity is separate from memory profile validation."""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def identify(path, manifest_path=None):
    path = Path(path)
    result = {"status": "missing", "sha": None, "header": None, "profile": None,
              "diagnostic": "ROM absente."}
    if not path.is_file():
        return result
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        first = stream.read(192)
        digest.update(first)
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    result.update(status="unknown", sha=digest.hexdigest(), diagnostic="ROM non reconnue : lecture mémoire désactivée.")
    if len(first) < 192:
        result["diagnostic"] = "En-tête GBA tronqué."
        return result
    result["header"] = {"title": first[0xA0:0xAC].decode("ascii", "replace").rstrip("\0 "),
                        "gameCode": first[0xAC:0xB0].decode("ascii", "replace"), "version": first[0xBC]}
    manifest = json.loads(Path(manifest_path or ROOT / "profiles/rom-manifest.json").read_text("utf-8"))
    if manifest.get("version") != 1:
        raise ValueError("Version du registre ROM non supportée")
    matches = [entry for entry in manifest["roms"] if entry.get("sha256") == result["sha"]]
    if len(matches) > 1:
        raise ValueError("Empreinte dupliquée dans le registre")
    if matches and matches[0].get("validated") is True:
        entry = matches[0]
        profile_path = ROOT / "profiles" / (entry["profileId"] + ".json")
        if profile_path.parent.resolve() != (ROOT / "profiles").resolve():
            raise ValueError("Identifiant de profil invalide")
        profile = json.loads(profile_path.read_text("utf-8"))
        if profile["gameCode"] != result["header"]["gameCode"] or profile["version"] != result["header"]["version"]:
            raise ValueError("En-tête incompatible avec le profil")
        if profile["language"] != entry["language"]:
            raise ValueError("Langue du profil incohérente")
        result.update(status="recognized", profile={**profile, **entry}, diagnostic=None)
    return result
