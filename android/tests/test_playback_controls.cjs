// Runs only against the independent debug package; restores browsing and system rotation.
const assert=require('node:assert/strict'), fs=require('node:fs'), path=require('node:path'), http=require('node:http');
const {connect,run,delay}=require('./cdp.cjs');
(async()=>{
 const media=path.resolve(__dirname,'../test-artifacts/playback-fixture.mp4');
 const server=http.createServer((req,res)=>{
  const total=fs.statSync(media).size,range=/bytes=(\d+)-(\d*)/.exec(req.headers.range||''),start=range?+range[1]:0,end=range?.[2]?Math.min(+range[2],total-1):total-1;
  if(start>=total){res.writeHead(416);res.end();return;}
  res.writeHead(range?206:200,{'Content-Type':'video/mp4','Accept-Ranges':'bytes','Content-Length':end-start+1,...(range?{'Content-Range':`bytes ${start}-${end}/${total}`}:{})});fs.createReadStream(media,{start,end}).pipe(res);
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;
 const originalAuto=run('shell','settings','get','system','accelerometer_rotation'),originalRotation=run('shell','settings','get','system','user_rotation'),originalMode=run('shell','wm','user-rotation');
 const originalFont=run('shell','settings','get','system','font_scale');
 let c,originalUrl;
 try{
  run('reverse','tcp:'+port,'tcp:'+port);c=await connect();originalUrl=await c.evaluate('location.href');
  await c.call('Page.navigate',{url:'https://appassets.androidplatform.net/assets/playback-controls-fixture.html'});
  const wait=async(expression,message=expression)=>{for(let n=0;n<100;n++){if(await c.evaluate(expression))return;await delay(150);}throw Error(message);};
  await wait('!!window.api && location.pathname==="/assets/playback-controls-fixture.html"');
  assert.equal(await c.evaluate('api.window.isFullScreen()'),false,'browsing keeps the system bars');
  await c.evaluate(`api.player.load('http://127.0.0.1:${port}/media.mp4',{autoplay:true},{type:'video',metadata:{Name:'控制栏验收'}})`);
  await wait('api.system.debugInformation().then(d=>d.videoVisible && !d.controls.loading)');
  assert.equal(await c.evaluate('api.window.isFullScreen()'),true,'native video playback uses immersive mode');
  const info=()=>c.evaluate('api.system.debugInformation()');
  const show=async()=>{let d=await info();if(!d.controlsVisible){run('shell','input','tap',String(d.width/2|0),String(d.height/2|0));await wait('api.system.debugInformation().then(d=>d.controlsVisible)');}return info();};
  const tap=async(label,long=false)=>{const d=await info(),b=d.controls.buttons.find(x=>x.label===label);assert.ok(b,'visible native button: '+label);const x=(b.left+b.right)/2|0,y=(b.top+b.bottom)/2|0;if(long)run('shell','input','swipe',String(x),String(y),String(x),String(y),'900');else run('shell','input','tap',String(x),String(y));await delay(250);};
  await show();await tap('防误触');
  await wait('api.system.debugInformation().then(d=>d.controls.touchLocked)');
  const locked=await info();assert.equal(locked.controlsVisible,false);assert.deepEqual(locked.controls.buttons.map(b=>b.label),['长按解锁']);
  run('shell','settings','put','system','font_scale',originalFont==='1.05'?'1.0':'1.05');await delay(1000);c.close();c=await connect();
  await wait('!!window.api');await wait('api.system.debugInformation().then(d=>d.videoVisible && d.controls.touchLocked)');
  const recreated=await info();assert.equal(recreated.controlsVisible,false);assert.deepEqual(recreated.controls.buttons.map(b=>b.label),['长按解锁'],'recreated locked screen exposes only unlock');
  await c.call('Page.navigate',{url:'https://appassets.androidplatform.net/assets/playback-controls-fixture.html'});await wait('!!window.api && location.pathname==="/assets/playback-controls-fixture.html"');
  const state=await c.evaluate('Promise.all([api.player.getPosition(),api.player.mpvDiagnostics()])');
  run('shell','input','tap',String(locked.width/2|0),String(locked.height/2|0));run('shell','input','tap',String(locked.width/2|0),String(locked.height/2|0));
  run('shell','input','swipe',String(locked.width*.2|0),String(locked.height*.5|0),String(locked.width*.8|0),String(locked.height*.5|0),'300');
  run('shell','input','keyevent','4');await delay(350);
  assert.equal((await info()).active,true,'back is blocked by touch lock');assert.equal((await info()).paused,false,'double tap cannot pause while locked');
  assert.ok(await c.evaluate('api.player.getPosition()')-state[0]<8000,'swipe cannot seek while locked');
  await tap('长按解锁');assert.equal((await info()).controls.touchLocked,true,'short tap cannot accidentally unlock');
  await tap('长按解锁',true);assert.equal((await info()).controls.touchLocked,false);
  await c.evaluate(`(()=>{
   const callbacks={};window.Events={on:(_,event,fn)=>callbacks[event]=fn,off(){},trigger(){}};
   const list=[1,2,3].map(n=>({Id:'media-'+n,PlaylistItemId:'queue-'+n,Name:['第一集','第二集','第三集'][n-1],ParentIndexNumber:1,IndexNumber:n}));
   let index=1;const player={id:'fixture'};
   const manager={_currentPlayer:player,_playQueueManager:{getPlaylist:()=>list,getCurrentPlaylistIndex:()=>index},
    getCurrentPlaylistItemId:()=>list[index].PlaylistItemId,getPlayerState:()=>({NowPlayingItem:{MediaType:'Video'}}),
    setCurrentPlaylistItem:(id,p)=>{if(p!==player)throw Error('wrong native player');index=list.findIndex(x=>x.PlaylistItemId===id);window.__selectedEpisode=id;
     return api.player.stop().then(()=>api.player.load('http://127.0.0.1:${port}/media.mp4',{autoplay:true},{type:'video',metadata:list[index]})).then(()=>callbacks.playlistitemchange());}};
   new window._inputPlugin({inputManager:{handleCommand(){}},playbackManager:manager});
   apiPromise.then(()=>callbacks.playlistitemchange());
  })()`);
  await wait('api.player.getCurrentWebPlaylistItemId().then(id=>id==="queue-2")');await delay(450);
  await show();await tap('上一集');await wait('window.__selectedEpisode==="queue-1"');await delay(500);
  await show();await tap('下一集');await wait('window.__selectedEpisode==="queue-2"');await delay(500);
  await show();await tap('选集');
  run('shell','uiautomator','dump','/sdcard/tigerest-controls.xml');
  const nodes=run('shell','cat','/sdcard/tigerest-controls.xml').match(/<node[^>]*>/g)||[],row=nodes.find(n=>n.includes('text="S1 E3 · 第三集"'));
  assert.ok(row,'native episode picker displays season, number and title');const bounds=/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/.exec(row);
  run('shell','input','tap',String((+bounds[1]+ +bounds[3])/2|0),String((+bounds[2]+ +bounds[4])/2|0));await wait('window.__selectedEpisode==="queue-3"');await delay(500);
  await show();const d=await info();for(const label of ['上一集','选集','下一集'])assert.ok(d.controls.buttons.find(b=>b.label===label),'direct control '+label);
  for(const b of d.controls.buttons){assert.ok(b.width/d.density>=47 && b.height/d.density>=47,'48 dp targets '+b.label);assert.ok(b.left>=d.safeContent.left && b.right<=d.safeContent.right && b.bottom<=d.safeContent.bottom,'safe bounds '+b.label);}
  run('shell','wm','user-rotation','lock','1');run('shell','settings','put','system','accelerometer_rotation','1');await delay(500);
  // Keep sensor rotation deterministic for the test without changing the app's requested orientation.
  run('shell','wm','user-rotation','lock','1');await delay(500);
  await wait('api.system.debugInformation().then(d=>d.width>d.height)','device must be landscape before toggling system rotation off');
  run('shell','settings','put','system','accelerometer_rotation','0');run('shell','settings','put','system','user_rotation','0');await delay(700);
  assert.ok((await info()).width>(await info()).height,'system rotation lock retains landscape');
  await c.evaluate(`api.player.load('http://127.0.0.1:${port}/media.mp4',{autoplay:true},{type:'video',metadata:{Name:'下一集验收'}})`);await delay(600);
  assert.ok((await info()).width>(await info()).height,'episode transition retains system lock');
  await c.evaluate('api.player.stop()');await delay(500);assert.ok((await info()).width>(await info()).height,'browse remains landscape under system lock');
  assert.equal((await info()).fullscreen,false,'leaving playback restores browsing system bars');
  run('shell','settings','put','system','accelerometer_rotation','1');await delay(350);assert.equal((await info()).requestedOrientation,-1,'unlock returns direction control to Android');
  const result={passed:true,touchLock:true,backBlocked:true,longPressUnlock:true,directEpisodeButtons:true,nativeEpisodeSelection:true,systemLandscapeLock:true,episodeAndBrowseLock:true,browsingSystemBars:true,fixtureMedia:true};
  fs.writeFileSync(path.resolve(__dirname,'../test-artifacts/playback-controls-results.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 }finally{
  if(c){
   await c.evaluate('api?.player.stop().then(()=>api.player.setWebPlaylist([],""))').catch(()=>{});
   if(originalUrl){
    await c.call('Page.navigate',{url:originalUrl}).catch(()=>{});
    await c.call('Page.reload',{ignoreCache:true}).catch(()=>{});
    let restored=false;
    for(let i=0;i<100;i++){try{if(await c.evaluate('!!window.api && document.readyState==="complete" && !window.__selectedEpisode && !location.pathname.includes("playback-controls-fixture")')){restored=true;break;}}catch{}await delay(100);}
    assert.ok(restored,'real browsing context must be restored after fixture');
   }
   c.close();
  }
  run('shell','settings','put','system','accelerometer_rotation',originalAuto);run('shell','settings','put','system','user_rotation',originalRotation);run('shell','wm','user-rotation',...originalMode.split(/\s+/));
  if(originalFont==='null')run('shell','settings','delete','system','font_scale');else run('shell','settings','put','system','font_scale',originalFont);
  run('reverse','--remove','tcp:'+port);server.closeAllConnections();await new Promise(r=>server.close(r));
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
