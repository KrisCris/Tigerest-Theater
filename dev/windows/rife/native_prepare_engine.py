"""Private engine worker; never opens media or compiles during playback."""
import argparse
import json
import math
import os
from pathlib import Path
import subprocess
import sys
import tempfile
from threading import Event, Thread
import time

from engine_cache import build_lock, cache_key, commit_cache, engine_identity, inside, read_cache, validate_request
from native_probe import audit_libraries, gpu_info, loaded_libraries, private_vapoursynth
from probe_runtime import isolated_environment, private_path, verify_manifest
from windows_job import attach_cleanup_job

_job = None


def validate_engine(core, vs, engine, shape, device_id, cancelled, started, implementation=1):
    # Native TensorRT calls release the GIL and may block in driver code.
    # Leaving this process closes its Job and terminates every descendant;
    # no unvalidated engine has been committed at this point.
    stopped = Event()
    def supervise():
        while not stopped.wait(.1):
            error = ('Engine preparation cancelled' if cancelled() else
                     'Engine preparation exceeded 15 minutes' if time.monotonic() - started > 900 else '')
            if error:
                print(json.dumps({'ready': False, 'cacheHit': False, 'error': error}), flush=True)
                os._exit(2)
    watcher = Thread(target=supervise, daemon=True)
    watcher.start()
    try:
        check_inference(core, vs, engine, shape, device_id, implementation)
    finally:
        stopped.set()
        watcher.join()


