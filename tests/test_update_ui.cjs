// Shared prompt in a real browser with a Qt-shaped native boundary; no real installer is run.
const assert=require('node:assert/strict'),path=require('node:path');
const withBrowser=require('./community_browser.cjs');
withBrowser({
 '/':{type:'text/html',body:`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body><button id="origin">客户端设置</button><script>
 window.TigerestUpdate?.destroy();delete window.TigerestUpdate;
 window.calls=[];window.listeners=[];window.state={status:'idle',currentVersion:'2.4.1'};
 const system={appUpdateChanged:{connect(fn){listeners.push(fn)},disconnect(fn){listeners=listeners.filter(f=>f!==fn)}},appUpdateState(cb){cb(state)}};
 for(const method of ['checkForUpdates','downloadAppUpdate','installAppUpdate','cancelAppUpdate','skipAppUpdate','deferAppUpdate'])system[method]=(...args)=>{const cb=args.pop();calls.push([method,...args]);cb?.()};
 window.apiPromise=Promise.resolve({system});window.emit=next=>{state={...state,...next};for(const fn of listeners)fn(state)};
 </script><script src="/update.js"></script></body>`},
 '/update.js':{path:path.resolve(__dirname,'../native/updatePlugin.js')}
},async({evaluate,call})=>{
 assert.equal(await evaluate('typeof window.TigerestUpdate'), 'object','startup prompt must exist before Emby login');
 await evaluate('TigerestUpdate.start()');await evaluate('TigerestUpdate.start()');
 assert.deepEqual(await evaluate('calls'),[['checkForUpdates',false]],'one startup request per page, native deduplicates per process');
 await evaluate(`emit({status:'current',manual:false});`);assert.equal(await evaluate('!!document.querySelector("#tigerest-update-dialog[open]")'),false,'silent when current');
 await evaluate(`emit({status:'error',error:'网络不可用',manual:false});`);assert.equal(await evaluate('!!document.querySelector("#tigerest-update-dialog[open]")'),false,'automatic network errors do not interrupt startup');
 await evaluate(`emit({status:'available',version:'2.5.0',size:1024,notes:'<img src=x onerror="window.unsafe=true">',error:'',manual:false,installLabel:'安装更新'});`);
 assert.equal(await evaluate('document.querySelector("#tigerest-update-dialog").open'),true);
 assert.equal(await evaluate('document.querySelector("#tigerest-update-dialog img")'),null,'release notes rendered as text');
 await evaluate('document.querySelector("[data-update-action=close]").click()');
 assert.deepEqual(await evaluate('calls.at(-1)'),['deferAppUpdate']);
 await evaluate(`emit({status:'available',deferred:true});`);
 assert.equal(await evaluate('document.querySelector("#tigerest-update-dialog").open'),false,'Later survives state replay without persisting skip');
 await evaluate(`emit({status:'available',deferred:false});`);
 await evaluate('document.querySelector("[data-update-action=skip]").click()');
 assert.deepEqual(await evaluate('calls.at(-1)'),['skipAppUpdate']);
 assert.equal(await evaluate('document.querySelector("#tigerest-update-dialog").open'),false);
 await evaluate('TigerestUpdate.check()');assert.deepEqual(await evaluate('calls.at(-1)'),['checkForUpdates',true]);
 await evaluate(`emit({status:'available',manual:true});document.querySelector('[data-update-action=download]').click()`);
 assert.deepEqual(await evaluate('calls.at(-1)'),['downloadAppUpdate']);
 await evaluate(`emit({status:'downloading',received:512});`);
 assert.equal(await evaluate('document.querySelector("#tigerest-update-dialog progress").value'),50);
 await evaluate(`emit({status:'ready',received:1024});`);
 assert.deepEqual(await evaluate('calls.at(-1)'),['installAppUpdate',true],'one click downloads then opens installer');
 await evaluate(`emit({status:'ready',error:'系统安装已取消'});`);
 assert.equal(await evaluate('calls.filter(c=>c[0]==="installAppUpdate").length'),1,'installer cancellation must not loop');
 assert.ok(await evaluate('document.querySelector("#tigerest-update-dialog").textContent.includes("系统安装已取消")'));
 await evaluate(`emit({status:'ready',installAfterDownload:true});emit({status:'ready',installAfterDownload:true});`);
 assert.equal(await evaluate('calls.filter(c=>c[0]==="installAppUpdate").length'),2,'native session retains one-click intent after document replacement');
 await evaluate(`emit({status:'ready',installAfterDownload:false});`);
 await evaluate(`emit({status:'error',error:'下载校验失败'});document.querySelector('[data-update-action=download]').click()`);
 assert.deepEqual(await evaluate('calls.at(-1)'),['downloadAppUpdate']);
 await evaluate(`emit({status:'downloading',received:100});document.querySelector('[data-update-action=cancel]').click()`);
 assert.deepEqual(await evaluate('calls.at(-1)'),['cancelAppUpdate']);
 await evaluate(`emit({status:'ready'});`);assert.equal(await evaluate('calls.filter(c=>c[0]==="installAppUpdate").length'),2,'cancel prevents delayed auto-install');
 await call('Emulation.setDeviceMetricsOverride',{width:360,height:740,deviceScaleFactor:1,mobile:true});
 assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true,'narrow phone fits');
 if(process.env.TIGEREST_UPDATE_SCREENSHOTS){
  await evaluate(`emit({status:'available',deferred:false,version:'2.4.2',currentVersion:'2.4.1',size:78046671,error:'',notes:'启动时自动检查更新，支持应用内下载。\\n修复弹幕流畅度，增加播放器手势控制。'});`);
  const fs=require('node:fs');
  fs.mkdirSync(process.env.TIGEREST_UPDATE_SCREENSHOTS,{recursive:true});
  fs.writeFileSync(path.join(process.env.TIGEREST_UPDATE_SCREENSHOTS,'updates-phone.png'),Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));
  await call('Emulation.setDeviceMetricsOverride',{width:1100,height:800,deviceScaleFactor:1,mobile:false});
  fs.writeFileSync(path.join(process.env.TIGEREST_UPDATE_SCREENSHOTS,'updates-desktop.png'),Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));
 }
 await evaluate(`apiPromise.then(api=>{api.system.checkForUpdates=(manual,callback)=>{const p=Promise.reject(new Error('桥接请求失败'));p.then(callback,()=>callback(false));return p;}});`);
 await evaluate('TigerestUpdate.check()');
 assert.ok(await evaluate('document.querySelector("#tigerest-update-dialog").textContent.includes("桥接请求失败")'),'Android Promise rejection must reach the visible error instead of callback(false) hiding it');
 await evaluate('TigerestUpdate.destroy()');assert.equal(await evaluate('listeners.length'),0);
 console.log('update UI: startup, skip/manual, text safety, progress, install-once, retry/cancel and narrow layout passed');
}).catch(e=>{console.error(e);process.exitCode=1});
