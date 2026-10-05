'use strict';
// Manual GPU acceptance: use an isolated QtWebEngine profile, local media/XML,
// and (optionally) copies/hardlinks of an already installed RIFE extension.
// Measures changes in completed GPU pass samples, not Lua timer callbacks.
const fs=require('node:fs'),path=require('node:path'),net=require('node:net');
const assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
const {randomUUID}=require('node:crypto');
const withBrowser=require('./community_browser.cjs');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const pipe='\\\\.\\pipe\\TigerestDanmaku-'+randomUUID();
const source=process.env.TIGEREST_TEST_CLIP;
assert.ok(source&&fs.existsSync(source),'TIGEREST_TEST_CLIP must name a local >=60s SDR clip');
const extension=process.env.TIGEREST_TEST_RIFE_SOURCE;
const output=path.resolve(process.env.TIGEREST_TEST_REPORT||'build/danmaku-241-client.json');
const result={scope:'Full QtWebEngine/mpv client, local generated danmaku, GPU pass sampling (not scanout); no production account',rife:!!extension,phases:[],checks:[],pauseEvents:[]};
const routes={'/':{type:'text/html',body:'<!doctype html><meta charset="utf-8"><style>html,body{background:transparent}</style>'}};
let clip;
function copyExtension(from,to){
    fs.mkdirSync(to,{recursive:true});
    for(const entry of fs.readdirSync(from,{withFileTypes:true})){
        const src=path.join(from,entry.name),dest=path.join(to,entry.name);
        assert.ok(!entry.isSymbolicLink(),'Fixture input must not contain links');
        if(entry.isDirectory())copyExtension(src,dest);
        else if(entry.name.endsWith('.json'))fs.copyFileSync(src,dest);
        else {try{fs.linkSync(src,dest);}catch{fs.copyFileSync(src,dest);}}
    }
}
async function until(fn,label,limit=300){
    for(let i=0;i<limit;i++){const value=await fn();if(value)return value;await wait(100);}
    throw Error('Timed out: '+label);
}
(async()=>{
 await withBrowser(routes,async({evaluate})=>{
  await until(()=>evaluate('!!window.api?.player'),'native bridge');
  let ipc;
  await until(async()=>{try{ipc=net.connect(pipe);await new Promise((r,j)=>{ipc.once('connect',r);ipc.once('error',j)});return true;}catch{ipc?.destroy();}},'test IPC');
  let seq=0,buffer='';const pending=new Map();
  ipc.on('data',d=>{buffer+=d;let end;while((end=buffer.indexOf('\n'))>=0){const v=JSON.parse(buffer.slice(0,end));buffer=buffer.slice(end+1);if(v.event==='property-change'&&v.name==='pause')result.pauseEvents.push({at:new Date().toISOString(),paused:v.data});const p=pending.get(v.request_id);if(p){pending.delete(v.request_id);clearTimeout(p.timer);p.resolve(v.error==='success'?v.data:null);}}});
  const cmd=(...command)=>new Promise((resolve,reject)=>{const request_id=++seq,timer=setTimeout(()=>{pending.delete(request_id);reject(Error('IPC timeout: '+command[0]));},10000);pending.set(request_id,{resolve,timer});ipc.write(JSON.stringify({command,request_id})+'\n');});
  const prop=k=>cmd('get_property',k);
  const snapshot=async()=>Object.fromEntries(await Promise.all(['time-pos','video-sync','display-fps','osd-dimensions','display-sync-active','estimated-vf-fps','frame-drop-count','decoder-frame-drop-count','avsync','vf','pause','user-data/uosc_danmaku/has-danmaku'].map(async k=>[k,await prop(k)])));
  const sample=async(name,seconds=8)=>{
      await prop('vo-passes'); await wait(700);
      const before=await snapshot(),previous={},changes={fresh:0,redraw:0};
      const start=performance.now();let polls=0;
      while(performance.now()-start<seconds*1000){
          const passes=await prop('vo-passes')||{};
          for(const kind of Object.keys(changes)){
              // Sample one completed GPU pass; independent passes can finish
              // at different times and must not be counted twice.
              const sig=JSON.stringify(passes[kind]?.find(p=>p.samples?.length)?.samples);
              if(previous[kind]!==undefined&&sig!==previous[kind])changes[kind]++;
              previous[kind]=sig;
          }
          polls++;await wait(1);
      }
      const elapsed=(performance.now()-start)/1000,after=await snapshot();
      const rife=extension?(await evaluate('api.player.mpvDiagnostics()')).rife:null;
      const phase={name,seconds:elapsed,polls,before,after,gpuPassChangesPerSecond:Object.fromEntries(Object.entries(changes).map(([k,v])=>[k,v/elapsed])),rife};
      result.phases.push(phase);fs.writeFileSync(output,JSON.stringify(result,null,2));
      console.log(JSON.stringify({name,...phase.gpuPassChangesPerSecond,drops:after['frame-drop-count']-before['frame-drop-count'],sync:after['video-sync'],rifeState:rife?.state}));
      if(rife)assert.equal(rife.state,2,'RIFE must remain active');
      const filters=after.vf||[];
      if(extension)assert.ok(filters.some(f=>f.label==='tigerest-rife'),'owned RIFE filter must remain attached');
      else assert.equal(filters.length,0,'plain-video fixture must not be modified by an external interpolator');
      assert.equal(before.pause,false,'measurement must start playing');
      assert.equal(after.pause,false,'measurement was interrupted by pause');
      // gpu-next updates redraw pass timings on presentations of fresh frames
      // too. Adding fresh and redraw would overcount the rendering cadence.
      const observed=phase.gpuPassChangesPerSecond.redraw;
      assert.ok(observed>=Math.min(120,after['display-fps'])*.95,'GPU updates must reach display-limited 120 fps target (5% sampling tolerance): '+observed);
      return phase;
  };
  try{
      await cmd('observe_property',1,'pause');
      await evaluate('api.player.setVideoOnlyMode(true);api.window.raiseWindow()');
      await evaluate(`api.player.load(${JSON.stringify(pathToFileURL(clip).href)},{autoplay:true,startMilliseconds:0},{type:'video',title:'高刷弹幕验收'},1,-1)`);
      await until(async()=>extension?(await evaluate('api.player.mpvDiagnostics()')).rife?.state===2:(await prop('time-pos'))>1,'active video',1800);
      await until(async()=>await prop('time-pos')>1,'playing');
      await evaluate('api.window.setFullScreen(true)');await wait(700);
      if(!await prop('user-data/uosc_danmaku/has-danmaku'))await cmd('script-message-to','uosc_danmaku','show_danmaku_keyboard');
      await until(()=>prop('user-data/uosc_danmaku/has-danmaku'),'local comments shown');
      assert.equal(await prop('video-sync'),'display-resample','legacy highRefreshCompatibility flag cannot change selected clock');
      await sample('display-resample');
      await evaluate("api.settings.setValue('video','sync_mode','audio')");
      await until(async()=>await prop('video-sync')==='display-vdrop','audio clock with display-driven comments');
      await sample('audio-with-danmaku');
      await cmd('script-message-to','uosc_danmaku','show_danmaku_keyboard');
      await until(async()=>await prop('video-sync')==='audio','audio restored after hiding');
      result.checks.push('Hiding comments restores audio without removing RIFE');
      await cmd('script-message-to','uosc_danmaku','show_danmaku_keyboard');
      await until(async()=>await prop('video-sync')==='display-vdrop','comments re-enabled');
      await cmd('set_property','pause',true);const paused=await prop('time-pos');await wait(400);
      assert.equal(await prop('time-pos'),paused);await cmd('set_property','pause',false);
      await cmd('seek','35','absolute+exact');await until(async()=>!await prop('seeking'),'seek finished');await wait(1500);
      await sample('after-seek',4);
      await cmd('script-message-to','uosc_danmaku','show_danmaku_keyboard');
      await until(async()=>await prop('video-sync')==='audio','audio restored for readable stats capture');
      await wait(3200); // Let the temporary "comments hidden" OSD expire.
      await cmd('script-binding','stats/display-page-6');
      await wait(350);await cmd('screenshot-to-file',path.resolve('build/stats-241-help.png'),'window');
      await cmd('script-binding','stats/display-page-1');
      await wait(350);await cmd('screenshot-to-file',path.resolve('build/stats-241-overview.png'),'window');
      await cmd('script-binding','stats/display-stats-toggle');
      await evaluate('api.player.stop()');
      await until(async()=>await prop('video-sync')==='audio','stop restores selected audio');
      result.checks.push('Pause, seek, stats page navigation and stop passed');result.completed=true;
  }finally{ipc.end();fs.writeFileSync(output,JSON.stringify(result,null,2));}
 },{gpu:true,visible:true,startupTimeout:120000,settings:{video:{sync_mode:'display-resample',highRefreshCompatibility:true,aiRife:!!extension,aiRifeModel:'rife-4.25-lite',aiRifeTarget:0,'refreshrate.auto_switch':false},mpv:{configMode:'embedded',renderBackend:'gpu-next',shaderPreset:'default'},other:{other_conf:'input-ipc-server='+pipe+'\nmute=yes'}},
 prepareProfile:async(root,folder)=>{
     // Set the private endpoint before mpv initializes: other_conf is applied
     // later, leaving a brief default mpvpipe window for a running SVP Manager.
     const config=path.join(folder,'mpv');fs.mkdirSync(config,{recursive:true});
     fs.writeFileSync(path.join(config,'user-overrides.conf'),'input-ipc-server='+pipe+'\n');
     clip=path.join(root,'danmaku-acceptance.mp4');fs.copyFileSync(source,clip);
     fs.writeFileSync(clip.replace(/\.mp4$/,'.xml'),'<i>'+Array.from({length:120},(_,i)=>`<d p="${i*.5},1,25,16777215,0,0,0,${i}">高刷弹幕验证 ${i}</d>`).join('')+'</i>');
     if(extension){
         const active=JSON.parse(fs.readFileSync(path.join(extension,'active.json'),'utf8'));
         assert.match(active.versionKey,/^[a-zA-Z0-9._-]+$/);
         const target=path.join(root,'extensions/rife');fs.mkdirSync(target,{recursive:true});
         fs.writeFileSync(path.join(target,'active.json'),JSON.stringify(active));
         copyExtension(path.join(extension,'versions',active.versionKey),path.join(target,'versions',active.versionKey));
     }
 }});
 console.log(JSON.stringify({completed:result.completed,checks:result.checks}));
})().catch(e=>{console.error(e);process.exitCode=1});
