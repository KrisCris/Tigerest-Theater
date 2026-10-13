const assert=require('node:assert/strict'),path=require('node:path');
const withBrowser=require('./community_browser.cjs');
withBrowser({
 '/':{type:'text/html',body:`<!doctype html><meta charset="utf-8"><body><div class="skinHeader"><div class="headerRight"></div></div><script>
 window.jmpInfo={capabilities:{selfUpdate:false,updateCheck:true}};
 window.finishCheck=null;window.calls=[];window.listeners=[];window.state={status:'idle',currentVersion:'2.6.0',checkOnly:true};
 const system={appUpdateChanged:{connect(fn){listeners.push(fn)},disconnect(fn){listeners=listeners.filter(x=>x!==fn)}},appUpdateState(cb){cb(state)}};
 for(const name of ['checkForUpdates','downloadAppUpdate','installAppUpdate','skipAppUpdate','deferAppUpdate','openExternalUrl'])system[name]=(...args)=>{const cb=args.pop();calls.push([name,...args]);if(name==='checkForUpdates'&&!args[0]){emit({status:'checking'});return new Promise(resolve=>{window.finishCheck=()=>{emit({status:'unpublished',projectVersion:'2.6.0'});cb?.(true);resolve(true)}})}cb?.(true);return Promise.resolve(true)};
 window.apiPromise=Promise.resolve({system});window.emit=next=>{state={...state,...next};listeners.forEach(fn=>fn(state))};
 </script><script src="/update.js"></script></body>`},
 '/update.js':{path:path.resolve(__dirname,'../native/updatePlugin.js')}
},async({evaluate})=>{
 await evaluate('Promise.race([TigerestUpdate.start(),new Promise(r=>setTimeout(r,50))])');
 await evaluate('TigerestUpdate.open();new Promise(r=>setTimeout(r,50))');
 assert.equal(await evaluate('document.querySelector("#tigerest-update-dialog")?.open'),true,'Pending startup check must show checking dialog immediately');
 await evaluate('finishCheck();new Promise(r=>setTimeout(r,50))');
 assert.deepEqual(await evaluate('calls'),[['checkForUpdates',false]]);
 await evaluate(`emit({status:'unpublished',projectVersion:'2.6.0',message:'尚未发布 iPad 正式版。',notes:'项目更新说明',releaseUrl:'https://github.com/Tigerest/Tigerest-Theater/releases/tag/v2.6.0'});TigerestUpdate.open();`);
 await evaluate(`emit({status:'unpublished',projectVersion:'2.6.0',message:'尚未发布 iPad 正式版。'});`);
 assert.ok(await evaluate('document.querySelector("#tigerest-update-dialog").textContent.includes("尚未发布 iPad 正式版")'));
 assert.equal(await evaluate('!!document.querySelector("[data-update-action=download]")'),false);
 await evaluate(`emit({status:'available',version:'2.7.0',message:'当前开发签名版请通过 Xcode 更新。',notes:'<img src=x onerror=alert(1)>',releaseUrl:'https://github.com/Tigerest/Tigerest-Theater/releases/tag/v2.7.0'});`);
 assert.equal(await evaluate('document.querySelector("[data-update-dot]").hidden'),false);
 assert.equal(await evaluate('!!document.querySelector("[data-update-action=download],[data-update-action=install]")'),false);
 assert.equal(await evaluate('!!document.querySelector("#tigerest-update-dialog pre img")'),false);
 await evaluate('document.querySelector("[data-update-action=release]").click();');
 assert.ok((await evaluate('calls')).some(x=>x[0]==='openExternalUrl'&&x[1].endsWith('/v2.7.0')));
 await evaluate('document.querySelector("[data-update-action=skip]").click();');
 assert.equal(await evaluate('document.querySelector("[data-update-dot]").hidden'),true);
 await evaluate('TigerestUpdate.check()');
 await evaluate(`emit({status:'error',version:'',error:'网络不可用'});`);
 assert.ok(await evaluate('document.querySelector("[data-update-action=check]")!==null'));
 assert.ok(!(await evaluate('calls')).some(x=>['downloadAppUpdate','installAppUpdate'].includes(x[0])));
 console.log('iPad update UI: honest platform status, release notes, skip, red dot, retry, no installer passed');
},{visible:true}).catch(e=>{console.error(e);process.exitCode=1});
