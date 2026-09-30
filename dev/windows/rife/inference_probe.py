"""Development smoke test: run real RIFE weights using only the private runtime."""
import argparse
from array import array
import json
import os
from pathlib import Path
import sys
import time


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--runtime', required=True, type=Path)
    parser.add_argument('--cache', required=True, type=Path)
    parser.add_argument('--report', required=True, type=Path)
    args = parser.parse_args()
    root = args.runtime.resolve()
    manifest = json.loads((root / 'runtime.json').read_text(encoding='utf-8'))
    implementation = manifest['model']['implementation']
    result = {'ok': False, 'model': 'rife-4.25-lite', 'errors': []}
    dll_dirs = []
    try:
        for relative in ('python', 'python/Lib/site-packages/vapoursynth', 'plugins', 'plugins/vsmlrt-cuda'):
            dll_dirs.append(os.add_dll_directory(str(root / relative)))
        sys.path.insert(0, str(root / 'plugins'))
        sys.path.insert(0, str(root / 'scripts'))
        from native_probe import loaded_libraries, audit_libraries, private_vapoursynth
        vs = private_vapoursynth()
        core = vs.core
        core.num_threads = 2
        core.std.LoadPlugin(path=str(root / 'plugins/vstrt.dll'))
        import vsmlrt
        blank = core.std.BlankClip(width=256, height=128, format=vs.RGBS,
                                   length=2, fpsnum=24, fpsden=1, color=[0., 0., 0.])

        def motion(n, f):
            output = f.copy()
            for plane in range(3):
                for y in range(128):
                    row = array('f', (0.1 + ((x // 8 + y // 8) % 2) * 0.04 for x in range(256)))
                    if 32 <= y < 96:
                        for x in range(64 + n * 16, 128 + n * 16):
                            row[x] = 0.7 + plane * 0.1
                    memoryview(output[plane]).cast('B')[y * output.get_stride(plane):
                                                          y * output.get_stride(plane) + 256 * 4] = row.tobytes()
            return output

        source = core.std.ModifyFrame(blank, clips=blank, selector=motion)
        cache = args.cache.resolve()
        cache.mkdir(parents=True, exist_ok=True)
        backend = vsmlrt.Backend.TRT(fp16=True, num_streams=1, engine_folder=str(cache),
                                    use_cuda_graph=False, custom_env={
                                        key: os.environ[key] for key in ('SystemRoot', 'WINDIR', 'TEMP', 'TMP')
                                        if key in os.environ})
        started = time.monotonic()
        inference_source = core.resize.Point(source, format=vs.RGBH) if implementation == 2 else source
        output = vsmlrt.RIFE(inference_source, multi=2, model=vsmlrt.RIFEModel.v4_25_lite,
                             backend=backend, _implementation=implementation)
        output = core.resize.Point(output, format=vs.RGBS)
        result['enginePreparationSeconds'] = time.monotonic() - started
        left, right = source.get_frame(0), source.get_frame(1)
        started = time.monotonic()
        middle = output.get_frame(1)
        result['frameRequestMs'] = (time.monotonic() - started) * 1000

        def difference(other):
            total = 0.
            for plane in range(3):
                for y in range(128):
                    total += sum(abs(middle[plane][y, x] - other[plane][y, x]) for x in range(256))
            return total / (256 * 128 * 3)

        result.update(implementation=implementation,
                      precision='fp16-fp16-io' if implementation == 2 else 'fp16-fp32-io',
                      differenceFromLeft=difference(left), differenceFromRight=difference(right),
                      outputDimensions=[middle.width, middle.height],
                      engineBytes=sum(p.stat().st_size for p in cache.glob('*.engine')),
                      loadedLibraries=loaded_libraries())
        result['systemSecurityLibraries'] = audit_libraries(root, result['loadedLibraries'])
        result.update(ok=True, privateLibrariesOnly=True)
    except Exception as error:
        result['errors'].append(str(error))
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(result, ensure_ascii=False))
    return 0 if result['ok'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
