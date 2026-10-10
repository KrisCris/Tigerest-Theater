// Real settings renderer/controllers; Emby navigation and native persistence are boundary doubles.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const withBrowser=require('./community_browser.cjs');
const shell=fs.readFileSync(path.resolve(__dirname,'../native/nativeshell.js'),'utf8');
const renderer=shell.slice(shell.indexOf('function createRifeExtensionPanel('),shell.indexOf('async function openTigerestSettings('));
const catalog=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../resources/settings/settings_description.json'),'utf8'));
const sections=catalog.filter(s=>!s.hidden && s.order && s.values);
const descriptions={},defaults={};
// Optional local copy of Emby's own font, for screenshots without a live server.
const iconFont=process.env.TIGEREST_SETTINGS_ICON_FONT;
for(const section of sections){
 const values=section.values.filter(v=>!v.hidden && (!v.platforms || v.platforms.includes('windows')) && !v.platforms_excluded?.includes('windows'));
 descriptions[section.section]=values.map(v=>({key:v.value,displayName:v.display_name||v.value,help:v.help||'',inputType:v.input_type,options:v.possible_values?.map(o=>({value:o[0],title:String(o[1])}))}));
 defaults[section.section]=Object.fromEntries(values.map(v=>[v.value,v.default]));
}
withBrowser({
 ...(iconFont?{'/emby-material-icons.woff2':{type:'font/woff2',path:path.resolve(iconFont)}}:{}),
 '/':{type:'text/html',body:`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
 body{margin:0;background:#141414;color:#eee;font:16px system-ui}#origin{margin:20px}#host{margin:30px auto;max-width:1100px}.view{margin-left:260px}
 .mainDrawer{position:fixed;inset:0 auto 0 0;width:260px;overflow:auto;background:#202020}.navMenuOption{display:block;width:100%;padding:0;border:0;color:inherit;background:none;text-align:left;font:inherit;cursor:pointer}.listItem-content{display:flex;align-items:center;padding:14px 20px}.navMenuOption-selected{color:#ffbe38;background:#ffffff09}
 /* Emby 4.10.0.40 modules/navdrawer/navdrawer.css: preserve the actual cascade. */
 .navMenuOption-listItem-content{-webkit-padding-start:.6em!important;padding-inline-start:.6em!important}.navMenuOption-listItem-content-reduceleftpadding{-webkit-padding-start:.25em!important;padding-inline-start:.25em!important}.navDrawerListItemImageContainer{width:1.8em!important;height:1.8em!important;flex-shrink:0}.navDrawerListItemBody{padding:.19em .5em!important}
 ${iconFont?'@font-face{font-family:"Material Symbols Rounded";font-style:normal;font-weight:400;src:url(/emby-material-icons.woff2) format("woff2")}':''}
 .md-icon{font-family:'Material Symbols Rounded'!important;font-weight:400;font-style:normal;line-height:1;letter-spacing:normal;text-transform:none;display:inline-block;white-space:nowrap;overflow-wrap:normal;-webkit-font-smoothing:antialiased;text-rendering:optimizelegibility;font-feature-settings:'liga';font-variation-settings:"FILL" 0,"wght" 400,"GRAD" 0,"opsz" 24;overflow:hidden;vertical-align:middle}
 @media(max-width:760px){.mainDrawer{display:none;z-index:1000;box-shadow:0 0 0 100vmax #0008}.mainDrawer.drawer-open{display:block}.view{margin-left:0}}
 </style><body><aside class="mainDrawer"><div class="mainDrawerScrollSlider"><div class="navDrawerItemsContainer itemsContainer" data-listindex="0"></div></div></aside><div class="view"><button id="origin">设置</button><div id="host" class="readOnlyContent"></div></div><script>
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
 const assertDrawerAlignment = async layout => {
  const positions=await evaluate(`(()=>{const position=row=>({icon:row.querySelector('.navDrawerListItemIcon').getBoundingClientRect().left,text:row.querySelector('.listItemBodyText').getBoundingClientRect().left});return {native:position(document.querySelector('.mainDrawer .navMenuOption')),categories:[...document.querySelectorAll('.mainDrawer [data-settings-category]')].map(row=>({category:row.dataset.settingsCategory,...position(row)}))}})()`);
  assert.equal(positions.categories.length,8);
  for(const category of positions.categories){
   assert.ok(Math.abs(category.icon-positions.native.icon)<1,`${layout}: ${category.category} icon must align with native General (${JSON.stringify(positions)})`);
   assert.ok(Math.abs(category.text-positions.native.text)<1,`${layout}: ${category.category} text must align with native General (${JSON.stringify(positions)})`);
  }
 };
 await call('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false});
 await evaluate('window.fixtureReady');
 await evaluate(`window.NativeShell={AppHost:{}};window.settingsModules=new Map();window.define=(id,deps,factory)=>settingsModules.set(id,{deps,factory});window.tigerestMountSettings=mountTigerestSettings;window.tigerestSettingsCategories=getTigerestSettingsCategories;window.tigerestInstallSettingsMenu=installTigerestSettingsMenu;`);
 await evaluate(fs.readFileSync(path.resolve(__dirname,'../native/embycompat.js'),'utf8'));
 await evaluate(fs.readFileSync(path.resolve(__dirname,'fixtures/settings_navigation.js'),'utf8'));
 if(iconFont){
  await evaluate('document.fonts.ready');
  assert.equal(await evaluate('document.fonts.check(\'16px "Material Symbols Rounded"\')'),true,'local native icon font loaded');
 }
 await evaluate('openSettingsCategory("audio")');
 assert.equal(await evaluate('document.querySelectorAll("#tigerest-settings-inline .tgs-tabs, #tigerest-settings-inline [role=tablist]").length'),0,
  'content has no duplicate category navigation');
 assert.deepEqual(await evaluate('[...document.querySelectorAll(".mainDrawer [data-settings-category]")].map(row=>row.dataset.settingsCategory)'),
  ['main','home','audio','video','subtitles','mpv','danmaku','other'],'all supported categories are in Emby left navigation');
 assert.equal(await evaluate('document.querySelector(".mainDrawer [aria-current=page]").dataset.settingsCategory'),'audio');
 const playbackCategoryTitle=await evaluate('window.tigerestAndroidApi ? "播放器" : "MPV 画质与插件"');
 assert.deepEqual(await evaluate('[...document.querySelectorAll(".mainDrawer .listItemBodyText")].map(node=>node.textContent)'),
  ['General','客户端','首页设置','音频','视频','字幕',playbackCategoryTitle,'弹幕样式','高级'],'native menu has categories without a redundant parent entry');
 assert.deepEqual(await evaluate('[...document.querySelectorAll(".mainDrawer [data-settings-category] .md-icon")].map(node=>node.textContent.codePointAt(0))'),
  [0xe30c,0xe88a,0xe050,0xe04b,0xe01c,0xe024,0xe0b7,0xe429],'native rows render each semantic category icon instead of arrows');
 await assertDrawerAlignment('desktop');
 await evaluate(`document.querySelectorAll('.mainDrawer .listItem-content').forEach(node=>node.classList.replace('navMenuOption-listItem-content','navMenuOption-listItem-content-reduceleftpadding'))`);
 await assertDrawerAlignment('TV wrapper');
 await evaluate(`document.querySelectorAll('.mainDrawer .listItem-content').forEach(node=>node.classList.replace('navMenuOption-listItem-content-reduceleftpadding','navMenuOption-listItem-content'))`);
 assert.ok(await evaluate('document.querySelectorAll(".tgs-setting").length>70'),'all supported setting definitions render');
 assert.equal(await evaluate('[...document.querySelectorAll(".tgs-setting input,.tgs-setting select,.tgs-setting textarea")].every(input=>input.labels?.length===1)'),true,'every input is associated with its visible form label');
 await evaluate(`(()=>{const search=document.querySelector('.tgs-search');search.value='透明度';search.dispatchEvent(new Event('input'))})()`);
 assert.equal(await evaluate('document.querySelector("[data-setting=\\"danmaku.opacity\\"]").offsetHeight'),0,'search only filters the selected category');
 assert.equal(await evaluate('document.querySelector(".tgs-empty").hidden'),false);
 await evaluate('openSettingsCategory("danmaku")');
 assert.equal(await evaluate('document.querySelector(".tgs-search").value'),'','category change clears search');
 assert.deepEqual(await evaluate('[...document.querySelectorAll(".tgs-section")].filter(group=>group.offsetHeight>0).map(group=>group.dataset.section)'),['danmaku']);
 await evaluate(`const opacity=document.querySelector('[data-setting="danmaku.opacity"] select');opacity.value=String(jmpInfo.settingsDescriptions.danmaku.find(s=>s.key==='opacity').options.findIndex(o=>o.value===0.5));opacity.dispatchEvent(new Event('change'))`);
 assert.deepEqual(await evaluate('saves.at(-1)'),['danmaku','opacity',0.5],'selected values reach persistence immediately');
 await evaluate(`document.querySelector('[data-section="danmaku"] .tgs-reset').click();new Promise(resolve=>setTimeout(resolve,50))`);
 assert.deepEqual(await evaluate('resets'),['danmaku']);
 assert.equal(await evaluate('jmpInfo.settings.danmaku.opacity'),0.7,'reset restores defaults');
 assert.equal(await evaluate('document.querySelectorAll("#tigerest-settings-style").length'),1,'reset releases prior style and controls');
 await evaluate('renderSettingsDrawer();new Promise(resolve=>setTimeout(resolve,20))');
 assert.equal(await evaluate('document.querySelectorAll(".mainDrawer [data-settings-category]").length'),8,'rerender does not duplicate native menu entries');
 assert.equal(await evaluate('document.querySelector(".mainDrawer [aria-current=page]").dataset.settingsCategory'),'danmaku','reset/rerender preserve selected category');
 await evaluate(`(()=>{const container=document.querySelector('.navDrawerItemsContainer');const rowItems=new Map([...container.children].map((row,index)=>[row,container.items[index]]));container.getItemFromElement=row=>rowItems.get(row);container.items=null;container.getItem=()=>null;for(const row of container.children){delete row.dataset.index;row.querySelector('.listItemBodyText').textContent=rowItems.get(row).Name;}window.virtualRowItems=rowItems;})()`);
 assert.equal(await evaluate('document.querySelectorAll(".mainDrawer [data-settings-category]").length'),8,'virtualized native rows resolve through getItemFromElement');
 await call('Emulation.setDeviceMetricsOverride',{width:360,height:740,deviceScaleFactor:1,mobile:true});
 await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
 assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true,'phone has no document overflow');
 assert.equal(await evaluate('document.querySelectorAll(".tgs-tabs").length'),0,'phone has no horizontal category strip');
 await evaluate('document.querySelector(".mainDrawer").classList.add("drawer-open");document.querySelector("[data-settings-category=video]").focus()');
 await assertDrawerAlignment('phone drawer');
 assert.equal(await evaluate('document.activeElement.dataset.settingsCategory'),'video','native category accepts focus');
 await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,nativeVirtualKeyCode:13,text:'\r'});
 await call('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,nativeVirtualKeyCode:13});
 await evaluate('new Promise(resolve=>setTimeout(resolve,60))');
 assert.equal(await evaluate('document.querySelector(".tgs-section.active").dataset.section'),'video','native menu remains keyboard activatable');
 assert.equal(await evaluate('document.querySelector(".mainDrawer").classList.contains("drawer-open")'),false,'native navigation action can close the mobile drawer');
 await evaluate('settingsController.onPause({});settingsController.onResume({});new Promise(resolve=>setTimeout(resolve,50))');
 assert.equal(await evaluate('document.querySelector(".tgs-section.active").dataset.section'),'video','cached route resumes the same category');
 if(process.env.TIGEREST_SETTINGS_SCREENSHOTS){
  fs.mkdirSync(process.env.TIGEREST_SETTINGS_SCREENSHOTS,{recursive:true});
  fs.writeFileSync(path.join(process.env.TIGEREST_SETTINGS_SCREENSHOTS,'settings-phone.png'),Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));
  await evaluate('document.querySelector(".mainDrawer").classList.add("drawer-open")');
  fs.writeFileSync(path.join(process.env.TIGEREST_SETTINGS_SCREENSHOTS,'settings-phone-drawer.png'),Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));
  await call('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false});
  fs.writeFileSync(path.join(process.env.TIGEREST_SETTINGS_SCREENSHOTS,'settings-desktop.png'),Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));
 }
 await evaluate('document.querySelector(".tgs-close").click()');
 assert.equal(await evaluate('window.returned'),true,'inline return leaves Emby route in control');
 assert.equal(await evaluate('document.querySelectorAll("#tigerest-settings-style").length'),0);
 await evaluate('document.querySelector("#origin").focus();mountTigerestSettings(null,"audio").then(value=>window.mount=value)');
 assert.equal(await evaluate('document.querySelector("#tigerest-settings-overlay [role=dialog]")?.getAttribute("aria-modal")'),'true');
 await evaluate(`(()=>{const select=document.querySelector('.tgs-category-select');select.value='danmaku';select.dispatchEvent(new Event('change'))})()`);
 assert.equal(await evaluate('document.querySelector(".tgs-section.active").dataset.section'),'danmaku','standalone fallback can still select a category');
 await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
 assert.equal(await evaluate('!!document.querySelector("#tigerest-settings-overlay")'),false);
 assert.equal(await evaluate('document.activeElement.id'),'origin','fallback closes and restores focus');
 console.log('settings UI: native category routes without redundant parent, desktop/TV/phone native alignment, single pane, search/reset/persistence, drawer rerender, keyboard activation, phone layout, cached route resume and fallback cleanup passed');
// Qt does not tick animation frames when launched with windowsHide, even while document.hidden is false.
},{visible:true}).catch(error=>{console.error(error);process.exitCode=1});
