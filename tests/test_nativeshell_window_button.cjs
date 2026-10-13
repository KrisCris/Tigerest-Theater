// Exercise the production controls in a real DOM. Only the native window bridge is a boundary double.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const withBrowser=require('./community_browser.cjs');
const root=path.resolve(__dirname,'..'),source=fs.readFileSync(path.join(root,'native/nativeshell.js'),'utf8');
const start=source.indexOf('function installHeaderControlsStyle()')>=0?source.indexOf('function installHeaderControlsStyle()'):source.indexOf('function installMpvSettingsEntry()');
const controls=source.slice(start,source.indexOf('\ninstallMpvSettingsEntry();',start));
const iconFont=process.env.TIGEREST_SETTINGS_ICON_FONT;
const updateSource=fs.readFileSync(path.join(root,'native/updatePlugin.js'),'utf8');
const updateStyle=updateSource.slice(updateSource.indexOf('          #tigerest-update-button {'),updateSource.indexOf('          #tigerest-update-dialog {'));
const updateIcon=updateSource.match(/entry.innerHTML='([^']+)'/)[1];
const gallery=fs.readFileSync(path.join(root,'native/homeGallery.js'),'utf8');
withBrowser({...iconFont?{'/emby-icons.woff2':{type:'font/woff2',path:path.resolve(iconFont)}}:{},'/avatar.png':{type:'image/png',path:path.join(root,'native/home-art/anime.png')},'/':{type:'text/html',body:'<!doctype html><meta charset="utf-8"><style>html,body,iframe{margin:0;width:100%;height:100%;border:0}iframe{display:block}</style><iframe id="fixture"></iframe>'}},async({evaluate:rawEvaluate,call})=>{
 const evaluate=expression=>rawEvaluate(/\bawait\b/.test(expression)?'(async()=>{'+expression+'})()':expression);
 await call('Emulation.setDeviceMetricsOverride',{width:1000,height:760,deviceScaleFactor:1,mobile:false});
 await evaluate(`window.frame=document.getElementById('fixture');window.doc=frame.contentDocument;doc.open();doc.write(${JSON.stringify(`<!doctype html><meta charset="utf-8"><style>body{margin:0;background:#101216;color:#eee;font:16px system-ui}.headerRight{display:flex;align-items:center;justify-content:flex-end;gap:4px;padding:12px}.headerButton{width:52px;height:48px;padding:8px;border:0;border-radius:50%;background:#252c38;color:inherit;flex-shrink:0}.headerUserButton img{width:100%;height:100%}${iconFont?'@font-face{font-family:"Material Symbols Rounded";font-style:normal;font-weight:400;src:url(/emby-icons.woff2) format("woff2")}':''}.md-icon{font-family:'Material Symbols Rounded'!important;font-weight:400;font-style:normal;line-height:1;letter-spacing:normal;text-transform:none;display:inline-block;white-space:nowrap;overflow-wrap:normal;-webkit-font-smoothing:antialiased;text-rendering:optimizelegibility;font-feature-settings:'liga';font-variation-settings:"FILL" 0,"wght" 400,"GRAD" 0,"opsz" 24;overflow:hidden;vertical-align:middle}${updateStyle}</style><div class="headerRight"><button id="tigerest-message-entry">消息 · 99+</button><button class="headerButton headerCastButton md-icon" aria-label="投屏">&#xe307;</button><button class="headerButton headerSearchButton md-icon" aria-label="搜索">&#xe8b6;</button><button id="tigerest-update-button" class="headerButton" aria-label="客户端更新">${updateIcon}<span data-update-dot></span></button><button class="headerButton headerUserButton" aria-label="账户"><img class="headerUserButtonImage paper-icon-button-img" src="/avatar.png" draggable="false"></button><button class="headerButton headerSettingsButton md-icon" aria-label="设置">&#xe8b8;</button></div><main id="home"></main>`)});doc.close();`);
 await evaluate(`window.fullscreen=false;window.requests=[];window.signal=null;window.release=null;window.rejectNext=false;window.failRead=false;window.reads=0;
 window.bridge={isFullScreen:async()=>{reads++;if(failRead){failRead=false;throw Error('read failed');}return fullscreen},setFullScreen:value=>{requests.push(value);return new Promise((resolve,reject)=>{release=()=>{if(rejectNext){rejectNext=false;reject(Error('native rejected'));}else{fullscreen=value;resolve();}}})},fullScreenSwitched:{connect:fn=>signal=fn}};
 window.fixture={innerHeight:760,initCompleted:Promise.resolve(),api:{window:bridge},jmpInfo:{settings:{home:{startupFullscreen:false}}},addEventListener(){},removeEventListener(){}};
 window.q=selector=>doc.querySelector(selector);window.settle=()=>new Promise(r=>setTimeout(r,40));
 new Function('window','document','MutationObserver',${JSON.stringify(controls+'\ninstallMpvSettingsEntry();installWindowModeEntry();')})(fixture,doc,frame.contentWindow.MutationObserver);
 new Function('window','document',${JSON.stringify(gallery)})(fixture,doc);
 window.home=new fixture.TigerestHomeGallery(q('#home'),{apiProvider:()=>null});await settle();`);
 if(iconFont){await evaluate('doc.fonts.ready');assert.equal(await evaluate(`doc.fonts.check('20px "Material Symbols Rounded"')`),true,'real Emby icon font loaded');}
 const states=()=>evaluate(`['#tigerest-window-mode-button','[data-tigerest-window-mode]'].map(s=>{const b=q(s);return b&&{text:b.textContent,pressed:b.getAttribute('aria-pressed'),title:b.title,disabled:b.disabled}})`);
 assert.equal(await evaluate(`!!q('.tg-home-nav-heading [data-tigerest-window-mode]')`),true,'home library heading has a usable window mode control');
 let state=await states();assert.equal(state.length,2);for(const button of state){assert.equal(button.pressed,'false');assert.match(button.text,/全屏/);assert.match(button.title,/全屏/);}
 assert.equal(await evaluate('requests.length'),0,'mounting home does not change native window state');
 await evaluate(`q('[data-tigerest-window-mode]').click();q('#tigerest-window-mode-button').click();await settle()`);
 assert.deepEqual(await evaluate('requests'),[true],'shared pending operation prevents conflicting double toggles');
 assert.equal((await states()).every(b=>b.pressed==='false'),true,'pending native request does not report success early');
 await evaluate('release();await settle()');state=await states();for(const button of state){assert.equal(button.pressed,'true');assert.match(button.text,/窗口/);}
 assert.equal(await evaluate('fixture.jmpInfo.settings.home.startupFullscreen'),false,'manual toggles do not alter the startup preference');
 await evaluate('fullscreen=false;signal(false);await settle()');assert.equal((await states()).every(b=>b.pressed==='false'),true,'F11/native changes update both buttons');
 await evaluate(`rejectNext=true;q('#tigerest-window-mode-button').click();release();await settle()`);
 assert.equal((await states()).every(b=>!b.disabled&&b.pressed==='false'),true,'rejected native call restores usable controls');
 await evaluate(`q('[data-tigerest-window-mode]').click();release();await settle()`);assert.equal((await states()).every(b=>b.pressed==='true'),true,'retry succeeds after failure');
 await evaluate('failRead=true;signal();await settle()');assert.equal((await states()).every(b=>!b.disabled),true,'a native read failure does not strand disabled controls');
 await evaluate(`home.destroy();home=new fixture.TigerestHomeGallery(q('#home'),{apiProvider:()=>null});await settle()`);assert.equal((await states()).every(b=>b.pressed==='true'),true,'a remounted home reflects the current state');
 const stable=await evaluate('reads');await evaluate('await settle();await settle()');assert.equal(await evaluate('reads'),stable,'DOM observer settles without read or text feedback loop');
 const toolbar=await evaluate(`[...doc.querySelectorAll('.headerRight button')].map(b=>({id:b.id,height:b.getBoundingClientRect().height,radius:frame.contentWindow.getComputedStyle(b).borderRadius,text:b.textContent,scroll:b.scrollWidth,client:b.clientWidth}))`);
 assert.equal(await evaluate(`[...doc.querySelectorAll('.headerButton.md-icon')].every(b=>frame.contentWindow.getComputedStyle(b).fontSize==='20px')`),true,'Emby buttons that directly own md-icon retain readable icon size');
 assert.equal(toolbar.every(b=>b.height===36&&b.radius==='10px'),true,'toolbar controls share a compact rectangular shape');
 assert.equal(await evaluate(`q('[data-update-dot]').getBoundingClientRect().width`),7,'update notification dot remains visible');
 const badge=toolbar.find(b=>b.id==='tigerest-message-entry');assert.equal(badge.text,'消息 · 99+');assert.ok(badge.scroll<=badge.client,'message unread count remains visible');
 await call('Emulation.setDeviceMetricsOverride',{width:390,height:760,deviceScaleFactor:1,mobile:false});await evaluate('await settle()');
 assert.equal(await evaluate('doc.documentElement.scrollWidth<=frame.clientWidth'),true,'compact header has no page-wide overflow');
 if(process.env.TIGEREST_WINDOW_SCREENSHOTS){fs.mkdirSync(process.env.TIGEREST_WINDOW_SCREENSHOTS,{recursive:true});await call('Emulation.setDeviceMetricsOverride',{width:1000,height:760,deviceScaleFactor:1,mobile:false});await evaluate('q("#home").hidden=true;doc.body.style.overflow="hidden";await settle()');const crop=await evaluate(`(()=>{const buttons=[...doc.querySelectorAll('.headerRight button')],left=buttons[0].getBoundingClientRect().left,right=buttons.at(-1).getBoundingClientRect().right;return {x:Math.floor(left)-12,y:0,width:Math.ceil(right-left)+24,height:60,scale:1};})()`);fs.writeFileSync(path.join(process.env.TIGEREST_WINDOW_SCREENSHOTS,'desktop-toolbar.png'),Buffer.from((await call('Page.captureScreenshot',{format:'png',clip:crop})).data,'base64'));}
 await evaluate(`home.destroy();q('#tigerest-window-mode-button').remove();fixture.tigerestAndroidApi={};
 window.mobileDoc=document.implementation.createHTMLDocument('Android');mobileDoc.body.innerHTML='<div class="headerRight"><button class="headerUserButton"></button></div><main></main>';
 new Function('window','document','MutationObserver',${JSON.stringify(controls+'\ninstallWindowModeEntry();')})(fixture,mobileDoc,frame.contentWindow.MutationObserver);
 new Function('window','document',${JSON.stringify(gallery)})(fixture,mobileDoc);
 window.mobileHome=new fixture.TigerestHomeGallery(mobileDoc.querySelector('main'),{apiProvider:()=>null});`);
 assert.equal(await evaluate(`mobileDoc.querySelectorAll('#tigerest-window-mode-button,[data-tigerest-window-mode]').length`),0,'Android mounts no desktop fullscreen controls');
 await evaluate(`mobileHome.destroy();fixture.tigerestAndroidApi=null;fixture.tigerestIPadApi={};fixture.jmpInfo.capabilities={desktopWindowControls:false,downloads:true};
 new Function('window','document','MutationObserver',${JSON.stringify(controls+'\ninstallWindowModeEntry();')})(fixture,mobileDoc,frame.contentWindow.MutationObserver);
 window.ipadHome=new fixture.TigerestHomeGallery(mobileDoc.querySelector('main'),{apiProvider:()=>null});`);
 assert.equal(await evaluate(`mobileDoc.querySelectorAll('#tigerest-window-mode-button,[data-tigerest-window-mode]').length`),0,'iPad mounts no desktop fullscreen controls');
 console.log('window controls: shared state, delayed native completion, failure/retry, F11, remount, preference isolation, observer stability, compact toolbar and Android absence passed');
},{visible:true}).catch(error=>{console.error(error);process.exitCode=1});
