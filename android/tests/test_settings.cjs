const assert=require('node:assert/strict'),withBrowser=require('./android_browser.cjs');
const {run,connect,delay}=require('./cdp.cjs');
withBrowser({'/':{type:'text/html',body:'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><body style="background:#101010;color:white">设置验收</body>'}},async({evaluate,url})=>{
 const original=await evaluate('api.settings.value("danmaku","opacity")');
 try{
  await evaluate('tigerestMountSettings(null,"danmaku")');
  const info=await evaluate('({text:document.getElementById("tigerest-settings-overlay").innerText,rows:document.querySelectorAll(".tgs-setting").length})');assert.ok(info.rows>30);assert.ok(!info.text.includes('NVIDIA RIFE'));assert.ok(!info.text.includes('uosc_danmaku'));
  await evaluate('(()=>{const input=document.querySelector("[data-setting=\\"danmaku.opacity\\"] select");const options=jmpInfo.settingsDescriptions.danmaku.find(s=>s.key==="opacity").options;input.value=String(options.findIndex(o=>Number(o.value)===0.5));input.dispatchEvent(new Event("change"));return true})()');
  await delay(200);assert.equal(await evaluate('api.settings.value("danmaku","opacity")'),.5);
  await evaluate('(()=>{const s=document.querySelector(".tgs-search");s.value="透明度";s.dispatchEvent(new Event("input"));return true})()');assert.ok(await evaluate('document.querySelector("[data-setting=\\"danmaku.opacity\\"]").offsetHeight>0'));
  run('shell','am','force-stop','top.tigerest.theater.debug');run('shell','am','start','-n','top.tigerest.theater.debug/top.tigerest.theater.MainActivity','--es','url',url);
  const c=await connect();try{
   for(let i=0;i<80;i++){if(await c.evaluate('!!window.api'))break;await delay(100);}
   assert.equal(await c.evaluate('api.settings.value("danmaku","opacity")'),.5);
   assert.ok(await c.evaluate('api.settings.setValue("video","aiRife",true).then(()=>false,()=>true)'),'unsupported settings reject');
   await c.evaluate('api.settings.resetToDefault("danmaku")');assert.equal(await c.evaluate('api.settings.value("danmaku","opacity")'),.7);
   await c.evaluate(`api.settings.setValue("danmaku","opacity",${original})`);
  }finally{c.close();}
  console.log(JSON.stringify({passed:true,rows:info.rows,persistence:true,reset:true}));
 }catch(e){await evaluate(`api.settings.setValue("danmaku","opacity",${original})`).catch(()=>{});throw e;}
}).catch(e=>{console.error(e);process.exitCode=1;});
