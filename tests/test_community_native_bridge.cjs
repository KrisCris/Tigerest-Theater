const assert=require('node:assert/strict');
const withBrowser=require('./community_browser.cjs');
withBrowser({'/':{type:'text/html',body:'<!doctype html><meta charset="utf-8"><body>Community native bridge fixture</body>'}},async({evaluate})=>{
 const result=await evaluate('('+(async function(){
  for(let i=0;i<200&&!window.api?.system&&!window.tigerestAndroidApi?.system;i++)await new Promise(r=>setTimeout(r,20));
  const bridge=new TigerestCommunityBridge((window.tigerestAndroidApi||window.api).system);
  if(typeof TigerestCommunityAvatar!=='function'||typeof TigerestCommunityAvatarView!=='function'||typeof bridge.system.communitySourceAvatar!=='function')throw Error('bundled avatar module or native source bridge missing');
  const key='isolated-fixture-community-credentials';
  const secureStore=!!(bridge.system.isWindows||bridge.system.isMacos||bridge.system.isAndroid);
  if(secureStore){
   if(!await bridge.store.write(key,'synthetic-secret-only'))throw Error('secure store write failed');
   try{if(await bridge.store.read(key)!=='synthetic-secret-only')throw Error('secure store read failed');}
   finally{if(!await bridge.store.remove(key))throw Error('secure store cleanup failed');}
   if(await bridge.store.read(key)!==null)throw Error('credential still present');
  }else{
   // Linux/FreeBSD deliberately have no credential backend. Verify the shipped
   // memory-only contract rather than pretending an OS keychain is available.
   if(await bridge.store.write(key,'synthetic-secret-only'))throw Error('unsupported secure store accepted a credential');
   let unavailable=false;try{await bridge.store.read(key);}catch(_){unavailable=true;}
   if(!unavailable)throw Error('unavailable secure store must report read failure');
   if(await bridge.store.remove(key))throw Error('unsupported secure store reported successful removal');
   const session=new TigerestCommunitySession({transport:()=>{throw Error('memory-only check must remain local');},store:bridge.store});
   session.setSession({serverId:'fixture-external',userId:'fixture-user',token:'fixture-emby-token',address:'http://fixture.invalid'});
   await session.save({accessToken:'fixture-access',refreshToken:'fixture-refresh',tokenType:'Bearer',expiresAt:'2099-01-01T00:00:00Z',refreshExpiresAt:'2099-02-01T00:00:00Z',author:{id:'fixture-author',name:'Fixture'}},session.generation,'password');
   if(session.persisted||session.tokens?.accessToken!=='fixture-access')throw Error('unavailable storage must retain only the current in-memory session');
   session.setSession(null);if(session.tokens)throw Error('account change must clear the memory-only session');
  }
  let blocked=false;try{await bridge.transport('//evil.invalid',{headers:{Authorization:'Bearer synthetic'}});}catch(_){blocked=true;}
  if(!blocked)throw Error('untrusted path accepted');
  let isolated=false;try{await bridge.transport('/me',{headers:{'X-Emby-Token':'synthetic-external'}});}catch(_){isolated=true;}
  if(!isolated)throw Error('private header accepted on public route');
  const registration=new TigerestCommunitySession({transport:path=>{if(path!=='/capabilities')throw Error('invalid registration submitted credentials');return Promise.resolve({status:200,body:JSON.stringify({data:{enabled:true,auth:['password'],registrationEnabled:true,mediaIdentity:'tmdb-aired'}})});},store:{}});
  let registrationMessage='';try{await registration.register('connlost','connlost','test-pass');}catch(error){registrationMessage=error.message;}
  if(!/密码.*12–128.*9/.test(registrationMessage))throw Error('bundled registration validation does not identify short password');
  return {secureStore,memoryOnly:!secureStore,removed:secureStore,originRestricted:true,privateHeadersBlocked:true,registrationValidation:true,avatarModule:true};
 }).toString()+')()');
 const expectedSecureStore=['win32','darwin'].includes(process.platform)||Boolean(process.env.TIGEREST_ANDROID_FIXTURE);
 assert.equal(result.secureStore,expectedSecureStore);assert.equal(result.memoryOnly,!expectedSecureStore);console.log(JSON.stringify(result));
}).catch(e=>{console.error(e);process.exitCode=1;});
