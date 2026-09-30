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
    @unittest.skipUnless(os.environ.get('RIFE_TEST_MPV_RECIPE') and os.environ.get('RIFE_TEST_CURL_SOURCE_FILE'),
                         'requires pinned recipe and frozen curl source')
    def test_curl_openssl_target_keeps_transitive_static_compression_dependencies(self):
        with tempfile.TemporaryDirectory() as temp:
            base = Path(temp)
            recipe = base / 'recipe'
            shutil.copytree(os.environ['RIFE_TEST_MPV_RECIPE'], recipe, ignore=shutil.ignore_patterns('.git'))
            lock = base / 'lock.json'
            lock.write_text(json.dumps({'sources': {'packages/curl.cmake': {'sourceSha':
                '04ff9df3e815c33dd5ecf7b891b32202858fa039'}}, 'rustToolchain': 'nightly-2026-08-08'}))
            run = subprocess.run([sys.executable, '-B', '-X', 'utf8', str(PREPARE), '--recipe', str(recipe), '--lock', str(lock)],
                                 capture_output=True, text=True)
            self.assertEqual(run.returncode, 0, run.stderr)
            source = base / 'source'
            source.mkdir()
            shutil.copyfile(os.environ['RIFE_TEST_CURL_SOURCE_FILE'], source / 'CMakeLists.txt')
            applied = subprocess.run(['git', '-C', str(source), 'apply', str(recipe / 'tigerest-curl-static-openssl.patch')],
                                     capture_output=True, text=True)
            self.assertEqual(applied.returncode, 0, applied.stderr)
            text = (source / 'CMakeLists.txt').read_text()
            start = text.index('  find_package(OpenSSL REQUIRED)')
            block = text[start:text.index('  set(_ssl_enabled ON)', start)]
            project = base / 'check'
            project.mkdir()
            (project / 'FindOpenSSL.cmake').write_text('add_library(OpenSSL::Crypto INTERFACE IMPORTED)\n'
                'set_property(TARGET OpenSSL::Crypto PROPERTY INTERFACE_LINK_LIBRARIES original-dependency)\n')
            (project / 'CMakeLists.txt').write_text('cmake_minimum_required(VERSION 3.19)\nproject(check NONE)\n'
                'set(WIN32 TRUE)\nlist(APPEND CMAKE_MODULE_PATH "${CMAKE_CURRENT_SOURCE_DIR}")\n' + block +
                '\nget_target_property(deps OpenSSL::Crypto INTERFACE_LINK_LIBRARIES)\n'
                'file(WRITE "${CMAKE_BINARY_DIR}/libraries.txt" "${deps}")\n')
            configured = subprocess.run(['cmake', '-G', 'Ninja', '-S', str(project), '-B', str(base / 'build')],
                                        capture_output=True, text=True)
            self.assertEqual(configured.returncode, 0, configured.stdout + configured.stderr)
            libraries = (base / 'build/libraries.txt').read_text().split(';')
            self.assertEqual(libraries[0], 'original-dependency')
            self.assertTrue({'brotlienc', 'brotlidec', 'brotlicommon', 'zstd', 'z', 'crypt32'} <= set(libraries[1:]))
            recipe_text = (recipe / 'packages/curl.cmake').read_text()
            self.assertIn('PATCH_COMMAND git apply ${CMAKE_SOURCE_DIR}/tigerest-curl-static-openssl.patch', recipe_text)
            self.assertNotIn('-lz -lbrotlienc', recipe_text)

    @unittest.skipUnless(os.environ.get('RIFE_TEST_MPV_RECIPE') and os.environ.get('RIFE_TEST_LUAJIT_SOURCE'),
                         'requires pinned recipe and frozen OpenResty LuaJIT source')
    def test_luajit_utf8_patch_applies_to_frozen_openresty_source(self):
        with tempfile.TemporaryDirectory() as temp:
            base = Path(temp)
            recipe = base / 'recipe'
            shutil.copytree(os.environ['RIFE_TEST_MPV_RECIPE'], recipe, ignore=shutil.ignore_patterns('.git'))
            source = base / 'source'
            shutil.copytree(os.environ['RIFE_TEST_LUAJIT_SOURCE'], source, ignore=shutil.ignore_patterns('.git'))
            lock = base / 'lock.json'
            lock.write_text(json.dumps({'sources': {'packages/luajit.cmake': {'sourceSha':
                '1edc3e52b67eaf6ce5f809be8e17d6862594b8bc'}}, 'rustToolchain': 'nightly-2026-08-08'}))
            run = subprocess.run([sys.executable, '-B', '-X', 'utf8', str(PREPARE), '--recipe', str(recipe), '--lock', str(lock)],
                                 capture_output=True, text=True)
            self.assertEqual(run.returncode, 0, run.stderr)
            patch = recipe / 'tigerest-luajit-utf8.patch'
            applied = subprocess.run(['git', '-C', str(source), 'apply', str(patch)], capture_output=True, text=True)
            self.assertEqual(applied.returncode, 0, applied.stderr)
            self.assertIn('lj_fs_io.o', (source / 'src/Makefile').read_text())
            self.assertTrue((source / 'src/lj_fs_io.c').is_file())
            self.assertIn('git apply ${CMAKE_SOURCE_DIR}/tigerest-luajit-utf8.patch',
                          (recipe / 'packages/luajit.cmake').read_text())

    @unittest.skipUnless(os.environ.get('RIFE_TEST_MPV_RECIPE') and os.environ.get('RIFE_TEST_NGTCP2_SOURCE_FILE'),
                         'requires pinned recipe and frozen ngtcp2 source')
    def test_static_openssl_compression_libraries_follow_crypto_in_quic_probe(self):
        with tempfile.TemporaryDirectory() as temp:
            base = Path(temp)
            recipe = base / 'recipe'
            shutil.copytree(os.environ['RIFE_TEST_MPV_RECIPE'], recipe, ignore=shutil.ignore_patterns('.git'))
            lock = base / 'lock.json'
            lock.write_text(json.dumps({'sources': {'packages/ngtcp2.cmake': {'sourceSha':
                'd7fb3ed0407e1333e4ecbd011fcfd9c16499d5e0'}}, 'rustToolchain': 'nightly-2026-08-08'}))
            run = subprocess.run([sys.executable, str(PREPARE), '--recipe', str(recipe), '--lock', str(lock)],
                                 capture_output=True, text=True)
            self.assertEqual(run.returncode, 0, run.stderr)
            source = base / 'source'
            source.mkdir()
            shutil.copyfile(os.environ['RIFE_TEST_NGTCP2_SOURCE_FILE'], source / 'CMakeLists.txt')
            patch = recipe / 'tigerest-ngtcp2-static-openssl.patch'
            applied = subprocess.run(['git', '-C', str(source), 'apply', str(patch)], capture_output=True, text=True)
            self.assertEqual(applied.returncode, 0, applied.stderr)
            text = (source / 'CMakeLists.txt').read_text()
            start = text.index('if(ENABLE_OPENSSL OR ENABLE_PICOTLS)')
            block = text[start:text.index('if(ENABLE_WOLFSSL)', start)]
            project = base / 'check'
            project.mkdir()
            (project / 'FindOpenSSL.cmake').write_text('set(OPENSSL_LIBRARIES fixture-ssl fixture-crypto)\n')
            (project / 'CMakeLists.txt').write_text('cmake_minimum_required(VERSION 3.19)\nproject(check NONE)\n'
                'set(WIN32 TRUE)\nset(ENABLE_OPENSSL TRUE)\nlist(APPEND CMAKE_MODULE_PATH "${CMAKE_CURRENT_SOURCE_DIR}")\n'
                + block + '\nfile(WRITE "${CMAKE_BINARY_DIR}/libraries.txt" "${OPENSSL_LIBRARIES}")\n')
            configured = subprocess.run(['cmake', '-G', 'Ninja', '-S', str(project), '-B', str(base / 'build')],
                                        capture_output=True, text=True)
            self.assertEqual(configured.returncode, 0, configured.stdout + configured.stderr)
            libraries = (base / 'build/libraries.txt').read_text().split(';')
            self.assertEqual(libraries[:2], ['fixture-ssl', 'fixture-crypto'])
            self.assertTrue({'brotlienc', 'brotlidec', 'brotlicommon', 'zstd', 'z', 'crypt32'} <= set(libraries[2:]))

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
