const assert=require('node:assert/strict');
const {delay,run}=require('./cdp.cjs');
const work='「凭你也想讨伐魔王？」被勇者小队逐出队伍，只好在王都自在过活';
require('./media_fixture.cjs')(async({c,url,wait,requests,shot})=>{
 const previous=await c.evaluate('api.settings.value("danmaku","apiServer")');
 try{
  await c.evaluate(`api.settings.setValue('danmaku','apiServer',${JSON.stringify(url)})`);
  await c.evaluate('api.settings.setValue("mpv","enableDanmaku",true)');
  const item={Id:'matching-fixture-'+Date.now(),SeriesName:work,Name:'开始与结束',ParentIndexNumber:1,IndexNumber:1,PremiereDate:'2026-01-08T16:00:00Z'};
  await c.evaluate(`api.player.load(${JSON.stringify(url+'/media.mp4')},{autoplay:true},{type:'video',metadata:${JSON.stringify(item)}},1,-1)`);
  await wait('api.danmaku.sources().then(s=>s.some(v=>v.id==="101"))','repeated work records with quote differences must choose the regular E1');
  const source=(await c.evaluate('api.danmaku.sources()'))[0];
  assert.equal(source.title,work.replace(/[「」]/g,'')+' - 第1话 开始与结束','selected provider work and episode are visible in the source label');
  shot('danmaku-matching-osd');
  run('shell','uiautomator','dump','/sdcard/tigerest-ui.xml');
  assert.ok(run('shell','cat','/sdcard/tigerest-ui.xml').includes('匹配不正确可在弹幕菜单中手动纠正'),'native playback OSD shows the correction hint');
  const checkNoComment=async(metadata)=>{
   const first=requests.length;
   await c.evaluate(`api.danmaku.match(${JSON.stringify(metadata)})`);
   for(let i=0;i<100;i++) {if(requests.slice(first).filter(v=>v.startsWith('/api/v2/bangumi/')).length>=1)break;await delay(100);}
   assert.equal(requests.slice(first).filter(v=>v.startsWith('/api/v2/bangumi/')).length,1,'the deduplicated work was scanned');
   await delay(200);
   assert.ok(!requests.slice(first).some(v=>v.startsWith('/api/v2/comment/')),'unavailable episode must not load other comments');
   assert.equal((await c.evaluate('api.danmaku.sources()')).length,0);
  };
  await c.evaluate(`api.danmaku.match(${JSON.stringify({...item,Id:item.Id+'-old-date-title',IndexNumber:25,PremiereDate:'1989-04-15'})})`);
  await wait('api.danmaku.sources().then(s=>s.some(v=>v.id==="101"))','a unique title overrides the cumulative number even when premiere dates conflict');
  await c.evaluate(`api.danmaku.match(${JSON.stringify({...item,Id:item.Id+'-old-date-number',Name:'Different translation',PremiereDate:'1989-04-15'})})`);
  await wait('api.danmaku.sources().then(s=>s.some(v=>v.id==="101"))','the unique number remains usable when the title differs and premiere dates conflict');
  await checkNoComment({...item,Id:item.Id+'-missing-episode',IndexNumber:2,Name:'Missing episode title'});
  await c.evaluate('api.player.stop()');
  console.log(JSON.stringify({passed:true,repeatedWorkRecords:true,quotationDifference:true,creditsExcluded:true,episodeTitleInOSD:true,nativeCorrectionOSD:true,datesIgnored:true,titlePriority:true,numericFallback:true,missingEpisodeRejection:true,productionWrites:false}));
 }finally{await c.evaluate(`api.settings.setValue('danmaku','apiServer',${JSON.stringify(previous)})`);}
},(req,res)=>{
 if(!req.url.startsWith('/api/'))return false;
 res.setHeader('Content-Type','application/json');
 if(req.url.startsWith('/api/v2/search/anime'))res.end(JSON.stringify({animes:[
  {bangumiId:1,animeTitle:work.replace(/[「」]/g,'')},{bangumiId:1,animeTitle:work},{bangumiId:1,animeTitle:work}]}));
 else if(req.url.startsWith('/api/v2/bangumi/')){
  const id=Number(req.url.split('/').at(-1));
  res.end(JSON.stringify({bangumi:{episodes:[
   {episodeId:id*100+1,episodeNumber:'1',episodeTitle:'第1话 开始与结束',airDate:'2026-01-09'},
   {episodeId:9101,episodeNumber:'C1',episodeTitle:'C1 Opening',airDate:'2026-01-09'},
   {episodeId:9102,episodeNumber:'C2',episodeTitle:'C2 Ending',airDate:'2026-01-09'}]}}));
 }else res.end(JSON.stringify({comments:[{p:'1,1,16777215',m:'matching fixture comment'}]}));
 return true;
}).catch(error=>{console.error(error);process.exitCode=1;});
