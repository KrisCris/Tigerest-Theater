// The Emby page already has logical safe-area padding. Avoid adding it again
// at each Android page wrapper, while keeping content beyond either cutout.
const assert=require('node:assert/strict');
const path=require('node:path');
const fs=require('node:fs');
const withBrowser=require('./community_browser.cjs');
const responsive=path.join(__dirname,'../android/app/src/main/assets');
withBrowser({
 '/':{type:'text/html',body:`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
 html,body{margin:0;font:16px sans-serif}*{box-sizing:border-box}
 .skinHeader{padding-left:var(--emulated-safe-left);padding-right:var(--emulated-safe-right)}
 .headerTop{display:flex;justify-content:space-between}.headerTop button{width:44px;height:44px}
 .padded-left{padding-inline-start:3.4%}.padded-left-page{padding-inline-start:calc(3.4% + var(--emulated-safe-left))}.padded-right{padding-inline-end:3.4%}
 .content-marker{height:40px;background:#e1ae43}.itemMainScrollSlider{width:100%}
 </style><link rel="stylesheet" href="/android.css"><header class="skinHeader"><div class="headerTop"><button>返回</button><button>设置</button></div></header>
 <div class="mainAnimatedPage"><div class="view itemView"><div class="itemMainScrollSlider">
 <div class="detailMainContainer padded-left padded-left-page padded-right"><div id="detail" class="content-marker"></div></div>
 <section class="peopleSection"><h2 class="padded-left padded-left-page padded-right"><span>演职人员</span></h2><div class="emby-scroller padded-left padded-left-page padded-right"><div id="cast" class="content-marker"></div></div></section>
 <div class="settingsContainer padded-left padded-right"><div id="settings" class="content-marker"></div></div>
 </div></div></div><script src="/android.js"></script>`},
 '/android.css':{type:'text/css',path:path.join(responsive,'androidResponsive.css')},
 '/android.js':{path:path.join(responsive,'androidResponsive.js')},
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
 console.log(JSON.stringify({passed:true,singleSafeGutter:true,results}));
}).catch(error=>{console.error(error);process.exitCode=1});
