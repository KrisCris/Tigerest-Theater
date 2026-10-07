"""Launch the actual Player in a fresh process with the explicit patched DLL."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


class PlayerPlaybackTests(unittest.TestCase):
    def test_native_player_cached_graph_lifecycle(self):
        # CMake registers this only for an explicit actual DLL + engine fixture.
        required = ('RIFE_TEST_PLAYER_HOST','RIFE_TEST_PLAYER_STATS','RIFE_TEST_PLAYER_MONITOR',
                    'RIFE_TEST_RUNTIME','RIFE_TEST_EOF_MPV_DLL','RIFE_TEST_STREAM_PREPARED')
        self.assertTrue(all(os.environ.get(key) for key in required), 'Missing explicit native Player fixture')
        prepared = json.loads(Path(os.environ['RIFE_TEST_STREAM_PREPARED']).read_text(encoding='utf-8'))
        self.assertTrue(prepared['ready'])
        with tempfile.TemporaryDirectory(prefix='RIFE 播放器 ') as temp:
            stage = Path(temp)
            executable = stage / 'player.exe'
            shutil.copyfile(os.environ['RIFE_TEST_PLAYER_HOST'], executable)
            dll = stage / 'libmpv-2.dll'
            shutil.copyfile(os.environ['RIFE_TEST_EOF_MPV_DLL'], dll)
            self.assertEqual(hashlib.sha256(dll.read_bytes()).digest(),
                             hashlib.sha256(Path(os.environ['RIFE_TEST_EOF_MPV_DLL']).read_bytes()).digest())
            shutil.copyfile(os.environ['RIFE_TEST_PLAYER_STATS'], stage / 'tigerest-rife.dll')
            # Stage the same app-owned bridge as the Windows installer. The
            # installed extension supplies heavy libraries/models only.
            playback = stage / 'rife'
            playback.mkdir()
            shutil.copyfile(os.environ['RIFE_TEST_PLAYER_MONITOR'], playback / 'tigerest-rife-vs.dll')
            for name in ('interpolate_trt.vpy', 'trt_pipeline.py'):
                shutil.copyfile(ROOT / 'resources/mpv/rife' / name, playback / name)
            environment = dict(os.environ, RIFE_TEST_PLAYER_EXPECTED_DLL=str(dll),
                               RIFE_TEST_PLAYER_CACHE=str(Path(prepared['enginePath']).parent.parent))
            qt_log = stage / 'qt-test.txt'
            try:
                # Input/overlay CPU tests create their own plain mpv cores.
                # Run the actual runtime activation in a fresh process before
                # any core exists, exactly as production startup does.
                run = subprocess.run([str(executable), 'actualCachedPlaybackSeekPauseSpeedAndReload',
                                      '-o', str(qt_log)+',txt'], capture_output=True, timeout=110, env=environment)
            except subprocess.TimeoutExpired as error:
                failure = ROOT / 'build/rife/player-failures' / stage.name
                failure.mkdir(parents=True)
                (failure/'stdout.txt').write_bytes(error.stdout or b'')
                (failure/'stderr.txt').write_bytes(error.stderr or b'')
                if qt_log.exists():
                    shutil.copyfile(qt_log, failure/'qt-test.txt')
                self.fail(f'Actual Player exceeded 110 seconds; evidence saved to {failure}')
            qt_output = qt_log.read_bytes() if qt_log.exists() else b''
            if run.returncode:
                failure = ROOT / 'build/rife/player-failures' / stage.name
                failure.parent.mkdir(parents=True,exist_ok=True)
                failure.mkdir()
                (failure/'stdout.txt').write_bytes(run.stdout)
                (failure/'stderr.txt').write_bytes(run.stderr)
                (failure/'qt-test.txt').write_bytes(qt_output)
            self.assertEqual(run.returncode, 0, (qt_output+run.stdout+run.stderr).decode('utf-8',errors='replace')[-14000:])


if __name__ == '__main__':
    unittest.main()
