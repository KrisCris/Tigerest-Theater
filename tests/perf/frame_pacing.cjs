// Measures requestAnimationFrame pacing of a synthetic library page in the
// client (isolated profile) or in a headed Chrome with a throwaway profile.
//   node tests/perf/frame_pacing.cjs "build/output/Tigerest Theater.exe" --webengine
//   node tests/perf/frame_pacing.cjs "C:/Program Files/Google/Chrome/Application/chrome.exe"
// Options: --ms=4000 --scenarios=raf,css,js,blur-css,smooth,scroll,hover --label=x --out=file.json
//          --maximized --qtframes [--qtlog=file] (client only; Qt presents per second from the render-loop log)
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawn}=require('node:child_process');
const {setTimeout:delay}=require('node:timers/promises');
const withBrowser=require('../community_browser.cjs');

const option=(name,fallback)=>{const hit=process.argv.find(a=>a.startsWith('--'+name+'='));return hit?hit.slice(name.length+3):fallback;};
const ms=Number(option('ms',4000));
const scenarios=option('scenarios','raf,css,js,blur-css,smooth,hover').split(',');
const label=option('label',process.argv.includes('--webengine')?'client':'chrome');
const fixture=path.join(__dirname,'frame_pacing_fixture.html');

async function drive({call,evaluate}){
    for(let i=0;i<200&&!await evaluate('!!window.fixtureReady');i++)await delay(50);
    const [w,h]=await evaluate('[innerWidth,innerHeight]');
    const results=[];
    for(const scenario of scenarios){
        await evaluate(`window.__run=measure(${JSON.stringify(scenario)},${ms});0`);
        await delay(400);
        // Synthetic input runs in parallel with the measurement window.
        const end=Date.now()+ms,sent=[];
        if(scenario.includes('scroll')){
            for(let dir=1;Date.now()<end;){
                sent.push(call('Input.dispatchMouseEvent',{type:'mouseWheel',x:w/2,y:h/2,deltaX:0,deltaY:120*dir}).catch(()=>{}));
                await delay(16);if(sent.length%40===0)dir=-dir;
            }
        }else if(scenario.includes('hover')){
            for(let t=0;Date.now()<end;t++){
                const x=40+(t*9)%(w-80),y=60+Math.floor(t*9/(w-80))*37%(h-120);
                sent.push(call('Input.dispatchMouseEvent',{type:'mouseMoved',x,y}).catch(()=>{}));
                await delay(4);
            }
        }
        await Promise.all(sent);
        const r=await evaluate('window.__run');
        results.push(r);
        console.log(`${label.padEnd(18)} ${scenario.padEnd(10)} fps=${String(r.fps).padStart(6)} p50=${r.p50} p95=${r.p95} p99=${r.p99} max=${r.max} janks=${r.janks} long=${r.longFrames} lag50/95=${r.lagP50}/${r.lagP95} vp=${r.viewport.join("x")}@${r.dpr} sx=${r.screenX}`);
    }
    return results;
}

