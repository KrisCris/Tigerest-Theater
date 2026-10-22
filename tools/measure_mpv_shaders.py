#!/usr/bin/env python3
"""Measure the per-frame GPU time of every bundled shader with mpv gpu-next.

Plays a synthetic 4:2:0 test pattern scaled to a 1920x1080 window (1.8x
upscale; downscalers get a 4K source instead), reads mpv's own render pass
timings (vo-passes) and subtracts the same run without a shader. The result
is written to resources/mpvconf/shader-timings.json; re-run
tools/generate_mpv_shader_catalog.py afterwards to fold it into the catalog.

Opens a visible mpv window for each shader. Numbers are for the machine that
ran it only.

    python3 tools/measure_mpv_shaders.py [--mpv /path/to/mpv] [--only Anime4K]
"""
import argparse
import json
import platform
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SHADERS = ROOT / "resources/mpv/shaders"
OUTPUT = ROOT / "resources/mpvconf/shader-timings.json"

MEASURE_LUA = r"""
local utils = require('mp.utils')
local function sum(list)
  local total = 0
  for _, pass in ipairs(list or {}) do total = total + (pass.avg or 0) end
  return total
end
mp.register_event('file-loaded', function()
  mp.add_timeout(tonumber(mp.get_opt('measure-seconds') or '4'), function()
    local passes = mp.get_property_native('vo-passes') or {}
    local dims = mp.get_property_native('osd-dimensions') or {}
    io.stdout:write('MEASURE ' .. utils.format_json({
      fresh_ns = sum(passes.fresh), count = #(passes.fresh or {}),
      width = dims.w, height = dims.h,
      shaders = #(mp.get_property_native('glsl-shaders') or {}),
    }) .. '\n')
    io.stdout:flush()
    mp.command('quit')
  end)
end)
"""


def device_name():
    if platform.system() == "Darwin":
        cpu = subprocess.run(["sysctl", "-n", "machdep.cpu.brand_string"], capture_output=True, text=True).stdout.strip()
        return f"{cpu}，macOS {platform.mac_ver()[0]}，mpv gpu-next"
    return f"{platform.processor() or platform.machine()}，{platform.system()} {platform.release()}，mpv gpu-next"


def run(mpv, script, shader, source_size, seconds):
    width, height = source_size
    url = f"av://lavfi:testsrc2=size={width}x{height}:rate=24,format=yuv420p"
    args = [mpv, "--no-config", "--vo=gpu-next", "--hwdec=no", "--ao=null", "--really-quiet",
            "--geometry=1920x1080", "--hidpi-window-scale=no", "--keepaspect-window=no", "--force-window=immediate",
            "--profile=high-quality", "--osd-level=0", f"--script={script}",
            f"--script-opts=measure-seconds={seconds}", "--length=60"]
    if shader:
        args.append(f"--glsl-shaders={shader}")
    args.append(url)
    result = subprocess.run(args, capture_output=True, text=True, timeout=seconds + 30)
    for line in (result.stdout + result.stderr).splitlines():
        if line.startswith("MEASURE "):
            return json.loads(line[8:])
    raise RuntimeError(f"no measurement for {shader}: {result.stderr[-400:]}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--mpv", default="mpv")
    parser.add_argument("--only", default="")
    parser.add_argument("--seconds", type=float, default=4)
    args = parser.parse_args()
    catalog = json.loads((ROOT / "resources/mpvconf/shaders.json").read_text())
    with tempfile.TemporaryDirectory() as folder:
        script = Path(folder) / "measure.lua"
        script.write_text(MEASURE_LUA)
        sizes = {"up": (1066, 600), "down": (3840, 2160)}
        baselines = {kind: run(args.mpv, script, None, size, args.seconds) for kind, size in sizes.items()}
        print("baseline", baselines, flush=True)
        results = json.loads(OUTPUT.read_text()).get("results", {}) if OUTPUT.exists() and args.only else {}
        for shader in catalog["shaders"]:
            if args.only and not shader["path"].startswith(args.only):
                continue
            kind = "down" if shader["trigger"] == "只在缩小时运行" else "up"
            measured = run(args.mpv, script, SHADERS / shader["path"], sizes[kind], args.seconds)
            delta = max(0.0, (measured["fresh_ns"] - baselines[kind]["fresh_ns"]) / 1e6)
            results[shader["path"]] = round(delta, 2)
            print(f"{shader['path']}: {results[shader['path']]} ms ({measured})", flush=True)
    OUTPUT.write_text(json.dumps({
        "device": device_name(),
        "method": "mpv gpu-next 渲染 1920×1080 窗口；放大类用 1066×600 4:2:0 测试图（约 1.8 倍），缩小类用 3840×2160；"
                  "数值为每帧 GPU 渲染耗时减去不加着色器时的耗时（vo-passes 平均值）。",
        "baseline": baselines,
        "results": results,
    }, ensure_ascii=False, indent=2) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
