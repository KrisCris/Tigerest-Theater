"""Private mpv IPC test for reset, pause/resume and changing source dimensions."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest
from test_rife_mpv_eof import quote_option

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'dev/macos/rife'))
from benchmark_render_load import Renderer


@unittest.skipUnless(all(os.environ.get(k) for k in ('RIFE_MPV_BINARY','RIFE_VS_PLUGIN','RIFE_SMALL_MODEL')),
                     'requires explicit native mpv/plugin/model paths')
class StreamLifecycleTests(unittest.TestCase):
    def test_seek_pause_and_format_reload_use_new_filter_state(self):
        repository=Path(__file__).resolve().parents[1]
        with tempfile.TemporaryDirectory(prefix='rife-lifecycle-',dir='/tmp') as tmp:
            root=Path(tmp)
            for name,width,height,base in [('first',128,128,16),('second',96,80,100)]:
                subprocess.run(['ffmpeg','-v','error','-f','lavfi','-i',
                    f'nullsrc=size={width}x{height}:rate=24,geq=lum={base}+N:cb=128:cr=128',
                    '-frames:v','192' if name=='first' else '24','-c:v','ffv1','-pix_fmt','yuv420p',
                    '-vf','setparams=range=limited:color_primaries=bt709:color_trc=bt709:colorspace=bt709','-color_range','tv','-color_primaries','bt709','-color_trc','bt709','-colorspace','bt709',
                    str(root/(name+'.mkv'))],check=True,timeout=30)
            report,script=root/'frames.jsonl',root/'bridge.vpy'
            script.write_text('''import vapoursynth as vs
import json,runpy,time
settings=json.loads(user_data)
epoch=time.monotonic_ns()
def record(row):
    with open(settings['report'],'a') as log:log.write(json.dumps(dict(row,epoch=epoch))+'\\n')
record({'kind':'init','width':video_in.width,'height':video_in.height})
output=runpy.run_path(settings['script'])['build_rife_filter'](video_in,settings['options'])
def inspect(n,f):
    record({'kind':'frame','n':n,'width':f.width,'first_y':bytes(f[0])[0],
            'synth':f.props.get('_TigerestRifeSynthesized',0),'reason':f.props.get('_TigerestRifeReason','')})
    return f
vs.core.std.ModifyFrame(output,clips=output,selector=inspect).set_output()
''')
            options={'plugin_path':str(Path(os.environ['RIFE_VS_PLUGIN']).resolve()),
                     'model_path':str(Path(os.environ['RIFE_SMALL_MODEL']).resolve()),
                     'fps_num':24,'fps_den':1,'streaming':True}
            data=json.dumps({'options':options,'script':str(repository/'resources/mpv/rife/interpolate.vpy'),'report':str(report)})
            vf='vapoursynth=file='+quote_option(str(script))+':user-data='+quote_option(data)+':eof-aware=yes:buffered-frames=4:concurrent-frames=2'
            socket=root/'ipc.sock'
            def rows():
                return [json.loads(line) for line in report.read_text().splitlines()] if report.exists() else []
            def wait_for(predicate):
                deadline=time.monotonic()+10
                while time.monotonic()<deadline:
                    self.assertIsNone(process.poll(),(root/'mpv.log').read_text())
                    try:
                        if predicate():return
                    except (RuntimeError,KeyError,json.JSONDecodeError):
                        pass
                    time.sleep(.025)
                self.fail('Private playback condition timed out: '+(root/'mpv.log').read_text())
            with (root/'mpv.log').open('w') as log:
                process=subprocess.Popen([os.environ['RIFE_MPV_BINARY'],'--no-config','--vo=null','--ao=null',
                    '--pause','--idle=yes','--keep-open=yes','--input-ipc-server='+str(socket),
                    '--vf='+vf,str(root/'first.mkv')],stdout=log,stderr=log)
                client=None
                try:
                    wait_for(socket.exists)
                    client=Renderer(socket)
                    wait_for(lambda:client.command('get_property','time-pos') is not None)
                    client.command('set_property','pause',False)
                    wait_for(lambda:client.command('get_property','time-pos')>.15)
                    initial=[r for r in rows() if r['kind']=='init'][-1]['epoch']
                    client.command('seek',3,'absolute+exact')
                    wait_for(lambda:client.command('get_property','time-pos')>=2.99)
                    client.command('set_property','pause',True)
                    wait_for(lambda:any(r['kind']=='frame' and r['epoch']!=initial for r in rows()))
                    latest=[r for r in rows() if r['kind']=='init'][-1]['epoch']
                    seek_frames=[r for r in rows() if r['kind']=='frame' and r['epoch']==latest]
                    self.assertGreaterEqual(min(r['first_y'] for r in seek_frames),87,seek_frames)
                    position=client.command('get_property','time-pos')
                    time.sleep(.15)
                    self.assertAlmostEqual(client.command('get_property','time-pos'),position,places=3)
                    client.command('loadfile',str(root/'second.mkv'),'replace')
                    wait_for(lambda:client.command('get_property','video-params/w')==96)
                    client.command('set_property','pause',False)
                    wait_for(lambda:any(r['kind']=='frame' and r['width']==96 and r['synth']==1 for r in rows()))
                    new_init=[r for r in rows() if r['kind']=='init'][-1]
                    self.assertNotEqual(new_init['epoch'],latest)
                    self.assertEqual((new_init['width'],new_init['height']),(96,80))
                    client.socket.sendall((json.dumps({'command':['quit']})+'\n').encode())
                    self.assertEqual(process.wait(timeout=10),0)
                finally:
                    if client:
                        client.reader.close();client.socket.close()
                    if process.poll() is None:
                        process.terminate()
                        try:process.wait(timeout=10)
                        except subprocess.TimeoutExpired:process.kill();process.wait(timeout=5)


if __name__=='__main__':unittest.main()
