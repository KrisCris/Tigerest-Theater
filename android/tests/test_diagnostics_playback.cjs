// Real MPV error delivery into the app-owned collector, with an isolated 404.
const assert=require('node:assert/strict');
require('./android_browser.cjs')({'/':{type:'text/html',body:'<!doctype html><body>Diagnostics playback fixture</body>'}},async({url,evaluate})=>{
 const result=await evaluate('('+ (async function(origin){
  await api.system.setReportDiagnosticsScope('fixture-mpv-diagnostics');
  const previous=await api.settings.value('mpv','enableDanmaku');
  try{
   await api.settings.setValue('mpv','enableDanmaku',false);
   await api.player.load(origin+'/__missing__.mp4?opaque=SYNTHETIC_PRIVATE_PLAYBACK_URL',{autoplay:true},{type:'video',metadata:{}},1,-1);
   let snapshot;
   for(let i=0;i<100;i++){
    snapshot=await api.system.collectReportDiagnostics();
    if(/mpv [^\n]*:/.test(snapshot.logText||'')&&/404/.test(snapshot.logText))break;
    await new Promise(r=>setTimeout(r,100));
   }
   if(!/mpv [^\n]*:/.test(snapshot.logText||'')||!/404/.test(snapshot.logText))throw Error('real MPV 404 callback missing');
   if(snapshot.logText.includes('SYNTHETIC_PRIVATE_PLAYBACK_URL'))throw Error('private playback URL reached snapshot');
   return {passed:true,realMpvLogCallback:true,http404:true,privateUrlRemoved:true,bytes:new TextEncoder().encode(snapshot.logText).length};
  }finally{
   await api.player.stop();await api.settings.setValue('mpv','enableDanmaku',previous);await api.system.setReportDiagnosticsScope('');
  }
 }).toString()+')('+JSON.stringify(url)+')');
 assert.equal(result.passed,true);console.log(JSON.stringify(result));
}).catch(error=>{console.error(error);process.exitCode=1;});
