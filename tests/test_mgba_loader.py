import unittest
from apps.agent.mgba_loader import direct_command


class DirectLoaderTests(unittest.TestCase):
    def test_script_and_rom_paths_are_separate_arguments(self):
        result=direct_command("C:/Program Files/mGBA/mGBA.exe", "C:/Jeux/Émeraude FR.gba", "C:/Projet/équipe test.lua", "  --script FILE  Run a script on start\n")
        self.assertEqual(result,["C:/Program Files/mGBA/mGBA.exe","--script","C:/Projet/équipe test.lua","C:/Jeux/Émeraude FR.gba"])

    def test_0105_is_rejected_before_any_game_launch(self):
        with self.assertRaisesRegex(RuntimeError,"setup-mgba-windows"):
            direct_command("mgba.exe","game.gba","script.lua","Frontend options:\n  --ecard FILE\n  --mb FILE\n")

    def test_error_mentioning_script_is_not_a_capability(self):
        with self.assertRaises(RuntimeError):
            direct_command("mgba.exe","game.gba","script.lua","Unknown option --script")


if __name__=='__main__': unittest.main()
