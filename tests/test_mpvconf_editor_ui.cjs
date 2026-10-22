// The mpv.conf editor inside the real client: native bridge, parser, validator
// and file writes are production code; only the page is a local fixture
// instead of an Emby server. Checks what reaches the user's mpv.conf on disk.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {setTimeout:delay}=require('node:timers/promises');
const withBrowser=require('./community_browser.cjs');

const findConf=root=>{
 const profiles=path.join(root,'profiles');
 for(const id of fs.readdirSync(profiles)){
  const file=path.join(profiles,id,'mpv','mpv.conf');
  if(fs.existsSync(file))return file;
 }
 throw Error('mpv.conf not written');
};
const until=async(evaluate,expression,message,timeout=8000)=>{
 const deadline=Date.now()+timeout;
 while(Date.now()<deadline){if(await evaluate(expression))return;await delay(100);}
 throw Error(message+': '+await evaluate('document.querySelector(".tgs-conf-status")?.textContent'));
};

withBrowser({
 '/':{type:'text/html',body:'<!doctype html><meta charset="utf-8"><title>mpv.conf fixture</title><body style="background:#141414;color:#eee"></body>'}
},async({evaluate,webengine,profile})=>{
 assert.ok(webengine,'the editor needs the native player bridge; run with the client executable and --webengine');
 await evaluate('window.initCompleted');
 const conf=findConf(profile);
 const original=fs.readFileSync(conf,'utf8');
 assert.match(original,/==== 大河影院管理区·头部（只读）====/);
 assert.match(original,/\[tigerest-default\]/);

 await evaluate(`(async()=>{await window.tigerestMountSettings(null,'mpv');})()`);
 await until(evaluate,'!!document.querySelector(".tgs-conf-text")?.value','editor did not load the user area');
 // Settings now owned by the editor are not shown as plain rows any more.
 assert.equal(await evaluate('!!document.querySelector(\'[data-setting="mpv.configMode"]\')'),false);
 assert.equal(await evaluate('!!document.querySelector(\'[data-setting="mpv.debandThreshold"]\')'),false);
 assert.equal(await evaluate('!!document.querySelector(\'[data-setting="mpv.renderBackend"]\')'),true);
 assert.equal(await evaluate('document.querySelectorAll(".tgs-conf-diagnostics li.error").length'),0,'default configuration has errors');
 assert.match(await evaluate('document.querySelector(".tgs-conf-managed pre").textContent'),/配置版本/);
 assert.ok(await evaluate('document.querySelectorAll(".tgs-conf-plus").length')>100,'every line boundary has a "+"');
 assert.equal(await evaluate('document.querySelector("#tgs-mpvconf-preset").value'),'tigerest-default');
 assert.equal(await evaluate('document.querySelector("#tgs-mpvconf-deband-threshold").value'),'24');

 // Form edit: the live-action threshold is inherited (48); setting it adds
 // exactly one line in that profile and saves the file.
 await evaluate(`(()=>{const s=document.querySelector("#tgs-mpvconf-preset");s.value="tigerest-liveaction";s.dispatchEvent(new Event("change"));})()`);
 await until(evaluate,'document.querySelector("#tgs-mpvconf-deband-threshold")?.value==="48"','live-action form did not load');
 await evaluate(`(()=>{const i=document.querySelector("#tgs-mpvconf-deband-threshold");i.value="30";i.dispatchEvent(new Event("change"));})()`);
 await until(evaluate,'document.querySelector(".tgs-conf-status").textContent.startsWith("已保存")','form edit was not saved');
 let saved=fs.readFileSync(conf,'utf8');
 const live=saved.slice(saved.indexOf('[tigerest-liveaction]'),saved.indexOf('[tigerest-aggressive-test]'));
 assert.match(live,/# 色带识别阈值\ndeband-threshold=30\n/);
 assert.equal(saved.split('\n').length,original.split('\n').length+2);

 // An error blocks saving; the file keeps the last good text.
 await evaluate(`(()=>{const t=document.querySelector(".tgs-conf-text");t.value=t.value.replace("cache-pause=yes","cache-pause=maybe");t.dispatchEvent(new Event("input"));})()`);
 await until(evaluate,'document.querySelector(".tgs-conf-status").classList.contains("error")','invalid value was not reported');
 assert.match(await evaluate('document.querySelector(".tgs-conf-diagnostics li.error").textContent'),/cache-pause 只能写 yes 或 no/);
 assert.equal(fs.readFileSync(conf,'utf8'),saved,'invalid text must not be saved');

 // Leaving with errors asks first; "强行使用" writes the text anyway.
 await evaluate('document.querySelector(".tgs-close").click()');
 await until(evaluate,'!!document.querySelector(".tgs-conf-modal")','leaving did not ask about the errors');
 await evaluate('[...document.querySelectorAll(".tgs-conf-modal button")].find(b=>b.textContent==="强行使用").click()');
 await until(evaluate,'!document.querySelector("#tigerest-settings-overlay")','settings did not close after forcing');
 saved=fs.readFileSync(conf,'utf8');
 assert.match(saved,/\ncache-pause=maybe\n/);

 // Reopen, fix the line through the "+" picker flow: insert a shader into
 // the default profile and a locked option is refused by the validator.
 await evaluate(`(async()=>{await window.tigerestMountSettings(null,'mpv');})()`);
 await until(evaluate,'!!document.querySelector(".tgs-conf-text")?.value','editor did not reload');
 await evaluate(`(()=>{const t=document.querySelector(".tgs-conf-text");t.value=t.value.replace("cache-pause=maybe","cache-pause=yes");t.dispatchEvent(new Event("input"));})()`);
 await until(evaluate,'document.querySelector(".tgs-conf-status").textContent.startsWith("已保存")','fixed text was not saved');
 const header=await evaluate(`(()=>{const lines=document.querySelector(".tgs-conf-text").value.split("\\n");return lines.indexOf("[tigerest-default]")+1;})()`);
 assert.ok(header>0);
 await evaluate(`document.querySelectorAll(".tgs-conf-plus")[${header}].click()`);
 await until(evaluate,'!!document.querySelector(".tgs-conf-modal .tgs-conf-tabs")','"+" did not open the picker');
 assert.match(await evaluate('document.querySelector(".tgs-conf-modal .tgs-conf-note").textContent'),/默认（Anime AA 高强度）/);
 await evaluate('[...document.querySelectorAll(".tgs-conf-modal .tgs-conf-tabs button")].find(b=>b.textContent==="着色器").click()');
 await evaluate(`(()=>{const items=[...document.querySelectorAll(".tgs-conf-modal .tgs-conf-pick")];const pick=items.find(i=>i.textContent.includes("SSim/SSimSuperRes_RT.glsl"));pick.closest("details").open=true;pick.querySelector("button").click();})()`);
 await until(evaluate,'!document.querySelector(".tgs-conf-modal")','picker did not close after adding');
 await until(evaluate,'document.querySelector(".tgs-conf-status").textContent.startsWith("已保存")','shader insert was not saved');
 saved=fs.readFileSync(conf,'utf8');
 assert.ok(saved.includes('[tigerest-default]\n# SSimSuperRes 放大后修正：放大之后修正锐度与振铃；放在放大着色器之后\nglsl-shader=~~/shaders/SSim/SSimSuperRes_RT.glsl\n'),'shader line lands right after the profile header');

 await evaluate(`(()=>{const t=document.querySelector(".tgs-conf-text");t.value="input-ipc-server=/tmp/elsewhere\\n"+t.value;t.dispatchEvent(new Event("input"));})()`);
 await until(evaluate,'document.querySelector(".tgs-conf-status").classList.contains("error")','locked option was accepted');
 assert.match(await evaluate('document.querySelector(".tgs-conf-diagnostics li.error").textContent'),/由软件管理/);

 // Restoring the default replaces the user area and keeps a backup.
 await evaluate('window.confirm=()=>true');
 await evaluate('[...document.querySelectorAll(".tgs-conf-toolbar button")].find(b=>b.textContent==="恢复默认配置").click()');
 await until(evaluate,'!!document.querySelector(".tgs-conf-modal")','restore did not show the changes');
 await evaluate('[...document.querySelectorAll(".tgs-conf-modal button")].find(b=>b.textContent==="恢复默认").click()');
 await until(evaluate,'!document.querySelector(".tgs-conf-text").value.includes("SSimSuperRes")','restore did not reset the editor');
 await delay(300);
 const userArea=text=>text.slice(text.indexOf('==== 头部结束 ===='),text.indexOf('==== 大河影院管理区·尾部'));
 assert.equal(userArea(fs.readFileSync(conf,'utf8')),userArea(original));
 // The tail follows the preset chosen earlier in this test.
 assert.match(fs.readFileSync(conf,'utf8'),/\nprofile=tigerest-liveaction\n/);
 assert.ok(fs.existsSync(path.join(path.dirname(conf),'mpv.conf.before-restore')));
 // A user filter applies live; enabling RIFE suspends the conflicting one in
 // the file and in the running player, and disabling RIFE restores both.
 await evaluate(`(()=>{const t=document.querySelector(".tgs-conf-text");t.value=t.value.replace("cache-pause=yes","cache-pause=yes\\n# 测试滤镜\\nvf-append=@user-1:hflip\\n# 改帧率\\nvf-append=@user-2:fps=60");t.dispatchEvent(new Event("input"));})()`);
 await until(evaluate,'document.querySelector(".tgs-conf-status").textContent.startsWith("已保存")','filters were not saved');
 const filters=async()=>(await evaluate('window.api.player.mpvDiagnostics()')).videoFilters.join(',');
 assert.equal(await filters(),'@user-1:hflip,@user-2:fps');
 await evaluate('jmpInfo.settings.video.aiRife=true');
 const suspendedLine='#[暂停执行:RIFE] vf-append=@user-2:fps=60';
 for(let i=0;i<80&&!fs.readFileSync(conf,'utf8').includes(suspendedLine);i++)await delay(100);
 assert.ok(fs.readFileSync(conf,'utf8').includes(suspendedLine),'RIFE did not suspend the frame-rate filter');
 assert.ok(fs.readFileSync(conf,'utf8').includes('\nvf-append=@user-1:hflip\n'),'RIFE must leave other filters alone');
 assert.equal(await filters(),'@user-1:hflip');
 await evaluate('jmpInfo.settings.video.aiRife=false');
 for(let i=0;i<80&&fs.readFileSync(conf,'utf8').includes(suspendedLine);i++)await delay(100);
 assert.ok(fs.readFileSync(conf,'utf8').includes('\nvf-append=@user-2:fps=60\n'),'disabling RIFE did not restore the line');
 assert.equal(await filters(),'@user-1:hflip,@user-2:fps');
 console.log('mpv.conf editor: form, validation, leave guard, "+" insert, lock, restore and RIFE suspension verified');
},{startupTimeout:30000});
