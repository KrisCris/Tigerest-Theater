// Manual headed Qt frame-clock probe; --assert-target is only for known Hz hardware.
// node tests/bench_frame_source.cjs <TigerestFrameProbe> --backend=metal --hz=120
const fs=require('node:fs'),http=require('node:http'),path=require('node:path');
const {spawn}=require('node:child_process');
const assert=require('node:assert/strict');
const {frameMetrics}=require('./frame_metrics.cjs');
const option=(name,fallback)=>process.argv.find(a=>a.startsWith('--'+name+'='))?.slice(name.length+3)??fallback;
(async()=>{
    const executable=path.resolve(process.argv[2]||'');
    assert.ok(fs.existsSync(executable),'supply the built TigerestFrameProbe');
    const backend=option('backend','metal'),hz=Number(option('hz',120));
    const lifecycle=process.argv.includes('--lifecycle');
    assert.ok(['metal','opengl'].includes(backend));
    let resolveResult,rejectResult,child,timeout,log='';
    const result=new Promise((resolve,reject)=>{resolveResult=resolve;rejectResult=reject;});
    const server=http.createServer(async(req,res)=>{
        if(req.url==='/result'){
            let body='';for await(const chunk of req)body+=chunk;
            try{resolveResult(JSON.parse(body));res.end('ok');}
            catch(error){rejectResult(error);res.writeHead(400);res.end();}
            return;
        }
        res.setHeader('Content-Type','text/html');
        res.end(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">
          <style>body{background:#162032;color:white;font:24px system-ui}
          #box{width:140px;height:140px;background:#dda84e;animation:move 2s infinite alternate linear}
          @keyframes move{to{transform:translateX(800px) rotate(180deg)}}</style>
          <h1>Isolated frame-clock probe</h1><div id="box"></div><pre id="count"></pre>
          <script>setTimeout(()=>{const intervals=[];let previous,start;
          function tick(t){start??=t;if(previous!==undefined)intervals.push(t-previous);previous=t;
            count.textContent='Frames: '+intervals.length;
            if(t-start<6000)requestAnimationFrame(tick);
            else fetch('/result',{method:'POST',body:JSON.stringify({intervals,visible:document.visibilityState,
              focus:document.hasFocus(),width:innerWidth,height:innerHeight,dpr:devicePixelRatio,ua:navigator.userAgent})});
          }requestAnimationFrame(tick)},1200)</script>`);
    });
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    try{
        child=spawn(executable,[],{env:{...process.env,PROBE_GRAPHICS_API:backend,
            PROBE_URL:'http://127.0.0.1:'+server.address().port},stdio:['pipe','pipe','pipe']});
        child.stdout.on('data',data=>log+=data);child.stderr.on('data',data=>log+=data);
        child.on('error',rejectResult);
        child.on('exit',code=>rejectResult(Error('probe exited before result: '+code+' '+log)));
        timeout=setTimeout(()=>rejectResult(Error('probe timeout: '+log)),18000);
        const sample=await result;
        clearTimeout(timeout);
        const frames=frameMetrics(sample.intervals,hz);
        // Ignore the first two-second window, which includes process/GPU startup.
        const windowSubmissions=[...log.matchAll(/windowSubmittedFps ([\d.]+)/g)].map(m=>Number(m[1])).slice(1);
        const lifecycleSubmissions={},lifecycleNativeStates={};
        if(lifecycle){
            for(const phase of ['idle','minimized','hidden','restored']){
                child.stdin.write(phase+'\n');
                await new Promise(resolve=>setTimeout(resolve,6500));
                // Ignore the first window while the visibility/animation state settles.
                lifecycleSubmissions[phase]=[...log.matchAll(new RegExp('windowSubmittedFps ([\\d.]+) phase '+phase,'g'))]
                    .map(m=>Number(m[1])).slice(1);
                lifecycleNativeStates[phase]=[...log.matchAll(new RegExp('phase '+phase+'[^\\n]*cocoaState (\\d+)','g'))]
                    .map(m=>Number(m[1])).slice(1);
            }
        }
        const report={...sample,backend,frames,windowSubmissions,lifecycleSubmissions,lifecycleNativeStates,log,
            measurement:'rAF timing and QQuickWindow submissions; not physical display presentation'};
        if(option('output',null))fs.writeFileSync(option('output'),JSON.stringify(report,null,2));
        console.log(JSON.stringify({backend,frames,windowSubmissions,lifecycleSubmissions,lifecycleNativeStates}));
        if(process.argv.includes('--assert-target')){
            assert.equal(sample.visible,'visible');assert.equal(sample.focus,true);
            assert.ok(frames.samples>=hz*5,'insufficient frames for target cadence');
            assert.ok(frames.callbackFps>=hz*.95&&!frames.overproducing,'callback cadence is capped or unbounded');
            assert.ok(frames.estimatedMissedRefreshes<=frames.samples*.02,'too many missed refresh opportunities');
            assert.ok(windowSubmissions.length>=2&&windowSubmissions.every(fps=>fps>=hz*.95&&fps<=hz*1.1),
                'Qt window submissions must follow the target cadence too');
        }
        if(lifecycle){
            assert.ok(lifecycleNativeStates.minimized.length&&lifecycleNativeStates.minimized.every(state=>state&2),
                'minimize was not exercised: the native Cocoa window never miniaturized');
            assert.ok(lifecycleNativeStates.hidden.length&&lifecycleNativeStates.hidden.every(state=>!(state&1)),
                'hide was not exercised: the native Cocoa window remained visible');
            for(const phase of ['idle','minimized','hidden']) assert.ok(lifecycleSubmissions[phase].length&&
                lifecycleSubmissions[phase].every(fps=>fps<=1),phase+' window keeps rendering');
            assert.ok(lifecycleSubmissions.restored.length&&lifecycleSubmissions.restored.every(fps=>fps>=hz*.95&&fps<=hz*1.1),
                'restored window must return to target cadence');
        }
    }finally{
        clearTimeout(timeout);
        if(child&&child.exitCode===null&&child.signalCode===null){
            const ended=new Promise(resolve=>child.once('exit',resolve));child.kill();await ended;
        }
        server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
    }
})().catch(error=>{console.error(error);process.exitCode=1;});