def check_inference(core, vs, engine, shape, device_id, implementation=1):
    import vsmlrt
    _, _, height, width = shape
    left = core.std.BlankClip(width=width, height=height, format=vs.RGBH if implementation == 2 else vs.RGBS,
                              length=1, color=[.1, .1, .1])
    right = core.std.BlankClip(left, color=[.8, .8, .8])
    mask = core.std.BlankClip(left, format=vs.GRAYH if implementation == 2 else vs.GRAYS, color=.5)
    clips = [left, right, mask] if implementation == 2 else [left, right, mask, *vsmlrt.get_rife_input(left)]
    output = core.trt.Model(clips,
                            engine_path=str(engine), device_id=device_id, num_streams=1, use_cuda_graph=True)
    frame = core.resize.Point(output, format=vs.RGBS).get_frame(0)
    values = [frame[p][y, x] for p in range(3) for y, x in
              ((height//2, width//2), (height//4, width//4), (height*3//4, width*3//4))]
    if not all(math.isfinite(value) and -.5 < value < 1.5 for value in values):
        raise ValueError('Prepared engine returned invalid pixels')
    if not any(.11 < value < .79 for value in values):
        raise ValueError('Prepared engine did not interpolate the validation pair')


def prepare(request):
    global _job
    started = time.monotonic()
    validate_request(request)
    cancel = Path(request['cancelFile']) if request.get('cancelFile') else None
    cancelled = lambda: cancel is not None and cancel.exists()
    if cancelled():
        raise InterruptedError('Engine preparation cancelled')
    _job = attach_cleanup_job()
    root, cache = Path(request['runtime']).resolve(), Path(request['cache']).resolve()
    manifest = verify_manifest(root)
    model = next((m for m in manifest['models'] if m['id'] == request['model']), None)
    if model is None:
        raise ValueError('Requested model is not in the verified runtime')
    if model['path'] not in {f['path'] for f in manifest['files'] if f['sha256'] == model['sha256']}:
        raise ValueError('Model does not match the verified manifest')
    dll_dirs = [os.add_dll_directory(str(root / relative)) for relative in
                ('python', 'python/Lib/site-packages/vapoursynth', 'plugins', 'plugins/vsmlrt-cuda')]
    sys.path.insert(0, str(root / 'plugins'))
    device_id = request.get('deviceId', 0)
    gpu = gpu_info(device_id)
    identity = engine_identity(manifest, model, gpu, request['width'], request['height'])
    key = cache_key(identity)
    result = {'ready': False, 'cacheKey': key, 'cacheHit': False, 'model': model['id'],
              'gpu': gpu, 'identity': identity, 'generation': request.get('generation', 0)}
    with build_lock(cache, key, cancelled, timeout=max(0, 900-(time.monotonic()-started))):
        ready = read_cache(cache, identity)
        if ready:
            return dict(result, ready=True, cacheHit=True, enginePath=str(ready), validatedInference=True)
        vs = private_vapoursynth()
        core = vs.core
        core.num_threads = 2
        core.std.LoadPlugin(path=str(private_path(root, manifest['entrypoints']['plugin'])))
        workspace_root = inside(cache, '.build-' + key)
        workspace_root.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix='engine-', dir=workspace_root) as temporary:
            workspace = Path(temporary)
            if not workspace.resolve().is_relative_to(cache):
                raise ValueError('Engine build directory escaped cache root')
            engine = workspace / 'model.engine'
            executable = private_path(root, manifest['entrypoints']['trtexec'])
            shape = 'x'.join(str(n) for n in identity['shape'])
            arguments = [str(executable), '--onnx=' + str(private_path(root, model['path'])),
                         '--device=' + str(device_id), '--saveEngine=' + str(engine),
                         '--shapes=input:' + shape, '--fp16', '--noTF32', '--skipInference',
                         '--inputIOFormats=' + ('fp16' if model['implementation'] == 2 else 'fp32') + ':chw',
                         '--outputIOFormats=' + ('fp16' if model['implementation'] == 2 else 'fp32') + ':chw',
                         '--builderOptimizationLevel=3', '--maxAuxStreams=0']
            if model['implementation'] == 2:
                # Upstream v2 protection for grid coordinates/divisors. These
                # operations must remain FP32 even with FP16 image I/O.
                arguments += ['--precisionConstraints=obey', '--layerPrecisions='
                    '/Cast_2:fp32,/Cast_3:fp32,/Cast_5:fp32,/Cast_7:fp32,'
                    '/Reciprocal:fp32,/Reciprocal_1:fp32,/Mul:fp32,/Mul_1:fp32,/Mul_8:fp32,/Mul_10:fp32,'
                    '/Sub_5:fp32,/Sub_6:fp32,ONNXTRT_Broadcast_236:fp32,ONNXTRT_Broadcast_238:fp32,'
                    'ONNXTRT_Broadcast_273:fp32,ONNXTRT_Broadcast_275:fp32,ONNXTRT_Broadcast_*:fp32']
            # Timing-cache locks in this upstream executable fail on Unicode
            # paths. The engine is built directly and committed by our cache.
            with (workspace / 'compiler.log').open('wb') as log:
                process = subprocess.Popen(arguments, cwd=executable.parent,
                    env=isolated_environment(root, manifest), stdout=log, stderr=subprocess.STDOUT,
                    creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
                try:
                    while process.poll() is None:
                        if cancelled():
                            raise InterruptedError('Engine preparation cancelled')
                        if time.monotonic() - started > 900:
                            raise TimeoutError('Engine preparation exceeded 15 minutes')
                        time.sleep(.1)
                    if process.returncode:
                        tail = (workspace / 'compiler.log').read_bytes()[-3000:].decode('utf-8', errors='replace')
                        raise ValueError('TensorRT compiler failed: ' + tail)
                finally:
                    if process.poll() is None:
                        process.kill()
                    process.wait(timeout=15)
            if cancelled():
                raise InterruptedError('Engine preparation cancelled')
            validate_engine(core, vs, engine, identity['shape'], device_id, cancelled, started, model['implementation'])
            security = audit_libraries(root, loaded_libraries())
            if cancelled():
                raise InterruptedError('Engine preparation cancelled')
            if time.monotonic() - started > 900:
                raise TimeoutError('Engine preparation exceeded 15 minutes')
            ready = commit_cache(cache, identity, engine)
    return dict(result, ready=True, enginePath=str(ready), validatedInference=True,
                preparationSeconds=time.monotonic()-started, systemSecurityLibraries=security)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--request', type=Path, required=True)
    args = parser.parse_args()
    try:
        result = prepare(json.loads(args.request.read_text(encoding='utf-8-sig')))
    except (OSError, ValueError, KeyError, TypeError, RuntimeError) as error:
        result = {'ready': False, 'cacheHit': False, 'error': str(error)}
    print(json.dumps(result, ensure_ascii=False))
    return 0 if result['ready'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
