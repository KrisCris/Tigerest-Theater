const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function setup(api,extra={}){
 const file=__dirname+'/../native/homeMotion.js';assert.ok(fs.existsSync(file),'shared home motion navigation exists');
 const calls=[],history=['/home'],state={params:{},contextPath:'/home'},account={user:'one',server:'server'};
 const pop=name=>{calls.push([name]);if(history.length>1)history.pop();state.contextPath=history.at(-1);const detail=/^\/item\?id=(.+)$/.exec(state.contextPath);state.params=detail?{id:detail[1]}:{};};
 const router={showItem:async item=>{calls.push(['item',item.Id]);state.params={id:item.Id};state.contextPath='/item?id='+item.Id;history.push(state.contextPath);},back:()=>pop('back'),goHome:()=>{calls.push(['home']);history.push('/home');state.contextPath='/home';},getRouteUrl:item=>'/library?id='+item.Id+'&serverId='+item.ServerId};
 const pageJs={replace:async path=>{calls.push(['replace',path]);state.params={};state.contextPath=path;history[history.length-1]=path;},back:()=>pop('pageback')};
 const manager={currentApiClient:()=>api||({getCurrentUserId:()=>account.user,serverId:()=>account.server})};
 const store=new Map(),localStorage={getItem:key=>store.has(key)?store.get(key):null,setItem:(key,value)=>store.set(key,String(value))};
 const listeners={},c={console,Date,Promise,URL,URLSearchParams,setTimeout,clearTimeout,AbortController,performance,localStorage,location:{hash:'#/home'},document:{addEventListener(type,fn){listeners[type]=fn;},removeEventListener(){}},...extra};c.window=c;
 vm.runInNewContext(fs.readFileSync(file,'utf8'),c);const motion=c.TigerestHomeMotion,originalHome=router.goHome,dispose=motion.attach({router,pageJs,manager,viewManager:{currentViewInfo:()=>state}});
 return {motion,router,pageJs,account,state,calls,dispose,c,originalHome,history,listeners};
}
const library={Id:'library',Type:'CollectionFolder',CollectionType:'movies'},card={item:{Id:'work',Type:'Movie'}};
test('an unbound client navigates libraries without entering the Emby transition renderer',async()=>{
 const s=setup();s.dispose();
 s.c.TigerestHomeTransitions={library(){throw Error('Emby route bindings are unavailable');}};
 let navigated=0;
 const result=await s.motion.openLibrary({library,navigate:()=>{navigated++;return 'routed';}});
 assert.equal(navigated,1);assert.equal(result,'routed');
 assert.equal(s.motion.handleNativeBack(),false);
});
test('a work opened from home returns by replacing detail with its library, then normal home history',async()=>{
 const s=setup();await s.motion.openItem({card,library,navigate:()=>s.router.showItem(card.item)});
 await s.router.back();assert.deepEqual(s.calls,[['item','work'],['replace','/library?id=library&serverId=server']]);
 await s.router.back();assert.deepEqual(s.calls.at(-1),['back']);assert.equal(s.motion.entry,null);
});
test('favorites return through the valid original favorites URL',async()=>{
 const s=setup();await s.motion.openItem({card,library:{Id:'tigerest-favorites',kind:'favorites'},navigate:()=>s.router.showItem(card.item)});await s.router.back();assert.deepEqual(s.calls.at(-1),['replace','/home?tab=favorites']);await s.router.back();assert.deepEqual(s.calls.at(-1),['pageback']);assert.deepEqual(s.history,['/home']);
});
test('direct Favorites tab return replaces the tab entry instead of pushing another home',async()=>{
 const s=setup();await s.motion.openLibrary({library:{Id:'favorites',kind:'favorites'},navigate:()=>s.pageJs.replace('/home?tab=favorites')});
 await s.router.back();assert.deepEqual(s.calls.at(-1),['replace','/home']);assert.deepEqual(s.history,['/home']);
});
test('reset during an outstanding library effect cannot restore a new-account return context',async()=>{
 const s=setup();let release;s.c.TigerestHomeTransitions={library:()=>new Promise(r=>release=r),cancel(){}};
 const pending=s.motion.openLibrary({library,navigate:()=>{}});s.motion.reset();s.account.user='two';s.state.contextPath='/library';release();await pending;
 assert.equal(s.motion.handleNativeBack(),false);
});
test('return context is invalid after account switching or when a different detail is active',async()=>{
 const s=setup();await s.motion.openItem({card,library,navigate:()=>s.router.showItem(card.item)});s.account.user='two';await s.router.back();assert.deepEqual(s.calls.at(-1),['back']);
 s.account.user='one';await s.motion.openItem({card,library,navigate:()=>s.router.showItem(card.item)});s.state.params.id='another-work';await s.router.back();assert.deepEqual(s.calls.at(-1),['back']);
});
test('a failed detail route restores its previous context and permits retry',async()=>{
 const s=setup();await assert.rejects(s.motion.openItem({card,library,navigate:async()=>{throw Error('offline');}}),/offline/);assert.equal(s.motion.entry,null);
 await s.motion.openItem({card,library,navigate:()=>s.router.showItem(card.item)});await s.router.back();assert.equal(s.calls.at(-1)[0],'replace');
});
test('navigation effects wrap real route calls and Home delegates to the original goHome',async()=>{
 const s=setup(),effects=[];s.c.TigerestHomeTransitions={poster:async options=>{effects.push('poster');return options.navigate();},homeReturn:async options=>{effects.push('home');return options.navigate();},library:async options=>{effects.push('library');return options.navigate();},cancel(){effects.push('cancel');}};
 await s.motion.openItem({card,library,navigate:()=>s.router.showItem(card.item)});await s.router.back();await s.router.goHome();
 await s.motion.openLibrary({library,navigate:async()=>s.calls.push(['library'])});
 assert.deepEqual(effects,['poster','poster','home','library']);assert.ok(s.calls.some(c=>c[0]==='home'));
 s.motion.reset();assert.equal(s.motion.entry,null);assert.equal(effects.at(-1),'cancel');
});
test('disposing hooks preserves other wrappers installed after it',()=>{
 const s=setup(),external=()=>42;s.router.back=external;s.dispose();assert.equal(s.router.back,external);assert.equal(s.router.goHome,s.originalHome);s.router.goHome();assert.deepEqual(s.calls.at(-1),['home']);
});
test('library back uses the original history action inside the home return effect',async()=>{
 const s=setup(),effects=[];s.c.TigerestHomeTransitions={library:async o=>o.navigate(),homeReturn:async o=>{effects.push('home');return o.navigate();}};
 await s.motion.openLibrary({library,navigate:async()=>{s.state.contextPath='/library?id=library';}});
 await s.router.back();assert.deepEqual(effects,['home']);assert.deepEqual(s.calls.at(-1),['back']);
});
test('Android hardware back consumes owned detail/library navigation and active transitions only',async()=>{
 const s=setup();assert.equal(s.motion.handleNativeBack(),false);
 await s.motion.openItem({card,library,navigate:()=>s.router.showItem(card.item)});assert.equal(s.motion.handleNativeBack(),true);
 await new Promise(r=>setTimeout(r,0));assert.equal(s.calls.at(-1)[0],'replace');
 s.motion.reset();s.c.TigerestHomeTransitions={busy:true};assert.equal(s.motion.handleNativeBack(),true);
});
// The visible Emby page, and a pointer press on a card's artwork inside it.
function onPage(s,detail){
 const page={classList:{contains:()=>false},getBoundingClientRect:()=>({width:800,height:600}),matches:selector=>detail&&selector==='.view-item-item',querySelectorAll:()=>[],contains:()=>true};
 s.c.document.querySelectorAll=()=>[page];
 return item=>{const image={isConnected:true},list={getItemFromElement:()=>item},card={dataset:{},querySelector:selector=>selector==='img.cardImage'?image:null,closest:selector=>selector==='.itemsContainer'?list:card};
  s.listeners.pointerdown({target:{closest:()=>card}});return image;};
}
test('an episode pressed on its series page flies in, then back to the series, then back to the library',async()=>{
 const s=setup(),effects=[];s.c.TigerestHomeTransitions={poster:async o=>{effects.push([o.direction,o.itemId,!!o.prepareTarget,o.source]);return o.navigate();},cancel(){}};
 await s.motion.openItem({card:{item:{Id:'series',Type:'Series'}},library,navigate:()=>s.router.showItem({Id:'series',Type:'Series'})});
 const episode={Id:'episode',Type:'Episode'},image=onPage(s,true)(episode);
 await s.router.showItem(episode);
 assert.deepEqual(effects.at(-1),['enter','episode',false,image]);assert.equal(s.state.params.id,'episode');
 await s.router.back();
 assert.deepEqual(effects.at(-1).slice(0,3),['return','episode',false],'a detail page has no virtual library list to prepare');
 assert.deepEqual(s.calls.at(-1),['back']);assert.equal(s.state.params.id,'series');assert.equal(s.motion.entry.itemId,'series');
 await s.router.back();
 assert.deepEqual(effects.at(-1).slice(0,3),['return','series',true]);assert.deepEqual(s.calls.at(-1),['replace','/library?id=library&serverId=server']);
 assert.equal(s.motion.entry,null);
});
test('episodes outside detail pages and other works on detail pages keep their original navigation',async()=>{
 const s=setup(),effects=[];s.c.TigerestHomeTransitions={poster:async o=>{effects.push(o.itemId);return o.navigate();},cancel(){}};
 const episode={Id:'episode',Type:'Episode'};onPage(s,false)(episode);await s.router.showItem(episode);
 const similar={Id:'similar',Type:'Series'};onPage(s,true)(similar);await s.router.showItem(similar);
 assert.deepEqual(effects,[]);assert.deepEqual(s.calls,[['item','episode'],['item','similar']]);
});
// A server whose library holds 80 works, the pressed one at index 61.
function wallServer(length=80,work=61){
 const sent=[],items=Array.from({length},(_,i)=>({Id:i===work?'work':'other-'+i}));
 const api={serverId:()=>'server',getCurrentUserId:()=>'one',getItems(user,options){sent.push(options);
  const start=options.StartIndex||0;return Promise.resolve({Items:items.slice(start,start+options.Limit)});}};
 return {api,sent};
}
const wallQuery={ParentId:'library',StartIndex:0,Limit:50,SortBy:'SortName',Recursive:true};
test('a wall query learned on a return is on its way as the next return is pressed',async()=>{
 const {api,sent}=wallServer(),s=setup(api);
 await s.motion.openItem({card,library,navigate:()=>s.router.showItem(card.item)});await s.router.back();
 // The wall's own first query, as it loads after the return.
 await api.getItems('one',{...wallQuery});assert.equal(sent.length,1);
 await s.motion.openItem({card,library,navigate:()=>s.router.showItem(card.item)});await s.router.back();
 assert.equal(sent.length,2,'the press sent the learned query before the wall asked');
 const answer=await api.getItems('one',{Recursive:true,SortBy:'SortName',Limit:50,StartIndex:0,ParentId:'library'});
 assert.equal(sent.length,2,'the wall received the query already on its way');assert.equal(answer.Items.length,50);
 await api.getItems('one',{...wallQuery});assert.equal(sent.length,3,'a sent query answers one request');
 // Only the first query of a loading wall is learned, not later ones for the library.
 await api.getItems('one',{...wallQuery,SortBy:'DateCreated'});
 assert.deepEqual(JSON.parse(s.c.localStorage.getItem('tigerest-wall-queries'))['server|one|library'],wallQuery);
});
test('an index read while the home is idle sends the rows holding the work on an Emby return',async()=>{
 const {api,sent}=wallServer(),s=setup(api,{TigerestServer:{kind:'emby'},setTimeout:(fn,ms,...rest)=>setTimeout(fn,ms>=1000?0:ms,...rest)});
 s.c.localStorage.setItem('tigerest-wall-queries',JSON.stringify({'server|one|library':wallQuery}));
 s.motion.setGallery({libraries:[library]});await new Promise(r=>setTimeout(r,30));
 assert.deepEqual([sent.at(-1).Limit,sent.at(-1).Fields,sent.at(-1).ParentId],[2000,'SortName,PresentationUniqueKey','library']);
 await s.motion.openItem({card,library,navigate:()=>s.router.showItem(card.item)});await s.router.back();
 assert.deepEqual(sent.slice(-2).map(q=>[q.StartIndex,q.Limit,q.EnableTotalRecordCount]),[[0,50,undefined],[50,50,false]]);
});
test('an Emby return deep in a wall sends every chunk on the screen around the work',async()=>{
 const {api,sent}=wallServer(300,120),s=setup(api,{TigerestServer:{kind:'emby'},setTimeout:(fn,ms,...rest)=>setTimeout(fn,ms>=1000?0:ms,...rest)});
 s.c.localStorage.setItem('tigerest-wall-queries',JSON.stringify({'server|one|library':wallQuery}));
 s.motion.setGallery({libraries:[library]});await new Promise(r=>setTimeout(r,30));
 await s.motion.openItem({card,library,navigate:()=>s.router.showItem(card.item)});await s.router.back();
 assert.deepEqual(sent.slice(-4).map(q=>q.StartIndex),[0,50,100,150],'the rows above the work and a chunk below it');
});
// Expected rectangles are the posters measured on Emby 4.10 and Jellyfin 10.11.
function presetPage(kind,width,height,classes){
 const s=setup(undefined,{innerWidth:width,innerHeight:height,TigerestServer:{kind},document:{addEventListener(){},removeEventListener(){},documentElement:{classList:{contains:name=>classes.includes(name)}}}}),seen=[];
 const round=rect=>rect&&Object.fromEntries(Object.entries(rect).map(([key,value])=>[key,Math.round(value*10)/10]));
 s.c.TigerestHomeTransitions={poster:async o=>{seen.push([o.landingKey,round(o.presetRect)]);return o.navigate();},cancel(){}};
 return async item=>{await s.motion.openItem({card:{item:{Id:'work',...item}},library,navigate:()=>s.router.showItem({Id:'work'})});s.motion.reset();return seen.at(-1);};
}
test('a first press flies to where Emby draws the detail poster',async()=>{
 const wide=presetPage('emby',2560,1356,['withFullDrawer']);
 assert.deepEqual(await wide({Type:'Movie',PrimaryImageAspectRatio:.6667}),['detail|emby|Movie|portrait',{x:291.9,y:103.7,width:328.3,height:492.4}]);
 assert.deepEqual(await wide({Type:'Episode'}),['detail|emby|Episode|thumb',{x:291.9,y:103.7,width:703.3,height:395.6}]);
 assert.deepEqual((await wide({Type:'Movie',PrimaryImageAspectRatio:1.78}))[1],{x:291.9,y:103.7,width:703.3,height:395.6},'a wide primary image draws a wide card');
 assert.deepEqual((await presetPage('emby',1920,1080,['withFullDrawer'])({Type:'Season'}))[1],{x:291.9,y:103.7,width:258.1,height:387.2});
 assert.deepEqual((await presetPage('emby',1366,768,['withFullDrawer'])({Type:'Series'}))[1],{x:277.5,y:103.7,width:328.3,height:492.4});
 assert.deepEqual((await presetPage('emby',1600,700,['withFullDrawer'])({Type:'Movie'}))[1],{x:291.9,y:103.7,width:316,height:474},'a short window limits the poster height');
});
test('a first press flies to where Jellyfin draws the detail poster',async()=>{
 const page=presetPage('jellyfin',1920,1080,['layout-desktop']);
 assert.deepEqual(await page({Type:'Movie'}),['detail|jellyfin|Movie|portrait',{x:63,y:239.2,width:480,height:720}]);
 assert.deepEqual((await page({Type:'Episode'}))[1],{x:63,y:239.2,width:480,height:270});
 assert.deepEqual((await presetPage('jellyfin',1600,600,['layout-desktop'])({Type:'BoxSet'}))[1],{x:52.4,y:67.2,width:400,height:600},'a short window keeps the poster below the header');
});
test('layouts that were not measured fly from a lift instead of a guessed landing',async()=>{
 const none=async(kind,width,height,classes,item)=>(await presetPage(kind,width,height,classes)(item))[1];
 assert.equal(await none('emby',950,800,['withFullDrawer'],{Type:'Movie'}),null,'narrow Emby page');
 assert.equal(await none('emby',1920,1080,[],{Type:'Movie'}),null,'Emby drawer not docked');
 assert.equal(await none('emby',1920,1080,['withFullDrawer'],{Type:'Season',PrimaryImageAspectRatio:1.78}),null,'wide folder image');
 assert.equal(await none('jellyfin',1000,700,['layout-desktop'],{Type:'Movie'}),null,'Jellyfin mobile layout');
 assert.equal(await none('jellyfin',1200,1600,['layout-desktop'],{Type:'Movie'}),null,'portrait window');
 assert.equal(await none('jellyfin',1920,1080,['layout-desktop'],{Type:'MusicAlbum'}),null,'unmeasured type');
 assert.equal(await none('jellyfin',1920,1080,['layout-desktop'],{Type:'Movie',PrimaryImageAspectRatio:1}),null,'square image');
});
test('an episode opened from a page without a return flight returns with the original back only once it leaves',async()=>{
 const s=setup(),effects=[];s.c.TigerestHomeTransitions={poster:async o=>{effects.push(o.direction);return o.navigate();},cancel(){}};
 s.state.params={id:'series'};s.state.contextPath='/item?id=series';s.history.push(s.state.contextPath);
 const episode={Id:'episode',Type:'Episode'};onPage(s,true)(episode);await s.router.showItem(episode);
 await s.router.back();assert.deepEqual(effects,['enter','return']);assert.equal(s.motion.entry,null);
 await s.router.back();assert.deepEqual(effects,['enter','return']);assert.deepEqual(s.calls.at(-1),['back']);
});
