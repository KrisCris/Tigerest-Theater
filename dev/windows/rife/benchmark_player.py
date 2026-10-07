"""Run the actual Qt Player with an explicit kernel and isolated 4K window.

Record evidence only; a completed command isn't a performance acceptance.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import uuid

ROOT = Path(__file__).resolve().parents[3]


def sha256(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024*1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for key in ('host', 'mpv', 'stats', 'qt-bin', 'runtime', 'cache', 'monitor', 'media', 'output'):
        parser.add_argument('--'+key, type=Path, required=True)
    parser.add_argument('--model', choices=('rife-4.25-lite', 'rife-4.25', 'rife-4.25-heavy'), default='rife-4.25-lite')
    parser.add_argument('--target', type=int, choices=(60,120,240), default=60)
    parser.add_argument('--seconds', type=int, default=600)
    parser.add_argument('--warmup', type=int, default=15)
    parser.add_argument('--backend', choices=('gpu-next','libmpv'), default='gpu-next')
    parser.add_argument('--preset', choices=('default','liveaction','aggressive'), default='default')
    parser.add_argument('--baseline', action='store_true')
    parser.add_argument('--controls', action='store_true')
    parser.add_argument('--sync', choices=('audio','display-resample','display-vdrop'))
    args = parser.parse_args()
    if not 5 <= args.seconds <= 3600 or not 5 <= args.warmup <= 120:
        parser.error('seconds must be 5..3600; warmup must be 5..120')
    args.output = args.output.resolve()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='RIFE 4K 播放 ') as temp:
        stage = Path(temp)
        executable = stage/'player-benchmark.exe'
        shutil.copyfile(args.host, executable)
        shutil.copyfile(args.mpv, stage/'libmpv-2.dll')
        shutil.copyfile(args.stats, stage/'tigerest-rife.dll')
        mpv_hash, media_hash = sha256(stage/'libmpv-2.dll'), sha256(args.media)
        host_hash, stats_hash, monitor_hash = sha256(executable), sha256(stage/'tigerest-rife.dll'), sha256(args.monitor)
        run_id = uuid.uuid4().hex
        command = [str(executable),'--run-id',run_id]
        for key in ('runtime','cache','monitor','media','output','model','target','seconds','warmup','backend','preset'):
            item = getattr(args,key)
            command += ['--'+key, str(item.resolve() if isinstance(item,Path) else item)]
        command += ['--script', str(ROOT/'resources/mpv/rife/interpolate_trt.vpy')]
        if args.baseline:
            command.append('--baseline')
        if args.controls:
            command.append('--controls')
        if args.sync:
            command += ['--sync', args.sync]
        environment = dict(os.environ, RIFE_BENCH_EXPECTED_MPV=str(stage/'libmpv-2.dll'),
                           PATH=str(args.qt_bin.resolve())+os.pathsep+os.environ.get('PATH',''))
        log = args.output.with_suffix('.log')
        timed_out = False
        with log.open('wb') as stream:
            try:
                run = subprocess.run(command, stdout=stream, stderr=subprocess.STDOUT, env=environment,
                                     timeout=args.seconds+args.warmup+150)
                return_code = run.returncode
            except subprocess.TimeoutExpired:
                timed_out, return_code = True, None
        if not args.output.is_file():
            raise SystemExit(f'Player did not save the current report; see {log}')
        try:
            report = json.loads(args.output.read_text(encoding='utf-8'))
        except (OSError, ValueError) as error:
            raise SystemExit(f'Cannot read the current Player report: {error}; see {log}') from error
        if report.get('runId') != run_id:
            raise SystemExit(f'Refusing a stale report from another run; see {log}')
        report['mpvSha256'], report['mediaSha256'] = mpv_hash, media_hash
        report['hostSha256'], report['statsSha256'], report['monitorSha256'] = host_hash, stats_hash, monitor_hash
        report['processReturnCode'], report['timedOut'] = return_code, timed_out
        if timed_out or return_code:
            report['completed'] = False
            report['error'] = 'Native Player timed out' if timed_out else f'Native Player exited {return_code}'
        with tempfile.NamedTemporaryFile('w',encoding='utf-8',dir=args.output.parent,delete=False) as commit:
            json.dump(report,commit,ensure_ascii=False,indent=2)
            commit.write('\n')
        os.replace(commit.name,args.output)
        if timed_out or return_code:
            raise SystemExit(f'Player measurement failed ({return_code}, timeout={timed_out}); see {log}')
        print(f'Player measurement saved to {args.output}; inspect evidence before accepting performance')


if __name__ == '__main__':
    main()
