// Device regression: surface fills the pane; safe controls, menus and scrubbing stay usable.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {run,delay}=require('./cdp.cjs');
require('./media_fixture.cjs')(async({c,url,wait,tap,shot})=>{
 const rotation=run('shell','settings','get','system','user_rotation'),auto=run('shell','settings','get','system','accelerometer_rotation'),rotationMode=run('shell','wm','user-rotation');
 const snapshots=[];
 try {
  run('shell','settings','put','system','accelerometer_rotation','0');
  run('shell','settings','put','system','user_rotation','0');
  run('shell','cmd','device_state','state','3');
  await delay(1300);
  await c.evaluate('api.window.setFullScreen(true)');await delay(500);
  shot('layout-before-or-after');
  const web=await c.evaluate('({width:innerWidth,height:innerHeight,dpr:devicePixelRatio,metrics:tigerestWindowMetrics})');
  assert.ok(Math.abs(web.height*web.dpr-web.metrics.boundsHeight)<4,'WebView must extend through the cutout instead of leaving a black strip: '+JSON.stringify(web));
  assert.ok(Math.abs(web.width*web.dpr-web.metrics.boundsWidth)<4);
  await c.evaluate(`api.player.load('${url}/media.mp4',{autoplay:true,startMilliseconds:15000},{type:'video',metadata:{Name:'一个用于确认长标题省略和触控边界的测试集标题',SeriesName:'播放器布局验收',ParentIndexNumber:2,IndexNumber:3}},1,-1)`);
  await wait('api.player.getPosition().then(p=>p>15500)');await c.evaluate('api.player.pause()');await delay(500);
  let previousState=3;
  for(const [name,state,rotate] of [['inner-portrait',3,0],['inner-landscape',3,1],['outer-portrait',0,0],['outer-landscape',0,1]]) {
   const changed=state!==previousState;
   if(changed)run('shell','cmd','device_state','state',String(state));previousState=state;
   run('shell','input','keyevent','224');run('shell','wm','user-rotation','lock',String(rotate));await delay(1300);
   if(changed&&state===0){run('shell','input','swipe','540','2100','540','500','450');await delay(1200);}
   // Xiaomi's fold-to-cover continuation screen can occlude the app despite an unlocked device.
   if(/showing=true/.test(run('shell','dumpsys','window','policy'))) {
    run('shell','input','keyevent','82');run('shell','input','swipe','540','2100','540','500','300');await delay(800);
    if(/showing=true/.test(run('shell','dumpsys','window','policy')) && process.env.TIGEREST_TEST_UNLOCK) {
     run('shell','input','text',process.env.TIGEREST_TEST_UNLOCK);run('shell','input','keyevent','66');await delay(1000);
    }
   }
   assert.ok(!/showing=true/.test(run('shell','dumpsys','window','policy')),'unlock the cover continuation screen before UI verification');
   run('shell','wm','user-rotation','lock',String(rotate));await delay(600);
   const info=await c.evaluate('api.system.debugInformation()');
   if(!info.controlsVisible){run('shell','input','tap',String(Math.round(info.width/2)),String(Math.round(info.height/2)));await delay(100);}
   const d=await c.evaluate('api.system.debugInformation()');snapshots.push({name,...d});fs.writeFileSync(path.resolve(__dirname,'../test-artifacts/player-layout-results.json'),JSON.stringify({passed:false,snapshots},null,2));shot('player-layout-'+name);
   assert.deepEqual(d.videoBounds,d.pane,'video surface fills the complete pane');assert.ok(d.controls.buttons.length>=6,'controls are actually visible');
   assert.equal(d.width>d.height,rotate===1,'the physical panel has actually rotated');
   assert.equal(d.fullscreen,true,'video playback is automatically immersive');
   assert.ok(d.controls.header.bottom<=d.controls.bottom.top,'header and playback controls must not overlap');
   for(const b of d.controls.buttons){
    assert.ok(b.width/d.density>=47&&b.height/d.density>=47,'48 dp touch target: '+b.label);
    assert.ok(b.left>=d.safeContent.left-1&&b.right<=d.safeContent.right+1&&b.top>=d.safeContent.top-1&&b.bottom<=d.safeContent.bottom+1,'button outside safe content: '+b.label);
   }
  }
  await tap('更多');await tap('字幕偏移');await tap('取消');await delay(500);
  const d=await c.evaluate('api.system.debugInformation()'),s=d.controls.seek;
  const x=Math.round(s.left+s.width*.65),y=Math.round((s.top+s.bottom)/2);
  // Native MotionEvent, with a long held scrub: preview must remain stable while polling runs.
  run('shell','input','motionevent','DOWN',String(x-60),String(y));run('shell','input','motionevent','MOVE',String(x),String(y));await delay(1100);
  const drag1=await c.evaluate('api.system.debugInformation().then(d=>d.controls)');await delay(700);
  const drag2=await c.evaluate('api.system.debugInformation().then(d=>d.controls)');
  assert.equal(drag1.dragging,true);assert.equal(drag1.time,drag2.time);
  run('shell','input','motionevent','UP',String(x),String(y));await delay(400);
  assert.ok(await c.evaluate('api.player.getPosition()')>45000,'scrub commits the selected position');
  await c.evaluate('api.player.play()');await delay(4300);assert.equal(await c.evaluate('api.system.debugInformation().then(d=>d.controlsVisible)'),false);
  run('shell','input','tap',String(Math.round(d.width/2)),String(Math.round(d.height/2)));await delay(100);
  assert.equal(await c.evaluate('api.system.debugInformation().then(d=>d.controlsVisible)'),true);
  await c.evaluate('api.player.stop()');await delay(500);assert.equal(await c.evaluate('api.window.isFullScreen()'),false,'browsing restores system bars');
  fs.writeFileSync(path.resolve(__dirname,'../test-artifacts/player-layout-results.json'),JSON.stringify({passed:true,snapshots},null,2));
  console.log(JSON.stringify({passed:true,scenarios:snapshots.map(s=>s.name),scrubbing:true,menus:true,autoHide:true}));
 } finally {
  run('shell','cmd','device_state','state','reset');run('shell','wm','user-rotation',...rotationMode.split(/\s+/));run('shell','settings','put','system','user_rotation',rotation);run('shell','settings','put','system','accelerometer_rotation',auto);
 }
}).catch(e=>{console.error(e);process.exitCode=1;});
