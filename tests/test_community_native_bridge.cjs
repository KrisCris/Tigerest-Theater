const assert=require('node:assert/strict');
const withBrowser=require('./community_browser.cjs');
withBrowser({'/':{type:'text/html',body:'<!doctype html><meta charset="utf-8"><body>Community native bridge fixture</body>'}},async({evaluate})=>{
 const result=await evaluate('('+(async function(){
  for(let i=0;i<200&&!window.api?.system&&!window.tigerestAndroidApi?.system;i++)await new Promise(r=>setTimeout(r,20));
  const bridge=new TigerestCommunityBridge((window.tigerestAndroidApi||window.api).system);
  if(typeof TigerestCommunityAvatar!=='function'||typeof TigerestCommunityAvatarView!=='function'||typeof bridge.system.communitySourceAvatar!=='function')throw Error('bundled avatar module or native source bridge missing');
  const key='isolated-fixture-community-credentials';
  if(!await bridge.store.write(key,'synthetic-secret-only'))throw Error('secure store write failed');
  try{if(await bridge.store.read(key)!=='synthetic-secret-only')throw Error('secure store read failed');}
  finally{if(!await bridge.store.remove(key))throw Error('secure store cleanup failed');}
  if(await bridge.store.read(key)!==null)throw Error('credential still present');
  let blocked=false;try{await bridge.transport('//evil.invalid',{headers:{Authorization:'Bearer synthetic'}});}catch(_){blocked=true;}
  if(!blocked)throw Error('untrusted path accepted');
  let isolated=false;try{await bridge.transport('/me',{headers:{'X-Emby-Token':'synthetic-external'}});}catch(_){isolated=true;}
  if(!isolated)throw Error('private header accepted on public route');
  const registration=new TigerestCommunitySession({transport:path=>{if(path!=='/capabilities')throw Error('invalid registration submitted credentials');return Promise.resolve({status:200,body:JSON.stringify({data:{enabled:true,auth:['password'],registrationEnabled:true,mediaIdentity:'tmdb-aired'}})});},store:{}});
  let registrationMessage='';try{await registration.register('connlost','connlost','test-pass');}catch(error){registrationMessage=error.message;}
  if(!/密码.*12–128.*9/.test(registrationMessage))throw Error('bundled registration validation does not identify short password');
  return {secureStore:true,removed:true,originRestricted:true,privateHeadersBlocked:true,registrationValidation:true,avatarModule:true};
 }).toString()+')()');
 assert.equal(result.secureStore,true);console.log(JSON.stringify(result));
}).catch(e=>{console.error(e);process.exitCode=1;});
