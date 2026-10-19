const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function setup(){
 const file=__dirname+'/../native/homeMotion.js';assert.ok(fs.existsSync(file),'shared home motion navigation exists');
 const calls=[],history=['/home'],state={params:{},contextPath:'/home'},account={user:'one',server:'server'};
 const pop=name=>{calls.push([name]);if(history.length>1)history.pop();state.contextPath=history.at(-1);const detail=/^\/item\?id=(.+)$/.exec(state.contextPath);state.params=detail?{id:detail[1]}:{};};
 const router={showItem:async item=>{calls.push(['item',item.Id]);state.params={id:item.Id};state.contextPath='/item?id='+item.Id;history.push(state.contextPath);},back:()=>pop('back'),goHome:()=>{calls.push(['home']);history.push('/home');state.contextPath='/home';},getRouteUrl:item=>'/library?id='+item.Id+'&serverId='+item.ServerId};
 const pageJs={replace:async path=>{calls.push(['replace',path]);state.params={};state.contextPath=path;history[history.length-1]=path;},back:()=>pop('pageback')};
 const manager={currentApiClient:()=>({getCurrentUserId:()=>account.user,serverId:()=>account.server})};
 const listeners={},c={console,Date,Promise,URL,URLSearchParams,setTimeout,clearTimeout,AbortController,location:{hash:'#/home'},document:{addEventListener(type,fn){listeners[type]=fn;},removeEventListener(){}}};c.window=c;
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
test('an episode opened from a page without a return flight returns with the original back only once it leaves',async()=>{
 const s=setup(),effects=[];s.c.TigerestHomeTransitions={poster:async o=>{effects.push(o.direction);return o.navigate();},cancel(){}};
 s.state.params={id:'series'};s.state.contextPath='/item?id=series';s.history.push(s.state.contextPath);
 const episode={Id:'episode',Type:'Episode'};onPage(s,true)(episode);await s.router.showItem(episode);
 await s.router.back();assert.deepEqual(effects,['enter','return']);assert.equal(s.motion.entry,null);
 await s.router.back();assert.deepEqual(effects,['enter','return']);assert.deepEqual(s.calls.at(-1),['back']);
});
