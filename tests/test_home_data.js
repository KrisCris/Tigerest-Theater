const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');

function dataSource(){
 const file=path.join(__dirname,'../native/homeData.js');
 assert.ok(fs.existsSync(file),'the rebuilt home has a shared server-independent data source');
 const context={URL,AbortController,Date,Promise,Map,Set};context.window=context;
 vm.runInNewContext(fs.readFileSync(file,'utf8'),context);
 // These original checks describe the explicit recent-ingestion mode.
 return class extends context.TigerestHomeData {load(library,signal,order='recent'){return super.load(library,signal,order);}};
}
const episode=(id,series,date)=>({Id:id,Type:'Episode',Name:'Episode '+id,SeriesId:series,SeriesName:'Series '+series,DateCreated:date,IndexNumber:5,ParentIndexNumber:1});
function client(items,views=[{Id:'my-library',Name:'My own server library',CollectionType:'tvshows'}]){
 const requests=[];
 return {requests,serverId:()=> 'another-server',serverAddress:()=> 'https://private-server.example',getCurrentUserId:()=> 'another-user',
  getUserViews:async(...args)=>{requests.push(['views',...args]);return {Items:views};},
  getItems:async(user,query,signal)=>{requests.push(['items',user,query,signal]);return {Items:query.Ids?query.Ids.split(',').map(id=>({Id:id,Type:'Series',Name:'Real series '+id,ImageTags:{Primary:'cover-'+id},BackdropImageTags:['backdrop-'+id]})):items,TotalRecordCount:items.length};},
  getImageUrl:(id,options)=>'https://private-server.example/Items/'+id+'/Images/'+options.type};
}
test('all accessible libraries keep their own names, IDs and order; favorites is last',async()=>{
 const Home=dataSource(),api=client([],Array.from({length:7},(_,i)=>({Id:'lib-'+i,Name:'Custom '+i,CollectionType:'movies'})));
 const source=new Home(api);const libraries=await source.libraries();
 assert.equal(libraries.length,8);assert.equal(libraries[6].Id,'lib-6');assert.equal(libraries[0].Name,'Custom 0');assert.equal(libraries.at(-1).kind,'favorites');
});
test('the built-in Tigerest server has three accessible library entries and favorites',async()=>{
 const Home=dataSource(),api=client([],Array.from({length:7},(_,i)=>({Id:'lib-'+i,Name:['1啊你妹','2电影','3看剧'][i]||'Other '+i})));
 api.serverId=()=> '62526c3bf747439c99327ddec5fed4a8';const libraries=await new Home(api).libraries();
 assert.deepEqual(Array.from(libraries,item=>item.Id),['lib-0','lib-1','lib-2','tigerest-favorites']);
 assert.equal(libraries[2].Name,'3看剧');
});
test('series are sorted by newest episode ingestion and open the series, not that episode',async()=>{
 const Home=dataSource(),api=client([episode('e-old','a','2026-09-01'),episode('e-new','b','2026-10-09'),episode('e-mid','a','2026-10-01')]);
 const cards=await new Home(api).load({Id:'my-library',CollectionType:'tvshows'});
 assert.deepEqual(Array.from(cards,c=>c.item.Id),['b','a']);assert.equal(cards[0].item.Type,'Series');assert.equal(cards[0].item.Name,'Real series b');
 assert.equal(cards[1].addedAt,'2026-10-01');assert.equal(cards[0].latestEpisode.Id,'e-new');
 assert.equal(api.requests.find(r=>r[0]==='items')[1],'another-user');
 const query=api.requests.find(r=>r[0]==='items')[2];assert.equal(query.ParentId,'my-library');assert.match(query.SortBy,/DateCreated/);
});
test('movies use their own ingestion time and image URLs from the current server',async()=>{
 const Home=dataSource(),api=client([{Id:'old',Type:'Movie',Name:'Old',DateCreated:'2020-01-01',ImageTags:{Primary:'a'}},
  {Id:'new',Type:'Movie',Name:'New',DateCreated:'2026-10-09',BackdropImageTags:['b']}]);
 const source=new Home(api),cards=await source.load({Id:'movies',CollectionType:'movies'});
 assert.deepEqual(Array.from(cards,c=>c.item.Id),['new','old']);assert.equal(source.artwork(cards[0].item,'hero'),'https://private-server.example/Items/new/Images/Backdrop');
});
test('hero, landscape thumbnails and portrait posters select distinct available image types',()=>{
 const Home=dataSource(),source=new Home(client([])),item={Id:'work',BackdropImageTags:['fanart'],ImageTags:{Primary:'poster',Thumb:'thumbnail'}};
 assert.match(source.artwork(item,'hero'),/Images\/Backdrop$/);assert.match(source.artwork(item,'cover'),/Images\/Thumb$/);assert.match(source.artwork(item,'poster'),/Images\/Primary$/);
});
test('favorite series use their latest episode ingestion, not initial series creation',async()=>{
 const Home=dataSource(),api=client([]);api.getItems=async(user,query)=>{
  api.requests.push(['items',user,query]);
  if(query.IsFavorite)return {Items:[{Id:'series',Type:'Series',Name:'My favorite series',DateCreated:'2020-01-01'},
   {Id:'movie',Type:'Movie',Name:'My favorite movie',DateCreated:'2026-10-01'}]};
  if(query.ParentId==='series')return {Items:[episode('latest','series','2026-10-09')]};
  return {Items:[]};
 };
 const cards=await new Home(api).load({kind:'favorites'});
 assert.deepEqual(Array.from(cards,c=>c.item.Id),['series','movie']);assert.equal(cards[0].addedAt,'2026-10-09');
});
test('favorite series outside the first page can still be the most recently updated work',async()=>{
 const Home=dataSource(),api=client([]);api.getItems=async(user,query)=>{
  if(query.IsFavorite){const items=Array.from({length:101},(_,i)=>({Id:'favorite-'+i,Type:'Series',Name:'Favorite '+i,DateCreated:'2020-01-01'}));return {Items:items.slice(query.StartIndex,query.StartIndex+query.Limit),TotalRecordCount:101};}
  return {Items:[episode('latest',query.ParentId,query.ParentId==='favorite-100'?'2026-10-09':'2026-10-01')]};
 };
 const cards=await new Home(api).load({kind:'favorites'});assert.equal(cards[0].item.Id,'favorite-100');
});
test('episode metadata failure retains usable covers and correct series destinations',async()=>{
 const item=episode('ep','series','2026-10-09');item.Overview='Only this episode: a plot twist';
 const Home=dataSource(),api=client([item]);const original=api.getItems;
 api.getItems=async(user,query,signal)=>{if(query.Ids)throw Error('metadata unavailable');return original(user,query,signal);};
 const cards=await new Home(api).load({Id:'library',CollectionType:'tvshows'});
 assert.equal(cards[0].item.Id,'series');assert.equal(cards[0].item.Name,'Series series');
 assert.equal(cards[0].item.Overview,undefined,'do not present an episode plot as the series synopsis');
});
test('many newly ingested episodes from one series do not hide the next work',async()=>{
 const Home=dataSource(),api=client([]),items=Array.from({length:401},(_,i)=>episode('a-'+i,'a','2026-10-09')).concat(episode('b-1','b','2026-10-01'));
 api.getItems=async(user,query)=>query.Ids?{Items:[]}:{Items:items.slice(query.StartIndex,query.StartIndex+query.Limit),TotalRecordCount:items.length};
 const cards=await new Home(api).load({Id:'library',CollectionType:'tvshows'});assert.equal(cards.length,2);assert.equal(cards[1].item.Id,'b');
});
test('audiobook and music-video libraries request the appropriate accessible item types',async()=>{
 const Home=dataSource();for(const [library,type] of [['audiobooks','MusicAlbum'],['musicvideos','MusicVideo'],['games','Game']]){
  const api=client([]);api.getItems=async(user,query)=>({Items:query.IncludeItemTypes.split(',').includes(type)?[{Id:type,Type:type,Name:type,DateCreated:'2026-10-09'}]:[]});
  const cards=await new Home(api).load({Id:'own-'+library,CollectionType:library});assert.equal(cards.length,1,library);
 }
});
test('an aborted account or library request cannot return a previous result',async()=>{
 const Home=dataSource(),api=client([]),abort=new AbortController();let finish;
 api.getItems=()=>new Promise(resolve=>finish=resolve);
 const request=new Home(api).load({Id:'library',CollectionType:'movies'},abort.signal);
 abort.abort();finish({Items:[{Id:'old-account',Type:'Movie',DateCreated:'2026-10-09'}]});
 await assert.rejects(request,error=>error.name==='AbortError');
});
