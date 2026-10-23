// Android flies a poster to its predicted landing over the old page and changes
// the route only once it has landed; other platforms keep their own path.
// Runs in Chrome, in the client (--webengine) or on a phone (TIGEREST_ANDROID_FIXTURE).
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),withBrowser=require('./community_browser.cjs');
const root=path.resolve(__dirname,'..'),renderer=path.join(root,'native/homeTransitions.js');
const routes={
 '/':{type:'text/html',body:`<meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;background:#101722;color:white;font:18px sans-serif}.page{position:fixed;inset:0;padding:60px;box-sizing:border-box;background:linear-gradient(120deg,#34495c,#101722)}.hide{display:none}.cardImage{width:100px;height:150px;object-fit:cover}.detailImageContainer{width:200px;height:300px;margin:70px 0 0 80px;background-size:cover}</style><div class="page" id="home"><h1>首页</h1><img id="source" class="cardImage" src="/poster.svg"></div><div class="page hide" id="detail"><div class="detailImageContainer" style="background-image:url('/poster.svg')"></div><h1>作品详情</h1></div>`},
 '/poster.svg':{type:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="480" height="720"><rect width="480" height="720" fill="#856633"/><circle cx="240" cy="280" r="140" fill="#c5b185"/></svg>'}
};
withBrowser(routes,async({evaluate,call})=>{
 await call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
 // The working tree's renderer, so a phone's installed debug build need not be rebuilt first.
 await evaluate(fs.readFileSync(renderer,'utf8')+';true');
 const nativeAndroid=await evaluate('!!(window.tigerestAndroidApi||window.api?.system?.isAndroid)');
 await evaluate(`window.fixture={route(delay){return new Promise(r=>setTimeout(r,delay)).then(()=>{document.querySelector('#home').classList.add('hide');document.querySelector('#detail').classList.remove('hide');});},
  home(){document.querySelector('#detail').classList.add('hide');document.querySelector('#home').classList.remove('hide');},
  rect(){document.querySelector('#detail').classList.remove('hide');const b=document.querySelector('.detailImageContainer').getBoundingClientRect();this.home();return {x:b.x,y:b.y,width:b.width,height:b.height};},
  // Flies #source to the detail poster, recording when the route starts and what is shown 300 ms in.
  async fly({android=true,preset=this.rect(),key='android-route-'+Math.random(),during}={}){
   this.home();if(android&&!${nativeAndroid})window.tigerestAndroidApi={};
   const start=performance.now();let routedAt=null,at300=null;
   setTimeout(()=>{at300={oldShown:!document.querySelector('#home').classList.contains('hide'),routed:routedAt!==null,poster:!!document.querySelector('.tigerest-motion-poster')};},300);
   if(during)setTimeout(during,200);
   await TigerestHomeTransitions.poster({source:document.querySelector('#source'),findTarget:()=>{const n=document.querySelector('#detail:not(.hide) .detailImageContainer');return n;},
    navigate:()=>{routedAt=performance.now()-start;return this.route(60);},landingKey:key,presetRect:preset});
   if(!${nativeAndroid})delete window.tigerestAndroidApi;
   const leaks=document.querySelectorAll('.tigerest-motion-layer,.tigerest-motion-flight,[data-tigerest-poster-held]').length;
   const detail=!document.querySelector('#detail').classList.contains('hide');this.home();
   return {...TigerestHomeTransitions.last,routedAt,at300,leaks,detail};}};true`);
 const done=m=>m.detail&&m.leaks===0&&!m.interrupted;
 // A predicted landing: the poster crosses the old page and the route starts after it lands.
 const deferred=await evaluate('fixture.fly()');
 assert.ok(done(deferred),'transition completes: '+JSON.stringify(deferred));
 assert.ok(deferred.deferRoute&&deferred.aim==='preset','Android defers the route for a predicted landing: '+JSON.stringify(deferred));
 assert.deepEqual(deferred.at300,{oldShown:true,routed:false,poster:true},'mid-flight the old page is still shown and the route has not started');
 assert.ok(deferred.posterLandedMs>=590&&deferred.routedAt>=590,'the route starts once the poster has landed: '+JSON.stringify(deferred));
 assert.ok(!deferred.fallback&&deferred.landingErrorPx<2,'the landed poster meets the real one: '+JSON.stringify(deferred));
 assert.ok(deferred.landedMs-deferred.targetMs<=400&&deferred.quietWaitMs===undefined,'the page is revealed at once, without waiting for a quiet page: '+JSON.stringify(deferred));
 // A stale prediction: the landed poster is corrected onto the real one, never faded out as late.
 const corrected=await evaluate('(()=>{const r=fixture.rect();return fixture.fly({preset:{...r,x:r.x+40,y:r.y-30}});})()');
 assert.ok(done(corrected)&&corrected.deferRoute&&!corrected.fallback,'a stale landing is not a late target: '+JSON.stringify(corrected));
 assert.ok(corrected.correctionPx>=30&&corrected.landingErrorPx<2,'the poster is corrected onto the real one: '+JSON.stringify(corrected));
 // Without a prediction the route is not deferred (the poster lifts; touch screens still wait for a quiet page).
 const unknown=await evaluate('fixture.fly({preset:null})');
 assert.ok(done(unknown)&&unknown.aim==='lift'&&!unknown.deferRoute&&unknown.routedAt<450,'no prediction, no deferred route: '+JSON.stringify(unknown));
 // Folding or rotating the phone mid-flight still changes the route.
 const resized=await evaluate(`fixture.fly({during:()=>window.dispatchEvent(new Event('resize'))})`);
 assert.ok(resized.detail&&resized.leaks===0&&resized.routedAt!==null,'a resize during the deferred flight still navigates: '+JSON.stringify(resized));
 let others=null;
 if(!nativeAndroid){
  // Desktop and iPad keep flying while the route loads.
  others=await evaluate('fixture.fly({android:false})');
  assert.ok(done(others)&&others.aim==='preset'&&!others.deferRoute&&others.routedAt<300,'other platforms change the route during the flight: '+JSON.stringify(others));
 }
 const pick=m=>m&&{aim:m.aim,posterLandedMs:m.posterLandedMs,routedAt:Math.round(m.routedAt),targetMs:m.targetMs&&Math.round(m.targetMs),landedMs:Math.round(m.landedMs),correctionPx:m.correctionPx};
 console.log('android poster route:',JSON.stringify({nativeAndroid,deferred:pick(deferred),corrected:pick(corrected),unknown:pick(unknown),others:pick(others)}));
},{gpu:true,visible:true}).catch(error=>{console.error(error);process.exitCode=1;});
