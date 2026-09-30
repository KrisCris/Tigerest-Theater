import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
PREPARE = ROOT / 'dev/windows/rife/prepare_mpv_recipe.py'


class PinnedRecipeTests(unittest.TestCase):
    @unittest.skipUnless(os.environ.get('RIFE_TEST_MPV_RECIPE'), 'requires original pinned recipe')
    def test_detached_dependency_cleanup_never_resolves_upstream_branch(self):
        original = Path(os.environ['RIFE_TEST_MPV_RECIPE'])
        bash = Path('C:/Program Files/Git/bin/bash.exe') if os.name == 'nt' else Path(shutil.which('bash'))
        with tempfile.TemporaryDirectory() as temp:
            base = Path(temp)
            recipe = base / 'recipe'
            shutil.copytree(original, recipe, ignore=shutil.ignore_patterns('.git'))
            locked = base / 'source'
            subprocess.run(['git', 'init', '-q', str(locked)], check=True)
            (locked / 'fixture').write_text('pinned source')
            subprocess.run(['git', '-C', str(locked), 'add', 'fixture'], check=True)
            subprocess.run(['git', '-C', str(locked), '-c', 'user.name=Test', '-c',
                            'user.email=test@example.invalid', 'commit', '-qm', 'fixture'], check=True)
            sha = subprocess.check_output(['git', '-C', str(locked), 'rev-parse', 'HEAD'], text=True).strip()
            subprocess.run(['git', '-C', str(locked), 'checkout', '--detach', '-q'], check=True)
            lock = base / 'lock.json'
            lock.write_text(json.dumps({'sources': {}, 'rustToolchain': 'nightly-2026-08-08'}))
            run = subprocess.run([sys.executable, str(PREPARE), '--recipe', str(recipe), '--lock', str(lock)],
                                 capture_output=True, text=True)
            self.assertEqual(run.returncode, 0, run.stderr)
            project = base / 'project'
            project.mkdir()
            (project / 'CMakeLists.txt').write_text(f'''cmake_minimum_required(VERSION 3.19)
project(cleanup-check NONE)
include(ExternalProject)
include("{recipe.as_posix()}/cmake/custom_steps.cmake")
set(EXEC "{bash.as_posix()}")
ExternalProject_Add(locked GIT_REPOSITORY "{locked.as_posix()}" GIT_TAG {sha}
 SOURCE_DIR "{locked.as_posix()}" CONFIGURE_COMMAND "" BUILD_COMMAND "" INSTALL_COMMAND "")
force_rebuild_git(locked)
''')
            configure = subprocess.run(['cmake', '-G', 'Ninja', '-S', str(project), '-B', str(base / 'build')],
                                       capture_output=True, encoding='utf-8')
            self.assertEqual(configure.returncode, 0, configure.stdout + configure.stderr)
            stamp = base / 'build/locked-prefix/src/locked-stamp'
            (stamp / 'HEAD').write_text(sha)
            (stamp / 'locked-download').touch()
            (stamp / 'locked-patch').touch()
            result = subprocess.run([str(bash), str(stamp / 'reset_head.sh')], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertNotIn('HEAD does not point to a branch', result.stderr)
            self.assertEqual(subprocess.check_output(['git', '-C', str(locked), 'rev-parse', 'HEAD'], text=True).strip(), sha)


if __name__ == '__main__':
    unittest.main()
