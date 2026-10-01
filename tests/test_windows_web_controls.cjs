// Actual WebEngine, QWebChannel, native dialogs, and computed appearance styles.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const os=require('node:os'),http=require('node:http'),net=require('node:net');
const {spawn,execFile}=require('node:child_process'),{promisify}=require('node:util');
const {setTimeout:delay}=require('node:timers/promises');
const exec=promisify(execFile);
async function run(){
 const exe=path.resolve(process.argv[2]),stage=process.argv.find(a=>a.startsWith('--stage='))?.slice(8)||'all';
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'tigerest-controls-')),id=require('node:crypto').randomUUID().replaceAll('-','');
 const profile=path.join(root,'profiles',id);fs.mkdirSync(profile,{recursive:true});
 const image=path.join(root,'头像 测试.png');fs.writeFileSync(image,Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWq8AAAAASUVORK5CYII=','base64'));
 const server=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html; charset=utf-8');res.end(`<!doctype html><html><head><style>body{margin:40px;color:white;font:16px sans-serif}.card{display:inline-block;width:180px;margin:50px}.cardBox{height:100px;background:#555}a{display:block;color:white;padding:20px}.detailSelectSeasonContainer{margin-bottom:.4em!important}.emby-scrollbuttons-scrollbutton{background:white;width:60px;height:60px}.cardOverlayFab-primary{background:green}.spacer{height:1200px}</style></head><body>
 <input id="avatar" type="file" accept="image/png"><div class="detailSelectSeasonContainer">季度</div>
 <div class="itemsContainer" style="width:320px;overflow-x:auto;white-space:nowrap"><div class="backdropCard card" tabindex="0"><div class="cardBox"><a id="episode" href="#">选集</a><div class="cardImageContainer"><button class="cardOverlayFab-primary" data-action="play">图片播放</button></div></div></div><div class="backdropCard card"><div class="cardBox">第二集</div></div></div>
 <div class="mainDetailButtons"><button id="normalPlay">播放</button></div><button class="emby-scrollbuttons-scrollbutton">下一页</button><div class="spacer"></div>
 <script>document.querySelector('#avatar').onchange=async e=>{const f=e.target.files[0];window.selectedFile=f&&{name:f.name,bytes:Array.from(new Uint8Array(await f.arrayBuffer()))};};</script></body></html>`);});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+server.address().port;
 fs.writeFileSync(path.join(profile,'profile.json'),JSON.stringify({name:id}));
 fs.writeFileSync(path.join(profile,'Tigerest Theater.conf'),JSON.stringify({version:10,sections:{main:{enableWindowsTrayIcon:false},path:{startupurl_desktop:url}}}));
 const listener=net.createServer();await new Promise(r=>listener.listen(0,'127.0.0.1',r));const port=listener.address().port;await new Promise(r=>listener.close(r));
 const child=spawn(exe,['--config-dir',root,'--profile',id,'--disable-gpu','--remote-debugging-port','127.0.0.1:'+port],{cwd:path.dirname(exe),stdio:['ignore','pipe','pipe']});
 let diagnostics='',socket;child.stdout.on('data',d=>diagnostics=(diagnostics+d).slice(-5000));child.stderr.on('data',d=>diagnostics=(diagnostics+d).slice(-5000));
 const driver=async(action,...args)=>JSON.parse((await exec(process.env.TEST_PYTHON||'python',[path.join(__dirname,'windows_dialog_driver.py'),String(child.pid),action,...args],{windowsHide:true,timeout:12000})).stdout);
 try{
  let page;for(let i=0;i<150;i++){try{page=(await(await fetch('http://127.0.0.1:'+port+'/json/list')).json()).find(p=>p.type==='page'&&p.url.startsWith(url));if(page)break;}catch{}await delay(100);}
  assert.ok(page,'application fixture starts');socket=new WebSocket(page.webSocketDebuggerUrl);await new Promise((r,j)=>{socket.addEventListener('open',r,{once:true});socket.addEventListener('error',j,{once:true});});
  let seq=0;const pending=new Map();socket.addEventListener('message',e=>{const m=JSON.parse(e.data);if(pending.has(m.id)){const p=pending.get(m.id);clearTimeout(p.timer);pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);}});
  const send=(method,params={})=>new Promise((resolve,reject)=>{const n=++seq,timer=setTimeout(()=>{pending.delete(n);reject(Error(method+' timeout'));},12000);pending.set(n,{resolve,reject,timer});socket.send(JSON.stringify({id:n,method,params}));});
  const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;};
  const point=selector=>evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
  const mouse=(type,p,more={})=>send('Input.dispatchMouseEvent',{type,...p,...more});
  const click=async selector=>{const p=await point(selector);await mouse('mouseMoved',p);await mouse('mousePressed',p,{button:'left',clickCount:1});await mouse('mouseReleased',p,{button:'left',clickCount:1});};
  for(let i=0;i<100;i++){if(await evaluate('!!window.api?.player && document.readyState==="complete"'))break;await delay(100);}
  if(stage==='all'||stage==='ui'||stage==='appearance'){
   const p=await point('#episode');await mouse('mouseMoved',p);await mouse('mousePressed',p,{button:'left',clickCount:1});await mouse('mouseMoved',{x:10,y:250},{button:'left',buttons:1});await mouse('mouseReleased',{x:10,y:250},{button:'left',clickCount:1});await delay(550);
   const appearance=await evaluate(`(()=>{const c=getComputedStyle(document.querySelector('.cardBox'));return {transform:c.transform,overlay:getComputedStyle(document.querySelector('.cardOverlayFab-primary')).display,normal:getComputedStyle(document.querySelector('#normalPlay')).display,seasonPadding:parseFloat(getComputedStyle(document.querySelector('.detailSelectSeasonContainer')).paddingBottom),arrowWidth:parseFloat(getComputedStyle(document.querySelector('.emby-scrollbuttons-scrollbutton')).width),scrollbarWidth:parseFloat(getComputedStyle(document.body,'::-webkit-scrollbar').width)};})()`);
   assert.ok(appearance.transform==='none'||appearance.transform==='matrix(1, 0, 0, 1, 0, 0)','mouse drag must release card lift: '+appearance.transform);
   assert.equal(appearance.overlay,'none','cover play overlay is removed');assert.notEqual(appearance.normal,'none','normal playback remains accessible');assert.ok(appearance.seasonPadding>=16,'season selection has space above lifted cards');assert.ok(appearance.arrowWidth<=44,'scroll arrows are compact');assert.ok(appearance.scrollbarWidth<=10,'scrollbar is slim');
   await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
   await evaluate('document.querySelector(".card").focus()');await delay(500);
   assert.notEqual(await evaluate('getComputedStyle(document.querySelector(".cardBox")).transform'),'none','keyboard focus on the card wrapper retains feedback');
   await evaluate('document.activeElement.blur()');
  }
  if(stage==='all'||stage==='ui'||stage==='title'){
   const title=await driver('title');assert.ok(title.found);const dark=title.attributes['20'].supported?title.attributes['20']:title.attributes['19'];assert.equal(dark.value,1,'native Windows title bar uses dark mode');
   if(title.attributes['35'].supported)assert.equal(title.attributes['35'].value,0x1b1411,'caption matches the app panel');
  }
  if(stage==='all'||stage==='ui'||stage==='extension'){
   await evaluate(`(async()=>{const host=document.createElement('div');host.id='extensionHost';document.body.prepend(host);window.controlPanel=await tigerestMountSettings(host,'video');})()`);await delay(250);
   const actions=await evaluate(`Array.from(document.querySelectorAll('#tigerest-rife-extension button')).filter(b=>['下载扩展','导入离线包'].includes(b.textContent)).map(b=>!b.disabled)`);assert.equal(actions.length,2);assert.ok(actions.every(Boolean),'shipped app offers both extension actions');
   await evaluate(`Array.from(document.querySelectorAll('#tigerest-rife-extension button')).find(b=>b.textContent==='导入离线包').click()`);
   const dialog=await driver('cancel');assert.ok(dialog.opened,'offline import opens a native file dialog');await delay(200);
   await evaluate('controlPanel.dispose();document.querySelector("#extensionHost").remove()');
  }
  if(stage==='all'||stage==='ui'||stage==='settings'){
   await evaluate(`(async()=>{const host=document.createElement('div');host.id='settingsHost';host.className='tigerest-settings-host';document.body.prepend(host);window.settingsMount=await tigerestMountSettings(host,'video');})()`);
   assert.equal(await evaluate('!!document.querySelector("#tigerest-settings-overlay")'),false,'settings render in the supplied Emby page');
   assert.equal(await evaluate('document.querySelector("#tigerest-settings-inline .tgs-section.active").dataset.section'),'video');
   const setting='video.aiRife';
   const original=await evaluate(`document.querySelector('[data-setting="${setting}"] input').checked`);
   await evaluate(`(()=>{const input=document.querySelector('[data-setting="${setting}"] input');input.checked=!input.checked;input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
   await delay(200);
   await evaluate(`(async()=>{settingsMount.dispose();settingsMount=await tigerestMountSettings(document.querySelector('#settingsHost'),'video');})()`);
   assert.equal(await evaluate(`document.querySelector('[data-setting="${setting}"] input').checked`),!original,'inline settings save through the actual native API');
   await evaluate(`(()=>{const original=api.settings.resetToDefault;window.confirm=()=>true;api.settings.resetToDefault=section=>new Promise(resolve=>{window.finishReset=async()=>{await original(section);resolve();};});document.querySelector('#tigerest-settings-inline .tgs-section.active .tgs-reset').click();settingsMount.dispose();finishReset();})()`);
   await delay(400);
   assert.equal(await evaluate('!!document.querySelector("#tigerest-settings-inline")'),false,'navigation disposes the inline settings page');
   await evaluate(`(async()=>{const original=api.player.mpvDiagnostics;api.player.mpvDiagnostics=()=>new Promise(resolve=>window.finishDiagnostics=async()=>resolve(await original()));const abort=new AbortController();window.pendingMount=tigerestMountSettings(document.querySelector('#settingsHost'),'video',null,abort.signal);await new Promise(r=>setTimeout(r,30));abort.abort();finishDiagnostics();await pendingMount;api.player.mpvDiagnostics=original;})()`);
   assert.equal(await evaluate('!!document.querySelector("#tigerest-settings-inline")'),false,'cancelled pending mount cannot reappear');
   await evaluate(`document.querySelector('#settingsHost').remove()`);
  }
  if(stage==='all'||stage==='filepicker'){
   await click('#avatar');const dialog=await driver('cancel');assert.ok(dialog.opened,'HTML avatar browse opens the packaged native file picker');await delay(200);
   // The OS picker is covered above. Set the local file through Chromium to
   // validate the HTML upload bytes without relying on shell-dialog internals.
   const doc=await send('DOM.getDocument');const input=await send('DOM.querySelector',{nodeId:doc.root.nodeId,selector:'#avatar'});
   await send('DOM.setFileInputFiles',{nodeId:input.nodeId,files:[image]});
   let selected;for(let i=0;i<100;i++){selected=await evaluate('window.selectedFile');if(selected)break;await delay(50);}
   assert.equal(selected?.name,path.basename(image),'HTML upload accepts the Unicode image path');assert.deepEqual(selected.bytes,Array.from(fs.readFileSync(image)),'HTML upload receives the selected image bytes');
  }
  console.log(JSON.stringify({windowsControls:true,stage,productionWrites:0}));
 }catch(error){console.error(diagnostics);throw error;}finally{
  socket?.close();if(child.exitCode===null){const end=new Promise(r=>child.once('exit',r));child.kill();await end;}await new Promise(r=>server.close(r));
  assert.equal(path.dirname(path.resolve(root)),path.resolve(os.tmpdir()));assert.ok(path.basename(root).startsWith('tigerest-controls-'));fs.rmSync(root,{recursive:true,force:true,maxRetries:10,retryDelay:200});
 }
}
run().catch(e=>{console.error(e);process.exitCode=1;});
