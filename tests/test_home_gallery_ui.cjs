const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const withBrowser=require('./community_browser.cjs');
const root=path.resolve(__dirname,'..'),embedded=process.argv.includes('--webengine')||Boolean(process.env.TIGEREST_ANDROID_FIXTURE);
const routes={
 '/':{type:'text/html',body:'<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;background:#101216;color:white;font:16px system-ui}header{height:84px}#home{position:relative}</style><header class="skinHeader">Tigerest Theater</header><aside class="mainDrawer">Original Emby navigation</aside><main id="home"></main>'+(!embedded?'<script src="/data.js"></script><script src="/gallery.js"></script>':'')},
 '/data.js':{path:path.join(root,'native/homeData.js')},'/gallery.js':{path:path.join(root,'native/homeGallery.js')},
 '/poster.svg':{type:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900"><defs><linearGradient id="g"><stop stop-color="#163748"/><stop offset="1" stop-color="#4d3159"/></linearGradient></defs><rect width="1600" height="900" fill="url(#g)"/><circle cx="1100" cy="350" r="240" fill="#c98b52"/><path d="M0 700 L600 400 L1000 900 H0" fill="#08131c"/></svg>'}
};
for(const name of ['anime','movies','series','favorites'])routes['/art/'+name+'.png']={type:'image/png',path:path.join(root,'native/home-art',name+'.png')};
withBrowser(routes,async({evaluate,call})=>{
 // The animation contract must not depend on the runner's accessibility
 // preference. Reduced motion is verified separately below.
 await call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
 const result=await evaluate('('+ (async function(embedded){
  const check=(value,message)=>{if(!value)throw Error(message);};
  const wait=async(fn)=>{for(let i=0;i<400;i++){if(fn())return;await new Promise(r=>setTimeout(r,10));}throw Error('condition timeout: '+JSON.stringify({visibility:document.visibilityState,animations:window.gallery?.animations.map(a=>({state:a.playState,time:a.currentTime}))}));};
  check(window.TigerestHomeGallery,'rebuilt gallery is available');
  // This fixture verifies the Gallery in isolation; actual navigation has its own fixture.
  window.TigerestHomeMotion=null;
  const opened=[],requests=[];let heldResolve,currentUser='one';
  const api={serverId:()=> 'fixture-server',serverAddress:()=>location.origin,getCurrentUserId:()=>currentUser,
   getUserViews:async()=>({Items:Array.from({length:7},(_,i)=>({Id:'library'+i,Name:'我的媒体库 '+(i+1),CollectionType:i===0?'tvshows':'movies'}))}),
   getItems:async(user,query,signal)=>{
    requests.push({user,query});if(query.Ids)return {Items:query.Ids.split(',').map(id=>({Id:id,Type:'Series',Name:'剧集 '+id,BackdropImageTags:['image']}))};
    if(query.ParentId==='library1')return new Promise(resolve=>heldResolve=resolve);
    if(query.ParentId==='library6')return {Items:Array.from({length:24},(_,i)=>({Id:'long-'+i,Name:'作品 '+i,Type:'Movie',DateCreated:'2026-10-09',BackdropImageTags:['image']}))};
    return {Items:[{Id:query.ParentId+'-new',Name:'最近入库作品',Overview:'<p>这是作品简介。<br>用于预览剧情，人物相遇 &amp; 故事开始。</p>',Type:'Movie',DateCreated:'2026-10-09',BackdropImageTags:['image']},
     {Id:query.ParentId+'-old',Name:'较早作品',Type:'Movie',DateCreated:'2026-10-01',BackdropImageTags:['image']}]};
   },getImageUrl:()=>location.origin+'/poster.svg'};
  localStorage.setItem('tigerest-home-style','gallery');
  window.gallery=new TigerestHomeGallery(document.getElementById('home'),{apiProvider:()=>api,router:{showItem:(item,server)=>opened.push({item,server}),showFavorites:()=>opened.push({favorite:true})},artBase:embedded?undefined:location.origin+'/art'});
  // Hold the actual browser timelines so slow startup cannot finish the
  // entrance before its ordering assertions inspect it.
  const enter=gallery.enter,animateText=gallery.animateText;
  gallery.enter=function(generation){enter.call(this,generation);this.animations.forEach(animation=>{animation.pause();animation.currentTime=0;});};
  gallery.animateText=function(...args){animateText.apply(this,args);this.textAnimations.forEach(animation=>{animation.pause();animation.currentTime=0;});};
  await gallery.start({});
  // Synthetic pointer events do not establish CSS :hover. Actual gallery
  // focus keeps its automatic carousel paused during manual-selection checks.
  gallery.hero.focus({preventScroll:true});
  check(gallery.root.contains(document.activeElement),'manual-selection fixture has actual gallery focus');
  check(gallery.root.dataset.style==='cinema'&&!document.querySelector('.tg-home-style-button'),'chosen cinema design replaces the comparison controls and old style preference');
  check(getComputedStyle(document.querySelector('.skinHeader')).display==='none'&&getComputedStyle(document.querySelector('.mainDrawer')).display==='none','original chrome hidden only on the new home');
  check(document.querySelectorAll('.tg-library').length===8,'all seven accessible libraries plus favorites');
  check(document.querySelector('.tg-library').textContent.includes('我的媒体库 1'),'actual library name');
  check(!document.querySelector('.tg-home').classList.contains('tg-entered'),'poster waits for both entrance groups');
  check(Number(getComputedStyle(gallery.title).opacity)===0,'title stays hidden during the flying lists');
  const railEntrance=gallery.animations.find(animation=>animation.effect.target===gallery.rail);
  check(railEntrance&&gallery.animations.some(animation=>animation.effect.target===gallery.nav),'both entrance groups animate');
  gallery.animations.filter(animation=>animation!==railEntrance).forEach(animation=>animation.finish());
  await Promise.resolve();await Promise.resolve();
  check(!gallery.root.classList.contains('tg-entered'),'finishing the media list alone cannot reveal the poster');
  railEntrance.finish();
  await wait(()=>document.querySelector('.tg-home').classList.contains('tg-entered'));
  check(document.querySelector('.tg-home').classList.contains('tg-ready'),'poster reveals after content and entrances');
  check(Number(getComputedStyle(gallery.title).opacity)===0,'title enters separately after the poster begins revealing');
  gallery.enter=enter;gallery.animateText=animateText;gallery.textAnimations.forEach(animation=>animation.play());
  await wait(()=>Number(getComputedStyle(gallery.title).opacity)>.95);
  check(gallery.overview.textContent==='这是作品简介。 用于预览剧情，人物相遇 & 故事开始。'&&!gallery.overview.querySelector('*'),'overview renders readable plain text');
  document.querySelectorAll('.tg-cover')[1].dispatchEvent(new PointerEvent('pointerover',{bubbles:true,pointerType:'mouse'}));
  check(Number(getComputedStyle(gallery.title).opacity)===0,'a carousel change resets the independent title entrance');
  await wait(()=>Number(getComputedStyle(gallery.title).opacity)>.95);
  check(gallery.title.textContent==='较早作品','carousel text ends on the selected work');
  check(gallery.overview.hidden,'a work without an overview has no empty summary block');
  const create=document.createElement.bind(document);
  document.createElement=function(tag,...args){const node=create(tag,...args);if(tag==='img')Object.defineProperty(node,'src',{set(){},configurable:true});return node;};
  const previousScenery=gallery.scenery;
  gallery.select(0,false);
  await wait(()=>Number(getComputedStyle(gallery.title).opacity)>.95);
  check(gallery.title.textContent==='最近入库作品'&&!gallery.overview.hidden,'stalled artwork never blocks work metadata or synopsis');
  check(!gallery.heroImages.querySelector('.is-visible'),'stalled artwork cannot retain a previous work behind new metadata');
  check(!previousScenery.isConnected,'a stalled backdrop cannot retain the previous ambient artwork');
  document.createElement=create;
  document.querySelector('.tg-cover').dispatchEvent(new PointerEvent('pointerover',{bubbles:true,pointerType:'mouse'}));
  await wait(()=>Number(getComputedStyle(gallery.title).opacity)>.95);
  document.querySelector('.tg-home-hero').click();document.querySelector('.tg-cover').click();
  check(opened.length===2&&opened.every(x=>x.item.Id==='library0-new'&&x.server==='fixture-server'),'hero and cover open work detail');
  const library=document.querySelector('[data-library-id="library2"]');library.click();check(opened.at(-1).item.Id==='library2','library uses original Emby item routing');
  document.querySelector('[data-library-id="tigerest-favorites"]').click();check(opened.at(-1).favorite,'favorites uses original favorites route');
  const first=document.querySelector('[data-library-id="library1"]');first.dispatchEvent(new PointerEvent('pointerover',{bubbles:true,pointerType:'mouse'}));await wait(()=>heldResolve);
  library.dispatchEvent(new PointerEvent('pointerover',{bubbles:true,pointerType:'mouse'}));await wait(()=>document.querySelector('.tg-cover')?.dataset.itemId==='library2-new');
  heldResolve({Items:[{Id:'stale',Type:'Movie',Name:'过期作品',DateCreated:'2026-10-10'}]});await new Promise(r=>setTimeout(r,60));
  check(!document.querySelector('[data-item-id="stale"]'),'slow previous hover cannot overwrite selected library');
  // Route/account changes cancel pending responses and discard cached artwork.
  first.dispatchEvent(new PointerEvent('pointerover',{bubbles:true,pointerType:'mouse'}));await new Promise(r=>setTimeout(r,10));
  currentUser='two';gallery.stop();heldResolve?.({Items:[{Id:'old-user',Type:'Movie',Name:'前账号',DateCreated:'2026-10-10'}]});
  await gallery.start({});await wait(()=>document.querySelector('.tg-cover'));
  check(!document.querySelector('[data-item-id="old-user"]'),'old account media discarded');
  check(requests.at(-1).user==='two','new account uses own API identity');
  const image=document.querySelector('.tg-library img');await wait(()=>image.complete);
  check(image.naturalWidth>0,'packaged category artwork loads in this browser');
  // Pin the entrance before its first visible frame. Keyboard navigation must
  // reveal layout content even when a background compositor holds its timeline.
  gallery.animations.forEach(animation=>{animation.pause();animation.currentTime=0;});
  if (embedded) await window.api?.window.raiseWindow?.();
  const lastLibrary=document.querySelector('[data-library-id="library6"]');lastLibrary.focus({preventScroll:true});
  const libraryFrame=gallery.libraryList.getBoundingClientRect(),focusedLibrary=lastLibrary.getBoundingClientRect();
  check(gallery.libraryList.scrollTop>0||gallery.libraryList.scrollLeft>0,'keyboard focus reveals a library outside the list viewport: '+JSON.stringify({frame:libraryFrame.toJSON(),item:focusedLibrary.toJSON(),scrollTop:gallery.libraryList.scrollTop,scrollLeft:gallery.libraryList.scrollLeft,active:document.activeElement?.dataset.libraryId,animations:gallery.animations.map(a=>a.playState)}));
  check(focusedLibrary.top>=libraryFrame.top-1&&focusedLibrary.bottom<=libraryFrame.bottom+1&&focusedLibrary.left>=libraryFrame.left-1&&focusedLibrary.right<=libraryFrame.right+1,'focused library is fully inside its list viewport');
  check(focusedLibrary.top>=0&&focusedLibrary.bottom<=innerHeight&&focusedLibrary.left>=0&&focusedLibrary.right<=innerWidth,'keyboard focus removes the offscreen entrance transform');
  await wait(()=>document.querySelectorAll('.tg-cover').length===24);const lastCover=document.querySelectorAll('.tg-cover')[23];lastCover.focus({preventScroll:true});
  const coverFrame=gallery.coverList.getBoundingClientRect(),focusedCover=lastCover.getBoundingClientRect();
  check(gallery.coverList.scrollLeft>0,'keyboard focus reveals a cover outside the carousel viewport');
  check(focusedCover.left>=coverFrame.left-1&&focusedCover.right<=coverFrame.right+1&&focusedCover.top>=coverFrame.top-1&&focusedCover.bottom<=coverFrame.bottom+1,'focused cover is fully inside the carousel viewport');
  const views=api.getUserViews;api.getUserViews=async()=>{throw Error('offline');};
  await gallery.start({});check(document.querySelector('.tg-home-retry').hidden===false,'library failure exposes retry');
  api.getUserViews=views;document.querySelector('.tg-home-retry').click();await wait(()=>document.querySelector('.tg-cover'));
  check(document.querySelector('.tg-cover').dataset.itemId==='library0-new','retry after a failed return to home reloads libraries');
  gallery.stop();check(!gallery.timer&&gallery.abort.signal.aborted,'pause cancels carousel and requests');
  check(getComputedStyle(document.querySelector('.skinHeader')).display!=='none'&&getComputedStyle(document.querySelector('.mainDrawer')).display!=='none','leaving home restores original navigation');
  await gallery.start({});await wait(()=>document.querySelector('.tg-home').classList.contains('tg-entered'));
  return {libraries:8,navigation:opened.length,requests:requests.length,artwork:image.naturalWidth};
 }).toString()+')('+JSON.stringify(embedded)+')');
 console.log('home gallery interaction checks:',result);
 await evaluate('new Promise(r=>setTimeout(r,1600))');
 await evaluate('gallery.hero.focus({preventScroll:true});gallery.cards[0].item.Name="这是一个用于验证窄屏排版的较长作品标题，标题和简介应始终留在海报内";gallery.cards[0].item.Overview="主角们在各自的故事中相遇，面对新的选择，逐渐发现彼此的秘密与梦想。".repeat(8);gallery.select(0,false);new Promise(r=>setTimeout(r,1500))');
 const directory=path.join(root,'build/home-exploration-2026-10-09');fs.mkdirSync(directory,{recursive:true});
 for(const [width,height,label] of [[1440,900,'wide'],[900,700,'compact'],[390,844,'phone'],[844,390,'landscape'],[320,480,'short-phone'],[568,320,'short-landscape']]){
  await call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
  await evaluate('new Promise(r=>setTimeout(r,80))');
  const bounds=await evaluate('(()=>{const e=document.querySelector(".tg-home"),h=document.querySelector(".tg-home-stage"),n=document.querySelector(".tg-home-nav");return {width:innerWidth,pageWidth:document.documentElement.scrollWidth,hero:h.getBoundingClientRect().toJSON(),copy:gallery.heroCopy.getBoundingClientRect().toJSON(),overview:gallery.overview.getBoundingClientRect().toJSON(),nav:n.getBoundingClientRect().toJSON(),rail:gallery.rail.getBoundingClientRect().toJSON(),root:e.getBoundingClientRect().toJSON(),height:e.offsetHeight};})()');
  assert.ok(bounds.pageWidth<=width+1,'no page-wide horizontal overflow at '+label);
  assert.ok(bounds.hero.width>150&&bounds.hero.height>110,'usable poster at '+label);
  assert.ok(bounds.hero.right<=width+1&&bounds.nav.right<=width+1,'components within viewport at '+label);
  assert.ok(bounds.copy.top>=bounds.hero.top&&bounds.copy.bottom<=bounds.hero.bottom+1&&bounds.copy.right<=bounds.hero.right,'long title and overview fit in the poster at '+label);
  assert.ok(bounds.rail.bottom<=bounds.root.bottom+1,'the whole carousel remains available at '+label);
  const capture=await call('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(directory,'home-'+label+'.png'),Buffer.from(capture.data,'base64'));
 }
 await call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
 const reduced=await evaluate('(async()=>{gallery.stop();await gallery.start({});for(let i=0;i<200&&Number(getComputedStyle(gallery.title).opacity)<1;i++)await new Promise(r=>setTimeout(r,10));const ready=document.querySelector(".tg-home").classList.contains("tg-entered")&&Number(getComputedStyle(gallery.title).opacity)===1;gallery.destroy();return {ready,empty:document.getElementById("home").children.length===0};})()');
 assert.ok(reduced.ready&&reduced.empty,'reduced motion reveals immediately and destroy releases DOM');
 console.log('home gallery responsive and reduced-motion checks passed');
},{gpu:true,visible:true}).catch(error=>{console.error(error);process.exitCode=1;});
