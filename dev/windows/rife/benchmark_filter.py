"""Measure a prepared RIFE filter; excludes decoding, shaders and rendering.

Example: --runtime ROOT --prepared REPORT.json --width 1920 --height 1080
         --fps 30 --factor 2 --streams 2 --duration 15 --output RESULT.json
"""
import argparse
from fractions import Fraction
import json
import math
import os
from pathlib import Path
import runpy
import statistics
import subprocess
import sys
import time

from engine_cache import engine_identity, read_cache
from probe_runtime import isolated_environment, verify_manifest, write_report


def benchmark(args, manifest):
    from native_probe import audit_libraries, gpu_info, loaded_libraries, private_vapoursynth
    root = args.runtime.resolve()
    handles = [os.add_dll_directory(str(root / relative)) for relative in
               ('python', 'python/Lib/site-packages/vapoursynth', 'plugins', 'plugins/vsmlrt-cuda')]
    prepared = json.loads(args.prepared.read_text(encoding='utf-8'))
    model = next(m for m in manifest['models'] if m['id'] == prepared['model'])
    gpu = gpu_info(prepared['gpu']['deviceId'])
    identity = engine_identity(manifest, model, gpu, args.width, args.height)
    if not prepared.get('ready') or identity != prepared['identity']:
        raise ValueError('Prepared engine does not match the requested runtime, GPU or dimensions')
    engine = Path(prepared['enginePath']).resolve()
    if read_cache(engine.parent.parent, identity) != engine:
        raise ValueError('Prepared engine cache is incomplete or corrupt')
    vs = private_vapoursynth()
    core = vs.core
    core.num_threads = args.threads
    core.max_cache_size = 1024
    core.std.LoadPlugin(path=str(root / manifest['entrypoints']['plugin']))
    build = runpy.run_path(str(Path(__file__).resolve().parents[3] / 'resources/mpv/rife/trt_pipeline.py'))['build_rife_filter']
    length = math.ceil((args.duration + args.warmup + 60) * float(args.fps)) + 2
    left = core.std.BlankClip(width=args.width, height=args.height, format=vs.YUV420P10,
                             length=length, color=[180,512,512])
    right = core.std.BlankClip(left, color=[210,512,512])
    source = core.std.Interleave([left, right]).std.AssumeFPS(fpsnum=args.fps.numerator, fpsden=args.fps.denominator)
    source = core.std.SetFrameProps(source, _Matrix=1, _Range=0, _Primaries=1, _Transfer=1,
                                   _FieldBased=0, _DurationNum=args.fps.denominator, _DurationDen=args.fps.numerator)
    output = build(source, {'engine_path': str(engine), 'fps_num': args.fps.numerator, 'fps_den': args.fps.denominator,
        'factor': args.factor, 'alignment': model['alignment'], 'implementation': model['implementation'],
        'num_streams': args.streams, 'device_id': gpu['deviceId'], 'streaming': False, 'monitor': False})
    began = time.perf_counter()
    warmed = None
    count = synthesized = 0
    waits = []
    frames = output.frames(prefetch=args.prefetch)
    try:
        while True:
            before = time.perf_counter()
            frame = next(frames)
            now = time.perf_counter()
            if warmed is None and now - began >= args.warmup:
                warmed = now
            elif warmed is not None:
                count += 1
                synthesized += frame.props['_TigerestRifeSynthesized']
                waits.append((now-before)*1000)
                if now-warmed >= args.duration:
                    break
    finally:
        frames.close()
    if synthesized < count / 3:
        raise ValueError('Benchmark silently bypassed inference')
    security = audit_libraries(root, loaded_libraries())
    return {'phase': 'synthetic VS filter only; decoding, shaders and 4K renderer excluded',
        'runtimeId': manifest['runtimeId'], 'runtimeFingerprint': identity['runtimeFingerprint'],
        'versions': manifest['versions'], 'gpu': gpu, 'model': model['id'], 'modelSha256': model['sha256'],
        'implementation': model['implementation'], 'precision': identity['precision'], 'streams': args.streams,
        'threads': args.threads, 'prefetch': args.prefetch,
        'inputDimensions': [args.width,args.height], 'sourceFps': float(args.fps), 'factor': args.factor,
        'targetFps': float(args.fps*args.factor), 'warmupSeconds': args.warmup, 'seconds': now-warmed,
        'outputFrames': count, 'synthesizedFrames': synthesized, 'filterOutputFps': count/(now-warmed),
        'consumerFrameWaitP50Ms': statistics.median(waits), 'consumerFrameWaitP95Ms': sorted(waits)[int(len(waits)*.95)],
        'gpuInferenceTimingAvailable': False, 'engineCacheKey': prepared['cacheKey'],
        'privateLibrariesOnly': True, 'systemSecurityLibraries': security}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--runtime', type=Path, required=True)
    parser.add_argument('--prepared', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--width', type=int, required=True)
    parser.add_argument('--height', type=int, required=True)
    parser.add_argument('--fps', type=Fraction, required=True)
    parser.add_argument('--factor', type=int, required=True)
    parser.add_argument('--streams', type=int, default=2)
    parser.add_argument('--threads', type=int, default=4)
    parser.add_argument('--prefetch', type=int, default=4)
    parser.add_argument('--duration', type=float, default=15)
    parser.add_argument('--warmup', type=float, default=3)
    parser.add_argument('--native', action='store_true', help=argparse.SUPPRESS)
    args = parser.parse_args()
    if not (5 <= args.duration <= 600 and 1 <= args.warmup <= 60 and
            0 < args.fps <= Fraction(60001,1000) and 2 <= args.factor <= 15 and 1 <= args.streams <= 4 and
            1 <= args.threads <= 32 and 1 <= args.prefetch <= 32):
        parser.error('Invalid benchmark duration, rate, multiplier, stream, thread or prefetch count')
    try:
        root = args.runtime.resolve()
        manifest = verify_manifest(root)
        if args.native:
            report = benchmark(args, manifest)
            print(json.dumps(report, ensure_ascii=False))
        else:
            result = subprocess.run([str(root / manifest['entrypoints']['python']), '-B', '-I', '-S', '-X', 'utf8',
                str(Path(__file__).resolve()), *sys.argv[1:], '--native'], cwd=Path.cwd(),
                env=isolated_environment(root,manifest), capture_output=True, encoding='utf-8',
                timeout=args.duration+args.warmup+120, creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
            if result.returncode:
                raise ValueError('Private filter benchmark failed: '+result.stderr[-3000:])
            report = json.loads(result.stdout)
            write_report(args.output,report)
            print(json.dumps(report,ensure_ascii=False))
    except (OSError, ValueError, KeyError, StopIteration, subprocess.TimeoutExpired) as error:
        parser.exit(1,str(error)+'\n')


if __name__ == '__main__':
    main()
