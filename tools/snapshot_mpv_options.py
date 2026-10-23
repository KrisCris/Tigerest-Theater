#!/usr/bin/env python3
"""Snapshot libmpv's option table for the mpv.conf editor's offline checks.

The client refreshes this table from the running player at every start and
keeps it in its config directory. The bundled snapshot covers the first start
and the unit tests, before any player has run.

    python3 tools/snapshot_mpv_options.py /path/to/libmpv.dylib
"""
import ctypes
import json
import sys
from pathlib import Path

OUTPUT = Path(__file__).resolve().parents[1] / "resources/mpvconf/mpv-options.json"


def main():
    if len(sys.argv) != 2:
        print(__doc__, file=sys.stderr)
        return 2
    lib = ctypes.CDLL(sys.argv[1])
    lib.mpv_create.restype = ctypes.c_void_p
    lib.mpv_get_property_string.restype = ctypes.c_void_p

    def read(handle, name):
        pointer = lib.mpv_get_property_string(handle, name.encode())
        if not pointer:
            return None
        value = ctypes.string_at(pointer).decode()
        lib.mpv_free(ctypes.c_void_p(pointer))
        return value

    handle = ctypes.c_void_p(lib.mpv_create())
    for key, value in ((b"config", b"no"), (b"vo", b"null"), (b"ao", b"null"), (b"idle", b"yes")):
        lib.mpv_set_option_string(handle, key, value)
    if lib.mpv_initialize(handle) < 0:
        print("mpv_initialize failed", file=sys.stderr)
        return 1
    options = {}
    for name in sorted(read(handle, "options").split(",")):
        info = json.loads(read(handle, f"option-info/{name}") or "{}")
        entry = {"type": info.get("type", "")}
        for key in ("choices", "min", "max"):
            if key in info:
                entry[key] = info[key]
        options[name] = entry
    version = read(handle, "mpv-version")
    lib.mpv_terminate_destroy(handle)
    OUTPUT.write_text(json.dumps({"mpvVersion": version, "options": options},
                                 ensure_ascii=False, separators=(",", ":")) + "\n")
    print(f"{len(options)} options from {version}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
