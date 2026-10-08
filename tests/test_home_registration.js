const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function modules(){
 const registrations=new Map(),calls=[];
 const context={console,AbortController,Date,setTimeout:()=>1,clearTimeout(){},setInterval:()=>1,clearInterval(){},location:{origin:'http://other.invalid'},jmpInfo:{version:'test'},NativeShell:{AppHost:{}},
  TigerestHomeGallery:class {constructor(view,options){calls.push(['mount',view,options]);}start(options){calls.push(['start',options]);return Promise.resolve();}stop(){calls.push(['stop']);}destroy(){calls.push(['destroy']);}scrollToBeginning(){calls.push(['scroll']);}}};
 context.window=context;context.globalThis=context;
 vm.runInNewContext(fs.readFileSync(__dirname+'/../native/embycompat.js','utf8'),context);
 context.define=(id,deps,factory)=>registrations.set(id,{deps,factory});
 return {registrations,calls,context};
}
test('original home controller is replaced while the original favorites controller is retained',()=>{
 const {registrations}=modules();assert.ok(registrations.has('home/hometab.js'),'take over the original home module');
 assert.ok(!registrations.has('home/favorites.js'),'favorites remains managed by Emby');
});

test('favorites selects the original HomeView tab instead of relying on its malformed URL helper',()=>{
 const {registrations,calls}=modules(),module=registrations.get('home/hometab.js');
 assert.ok(module.deps.includes('modules/maintabsmanager.js'),'use the active original home tabs');
 function Base(view){this.view=view;}Base.prototype.onTemplateLoaded=function(){};
 const selected=[],tabs={selectedTabIndex:index=>selected.push(index)},router={showFavorites(){throw Error('legacy helper loses the tab parameter');}};
 const Controller=module.factory({default:Base},{default:{currentApiClient:()=>null}},{default:router},{default:tabs}).default;
 new Controller({classList:{remove(){}},removeAttribute(){}},{},{}).onTemplateLoaded();
 calls[0][2].openFavorites();assert.deepEqual(selected,[1]);
});
test('native fullscreen is requested once per login session and can be reset on logout',async()=>{
 const {registrations,calls,context}=modules(),fullscreen=[];context.api={window:{setFullScreen:async value=>fullscreen.push(value)}};
 function Base(view){this.view=view;}Base.prototype.onTemplateLoaded=function(){};
 let address='https://own.example';const api={serverId:()=> 'own-server',serverAddress:()=>address,getCurrentUserId:()=> 'user'},manager={currentApiClient:()=>api};
 const Controller=registrations.get('home/hometab.js').factory({default:Base},{default:manager},{default:{}}).default;
 const view={classList:{remove(){}},removeAttribute(){}},controller=new Controller(view,{},{});controller.onTemplateLoaded();
 const enter=calls[0][2].enterFullscreen;assert.equal(typeof enter,'function');
 await enter(api);address='http://192.168.0.2';await enter(api);assert.deepEqual(fullscreen,[true]);context.TigerestHomeReset();await enter(api);assert.deepEqual(fullscreen,[true,true]);
 const abort=new AbortController();abort.abort();context.TigerestHomeReset();await enter(api,abort.signal);assert.equal(fullscreen.length,2);
});
test('logout during a pending fullscreen request cannot mark the next login as already entered',async()=>{
 const {registrations,calls,context}=modules();let requests=0,release;
 context.api={window:{setFullScreen:()=>{requests++;return requests===1?new Promise(resolve=>release=resolve):Promise.resolve();}}};
 function Base(view){this.view=view;}Base.prototype.onTemplateLoaded=function(){};
 const api={serverId:()=> 'server',serverAddress:()=> 'https://server.example',getCurrentUserId:()=> 'user'},manager={currentApiClient:()=>api};
 const Controller=registrations.get('home/hometab.js').factory({default:Base},{default:manager},{default:{}}).default;
 new Controller({classList:{remove(){}},removeAttribute(){}},{},{}).onTemplateLoaded();const enter=calls[0][2].enterFullscreen;
 const first=enter(api);await Promise.resolve();await Promise.resolve();assert.equal(requests,1);
 context.TigerestHomeReset();release();await first;await enter(api);assert.equal(requests,2);
});
test('a surviving home start marks a shared in-flight fullscreen request after the first start is aborted',async()=>{
 const {registrations,calls,context}=modules();let requests=0,release;
 context.api={window:{setFullScreen:()=>{requests++;return requests===1?new Promise(resolve=>release=resolve):Promise.resolve();}}};
 function Base(view){this.view=view;}Base.prototype.onTemplateLoaded=function(){};
 const api={serverId:()=> 'server',serverAddress:()=> 'https://server.example',getCurrentUserId:()=> 'user'};
 const Controller=registrations.get('home/hometab.js').factory({default:Base},{default:{currentApiClient:()=>api}},{default:{}}).default;
 new Controller({classList:{remove(){}},removeAttribute(){}},{},{}).onTemplateLoaded();const enter=calls[0][2].enterFullscreen,abort=new AbortController();
 const first=enter(api,abort.signal);await Promise.resolve();await Promise.resolve();abort.abort();const second=enter(api);await Promise.resolve();
 release();await Promise.all([first,second]);await enter(api);assert.equal(requests,1);
});
test('home supports an already loaded Emby section template and owns its pause/destroy lifecycle',async()=>{
 const {registrations,calls}=modules();const module=registrations.get('home/hometab.js');assert.ok(module,'home registration exists');
 function Base(view){this.view=view;this.scroller={legacy:true};}Base.prototype.onTemplateLoaded=function(){if(this.view.classList.contains('scrollFrameY'))this.scroller=this.view;};Base.prototype.onResume=function(){};Base.prototype.onPause=function(){};Base.prototype.destroy=function(){};
 const api={serverId:()=> 'own-server'},router={showItem(){}},manager={currentApiClient:()=>api};
 const Controller=module.factory({default:Base},{default:manager},{default:router}).default;
 const classes=new Set(['tabContent','scrollFrameY']);const view={classList:{contains:cls=>classes.has(cls),remove:cls=>classes.delete(cls)},removeAttribute(){}},controller=new Controller(view,{},{});controller.onTemplateLoaded();
 assert.equal(controller.scroller,null,'discard detached legacy section scroller');
 await controller.onResume({});controller.scrollToBeginning();controller.onPause();await controller.onResume({});controller.destroy();
 assert.deepEqual(calls.map(call=>call[0]),['mount','start','scroll','stop','start','destroy']);
 assert.equal(calls[0][2].apiProvider(),api);assert.equal(calls[0][2].router,router);
});
