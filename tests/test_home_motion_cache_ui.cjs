const assert=require('node:assert/strict'),path=require('node:path'),withBrowser=require('./community_browser.cjs');
const root=path.resolve(__dirname,'..'),embedded=process.argv.includes('--webengine')||!!process.env.TIGEREST_ANDROID_FIXTURE;
const routes={
 '/':{type:'text/html',body:'<meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;background:#101722}.page{position:fixed;inset:0;padding:40px;background:#17263a}.hide{display:none}img{width:120px;height:180px}.detailImageContainer{width:240px;height:360px;margin-left:200px;background:url(/poster.svg) center/cover}</style><div id="library" class="page view-tv-tv"><h1>媒体夹</h1><div class="itemsContainer"><div class="card"><div class="cardImageContainer"><img class="cardImage" src="/poster.svg"></div></div></div></div><div id="detail" class="page hide"><div class="detailImageContainer"></div></div>'+ (embedded?'':'<script src="/transitions.js"></script><script src="/motion.js"></script>')},
 '/poster.svg':{type:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="480" height="720"><rect width="480" height="720" fill="#7d643d"/></svg>'},
 '/transitions.js':{path:path.join(root,'native/homeTransitions.js')},'/motion.js':{path:path.join(root,'native/homeMotion.js')}
};
routes['/backdrop.js']={path:path.join(root,'native/homeBackdrop.js')};if(!embedded)routes['/'].body=routes['/'].body.replace('<script src="/transitions.js">','<script src="/backdrop.js"></script><script src="/transitions.js">');
withBrowser(routes,async({evaluate,call,url})=>{
 assert.equal(await evaluate('typeof TigerestHomeTransitions.prewarm'),'function','current page can prewarm the expensive background');
 await evaluate(`window.state={params:{topParentId:'library'},contextPath:'/tv?topParentId=library'};window.libraryRoot=document.querySelector('#library');libraryRoot.querySelector('.itemsContainer').getItemFromElement=()=>({Id:'work',Type:'Movie'});window.show=name=>{document.querySelectorAll('.page').forEach(n=>n.classList.toggle('hide',n.id!==name));state.contextPath=name==='detail'?'/item?id=work':'/tv?topParentId=library';state.params=name==='detail'?{id:'work'}:{topParentId:'library'};};window.router={showItem:()=>show('detail'),back:()=>show('library'),goHome:()=>{},getRouteUrl:()=>'/tv?topParentId=library'};TigerestHomeMotion.attach({router,pageJs:{replace:()=>show('library')},manager:{currentApiClient:()=>({serverId:()=> 'fixture',getCurrentUserId:()=> 'one'})},viewManager:{currentViewInfo:()=>state}});`);
 assert.equal(await evaluate('TigerestHomeTransitions.prewarm()'),true);
 await evaluate(`TigerestHomeTransitions.invalidate(false);window.titleEntrance=document.querySelector('#library h1').animate([{opacity:0,transform:'translateX(-52px)'},{opacity:1,transform:'none'}],{duration:180,fill:'both'});true`);
 await evaluate('TigerestHomeTransitions.prewarm()');await evaluate('titleEntrance.finished');
 assert.equal(await evaluate(`getComputedStyle(document.querySelector('.tigerest-motion-cache').firstElementChild.shadowRoot.querySelector('h1')).opacity`),'1','prewarming waits for the real entrance rather than caching its hidden first frame');
 await evaluate('libraryRoot.className=libraryRoot.className;true');
 assert.equal(await evaluate('TigerestHomeTransitions.cacheState.ready'),true,'writing an unchanged CSS class cannot discard the prewarmed scene');
 assert.ok(await evaluate('TigerestHomeTransitions.cacheState.ready&&TigerestHomeTransitions.cacheState.bytes<=240*innerHeight/innerWidth*240*4+1000'));
 await evaluate(`window.press=()=>document.querySelector('#library img').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));press();window.pending=router.showItem('work');true`);await evaluate('pending');
 const hot=await evaluate('TigerestHomeTransitions.last');assert.equal(hot.kind,'poster','poster clicks in a directly opened library use the shared transition');assert.equal(hot.cacheHit,true);assert.equal(hot.lightCacheHit,true,'the already styled page snapshot is consumed without copying the live page on click');assert.equal(hot.syncRasterMs,0);assert.ok(hot.landingErrorPx<2);
 await evaluate('TigerestHomeTransitions.prewarm()');await evaluate('window.returning=router.back();true');
 assert.equal(await evaluate(`getComputedStyle(document.querySelector('.tigerest-motion-layer .tigerest-motion-frozen').shadowRoot.querySelector('.detailImageContainer')).visibility`),'hidden','cached CSS-background posters are hidden under their moving copy');
 await evaluate('returning');assert.equal(await evaluate('state.contextPath'),'/tv?topParentId=library');
 await evaluate('TigerestHomeTransitions.prewarm()');
 await evaluate(`document.querySelector('#library h1').textContent='另一媒体夹';true`);
 assert.equal(await evaluate('TigerestHomeTransitions.cacheState.ready'),false,'content changes invalidate the previous background');
 // Hold asynchronous resizing to simulate a cache miss. The outgoing veil must
 // already animate while that work remains unfinished.
 await evaluate(`window.originalBitmap=createImageBitmap;window.createImageBitmap=(...args)=>new Promise(resolve=>setTimeout(resolve,350)).then(()=>originalBitmap(...args));TigerestHomeTransitions.invalidate();press();window.cold=router.showItem('work');true`);
 await new Promise(r=>setTimeout(r,80));
 const started=await evaluate(`(()=>{const n=document.querySelector('.tigerest-motion-veil');return {present:!!n,opacity:n?+getComputedStyle(n).opacity:0,old:state.params.topParentId==='library'}})()`);
 assert.ok(started.present&&started.opacity>0&&started.old,'cold background preparation does not prevent the animation from starting');
 await evaluate('cold');assert.equal(await evaluate('TigerestHomeTransitions.last.syncRasterMs'),0);await evaluate('router.back()');await evaluate('window.createImageBitmap=originalBitmap;TigerestHomeTransitions.prewarm()');
 // A different host is deliberately served without CORS. Android's appasset
 // posters have the same origin-clean restriction and cannot cross a worker.
 const foreign=new URL('/poster.svg',url);foreign.hostname=foreign.hostname==='127.0.0.1'?'localhost':'127.0.0.1';
 await evaluate(`new Promise((resolve,reject)=>{const img=document.querySelector('#library img');img.onload=()=>resolve(true);img.onerror=()=>reject(Error('foreign fixture image'));img.src=${JSON.stringify(foreign.href)};})`);
 assert.equal(await evaluate('TigerestHomeTransitions.prewarm()'),true,'cross-origin posters still produce a cached small background');
 await evaluate('press();window.foreignEntry=router.showItem("work");true');await evaluate('foreignEntry');
 const foreignMetric=await evaluate('TigerestHomeTransitions.last');assert.equal(foreignMetric.cacheHit,true);assert.equal(foreignMetric.backgroundPhases[0].rasterThread,'main-small');await evaluate('router.back()');
 await evaluate('TigerestHomeMotion.reset()');assert.equal(await evaluate('TigerestHomeTransitions.cacheState.ready'),false,'account reset releases the cached background');
 await evaluate('TigerestHomeTransitions.prewarm()');await call('Emulation.setDeviceMetricsOverride',{width:900,height:700,deviceScaleFactor:1,mobile:false});assert.equal(await evaluate('TigerestHomeTransitions.cacheState.ready'),false,'viewport changes cannot use the old background');
 await call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});assert.equal(await evaluate('TigerestHomeTransitions.prewarm()'),false);assert.equal(await evaluate('TigerestHomeTransitions.cacheState.bytes'),0);
 console.log('async background/cache fixture:',JSON.stringify({checks:13,hot,started,foreignMetric}));
},{gpu:true,visible:true}).catch(e=>{console.error(e);process.exitCode=1});
