const assert=require('node:assert/strict');const {run,delay}=require('./cdp.cjs');
require('./media_fixture.cjs')(async({c,url,wait,shot})=>{
 const rotation=run('shell','settings','get','system','user_rotation'),auto=run('shell','settings','get','system','accelerometer_rotation');
 const size=run('shell','wm','size');const originalSize=/Override size: (\d+x\d+)/.exec(size)?.[1];const snapshots=[];const originalPid=run('shell','pidof','top.tigerest.theater.debug');
 const snapshot=async name=>{const v=await c.evaluate('({route:location.hash,draft:document.getElementById("draft").value,width:innerWidth,height:innerHeight,dpr:devicePixelRatio,metrics:tigerestWindowMetrics})');assert.equal(v.route,'#comments/fixture');assert.equal(v.draft,'折叠与旋转后保留的评论草稿');assert.equal(run('shell','pidof','top.tigerest.theater.debug'),originalPid);assert.ok(v.width>0&&v.metrics.width>0);snapshots.push({name,...v});shot('window-'+name);};
 try{
  run('shell','settings','put','system','accelerometer_rotation','0');run('shell','settings','put','system','user_rotation','0');await delay(1200);
  await c.evaluate('location.hash="comments/fixture";document.getElementById("draft").value="折叠与旋转后保留的评论草稿"');
  run('shell','cmd','device_state','state','3');await delay(1600);await snapshot('inner');
  run('shell','cmd','device_state','state','0');run('shell','input','keyevent','224');await wait('api.system.debugInformation().then(d=>d.width===1080)','outer display resolution');await snapshot('outer');assert.equal(snapshots.at(-1).metrics.boundsWidth,1080);
  run('shell','cmd','device_state','state','3');await wait('api.system.debugInformation().then(d=>d.width===2224)');await snapshot('inner-restored');
  await c.evaluate(`api.player.load('${url}/media.mp4',{autoplay:true,startMilliseconds:10000},{type:'video',metadata:{Name:'折叠播放验收'}},1,-1)`);await wait('api.player.getPosition().then(p=>p>11000)');const before=await c.evaluate('api.player.getPosition()');
  run('shell','cmd','device_state','state','0');run('shell','input','keyevent','224');await delay(1500);const folded=await c.evaluate('api.system.debugInformation()');assert.equal(folded.active,true);assert.equal(folded.paused,false,'folding must not pause playback');assert.ok(await c.evaluate('api.player.getPosition()')>before);shot('playing-outer');
  run('shell','cmd','device_state','state','3');await delay(1400);assert.equal(await c.evaluate('api.system.debugInformation().then(d=>d.active&&!d.paused)'),true);await c.evaluate('api.player.stop()');
  run('shell','settings','put','system','accelerometer_rotation','0');run('shell','settings','put','system','user_rotation','1');await delay(1500);await snapshot('landscape');assert.ok(snapshots.at(-1).width>snapshots.at(-1).height);
  run('shell','settings','put','system','user_rotation','0');await delay(1200);
  // Emulate display bounds on the real panel; this is distinct from actual split-screen.
  run('shell','wm','size','1080x1920');await delay(1200);await snapshot('simulated-phone');
  run('shell','wm','size','2560x1600');await delay(1200);await snapshot('simulated-tablet');
  console.log(JSON.stringify({passed:true,physicalPanels:true,routeDraftAndProcessRetained:true,playbackAcrossFold:true,simulatedBounds:true,snapshots},null,2));
 }finally{run('shell','wm','size',originalSize||'reset');run('shell','settings','put','system','user_rotation',rotation);run('shell','settings','put','system','accelerometer_rotation',auto);run('shell','cmd','device_state','state','reset');}
}).catch(e=>{console.error(e);process.exitCode=1;});
