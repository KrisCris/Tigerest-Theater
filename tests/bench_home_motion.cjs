// Manual Emby-scale latency benchmark for the home/library/detail transitions.
// Not a CTest: timings depend on the machine. Compare runs on the same device.
//   node tests/bench_home_motion.cjs <browser-or-client> [--webengine] [--rounds=5]
// High-refresh probe: --dpr=2 --hz=120 --output=/absolute/path/report.json
// --viewport=fullscreen measures the actual display-sized client without emulation.
// --scroll=native uses a CDP wheel gesture (not supported by Qt WebEngine).
// Android: TIGEREST_ANDROID_FIXTURE=1 node tests/bench_home_motion.cjs
// Uses an isolated fixture page and profile; it never touches an Emby account.
const path=require('node:path'),withBrowser=require('./community_browser.cjs');
const fs=require('node:fs'),{frameMetrics}=require('./frame_metrics.cjs');
const argument=(name,fallback)=>process.argv.find(a=>a.startsWith('--'+name+'='))?.split('=').slice(1).join('=')??fallback;
const dpr=Number(argument('dpr',1)),targetHz=Number(argument('hz',120)),output=argument('output',null);
const scrollMode=argument('scroll','script');
const viewport=argument('viewport','fixed');
if(!['script','native'].includes(scrollMode))throw Error('--scroll must be script or native');
if(!['fixed','fullscreen'].includes(viewport))throw Error('--viewport must be fixed or fullscreen');
const repo=path.resolve(__dirname,'..'),rounds=Number(process.argv.find(a=>a.startsWith('--rounds='))?.slice(9)||5);
const embedded=process.argv.includes('--webengine')||!!process.env.TIGEREST_ANDROID_FIXTURE;
const poster=hue=>`<svg xmlns="http://www.w3.org/2000/svg" width="600" height="900"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue},55%,45%)"/><stop offset="1" stop-color="hsl(${(hue+80)%360},45%,20%)"/></linearGradient></defs><rect width="600" height="900" fill="url(#g)"/><circle cx="300" cy="330" r="180" fill="hsl(${(hue+160)%360},40%,60%)" opacity=".7"/><text x="40" y="820" font-size="64" fill="#fff">POSTER ${hue}</text></svg>`;
function sheet(seed,n){let s=':root{'+Array.from({length:40},(_,i)=>`--v${seed}-${i}:${i}px;`).join('')+'}\n';for(let i=0;i<n;i++)s+=`.s${seed}-${i} .k${i%97}>.m${i%31}:not(.hide),.skinBody .z${i}[data-a="${i%13}"]{margin:${i%7}px ${i%5}px;padding:${i%3}px;color:rgb(${i%255},${(i*7)%255},${(i*13)%255});border-radius:${i%9}px;font-size:${10+i%8}px}\n`;return s;}
const layout=`body{margin:0;background:#101722;color:#ddd;font:14px sans-serif;overflow:hidden}
.backgroundContainer,.backdropContainer{position:fixed;inset:0}.backdropImage{position:absolute;inset:0;background-size:cover;opacity:.35}
.skinHeader{position:fixed;left:0;right:0;top:0;height:48px;background:#0d1118cc;z-index:5;display:flex;gap:12px;align-items:center;padding:0 16px}
.page{position:fixed;inset:48px 0 0 0;overflow:auto;background:linear-gradient(120deg,#22313f,#101722)}.hide{display:none!important}
.tg-home{display:grid;grid-template-columns:220px 1fr;grid-template-rows:1fr 240px;height:100%}
.tg-home-nav{grid-row:1/3;display:flex;flex-direction:column;gap:8px;padding:12px;overflow:auto}.tg-library{display:flex;gap:8px;align-items:center;height:64px;background:#ffffff10;border:0;color:#ddd}.tg-library img{width:96px;height:54px;object-fit:cover}
.tg-home-stage{position:relative;overflow:hidden}.tg-home-stage .hero{position:absolute;right:40px;top:30px;width:220px;height:330px;object-fit:cover}.tg-home-stage h2{font-size:42px;margin:60px 40px 10px}.tg-home-stage p{margin:8px 40px;max-width:520px}
.tg-home-rail{overflow:hidden}.tg-cover-list{display:flex;gap:12px;overflow-x:auto;padding:12px}.tg-cover{flex:0 0 120px;height:180px;position:relative;border:0;padding:0;background:#000}.tg-cover img{width:100%;height:100%;object-fit:cover}.tg-cover-label{position:absolute;left:4px;bottom:4px;font-size:11px}
.itemsContainer{display:flex;flex-wrap:wrap;gap:14px;padding:20px}.card{width:150px}.cardBox{margin:0}.cardScalable{position:relative}.cardPadder{padding-bottom:150%}.cardImageContainer{position:absolute;inset:0}.cardImage{width:100%;height:100%;object-fit:cover;display:block}.cardFooter{height:40px}.cardText{white-space:nowrap;overflow:hidden;font-size:12px}
.detailMainContainer{display:flex;gap:24px;padding:40px}.detailImageContainer-main{width:240px;flex:0 0 240px}.detailImageContainer-main img{width:240px;height:360px;object-fit:cover}.detailTextContainer h1{font-size:36px}.castList{display:flex;flex-wrap:wrap;gap:10px;padding:20px 40px}.cast{width:90px}.cast img{width:90px;height:90px;border-radius:50%;object-fit:cover}`;
let id=0;const img=(cls,hue,lazy=false)=>`<img class="${cls}" ${lazy?'loading="lazy" ':''}src="/img/p.svg?h=${hue}&n=${id++}">`;
const homeHtml=`<div class="page mainAnimatedPage" id="home"><div class="tg-home-host"><div class="tg-home tg-entered">
<nav class="tg-home-nav">${Array.from({length:10},(_,i)=>`<button class="tg-library" data-library-id="lib${i}">${img('',i*30)}<span class="tg-library-label"><span>媒体夹 ${i}</span><span>LIBRARY 0${i}</span></span></button>`).join('')}</nav>
<section class="tg-home-stage">${img('hero',200)}<div class="hero-content"><div class="kicker">动画 / 继续观看</div><h2 id="hero-title">作品标题</h2><div class="sub">2024 · 最新入库 S1:E12</div><p id="hero-overview">${'简介文字。'.repeat(40)}</p></div></section>
<section class="tg-home-rail"><div class="tg-rail-heading"><span>动画 / 继续观看</span><button class="tg-home-more">查看更多 →</button></div><div class="tg-cover-list">${Array.from({length:24},(_,i)=>`<button class="tg-cover" data-item-id="w${i}" data-index="${i}">${img('',i*15,i>9)}<span class="tg-cover-label">作品 ${i}</span></button>`).join('')}</div></section>
</div></div></div>`;
const card=i=>`<div class="card s1-${i}" data-id="w${i}"><div class="cardBox"><div class="cardScalable"><div class="cardPadder"></div><div class="cardImageContainer">${img('cardImage',i*7,i>40)}</div></div><div class="cardFooter"><div class="cardText">作品 ${i}</div><div class="cardText">2024</div></div></div></div>`;
const libraryHtml=`<div class="page mainAnimatedPage hide" id="library"><div class="itemsContainer">${Array.from({length:240},(_,i)=>card(i)).join('')}</div></div>`;
const detailHtml=`<div class="page mainAnimatedPage hide view-item-item" id="detail"><div class="detailMainContainer"><div class="detailImageContainer detailImageContainer-main">${img('cardImage',7*3)}</div><div class="detailTextContainer"><h1>作品 3</h1>${Array.from({length:30},(_,i)=>`<div class="detail-row k${i}"><span>字段 ${i}</span><span>${'值'.repeat(i%9+1)}</span></div>`).join('')}<p>${'剧情介绍。'.repeat(80)}</p></div></div><div class="castList">${Array.from({length:60},(_,i)=>`<div class="cast">${img('',i*11,i>12)}<div>演员 ${i}</div><div>角色 ${i}</div></div>`).join('')}</div>${Array.from({length:4},(_,s)=>`<div class="itemsContainer">${Array.from({length:20},(_,i)=>card(300+s*20+i)).join('')}</div>`).join('')}</div>`;
const hidden=n=>`<div class="page mainAnimatedPage hide" id="old${n}">${Array.from({length:150},(_,i)=>`<div class="row s2-${i}"><span class="a">${i}</span><span class="b">${'x'.repeat(i%20)}</span><div class="c"><i></i><i></i><i></i></div></div>`).join('')}</div>`;
const body=`<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/css/a.css"><link rel="stylesheet" href="/css/b.css"><style>${layout}</style>${[1,2,3].map(n=>`<style>${sheet(n,900)}</style>`).join('')}
<body class="skinBody"><div class="backgroundContainer"></div><div class="backdropContainer"><div class="backdropImage" style="background-image:url(/img/p.svg?h=99&n=bd)"></div></div><div class="skinHeader"><b>Emby</b>${Array.from({length:8},(_,i)=>`<button>btn${i}</button>`).join('')}</div>${homeHtml}${libraryHtml}${detailHtml}${hidden(1)}${hidden(2)}
${embedded?'':'<script src="/backdrop.js"></script><script src="/transitions.js"></script><script src="/motion.js"></script>'}</body>`;
const routes={'/':{type:'text/html; charset=utf-8',body},'/css/a.css':{type:'text/css',body:sheet(4,900)},'/css/b.css':{type:'text/css',body:sheet(5,900)},
 '/backdrop.js':{path:path.join(repo,'native/homeBackdrop.js')},'/transitions.js':{path:path.join(repo,'native/homeTransitions.js')},'/motion.js':{path:path.join(repo,'native/homeMotion.js')}};
