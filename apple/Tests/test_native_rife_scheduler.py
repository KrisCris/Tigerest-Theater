#!/usr/bin/env python3
"""Compile and run the real native RIFE filter with a tiny host scheduling fixture.

    python3 apple/Tests/test_native_rife_scheduler.py
The suite verifies scheduling, speed bypass/recovery and the unchanged failure
latch. This is not a device performance test. The fake bridge does no CoreML
work and image buffers contain three marker samples, not
1080p pixels. Its image refs copy metadata/share pixel lifetime as mpv does.
ASan/UBSan and explicit live-allocation counts check the fixture-owned lifetimes.
All generated headers and the executable live in an automatically removed temp
directory. No Xcode project, generated resources, player profiles or device used.
"""
import argparse
import os
from pathlib import Path
import shlex
import subprocess
import tempfile

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
HEADERS = [
    "common/tags.h", "filters/filter_internal.h", "filters/user_filters.h",
    "video/fmt-conversion.h", "video/mp_image.h", "video/mp_image_pool.h",
    "video/sws_utils.h", "libavutil/pixfmt.h",
    "options/m_config_core.h", "options/options.h",
]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=ROOT / "apple/NativeRIFE/vf_tigerest_rife.c",
                        help="optional temporary source copy for mutation checks")
    args = parser.parse_args()
    with tempfile.TemporaryDirectory(prefix="tigerest-rife-scheduler-") as temporary:
        directory = Path(temporary)
        for name in HEADERS:
            header = directory / "include" / name
            header.parent.mkdir(parents=True, exist_ok=True)
            header.write_text('#include "native_rife_fixture.h"\n')
        executable = directory / "native-rife-scheduler-test"
        compile_command = [*shlex.split(os.environ.get("CC", "cc")), "-std=c11", "-O1", "-g",
                           "-Wall", "-Wextra", "-Werror", "-fsanitize=address,undefined",
                           "-fno-omit-frame-pointer", "-I", str(directory / "include"),
                           "-I", str(HERE), "-I", str(ROOT / "apple/NativeRIFE"),
                           str(args.source.resolve()), str(HERE / "native_rife_fixture.c"),
                           str(HERE / "native_rife_scheduler_test.c"), "-lm", "-o", str(executable)]
        print("Compile:", shlex.join(compile_command), flush=True)
        subprocess.run(compile_command, check=True)
        command = [str(executable)]
        environment = dict(os.environ)
        # Apple's ASan has no LeakSanitizer; the fixture checks all its own refs.
        environment["ASAN_OPTIONS"] = "detect_leaks=0:halt_on_error=1"
        environment["UBSAN_OPTIONS"] = "halt_on_error=1:print_stacktrace=1"
        return subprocess.run(command, env=environment).returncode


if __name__ == "__main__":
    raise SystemExit(main())
