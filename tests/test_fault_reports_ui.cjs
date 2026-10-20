// Automatic fault reports: native stalls and startup timeouts become private
// reports without user interaction. Fixture endpoints only; no Emby account.
const assert=require('node:assert/strict'),path=require('node:path');
const withBrowser=require('./community_browser.cjs');
const root=path.resolve(__dirname,'..');
const setup=`<script>
 window.fixture={calls:[],captures:0,listeners:[],token:null};
 const startedAt=new Date(Date.now()-60000).toISOString();
 localStorage.setItem('tigerest-fault-playback',JSON.stringify({itemId:'previous-episode',serverId:'s',mediaSourceId:'previous-source',at:Date.now()-70000}));
 window.jmpInfo={version:'2.9.3',settings:{main:{}}};
 // The app's own bridge must not replace the fixture bridge mid-test.
 Object.defineProperty(window,'api',{configurable:true,get:()=>fixture.api,set:()=>{}});
 fixture.api={system:{isWindows:true,
  mainThreadStallRecovered:{connect(fn){fixture.listeners.push(fn);}},
  takeUnfinishedFault(callback){const fault={kind:'main-thread-stall',unrecovered:true,appVersion:'2.9.2',startedAt,durationMs:31000,
   stacks:['Stall stack tid=10 [main] frames=2\\n  #00 ntdll.dll+0x1\\n  #01 Tigerest Theater.exe+0x2','Stall stack tid=11 "core" frames=1\\n  #00 libmpv-2.dll+0x3']};
   callback?.(fault);return Promise.resolve(fault);},
  setReportDiagnosticsScope(key,callback){callback?.(true);return Promise.resolve(true);},
  collectReportDiagnostics(callback){fixture.captures++;const value={capturedAt:new Date().toISOString(),truncated:false,logText:'Main thread unresponsive for 5000 ms\\nStall stack tid=10 [main] frames=1\\n  #00 ntdll.dll+0x1'};callback?.(value);return Promise.resolve(value);}}};
 window.fetch=async(url,options)=>{
  const p=new URL(url).pathname.replace('/community/v1','');fixture.calls.push({p,method:options.method,body:options.body&&JSON.parse(options.body)});
  const ok=data=>new Response(JSON.stringify({data}),{status:200});
  if(p==='/me/messages')return ok({items:[],unreadCount:0,nextCursor:null});
  if(p==='/reports')return ok({report:{id:'report-'+fixture.calls.filter(c=>c.p==='/reports').length},replayed:false});
  if(/^\\/reports\\/report-\\d+\\/diagnostics$/.test(p))return ok({diagnostics:{id:'d'},replayed:false});
  throw Error('unexpected fixture endpoint '+p);
 };
</script>`;
withBrowser({
 '/':{type:'text/html',body:'<!doctype html><meta charset="utf-8"><body><div class="headerRight"></div>'+setup+
  '<script src="/client.js"></script><script src="/messages.js"></script><script src="/faults.js"></script>'},
 '/client.js':{path:path.join(root,'native/communityClient.js')},'/messages.js':{path:path.join(root,'native/communityMessages.js')},
 '/faults.js':{path:path.join(root,'native/faultReports.js')}
},async({evaluate})=>{
 const result=await evaluate('('+(async function(){
  const check=(v,m)=>{if(!v)throw Error(m);};
  const wait=async(fn,ms=12000)=>{const deadline=performance.now()+ms;while(performance.now()<deadline){if(fn())return;await new Promise(r=>setTimeout(r,20));}throw Error('condition timeout: '+fn.toString()+' calls='+JSON.stringify(fixture.calls.map(c=>c.p)));};
  await wait(()=>window.TigerestFaultReports&&window.TigerestCommunityMessages);
  const reports=()=>fixture.calls.filter(c=>c.p==='/reports');
  const attachments=()=>fixture.calls.filter(c=>c.p.endsWith('/diagnostics'));
  const api={serverId:()=> '62526c3bf747439c99327ddec5fed4a8',getCurrentUserId:()=> 'fixture-user',accessToken:()=>fixture.token,serverAddress:()=> 'http://192.168.5.150:8096'};
  const messages=new TigerestCommunityMessages({connectionManager:{currentApiClient:()=>api}});
  window.TigerestFaultReports.attach(messages);
  // No account session yet: the previous-run fault waits instead of being dropped.
  await new Promise(r=>setTimeout(r,300));
  check(reports().length===0,'no report without a private session');
  fixture.token='fixture-private-token';messages.sync();
  await wait(()=>attachments().length===1);
  const previous=reports()[0].body;
  check(previous.itemId==='previous-episode'&&previous.category==='playback_error','previous-run stall is tied to the last playback');
  check(previous.description.startsWith('自动故障报告：')&&previous.description.includes('31.0 秒')&&previous.description.includes('2.9.2'),'description marks automatic report: '+previous.description);
  check(previous.context.mediaSourceId==='previous-source'&&previous.context.platform==='Windows'&&previous.context.clientVersion==='2.9.3','report context');
  const previousLog=attachments()[0].body;
  check(previousLog.logText.includes('Stall stack tid=10 [main]')&&previousLog.logText.includes('libmpv-2.dll+0x3'),'saved stacks are the attachment');
  check(fixture.captures===0,'the earlier process log is never imported');

  // A stall that recovered in this session attaches the current diagnostics log.
  window.TigerestFaultReports.setPlayback({itemId:'current-episode',serverId:'s',mediaSourceId:'current-source'});
  for(const listener of fixture.listeners)listener({kind:'main-thread-stall',durationMs:29300,startedAt:new Date().toISOString(),samples:4});
  await wait(()=>attachments().length===2);
  const stall=reports()[1].body;
  check(stall.itemId==='current-episode'&&stall.description.includes('29.3 秒')&&stall.description.includes('恢复'),'recovered stall: '+stall.description);
  check(fixture.captures===1&&attachments()[1].body.logText.includes('Main thread unresponsive'),'recovered stall uploads the session log');

  // Startup timeouts are reported too, with how long the native side was silent.
  window.TigerestFaultReports.record({kind:'startup-timeout',message:'播放器启动超时（30 秒）',nativeDelayMs:4200,elapsedMs:30000});
  await wait(()=>reports().length===3);
  check(reports()[2].body.description.includes('播放器启动超时')&&reports()[2].body.description.includes('4.2 秒'),'startup timeout: '+reports()[2].body.description);

  // At most three automatic reports per launch.
  window.TigerestFaultReports.record({kind:'startup-timeout',message:'播放器启动超时（30 秒）',elapsedMs:30000,startedAt:'later'});
  await new Promise(r=>setTimeout(r,600));
  check(reports().length===3,'per-launch cap');
  // The manual report form state was never touched.
  check(!messages.reportForm&&!messages.client.pendingReport,'manual report state untouched');
  window.jmpInfo={...window.jmpInfo,settings:{main:{autoFaultReports:false}}};check(!window.TigerestFaultReports.enabled(),'setting turns automatic reports off');
  return {passed:true,reports:reports().length,attachments:attachments().length};
 }).toString()+')()');
 assert.equal(result.passed,true);console.log(JSON.stringify(result));
}).catch(error=>{console.error(error);process.exitCode=1;});
