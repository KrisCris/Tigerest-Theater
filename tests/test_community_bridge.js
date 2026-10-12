const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function load(system){const c={setTimeout,clearTimeout,AbortController,crypto:require('node:crypto').webcrypto};c.window=c;c.api={system};const file=__dirname+'/../native/communityBridge.js';if(fs.existsSync(file))vm.runInNewContext(fs.readFileSync(file,'utf8'),c);assert.equal(typeof c.TigerestCommunityBridge,'function');return new c.TigerestCommunityBridge(system);}
test('native transport routes responses by id and abort cancels only its request',async()=>{let listener,request,cancelled;const bridge=load({communityResponse:{connect:f=>listener=f},communityRequest:(id,options)=>request=[id,options],communityCancel:id=>cancelled=id});const c=new AbortController();const pending=bridge.transport('/me',{method:'GET',headers:{Authorization:'Bearer test'},signal:c.signal});assert.equal(request[1].path,'/me');c.abort();await assert.rejects(pending,e=>e.name==='AbortError');assert.equal(cancelled,request[0]);listener(request[0],{status:200,body:'{}'});});
test('secure storage adapter handles Qt callbacks and Android promises',async()=>{for(const promise of [false,true]){const bridge=load({communityResponse:{connect(){}},communityCredential:(op,key,value,cb)=>{const result={ok:true,value:op==='read'?'stored':null};if(promise)return Promise.resolve(result);cb(result);}});assert.equal(await bridge.store.read('key'),'stored');assert.equal(await bridge.store.write('key','value'),true);assert.equal(await bridge.store.remove('key'),true);}});
test('image transport preserves the binary response type and base64 payload',async()=>{
 let listener,request;const bridge=load({communityResponse:{connect:f=>listener=f},communityRequest:(id,r)=>request=[id,r],communityCancel(){}});
 const pending=bridge.transport('/avatars/2c9b6e0e-4af8-4fd6-bc92-144604e59389?v='+'a'.repeat(64),{responseType:'image',headers:{Authorization:'Bearer fixture'}});
 listener(request[0],{status:200,headers:{'content-type':'image/png'},bodyBase64:'iVBORw=='});
 const result=await pending;assert.equal(request[1].responseType,'image');assert.equal(result.bodyBase64,'iVBORw==');
});
test('source avatar snapshots separate confirmed absence from failures and ignore cancelled late replies',async()=>{
 let listener,request,cancelled;const bridge=load({communityResponse:{connect:f=>listener=f},communitySourceAvatar:(id,r)=>request=[id,r],communityCancel:id=>cancelled=id});
 const emby={address:'http://127.0.0.1:8080/emby',userId:'fixture-user',token:'fixture-token'};
 for(const [native,expected] of [[{status:200,body:{hash:'a'.repeat(64),imageBase64:'iVBORw=='}},'a'.repeat(64)],[{status:200,body:{hash:null,imageBase64:null}},null],[{status:0,error:'SOURCE_UNAVAILABLE'},undefined],[{status:404,body:'{}'},undefined]]){
  const pending=bridge.sourceAvatar(emby);assert.equal(request[1].address,emby.address);listener(request[0],native);const result=await pending;assert.equal(result?.hash,expected);if(result)assert.equal(Object.isFrozen(result),true);
 }
 const controller=new AbortController(),pending=bridge.sourceAvatar(emby,{signal:controller.signal});controller.abort();await assert.rejects(pending,e=>e.name==='AbortError');assert.equal(cancelled,request[0]);listener(request[0],{status:200,body:{hash:null,imageBase64:null}});assert.equal(bridge.pending.size,0);
});
