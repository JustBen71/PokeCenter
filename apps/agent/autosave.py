"""Local rotating mGBA states. Never delete a previous state before a valid new one exists."""
import os
import re
import struct
import time
import zlib
from pathlib import Path

INTERVAL_SECONDS = 300
KEEP = 3

def backups(folder):
    folder = Path(folder).resolve()
    return sorted((p for p in folder.glob('autosave-*.ss1')
                   if re.fullmatch(r'autosave-\d+\.ss1', p.name) and p.is_file()
                   and not p.is_symlink() and p.resolve().parent == folder), reverse=True)

def validate_state(path, rom_crc=None):
    data = Path(path).read_bytes()
    if data[:8] != b'\x89PNG\r\n\x1a\n':
        raise ValueError('État mGBA incomplet (PNG attendu)')
    offset, state, ended = 8, None, False
    while offset + 12 <= len(data):
        size = struct.unpack_from('>I', data, offset)[0]
        end = offset + size + 12
        if end > len(data): raise ValueError('État mGBA tronqué')
        kind = data[offset+4:offset+8]; payload = data[offset+8:end-4]
        if zlib.crc32(kind+payload) != struct.unpack_from('>I', data, end-4)[0]:
            raise ValueError('État mGBA corrompu')
        if kind == b'gbAs': state = zlib.decompress(payload)
        offset = end
        if kind == b'IEND': ended = True; break
    if not ended or state is None or len(state) < 0x61000:
        raise ValueError('Mémoire GBA absente de la sauvegarde')
    if rom_crc is not None and struct.unpack_from('<I',state,8)[0] != rom_crc:
        raise ValueError('La sauvegarde appartient à une autre ROM')

def commit_backup(staging, folder, rom_crc=None):
    folder = Path(folder).resolve(); staging = Path(staging)
    if staging.is_symlink() or staging.resolve().parent != folder:
        raise ValueError('Chemin de sauvegarde invalide')
    validate_state(staging, rom_crc)
    destination = folder / f'autosave-{time.time_ns()}.ss1'
    os.replace(staging, destination)
    for old in backups(folder)[KEEP:]:
        old.unlink()  # Only our checked, local autosave files; never the game's .sav.
    return destination

def choose_backup(folder, rom_crc, prompt=input):
    available = []
    for path in backups(folder):
        try: validate_state(path, rom_crc); available.append(path)
        except (ValueError, OSError, zlib.error): print(f'Sauvegarde ignorée (invalide) : {path.name}')
    if not available: return None
    print('Reprendre une sauvegarde automatique :')
    print('  0. Démarrage normal (sauvegarde habituelle du jeu)')
    for i, path in enumerate(available, 1):
        print(f'  {i}. {time.strftime("%d/%m/%Y %H:%M:%S", time.localtime(path.stat().st_mtime))}\n     {path}')
    while True:
        answer = prompt('Sauvegarde à charger [0] : ').strip() or '0'
        if answer.isdigit() and 0 <= int(answer) <= len(available):
            return available[int(answer)-1] if int(answer) else None
        print('Choix invalide.')
