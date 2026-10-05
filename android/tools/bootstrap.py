"""Prepare portable Android dependencies and verify the bundled mpv runtime."""
import concurrent.futures, hashlib, json, os, pathlib, shutil, struct, subprocess, sys, urllib.request, zipfile

ROOT = pathlib.Path(__file__).resolve().parents[1]
CACHE = pathlib.Path(os.environ.get('TIGEREST_ANDROID_DEPS', 'D:/CodexDeps/TigerestTheater/android'))
TAG = '2026-09-17'
RUNTIME = {
    'url': f'https://github.com/mpv-android/mpv-android/releases/download/{TAG}/app-default-universal-release.apk',
    'sha256': 'c3b505e45b919b767b9867e7f0d16fd823d77bc7c9a6e6b181b80ea60c018a70',
}

def read(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent':'Tigerest-Android-Build'}), timeout=120) as response:
        return response.read()

def download(name, info):
    CACHE.mkdir(parents=True, exist_ok=True)
    path = CACHE / name
    if path.exists() and hashlib.sha256(path.read_bytes()).hexdigest() == info['sha256']:
        return path
    temporary = path.with_suffix(path.suffix + '.partial')
    print('Downloading', name, flush=True)
    with urllib.request.urlopen(urllib.request.Request(info['url'], headers={'User-Agent':'Tigerest-Android-Build'}), timeout=120) as response, temporary.open('wb') as output:
        shutil.copyfileobj(response, output)
    digest = hashlib.sha256(temporary.read_bytes()).hexdigest()
    if digest != info['sha256']:
        raise RuntimeError(f'Checksum mismatch for {name}: {digest}')
    temporary.replace(path)
    print('Verified', name, flush=True)
    return path

def extract(path, destination):
    destination.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(path) as archive:
        for entry in archive.infolist():
            resolved = (destination / entry.filename).resolve()
            if not resolved.is_relative_to(destination.resolve()):
                raise RuntimeError('Unsafe archive entry')
        archive.extractall(destination)

def elf_alignment(data):
    if data[:4] != b'\x7fELF' or data[4] != 2 or data[5] != 1:
        raise RuntimeError('Expected little-endian ELF64')
    offset = struct.unpack_from('<Q', data, 32)[0]
    size, count = struct.unpack_from('<HH', data, 54)
    alignments = [struct.unpack_from('<Q', data, offset + i * size + 48)[0]
                  for i in range(count) if struct.unpack_from('<I', data, offset + i * size)[0] == 1]
    if not alignments or min(alignments) < 16384:
        raise RuntimeError(f'Native runtime is not 16KB aligned: {alignments}')
    return alignments

def native_runtime(apk):
    records = []
    with zipfile.ZipFile(apk) as archive:
        for name in archive.namelist():
            if name.startswith(('lib/arm64-v8a/', 'lib/x86_64/')) and name.endswith('.so'):
                data = archive.read(name)
                alignments = elf_alignment(data)
                target = ROOT / 'app/src/main/jniLibs' / pathlib.PurePosixPath(name).relative_to('lib')
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(data)
                records.append({'path':name, 'sha256':hashlib.sha256(data).hexdigest(), 'loadSegmentAlignment':alignments})
            elif name.startswith('assets/') and any(word in name for word in ('cacert', '.ttf', '.otf')):
                target = ROOT / 'app/src/main' / name
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(archive.read(name))
    sources = ['app/src/main/java/is/xyz/mpv/MPVLib.kt', 'LICENSE']
    for source in sources:
        data = read(f'https://raw.githubusercontent.com/mpv-android/mpv-android/{TAG}/{source}')
        if source.endswith('.kt') and hashlib.sha256(data).hexdigest() != 'bcc2e35e50e15597e0106b4851357907328e3bf331b41c1fd58bb75906bfaa97':
            raise RuntimeError('JNI binding checksum mismatch')
        target = (ROOT / 'app/src/main/java/is/xyz/mpv/MPVLib.kt' if source.endswith('.kt')
                  else ROOT / 'app/src/main/assets/licenses/mpv-android-MIT.txt')
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
    (ROOT / 'native-runtime.lock.json').write_text(json.dumps({'upstream':'https://github.com/mpv-android/mpv-android', 'tag':TAG, 'artifact':RUNTIME, 'libraries':records}, indent=2), encoding='utf-8')
    print('Native runtime verified:', len(records), 'ELF64 libraries', flush=True)

def main():
    dependencies = json.loads((ROOT / 'toolchain.lock.json').read_text(encoding='utf-8-sig'))
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        paths = dict(zip(dependencies, pool.map(lambda item: download(*item), dependencies.items())))
    for filename, dirname in [('jdk.zip','java'),('gradle.zip','gradle')]:
        destination = CACHE / dirname
        if not destination.exists(): extract(paths[filename], destination)
    sdk = CACHE / 'sdk'
    sdkmanager = sdk / 'cmdline-tools/latest/bin/sdkmanager.bat'
    if not sdkmanager.exists(): extract(paths['command-tools.zip'], sdk / 'cmdline-tools/latest-parent')
    if not sdkmanager.exists(): shutil.move(str(sdk / 'cmdline-tools/latest-parent/cmdline-tools'), str(sdk / 'cmdline-tools/latest'))
    java = next((CACHE / 'java').glob('*/bin/java.exe')).parent.parent
    env = dict(os.environ, JAVA_HOME=str(java), ANDROID_HOME=str(sdk))
    subprocess.run([str(sdkmanager),f'--sdk_root={sdk}','--licenses'], input=('y\n'*80).encode(), env=env, check=True, stdout=subprocess.DEVNULL)
    subprocess.run([str(sdkmanager),f'--sdk_root={sdk}','platform-tools','platforms;android-36','build-tools;36.0.0'], env=env, check=True)
    native_runtime(paths['mpv.apk'])
    (ROOT / 'local.properties').write_text('sdk.dir=' + str(sdk).replace('\\','/').replace(':','\\:') + '\n', encoding='utf-8')
    (CACHE / 'dependencies.lock.json').write_text(json.dumps(dependencies, indent=2), encoding='utf-8')
    print('JAVA_HOME='+str(java), flush=True)
    print('GRADLE='+str(CACHE / 'gradle/gradle-8.13/bin/gradle.bat'), flush=True)

if __name__ == '__main__': main()
