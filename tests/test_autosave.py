import struct
import tempfile
import unittest
import zlib
from pathlib import Path
from unittest.mock import patch
from apps.agent.autosave import backups,commit_backup,choose_backup,validate_state,INTERVAL_SECONDS
from apps.agent.mgba_loader import direct_command

def state_file(crc=123):
    state=bytearray(0x61000);struct.pack_into('<I',state,0,0x0100000B);struct.pack_into('<I',state,8,crc)
    def chunk(kind,payload):return struct.pack('>I',len(payload))+kind+payload+struct.pack('>I',zlib.crc32(kind+payload))
    return b'\x89PNG\r\n\x1a\n'+chunk(b'gbAs',zlib.compress(state))+chunk(b'IEND',b'')

class AutosaveTests(unittest.TestCase):
    def test_rotation_keeps_three_and_never_touches_manual_files(self):
        self.assertEqual(INTERVAL_SECONDS,300)
        with tempfile.TemporaryDirectory() as root:
            folder=Path(root);staging=folder/'pending.ss1';manual=folder/'game.sav';manual.write_bytes(b'manual')
            for n in range(5):
                staging.write_bytes(state_file())
                with patch('apps.agent.autosave.time.time_ns',return_value=100+n):commit_backup(staging,folder,123)
            self.assertEqual([p.name for p in backups(folder)],['autosave-104.ss1','autosave-103.ss1','autosave-102.ss1'])
            self.assertEqual(manual.read_bytes(),b'manual')
            before=backups(folder);staging.write_bytes(b'broken')
            with self.assertRaises(ValueError):commit_backup(staging,folder,123)
            self.assertEqual(backups(folder),before)
            staging.write_bytes(state_file(999))
            with self.assertRaises(ValueError):commit_backup(staging,folder,123)
            self.assertEqual(backups(folder),before)
            self.assertEqual(choose_backup(folder,123,prompt=lambda _: '1'),before[0])
            self.assertIsNone(choose_backup(folder,123,prompt=lambda _: ''))

    def test_truncation_crc_and_external_staging_rejected(self):
        with tempfile.TemporaryDirectory() as root:
            folder=Path(root);stage=folder/'state.ss1';stage.write_bytes(state_file()[:-1])
            with self.assertRaises(ValueError):validate_state(stage)
            stage.write_bytes(state_file()[:-5]+b'wrong')
            with self.assertRaises(ValueError):validate_state(stage)
            sub=folder/'backups';sub.mkdir();stage.write_bytes(state_file())
            with self.assertRaises(ValueError):commit_backup(stage,sub,123)

    def test_resume_uses_native_option(self):
        cmd=direct_command('mgba.exe','game.gba','script.lua','  --script FILE\n  --savestate FILE',state='backup.ss1')
        self.assertEqual(cmd,['mgba.exe','--script','script.lua','--savestate','backup.ss1','game.gba'])
        with self.assertRaises(RuntimeError):direct_command('mgba','game','script','  --script FILE',state='backup')