// Card artwork: one deterministic SVG per query, so every card decodes separately.
const proxy=new Proxy(routes,{get(t,k){if(typeof k==='string'&&k.startsWith('/img/'))return {type:'image/svg+xml',body:poster([...k].reduce((a,c)=>a*31+c.charCodeAt(0)>>>0,7)%360)};return t[k];}});
withBrowser(proxy,async({evaluate,call})=>{
 if(viewport==='fullscreen'){
  if(embedded)await evaluate('window.api.window.setFullScreen(true);true');
  else {const {windowId}=await call('Browser.getWindowForTarget');await call('Browser.setWindowBounds',{windowId,bounds:{windowState:'fullscreen'}});}
  await new Promise(resolve=>setTimeout(resolve,1800));
 }else if(!process.env.TIGEREST_ANDROID_FIXTURE)await call('Emulation.setDeviceMetricsOverride',{width:1280,height:720,deviceScaleFactor:dpr,mobile:false});
 if(!embedded){
  // Match the native client's separate appearance world in standalone Chrome.
  const {frameTree}=await call('Page.getFrameTree');
  const {executionContextId}=await call('Page.createIsolatedWorld',{frameId:frameTree.frame.id,worldName:'benchmark-appearance'});
  const result=await call('Runtime.evaluate',{contextId:executionContextId,expression:fs.readFileSync(path.join(repo,'native/webAppearance.js'),'utf8')});
  if(result.exceptionDetails)throw Error(JSON.stringify(result.exceptionDetails));
 }
 await call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
 await new Promise(r=>setTimeout(r,800));
 await evaluate(`(async()=>{
  document.body.classList.add('tg-home-active');
  window.state={params:{},contextPath:'/home'};
  window.show=name=>{document.querySelectorAll('.page').forEach(n=>n.classList.toggle('hide',n.id!==name));document.body.classList.toggle('tg-home-active',name==='home');state.params=name==='detail'?{id:'w3'}:name==='library'?{topParentId:'lib0'}:{};state.contextPath='/'+name;};
  window.routeDelay=150;window.route=name=>new Promise(r=>setTimeout(()=>{navigateLog.push(performance.now());show(name);r();},routeDelay));window.navigateLog=[];
  window.gallery={active:true,root:document.querySelector('.tg-home')};
  document.querySelectorAll('.itemsContainer').forEach(list=>list.getItemFromElement=el=>({Id:el.closest('.card').dataset.id,Type:'Movie'}));
  await Promise.all(Array.from(document.images).filter(i=>!i.complete&&i.loading!=='lazy').map(i=>new Promise(r=>{i.onload=i.onerror=r;})));
  window.measure=async(start)=>{
    // Start from an observed frame before invoking the action, so synchronous
    // preparation and a delayed first callback are included in the intervals.
    const initialFrame=await new Promise(requestAnimationFrame);
    const loaf=[],t0=performance.now();navigateLog=[];
    const intervals=[],frameTimes=[initialFrame-t0],animations=[],nativeAnimate=Element.prototype.animate;let previous=initialFrame,frameHandle;
    Element.prototype.animate=function(...args){const a=nativeAnimate.apply(this,args),target=this.className;
      a.ready.then(()=>{if(a.startTime!==null){const timing=a.effect.getComputedTiming();animations.push({target,start:a.startTime+timing.delay-t0,end:a.startTime+timing.endTime-t0});}}).catch(()=>{});return a;};
    const tick=t=>{frameTimes.push(t-t0);intervals.push(t-previous);previous=t;frameHandle=requestAnimationFrame(tick);};
    frameHandle=requestAnimationFrame(tick);
    const loafSupported=PerformanceObserver.supportedEntryTypes?.includes('long-animation-frame'),po=new PerformanceObserver(l=>loaf.push(...l.getEntries()));if(loafSupported)po.observe({type:'long-animation-frame'});
    const firstFrame=new Promise(r=>requestAnimationFrame(()=>{const ch=new MessageChannel();ch.port1.onmessage=()=>r(performance.now()-t0);ch.port2.postMessage(0);}));
    let p;try{p=start();}catch(error){Element.prototype.animate=nativeAnimate;throw error;}
    const syncMs=performance.now()-t0;const firstFrameMs=await firstFrame;try{await p;}finally{Element.prototype.animate=nativeAnimate;}
    cancelAnimationFrame(frameHandle);const transitionEnd=performance.now();
    await new Promise(r=>setTimeout(r,300));po.disconnect();
    const m=TigerestHomeTransitions.last||{};
    const during=loaf.filter(e=>e.startTime>=t0-5&&e.startTime<transitionEnd);
    return {intervals,frameTimes,animations,syncMs,firstFrameMs,navigateMs:navigateLog[0]?navigateLog[0]-t0-routeDelay:null,flightMs:m.posterFlightStartsMs??null,posterMoveMs:m.posterFirstMotionMs??null,totalMs:m.totalMs,cacheHit:m.cacheHit,lightHit:m.lightCacheHit,captureMs:m.backgroundPhases?.[0]?.captureMs??null,
      // Long-animation-frame needs Chromium 123+; older engines report null.
      longAnimationFrames:during.map(e=>({...e.toJSON(),scripts:e.scripts.map(s=>s.toJSON())})),
      maxFrameMs:loafSupported?Math.max(0,...during.map(e=>e.duration)):null,longFrames:loafSupported?during.filter(e=>e.duration>50).length:null};
  };
  window.heroBusy=()=>Array.from(document.querySelector('.hero-content').children).map((n,i)=>n.animate([{opacity:0,transform:'translate3d(-52px,30px,0)'},{opacity:1,transform:'none'}],{duration:i===1?760:620,delay:160+i*140,fill:'both'}));
  return true;})()`);
 const scenarios={
  // Home poster -> detail.
  homeDetail:`TigerestHomeTransitions.poster({source:document.querySelector('.tg-cover[data-index="3"] img'),findTarget:()=>document.querySelector('#detail .detailImageContainer-main img'),navigate:()=>route('detail'),direction:'enter'})`,
  // Library poster -> detail.
  libraryDetail:`TigerestHomeTransitions.poster({source:document.querySelector('#library .card[data-id="w3"] img'),findTarget:()=>document.querySelector('#detail .detailImageContainer-main img'),navigate:()=>route('detail'),direction:'enter'})`,
  // Detail -> library return.
  detailReturn:`TigerestHomeTransitions.poster({source:document.querySelector('#detail .detailImageContainer-main img'),findTarget:()=>document.querySelector('#library .card[data-id="w3"] img'),navigate:()=>route('library'),direction:'return'})`,
  homeLibrary:`TigerestHomeTransitions.library({gallery,navigate:()=>route('library').then(()=>{gallery.active=false;})})`,
  libraryHome:`TigerestHomeTransitions.homeReturn({findGallery:()=>gallery,navigate:()=>route('home').then(()=>{gallery.active=true;})})`
 };
 const from={homeDetail:'home',libraryDetail:'library',detailReturn:'detail',homeLibrary:'home',libraryHome:'library'};
 const results={},samples={};
 const metadata=await evaluate(`({width:innerWidth,height:innerHeight,dpr:devicePixelRatio,visible:document.visibilityState,focus:document.hasFocus(),ua:navigator.userAgent})`);
 metadata.targetHz=targetHz;metadata.viewport=viewport;metadata.measurement='requestAnimationFrame scheduling; not physical presentation';
 console.log('Metadata',JSON.stringify(metadata));
 for(const [name,code] of Object.entries(scenarios)){
  for(const mode of ['hit','hoverMiss','coldMiss']){
   // hoverMiss: a hovered home poster restarts the hero text entrance just before the click.
   if(mode==='hoverMiss'&&name!=='homeDetail')continue;
   const rows=[];
   for(let r=0;r<rounds;r++){
    await evaluate(`TigerestHomeTransitions.cancel();show(${JSON.stringify(from[name])});gallery.active=${from[name]==='home'};document.querySelector('.page:not(.hide)').scrollTop=0;true`);
    await new Promise(res=>setTimeout(res,250));
    if(mode==='hit'){
     // Entrance observers can invalidate the first warm attempt. A warm-case
     // measurement must actually have its requested cache, not silently time a miss.
     await evaluate(`(async()=>{const until=performance.now()+6000;while(performance.now()<until){await TigerestHomeTransitions.prewarm();const s=TigerestHomeTransitions.cacheState;if(s.ready&&(${from[name]==='home'}||s.snapshot))return;await new Promise(r=>setTimeout(r,100));}throw Error('warm benchmark precondition failed')})()`);
    }
    else if(mode==='hoverMiss'){await evaluate('TigerestHomeTransitions.prewarm()');await evaluate(`heroBusy();document.querySelector('#hero-title').textContent='hover '+Math.random();true`);await new Promise(res=>setTimeout(res,400));}
    else {await evaluate(`TigerestHomeTransitions.invalidate();true`);}
    rows.push(await evaluate(`measure(()=>${code})`));
   }
   const med=k=>{const v=rows.map(x=>x[k]).filter(x=>typeof x==='number').sort((a,b)=>a-b);return v.length?+v[v.length>>1].toFixed(1):null;};
   samples[name+'/'+mode]=rows;
   const frames=frameMetrics(rows.flatMap(row=>row.intervals),targetHz);
   results[name+'/'+mode]={sync:med('syncMs'),firstFrame:med('firstFrameMs'),navigate:med('navigateMs'),posterMove:med('posterMoveMs'),flight:med('flightMs'),maxFrame:med('maxFrameMs'),capture:med('captureMs'),longFrames:med('longFrames'),total:med('totalMs'),cacheHit:rows.map(x=>x.cacheHit).join(','),lightHit:rows.map(x=>x.lightHit).join(',')};
   Object.assign(results[name+'/'+mode],{fps:frames.callbackFps,p95:frames.p95Ms,worst:frames.maxMs,missed:frames.estimatedMissedRefreshes});
  }
 }
 // Use the same page-driven continuous scroll in both engines by default.
 // Qt WebEngine does not implement CDP's synthetic wheel gesture completion.
 await evaluate(`TigerestHomeTransitions.cancel();show('library');document.querySelector('#library').scrollTop=0;true`);
 await new Promise(resolve=>setTimeout(resolve,1000));
 let scrolling;
 if(scrollMode==='native'){
  await evaluate(`window.scrollIntervals=[];window.scrollPrevious=undefined;window.scrollTick=t=>{if(scrollPrevious!==undefined)scrollIntervals.push(t-scrollPrevious);scrollPrevious=t;window.scrollFrame=requestAnimationFrame(scrollTick);};window.scrollFrame=requestAnimationFrame(scrollTick);true`);
  await call('Input.synthesizeScrollGesture',{x:1000,y:500,yDistance:-3000,speed:1000,gestureSourceType:'mouse',preventFling:true});
  scrolling=await evaluate(`cancelAnimationFrame(scrollFrame);({intervals:scrollIntervals,scrollTop:document.querySelector('#library').scrollTop})`);
 }else{
  scrolling=await evaluate(`new Promise(resolve=>{const page=document.querySelector('#library'),intervals=[];let start,previous;
   const tick=t=>{start??=t;if(previous!==undefined)intervals.push(t-previous);previous=t;page.scrollTop=t-start;
    if(t-start<3000)requestAnimationFrame(tick);else resolve({intervals,scrollTop:page.scrollTop});};requestAnimationFrame(tick);})`);
 }
 scrolling.mode=scrollMode;
 if(scrolling.scrollTop<=0)throw Error('scroll fixture did not actually move');
 samples.scroll=scrolling;
 results.scroll=frameMetrics(scrolling.intervals,targetHz);
 console.table(results);
 // Time from a page change until the bitmap and the DOM snapshot are ready.
 for(const page of ['library','home'])for(let i=0;i<3;i++){const r=await evaluate(`(async()=>{TigerestHomeTransitions.cancel();show('${page}');gallery.active=${page==='home'};await new Promise(r=>setTimeout(r,0));TigerestHomeTransitions.invalidate();const t0=performance.now();let ready=null,snap=null;while(performance.now()-t0<4000){const s=TigerestHomeTransitions.cacheState;if(s.ready&&ready===null)ready=performance.now()-t0;if((s.snapshot||(s.snapshot===undefined&&s.ready&&!s.warming))&&snap===null)snap=performance.now()-t0;if(ready!==null&&snap!==null)break;await new Promise(r=>setTimeout(r,5));}return {page:'${page}',bitmapReadyMs:ready,snapshotReadyMs:snap};})()`);console.log(JSON.stringify(r));}
 console.log(JSON.stringify(results));
 if(output)fs.writeFileSync(output,JSON.stringify({metadata,results,samples},null,2));
},{gpu:true,visible:true}).catch(e=>{console.error(e);process.exitCode=1;});
