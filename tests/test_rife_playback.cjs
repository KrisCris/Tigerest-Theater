'use strict';

// The real Qt WebChannel, networking stack and Chromium page are exercised
// against a loopback fixture. No user's profile or Emby account is touched.
const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const http = require('node:http');
const net = require('node:net');
const { randomUUID } = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');

async function until(check, label) {
    for (let i = 0; i < 150; i++) {
        const value = await check();
        if (value) return value;
        await delay(100);
    }
    throw new Error(`Timed out: ${label}`);
}
async function listen(server) {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    return server.address().port;
}
async function devtools(url) {
    const socket = new WebSocket(url);
    await new Promise((resolve, reject) => {
        socket.addEventListener('open', resolve, { once: true });
        socket.addEventListener('error', reject, { once: true });
    });
    let id = 0;
    const pending = new Map();
    socket.addEventListener('message', event => {
        const message = JSON.parse(event.data);
        const entry = pending.get(message.id);
        if (!entry) return;
        pending.delete(message.id);
        clearTimeout(entry.timer);
        if (message.error) entry.reject(new Error(JSON.stringify(message.error)));
        else entry.resolve(message.result);
    });
    const send = (method, params = {}) => new Promise((resolve, reject) => {
        const requestId = ++id;
        const timer = setTimeout(() => {
            pending.delete(requestId);
            reject(new Error(`${method} timed out`));
        }, 10000);
        pending.set(requestId, { resolve, reject, timer });
        socket.send(JSON.stringify({ id: requestId, method, params }));
    });
    return {
        send,
        async evaluate(expression) {
            const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
            assert.ok(!result.exceptionDetails, JSON.stringify(result.exceptionDetails));
            return result.result.value;
        },
        close() { socket.close(); },
    };
}

