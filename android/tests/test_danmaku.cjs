const assert=require('node:assert/strict');const {delay}=require('./cdp.cjs');
require('./media_fixture.cjs')(async({c,url,wait,shot,requests})=>{
 const original=await c.evaluate('api.settings.value("danmaku","apiServer")');
 try{
 await c.evaluate(`api.settings.setValue('danmaku','apiServer','${url}')`);await c.evaluate('api.settings.setValue("mpv","enableDanmaku",true)');
 const runId=Date.now();const item={Id:`danmaku-${runId}-ep3`,SeriesName:'验收作品',Name:'第三集',ParentIndexNumber:2,IndexNumber:3};
 await c.evaluate(`api.player.load('${url}/media.mp4',{autoplay:true,startMilliseconds:1000},{type:'video',metadata:${JSON.stringify(item)}},1,-1)`);
 await wait('api.danmaku.sources().then(s=>s.some(v=>v.id==="203"))','season 2 auto-match');assert.ok(!requests.some(r=>r.includes('/comment/103')));
 const start=await c.evaluate('api.system.debugInformation()');await delay(2200);const end=await c.evaluate('api.system.debugInformation()');const fps=(end.danmakuFrames-start.danmakuFrames)/2.2;assert.ok(fps>40,'overlay frame cadence '+fps);shot('danmaku');
 await c.evaluate('api.danmaku.setSource("203",false,2.5)');
 const next={...item,Id:`danmaku-${runId}-ep4`,IndexNumber:4};await c.evaluate(`api.danmaku.match(${JSON.stringify(next)})`);await wait('api.danmaku.sources().then(s=>s.some(v=>v.id==="204"))');let source=(await c.evaluate('api.danmaku.sources()'))[0];assert.equal(source.enabled,false);assert.equal(source.delay,2.5);
 await c.evaluate('api.danmaku.setSource("204",true,0)');
 await c.evaluate(`api.danmaku.match(${JSON.stringify(item)})`);await wait('api.danmaku.sources().then(s=>s.some(v=>v.id==="203"))');source=(await c.evaluate('api.danmaku.sources()'))[0];assert.equal(source.enabled,true);assert.equal(source.delay,0,'history restore uses stable source policy');
 await assert.rejects(c.evaluate('api.danmaku.load("998","故障来源")'),/弹幕服务/);assert.equal((await c.evaluate('api.danmaku.sources()'))[0].id,'203','source failure retains usable comments');
 // A slow network request must not freeze pause/seek and cannot attach after an item change.
 await c.evaluate('window.staleLoad=api.danmaku.load("999","旧集慢请求");true');const t=Date.now();await c.evaluate('api.player.pause()');assert.ok(Date.now()-t<1200,'player bridge remains responsive during network request');
 await c.evaluate('api.danmaku.match({Id:"changed-no-match",Name:"",ParentIndexNumber:2})');await delay(1500);assert.equal((await c.evaluate('api.danmaku.sources()')).length,0,'stale load discarded');
 await c.evaluate('api.player.stop()');console.log(JSON.stringify({passed:true,automaticSeason:2,crossEpisodePolicy:true,history:true,overlayFPS:fps,staleResponseDiscarded:true,requests:requests.filter(r=>r.startsWith('/api'))}));
 }finally{await c.evaluate(`api.settings.setValue('danmaku','apiServer',${JSON.stringify(original)})`);}
},(req,res)=>{
 if(!req.url.startsWith('/api/'))return false;res.setHeader('Content-Type','application/json');
 if(req.url.startsWith('/api/v2/search/anime'))res.end(JSON.stringify({animes:[{bangumiId:1,animeTitle:'验收作品'},{bangumiId:2,animeTitle:'验收作品 第二季'}]}));
 else if(req.url==='/api/v2/bangumi/2')res.end(JSON.stringify({bangumi:{episodes:[{episodeId:203,episodeNumber:3,episodeTitle:'第二季第三集'},{episodeId:204,episodeNumber:4,episodeTitle:'第二季第四集'}]}}));
 else if(req.url.includes('/comment/998')){res.writeHead(503);res.end('{}');}
 else if(req.url.includes('/comment/999'))setTimeout(()=>res.end(JSON.stringify({comments:[{p:'1,1,16777215',m:'旧集弹幕'}]})),1300);
 else res.end(JSON.stringify({comments:Array.from({length:600},(_,i)=>({p:`${i*.1},${i%3===0?5:i%3===1?4:1},16766776`,m:`真机同步弹幕 ${i}`}))}));return true;
}).catch(e=>{console.error(e);process.exitCode=1;});
