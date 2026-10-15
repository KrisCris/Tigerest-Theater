const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function source(api){const c={Date,Promise,Map,Set,AbortController};c.window=c;vm.runInNewContext(fs.readFileSync(__dirname+'/../native/homeData.js','utf8'),c);return new c.TigerestHomeData(api);}
const movie=(Id,date,extra={})=>({Id,Type:'Movie',DateCreated:date,Name:Id,...extra});
const episode=(Id,SeriesId,date)=>({Id,SeriesId,Type:'Episode',SeriesName:SeriesId,DateCreated:'2026-09-01',UserData:{LastPlayedDate:date,PlaybackPositionTicks:120,PlayedPercentage:40}});
function api(){const calls=[];return {calls,getCurrentUserId:()=> 'current-user',getResumableItems:async(user,q)=>{calls.push({resume:true,user,q});return {Items:[]};},getItems:async(user,q)=>{calls.push({user,q});return {Items:[]};}};}
test('default continues current-library playback and tops up with recent unique works',async()=>{
 // Emby 4.8 to 4.10 return an empty resume list unless the query names item or media types.
 const a=api();a.getResumableItems=async(user,q)=>{a.calls.push({resume:true,user,q});return {Items:q.IncludeItemTypes||q.MediaTypes?[movie('watch','2020-01-01',{UserData:{PlaybackPositionTicks:100}})]:[]};};
 a.getItems=async(user,q)=>{a.calls.push({user,q});return {Items:[movie('watch','2020-01-01'),movie('new','2026-10-10'),movie('older','2026-10-09')]};};
 const cards=await source(a).load({Id:'only-this-library',CollectionType:'movies'});
 assert.deepEqual(Array.from(cards,c=>c.item.Id),['watch','new','older']);
 assert.equal(a.calls[0].resume,true);assert.equal(a.calls[0].user,'current-user');
 assert.ok(a.calls.every(c=>c.q.ParentId==='only-this-library'),'both queries stay in the selected library');
 assert.equal(cards[0].resumeItem.Id,'watch');assert.equal(cards[1].resumeItem,undefined);
});
test('continuing episodes collapse to the series while retaining the latest playback record',async()=>{
 const a=api();a.getResumableItems=async()=>({Items:[episode('latest','show','2026-10-10'),episode('older','show','2026-10-01')]});
 a.getItems=async(user,q)=>({Items:q.Ids?[{Id:'show',Type:'Series',Name:'Series synopsis',Overview:'series plot'}]:[movie('fill','2026-10-09')]});
 const cards=await source(a).load({Id:'tv',CollectionType:'tvshows'});
 assert.deepEqual(Array.from(cards,c=>c.item.Id),['show','fill']);assert.equal(cards[0].item.Type,'Series');assert.equal(cards[0].resumeItem.Id,'latest');assert.equal(cards[0].item.Overview,'series plot');
});
const played=(Id,SeriesId,date)=>({Id,SeriesId,Type:'Episode',SeriesName:SeriesId,DateCreated:'2026-01-01',UserData:{Played:true,LastPlayedDate:date}});
const playedMovie=(Id,date)=>movie(Id,'2026-01-01',{UserData:{Played:true,LastPlayedDate:date}});
const added=(Id,SeriesId,date,Played=false)=>({Id,SeriesId,Type:'Episode',SeriesName:SeriesId,DateCreated:date,IndexNumber:2,ParentIndexNumber:1,UserData:{Played}});
const hoursBefore=(day,hours)=>new Date(Date.parse(day)-hours*3600e3).toISOString();
const slice=(items,q)=>({Items:items.slice(q.StartIndex||0,(q.StartIndex||0)+q.Limit),TotalRecordCount:items.length});
// Emby 4.8 returns a play date only when the request asks for it.
const reply=(q,result)=>String(q.Fields||'').split(',').includes('UserDataLastPlayedDate')?result
 :{...result,Items:result.Items.map(item=>item.UserData?{...item,UserData:(({LastPlayedDate,...data})=>data)(item.UserData)}:item)};