(async () => {
    const originalExecutable=path.resolve(process.argv[2]);
    const clip=path.resolve(process.argv[3]);
    const output=path.resolve(process.argv[4]);
    const seconds=Number(process.argv[5]||600);
    const baseline=process.argv[6]==='baseline';
    const pausedStart=process.argv[6]==='paused';
    const root=fs.mkdtempSync(path.join(os.tmpdir(),'tigerest-rife-player-'));
    const installed=path.join(root,'Applications','Tigerest Theater.app');
    fs.mkdirSync(path.dirname(installed));
    assert.equal(spawnSync('ditto',[path.dirname(path.dirname(path.dirname(originalExecutable))),installed]).status,0);
    const executable=path.join(installed,'Contents/MacOS/Tigerest Theater');
    const id=randomUUID().replaceAll('-',''), profile=path.join(root,'profiles',id);
    fs.mkdirSync(profile,{recursive:true});
    fs.mkdirSync(path.dirname(output),{recursive:true});
    const ipcPath=path.join(root,'private.sock');
    fs.writeFileSync(path.join(profile,'profile.json'),JSON.stringify({name:id}));
    fs.writeFileSync(path.join(profile,'Tigerest Theater.conf'),JSON.stringify({version:10,sections:{
        video:{aiRife:!baseline},mpv:{configMode:'embedded',renderBackend:'gpu-next',shaderPreset:'default'},
        other:{other_conf:`input-ipc-server=${ipcPath}\ngeometry=2560x1440\nhidpi-window-scale=no\nfullscreen=no\nmute=yes`}
    }}));
    const reservation=net.createServer();const port=await listen(reservation);
    await new Promise(resolve=>reservation.close(resolve));
    const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>!k.startsWith('PYTHON')&&!k.startsWith('DYLD_')&&!k.startsWith('VSSCRIPT')&&!k.startsWith('TIGEREST_')&&!k.startsWith('QT_')&&!k.startsWith('QML_')&&!k.startsWith('VK_')));
    env.PATH='/usr/bin:/bin:/usr/sbin:/sbin';
    const log=fs.openSync(output+'.app.log','w');
    const child=spawn(executable,['--log-level','warn','--config-dir',root,'--profile',id,'--remote-debugging-port',`127.0.0.1:${port}`],{env,stdio:['ignore',log,log]});
    let cdp,ipc;const samples=[];let result={seconds,baseline,clip,executable,samples};
    try {
        const target=await until(async()=>{
            assert.equal(child.exitCode,null,'app exited');
            try {return (await(await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t=>t.type==='page');}catch{return null;}
        },'app devtools');
        cdp=await devtools(target.webSocketDebuggerUrl);
        await until(()=>cdp.evaluate('Boolean(window.api && window.api.player)'),'native player API');
        await until(()=>fs.existsSync(ipcPath),'private IPC');
        ipc=net.createConnection(ipcPath);await new Promise((resolve,reject)=>{ipc.once('connect',resolve);ipc.once('error',reject);});
        let buffer='',sequence=0;const pending=new Map();
        ipc.on('data',data=>{buffer+=data;let end;while((end=buffer.indexOf('\n'))>=0){
            const message=JSON.parse(buffer.slice(0,end));buffer=buffer.slice(end+1);
            const item=pending.get(message.request_id);if(item){clearTimeout(item.timer);pending.delete(message.request_id);item.resolve(message.error==='success'?message.data:null);}
        }});
        const cmd=(...command)=>new Promise((resolve,reject)=>{const request_id=++sequence;
            const timer=setTimeout(()=>{pending.delete(request_id);reject(new Error(`IPC timeout ${command}`));},10000);
            pending.set(request_id,{resolve,timer});ipc.write(JSON.stringify({command,request_id})+'\n');});
        await cdp.evaluate(`window.api.player.setVideoOnlyMode(true); window.api.player.load(${JSON.stringify(pathToFileURL(clip).href)},{autoplay:${!pausedStart},startMilliseconds:0},{type:'video',title:'RIFE isolated acceptance'},1,-1)`);
        await until(async()=>(await cmd('get_property','time-pos'))!==null,'first rendered frame');
        const properties=['seeking','cache-buffering-state','paused-for-cache','speed','video-speed-correction','audio-speed-correction','display-fps','time-pos','avsync','frame-drop-count','decoder-frame-drop-count','estimated-vf-fps','estimated-display-fps','vo-delayed-frame-count','osd-dimensions','video-out-params','current-vo','current-gpu-context','hwdec-current','current-ao','pause','core-idle'];
        const sample=async()=>{
            const d=await cdp.evaluate('window.api.player.mpvDiagnostics()');
            const metrics=Object.fromEntries(await Promise.all(properties.map(async key=>[key,await cmd('get_property',key)])));
            const value={clock:Date.now(),rife:d.rife,metrics};samples.push(value);return value;
        };
        if(pausedStart){
            await until(async()=>{const s=await sample();return s.rife.generatedFrames>0;},'paused model preparation');
            await cdp.evaluate('window.api.player.play()');
        }
        await until(async()=>{
            const s=await sample();
            assert.ok(![3,4].includes(s.rife.state),JSON.stringify(s.rife));
            return baseline?s.rife.state===0:s.rife.state===2&&s.rife.generatedFrames>30;
        },'active interpolation after warmup');
        await delay(3000);
        const start=await sample();
        result.metadata=await cdp.evaluate('window.api.player.mpvDiagnostics()');
        result.renderPasses=await cmd('get_property','vo-passes');
        assert.equal(start.metrics['current-vo'],'gpu-next');
        assert.equal(start.metrics['current-gpu-context'],'macvk');
        assert.ok(Number.isFinite(start.metrics.avsync),'A/V offset missing');
        assert.ok(start.metrics['current-ao'] && start.metrics['current-ao']!=='null','real audio clock required');
        assert.equal(result.metadata.shaderFiles?.length||result.metadata.shaders?.length||0,3,'default shader chain missing');
        const stable=[];
        while(Date.now()-start.clock<seconds*1000){
            await delay(1000);const s=await sample();stable.push(s);
            result.measuredSeconds=(s.clock-start.clock)/1000;
            fs.writeFileSync(output,JSON.stringify(result,null,2));
            assert.equal(s.rife.state,baseline?0:2,JSON.stringify(s.rife));
            assert.ok(!s.metrics.pause&&!s.metrics['core-idle'],'playback interrupted');
        }
        const end=stable.at(-1),duration=end.metrics['time-pos']-start.metrics['time-pos'];
        result.generatedFrames=end.rife.generatedFrames-start.rife.generatedFrames;
        result.renderDrops=end.metrics['frame-drop-count']-start.metrics['frame-drop-count'];
        result.decodeDrops=end.metrics['decoder-frame-drop-count']-start.metrics['decoder-frame-drop-count'];
        result.dropRatio=(result.renderDrops+result.decodeDrops)/(duration*(baseline?30:60));
        result.maxAvsyncMs=Math.max(...stable.map(s=>Math.abs(s.metrics.avsync)*1000));
        result.maxRollingP95Ms=Math.max(...stable.map(s=>s.rife.p95Ms));
        assert.ok(duration>=seconds*.99,'media time failed to advance in realtime');
        assert.ok(baseline||result.generatedFrames>=duration*29,'not enough synthesized frames');
        assert.ok(result.dropRatio<.001,`drop ratio ${result.dropRatio}`);
        assert.ok(result.maxAvsyncMs<=40,`A/V offset ${result.maxAvsyncMs} ms`);
        result.passed=true;
        console.log(JSON.stringify({...result,samples:undefined,metadata:undefined,renderPasses:undefined}));
    } catch(error) {result.error=String(error);if(child.exitCode===null)spawnSync('sample',[String(child.pid),'1','1','-file',output+'.sample.txt']);throw error;}
    finally {
        fs.writeFileSync(output,JSON.stringify(result,null,2));
        if(cdp&&child.exitCode===null){
            try {await cdp.evaluate('window.api.player.stop()'); await delay(1500);}catch{}
        }
        ipc?.destroy();cdp?.close();
        if(child.exitCode===null){const exited=new Promise(resolve=>child.once('exit',resolve));child.kill();const killer=setTimeout(()=>child.kill('SIGKILL'),5000);await exited;clearTimeout(killer);}
        fs.closeSync(log);
        fs.rmSync(path.join(os.homedir(),'Library/Logs/Tigerest Theater/profiles',id),{recursive:true,force:true});
        fs.rmSync(root,{recursive:true,force:true,maxRetries:10,retryDelay:200});
    }
})().catch(error=>{console.error(error);process.exitCode=1;});
