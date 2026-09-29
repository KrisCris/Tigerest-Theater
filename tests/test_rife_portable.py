#!/usr/bin/env python3
"""Verify relocated bundled libmpv, Python, VS, compiled Core ML and Metal together.

The probe is copied only into the disposable test app; it is not shipped.
"""
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile

repository=Path(__file__).resolve().parents[1]
app=Path(sys.argv[1]).resolve()
probe=Path(sys.argv[2]).resolve()
with tempfile.TemporaryDirectory(prefix='rife 搬迁 空白环境 ',dir='/tmp') as tmp:
    root=Path(tmp);moved=root/'中文 有空格.app'
    subprocess.run(['ditto',str(app),str(moved)],check=True)
    binary=moved/'Contents/MacOS/rife-test-probe'
    shutil.copy2(probe,binary)
    subprocess.run(['install_name_tool','-add_rpath','@executable_path/../Frameworks',str(binary)],check=True)
    subprocess.run([sys.executable,str(repository/'dev/macos/sign_bundle.py'),str(moved)],check=True,
                   stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
    subprocess.run([sys.executable,str(repository/'tests/test_macos_bundle.py'),str(moved)],check=True)
    clip=root/'原片 测试.mkv'
    subprocess.run(['ffmpeg','-v','error','-f','lavfi','-i',
        'nullsrc=size=128x128:rate=24,geq=lum=16+N:cb=128:cr=128,setparams=range=limited:color_primaries=bt709:color_trc=bt709:colorspace=bt709',
        '-frames:v','192','-c:v','ffv1','-pix_fmt','yuv420p',str(clip)],check=True,timeout=30)
    manifest=json.loads((moved/'Contents/Resources/vapoursynth-runtime.json').read_text())
    bindir=moved/'Contents/MacOS'
    paths={key:(bindir/manifest[key]).resolve() for key in ('library','pythonHome','pythonPath')}
    env={key:value for key,value in os.environ.items() if not key.startswith(('PYTHON','DYLD_','VSSCRIPT','QT_','QML_','TIGEREST_'))}
    env.update(PATH=str(bindir)+':/usr/bin:/bin:/usr/sbin:/sbin',PYTHONHOME=str(paths['pythonHome']),
        PYTHONPATH=str(paths['pythonPath']),PYTHONNOUSERSITE='1',PYTHONDONTWRITEBYTECODE='1',
        VSSCRIPT_PATH=str(paths['library']),XDG_CONFIG_HOME=str(root/'fresh-config'),DYLD_PRINT_LIBRARIES='1')
    result=subprocess.run([str(binary),str(moved/'Contents/Resources/rife/model'),
        str(moved/'Contents/Frameworks/tigerest-rife-vs.dylib'),
        str(moved/'Contents/Resources/rife/interpolate.vpy'),str(clip),'split-metal'],
        env=env,text=True,capture_output=True,timeout=60)
    if result.returncode:raise RuntimeError(result.stdout+result.stderr)
    assert (root/'fresh-config/vapoursynth/vapoursynth.toml').is_file(),'VSScript borrowed prior registration'
    loaded=[line for line in result.stderr.splitlines() if line.startswith('dyld[')]
    assert loaded,'Missing actual loaded-library evidence'
    assert not any('/opt/homebrew/' in line or '/usr/local/' in line or str(repository) in line for line in loaded), '\n'.join(loaded)
    for name in ('libmpv.2.dylib','libtigerest-rife.dylib','tigerest-rife-vs.dylib','libvsscript.dylib','/Python'):
        assert any(name in line and str(moved) in line for line in loaded),f'Did not load bundled {name}'
    subprocess.run(['codesign','--verify','--deep','--strict',str(moved)],check=True)
    print('PASS: relocated compiled split RIFE pipeline, actual interpolation/seek/pause/fallback; fresh registration; all runtime dependencies bundled; signature remains valid')
