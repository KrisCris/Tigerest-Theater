#!/usr/bin/env python3
"""Compare real Metal conversion with the pinned MPVKit swscale on macOS.
Requires the resolved MPVKit artifacts and a Metal-capable Mac. No player/device
settings or media are used; all pixels are deterministic synthetic fixtures.
"""
import os
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
ARTIFACTS = ROOT / 'apple/DerivedData/SourcePackages/artifacts/mpvkit'
with tempfile.TemporaryDirectory(prefix='rife-color-test-') as tmp:
    tmp = Path(tmp)
    include = tmp / 'include'; include.mkdir()
    frameworks = []
    for name, header in [('Libavutil', 'libavutil'), ('Libswscale', 'libswscale')]:
        paths = list((ARTIFACTS / name).glob('*.xcframework/macos-*/*.framework'))
        if len(paths) != 1:
            raise SystemExit('Resolve the pinned MPVKit macOS artifacts before running this test.')
        (include / header).symlink_to(paths[0] / 'Headers')
        frameworks += ['-F' + str(paths[0].parent), '-framework', name]
    cmd = ['xcrun', 'clang++', '-std=c++17', '-O2', '-g', '-fobjc-arc',
           '-Wall', '-Wextra', '-Werror', '-fsanitize=address,undefined',
           '-I' + str(include), '-I' + str(ROOT / 'apple/NativeRIFE'),
           str(ROOT / 'apple/Tests/native_rife_color_test.mm'),
           str(ROOT / 'apple/NativeRIFE/RifeColorConverter.mm'), *frameworks]
    for framework in ['Foundation', 'Metal', 'CoreFoundation', 'CoreVideo', 'VideoToolbox', 'CoreMedia']:
        cmd += ['-framework', framework]
    cmd += ['-Wl,-dead_strip', '-o', str(tmp / 'test')]
    subprocess.run(cmd, check=True)
    env = dict(os.environ, ASAN_OPTIONS='detect_leaks=0:halt_on_error=1', UBSAN_OPTIONS='halt_on_error=1')
    subprocess.run([str(tmp / 'test')], env=env, check=True, timeout=90)
