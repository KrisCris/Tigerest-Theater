"""Non-GPU process fixture for the Qt runtime manager's async protocol."""
import argparse
import json
from pathlib import Path
import sys
import time

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'dev/windows/rife'))
from engine_cache import commit_cache, engine_identity

p = argparse.ArgumentParser()
p.add_argument('--runtime', type=Path)
p.add_argument('--report', type=Path)
p.add_argument('--request', type=Path)
p.add_argument('--result', type=Path)
args = p.parse_args()
if args.runtime:
    state = json.loads((args.runtime / 'fixture.json').read_text(encoding='utf-8'))
    args.report.write_text(json.dumps(state['probe']), encoding='utf-8')
else:
    request = json.loads(args.request.read_text(encoding='utf-8'))
    runtime = Path(request['runtime'])
    state = json.loads((runtime / 'fixture.json').read_text(encoding='utf-8'))
    for _ in range(state.get('delay', 20)):
        time.sleep(.01)
        if Path(request['cancelFile']).exists():
            sys.exit(2)
    manifest = json.loads((runtime / 'runtime.json').read_text(encoding='utf-8'))
    model = next(m for m in manifest['models'] if m['id'] == request['model'])
    identity = engine_identity(manifest, model, state['probe']['gpu'], request['width'], request['height'])
    stage = args.request.parent / 'fixture.engine'
    stage.write_bytes(b'fake engine for lifecycle tests' * 1024)
    engine = commit_cache(Path(request['cache']), identity, stage)
    args.result.write_text(json.dumps({'ready': True, 'enginePath': str(engine), 'identity': identity,
                                      'generation': request['generation']}), encoding='utf-8')
