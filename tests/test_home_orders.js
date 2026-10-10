const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function source(api){const c={Date,Promise,Map,Set,AbortController};c.window=c;vm.runInNewContext(fs.readFileSync(__dirname+'/../native/homeData.js','utf8'),c);return new c.TigerestHomeData(api);}
const movie=(Id,date,extra={})=>({Id,Type:'Movie',DateCreated:date,Name:Id,...extra});
const episode=(Id,SeriesId,date)=>({Id,SeriesId,Type:'Episode',SeriesName:SeriesId,DateCreated:'2026-09-01',UserData:{LastPlayedDate:date,PlaybackPositionTicks:120,PlayedPercentage:40}});
function api(){const calls=[];return {calls,getCurrentUserId:()=> 'current-user',getResumableItems:async(user,q)=>{calls.push({resume:true,user,q});return {Items:[]};},getItems:async(user,q)=>{calls.push({user,q});return {Items:[]};}};}
test('default continues current-library playback and tops up with recent unique works',async()=>{
 const a=api();a.getResumableItems=async(user,q)=>{a.calls.push({resume:true,user,q});return {Items:[movie('watch','2020-01-01',{UserData:{PlaybackPositionTicks:100}})]};};
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
test('24 continuing works do not trigger a recent-library query',async()=>{
 const a=api();a.getResumableItems=async()=>({Items:Array.from({length:24},(_,i)=>movie('watch-'+i,'2020-01-01'))});
 const cards=await source(a).load({Id:'movies'});assert.equal(cards.length,24);assert.equal(a.calls.length,0);
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
test('cancelling a resume request never runs the filler query or returns old data',async()=>{
 const a=api(),abort=new AbortController();let release;a.getResumableItems=()=>new Promise(r=>release=r);a.getItems=()=>{a.calls.push('filler');return new Promise(r=>release=r);};
 const pending=source(a).load({Id:'library'},abort.signal),rejected=assert.rejects(pending,e=>e.name==='AbortError');abort.abort();release({Items:[movie('old','2026-10-10')]});
 await rejected;assert.equal(a.calls.length,0);
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
 assert.match(fs.readFileSync(__dirname+'/../android/app/src/main/java/top/tigerest/theater/SettingsStore.kt','utf8'),/"home" to setOf\("displayOrder"\)/);
});
