const assert=require('node:assert/strict');const {run,delay,connect}=require('./cdp.cjs');
require('./media_fixture.cjs')(async({c,url,shot})=>{
 let f;
 try{
  c.close();run('shell','am','force-stop','top.tigerest.theater.debug');run('shell','am','start','--windowingMode','5','-n','top.tigerest.theater.debug/top.tigerest.theater.MainActivity','--es','url',url);await delay(800);f=await connect();
  for(let i=0;i<100;i++){if(await f.evaluate('!!window.api&&!!document.getElementById("draft")'))break;await delay(100);}
  await f.evaluate('location.hash="comments/freeform";document.getElementById("draft").value="自由窗口保留草稿"');const pid=run('shell','pidof','top.tigerest.theater.debug');
  const tasks=run('shell','dumpsys','activity','activities');const id=/Task\{[^\n]*#(\d+)[^\n]*top\.tigerest\.theater\.debug[^\n]*mode=freeform/.exec(tasks)?.[1];assert.ok(id,'real freeform task');const snapshots=[];
  for(const bounds of [[200,200,1400,2200],[100,200,2100,1500],[300,200,1100,2200]]){
   run('shell','am','task','resize',id,...bounds.map(String));await delay(1000);const state=await f.evaluate('({route:location.hash,draft:document.getElementById("draft").value,width:innerWidth,height:innerHeight,metrics:tigerestWindowMetrics})');assert.equal(state.draft,'自由窗口保留草稿');assert.equal(state.route,'#comments/freeform');assert.equal(run('shell','pidof','top.tigerest.theater.debug'),pid);snapshots.push(state);
  }
  const heights=snapshots.map(s=>s.height),widths=snapshots.map(s=>s.width);assert.ok(new Set(widths).size>1||new Set(heights).size>1,'task bounds actually resized');
  await f.evaluate(`api.player.load('${url}/media.mp4',{autoplay:true,startMilliseconds:12000},{type:'video',metadata:{Name:'自由窗口播放'}},1,-1)`);await delay(1500);const before=await f.evaluate('api.player.getPosition()');run('shell','am','task','resize',id,'100','150','1800','1450');await delay(1400);assert.ok(await f.evaluate('api.player.getPosition()')>before);assert.equal(await f.evaluate('api.system.debugInformation().then(d=>d.active&&!d.paused)'),true);await f.evaluate('api.player.stop()');
  console.log(JSON.stringify({passed:true,realFreeform:true,resizeRetainsRouteDraftPlayback:true,snapshots},null,2));
 }finally{f?.close();run('shell','am','force-stop','top.tigerest.theater.debug');run('shell','am','start','--windowingMode','1','-n','top.tigerest.theater.debug/top.tigerest.theater.MainActivity','--es','url',url);}
}).catch(e=>{console.error(e);process.exitCode=1;});
