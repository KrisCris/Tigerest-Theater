#!/usr/bin/env python3
"""Create an isolated synthetic corpus for tests/bench_image_bitmap.cjs.

Requires Pillow. Optional ICC input stays in the generated local corpus; it is
not copied into the repository. Never point --output at a directory with files.
"""
import argparse
import random
from pathlib import Path
from PIL import Image, ImageCms, ImageDraw

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--output', type=Path, required=True)
parser.add_argument('--icc-profile', type=Path)
args = parser.parse_args()
args.output.mkdir(parents=True, exist_ok=True)
if any(args.output.iterdir()):
    parser.error('--output must be empty')

width, height = 3072, 2048
random_source = random.Random(7)
row = bytes(random_source.randrange(256) for _ in range(width * 3))
raw = b''.join(bytes((value + y * 7) % 256 for value in row) for y in range(height))
Image.frombytes('RGB', (width, height), raw).save(
    args.output / 'large.jpg', quality=93, subsampling=0)

alpha = Image.new('RGBA', (96, 64))
alpha.putdata([((x * 11) % 256, (y * 13) % 256, (x * 3 + y * 5) % 256,
                (x * 7 + y * 9) % 256) for y in range(64) for x in range(96)])
alpha.save(args.output / 'alpha.png')
profile = (args.icc_profile.read_bytes() if args.icc_profile else
           ImageCms.ImageCmsProfile(ImageCms.createProfile('sRGB')).tobytes())
alpha.save(args.output / 'wide.png', icc_profile=profile)

orientation = Image.new('RGB', (128, 96))
draw = ImageDraw.Draw(orientation)
for x, y, color in [(0, 0, 'red'), (64, 0, 'green'), (0, 48, 'blue'), (64, 48, 'yellow')]:
    draw.rectangle([x, y, x + 63, y + 47], fill=color)
exif = Image.Exif()
exif[274] = 6
orientation.save(args.output / 'orientation.jpg', quality=92, exif=exif)

sixteen = Image.new('I;16', (96, 64))
sixteen.putdata([(i * 103) % 65536 for i in range(96 * 64)])
sixteen.save(args.output / 'sixteen.png')
Image.new('RGB', (64, 48), 'red').save(
    args.output / 'animated.gif', save_all=True,
    append_images=[Image.new('RGB', (64, 48), 'blue')], duration=80, loop=0)
print('Created synthetic JPEG, alpha, ICC, EXIF, 16-bit and animated fixtures.')
