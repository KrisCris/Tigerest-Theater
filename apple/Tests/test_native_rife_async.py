#!/usr/bin/env python3
"""macOS-only integration with pinned MPVKit's real queues and a 50ms fake core.
--direct proves the regression: synchronously running that core blocks playback.
This verifies scheduling/lifetimes, not Core ML pixels or device presentation.
"""
import argparse, os, subprocess, sys, tempfile
from pathlib import Path
root = Path(__file__).resolve().parents[2]
p = argparse.ArgumentParser(); p.add_argument('--direct', action='store_true'); p.add_argument('--timing', action='store_true'); args = p.parse_args()
artifacts = root/'apple/DerivedData/SourcePackages/artifacts/mpvkit'
native = root/'apple/Generated/NativeRIFE'
if sys.platform != 'darwin':
    p.error('This integration test requires macOS and the pinned MPVKit macOS artifacts.')
if not (native/'source.json').is_file() or not artifacts.is_dir():
    p.error('Prepare native RIFE and resolve MPVKit into apple/DerivedData first; see apple/Probes/README.md.')
with tempfile.TemporaryDirectory(prefix='rife-async-test-') as tmp:
    tmp = Path(tmp)
    include = tmp/'include'; include.mkdir()
    for framework, header in [('Libavutil', 'libavutil'), ('Libplacebo', 'libplacebo')]:
        paths = list((artifacts/framework).glob('*.xcframework/macos-*/'+framework+'.framework/Headers'))
        assert len(paths) == 1, (framework, paths)
        (include/header).symlink_to(paths[0])
    cmd = ['xcrun', 'clang', '-std=gnu11', '-O1', '-g', '-Wall', '-Wextra', '-Werror',
           '-Wno-missing-field-initializers', '-Wno-unused-parameter', '-DHAVE_MAC_THREAD_NAME=1',
           '-fsanitize=address,undefined', '-fno-omit-frame-pointer',
           '-I'+str(native), '-I'+str(native/'mpv'), '-I'+str(include),
           str(root/'apple/Tests/native_rife_async_test.c')]
    if args.timing: cmd += ['-DTIGEREST_RIFE_TIMING=1']
    if args.direct: cmd += ['-DTEST_DIRECT_CORE=1']
    else: cmd += [str(root/'apple/NativeRIFE/vf_tigerest_rife_async.c')]
    for directory in sorted(artifacts.iterdir()):
        if directory.name.endswith('-GPL'): continue
        for framework in directory.glob('*.xcframework/macos-*/*.framework'):
            cmd += ['-F'+str(framework.parent), '-framework', framework.stem]
        cmd += [str(path) for path in directory.glob('*.xcframework/macos-*/*.a')]
    swift = Path(subprocess.check_output(['xcrun', '--find', 'swiftc'], text=True).strip())
    cmd += ['-L'+str(swift.parent.parent/'lib/swift/macosx')]
    for name in ['AVFoundation','CoreAudio','AudioToolbox','CoreVideo','CoreFoundation','CoreMedia',
                 'Metal','VideoToolbox','AppKit','IOKit','IOSurface','QuartzCore','Security','OpenGL']:
        cmd += ['-framework', name]
    cmd += ['-lbz2','-liconv','-lexpat','-lresolv','-lxml2','-lz','-lc++','-Wl,-dead_strip','-o',str(tmp/'test')]
    subprocess.run(cmd, check=True)
    env = dict(os.environ, ASAN_OPTIONS='detect_leaks=0:halt_on_error=1', UBSAN_OPTIONS='halt_on_error=1:print_stacktrace=1')
    raise SystemExit(subprocess.run([str(tmp/'test')], env=env, timeout=30).returncode)