// A library whose playback history, recent additions and single-series
// queries answer separately, as an Emby server does.
function server({resume=[],history=[],recent=[],series=()=>[]}){
 const a=api();a.getResumableItems=async(user,q)=>{a.calls.push({resume:true,user,q});return reply(q,slice(resume,q));};
 a.getItems=async(user,q)=>{a.calls.push({user,q});
  if(q.Ids)return {Items:q.Ids.split(',').map(Id=>({Id,Type:'Series',Name:'Series '+Id}))};
  if(q.ParentId!=='library')return reply(q,{Items:series(q)});
  return reply(q,slice(q.IsPlayed?history:recent,q));};
 return a;
}
test('watched works lead by their latest play and works never played follow, even newer ones',async()=>{
 const a=server({resume:[movie('paused','2020-01-01',{UserData:{PlaybackPositionTicks:5,LastPlayedDate:'2026-10-05'}})],
  history:[played('s1','show','2026-10-08')],recent:[movie('fresh','2026-10-12'),added('show-2','show','2026-09-01',true)]});
 const cards=await source(a).load({Id:'library',CollectionType:'tvshows'});
 assert.deepEqual(Array.from(cards,c=>c.item.Id),['show','paused','fresh']);
 assert.equal(cards[0].item.Name,'Series show');assert.equal(cards[0].resumeItem,undefined);assert.equal(cards[0].newEpisode,undefined);
 assert.equal(cards[1].resumeItem.Id,'paused');
 const history=a.calls.find(c=>c.q.IsPlayed);assert.equal(history.q.ParentId,'library');assert.match(history.q.SortBy,/^DatePlayed/);assert.equal(history.q.SortOrder,'Descending');
 assert.ok(a.calls.every(c=>c.q.ParentId==='library'||c.q.Ids),'no single-series request when history and additions are complete');
});
test('an unwatched episode added after the last play brings its series forward',async()=>{
 const a=server({history:[played('caught-1','caught','2026-10-07'),playedMovie('film','2026-10-05'),played('show-1','show','2026-09-01')],
  recent:[added('show-2','show','2026-10-10'),added('caught-skipped','caught','2026-10-06')]});
 const cards=await source(a).load({Id:'library'});
 assert.deepEqual(Array.from(cards,c=>c.item.Id),['show','caught','film']);
 assert.equal(cards[0].newEpisode.Id,'show-2');assert.equal(cards[0].latestEpisode.Id,'show-2');assert.equal(cards[0].addedAt,'2026-10-10');
 assert.equal(cards[1].newEpisode,undefined,'an episode that arrived before the last play is not new');
});
test('the progress bar follows only the most recent play of a work',async()=>{
 const a=server({resume:[episode('current-3','current','2026-10-06'),episode('abandoned','show','2026-10-01')],
  history:[played('show-5','show','2026-10-05'),played('current-2','current','2026-10-02')]});
 const cards=await source(a).load({Id:'library'});
 assert.deepEqual(Array.from(cards,c=>c.item.Id),['current','show']);
 assert.equal(cards[0].resumeItem.Id,'current-3');assert.equal(cards[1].resumeItem,undefined);
});
test('a series last watched before the loaded history is recognised when a new episode arrives',async()=>{
 const history=Array.from({length:150},(_,i)=>playedMovie('film-'+i,hoursBefore('2026-10-10',i)));
 const a=server({history,recent:[added('returning-new','returning','2026-10-12'),added('stranger-new','stranger','2026-10-11')],
  series:q=>q.ParentId==='returning'?[played('returning-1','returning','2026-03-01')]:[]});
 const cards=await source(a).load({Id:'library'});
 assert.equal(cards.length,24);assert.equal(cards[0].item.Id,'returning');assert.equal(cards[0].newEpisode.Id,'returning-new');
 assert.equal(cards[1].item.Id,'film-0');assert.ok(!cards.some(c=>c.item.Id==='stranger'),'a series never played stays behind watched works');
 const check=a.calls.find(c=>c.q.ParentId==='returning');
 assert.equal(check.q.IsPlayed,true);assert.equal(check.q.Limit,1);assert.match(check.q.SortBy,/^DatePlayed/);
 assert.equal(a.calls.filter(c=>c.q.IsPlayed&&c.q.ParentId==='library').length,1,'history stops once the row is full');
});
test('a watched series whose newest episode is older than the recent window asks for that episode',async()=>{
 const recent=Array.from({length:200},(_,i)=>movie('new-'+i,hoursBefore('2026-10-12',i)));
 const a=server({history:[playedMovie('film','2026-09-20'),played('watched-1','watched','2026-09-01')],recent,
  series:q=>q.ParentId==='watched'&&!q.IsPlayed?[added('watched-2','watched','2026-09-25')]:[]});
 const cards=await source(a).load({Id:'library'});
 assert.deepEqual(Array.from(cards.slice(0,3),c=>c.item.Id),['watched','film','new-0']);
 assert.equal(cards[0].newEpisode.Id,'watched-2');
 const check=a.calls.find(c=>c.q.ParentId==='watched');
 assert.match(check.q.SortBy,/^DateCreated/);assert.equal(check.q.IsMissing,false);assert.equal(check.q.ExcludeLocationTypes,'Virtual');
});
test('duplicate continuing episodes are paged until the next work is reached',async()=>{
 const a=api(),items=Array.from({length:101},(_,i)=>episode('ep-'+i,'show','2026-10-10')).concat(movie('second','2020-01-01'));
 a.getResumableItems=async(user,q)=>({Items:items.slice(q.StartIndex,q.StartIndex+q.Limit),TotalRecordCount:items.length});
 a.getItems=async()=>({Items:[]});const cards=await source(a).load({Id:'tv'});assert.deepEqual(Array.from(cards,c=>c.item.Id),['show','second']);
});
test('favorites include continuing episodes of a favorite series, and never unrelated works',async()=>{
 const a=api();a.getItems=async(user,q)=>({Items:q.IsFavorite?[{Id:'fav-show',Type:'Series',DateCreated:'2020-01-01'},movie('fav-movie','2026-10-09')]:q.ParentId==='fav-show'?[episode('added','fav-show','2020-01-01')]:[]});
 a.getResumableItems=async()=>({Items:[episode('watch','fav-show','2026-10-10'),movie('not-favorite','2026-10-10')]});
 const cards=await source(a).load({Id:'tigerest-favorites',kind:'favorites'});assert.deepEqual(Array.from(cards,c=>c.item.Id),['fav-show','fav-movie']);assert.equal(cards[0].resumeItem.Id,'watch');
});
test('resume errors fall back to current-library recent additions',async()=>{
 const a=api();a.getResumableItems=async()=>{throw Error('older server');};a.getItems=async()=>({Items:[movie('new','2026-10-10')]});
 assert.equal((await source(a).load({Id:'library'}))[0].item.Id,'new');
});
test('cancelling the home load returns no old data and starts no further request',async()=>{
 const a=api(),abort=new AbortController(),pending=[];
 a.getResumableItems=(user,q)=>{a.calls.push({resume:true,q});return new Promise(r=>pending.push(r));};
 a.getItems=(user,q)=>{a.calls.push({user,q});return new Promise(r=>pending.push(r));};
 const load=source(a).load({Id:'library'},abort.signal),rejected=assert.rejects(load,e=>e.name==='AbortError');
 const started=a.calls.length;abort.abort();
 pending.forEach(release=>release({Items:[episode('old','show','2026-10-10')]}));
 await rejected;assert.equal(a.calls.length,started,'no further page, series check or metadata request');
});
test('release and rating request work-level series and sort using their corresponding fields',async()=>{
 for(const [mode,field] of [['release','PremiereDate'],['rating','CommunityRating']]){
  const a=api();a.getItems=async(user,q)=>{a.calls.push({user,q});return {Items:[movie('a','2026-10-10',{PremiereDate:'2020-01-01',CommunityRating:4}),movie('b','2020-01-01',{PremiereDate:'2026-10-01',CommunityRating:9}),movie('unknown','2026-10-10')]};};
  const cards=await source(a).load({Id:'series',CollectionType:'tvshows'},undefined,mode);
  assert.deepEqual(Array.from(cards,c=>c.item.Id),['b','a','unknown']);assert.ok(a.calls[0].q.SortBy.includes(field));assert.equal(a.calls[0].q.IncludeItemTypes,'Series');assert.ok(!a.calls.some(c=>c.resume));
 }
});
test('recent retains newest-episode ordering and does not request playback',async()=>{
 const a=api();a.getItems=async(user,q)=>({Items:q.Ids?[]:[{...episode('new','show','2020-01-01'),DateCreated:'2026-10-10'},movie('movie','2026-10-09')]});
 const cards=await source(a).load({Id:'library'},undefined,'recent');assert.deepEqual(Array.from(cards,c=>c.item.Id),['show','movie']);assert.ok(a.calls.every(c=>!c.resume));
});
test('shared home setting has the approved default, choices and a registered native route',()=>{
 const groups=JSON.parse(fs.readFileSync(__dirname+'/../resources/settings/settings_description.json')),home=groups.find(g=>g.section==='home');
 assert.ok(home,'home settings group exists');const setting=home.values.find(v=>v.value==='displayOrder');assert.equal(setting.default,'resume');assert.deepEqual(setting.possible_values.map(v=>v[0]),['resume','recent','release','rating']);
 assert.ok(fs.readFileSync(__dirname+'/../native/nativeshell.js','utf8').includes("title: '首页设置'"));
 assert.match(fs.readFileSync(__dirname+'/../native/embycompat.js','utf8'),/'home',/);
 assert.match(fs.readFileSync(__dirname+'/../android/app/src/main/java/top/tigerest/theater/SettingsStore.kt','utf8'),/"home" to setOf\("displayOrder","libraryLayout"\)/);
 // The library layout is edited by its own list, never as a raw text field.
 const layout=home.values.find(v=>v.value==='libraryLayout');assert.equal(layout.default,'');assert.equal(layout.hidden,true);
 assert.match(fs.readFileSync(__dirname+'/../apple/App/SettingsStore.swift','utf8'),/"home": \["displayOrder", "libraryLayout"\]/);
});

