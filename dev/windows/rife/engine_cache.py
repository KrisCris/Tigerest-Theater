"""GPU-specific engine identity and atomic cache; no inference dependencies."""
from contextlib import contextmanager
import hashlib
import json
import os
from pathlib import Path
import re
import time
import uuid


def digest(path):
    result = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            result.update(block)
    return result.hexdigest()


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=True).encode('utf-8')


def engine_identity(manifest, model, gpu, width, height):
    if type(width) is not int or type(height) is not int or not (2 <= width <= 3840 and 2 <= height <= 2160):
        raise ValueError('Unsupported engine dimensions')
    alignment = model['alignment']
    implementation = model['implementation']
    if not ((implementation == 1 and alignment in (32, 64, 128)) or
            (implementation == 2 and alignment == 1)):
        raise ValueError('Unsupported model layout')
    if not all(gpu.get(key) for key in ('uuid', 'driverVersion', 'computeCapability')):
        raise ValueError('Incomplete GPU identity')
    fingerprint = hashlib.sha256(canonical({key: manifest[key] for key in
                                           ('runtimeId', 'versions', 'files')})).hexdigest()
    return {'schemaVersion': 1, 'runtimeFingerprint': fingerprint,
            'modelId': model['id'], 'modelSha256': model['sha256'], 'gpu': gpu,
            'precision': 'fp16-fp16-io' if implementation == 2 else 'fp16-fp32-io',
            'implementation': implementation,
            'shape': [1, 7 if implementation == 2 else 11, ((height + alignment - 1)//alignment)*alignment,
                            ((width + alignment - 1)//alignment)*alignment],
            'builder': {'optimizationLevel': 3, 'tf32': False, 'maxAuxStreams': 0}}


def cache_key(identity):
    return hashlib.sha256(canonical(identity)).hexdigest()


def validate_request(request):
    required = {'runtime', 'cache', 'model', 'width', 'height'}
    allowed = required | {'deviceId', 'cancelFile', 'generation'}
    if not isinstance(request, dict) or not required.issubset(request):
        raise ValueError('Incomplete engine request')
    if request.keys() - allowed:
        raise ValueError('Unsupported request fields')
    if not all(isinstance(request[key], str) and request[key] for key in ('runtime', 'cache', 'model')):
        raise ValueError('Invalid engine request paths or model')
    if any(type(request[key]) is not int for key in ('width', 'height')):
        raise ValueError('Invalid engine dimensions')
    if type(request.get('deviceId', 0)) is not int or request.get('deviceId', 0) < 0:
        raise ValueError('Invalid GPU index')
    if 'cancelFile' in request and not isinstance(request['cancelFile'], str):
        raise ValueError('Invalid cancellation path')
    if 'generation' in request and (type(request['generation']) is not int or request['generation'] < 0):
        raise ValueError('Invalid generation')


def inside(root, relative):
    root = root.resolve()
    target = root / relative
    if not target.resolve().is_relative_to(root):
        raise ValueError('Engine cache path escapes its root')
    for path in (target, *target.parents):
        if path == root:
            break
        if path.is_symlink() or (hasattr(path, 'is_junction') and path.is_junction()):
            raise ValueError('Engine cache links are not allowed')
    return target


def read_cache(root, identity):
    try:
        directory = inside(root, cache_key(identity))
        marker = inside(root, directory.name + '/complete.json')
        engine = inside(root, directory.name + '/model.engine')
        record = json.loads(marker.read_text(encoding='utf-8'))
        if (record['identity'] != identity or record['size'] < 1024 or
                engine.stat().st_size != record['size'] or digest(engine) != record['sha256']):
            return None
        return engine
    except (OSError, ValueError, KeyError, TypeError):
        return None


def commit_cache(root, identity, staged):
    if staged.stat().st_size < 1024:
        raise ValueError('A complete engine is required before cache commit')
    record = {'identity': identity, 'size': staged.stat().st_size, 'sha256': digest(staged)}
    directory = inside(root, cache_key(identity))
    directory.mkdir(parents=True, exist_ok=True)
    engine = inside(root, directory.name + '/model.engine')
    marker = inside(root, directory.name + '/complete.json')
    temporary = inside(root, directory.name + '/' + uuid.uuid4().hex + '.json.tmp')
    try:
        with temporary.open('w', encoding='utf-8') as stream:
            json.dump(record, stream, ensure_ascii=False)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(staged, engine)
        os.replace(temporary, marker)
    finally:
        temporary.unlink(missing_ok=True)
    return engine


@contextmanager
def build_lock(root, key, cancelled, timeout=900):
    if re.fullmatch('[0-9a-f]{64}', key) is None:
        raise ValueError('Invalid engine cache key')
    root.mkdir(parents=True, exist_ok=True)
    lock = inside(root, key + '.lock')
    started = time.monotonic()
    with lock.open('a+b') as stream:
        if stream.tell() == 0:
            stream.write(b'\0')
            stream.flush()
        while True:
            if cancelled():
                raise InterruptedError('Engine preparation cancelled')
            try:
                stream.seek(0)
                if os.name == 'nt':
                    import msvcrt
                    msvcrt.locking(stream.fileno(), msvcrt.LK_NBLCK, 1)
                else:
                    import fcntl
                    fcntl.flock(stream.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except OSError:
                if time.monotonic() - started >= timeout:
                    raise TimeoutError('Engine build lock timed out')
                time.sleep(0.05)
        try:
            yield
        finally:
            stream.seek(0)
            if os.name == 'nt':
                msvcrt.locking(stream.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                fcntl.flock(stream.fileno(), fcntl.LOCK_UN)
