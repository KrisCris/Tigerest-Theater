// The Emby page already has logical safe-area padding. Avoid adding it again
// at each Android page wrapper, while keeping content beyond either cutout.
const assert=require('node:assert/strict');
const path=require('node:path');
const fs=require('node:fs');
const withBrowser=require('./community_browser.cjs');
const responsive=path.join(__dirname,'../android/app/src/main/assets');
withBrowser({
 '/':{type:'text/html',body:`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
 html,body{margin:0;font:16px sans-serif}body{background:#101216;color:#f4f2ed}*{box-sizing:border-box}
 .skinHeader{padding-left:var(--emulated-safe-left);padding-right:var(--emulated-safe-right)}
 .headerTop{display:flex;justify-content:space-between}.headerTop button{width:44px;height:44px}
 .padded-left{padding-inline-start:3.4%}.padded-left-page{padding-inline-start:calc(3.4% + var(--emulated-safe-left))}.padded-right{padding-inline-end:3.4%}
 .content-marker{height:40px;background:#e1ae43}.itemMainScrollSlider{width:100%}
 </style><link rel="stylesheet" href="/android.css"><header class="skinHeader"><div class="headerTop"><button>返回</button><button>设置</button></div></header>
 <div class="mainAnimatedPage"><div class="view itemView"><div class="itemMainScrollSlider">
 <div class="detailMainContainer padded-left padded-left-page padded-right"><div id="detail" class="content-marker"></div></div>
 <section class="peopleSection"><h2 class="padded-left padded-left-page padded-right"><span>演职人员</span></h2><div class="emby-scroller padded-left padded-left-page padded-right"><div id="cast" class="content-marker"></div></div></section>
 <div class="settingsContainer padded-left padded-right"><div id="settings" class="content-marker"></div></div>
 </div></div></div><main id="home" class="view-home-home"></main><script src="/android.js"></script><script src="/data.js"></script><script src="/gallery.js"></script>`},
 '/android.css':{type:'text/css',path:path.join(responsive,'androidResponsive.css')},
 '/android.js':{path:path.join(responsive,'androidResponsive.js')},
 '/data.js':{path:path.join(__dirname,'../native/homeData.js')},
 '/gallery.js':{path:path.join(__dirname,'../native/homeGallery.js')},
 '/home-art/movies.png':{type:'image/png',path:path.join(__dirname,'../native/home-art/movies.png')},
 '/home-art/favorites.png':{type:'image/png',path:path.join(__dirname,'../native/home-art/favorites.png')},
 '/poster.svg':{type:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900"><rect width="1200" height="900" fill="#315064"/><circle cx="750" cy="300" r="200" fill="#bc8a58"/></svg>'},
},async({call,evaluate})=>{
 const results=[];
 for(const [width,left,right] of [[900,38,0],[900,0,38],[400,0,0],[1280,0,0]]){
  await call('Emulation.setDeviceMetricsOverride',{width,height:700,deviceScaleFactor:1,mobile:false});
  await evaluate(`document.documentElement.style.setProperty('--emulated-safe-left','${left}px');document.documentElement.style.setProperty('--emulated-safe-right','${right}px');window.tigerestWindowMetrics={safeInsets:{left:${left},right:${right},top:28,bottom:24}};dispatchEvent(new Event('tigerest-window-changed'));`);
  const geometry=await evaluate(`(()=>{const bounds=id=>{const r=document.getElementById(id).getBoundingClientRect();return {left:r.left,right:r.right}};const buttons=[...document.querySelectorAll('.headerTop button')].map(b=>{const r=b.getBoundingClientRect();return{left:r.left,right:r.right}});return {width:innerWidth,detail:bounds('detail'),cast:bounds('cast'),settings:bounds('settings'),buttons,scrollWidth:document.documentElement.scrollWidth}})()`);
  const expectedLeft=left?50:Math.max(12,width*.034),expectedRight=right?50:Math.max(12,width*.034);
  for(const name of ['detail','cast','settings']){
   assert.ok(Math.abs(geometry[name].left-expectedLeft)<1,`${name} at ${width}: single safe gutter expected ${expectedLeft}, got ${geometry[name].left}`);
   assert.ok(Math.abs(width-geometry[name].right-expectedRight)<1,`${name} right inset avoids cutout without duplicating outer padding`);
  }
  assert.ok(geometry.buttons[0].left>=left&&geometry.buttons[0].left<=left+8,'header safe inset applied once');
  assert.ok(geometry.buttons[1].right<=width-right,'right header action avoids cutout');
  assert.ok(geometry.scrollWidth<=width,'page does not overflow horizontally: '+JSON.stringify(geometry));
  results.push(geometry);
 }
 await call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
 await evaluate(`(async()=>{document.querySelector('.mainAnimatedPage').hidden=true;const api={serverId:()=> 'safe-inset-fixture',serverAddress:()=>location.origin,getCurrentUserId:()=> 'fixture',getUserViews:async()=>({Items:[{Id:'movies',Name:'电影',CollectionType:'movies'}]}),getItems:async()=>({Items:[{Id:'poster',Type:'Movie',Name:'安全边距布局',BackdropImageTags:['fixture']}]}),getImageUrl:()=>location.origin+'/poster.svg'};window.gallery=new TigerestHomeGallery(document.getElementById('home'),{apiProvider:()=>api,router:{showItem(){},showFavorites(){}}});await gallery.start({});})()`);
 const homeResults=[],directory=path.join(__dirname,'../build/home-safe-insets');fs.mkdirSync(directory,{recursive:true});
 for(const [width,height,top,left,right,bottom,label] of [[390,844,28,0,0,24,'phone'],[844,390,0,38,0,24,'landscape-left'],[844,390,0,0,38,24,'landscape-right'],[320,480,28,0,0,24,'short-phone'],[900,700,28,0,0,24,'tablet'],[1280,700,0,0,0,0,'desktop']]){
  await call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
  await evaluate(`window.scrollTo(0,0);window.tigerestWindowMetrics={safeInsets:{top:${top},left:${left},right:${right},bottom:${bottom}}};dispatchEvent(new Event('tigerest-window-changed'));new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));`);
  const geometry=await evaluate(`(()=>{const box=e=>e.getBoundingClientRect().toJSON();return {root:box(gallery.root),nav:box(gallery.nav),hero:box(gallery.stage),rail:box(gallery.rail),eyebrow:box(document.querySelector('.tg-home-eyebrow')),scrollWidth:document.documentElement.scrollWidth,header:getComputedStyle(document.querySelector('.skinHeader')).display};})()`);
  assert.equal(geometry.root.top,0,'home background still starts at the window edge');
  assert.ok(geometry.eyebrow.top>=top+8,`${label}: library heading clears system status bar (${top}px), got ${geometry.eyebrow.top}`);
  assert.ok(geometry.hero.top>=top+8,`${label}: poster clears the top system inset`);
  assert.ok(geometry.nav.left>=left+12&&geometry.hero.right<=width-right-12,`${label}: content clears either landscape cutout`);
  assert.ok(geometry.rail.bottom<=geometry.root.bottom-bottom-14,`${label}: carousel remains above the bottom system inset, including short scrolling layouts`);
  assert.ok(geometry.scrollWidth<=width,'home keeps the viewport width');
  assert.equal(geometry.header,'none','home keeps original Emby header hidden');
  const capture=await call('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(directory,'home-safe-'+label+'.png'),Buffer.from(capture.data,'base64'));
  homeResults.push({label,top,left,right,bottom,...geometry});
 }
 await evaluate('gallery.destroy();document.querySelector(".mainAnimatedPage").hidden=false');
 assert.notEqual(await evaluate('getComputedStyle(document.querySelector(".skinHeader")).display'),'none','leaving home restores the normal page header');
 fs.writeFileSync(path.join(directory,'geometry.json'),JSON.stringify(homeResults,null,2));
 console.log(JSON.stringify({passed:true,singleSafeGutter:true,results,homeResults}));
}).catch(error=>{console.error(error);process.exitCode=1});
