const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');

function dataSource(libraryLayout){
 const file=path.join(__dirname,'../native/homeData.js');
 assert.ok(fs.existsSync(file),'the rebuilt home has a shared server-independent data source');
 const context={URL,AbortController,Date,Promise,Map,Set,jmpInfo:{settings:{home:{libraryLayout}}}};context.window=context;
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
test('movie badges use explicit account playback state and never infer missing user metadata',async()=>{
 const Home=dataSource(),api=client([
  {Id:'unplayed',Type:'Movie',UserData:{Played:false}},
  {Id:'played',Type:'Movie',UserData:{Played:true}},
  {Id:'unknown',Type:'Movie'},
  {Id:'partial',Type:'Movie',UserData:{Played:false,PlayedPercentage:45}},
  {Id:'bad',Type:'Movie',UserData:{Played:'false'}}
 ]);
 const cards=await new Home(api).load({Id:'movies',CollectionType:'movies'});
 assert.deepEqual(Array.from(cards,c=>c.watchState?.unwatched),[true,false,null,true,null]);
 assert.equal(api.requests.find(r=>r[0]==='items')[2].EnableUserData,true,'request account playback metadata in recent mode');
});
function countClient(series,counts){
 const api=client([]);api.getItems=async(user,query,signal)=>{
  api.requests.push(['items',user,query,signal]);
  if(query.IncludeItemTypes==='Episode'&&query.ParentId!=='library'){
   assert.equal(query.Recursive,true);assert.equal(query.IsMissing,false);assert.equal(query.IsVirtualUnaired,false);
   assert.equal(query.IsPlaceHolder,false);assert.equal(query.ExcludeLocationTypes,'Virtual','ask compatible servers to exclude missing and virtual entries');
   assert.equal(query.Limit,0,'count without fetching every episode');assert.equal(query.EnableTotalRecordCount,true);
   const value=counts[query.ParentId];if(value instanceof Error)throw value;
   return {Items:[],TotalRecordCount:query.IsPlayed===true?value?.played:value?.total};
  }
  return {Items:series,TotalRecordCount:series.length};
 };return api;
}
async function loadWithProgress(Home,api,library,signal,order){
 const source=new Home(api),cards=await source.load(library,signal,order);
 await source.loadWatchProgress(cards,signal);return cards;
}
test('series counts use actual episode records and explicit played counts instead of stale aggregate metadata',async()=>{
 const Home=dataSource(),api=countClient([
  {Id:'partial',Type:'Series',RecursiveItemCount:13,ChildCount:3,UserData:{Played:false,UnplayedItemCount:4}},
  {Id:'complete',Type:'Series',RecursiveItemCount:12,ChildCount:1,UserData:{Played:true,UnplayedItemCount:0}},
  {Id:'new',Type:'Series',UserData:{Played:false}},
  {Id:'empty',Type:'Series',UserData:{Played:false}}
 ],{partial:{total:12,played:8},complete:{total:12,played:12},new:{total:4,played:0},empty:{total:0,played:0}});
 const cards=await loadWithProgress(Home,api,{Id:'library',CollectionType:'tvshows'},undefined,'release');
 assert.deepEqual(JSON.parse(JSON.stringify(cards.map(c=>c.watchState))),[
  {unwatched:true,played:8,total:12},{unwatched:false,played:12,total:12},
  {unwatched:true,played:0,total:4},{unwatched:null,played:0,total:0}
 ]);
 assert.equal(api.requests.filter(r=>r[2].Limit===0).length,8,'even plausible aggregates require explicit played counts');
});
test('unavailable or inconsistent episode counts omit the fraction without inventing zero',async()=>{
 const Home=dataSource(),api=countClient([
  {Id:'offline',Type:'Series',UserData:{Played:false}},
  {Id:'unknown',Type:'Series'},
  {Id:'invalid',Type:'Series',UserData:{Played:true}},
  {Id:'missing',Type:'Series',UserData:{Played:false}}
 ],{offline:Error('offline'),unknown:{},invalid:{total:4,played:7},missing:{total:null,played:null}});
 const cards=await loadWithProgress(Home,api,{Id:'library',CollectionType:'tvshows'},undefined,'rating');
 assert.deepEqual(JSON.parse(JSON.stringify(cards.map(c=>c.watchState))),[
  {unwatched:true},{unwatched:null},{unwatched:false},{unwatched:true}
 ]);
});
test('recent episode cards obtain account-specific series data before displaying a watch state',async()=>{
 const Home=dataSource(),api=client([episode('newest','show','2026-10-13')]);
 api.getItems=async(user,query)=>{
  if(query.Ids){assert.equal(query.EnableUserData,true);return {Items:[{Id:'show',Type:'Series',UserData:{Played:false}}]};}
  if(query.ParentId==='show')return {Items:[],TotalRecordCount:query.IsPlayed===true?3:10};
  return {Items:[episode('newest','show','2026-10-13')]};
 };
 const cards=await loadWithProgress(Home,api,{Id:'library',CollectionType:'tvshows'});
 assert.deepEqual(cards[0].watchState&&JSON.parse(JSON.stringify(cards[0].watchState)),{unwatched:true,played:3,total:10});
});
test('only the final 24 visible series request counts, with bounded request concurrency',async()=>{
 const Home=dataSource(),api=countClient(Array.from({length:40},(_,i)=>({Id:'series-'+i,Type:'Series'})),Object.fromEntries(Array.from({length:40},(_,i)=>['series-'+i,{total:12,played:5}])));
 const get=api.getItems;let active=0,peak=0;
 api.getItems=async(...args)=>{active++;peak=Math.max(peak,active);await new Promise(r=>setImmediate(r));try{return await get(...args);}finally{active--;}};
 const cards=await loadWithProgress(Home,api,{Id:'library',CollectionType:'tvshows'},undefined,'rating');
 assert.equal(cards.length,24);assert.ok(peak<=8,'at most four series load two counts at a time');
 assert.equal(api.requests.filter(r=>r[2].Limit===0).length,48);
});
test('cancelling episode-count requests rejects the home load',async()=>{
 const Home=dataSource(),api=client([]),abort=new AbortController();const releases=[];let counting;
 const reachedCounts=new Promise(resolve=>counting=resolve);
 api.getItems=async(user,query)=>{
  if(query.Limit===0){counting();return new Promise(resolve=>releases.push(resolve));}
  return {Items:[{Id:'show',Type:'Series'}]};
 };
 const source=new Home(api),cards=await source.load({Id:'library',CollectionType:'tvshows'},abort.signal,'release');
 const pending=source.loadWatchProgress(cards,abort.signal);
 // A pending count must obey the same account/navigation cancellation as the initial query.
 await Promise.race([reachedCounts,new Promise((_,reject)=>setTimeout(()=>reject(Error('home did not request episode counts')),100))]);
 const rejected=assert.rejects(pending,error=>error.name==='AbortError');abort.abort();releases.forEach(release=>release({Items:[],TotalRecordCount:1}));
 await rejected;
});
test('the saved layout chooses and orders home libraries per server and account',async()=>{
 const Home=dataSource(),views=['a','b','c','d'].map(id=>({Id:id,Name:'Library '+id,CollectionType:'movies'}));
 const api=client([],views),key='another-server/another-user';
 assert.equal(Home.layoutKey(api),key);
 const layout=JSON.stringify({[key]:['c','!a','tigerest-favorites','gone','b'],'another-server/someone-else':['!b']});
 const rows=Home.arrange(await new Home(api).candidates(),Home.readLayout(key,layout));
 assert.deepEqual(Array.from(rows,row=>(row.visible?'':'!')+row.library.Id),['c','!a','tigerest-favorites','b','d'],'saved order first, a removed library dropped, a new one appended shown');
 const saved=Home.writeLayout(key,rows,layout);
 assert.deepEqual(Object.keys(JSON.parse(saved)),['another-server/someone-else',key],'the latest server moves last');
 assert.deepEqual(JSON.parse(saved)[key],['c','!a','tigerest-favorites','b','d']);
 assert.equal(Home.writeLayout(key,null,JSON.stringify({[key]:['a']})),'','restoring the only layout clears the setting');
 assert.deepEqual(Home.readLayout(key,'not json'),null);
 assert.deepEqual(Home.readLayout(key,JSON.stringify({[key]:'a'})),null);
});
test('the home shows the chosen libraries, and every library when nothing is left',async()=>{
 const views=['a','b','c'].map(id=>({Id:id,Name:'Library '+id})),key='another-server/another-user';
 const shown=async layout=>Array.from(await new (dataSource(JSON.stringify({[key]:layout})))(client([],views)).libraries(),l=>l.Id);
 assert.deepEqual(await shown(['b','!a','!tigerest-favorites']),['b','c']);
 assert.deepEqual(await shown(['!a','!b','!c','!tigerest-favorites']),['a','b','c','tigerest-favorites'],'an all-hidden layout cannot empty the home');
 assert.deepEqual(Array.from(await new (dataSource(JSON.stringify({'another-server/someone-else':['!a']})))(client([],views)).libraries(),l=>l.Id),
  ['a','b','c','tigerest-favorites'],'another account on the same server keeps its own layout');
});
test('the built-in server layout chooses only among its approved entries',async()=>{
 const api=client([],Array.from({length:6},(_,i)=>({Id:'lib-'+i,Name:'Library '+i})));
 api.serverId=()=> '62526c3bf747439c99327ddec5fed4a8';
 const Home=dataSource(JSON.stringify({['62526c3bf747439c99327ddec5fed4a8/another-user']:['lib-5','lib-2','!lib-0']}));
 assert.deepEqual(Array.from(await new Home(api).libraries(),l=>l.Id),['lib-2','lib-1','tigerest-favorites'],'a library outside the approved three never appears');
});
test('layouts give way oldest first to stay within the Android text setting limit',()=>{
 const Home=dataSource(),rows=Array.from({length:20},(_,i)=>({library:{Id:'x'.repeat(30)+String(i).padStart(2,'0')},visible:true}));
 let text='';
 for(let server=0;server<12;server++)text=Home.writeLayout('server-'+server+'/user',rows,text);
 const kept=Object.keys(JSON.parse(text));
 assert.ok(text.length<=4000,'setting length '+text.length);
 assert.equal(kept.at(-1),'server-11/user');assert.ok(!kept.includes('server-0/user'));
});