async function chrome(executable,routes){
    const http=require('node:http');
    const server=http.createServer((req,res)=>{const route=routes[new URL(req.url,'http://x').pathname];
        if(!route){res.writeHead(404);res.end();return;}res.setHeader('Content-Type',route.type);res.end(fs.readFileSync(route.path));});
    await new Promise(r=>server.listen(0,'127.0.0.1',r));
    const url='http://127.0.0.1:'+server.address().port+'/';
    const profile=fs.mkdtempSync(path.join(os.tmpdir(),'tigerest-pacing-'));
    const child=spawn(executable,['--user-data-dir='+profile,'--remote-debugging-port=0','--no-first-run','--no-default-browser-check',
        '--start-maximized',...(process.env.PACING_CHROME_FLAGS||'').split(' ').filter(Boolean),url],{stdio:'ignore'});
    try{
        let port;
        for(let i=0;i<200&&!port;i++){try{port=fs.readFileSync(path.join(profile,'DevToolsActivePort'),'utf8').split('\n')[0];}catch{await delay(100);}}
        let page;
        for(let i=0;i<100&&!page;i++){page=(await(await fetch('http://127.0.0.1:'+port+'/json/list')).json()).find(p=>p.type==='page'&&p.url===url);if(!page)await delay(100);}
        const socket=new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((r,j)=>{socket.addEventListener('open',r,{once:true});socket.addEventListener('error',j,{once:true});});
        let id=0;const pending=new Map();
        socket.addEventListener('message',e=>{const m=JSON.parse(e.data),p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);}});
        const call=(method,params={})=>new Promise((resolve,reject)=>{const n=++id;pending.set(n,{resolve,reject});socket.send(JSON.stringify({id:n,method,params}));});
        const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});
            if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
        await call('Page.bringToFront');
        const results=await drive({call,evaluate});
        socket.close();
        return results;
    }finally{
        const exited=new Promise(r=>child.once('exit',r));child.kill();await exited;server.close();await delay(500);
        fs.rmSync(profile,{recursive:true,force:true,maxRetries:10,retryDelay:200});
    }
}

function attachQtFrames(results,profile){
    const logs=[];const walk=d=>{for(const e of fs.readdirSync(d,{withFileTypes:true})){const f=path.join(d,e.name);
        if(e.isDirectory())walk(f);else if(/\.log$/.test(e.name))logs.push(f);}};walk(profile);
    const stamps=[],keep=option('qtlog');
    if(keep)fs.writeFileSync(keep,logs.map(f=>fs.readFileSync(f,'utf8')).join('\n'));
    for(const f of logs)for(const line of fs.readFileSync(f,'utf8').split('\n')){
        const m=/^(\d+)-(\d+)-(\d+) (\d+):(\d+):(\d+)\.(\d+).*[Ff]rame rendered/.exec(line);
        if(m)stamps.push(new Date(+m[1],m[2]-1,+m[3],+m[4],+m[5],+m[6],+m[7]).getTime());
    }
    for(const r of results){
        const inside=stamps.filter(t=>t>=r.startWall&&t<=r.endWall);
        r.qtFps=+(inside.length/((r.endWall-r.startWall)/1000)).toFixed(1);
        console.log(`${label.padEnd(18)} ${r.scenario.padEnd(10)} qt presents/s=${r.qtFps}`);
    }
}

(async()=>{
    const routes={'/':{path:fixture,type:'text/html; charset=utf-8'}};
    let results;
    const qtFrames=process.argv.includes('--qtframes');
    // Qt's render-thread timing log gives one line per frame the scene graph
    // rendered and presented; counted inside each rAF measurement window.
    if(qtFrames)process.env.QT_LOGGING_RULES='qt.scenegraph.time.renderloop.debug=true';
    if(process.argv.includes('--webengine'))await withBrowser(routes,async ctx=>{
        results=await drive(ctx);
        if(qtFrames)attachQtFrames(results,ctx.profile);
    },{gpu:true,visible:true,startupTimeout:30000,args:qtFrames?['--log-level','debug']:[],maximized:process.argv.includes('--maximized')});
    else results=await chrome(path.resolve(process.argv[2]),routes);
    const out=option('out');
    if(out){const prior=fs.existsSync(out)?JSON.parse(fs.readFileSync(out,'utf8')):[];prior.push({label,env:{
        producerWait:process.env.TIGEREST_D3D11_PRODUCER_WAIT??null,chromiumFlags:process.env.QTWEBENGINE_CHROMIUM_FLAGS??process.env.PACING_CHROME_FLAGS??null,
        vsync:process.env.TIGEREST_WEBENGINE_VSYNC??null},results});fs.writeFileSync(out,JSON.stringify(prior,null,1));}
})().catch(e=>{console.error(e);process.exit(1);});
