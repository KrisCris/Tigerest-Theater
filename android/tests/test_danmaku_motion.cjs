const assert=require('node:assert/strict');const {delay}=require('./cdp.cjs');
require('./media_fixture.cjs')(async({c,url,wait})=>{
 const original=await c.evaluate('api.settings.value("danmaku","apiServer")');
 try{
  await c.evaluate(`api.settings.setValue('danmaku','apiServer','${url}')`);await c.evaluate('api.settings.setValue("mpv","enableDanmaku",true)');
  await c.evaluate(`api.player.load('${url}/media.mp4',{autoplay:true,startMilliseconds:1000},{type:'video',metadata:{Name:'弹幕运动节奏验收'}},1,-1)`);
  await wait('api.player.getPosition().then(p=>p>1200)');await c.evaluate('api.danmaku.load("701","滚动弹幕")');await delay(400);
  const start=await c.evaluate('api.system.debugInformation()');const at=performance.now();await delay(2200);const end=await c.evaluate('api.system.debugInformation()');const seconds=(performance.now()-at)/1000;
  const sample={refresh:end.refreshRate,drawFPS:(end.danmakuFrames-start.danmakuFrames)/seconds,motionFPS:(end.danmakuMotionFrames-start.danmakuMotionFrames)/seconds};console.log(JSON.stringify(sample));
  assert.ok(sample.motionFPS>Math.min(60,sample.refresh*.7),'24 fps video must have independently moving high-refresh danmaku: '+JSON.stringify(sample));
  assert.ok(sample.motionFPS/sample.drawFPS>.85,'redraws must advance the visible positions');
  await c.evaluate('api.player.pause()');await delay(200);const paused=await c.evaluate('api.system.debugInformation()');await delay(600);const frozen=await c.evaluate('api.system.debugInformation()');assert.equal(frozen.danmakuPosition,paused.danmakuPosition,'pause freezes the interpolated clock');
  await c.evaluate('api.player.seekTo(12000)');await delay(400);const sought=await c.evaluate('api.system.debugInformation()');assert.ok(Math.abs(sought.danmakuPosition-12)<.15,'paused seek resynchronizes');
  await c.evaluate('api.player.setPlaybackRate(1500)');await c.evaluate('api.player.play()');await delay(800);
  const before=await c.evaluate('api.system.debugInformation()'),rawBefore=await c.evaluate('api.player.getPosition()');await delay(1000);
  const after=await c.evaluate('api.system.debugInformation()'),rawAfter=await c.evaluate('api.player.getPosition()');const advanced=after.danmakuPosition-before.danmakuPosition;
  assert.ok(advanced>1.35&&advanced<1.75,JSON.stringify({advanced,rawDelta:(rawAfter-rawBefore)/1000,before:before.danmakuPosition,after:after.danmakuPosition,paused:after.paused}));
  assert.ok(Math.abs(after.danmakuPosition-rawAfter/1000)<.12,'smooth clock remains synchronized at 1.5x');
  await c.evaluate('api.player.stop()');console.log(JSON.stringify({passed:true,...sample,pauseSeekSpeed:true}));
 }finally{await c.evaluate(`api.settings.setValue('danmaku','apiServer',${JSON.stringify(original)})`);}
},(req,res)=>{if(!req.url.startsWith('/api/'))return false;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({comments:Array.from({length:400},(_,i)=>({p:`${i*.05},1,16766776`,m:`流畅滚动弹幕 ${i}`}))}));return true;}).catch(e=>{console.error(e);process.exitCode=1;});
