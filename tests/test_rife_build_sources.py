import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


class BuildSourceLockTests(unittest.TestCase):
    def test_checked_in_lock_is_verified_without_resolving_moving_refs(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            recipe = root / 'recipe'
            recipe.mkdir()
            repository = 'https://github.com/fixture/unavailable.git'
            (recipe / 'fixture.cmake').write_text(f'GIT_REPOSITORY {repository}\nGIT_TAG main\n')
            lock = root / 'pinned.json'
            data = {'schemaVersion': 1, 'snapshot': '2026-08-09T00:00:00Z',
                'mpvSourceSha': 'dd5d17d3285a095a0f712fa9d116e22a076492de',
                'rustToolchain': 'nightly-2026-08-08', 'sources': {'fixture.cmake': {
                    'repository': repository, 'originalRef': 'main', 'sourceSha': '1' * 40}}}
            lock.write_text(json.dumps(data))
            command = [sys.executable, '-B', '-X', 'utf8', str(ROOT / 'dev/windows/rife/freeze_mpv_sources.py'),
                '--recipe', str(recipe), '--verify-lock', str(lock), '--output', str(root / 'out.json')]
            run = subprocess.run(command, capture_output=True, text=True, timeout=10)
            self.assertEqual(run.returncode, 0, run.stderr)
            self.assertEqual(json.loads((root / 'out.json').read_text()), data)
            for corruption in ('repository', 'originalRef', 'sourceSha', 'missing'):
                changed = json.loads(json.dumps(data))
                if corruption == 'missing':
                    changed['sources'].clear()
                else:
                    changed['sources']['fixture.cmake'][corruption] = 'invalid'
                lock.write_text(json.dumps(changed))
                run = subprocess.run(command, capture_output=True, text=True, timeout=10)
                self.assertNotEqual(run.returncode, 0, corruption)

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
