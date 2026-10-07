// Real settings renderer in an isolated Chromium fixture; native persistence is a boundary double.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const withBrowser=require('./community_browser.cjs');
const shell=fs.readFileSync(path.resolve(__dirname,'../native/nativeshell.js'),'utf8');
const renderer=shell.slice(shell.indexOf('function createRifeExtensionPanel('),shell.indexOf('async function openTigerestSettings('));
const catalog=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../resources/settings/settings_description.json'),'utf8'));
const sections=catalog.filter(s=>!s.hidden && s.order && s.values);
const descriptions={},defaults={};
for(const section of sections){
 const values=section.values.filter(v=>!v.hidden && (!v.platforms || v.platforms.includes('windows')) && !v.platforms_excluded?.includes('windows'));
 descriptions[section.section]=values.map(v=>({key:v.value,displayName:v.display_name||v.value,help:v.help||'',inputType:v.input_type,options:v.possible_values?.map(o=>({value:o[0],title:String(o[1])}))}));
 defaults[section.section]=Object.fromEntries(values.map(v=>[v.value,v.default]));
}
withBrowser({
 '/':{type:'text/html',body:`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;background:#141414;color:#eee;font:16px system-ui}#origin{margin:20px}#host{margin:30px auto;max-width:1100px}</style><body><button id="origin">设置</button><div id="host"></div><script>
 // The injected Qt shell must finish wiring native settings before this fixture replaces its boundary.
 window.fixtureReady=Promise.resolve(window.initCompleted).then(()=>{
 window.saves=[];window.resets=[];window.confirm=()=>true;window.initCompleted=Promise.resolve();
 const defaults=${JSON.stringify(defaults)};
 window.jmpInfo={sections:${JSON.stringify(sections.map(s=>({key:s.section,order:s.order})))},settingsDescriptions:${JSON.stringify(descriptions)},settings:{},mpvConfigMode:'embedded',mpvConfigDir:'内置配置'};
 for(const section of Object.keys(defaults))jmpInfo.settings[section]=new Proxy({...defaults[section]},{set(target,key,value){saves.push([section,key,value]);target[key]=value;return true}});
 window.api={player:{mpvDiagnostics:async()=>({renderBackend:'gpu-next-native',rife:{runtimeAvailable:true,state:0,status:'可用'}})},settings:{resetToDefault:async section=>{resets.push(section);Object.assign(jmpInfo.settings[section],defaults[section]);}}};
 window.tigerestOpenOfflineLibrary=()=>{};
 });
 </script><script src="/settings.js"></script></body>`},
 '/settings.js':{body:renderer}
},async({evaluate,call})=>{
 await evaluate('window.fixtureReady');
 await evaluate('document.querySelector("#origin").focus();mountTigerestSettings(null,"audio").then(value=>window.mount=value)');
 assert.ok(await evaluate('document.querySelectorAll(".tgs-setting").length>70'),'all supported setting definitions render');
 assert.equal(await evaluate('document.querySelector("#tigerest-settings-overlay [role=dialog]")?.getAttribute("aria-modal")'),'true','overlay is keyboard accessible');
 assert.equal(await evaluate('[...document.querySelectorAll(".tgs-setting input,.tgs-setting select,.tgs-setting textarea")].every(input=>input.labels?.length===1)'),true,'every input is associated with its visible form label');
 await evaluate(`(()=>{const search=document.querySelector('.tgs-search');search.value='透明度';search.dispatchEvent(new Event('input'))})()`);
 assert.ok(await evaluate('document.querySelector("[data-setting=\\"danmaku.opacity\\"]").offsetHeight>0'));
 await evaluate(`document.querySelector('[data-section-tab="audio"]').click()`);
 assert.equal(await evaluate('[...document.querySelectorAll("[data-section=audio] .tgs-setting")].every(row=>row.offsetHeight>0)'),true,'category change clears prior search filtering');
 await evaluate(`(()=>{const tab=document.querySelector('[data-section-tab="audio"]');tab.focus();tab.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}))})()`);
 assert.equal(await evaluate('document.activeElement.dataset.sectionTab'),'video','keyboard moves between categories');
 await evaluate(`document.querySelector('[data-section-tab="danmaku"]').click();const opacity=document.querySelector('[data-setting="danmaku.opacity"] select');opacity.value=String(jmpInfo.settingsDescriptions.danmaku.find(s=>s.key==='opacity').options.findIndex(o=>o.value===0.5));opacity.dispatchEvent(new Event('change'))`);
 assert.deepEqual(await evaluate('saves.at(-1)'),['danmaku','opacity',0.5],'selected values reach persistence immediately');
 await evaluate(`document.querySelector('[data-section="danmaku"] .tgs-reset').click();new Promise(resolve=>setTimeout(resolve,50))`);
 assert.deepEqual(await evaluate('resets'),['danmaku']);
 assert.equal(await evaluate('jmpInfo.settings.danmaku.opacity'),0.7,'reset restores defaults');
 assert.equal(await evaluate('document.querySelectorAll("#tigerest-settings-style").length'),1,'reset releases prior style and controls');
 await call('Emulation.setDeviceMetricsOverride',{width:360,height:740,deviceScaleFactor:1,mobile:true});
 await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
 assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true,'phone has no document overflow');
 assert.ok(await evaluate('document.querySelector(".tgs-content").getBoundingClientRect().height>250'),'category strip leaves usable form area on phone');
 assert.equal(await evaluate('(()=>{const tab=document.querySelector(".tgs-tab.active").getBoundingClientRect();const nav=document.querySelector(".tgs-tabs").getBoundingClientRect();return tab.left>=nav.left && tab.right<=nav.right})()'),true,'current category remains visible when switching to a phone viewport');
 if(process.env.TIGEREST_SETTINGS_SCREENSHOTS){
  fs.mkdirSync(process.env.TIGEREST_SETTINGS_SCREENSHOTS,{recursive:true});
  fs.writeFileSync(path.join(process.env.TIGEREST_SETTINGS_SCREENSHOTS,'settings-phone.png'),Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));
  await call('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false});
  await evaluate(`document.querySelector('[data-section-tab="video"]').click()`);
  fs.writeFileSync(path.join(process.env.TIGEREST_SETTINGS_SCREENSHOTS,'settings-desktop.png'),Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));
 }
 await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
 assert.equal(await evaluate('!!document.querySelector("#tigerest-settings-overlay")'),false);
 assert.equal(await evaluate('document.activeElement.id'),'origin','close restores focus after reset too');
 await evaluate('mountTigerestSettings(document.querySelector("#host"),"main",()=>window.returned=true).then(value=>window.mount=value)');
 assert.equal(await evaluate('document.querySelectorAll("#tigerest-settings-inline").length'),1);
 await evaluate('document.querySelector(".tgs-close").click()');
 assert.equal(await evaluate('window.returned'),true,'inline return leaves Emby route in control');
 assert.equal(await evaluate('document.querySelectorAll("#tigerest-settings-style").length'),0);
 console.log('settings UI: form labels, category keyboard, search reset, immediate persistence, defaults, focus return, inline cleanup and phone layout passed');
// Qt does not tick animation frames when launched with windowsHide, even while document.hidden is false.
},{visible:true}).catch(error=>{console.error(error);process.exitCode=1});
