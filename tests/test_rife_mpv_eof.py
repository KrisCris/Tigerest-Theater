"""Actual mpv/VapourSynth streaming EOF protocol; requires an explicit test binary."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest


def quote_option(value):
    return f"%{len(value.encode('utf-8'))}%{value}"


@unittest.skipUnless(os.environ.get('RIFE_MPV_BINARY'), 'set RIFE_MPV_BINARY for streaming integration')
class StreamingEofTests(unittest.TestCase):
    def test_last_frame_marker_precedes_end_of_stream(self):
        with tempfile.TemporaryDirectory(prefix='rife 流式 EOF ') as tmp:
            root = Path(tmp)
            video, script, report = root/'clip.mkv', root/'inspect.vpy', root/'frames.jsonl'
            subprocess.run(['ffmpeg','-v','error','-f','lavfi','-i','testsrc2=size=128x128:rate=24000/1001',
                            '-frames:v','3','-c:v','ffv1','-color_primaries','bt709',
                            '-color_trc','bt709','-colorspace','bt709',str(video)],check=True,timeout=30)
            script.write_text('''import vapoursynth as vs
import json

def inspect(n,f):
    with open(user_data,'a') as out:
        out.write(json.dumps({'n':n,'last':int(f.props.get('_TigerestLastFrame',-1)),
                             'matrix':f.props.get('_Matrix',-1),'transfer':f.props.get('_Transfer',-1),
                             'primaries':f.props.get('_Primaries',-1)})+'\\n')
    return f
vs.core.std.ModifyFrame(video_in,clips=video_in,selector=inspect).set_output()
''')
            vf = ('vapoursynth=file='+quote_option(str(script))+':user-data='+quote_option(str(report))+
                  ':eof-aware=yes:buffered-frames=4:concurrent-frames=2')
            run=subprocess.run([os.environ['RIFE_MPV_BINARY'],'--no-config','--vo=null','--ao=null',
                                '--vf='+vf,str(video)],text=True,capture_output=True,timeout=30)
            self.assertEqual(run.returncode,0,run.stdout+run.stderr)
            rows=[json.loads(line) for line in report.read_text().splitlines()]
            self.assertEqual(sorted((row['n'],row['last']) for row in rows),[(0,0),(1,0),(2,1)])
            self.assertTrue(all((r['matrix'],r['transfer'],r['primaries'])==(1,1,1) for r in rows),rows)

if __name__=='__main__': unittest.main()
