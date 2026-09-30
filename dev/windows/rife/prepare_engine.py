"""Prepare a GPU-specific RIFE engine with the verified private interpreter."""
import argparse
import json
from pathlib import Path
import subprocess

from engine_cache import validate_request
from probe_runtime import isolated_environment, private_path, verify_manifest, write_report
from windows_job import attach_cleanup_job

_job = None


def prepare(request_path):
    global _job
    request = json.loads(request_path.read_text(encoding='utf-8-sig'))
    validate_request(request)
    root = Path(request['runtime']).resolve()
    manifest = verify_manifest(root)
    python = private_path(root, manifest['entrypoints']['python'])
    worker = private_path(root, manifest['entrypoints']['engineWorker'])
    if _job is None:
        _job = attach_cleanup_job()
    command = [str(python), '-B', '-I', '-S', '-X', 'utf8', str(worker), '--request', str(request_path.resolve())]
    process = subprocess.run(command, cwd=root, env=isolated_environment(root, manifest),
                             capture_output=True, encoding='utf-8', timeout=930,
                             creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    report = json.loads(process.stdout)
    if process.returncode and report.get('ready'):
        raise ValueError('Engine worker failed before completion')
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--request', required=True, type=Path)
    parser.add_argument('--result', required=True, type=Path)
    args = parser.parse_args()
    try:
        report = prepare(args.request)
    except (OSError, ValueError, KeyError, TypeError, subprocess.TimeoutExpired) as error:
        report = {'ready': False, 'cacheHit': False, 'error': str(error)}
    write_report(args.result, report)
    return 0 if report['ready'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
