const test=require('node:test'), assert=require('node:assert/strict'), vm=require('node:vm'), fs=require('node:fs');
function fixture(){let sent=[],timers=[];const window={};vm.runInNewContext(fs.readFileSync('apple/Resources/ipadBridge.js','utf8'),{window,console,setTimeout:fn=>(timers.push(fn),timers.length),clearTimeout(){}});return {sent,timers,make:()=>window.createIPadBridge({postMessage:value=>sent.push(JSON.parse(value))},{})};}
test('promise and legacy callback use the same native result',async()=>{const f=fixture(),b=f.make();let callback;const p=b.api.player.getPosition(v=>callback=v);assert.equal(f.sent[0].method,'getPosition');b.receive({id:f.sent[0].id,result:3200});assert.equal(await p,3200);assert.equal(callback,3200);assert.equal(b.api.system.isIPad,true);assert.equal(b.api.system.isAndroid,false);assert.equal(typeof b.api.system.startDownload,'function');});
test('signal ordering, disconnect and shutdown are deterministic',async()=>{const f=fixture(),b=f.make(),seen=[];const listener=v=>seen.push(v);b.api.player.positionUpdate.connect(listener);[1,2].forEach(v=>b.receive({component:'player',signal:'positionUpdate',args:[v]}));b.api.player.positionUpdate.disconnect(listener);b.receive({component:'player',signal:'positionUpdate',args:[3]});assert.deepEqual(seen,[1,2]);const p=b.api.player.pause();b.close();await assert.rejects(p,/关闭/);b.receive({id:f.sent[0].id,result:true});await assert.rejects(b.api.player.play(),/关闭/);});
test('timeout rejects and ignores late replies',async()=>{const f=fixture(),b=f.make(),p=b.api.system.hello();f.timers[0]();await assert.rejects(p,/超时/);b.receive({id:f.sent[0].id,result:true});});
test('native errors reject promise and settle compatibility callback',async()=>{const f=fixture(),b=f.make();let callback;const p=b.api.player.play(v=>callback=v);b.receive({id:f.sent[0].id,error:'failed'});await assert.rejects(p,/failed/);assert.equal(callback,false);});
test('native player volume changes reach the shared player',()=>{const b=fixture().make(),seen=[];b.api.player.volumeChanged.connect(value=>seen.push(value));b.receive({component:'player',signal:'volumeChanged',args:[37]});assert.deepEqual(seen,[37]);});

test('watch notifications and app lifecycle cross the iPad bridge',async()=>{const f=fixture(),b=f.make(),seen=[];b.api.player.backgrounded.connect(()=>seen.push('background'));b.api.player.foregrounded.connect(()=>seen.push('foreground'));const request=b.api.player.showMessage('朋友 暂停了');assert.equal(f.sent[0].method,'showMessage');assert.deepEqual(f.sent[0].args,['朋友 暂停了']);b.receive({id:f.sent[0].id,result:true});await request;for(const signal of ['backgrounded','foregrounded'])b.receive({component:'player',signal,args:[]});assert.deepEqual(seen,['background','foreground']);});

// The installed bridge on a page whose window keeps listeners as a browser does:
// an event reaching window removes a once listener before it runs.
function installedPage(){
 const sent=[],listeners=[];
 const window={document:{},__tigerestBootstrap:{},webkit:{messageHandlers:{tigerestNative:{postMessage:value=>sent.push(JSON.parse(value))}}},
  addEventListener(type,fn,options){listeners.push({type,fn,once:!!options?.once});},
  removeEventListener(type,fn){const i=listeners.findIndex(l=>l.type===type&&l.fn===fn);if(i>=0)listeners.splice(i,1);}};
 vm.runInNewContext(fs.readFileSync('apple/Resources/ipadBridge.js','utf8'),{window,console,setTimeout,clearTimeout});
 const deliver=event=>{for(const l of listeners.filter(l=>l.type===event.type)){if(l.once)window.removeEventListener(l.type,l.fn);l.fn(event);}};
 return {window,api:window.tigerestIPadApi,sent,deliver,reply:message=>window.__tigerestReceive(message),pagehideListeners:()=>listeners.filter(l=>l.type==='pagehide').length};
}
test('a Jellyfin view change keeps the bridge, and leaving the page still closes it',async()=>{
 const {window,api,sent,deliver,reply,pagehideListeners}=installedPage();
 // Jellyfin's web client dispatches its own bubbling pagehide CustomEvent from a view element.
 deliver({type:'pagehide',isTrusted:false,target:{tagName:'DIV'},bubbles:true,detail:{}});
 const hello=api.system.hello();assert.equal(sent.at(-1)?.method,'hello');
 reply({id:sent.at(-1).id,result:true});assert.equal(await hello,true);
 const seen=[];api.player.positionUpdate.connect(value=>seen.push(value));
 const pending=api.settings.setValue('main','fullscreen',true);
 deliver({type:'pagehide',isTrusted:true,target:window.document,persisted:false});
 await assert.rejects(pending,/页面已关闭/);
 reply({component:'player',signal:'positionUpdate',args:[1]});assert.deepEqual(seen,[]);
 await assert.rejects(api.system.hello(),/页面已关闭/);
 assert.equal(pagehideListeners(),0,'the page lifecycle listener is released');
});
