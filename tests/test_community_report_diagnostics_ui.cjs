const assert=require('node:assert/strict'),path=require('node:path');
const android=process.argv.includes('--android')||Boolean(process.env.TIGEREST_ANDROID_FIXTURE);
const withBrowser=require(android?'../android/tests/android_browser.cjs':'./community_browser.cjs');
const root=path.resolve(__dirname,'..');
// Load the shared sources explicitly, including when the fixture host is native.
withBrowser({
 '/':{type:'text/html',body:'<!doctype html><meta charset="utf-8"><body><div class="headerRight"></div><script src="/client.js"></script><script src="/messages.js"></script>'},
 '/client.js':{path:path.join(root,'native/communityClient.js')},'/messages.js':{path:path.join(root,'native/communityMessages.js')}
},async({evaluate})=>{
 const result=await evaluate('('+ (async function(){
  const check=(v,m)=>{if(!v)throw Error(m);};
  const wait=async fn=>{const deadline=performance.now()+8000;while(performance.now()<deadline){if(fn())return;await new Promise(r=>setTimeout(r,10));}throw Error('condition timeout: '+fn.toString()+'; status='+document.querySelector('#tigerest-report-form .tm-status')?.textContent);};
  const click=(label,scope=document)=>{const b=[...scope.querySelectorAll('button')].find(b=>b.textContent===label);check(b,'button '+label);b.click();};
  await wait(()=>window.TigerestCommunityClient&&window.TigerestCommunityMessages);
  const calls=[],scopes=[];let token='fixture-private-token',captureCount=0,snapshotMode='both',reportFailure=0,attachmentStatus=503,holdUpload=false,releaseUpload,holdCapture=false,releaseCapture,scopeFailure=false,scopeVoid=false;
  const snapshot={capturedAt:'2026-10-09T01:02:03.123Z',truncated:true,logText:'private fixture content is never rendered [redacted]'};
  const collector={isWindows:true,setReportDiagnosticsScope(key,callback){scopes.push(key);if(scopeFailure)throw Error('private fixture scope failure');if(scopeVoid){setTimeout(()=>callback?.(null),1);return undefined;}callback?.(true);return Promise.resolve(true);},collectReportDiagnostics(callback){
   captureCount++;const value=snapshotMode==='empty'?{capturedAt:snapshot.capturedAt,truncated:false,logText:''}:snapshotMode==='invalid'?{...snapshot,logText:'bad\u0000log'}:{...snapshot};
   if(holdCapture)return new Promise(r=>{releaseCapture=()=>{callback?.(value);r(value);};});
   if(snapshotMode==='callback'){setTimeout(()=>callback(value),1);return undefined;}
   if(snapshotMode==='promise')return Promise.resolve(value);
   callback?.(value);return Promise.resolve({...value,logText:'duplicate bridge delivery must be ignored'});
  }};
  window.api={system:collector};window.tigerestAndroidApi=undefined;
  const response=(data,status=200,headers={})=>new Response(JSON.stringify(status<400?{data}:{error:{code:status===409?'DIAGNOSTICS_ALREADY_EXISTS':status===401?'AUTH_INVALID':status===429?'RATE_LIMITED':'DIAGNOSTICS_STORAGE_UNAVAILABLE',message:'private fixture raw backend error'}}),{status,headers});
  window.fetch=async(url,options)=>{
   const p=new URL(url).pathname.replace('/community/v1','');const call={p,method:options.method,body:options.body,signal:options.signal};calls.push(call);
   if(p==='/me/messages')return response({items:[],unreadCount:0,nextCursor:null});
   if(p==='/reports'){if(reportFailure-- >0)throw Error('private fixture network detail');return response({report:{id:'saved-report'},replayed:false});}
   if(p==='/reports/saved-report/diagnostics'){
    if(holdUpload)await new Promise(r=>releaseUpload=r);
    return response({diagnostics:{id:'saved-diagnostics'},replayed:false},attachmentStatus,{'Retry-After':'8'});
   }
   throw Error('unexpected fixture endpoint');
  };
  const api={serverId:()=> '62526c3bf747439c99327ddec5fed4a8',getCurrentUserId:()=> 'fixture-user',accessToken:()=>token,serverAddress:()=> 'http://192.168.5.150:8096'};
  const messages=new TigerestCommunityMessages({connectionManager:{currentApiClient:()=>api}});messages.sync();
  let now=1000;messages.client.now=()=>now;
  const count=path=>calls.filter(c=>c.p===path).length;
  const open=(item={Id:'episode',Name:'Fixture episode'})=>{now+=10000;messages.reportProblem(item);const form=document.getElementById('tigerest-report-form');form.querySelector('textarea').value='播放出现黑屏且没有声音，请检查此处。';return form;};
  const close=form=>click('关闭',form),submit=form=>click('提交报错',form);
  const privateUI=form=>check(!form.textContent.includes('private fixture')&&!form.textContent.includes('fixture-private-token'),'logs and backend details never reach dialog');
  let form=open();const include=form.querySelector('[aria-label="附带诊断日志"]');check(include?.checked,'diagnostics default on');
  check(scopes.some(k=>k&&!k.includes('fixture')),'account scope is initialized as opaque identity before capture');
  reportFailure=1;submit(form);await wait(()=>form.textContent.includes('网络连接失败')&&!messages.reportForm.busy);
  check(captureCount===1,'report attempt captures once');check(include.disabled&&form.querySelector('textarea').disabled,'failed attempt keeps immutable captured fields');
  submit(form);await wait(()=>form.textContent.includes('报错已提交')&&form.textContent.includes('日志附件')&&!messages.reportForm.busy);
  check(count('/reports')===2&&count('/reports/saved-report/diagnostics')===1,'POST retries then single attachment PUT');
  const posts=calls.filter(c=>c.p==='/reports');check(posts[0].body===posts[1].body,'report retry preserves request');
  check(captureCount===1,'POST retry does not recapture');privateUI(form);
  const firstAttachment=calls.find(c=>c.p.endsWith('/diagnostics')).body;
  check(JSON.parse(firstAttachment).logText===snapshot.logText,'callback/Promise double delivery is handled once');
  snapshot.logText='later capture contents';attachmentStatus=200;click('重试日志附件',form);
  await wait(()=>form.textContent.includes('日志已附带'));
  check(count('/reports')===2&&count('/reports/saved-report/diagnostics')===2,'attachment retry never sends report');
  check(calls.filter(c=>c.p.endsWith('/diagnostics')).every(c=>c.body===firstAttachment),'attachment retry preserves UUID and snapshot');
  check(captureCount===1,'attachment retry never recaptures');privateUI(form);const scope=scopes.filter(Boolean).at(-1);close(form);
  check(scopes.filter(Boolean).at(-1)===scope&&!scopes.slice(-1).includes(''),'closing report preserves account collection boundary');

  const beforeOpt=count('/reports/saved-report/diagnostics'),beforeCapture=captureCount;
  form=open();form.querySelector('[aria-label="附带诊断日志"]').checked=false;submit(form);await wait(()=>form.textContent.includes('报错已提交'));
  check(captureCount===beforeCapture&&count('/reports/saved-report/diagnostics')===beforeOpt,'opt-out skips capture and PUT');close(form);
  for(const mode of ['empty','invalid']){snapshotMode=mode;form=open();submit(form);await wait(()=>form.textContent.includes('报错已提交'));check(count('/reports/saved-report/diagnostics')===beforeOpt,'unavailable/invalid logs allow plain report');privateUI(form);close(form);}
  scopeFailure=true;token='scope-failure-account';messages.sync();const beforeScopeCapture=captureCount;
  form=open();submit(form);await wait(()=>form.textContent.includes('报错已提交'));
  check(captureCount===beforeScopeCapture&&count('/reports/saved-report/diagnostics')===beforeOpt,'failed account boundary setup never collects previous account logs');close(form);
  scopeFailure=false;token='scope-restored-account';messages.sync();
  scopeVoid=true;token='qt-void-scope-account';messages.sync();snapshotMode='callback';attachmentStatus=200;
  form=open();submit(form);await wait(()=>form.textContent.includes('报错已提交')&&!messages.reportForm.busy);
  check(form.textContent.includes('日志已附带'),'successful Qt void/null setter callback establishes account boundary');close(form);scopeVoid=false;
  snapshotMode='callback';attachmentStatus=429;form=open();submit(form);await wait(()=>form.textContent.includes('8 秒'));
  const before429=count('/reports/saved-report/diagnostics'),retryButton=[...form.querySelectorAll('button')].find(b=>b.textContent==='重试日志附件');
  check(retryButton?.disabled,'Retry-After disables attachment retry');
  retryButton.click();await new Promise(r=>setTimeout(r,20));check(count('/reports/saved-report/diagnostics')===before429,'cooldown blocks eager retry');
  now+=8000;await wait(()=>!retryButton.disabled);attachmentStatus=200;retryButton.click();await wait(()=>form.textContent.includes('日志已附带'));close(form);

  for(const status of [409,401]){
   snapshotMode='promise';attachmentStatus=status;form=open();submit(form);
   if(status===401){await wait(()=>!document.getElementById('tigerest-report-form'));check(!messages.client.context,'401 clears account and snapshot');token='replacement-fixture-token';messages.sync();}
   else{await wait(()=>form.textContent.includes('报错已提交')&&!messages.reportForm.busy);check(![...form.querySelectorAll('button')].some(b=>b.textContent==='重试日志附件'&&!b.hidden),'conflict cannot replace or automatically retry');privateUI(form);close(form);}
  }
  attachmentStatus=200;holdCapture=true;releaseCapture=null;const target={Id:'original-item',Name:'Original item'};form=open(target);submit(form);await wait(()=>releaseCapture);
  target.Id='replacement-item';form.querySelector('textarea').value='late changed report text';form.querySelector('select').value='other';releaseCapture();
  await wait(()=>form.textContent.includes('日志已附带'));const frozenReport=JSON.parse(calls.filter(c=>c.p==='/reports').at(-1).body);
  check(frozenReport.itemId==='original-item'&&frozenReport.description==='播放出现黑屏且没有声音，请检查此处。'&&frozenReport.category==='playback_error','target and description are frozen before asynchronous capture');close(form);
  holdCapture=true;releaseCapture=null;form=open();submit(form);await wait(()=>releaseCapture);const beforeCancel=count('/reports');close(form);releaseCapture();await new Promise(r=>setTimeout(r,30));check(count('/reports')===beforeCancel,'closing while capture is pending discards snapshot and prevents POST');holdCapture=false;
  holdUpload=true;form=open();submit(form);await wait(()=>releaseUpload);const upload=calls.at(-1);close(form);check(upload.signal.aborted,'closing report aborts its upload');releaseUpload();await new Promise(r=>setTimeout(r,30));check(!document.getElementById('tigerest-report-form'),'late upload does not reopen or write old dialog');holdUpload=false;releaseUpload=null;
  holdCapture=true;releaseCapture=null;form=open();submit(form);await wait(()=>releaseCapture);token='new-account';messages.sync();releaseCapture();await new Promise(r=>setTimeout(r,30));check(!document.getElementById('tigerest-report-form'),'account change clears pending report');
  check(scopes.some(k=>k==='')&&scopes.filter(Boolean).at(-1)!==scope,'account change clears native scope and establishes a new boundary');messages.destroy();
  return {passed:true,defaultInclude:true,optOut:true,unavailable:true,immutableRetry:true,partialSuccess:true,independentCooldown:true,conflict:true,authenticationReset:true,cancelCapture:true,cancelUpload:true,accountChange:true};
 }).toString()+')()');
 assert.equal(result.passed,true);console.log(JSON.stringify(result));
}).catch(error=>{console.error(error);process.exitCode=1;});
