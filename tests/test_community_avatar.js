const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const emby={serverId:'external',userId:'self',token:'OWN-EMBY-TOKEN',address:'http://own.example:8096'};
const oldCaps={enabled:true,auth:['password','emby-exchange'],registrationEnabled:true,mediaIdentity:'tmdb-aired',embyExchangeServerId:'62526c3bf747439c99327ddec5fed4a8'};
const caps={...oldCaps,passwordPolicy:{minLength:8,maxLength:128,lengthUnit:'unicode-code-point',allowControlCharacters:false},avatarPolicy:{sync:'sha256-on-comment',mimeType:'image/png',maxBytes:262144,maxWidth:128,maxHeight:128,uploadBodyMaxBytes:393216}};
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLttAAAAABJRU5ErkJggg==';
const snapshot={hash:require('node:crypto').createHash('sha256').update(Buffer.from(png,'base64')).digest('hex'),imageBase64:png};
const author={id:'11111111-1111-4111-8111-111111111111',name:'Self'};
const avatarPath='/community/v2/avatars/'+author.id+'?v='+snapshot.hash;
const token=()=>({tokenType:'Bearer',accessToken:'fixture-access',refreshToken:'fixture-refresh',expiresAt:'2099-01-01T00:00:00Z',refreshExpiresAt:'2099-02-01T00:00:00Z',author});
const response=(data,status=200,headers={})=>({status,headers,body:JSON.stringify(status<400?{data}:{error:{code:data}})});
function setup({capabilities=caps,handle,source=async()=>snapshot}={}){
 const c={URL,URLSearchParams,AbortController,Blob,atob,setTimeout,clearTimeout,crypto:require('node:crypto').webcrypto,fetch};c.window=c;
 for(const file of ['communityClient','communitySession','communityAvatar','communityPublicClient']){
  const p=path.join(__dirname,'../native/'+file+'.js');if(fs.existsSync(p))vm.runInNewContext(fs.readFileSync(p,'utf8'),c);
 }
 const calls=[],saved=new Map();
 const session=new c.TigerestCommunitySession({transport:async(p,o)=>{calls.push([p,o]);
  if(p==='/capabilities')return response(capabilities);
  if(p.startsWith('/auth/'))return response(token());
  return await handle?.(p,o)||response({author});
 },store:{read:async()=>null,write:async(k,v)=>{saved.set(k,v);return true;},remove:async k=>{saved.delete(k);return true;}}});
 session.setSession(emby);
 const coordinator=c.TigerestCommunityAvatar?new c.TigerestCommunityAvatar({session,sourceAvatar:source}):null;
 const client=new c.TigerestCommunityPublicClient(session,coordinator);client.setContext(emby,'movie');
 return {c,session,client,coordinator,calls,saved};
}
const settle=async h=>{await h.coordinator?.flight;await new Promise(r=>setTimeout(r,0));};
test('new policy accepts eight Unicode codepoints without trimming, rejects seven and control characters',async()=>{
 const h=setup();await h.session.discover();
 for(const password of ['a'.repeat(7),'🔑'.repeat(7),'abcd\nefgh','abcd\u007fefgh'])await assert.rejects(h.session.register('tester','Self',password),/密码|控制字符/);
 const password=' 🔑中文 ab ';assert.equal(Array.from(password).length,8);
 await h.session.register('tester','Self',password);assert.equal(JSON.parse(h.calls.find(x=>x[0]==='/auth/register')[1].body).password,password);
 await h.session.changePassword('old',password);assert.equal(JSON.parse(h.calls.find(x=>x[0]==='/me/password')[1].body).newPassword,password);assert.equal(h.session.tokens,null);
});
test('old capabilities keep 12-character policy, login accepts an existing shorter password',async()=>{
 const h=setup({capabilities:oldCaps});await h.session.discover();await assert.rejects(h.session.register('tester','Self','12345678'),/12–128/);
 await h.session.login('tester','old');assert.equal(JSON.parse(h.calls.find(x=>x[0]==='/auth/login')[1].body).password,'old');
});
test('central image is a Blob fetched with Bearer, image 404 remains an ordinary API error',async()=>{
 let status=200;const h=setup({handle:(p)=>p.startsWith('/avatars/')?(status===200?{status,headers:{'content-type':'image/png'},bodyBase64:png}:response('NOT_FOUND',404)):undefined});
 await h.session.login('tester','password');const blob=await h.client.avatar(avatarPath);assert.equal(blob.type,'image/png');assert.deepEqual(Buffer.from(await blob.arrayBuffer()),Buffer.from(png,'base64'));
 const call=h.calls.at(-1);assert.equal(call[1].headers.Authorization,'Bearer fixture-access');assert.equal(call[1].responseType,'image');assert.ok(!call[0].includes('fixture-access'));
 status=404;await assert.rejects(h.client.avatar(avatarPath),e=>e.status===404);
 await assert.rejects(h.client.avatar('http://own.example/avatar'),/头像/);
});
test('first comment succeeds independently of upload; explicit retry sends only identical avatar bytes and revision',async()=>{
 let uploads=0;const h=setup({handle:(p,o)=>p.includes('/topics/')?response({comment:{id:'posted'},avatarSync:{required:true,expectedRevision:4}}):p==='/me/avatar'?(++uploads===1?response('NETWORK_UNAVAILABLE',503):response({avatarPath,avatarHash:snapshot.hash,revision:5})):undefined});
 await h.session.login('tester','password');const result=await h.client.send('topic','hello');assert.equal(result.comment.id,'posted');assert.equal(h.client.pendingSend,null);await settle(h);
 assert.ok(h.coordinator.status.retryable);await h.coordinator.retry();
 const posted=h.calls.filter(x=>x[0].includes('/topics/'));assert.equal(posted.length,1);assert.equal(JSON.parse(posted[0][1].body).avatarHash,snapshot.hash);
 const put=h.calls.filter(x=>x[0]==='/me/avatar');assert.equal(put.length,2);assert.equal(put[0][1].body,put[1][1].body);assert.deepEqual(JSON.parse(put[1][1].body),{expectedRevision:4,...snapshot});
 assert.ok(!JSON.stringify(h.calls).includes('OWN-EMBY-TOKEN'));
});
test('same hash skips upload, each new send rechecks source; unknown omits and definite absence clears',async()=>{
 let current=snapshot,checks=0,required=false;const h=setup({source:async()=>{checks++;return current;},handle:p=>p.includes('/topics/')?response({comment:{},avatarSync:{required,expectedRevision:0}}):undefined});
 await h.session.login('tester','password');await h.client.send('topic','one');await settle(h);assert.equal(h.calls.filter(x=>x[0]==='/me/avatar').length,0);
 current=undefined;h.client.cooldownUntil=0;await h.client.send('topic','two');assert.ok(!Object.hasOwn(JSON.parse(h.calls.filter(x=>x[0].includes('/topics/')).at(-1)[1].body),'avatarHash'));
 current={hash:null,imageBase64:null};required=true;h.client.cooldownUntil=0;await h.client.send('topic','three');await settle(h);assert.equal(checks,3);assert.deepEqual(JSON.parse(h.calls.find(x=>x[0]==='/me/avatar')[1].body),{expectedRevision:0,hash:null,imageBase64:null});
});
test('unknown comment outcome preserves request UUID and original avatar snapshot on retry after source changes',async()=>{
 let attempt=0,checks=0,current=snapshot;const h=setup({source:async()=>{checks++;return current;},handle:p=>{if(p.includes('/topics/')){if(++attempt===1)throw Error('lost');return response({comment:{},avatarSync:{required:true,expectedRevision:2}});}}});
 await h.session.login('tester','password');await assert.rejects(h.client.send('topic','hello'));current={hash:null,imageBase64:null};await h.client.send('topic','hello');await settle(h);
 const attempts=h.calls.filter(x=>x[0].includes('/topics/')).map(x=>JSON.parse(x[1].body));assert.equal(checks,2);assert.equal(attempts[0].clientRequestId,attempts[1].clientRequestId);assert.equal(attempts[1].avatarHash,snapshot.hash);assert.equal(JSON.parse(h.calls.find(x=>x[0]==='/me/avatar')[1].body).imageBase64,png);
});
test('old service and trusted Emby never download source or attach avatarHash',async()=>{
 for(const trusted of [false,true]){let checks=0;const h=setup({capabilities:trusted?caps:oldCaps,source:async()=>{checks++;return snapshot;},handle:()=>response({comment:{},avatarSync:{required:true,expectedRevision:0}})});
  if(trusted)h.client.setContext({...emby,serverId:oldCaps.embyExchangeServerId},'movie');else await h.session.login('tester','password');
  await h.client.send('topic','hello');await settle(h);assert.equal(checks,0);assert.ok(!Object.hasOwn(JSON.parse(h.calls.find(x=>x[0].includes('/topics/'))[1].body),'avatarHash'));assert.equal(h.calls.filter(x=>x[0]==='/me/avatar').length,0);
 }
});
test('409 discards upload and refreshes own avatar without overwriting a newer revision',async()=>{
 const h=setup({handle:p=>p.includes('/topics/')?response({comment:{},avatarSync:{required:true,expectedRevision:2}}):p==='/me/avatar'?response('AVATAR_VERSION_CONFLICT',409):response({author:{...author,avatarPath},avatarRevision:9})});
 await h.session.login('tester','password');const events=[];h.coordinator?.subscribe(e=>events.push(e));await h.client.send('topic','hello');await settle(h);await h.coordinator.retry();
 assert.equal(h.calls.filter(x=>x[0]==='/me/avatar').length,1);assert.equal(h.calls.filter(x=>x[0]==='/me').length,1);assert.equal(events.find(e=>e.author)?.author.avatarPath,avatarPath);assert.equal(h.coordinator.status.retryable,false);
});
test('429 defers only avatar retry, leaves comment cooldown independent',async()=>{
 const h=setup({handle:p=>p.includes('/topics/')?response({comment:{},avatarSync:{required:true,expectedRevision:1}}):response('RATE_LIMITED',429,{'retry-after':'60'})});
 await h.session.login('tester','password');await h.client.send('topic','hello');await settle(h);await h.coordinator.retry();assert.equal(h.calls.filter(x=>x[0]==='/me/avatar').length,1);assert.ok(h.coordinator.status.retryAt>Date.now()+50000);assert.ok(h.client.cooldownUntil<Date.now()+5000);
});
test('late conflict profile refresh cannot replace a newer successful avatar upload',async()=>{
 let put=0,release;const newer='/community/v2/avatars/'+author.id+'?v='+'b'.repeat(64);
 const h=setup({handle:p=>p.includes('/topics/')?response({comment:{},avatarSync:{required:true,expectedRevision:put}}):p==='/me/avatar'?(++put===1?response('AVATAR_VERSION_CONFLICT',409):response({avatarPath:newer})):p==='/me'?new Promise(r=>release=r):undefined});
 await h.session.login('tester','password');const updates=[];h.coordinator.subscribe(e=>{if(e.author)updates.push(e.author.avatarPath);});
 await h.client.send('topic','one');await new Promise(r=>setTimeout(r,0));h.client.cooldownUntil=0;await h.client.send('topic','two');await settle(h);
 release(response({author:{...author,avatarPath}}));await new Promise(r=>setTimeout(r,0));assert.deepEqual(updates,[newer]);assert.equal(h.coordinator.author.avatarPath,newer);
});
test('switch during source read cannot send old avatar in a new account comment',async()=>{
 let release;const h=setup({source:()=>new Promise(r=>release=r)});await h.session.login('tester','password');const pending=h.client.send('topic','hello');await new Promise(r=>setTimeout(r,0));
 h.session.setSession({...emby,userId:'other'});h.coordinator?.clear();h.client.clear();release?.(snapshot);await assert.rejects(pending,e=>e.name==='AbortError');assert.equal(h.calls.filter(x=>x[0].includes('/topics/')).length,0);
});
test('switch during upload cancels task and ignores late author image',async()=>{
 let release,signal;const h=setup({handle:(p,o)=>p.includes('/topics/')?response({comment:{},avatarSync:{required:true,expectedRevision:1}}):p==='/me/avatar'?new Promise(r=>{release=r;signal=o.signal;}):undefined});
 await h.session.login('tester','password');const events=[];h.coordinator?.subscribe(e=>events.push(e));await h.client.send('topic','hello');await new Promise(r=>setTimeout(r,0));
 h.session.setSession({...emby,userId:'other'});h.coordinator?.clear();assert.equal(signal?.aborted,true);release?.(response({avatarPath}));await settle(h);assert.ok(!events.some(e=>e.author));assert.equal(h.coordinator.status.retryable,false);
});
test('repeated 401 revokes comment identity instead of retaining visible old-account content',async()=>{
 const h=setup({handle:()=>response('AUTH_INVALID',401)});await h.session.login('tester','password');const changes=[];h.session.onChange=()=>changes.push(h.session.tokens?.author.id||null);
 await assert.rejects(h.session.request('/me'),e=>e.status===401);assert.equal(h.session.tokens,null);assert.equal(changes.at(-1),null);assert.equal(h.saved.size,0);
});
test('trusted exchange rejection clears the prior comment identity and its saved credentials',async()=>{
 const h=setup({handle:()=>response('AUTH_INVALID',401)});h.session.setSession({...emby,serverId:oldCaps.embyExchangeServerId});
 await h.session.ready();const transport=h.session.transport;h.session.transport=(p,o)=>p==='/auth/emby'?Promise.resolve(response('AUTH_INVALID',401)):transport(p,o);
 const changes=[];h.session.onChange=()=>changes.push(h.session.tokens?.author.id||null);
 await assert.rejects(h.session.request('/me'),e=>e.status===401);assert.equal(h.session.tokens,null);assert.equal(changes.at(-1),null);assert.equal(h.saved.size,0);
});
test('direct trusted ready failure also revokes the old identity',async()=>{
 const h=setup();h.session.setSession({...emby,serverId:oldCaps.embyExchangeServerId});await h.session.ready();
 h.session.transport=async()=>response('AUTH_INVALID',401);
 const changes=[];h.session.onChange=()=>changes.push(h.session.tokens?.author.id||null);
 await assert.rejects(h.session.ready(true),e=>e.status===401);assert.equal(h.session.tokens,null);assert.equal(changes.at(-1),null);assert.equal(h.saved.size,0);
});
