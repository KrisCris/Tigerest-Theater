import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import shutil
import subprocess
import sys
import venv
import os

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('macos_vs_pin', ROOT/'dev/macos/rife/vapoursynth_runtime.py')
runtime = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runtime)
sys.modules['vapoursynth_runtime']=runtime
spec = importlib.util.spec_from_file_location('macos_mpv_builder', ROOT/'dev/macos/rife/build_mpv.py')
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)

MESON = os.environ.get('TIGEREST_TEST_MESON') or shutil.which('meson')
if not MESON and (ROOT/'build/rife/venv/bin/meson').is_file():
    MESON=str(ROOT/'build/rife/venv/bin/meson')


class RuntimePinTests(unittest.TestCase):
    @unittest.skipUnless(MESON, 'Meson is required for the actual dependency-cache fixture')
    def test_mpv_reconfigure_replaces_cached_r80_sdk(self):
        with tempfile.TemporaryDirectory(prefix='Mac R79 Meson ') as temporary:
            root=Path(temporary)
            source=root/'source';source.mkdir()
            output=root/'build'
            sdk_paths=[]
            for version in ('80','79'):
                sdk=root/('SDK '+version);sdk.mkdir()
                (sdk/'vapoursynth.pc').write_text(f'Version: {version}\nincludedir={sdk.as_posix()}/include\n')
                sdk_paths.append(sdk)
            # The real Meson cache/discovery logic runs against this tiny
            # pkg-config fixture; no Mac compiler or playback runtime is faked.
            pkgconfig=root/'pkg-config.py'
            pkgconfig.write_text('''import os,sys
from pathlib import Path
args=sys.argv[1:]
if args==['--version']:
    print('2.3.0');raise SystemExit(0)
for directory in os.environ.get('PKG_CONFIG_PATH','').split(os.pathsep):
    pc=Path(directory)/'vapoursynth.pc'
    if pc.is_file():break
else:raise SystemExit(1)
values=dict(line.replace(': ','=',1).split('=',1) for line in pc.read_text().splitlines())
if '--modversion' in args:print(values['Version'])
elif '--cflags' in args:print('-I"'+values['includedir']+'"')
else:
    for arg in args:
        if arg.startswith('--variable='):print(values.get(arg.split('=',1)[1],''))
''',encoding='utf-8')
            native=root/'native.ini'
            native.write_text(f"[binaries]\npkg-config = [{Path(sys.executable).as_posix()!r}, {pkgconfig.as_posix()!r}]\n")
            (source/'meson.build').write_text('''project('R79 cache regression')
vs=dependency('vapoursynth',method:'pkg-config')
c=configuration_data()
c.set('VERSION',vs.version())
c.set('INCLUDE',vs.get_variable(pkgconfig:'includedir'))
configure_file(input:'selected.in',output:'selected.txt',configuration:c)
''')
            (source/'selected.in').write_text('@VERSION@\n@INCLUDE@\n')
            arguments=['--backend=none','--native-file',str(native)]
            env=dict(os.environ,PKG_CONFIG_PATH=str(sdk_paths[0]))
            builder.setup_meson(MESON,output,source,arguments,env)
            self.assertEqual((output/'selected.txt').read_text().splitlines()[0],'80')
            # Match the production reconfigure sentinel for the no-build fixture.
            (output/'build.ninja').touch()
            env['PKG_CONFIG_PATH']=str(sdk_paths[1])
            builder.setup_meson(MESON,output,source,arguments,env)
            self.assertEqual((output/'selected.txt').read_text().splitlines(),
                             ['79',sdk_paths[1].as_posix()+'/include'])

    @unittest.skipUnless(shutil.which('cmake'), 'CMake is required for the actual configure fixture')
    def test_explicit_r79_overrides_cached_r80_plugin_headers(self):
        with tempfile.TemporaryDirectory(prefix='Mac R79 pin ') as temporary:
            root = Path(temporary)
            environment = root/'runtime'
            venv.EnvBuilder(with_pip=False).create(environment)
            interpreter = environment/('Scripts/python.exe' if sys.platform=='win32' else 'bin/python')
            site = Path(subprocess.check_output([str(interpreter),'-I','-c',
                'import sysconfig; print(sysconfig.get_path("purelib"))'],text=True).strip())
            package = site/'vapoursynth'
            (package/'include').mkdir(parents=True)
            (package/'pkgconfig').mkdir()
            (package/'__init__.py').write_text("__version__='R79'\n")
            (package/'include/VapourSynth4.h').write_text('// R79 fixture\n')
            (package/'pkgconfig/vapoursynth.pc').write_text('Version: 79\n')
            distribution = site/'vapoursynth-79.dist-info'
            (distribution/'licenses').mkdir(parents=True)
            (distribution/'METADATA').write_text('Metadata-Version: 2.1\nName: vapoursynth\nVersion: 79\n')
            (distribution/'licenses/COPYING.LESSER').write_text('LGPL fixture')
            (distribution/'RECORD').write_text('vapoursynth-79.dist-info/licenses/COPYING.LESSER,,\n')
            old = root/'Homebrew R80/include'
            old.mkdir(parents=True)
            (old/'VapourSynth4.h').write_text('// R80 fixture\n')
            probe = root/'probe.cmake'
            probe.write_text(f'''set(CMAKE_SOURCE_DIR "{ROOT.as_posix()}")
set(TIGEREST_VAPOURSYNTH_PYTHON "{interpreter.as_posix()}")
set(RIFE_VS_INCLUDE_DIRS "{old.as_posix()}" CACHE STRING "old discovery")
include("{(ROOT/'CMakeModules/ConfigureMacRifeRuntime.cmake').as_posix()}")
file(WRITE "{(root/'headers.txt').as_posix()}" "${{RIFE_VS_INCLUDE_DIRS}}")
''',encoding='utf-8')
            result = subprocess.run(['cmake','-P',str(probe)],capture_output=True,text=True)
            self.assertEqual(result.returncode,0,result.stdout+result.stderr)
            self.assertEqual(Path((root/'headers.txt').read_text()).resolve(), (package/'include').resolve())

    def test_explicit_package_supplies_headers_and_license(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            interpreter = root/'venv/bin/python'
            interpreter.parent.mkdir(parents=True)
            interpreter.touch()
            package = root/'venv/lib/python3.13/site-packages/vapoursynth'
            (package/'pkgconfig').mkdir(parents=True)
            (package/'pkgconfig/vapoursynth.pc').write_text('Version: 79\n')
            (package/'include').mkdir()
            (package/'include/VapourSynth4.h').touch()
            license = package.parent/'vapoursynth-79.dist-info/licenses/COPYING.LESSER'
            license.parent.mkdir(parents=True)
            license.write_text('LGPL')
            info = {'prefix':str(root/'python'), 'version':'3.13', 'pythonVersion':'3.13 fixture',
                    'vapoursynthVersion':'R79', 'package':str(package), 'license':str(license)}
            with patch.object(runtime.subprocess, 'check_output', return_value=json.dumps(info)) as probe:
                result = runtime.inspect_runtime(interpreter)
            self.assertEqual(result['pkgconfig'], str(package/'pkgconfig'))
            self.assertEqual(result['include'], str(package/'include'))
            self.assertEqual(result['license'], str(license))
            self.assertEqual(probe.call_args.args[0][:2], [str(interpreter), '-I'])

    def test_r80_is_rejected_before_bundle_staging(self):
        with tempfile.TemporaryDirectory() as temporary:
            interpreter = Path(temporary)/'python'
            interpreter.touch()
            with patch.object(runtime.subprocess, 'check_output', return_value=json.dumps({'vapoursynthVersion':'R80'})):
                with self.assertRaisesRegex(RuntimeError, 'R79'):
                    runtime.inspect_runtime(interpreter)

    def test_missing_explicit_interpreter_never_falls_back(self):
        with tempfile.TemporaryDirectory() as temporary:
            with patch.object(runtime.subprocess, 'check_output') as probe:
                with self.assertRaisesRegex(RuntimeError, 'interpreter'):
                    runtime.inspect_runtime(Path(temporary)/'missing-python')
                probe.assert_not_called()


if __name__ == '__main__':
    unittest.main()
