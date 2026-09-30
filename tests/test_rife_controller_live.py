"""Drive the application controller against real libmpv and native inference."""
import os
from pathlib import Path
import subprocess
import tempfile
import sys

with tempfile.TemporaryDirectory(prefix='rife-controller-',dir='/tmp') as tmp:
    clip=Path(tmp)/'原片 测试.mkv'
    subprocess.run(['ffmpeg','-v','error','-f','lavfi','-i',
        'nullsrc=size=128x128:rate=24,geq=lum=16+N:cb=128:cr=128',
        '-frames:v','192','-c:v','ffv1','-pix_fmt','yuv420p',
        '-vf','setparams=range=limited:color_primaries=bt709:color_trc=bt709:colorspace=bt709','-color_range','tv','-color_primaries','bt709','-color_trc','bt709','-colorspace','bt709',str(clip)],check=True,timeout=30)
    subprocess.run([sys.argv[1],os.environ['RIFE_SMALL_MODEL'],os.environ['RIFE_VS_PLUGIN'],
        str(Path(__file__).resolve().parents[1]/'resources/mpv/rife/interpolate.vpy'),str(clip)],check=True,timeout=45)
