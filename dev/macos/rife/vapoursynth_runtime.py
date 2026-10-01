"""Resolve the verified R79 package from an explicit build interpreter."""
import json
from pathlib import Path
import subprocess


def inspect_runtime(interpreter):
    interpreter = Path(interpreter)
    if not interpreter.is_file():
        raise RuntimeError(f'Missing explicit VapourSynth interpreter: {interpreter}')
    script = """
import importlib.metadata,json,sys,vapoursynth
distribution=importlib.metadata.distribution('vapoursynth')
license=next(distribution.locate_file(p) for p in distribution.files
             if str(p).endswith('licenses/COPYING.LESSER'))
print(json.dumps({'prefix':sys.base_prefix,
 'version':f'{sys.version_info.major}.{sys.version_info.minor}',
 'pythonVersion':sys.version,'vapoursynthVersion':str(vapoursynth.__version__),
 'package':vapoursynth.__path__[0],'license':str(license)}))
"""
    info = json.loads(subprocess.check_output([str(interpreter), '-I', '-c', script], text=True))
    if info.get('vapoursynthVersion') != 'R79':
        raise RuntimeError('This bundle recipe requires verified VapourSynth R79')
    package = Path(info['package'])
    if not (package/'pkgconfig/vapoursynth.pc').is_file() or not (package/'include/VapourSynth4.h').is_file() or not Path(info['license']).is_file():
        raise RuntimeError('The explicit R79 package lacks headers/pkgconfig or its license')
    info['pkgconfig'] = str(package/'pkgconfig')
    info['include'] = str(package/'include')
    return info


if __name__ == '__main__':
    import sys
    print(json.dumps(inspect_runtime(sys.executable)))
