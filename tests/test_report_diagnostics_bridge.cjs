// Real native collectors in isolated profiles; no Emby account or API writes.
const assert=require('node:assert/strict');
const android=process.argv.includes('--android')||Boolean(process.env.TIGEREST_ANDROID_FIXTURE);
const withBrowser=require(android?'../android/tests/android_browser.cjs':'./community_browser.cjs');
withBrowser({'/':{type:'text/html',body:'<!doctype html><meta charset="utf-8"><body>Native diagnostics bridge fixture</body>'}},async({evaluate})=>{
 const result=await evaluate('('+ (async function(){
  const wait=async fn=>{for(let i=0;i<200;i++){if(fn())return;await new Promise(r=>setTimeout(r,20));}throw Error('native bridge unavailable');};
  await wait(()=>window.api?.system||window.tigerestAndroidApi?.system);
  const api=window.tigerestAndroidApi||window.api,system=api.system;
  const call=(owner,name,...args)=>new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>reject(Error('native '+name+' timed out')),5000);
   const finish=value=>{clearTimeout(timer);resolve(value);};
   try{const result=owner[name](...args,finish);if(result?.then)result.then(finish,error=>{clearTimeout(timer);reject(error);});}
   catch(error){clearTimeout(timer);reject(error);}
  });
  const check=(v,m)=>{if(!v)throw Error(m);};
  check(await call(system,'setReportDiagnosticsScope','fixture-old-scope')===true,'real setter must acknowledge account boundary');
  if(system.isAndroid){
   // A rejected app operation records a safe structural error without using ADB.
   try{await api.settings.setValue('fixture-invalid-section','invalid-key','synthetic-private-value');}catch(_){}
  }else await call(system,'jsLog',1,'FIXTURE_OLD_ACCOUNT');
  check(await call(system,'setReportDiagnosticsScope','fixture-current-scope')===true,'real scope switch');
  if(system.isAndroid){
   try{await api.settings.setValue('fixture-invalid-section','invalid-key','synthetic-private-value');}catch(_){}
  }else{
   await call(system,'jsLog',1,'FIXTURE_CURRENT_ACCOUNT playback HTTP status 503; subtitle stream 0');
   await call(system,'jsLog',1,'Authorization: Bearer SYNTHETIC_PRIVATE_SECRET');
  }
  const snapshot=await call(system,'collectReportDiagnostics');
  check(snapshot&&typeof snapshot.logText==='string'&&snapshot.logText.length>0,'real native collector must return text');
  check(/Z$/.test(snapshot.capturedAt)&&typeof snapshot.truncated==='boolean','native contract fields');
  check(!snapshot.logText.includes('FIXTURE_OLD_ACCOUNT')&&!snapshot.logText.includes('SYNTHETIC_PRIVATE_SECRET')&&!snapshot.logText.includes('synthetic-private-value'),'native account and secret isolation');
  check(snapshot.logText.includes(system.isAndroid?'Bridge operation failed':'FIXTURE_CURRENT_ACCOUNT'),'native structural clue retained');
  check(await call(system,'setReportDiagnosticsScope','')===true,'clear native scope');
  const cleared=await call(system,'collectReportDiagnostics');check(!cleared.logText,'cleared collector has no retained account snapshot');
  return {passed:true,nativePlatform:system.isAndroid?'Android':'desktop',realCollector:true,accountIsolation:true,redaction:true,bytes:new TextEncoder().encode(snapshot.logText).length};
 }).toString()+')()');
 assert.equal(result.passed,true);console.log(JSON.stringify(result));
}).catch(error=>{console.error(error);process.exitCode=1;});
