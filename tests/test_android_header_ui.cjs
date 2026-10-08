// Exercise the Android header with real layout and the original action handlers.
const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs');
const android=process.argv.includes('--android');
const withBrowser=require(android?'../android/tests/android_browser.cjs':'./community_browser.cjs');
const root=path.resolve(__dirname,'..');
const scripts=android?'':'<link rel="stylesheet" href="/responsive.css"><script src="/responsive.js"></script>';
withBrowser({
 '/':{type:'text/html',body:`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;background:#151923;color:white;font:16px sans-serif}.headerTop,.headerLeft,.headerRight{display:flex;align-items:center}.headerLeft{flex:1}.headerRight{margin-left:auto;gap:4px}.headerButton{box-sizing:border-box;flex:0 0 auto;min-width:52px;height:44px;padding:8px;white-space:nowrap;color:inherit;background:#25344a;border:0}.padded-top-page{padding-top:var(--header-height,80px)}</style><body><header class="skinHeader"><div class="headerTop"><div class="headerLeft"><button class="headerButton">菜单</button><span>emby</span></div><div class="headerRight"><button class="headerButton" id="tigerest-message-entry">消息 · 99+</button><button class="headerButton" id="cast" aria-label="投屏">投屏</button><button class="headerButton" id="upload" aria-label="上传">上传</button><button class="headerButton" id="search" aria-label="搜索">搜索</button><button class="headerButton" id="tigerest-update-button" aria-label="客户端更新">更新</button><button class="headerButton" id="tigerest-mpv-settings-button">MPV</button><button class="headerButton headerUserButton" aria-label="账户">头像</button></div></div></header><main class="padded-top-page">媒体库</main><script>window.TigerestUpdate?.destroy();window.headerActions=[];for(const node of document.querySelectorAll('.headerRight button'))node.addEventListener('click',()=>headerActions.push(node.id||'account'));</script>${scripts}`},
 '/responsive.css':{type:'text/css',path:path.join(root,'android/app/src/main/assets/androidResponsive.css')},
 '/responsive.js':{path:path.join(root,'android/app/src/main/assets/androidResponsive.js')}
},async({evaluate,call})=>{
 const settle=()=>evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(r))))');
 const screenshot=async name=>{if(!process.env.TIGEREST_HEADER_SCREENSHOTS)return;fs.mkdirSync(process.env.TIGEREST_HEADER_SCREENSHOTS,{recursive:true});fs.writeFileSync(path.join(process.env.TIGEREST_HEADER_SCREENSHOTS,name+'.png'),Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));};
 const resize=async width=>{await call('Emulation.setDeviceMetricsOverride',{width,height:800,deviceScaleFactor:1,mobile:true});await settle();};
 await resize(580);
 assert.equal(await evaluate(`Math.abs(document.querySelector('.headerUserButton').getBoundingClientRect().right-document.querySelector('.headerRight').getBoundingClientRect().right)<2`),true,'wrapped actions align with the right edge');
 await screenshot('header-right-aligned');
 await resize(320);
 assert.equal(await evaluate(`!!document.querySelector('#tigerest-header-more')?.getClientRects().length`),true,'overflow has a reachable secondary menu');
 assert.equal(await evaluate(`['tigerest-message-entry','tigerest-update-button'].every(id=>document.getElementById(id).getClientRects().length)&&!!document.querySelector('.headerUserButton').getClientRects().length`),true,'message, update and account remain visible');
 assert.equal(await evaluate(`document.getElementById('cast').getClientRects().length`),0,'secondary controls leave the compact row');
 assert.equal(await evaluate(`document.querySelector('.headerRight').scrollWidth<=document.querySelector('.headerRight').clientWidth`),true,'compact actions fit without scrolling');
 await evaluate(`document.getElementById('cast').hidden=true;document.querySelector('#tigerest-header-more').click()`);
 assert.equal(await evaluate(`[...document.querySelectorAll('#tigerest-header-menu button')].some(b=>b.textContent==='投屏')`),false,'hidden actions are excluded even before the next resize frame');
 await evaluate(`document.querySelector('#tigerest-header-menu').dispatchEvent(new Event('cancel',{cancelable:true}));document.getElementById('cast').hidden=false`);await settle();
 await evaluate(`document.querySelector('#tigerest-header-more').click()`);
 assert.equal(await evaluate(`document.querySelector('#tigerest-header-menu').open`),true);
 await screenshot('header-overflow-menu');
 await evaluate(`[...document.querySelectorAll('#tigerest-header-menu button')].find(b=>b.textContent==='投屏').click()`);
 assert.deepEqual(await evaluate('headerActions'),['cast'],'menu invokes the existing action once');
 assert.equal(await evaluate(`document.querySelector('#tigerest-header-menu').open`),false);
 await evaluate(`document.getElementById('upload').disabled=true;document.querySelector('#tigerest-header-more').click()`);
 assert.equal(await evaluate(`[...document.querySelectorAll('#tigerest-header-menu button')].find(b=>b.textContent==='上传').disabled`),true,'disabled original actions stay disabled');
 await evaluate(`document.getElementById('search').hidden=true`);await settle();
 assert.equal(await evaluate(`document.querySelector('#tigerest-header-menu').open`),false,'native visibility changes dismiss a stale open menu');
 await evaluate(`document.getElementById('search').hidden=false`);await settle();
 await evaluate(`document.querySelector('#tigerest-header-more').click();document.querySelector('main').append(document.createElement('span'));document.getElementById('search').hidden=true`);await settle();
 assert.equal(await evaluate(`document.querySelector('#tigerest-header-menu').open`),false,'mixed content and visibility changes dismiss a stale menu');
 await evaluate(`document.getElementById('search').hidden=false`);await settle();
 await evaluate(`document.getElementById('cast').hidden=true`);await settle();
 await evaluate(`document.querySelector('#tigerest-header-more').click()`);
 assert.equal(await evaluate(`[...document.querySelectorAll('#tigerest-header-menu button')].some(b=>b.textContent==='投屏')`),false,'contextually hidden actions stay out of the menu');
 await evaluate(`document.querySelector('#tigerest-header-menu').dispatchEvent(new Event('cancel',{cancelable:true}));document.getElementById('cast').hidden=false`);await settle();
 await resize(820);
 assert.equal(await evaluate(`!!document.querySelector('#tigerest-header-more')?.getClientRects().length`),false,'expanded width restores the original toolbar');
 assert.equal(await evaluate(`!!document.getElementById('cast').getClientRects().length`),true);
 await resize(320);
 await evaluate(`document.querySelector('.headerRight').replaceWith(document.querySelector('.headerRight').cloneNode(true))`);await settle();
 assert.equal(await evaluate(`document.querySelectorAll('#tigerest-header-more').length`),1,'header replacement keeps one functional menu entry');
 await evaluate(`document.querySelector('#tigerest-header-more').click()`);
 assert.equal(await evaluate(`document.querySelector('#tigerest-header-menu').open`),true);
 await resize(580);
 assert.equal(await evaluate(`document.querySelector('#tigerest-header-menu').open`),false,'resize dismisses stale secondary actions');
 console.log(JSON.stringify({passed:true,rightAligned:true,overflowMenu:true,originalHandlers:true,headerReplacement:true,resize:true,android}));
}).catch(error=>{console.error(error);process.exitCode=1;});
