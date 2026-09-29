"""Run native RIFE candidates alongside a private mpv renderer and real shaders.

This measures resource contention; it is not an integrated A/V playback gate.
Only connects to the private socket passed explicitly on the command line.
"""
import argparse
import json
import math
from pathlib import Path
import socket
import subprocess
import time


class Renderer:
    def __init__(self, path):
        self.socket = socket.socket(socket.AF_UNIX)
        self.socket.settimeout(5)
        self.socket.connect(str(path))
        self.reader = self.socket.makefile('rb')
        self.counter = 0

    def command(self, *args):
        self.counter += 1
        message = {'command': list(args), 'request_id': self.counter}
        self.socket.sendall((json.dumps(message)+'\n').encode())
        while True:
            line = self.reader.readline()
            if not line:
                raise RuntimeError('Private renderer exited')
            reply = json.loads(line)
            if reply.get('request_id') == self.counter:
                if reply.get('error') != 'success':
                    raise RuntimeError(f'{args}: {reply}')
                return reply.get('data')

    def sample(self):
        passes = self.command('get_property', 'vo-passes').get('fresh', [])
        return {'clock': time.monotonic(),
                'drop': self.command('get_property', 'frame-drop-count'),
                'delayed': self.command('get_property', 'vo-delayed-frame-count'),
                'gpu_pass_sum_ms': sum(p['last'] for p in passes)/1e6,
                'passes': [{'desc': p['desc'], 'last_ns': p['last']} for p in passes]}


def percentile(values, p):
    return sorted(values)[max(0, math.ceil(len(values)*p)-1)]


def run(args):
    if args.repeats<1 or args.iterations<120:
        raise ValueError('Use at least one round and 120 measured predictions')
    renderer = Renderer(args.socket)
    assert renderer.command('get_property', 'vo-configured')
    root = args.root.resolve()
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    metadata = {k: renderer.command('get_property', k) for k in
                ('video-out-params','osd-dimensions','display-fps','glsl-shaders')}
    candidates = ['renderer-only', 'mono-gpu', 'split-gpu', 'split-ane']
    if args.metal:
        if not args.engine:
            raise ValueError('--metal requires --engine')
        candidates = ['renderer-only', 'mono-gpu', 'split-ane', 'split-metal-ane']
    if args.candidates:
        candidates=args.candidates
    if 'split-metal-ane' in candidates and not args.engine:
        raise ValueError('The Metal candidate requires --engine')
    reports = []
    # Reverse order on the second pass to expose drift and warmup effects.
    for repeat in range(args.repeats):
        for name in candidates if repeat % 2 == 0 else list(reversed(candidates)):
            result_path = output / f'{repeat}-{name}.json'
            command = None
            if name == 'mono-gpu':
                model = root/'build/rife/models/1080-grid-half-fp32'
                command = [str(root/'build/rife/rife-benchmark'), '--model', str(model/'RIFE.mlpackage'),
                           '--input-a', str(model/'fixture/frame0.f32'), '--input-b', str(model/'fixture/frame1.f32'),
                           '--compute', 'cpu-gpu', '--warmup', '30', '--iterations', str(args.iterations),
                           '--output', str(result_path)]
            elif name.startswith('split-'):
                model = root/'build/rife/models/1080-split-refine'
                command = [str(root/'build/rife/rife-split-benchmark'), '--model-dir', str(model),
                           '--fixtures', str(model/'fixture'), '--encoder-compute', 'cpu-ane' if name.endswith('-ane') else 'cpu-gpu',
                           '--warmup', '30', '--iterations', str(args.iterations), '--output', str(result_path)]
            if args.engine and command:
                command = [str(root/'build/rife/rife-engine-benchmark'), '--model-dir', str(model),
                           '--pipeline', 'split-metal' if name == 'split-metal-ane' else ('split' if name.startswith('split-') else 'monolithic'),
                           '--compute', 'cpu-ane' if name.endswith('-ane') else 'cpu-gpu',
                           '--warmup', '30', '--iterations', str(args.iterations),
                           '--interval-ms', str(args.interval_ms), '--output', str(result_path)]
            print(f'Start {repeat}: {name}', flush=True)
            samples = [renderer.sample()]
            start = time.monotonic()
            with result_path.with_suffix('.log').open('w') as log:
                process = subprocess.Popen(command, stdout=log, stderr=log) if command else None
                try:
                    while (process.poll() is None if process else time.monotonic()-start < 12):
                        if time.monotonic()-start > 180:
                            raise TimeoutError('Benchmark exceeded 180 seconds')
                        time.sleep(.25)
                        samples.append(renderer.sample())
                    if process and process.returncode:
                        raise RuntimeError(f'Candidate failed: {name}; see {log.name}')
                finally:
                    if process and process.poll() is None:
                        process.terminate()
                        process.wait(timeout=10)
            # mpv drops reset at each loop. Sum only nonnegative counter changes.
            drops = sum(max(0,b['drop']-a['drop']) for a,b in zip(samples,samples[1:]))
            delayed = sum(max(0,b['delayed']-a['delayed']) for a,b in zip(samples,samples[1:]))
            stable = [s['gpu_pass_sum_ms'] for s in samples if s['clock']-start >= 3]
            if not stable:
                raise RuntimeError('Too few renderer samples after warmup; increase --iterations')
            report = {'candidate': name, 'repeat': repeat, 'seconds': time.monotonic()-start,
                      'render_drop_delta': drops, 'render_delayed_delta': delayed,
                      'render_pass_sum_p50_ms': percentile(stable,.5),
                      'render_pass_sum_p95_ms': percentile(stable,.95), 'samples': samples}
            if command:
                native = json.loads(result_path.read_text())
                report['inference_p50_ms'] = native['p50_ms']
                report['inference_p95_ms'] = native['p95_ms']
            reports.append(report)
            (output/'renderer-report.json').write_text(json.dumps({'metadata':metadata,'runs':reports,
                'engine_calls':args.engine, 'requested_pair_interval_ms':args.interval_ms if args.engine else 0,
                'scope':'Independent 1080p60 mpv rendering plus native RIFE. With --engine, all candidates include complete engine calls and can be paced. Otherwise monolithic excludes input/output copies; split includes preprocessing/output copy. Render pass sums are sampled GPU timings, not whole-frame deadlines or utilization.'},indent=2)+'\n')
            print(json.dumps({k:v for k,v in report.items() if k!='samples'}),flush=True)


if __name__ == '__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--root',type=Path,default=Path(__file__).resolve().parents[3])
    p.add_argument('--socket',type=Path,required=True)
    p.add_argument('--output',type=Path,required=True)
    p.add_argument('--iterations',type=int,default=600)
    p.add_argument('--repeats',type=int,default=2)
    p.add_argument('--engine',action='store_true')
    p.add_argument('--metal',action='store_true')
    p.add_argument('--interval-ms',type=float,default=0)
    p.add_argument('--candidates',nargs='+',choices=('renderer-only','mono-gpu','split-gpu','split-ane','split-metal-ane'))
    run(p.parse_args())
