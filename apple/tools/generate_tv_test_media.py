#!/usr/bin/env python3
"""Generate isolated TV UI media with video, audio and a Chinese subtitle track."""
import argparse
from pathlib import Path
import shutil
import subprocess
import tempfile

parser = argparse.ArgumentParser()
parser.add_argument("output", type=Path)
args = parser.parse_args()
ffmpeg = shutil.which("ffmpeg")
if not ffmpeg:
    parser.error("ffmpeg is required to generate test media")
if args.output.exists():
    parser.error("output already exists; choose a new test-media path")
if args.output.suffix.lower() != ".mp4":
    parser.error("output must have an .mp4 extension")
args.output.parent.mkdir(parents=True, exist_ok=True)
with tempfile.TemporaryDirectory(prefix="tigerest-tv-media-") as directory:
    subtitle = Path(directory) / "fixture.srt"
    subtitle.write_text("1\n00:00:00,000 --> 00:00:44,900\n电视字幕测试 / TV subtitle fixture\n", encoding="utf-8")
    subprocess.run([
        ffmpeg, "-hide_banner", "-loglevel", "error", "-nostdin", "-n",
        "-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=24",
        "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000",
        "-i", str(subtitle), "-t", "45", "-map", "0:v", "-map", "1:a", "-map", "2:0",
        "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac",
        "-c:s", "mov_text", "-metadata:s:s:0", "language=zho",
        "-metadata:s:s:0", "title=简体中文测试", "-disposition:s:0", "0", str(args.output),
    ], check=True)
