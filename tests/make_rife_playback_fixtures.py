#!/usr/bin/env python3
"""Reproducible local A/V acceptance and unsupported-source fixtures."""
import argparse
import json
from pathlib import Path
import subprocess
import tempfile


def run(*args):
    subprocess.run(['ffmpeg','-v','error','-y',*map(str,args)],check=True)


def generate(root):
    root.mkdir(parents=True,exist_ok=True)
    color='setparams=range=limited:color_primaries=bt709:color_trc=bt709:colorspace=bt709'
    pulse=r'aevalsrc=if(lt(mod(t\,1)\,0.033333)\,0.1*sin(2*PI*1000*t)\,0):s=48000:d=612'
    with tempfile.TemporaryDirectory(prefix='rife-fixture-') as tmp:
        segment=Path(tmp)/'segment.mp4'
        run('-f','lavfi','-i','testsrc2=size=1920x1080:rate=30:duration=12',
            '-vf',"drawbox=x=0:y=0:w=160:h=160:color=white:t=fill:enable='lt(mod(t,1),0.033333)',"+color,
            '-an','-c:v','libx264','-preset','veryfast','-crf','18','-pix_fmt','yuv420p',segment)
        # Loop only video: repeated AAC segments introduce encoder-padding gaps.
        run('-stream_loop','50','-i',segment,'-f','lavfi','-i',pulse,
            '-map','0:v','-map','1:a','-c:v','copy','-c:a','aac','-b:a','128k','-ac','2',
            '-t','612',root/'acceptance-1080p30.mp4')
        run('-i',root/'acceptance-1080p30.mp4','-t','12','-c','copy',root/'supported.mp4')
    run('-f','lavfi','-i','color=white:size=640x480:rate=30:duration=4',
        '-vf',"drawbox=x=0:y=0:w=iw:h=ih:color=black:t=fill:enable='eq(n,0)',"+color,
        '-c:v','ffv1','-pix_fmt','yuv420p',root/'opening-cut.mkv')
    cases={
        'hdr':('640x360',24,'setparams=range=limited:color_primaries=bt2020:color_trc=smpte2084:colorspace=bt2020nc','yuv420p10le'),
        '4k':('3840x2160',24,color,'yuv420p'),
        'high-fps':('640x360',60,color,'yuv420p'),
        'unknown':('640x360',24,'setparams=range=limited:color_primaries=unknown:color_trc=unknown:colorspace=unknown','yuv420p'),
        'vfr':('640x360',30,"select='not(eq(mod(n,10),5))',"+color,'yuv420p'),
    }
    for name,(size,fps,filters,fmt) in cases.items():
        run('-f','lavfi','-i',f'testsrc2=size={size}:rate={fps}:duration=12',
            '-vf',filters,'-fps_mode','vfr','-c:v','ffv1','-pix_fmt',fmt,root/(name+'.mkv'))
    report={}
    for file in sorted(root.iterdir()):
        if file.suffix not in ('.mp4','.mkv'):continue
        report[file.name]=json.loads(subprocess.check_output(['ffprobe','-v','error','-show_streams','-show_format','-of','json',str(file)]))
    (root/'fixtures.json').write_text(json.dumps(report,indent=2)+'\n')


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('output',type=Path)
    generate(parser.parse_args().output)
