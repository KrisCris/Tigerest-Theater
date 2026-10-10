const assert=require('node:assert/strict'),path=require('node:path'),withBrowser=require('./community_browser.cjs');
const root=path.resolve(__dirname,'..'),embedded=process.argv.includes('--webengine')||!!process.env.TIGEREST_ANDROID_FIXTURE;
const routes={
 '/':{type:'text/html',body:'<meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;background:#101722}.page{position:fixed;inset:0;padding:40px;background:#17263a}.hide{display:none}img{width:120px;height:180px}.detailImageContainer{width:240px;height:360px;margin-left:200px;background:url(/poster.svg) center/cover}</style><div id="library" class="page view-tv-tv"><h1>媒体夹</h1><div class="itemsContainer"><div class="card"><div class="cardImageContainer"><img class="cardImage" src="/poster.svg"></div></div></div></div><div id="detail" class="page hide"><div class="detailImageContainer"></div></div>'+ (embedded?'':'<script src="/transitions.js"></script><script src="/motion.js"></script>')},
 '/poster.svg':{type:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="480" height="720"><rect width="480" height="720" fill="#7d643d"/></svg>'},
 '/transitions.js':{path:path.join(root,'native/homeTransitions.js')},'/motion.js':{path:path.join(root,'native/homeMotion.js')}
};
routes['/backdrop.js']={path:path.join(root,'native/homeBackdrop.js')};if(!embedded)routes['/'].body=routes['/'].body.replace('<script src="/transitions.js">','<script src="/backdrop.js"></script><script src="/transitions.js">');
withBrowser(routes,async({evaluate,call,url})=>{
 await call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
 assert.equal(await evaluate('typeof TigerestHomeTransitions.prewarm'),'function','current page can prewarm the expensive background');
 await evaluate(`window.motionFrame=predicate=>new Promise((resolve,reject)=>{const deadline=performance.now()+8000;const observe=()=>{const result=predicate();if(result)return resolve(result);if(performance.now()>deadline)return reject(Error('motion phase was not observed'));requestAnimationFrame(observe);};requestAnimationFrame(observe);});window.state={params:{topParentId:'library'},contextPath:'/tv?topParentId=library'};window.libraryRoot=document.querySelector('#library');libraryRoot.querySelector('.itemsContainer').getItemFromElement=()=>({Id:'work',Type:'Movie'});window.show=name=>{document.querySelectorAll('.page').forEach(n=>n.classList.toggle('hide',n.id!==name));state.contextPath=name==='detail'?'/item?id=work':'/tv?topParentId=library';state.params=name==='detail'?{id:'work'}:{topParentId:'library'};};window.router={showItem:()=>show('detail'),back:()=>window.returnGate?new Promise(resolve=>{window.releaseReturn=()=>{show('library');resolve();};}):show('library'),goHome:()=>{},getRouteUrl:()=>'/tv?topParentId=library'};TigerestHomeMotion.attach({router,pageJs:{replace:()=>show('library')},manager:{currentApiClient:()=>({serverId:()=> 'fixture',getCurrentUserId:()=> 'one'})},viewManager:{currentViewInfo:()=>state}});`);
 const edgePixels=await evaluate(`(async()=>{const root=document.createElement('div');Object.assign(root.style,{position:'fixed',inset:'0',background:'rgb(40,84,200)'});document.body.append(root);const r=await TigerestHomeBackdrop.build(root,new AbortController().signal),c=document.createElement('canvas');c.width=r.width;c.height=r.height;const ctx=c.getContext('2d');ctx.drawImage(r.bitmap,0,0);const corner=Array.from(ctx.getImageData(0,0,1,1).data),center=Array.from(ctx.getImageData(c.width>>1,c.height>>1,1,1).data);r.bitmap.close();root.remove();return {corner,center};})()`);
 assert.deepEqual(edgePixels.corner,[40,84,200,255],'blur clamps the viewport edges instead of revealing a different page through alpha');
 assert.deepEqual(edgePixels.center,[40,84,200,255]);
 assert.equal(await evaluate('TigerestHomeTransitions.prewarm()'),true);
 // A completed page entrance must stay completed in the frozen background.
 // Emby's important animation rule otherwise starts again inside the shadow tree.
 await evaluate(`document.body.classList.add('skinBody');const s=document.createElement('style');s.textContent='.skinBody .page.motion-enter{animation:fixturePageEnter 160ms both!important}@keyframes fixturePageEnter{from{transform:translateY(72px)}to{transform:none}}';document.head.append(s);libraryRoot.classList.add('motion-enter');true`);
 await evaluate('Promise.all(libraryRoot.getAnimations().map(a=>a.finished))');await evaluate('TigerestHomeTransitions.prewarm()');
 const frozenGeometry=await evaluate(`(()=>{const live=libraryRoot.querySelector('img').getBoundingClientRect(),copy=document.querySelector('.tigerest-motion-cache').firstElementChild.shadowRoot.querySelector('#library img').getBoundingClientRect();return {live:live.toJSON(),copy:copy.toJSON()}})()`);
 assert.ok(Math.max(...['x','y','width','height'].map(k=>Math.abs(frozenGeometry.live[k]-frozenGeometry.copy[k])))<1,'frozen background stays aligned with the live poster at the first frame: '+JSON.stringify(frozenGeometry));
 await evaluate(`TigerestHomeTransitions.invalidate(false);window.titleEntrance=document.querySelector('#library h1').animate([{opacity:0,transform:'translateX(-52px)'},{opacity:1,transform:'none'}],{duration:180,fill:'both'});true`);
 await evaluate('TigerestHomeTransitions.prewarm()');await evaluate('titleEntrance.finished');
 assert.equal(await evaluate(`getComputedStyle(document.querySelector('.tigerest-motion-cache').firstElementChild.shadowRoot.querySelector('h1')).opacity`),'1','prewarming waits for the real entrance rather than caching its hidden first frame');
 await evaluate('libraryRoot.className=libraryRoot.className;true');
 assert.equal(await evaluate('TigerestHomeTransitions.cacheState.ready'),true,'writing an unchanged CSS class cannot discard the prewarmed scene');
 assert.ok(await evaluate('TigerestHomeTransitions.cacheState.ready&&TigerestHomeTransitions.cacheState.bytes<=240*innerHeight/innerWidth*240*4+1000'));
 const hotClickOpacity=await evaluate(`window.press=()=>document.querySelector('#library img').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));press();window.pending=router.showItem('work');getComputedStyle(document.querySelector('.tigerest-motion-layer .tigerest-motion-frozen')).opacity`);
 assert.equal(hotClickOpacity,'0','a cached small background avoids painting the full-size frozen page on the click frame');
 await evaluate('pending');
 const hot=await evaluate('TigerestHomeTransitions.last');assert.equal(hot.kind,'poster','poster clicks in a directly opened library use the shared transition');assert.equal(hot.cacheHit,true);assert.equal(hot.lightCacheHit,true,'the already styled page snapshot is consumed without copying the live page on click');assert.equal(hot.syncRasterMs,0);assert.ok(hot.landingErrorPx<2);
 await evaluate('TigerestHomeTransitions.prewarm()');
 const returnClickVisibility=await evaluate(`window.returnGate=true;window.returning=router.back();window.returnShrinkFrame=motionFrame(()=>{const n=document.querySelector('.tigerest-motion-poster');return n&&n.getBoundingClientRect().width<239.9;});getComputedStyle(document.querySelector('.tigerest-motion-layer .tigerest-motion-frozen').shadowRoot.querySelector('.detailImageContainer')).visibility`);
 assert.equal(returnClickVisibility,'hidden','cached CSS-background posters are hidden under their moving copy');
 assert.ok(await evaluate('returnShrinkFrame'),'returning starts by shrinking the detail poster while its destination prepares');
 await evaluate('motionFrame(()=>!!window.releaseReturn)');assert.equal(await evaluate('state.params.id'),'work');
 await evaluate('returnGate=false;releaseReturn();true');
 await evaluate('returning');assert.equal(await evaluate('state.contextPath'),'/tv?topParentId=library');
 await evaluate('TigerestHomeTransitions.prewarm()');
 await evaluate(`document.querySelector('#library h1').textContent='另一媒体夹';true`);
 assert.equal(await evaluate('TigerestHomeTransitions.cacheState.ready'),false,'content changes invalidate the previous background');
 // The clicked poster is excluded from the backdrop. Supply another visible
 // image so this test really holds a source-background decode.
 await evaluate(`new Promise((resolve,reject)=>{const img=document.createElement('img');img.id='cold-backdrop-image';Object.assign(img.style,{position:'fixed',right:'20px',top:'20px'});img.onload=resolve;img.onerror=reject;img.src='/poster.svg';libraryRoot.append(img);})`);
 // Hold actual decoding until motion is observed. The observer runs in the
 // browser, so CDP delivery and runner scheduling cannot miss the click phase.
 const firstPosterFrame=await evaluate(`(()=>{window.originalBitmap=createImageBitmap;window.coldDecoders=[];window.createImageBitmap=(...args)=>new Promise(resolve=>coldDecoders.push(()=>originalBitmap(...args).then(resolve)));TigerestHomeTransitions.invalidate();window.clickedPosterRect=libraryRoot.querySelector('img').getBoundingClientRect().toJSON();press();window.coldStart=performance.now();window.cold=router.showItem('work');window.coldStarted=motionFrame(()=>{const n=document.querySelector('.tigerest-motion-veil'),p=document.querySelector('.tigerest-motion-poster'),rect=p?.getBoundingClientRect();const moved=rect&&Math.max(...['x','y','width','height'].map(k=>Math.abs(rect[k]-clickedPosterRect[k])))>.25;return n&&+getComputedStyle(n).opacity>0&&moved&&coldDecoders.length?{present:true,opacity:+getComputedStyle(n).opacity,old:state.params.topParentId==='library',poster:rect.toJSON(),elapsedMs:performance.now()-coldStart}:null;});return document.querySelector('.tigerest-motion-poster').getBoundingClientRect().toJSON()})()`);
 const clickedPoster=await evaluate('clickedPosterRect');
 assert.ok(Math.max(...['x','y','width','height'].map(k=>Math.abs(firstPosterFrame[k]-clickedPoster[k])))<1,'the floating poster starts exactly at the clicked poster');
 const started=await evaluate('coldStarted');
 assert.ok(started.present&&started.opacity>0&&started.old,'cold background preparation does not prevent the animation from starting: '+JSON.stringify(started));
 const earlyPoster=started.poster;
 assert.ok(Math.abs(earlyPoster.width-clickedPoster.width)>.25||Math.abs(earlyPoster.x-clickedPoster.x)>.25||Math.abs(earlyPoster.y-clickedPoster.y)>.25,'the poster itself moves promptly while the cold background is still preparing');
 await evaluate('window.createImageBitmap=originalBitmap;Promise.all(coldDecoders.map(release=>release()))');
 await evaluate('cold');assert.equal(await evaluate('TigerestHomeTransitions.last.syncRasterMs'),0);await evaluate('router.back()');await evaluate(`document.querySelector('#cold-backdrop-image').remove();TigerestHomeTransitions.prewarm()`);
 // A destination-only decode can outlast the visible flight. It must not hold
 // the poster or keep the revealed page locked, nor attach a late canvas.
 await evaluate(`new Promise(resolve=>{const img=document.createElement('img');img.id='slow-detail-image';Object.assign(img.style,{position:'fixed',right:'30px',bottom:'30px'});img.onload=resolve;img.src='/poster.svg';document.querySelector('#detail').append(img);})`);
 await evaluate('TigerestHomeTransitions.prewarm()');
 await evaluate(`window.destinationDecoders=[];window.createImageBitmap=(node,...args)=>node.closest?.('#detail')?new Promise(resolve=>destinationDecoders.push(()=>originalBitmap(node,...args).then(resolve))):originalBitmap(node,...args);press();window.slowDestination=router.showItem('work');true`);
 await evaluate('slowDestination');assert.ok(await evaluate('destinationDecoders.length>0'),'destination decoding is still held after the visible flight');
 assert.equal(await evaluate('TigerestHomeTransitions.busy'),false,'a late destination bitmap cannot keep the finished page locked');
 assert.equal(await evaluate(`document.querySelectorAll('.tigerest-motion-layer,.tigerest-motion-poster,[data-tigerest-poster-held]').length`),0);
 await evaluate('window.createImageBitmap=originalBitmap;Promise.all(destinationDecoders.map(release=>release())).then(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))');
 assert.equal(await evaluate(`document.querySelectorAll('.tigerest-motion-layer,.tigerest-motion-poster').length`),0,'late background results stay detached after completion');
 await evaluate(`window.createImageBitmap=originalBitmap;document.querySelector('#slow-detail-image').remove();router.back()`);
 // A different host is deliberately served without CORS. Android's appasset
 // posters have the same origin-clean restriction and cannot cross a worker.
 const foreign=new URL('/poster.svg',url);foreign.hostname=foreign.hostname==='127.0.0.1'?'localhost':'127.0.0.1';
 await evaluate(`new Promise((resolve,reject)=>{const img=document.querySelector('#library img');img.onload=()=>resolve(true);img.onerror=()=>reject(Error('foreign fixture image'));img.src=${JSON.stringify(foreign.href)};})`);
 assert.equal(await evaluate('TigerestHomeTransitions.prewarm()'),true,'cross-origin posters still produce a cached small background');
 await evaluate('press();window.foreignEntry=router.showItem("work");true');await evaluate('foreignEntry');
 const foreignMetric=await evaluate('TigerestHomeTransitions.last');assert.equal(foreignMetric.cacheHit,true);assert.equal(foreignMetric.backgroundPhases[0].rasterThread,'main-small');await evaluate('router.back()');
 await evaluate(`TigerestHomeTransitions.invalidate(false);window.savedWorker=Worker;window.Worker=undefined;window.noRaster=TigerestHomeTransitions.poster({source:libraryRoot.querySelector('img'),findTarget:()=>document.querySelector('#detail .detailImageContainer'),navigate:()=>new Promise(resolve=>{window.releaseNoRaster=()=>{show('detail');resolve();};})});true`);
 await evaluate('motionFrame(()=>!!window.releaseNoRaster)');
 assert.ok(await evaluate(`(()=>{const n=document.querySelector('.tigerest-motion-veil');return +getComputedStyle(n).opacity>.99&&getComputedStyle(n).backgroundColor==='rgb(11, 13, 18)'})()`),'the DOM fallback covers its blur borders before the real route changes');
 assert.equal(await evaluate('state.params.topParentId'),'library');
 await evaluate('releaseNoRaster();true');await evaluate(`noRaster.then(()=>{window.Worker=savedWorker;show('library')})`);
 await evaluate('TigerestHomeMotion.reset()');assert.equal(await evaluate('TigerestHomeTransitions.cacheState.ready'),false,'account reset releases the cached background');
 await evaluate('TigerestHomeTransitions.prewarm()');await call('Emulation.setDeviceMetricsOverride',{width:900,height:700,deviceScaleFactor:1,mobile:false});assert.equal(await evaluate('TigerestHomeTransitions.cacheState.ready'),false,'viewport changes cannot use the old background');
 await call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});assert.equal(await evaluate('TigerestHomeTransitions.prewarm()'),false);assert.equal(await evaluate('TigerestHomeTransitions.cacheState.bytes'),0);
 console.log('async background/cache fixture:',JSON.stringify({checks:24,hot,started,foreignMetric}));
},{gpu:true,visible:true}).catch(e=>{console.error(e);process.exitCode=1});
