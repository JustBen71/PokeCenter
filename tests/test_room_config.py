import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from apps.agent.player_client import read_config


class RoomConfigTests(unittest.TestCase):
    def test_first_launch_then_room_confirmation_and_nickname_change(self):
        with tempfile.TemporaryDirectory() as folder, patch.dict(os.environ, {}, clear=True):
            path=Path(folder)/'player.env'
            answers=iter(['', 'Bén', '123'])
            first=read_config(path,prompt=lambda _:next(answers))
            self.assertEqual(first['SERVER_URL'],'http://localhost:8080')
            self.assertEqual(first['PLAYER_NAME'],'Bén')
            self.assertEqual(first['ROOM_CODE'],'123')
            self.assertRegex(first['PLAYER_ID'],r'^p-[a-f0-9]{32}$')
            prompts=[]
            second=read_config(path,prompt=lambda label:(prompts.append(label) or '456'))
            self.assertEqual(len(prompts),1)
            self.assertIn('Code du salon',prompts[0])
            self.assertEqual(second['ROOM_CODE'],'456')
            self.assertEqual(second['SERVER_URL'],first['SERVER_URL'])
            self.assertEqual(first['PLAYER_ID'],second['PLAYER_ID'])
            answers=iter(['','Nouveau pseudo',''])
            third=read_config(path,force=True,prompt=lambda _:next(answers))
            self.assertEqual(first['PLAYER_ID'],third['PLAYER_ID'])
            self.assertEqual(third['PLAYER_NAME'],'Nouveau pseudo')

    def test_account_name_overrides_old_nickname(self):
        with tempfile.TemporaryDirectory() as folder, patch.dict(os.environ, {}, clear=True):
            path=Path(folder)/'player.env'
            path.write_text('SERVER_URL=http://localhost:8080\nACCOUNT_NAME=Ben\nPLAYER_NAME=Old name\nPLAYER_ID=joueur-01\nROOM_CODE=123\n',encoding='utf-8')
            result=read_config(path,prompt=lambda _:'')
            self.assertEqual(result['ROOM_CODE'],'123')
            self.assertEqual(result['ACCOUNT_NAME'],'Ben')
            self.assertEqual(result['PLAYER_NAME'],'Ben')
            self.assertEqual(result['PLAYER_ID'],'joueur-01')

    def test_existing_token_configuration_migrates_without_losing_mgba_path(self):
        with tempfile.TemporaryDirectory() as folder, patch.dict(os.environ, {}, clear=True):
            path=Path(folder)/'player.env'
            path.write_text('SERVER_URL=https://race.example.com\nPLAYER_ID=joueur-01\nPLAYER_TOKEN=old-secret\nMGBA_PATH=C:\\Games\\mGBA.exe\n')
            answers=iter(['','Alice','1'])
            result=read_config(path,prompt=lambda _:next(answers))
            self.assertEqual(result['PLAYER_ID'],'joueur-01')
            self.assertEqual(result['MGBA_PATH'],r'C:\Games\mGBA.exe')
            self.assertNotIn('PLAYER_TOKEN',result)
            self.assertNotIn('old-secret',path.read_text())


if __name__=='__main__': unittest.main()