function duplicateSeriesServer({resume=[],history=[],recent=[]}={}) {
 const a=server({resume,history,recent}),read=a.getItems;
 a.getItems=async(user,q)=>{
  if(!q.Ids)return read(user,q);
  const ids=q.Ids.split(',');
  // Emby groups aliases in a batch unless explicitly told to return each ID.
  const selected=q.GroupByPresentationUniqueKey===false?ids:ids.filter((id,index)=>id!=='alias'||!ids.includes('show'));
  return {Items:selected.map(Id=>({Id,Type:'Series',Name:'Same displayed title',PresentationUniqueKey:Id==='alias'||Id==='show'?'same-work':Id}))};
 };return a;
}
test('series aliases from resume and completed history merge after ungrouped metadata hydration',async()=>{
 const a=duplicateSeriesServer({resume:[episode('current','show','2026-10-16')],history:[played('older','alias','2026-10-15')],recent:[added('latest','show','2026-10-14')]});
 const cards=await source(a).load({Id:'library'});
 assert.deepEqual(Array.from(cards,c=>c.item.Id),['show']);assert.equal(cards[0].resumeItem.Id,'current');
});
test('recent and continuing aliases merge but a different work with the same title stays visible',async()=>{
 const a=duplicateSeriesServer({resume:[episode('current','show','2026-10-16')],recent:[added('new','alias','2026-10-17'),added('different','other','2026-10-15')]});
 const cards=await source(a).load({Id:'library'});
 assert.deepEqual(Array.from(cards,c=>c.item.Id),['show','other']);assert.equal(cards[0].resumeItem.Id,'current');assert.equal(cards[0].latestEpisode.Id,'new');
});
test('latest completed play of an alias removes an abandoned resume bar',async()=>{
 const a=duplicateSeriesServer({resume:[episode('abandoned','alias','2026-10-10')],history:[played('done','show','2026-10-16')]});
 const cards=await source(a).load({Id:'library'});assert.equal(cards.length,1);assert.equal(cards[0].resumeItem,undefined);
});
test('recent order merges aliases and retains newest episode metadata',async()=>{
 const a=duplicateSeriesServer({recent:[added('new','alias','2026-10-17'),added('old','show','2026-10-15')]});
 const cards=await source(a).load({Id:'library'},undefined,'recent');assert.equal(cards.length,1);assert.equal(cards[0].latestEpisode.Id,'new');
});
test('rating and release deduplicate presentation identities before the visible limit',async()=>{
 for(const mode of ['rating','release']){
  const a=api();a.getItems=async()=>({Items:[...Array.from({length:25},(_,i)=>({Id:'alias-'+i,Type:'Series',Name:'Same',PresentationUniqueKey:'same-work',CommunityRating:9,PremiereDate:'2026-01-01'})),{Id:'other',Type:'Series',Name:'Same',CommunityRating:8,PremiereDate:'2025-01-01'}]});
  const cards=await source(a).load({Id:'library'},undefined,mode);assert.deepEqual(Array.from(cards,c=>c.item.Id),['alias-0','other']);
 }
});
test('pagination counts unique hydrated works across alias IDs for recent and resume',async()=>{
 for(const mode of ['recent','resume']){
  const a=api(),items=Array.from({length:100},(_,i)=>({...episode('ep-'+i,'alias-'+(i%24),'2026-10-16'),DateCreated:'2026-10-16'})).concat(Array.from({length:12},(_,i)=>({...episode('next-'+i,'distinct-'+i,'2026-10-15'),DateCreated:'2026-10-15'})));
  const page=q=>{a.calls.push(q);return slice(items,q);};
  a.getResumableItems=async(u,q)=>mode==='resume'?page(q):{Items:[]};
  a.getItems=async(u,q)=>q.Ids?{Items:q.Ids.split(',').map(Id=>({Id,Type:'Series',PresentationUniqueKey:Id.startsWith('alias-')?'work-'+Math.floor(Number(Id.slice(6))/2):Id}))}:q.IsPlayed||mode==='resume'?{Items:[]}:page(q);
  const cards=await source(a).load({Id:'library'},undefined,mode);
  assert.equal(cards.length,24,mode);assert.ok(a.calls.some(q=>q.StartIndex===100),mode+' must read past aliases');
 }
});
