"""Build a pinned private runtime; this tool is used only during development."""
import argparse
import hashlib
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import urllib.request
import zipfile

from probe_runtime import file_hash, private_path, verify_manifest

HERE = Path(__file__).resolve().parent


def acquire(entry, directory, offline):
    path = private_path(directory, entry['file'])
    if not path.is_file():
        if offline:
            raise ValueError('Offline archive missing: ' + entry['file'])
        url = entry['url']
        if not url.startswith('https://'):
            raise ValueError('Dependency URL must use HTTPS')
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.with_name(path.name + '.download')
        print('Downloading', entry['file'], flush=True)
        with urllib.request.urlopen(url, timeout=60) as response, temporary.open('wb') as output:
            shutil.copyfileobj(response, output, 1024 * 1024)
        os.replace(temporary, path)
    if entry.get('size') is not None and path.stat().st_size != entry['size']:
        raise ValueError('Archive size mismatch: ' + entry['file'])
    if file_hash(path) != entry['sha256']:
        raise ValueError('Archive SHA256 mismatch: ' + entry['file'])
    return path


def extract_zip(archive, root, *, skip_debug=False):
    for info in archive.infolist():
        if info.is_dir() or (skip_debug and info.filename.endswith('.pdb')):
            continue
        target = private_path(root, info.filename)
        if (info.external_attr >> 16) & 0o170000 == 0o120000:
            raise ValueError('Archive symlink is not allowed: ' + info.filename)
        target.parent.mkdir(parents=True, exist_ok=True)
        with archive.open(info) as source, target.open('wb') as output:
            shutil.copyfileobj(source, output)


def archive_names(extractor, archive, root):
    result = subprocess.run([str(extractor), 'l', '-slt', '-sccUTF-8', str(archive)],
                            capture_output=True, encoding='utf-8', errors='strict', check=True)
    listing = result.stdout.split('----------', 1)[1]
    names = []
    for block in listing.strip().split('\n\n'):
        fields = dict(line.split(' = ', 1) for line in block.splitlines() if ' = ' in line)
        name = fields.get('Path')
        if not name:
            continue
        private_path(root, name)
        if fields.get('Symbolic Link') or fields.get('Hard Link'):
            raise ValueError('Archive links are not allowed')
        if not fields.get('Attributes', '').startswith('D'):
            names.append(name.replace('\\', '/'))
    return names


def extract_7z(extractor, archive, root, selected, workspace):
    names = archive_names(extractor, archive, root)
    names = [name for name in names if selected(name)]
    if not names:
        raise ValueError('No selected runtime files in ' + str(archive))
    listfile = workspace / 'extract-files.txt'
    listfile.write_text('\n'.join(names), encoding='utf-8')
    root.mkdir(parents=True, exist_ok=True)
    subprocess.run([str(extractor), 'x', str(archive), '-o' + str(root), '-y',
                    '-bso0', '-bsp0', '-scsUTF-8', '-i@' + str(listfile)], check=True,
                   creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))


def build_runtime(lock, archives, output):
    if output.exists():
        raise ValueError('Output already exists; choose a new version directory: ' + str(output))
    required = {'python', 'vapoursynth', 'trt-1', 'trt-2', 'model', 'extractor'}
    if not required.issubset(archives):
        raise ValueError('Runtime lock is missing required dependencies')
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='rife-build-', dir=output.parent) as temporary:
        workspace = Path(temporary)
        root = workspace / 'runtime'
        root.mkdir()
        python = root / 'python'
        with zipfile.ZipFile(archives['python']) as archive:
            extract_zip(archive, python)
        packages = python / 'Lib/site-packages'
        with zipfile.ZipFile(archives['vapoursynth']) as archive:
            wheels = [name for name in archive.namelist() if name.endswith('.whl')]
            if len(wheels) != 1:
                raise ValueError('Expected one VapourSynth portable wheel')
            with zipfile.ZipFile(io.BytesIO(archive.read(wheels[0]))) as wheel:
                extract_zip(wheel, packages, skip_debug=True)
        (python / 'python313._pth').write_text('python313.zip\n.\nLib/site-packages\n../scripts\n', encoding='utf-8')
        joined = workspace / 'tensorrt.7z'
        with joined.open('wb') as target:
            for identifier in ('trt-1', 'trt-2'):
                with archives[identifier].open('rb') as source:
                    shutil.copyfileobj(source, target, 1024 * 1024)
        plugins = root / 'plugins'
        extract_7z(archives['extractor'], joined, plugins,
                   lambda n: n in ('vstrt.dll', 'vsmlrt.py') or
                   (n.startswith('vsmlrt-cuda/') and 'rtx' not in n.casefold()), workspace)
        extract_7z(archives['extractor'], archives['model'], plugins / 'models',
                   lambda n: n == 'rife/rife_v4.25_lite.onnx', workspace)
        scripts = root / 'scripts'
        scripts.mkdir()
        shutil.copyfile(HERE / 'native_probe.py', scripts / 'native_probe.py')
        notices = root / 'licenses'
        shutil.copytree(HERE / 'licenses', notices)
        shutil.copyfile(HERE.parents[1] / 'macos/rife/LICENSE.Practical-RIFE', notices / 'LICENSE.Practical-RIFE')
        files = []
        for path in sorted(root.rglob('*')):
            if path.is_file():
                files.append({'path': path.relative_to(root).as_posix(), 'size': path.stat().st_size,
                              'sha256': file_hash(path)})
        model = 'plugins/models/rife/rife_v4.25_lite.onnx'
        manifest = {'schemaVersion': 1, 'backend': 'windows-nvidia-trt', 'runtimeId': lock['runtimeId'],
                    'versions': lock['versions'], 'sources': lock['sources'],
                    'entrypoints': {'python': 'python/python.exe',
                                   'vsscript': 'python/Lib/site-packages/vapoursynth/vsscript.dll',
                                   'plugin': 'plugins/vstrt.dll', 'worker': 'scripts/native_probe.py'},
                    'files': files, 'model': {'id': 'rife-4.25-lite', 'path': model,
                                             'sha256': file_hash(root / model)},
                    'unpackedBytes': sum(entry['size'] for entry in files)}
        (root / 'runtime.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
        verify_manifest(root)
        os.rename(root, output)
        print(json.dumps({'runtime': str(output), 'runtimeId': manifest['runtimeId'],
                          'unpackedBytes': manifest['unpackedBytes']}, ensure_ascii=False))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--archives', type=Path, default=HERE.parents[2] / 'build/rife/downloads')
    parser.add_argument('--lock', type=Path, default=HERE / 'runtime-lock.json')
    parser.add_argument('--offline', action='store_true')
    args = parser.parse_args()
    try:
        lock = json.loads(args.lock.read_text(encoding='utf-8'))
        if lock.get('schemaVersion') != 1:
            raise ValueError('Unsupported dependency lock')
        directory = args.archives.resolve()
        archives = {entry['id']: acquire(entry, directory, args.offline) for entry in lock['archives']}
        build_runtime(lock, archives, args.output.resolve())
    except (OSError, ValueError, subprocess.CalledProcessError, zipfile.BadZipFile) as error:
        parser.exit(1, str(error) + '\n')


if __name__ == '__main__':
    main()
