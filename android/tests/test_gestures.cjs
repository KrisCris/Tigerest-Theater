const assert=require('node:assert/strict');const {run,delay}=require('./cdp.cjs');
run('shell','am','force-stop','top.tigerest.theater.debug');run('shell','run-as','top.tigerest.theater.debug','rm','-f','shared_prefs/player-ui.xml');
require('./media_fixture.cjs')(async({c,url,wait,tap,shot})=>{
 const ui=()=>{run('shell','uiautomator','dump','/sdcard/tigerest-ui.xml');return run('shell','cat','/sdcard/tigerest-ui.xml');};
 await c.evaluate(`api.player.load('${url}/media.mp4',{autoplay:true,startMilliseconds:10000},{type:'video',metadata:{Name:'播放手势验收'}},1,-1)`);await delay(1200);
 assert.ok(ui().includes('播放手势'),'first playback must show gesture tutorial');shot('gestures-tutorial');await tap('知道了');await wait('api.player.getPosition().then(p=>p>10000)');
 const d=await c.evaluate('api.system.debugInformation()'),w=d.width,h=d.height,x=Math.round(w/2),y=Math.round(h*.48);
 const touch=(action,a,b)=>run('shell','input','motionevent',action,String(Math.round(a)),String(Math.round(b)));
 const double=async()=>{touch('DOWN',x,y);touch('UP',x,y);touch('DOWN',x,y);touch('UP',x,y);await delay(500);};
 await double();assert.equal(await c.evaluate('api.system.debugInformation().then(d=>d.paused)'),true,'double tap pauses');await double();assert.equal(await c.evaluate('api.system.debugInformation().then(d=>d.paused)'),false,'double tap resumes');
 let visible=await c.evaluate('api.system.debugInformation()');if(!visible.controlsVisible){run('shell','input','tap',String(x),String(y));await wait('api.system.debugInformation().then(d=>d.controlsVisible)');}
 const more=(await c.evaluate('api.system.debugInformation()')).controls.buttons.find(b=>b.label==='更多');run('shell','input','tap',String(Math.round((more.left+more.right)/2)),String(Math.round((more.top+more.bottom)/2)));
 await tap('手势教程');await c.evaluate('api.player.pause()');await tap('知道了');await delay(250);assert.equal(await c.evaluate('api.system.debugInformation().then(d=>d.paused)'),true,'tutorial must preserve a newer external pause request');
 await c.evaluate('api.player.pause()');await delay(200);const before=await c.evaluate('api.player.getPosition()');
 touch('DOWN',w*.35,y);touch('MOVE',w*.6,y);await delay(1500);const preview=await c.evaluate('api.system.debugInformation()');assert.ok(preview.controls.gesture.includes('快进'),'held preview remains visible');assert.ok(Math.abs(await c.evaluate('api.player.getPosition()')-before)<200,'seek is preview only until release');shot('gesture-seek-preview');touch('UP',w*.6,y);await delay(400);assert.ok(await c.evaluate('api.player.getPosition()')>before+10000);
 const after=await c.evaluate('api.player.getPosition()');touch('DOWN',w*.65,y);touch('MOVE',w*.4,y);touch('UP',w*.4,y);await delay(300);assert.ok(await c.evaluate('api.player.getPosition()')<after-10000,'swipe back seeks backward');
 // Cancel a preview, and keep vertical gestures on their original side.
 const cancelAt=await c.evaluate('api.player.getPosition()');touch('DOWN',x,y);touch('MOVE',w*.8,y);touch('CANCEL',w*.8,y);await delay(200);assert.ok(Math.abs(await c.evaluate('api.player.getPosition()')-cancelAt)<200);
 const original=await c.evaluate('api.system.debugInformation()');
 try{
  touch('DOWN',w*.2,h*.5);touch('MOVE',w*.2,h*.35);await delay(100);const bright=await c.evaluate('api.system.debugInformation()');assert.ok(bright.windowBrightness>original.effectiveBrightness,'left swipe increases window brightness');assert.equal(bright.mediaVolume,original.mediaVolume);touch('UP',w*.2,h*.35);
  touch('DOWN',w*.8,h*.4);touch('MOVE',w*.8,h*.6);touch('UP',w*.8,h*.6);await delay(100);const quieter=await c.evaluate('api.system.debugInformation()');assert.ok(quieter.mediaVolume<original.mediaVolume||original.mediaVolume===0,'right downward swipe decreases media volume');assert.equal(quieter.windowBrightness,bright.windowBrightness);
  touch('DOWN',w*.8,h*.6);touch('MOVE',w*.8,h*.35);touch('UP',w*.8,h*.35);await delay(100);assert.ok((await c.evaluate('api.system.debugInformation()')).mediaVolume>quieter.mediaVolume,'right upward swipe increases media volume');
 }finally{run('shell','cmd','media_session','volume','--stream','3','--set',String(original.mediaVolume));}
 await c.evaluate('api.player.stop()');await delay(300);assert.equal((await c.evaluate('api.system.debugInformation()')).windowBrightness,-1,'brightness restores on leaving player');
 await c.evaluate(`api.player.load('${url}/media.mp4',{autoplay:false,startMilliseconds:5000},{type:'video',metadata:{Name:'第二次播放'}},1,-1)`);await delay(1000);assert.ok(!ui().includes('播放手势'),'tutorial is only automatic once');await tap('更多');await tap('手势教程');assert.ok(ui().includes('播放手势'));await tap('知道了');assert.equal(await c.evaluate('api.system.debugInformation().then(d=>d.paused)'),true,'tutorial preserves paused playback');
 await tap('更多');await tap('手势教程');await c.evaluate('api.player.stop()');await delay(300);assert.ok(!ui().includes('播放手势'),'stopping playback dismisses tutorial');
 console.log(JSON.stringify({passed:true,tutorial:true,doubleTap:true,seekPreviewCommitCancel:true,volumeBrightness:true,stopDismissesTutorial:true}));
},()=>false,{tutorial:true}).catch(e=>{console.error(e);process.exitCode=1;});
