import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


class BuildSourceLockTests(unittest.TestCase):
    def test_recipe_git_reset_takes_precedence_over_moving_tag(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            recipe = root / 'recipe'
            recipe.mkdir()
            sha = '1234567890123456789012345678901234567890'
            (recipe / 'fixture.cmake').write_text('ExternalProject_Add(fixture\n'
                'GIT_REPOSITORY https://github.com/fixture/unavailable.git\n'
                f'GIT_TAG main\nGIT_RESET {sha}\n)', encoding='utf-8')
            output = root / 'lock.json'
            result = subprocess.run([sys.executable, '-B', '-X', 'utf8', str(ROOT / 'dev/windows/rife/freeze_mpv_sources.py'),
                '--recipe', str(recipe), '--output', str(output)], capture_output=True, text=True, timeout=10)
            self.assertEqual(result.returncode, 0, result.stderr)
            lock = json.loads(output.read_text(encoding='utf-8'))
            self.assertEqual(lock['sources']['fixture.cmake']['sourceSha'], sha)

    def test_explicit_git_revision_is_preserved_without_network_resolution(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            recipe = root / "recipe"
            recipe.mkdir()
            (recipe / "fixture.cmake").write_text('''ExternalProject_Add(fixture
  GIT_REPOSITORY https://github.com/fixture/unavailable.git
  GIT_TAG "1234567890123456789012345678901234567890"
)''', encoding="utf-8")
            output = root / "lock.json"
            process = subprocess.run([sys.executable, str(ROOT / "dev/windows/rife/freeze_mpv_sources.py"),
                                      "--recipe", str(recipe), "--output", str(output)],
                                     capture_output=True, text=True, timeout=10)
            self.assertEqual(process.returncode, 0, process.stderr)
            data = json.loads(output.read_text(encoding="utf-8"))
            self.assertEqual(data["sources"]["fixture.cmake"]["sourceSha"],
                             "1234567890123456789012345678901234567890")


if __name__ == "__main__":
    unittest.main()
