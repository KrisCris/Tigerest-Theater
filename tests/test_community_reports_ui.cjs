const assert=require('node:assert/strict'),path=require('node:path');
const android=process.argv.includes('--android')||Boolean(process.env.TIGEREST_ANDROID_FIXTURE);
const withBrowser=require(android?'../android/tests/android_browser.cjs':'./community_browser.cjs');
const root=path.resolve(__dirname,'..'),embedded=android||process.argv.includes('--webengine');
const expectedPlatform=android?'Android':({win32:'Windows',darwin:'macOS',linux:'Linux',freebsd:'FreeBSD'})[process.platform];
const scripts=embedded?'':'<script src="/client.js"></script><script src="/messages.js"></script><script src="/plugin.js"></script>';
withBrowser({
 '/':{type:'text/html',body:'<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="background:#151923;color:white"><div class="headerRight"></div><div class="itemView"><div class="itemMainScrollSlider"><h1>单集详情</h1></div></div>'+scripts},
 '/client.js':{path:path.join(root,'native/communityClient.js')},'/messages.js':{path:path.join(root,'native/communityMessages.js')},'/plugin.js':{path:path.join(root,'native/communityPlugin.js')}
},async({evaluate})=>{
 const result=await evaluate('('+ (async function(expectedPlatform){
  const check=(v,m)=>{if(!v)throw Error(m);},wait=async fn=>{for(let i=0;i<150;i++){if(fn())return;await new Promise(r=>setTimeout(r,10));}throw Error('condition timeout');};
  const find=(text,scope=document)=>[...scope.querySelectorAll('button')].find(b=>b.textContent===text),click=(text,scope)=>{const b=find(text,scope);check(b,'button '+text);b.click();};
  await wait(()=>window._communityPlugin&&window.TigerestCommunityMessages);
  const observedUserAgent=navigator.userAgent;
  if(!window.tigerestAndroidApi){
   // The fixture page does not boot Emby's nativeshell. Use the real shell UA
   // identities here, so Chromium's default Windows/Mac UA cannot hide the bug.
   const shellUserAgent={Windows:'TigerestTheater/2.4.4 (Winnt; x86_64) Chrome/134.0.0.0',macOS:'TigerestTheater/2.4.4 (Darwin; unknown) Chrome/134.0.0.0',Linux:'TigerestTheater/2.4.4 (Linux; x86_64) Chrome/134.0.0.0',FreeBSD:'TigerestTheater/2.4.4 (Freebsd; unknown) Chrome/134.0.0.0'}[expectedPlatform];
   Object.defineProperty(navigator,'userAgent',{configurable:true,value:shellUserAgent});
   window.api={system:{isWindows:expectedPlatform==='Windows',isMacos:expectedPlatform==='macOS',isLinux:expectedPlatform==='Linux',isFreeBSD:expectedPlatform==='FreeBSD'}};
  }
  const server='62526c3bf747439c99327ddec5fed4a8';let token='report-fixture',unread=2,failSubmit=true,hold=false,holdSubmit=true,release,submitRelease;
  const calls=[],payloads=[],read=new Set();
  const location={embyServerId:server,itemId:'episode1',scope:'episode',title:'第三集',workTitle:'测试剧集',seasonNumber:1,episodeNumber:3,canNavigate:true};
  const report={id:'report1',category:'subtitle_error',description:'十二分钟之后中文字幕比声音提前三秒。',context:{positionSeconds:720,platform:'Android'},status:'resolved',createdAt:'2026-10-08T01:00:00Z',resolvedAt:'2026-10-08T02:00:00Z',resolution:'<img src=x onerror="window.unsafe=true"> 字幕已校准。',location:null,availability:'unavailable'};
  window.fetch=async(url,options)=>{
   const u=new URL(url),p=u.pathname.replace('/community/v1','');calls.push({p,method:options.method,body:options.body,headers:options.headers});
   const ok=data=>Response.json({data});
   if(p==='/me/messages'&&options.method==='POST'){const body=JSON.parse(options.body);for(const id of body.messageIds||['repair1','reply1'])read.add(id);unread=2-read.size;return ok({markedCount:1,unreadCount:unread});}
   if(p==='/me/messages'){
    const data={items:[{id:'repair1',type:'report_resolved',createdAt:report.resolvedAt,isRead:read.has('repair1'),readAt:null,availability:'unavailable',location:null,report,reply:null,originalComment:null},{id:'reply1',type:'comment_reply',createdAt:report.createdAt,isRead:read.has('reply1'),readAt:null,availability:'available',location:{...location,topicId:'topic',rootId:'root',commentId:'comment'},report:null,reply:{id:'comment',state:'visible',body:'这是一条评论回复。',author:{name:'作者'}},originalComment:{state:'visible',body:'我的原评论'}}],nextCursor:null,unreadCount:unread,readThroughToken:'unified-snapshot'};
    if(hold){await new Promise(r=>release=r);}return ok(data);
   }
   if(p==='/me/reports')return ok({items:[report,{...report,id:'open-report',status:'open',resolution:null,resolvedAt:null,location,availability:'available'}],nextCursor:null,totalCount:2});
   if(p==='/me/reports/report1')return ok(report);
   if(p==='/reports'){payloads.push(JSON.parse(options.body));if(failSubmit){failSubmit=false;throw Error('lost response');}if(holdSubmit)await new Promise(r=>submitRelease=r);return ok({report:{...report,id:'new-report',status:'open',resolution:null},replayed:true});}
   if(p==='/me')return ok({author:{id:'me',name:'我'},isCommentAdmin:false,muted:true});
   if(p==='/topics/resolve')return ok({id:'topic',title:'测试剧集'});
   if(p==='/topics/topic/comments')return ok({items:[],nextCursor:null,rootCount:0});
   throw Error('unexpected endpoint '+p);
  };
  const api={serverId:()=>server,getCurrentUserId:()=> 'user',accessToken:()=>token,serverAddress:()=> 'http://192.168.5.150:8096'};
  const plugin=new _communityPlugin({connectionManager:{currentApiClient:()=>api},appRouter:{show:async()=>{}},events:{on(){},off(){}}});
  await wait(()=>plugin.messages.unread===2);document.getElementById('tigerest-message-entry').click();
  await wait(()=>document.querySelector('[data-message-id="repair1"]'));
  const panel=document.getElementById('tigerest-messages');
  check(panel.textContent.includes('报错已修复')&&panel.textContent.includes('字幕已校准'),'repair remains readable after media removal');
  check(!panel.querySelector('img'),'repair result is plain text');
  const repair=panel.querySelector('[data-message-id="repair1"]');click('查看报错',repair);
  await wait(()=>document.getElementById('tigerest-report-detail')?.textContent.includes('字幕已校准'));
  check(plugin.messages.unread===1,'opening repair marks its unified notification read');click('关闭',document.getElementById('tigerest-report-detail'));
  click('全部已读',panel);await wait(()=>plugin.messages.unread===0&&!plugin.messages.state.loading);
  check(calls.some(c=>c.p==='/me/messages'&&JSON.parse(c.body||'{}').readThroughToken==='unified-snapshot'),'all-read uses unified snapshot');
  click('我的报错',panel);await wait(()=>panel.querySelector('[data-message-id="open-report"]'));
  check(panel.textContent.includes('待处理')&&panel.textContent.includes('已修复'),'report history shows both states');
  click('关闭',panel);
  plugin.onItem({target:document.querySelector('.itemView'),detail:{item:{Id:'episode1',Type:'Episode',Name:'第三集'}}});
  await wait(()=>plugin.state?.me);click('上报问题');
  const form=document.getElementById('tigerest-report-form');check(form?.open,'detail report entry works even when comment-muted');
  const minutes=form.querySelector('[aria-label="发生时间：分钟（可选）"]'),seconds=form.querySelector('[aria-label="发生时间：秒（可选）"]');
  check(minutes&&seconds,'report time must have separate minute and second fields');
  const description=form.querySelector('textarea');description.value='太短';click('提交报错',form);await wait(()=>form.textContent.includes('10–2000'));
  check(payloads.length===0,'invalid report stays local');
  description.value='十二分钟之后中文字幕比声音提前了三秒。';form.querySelector('select').value='subtitle_error';
  minutes.value='12';seconds.value='60';click('提交报错',form);await new Promise(r=>setTimeout(r,20));
  check(payloads.length===0,'seconds above 59 must not submit');seconds.value='30';
  click('提交报错',form);await wait(()=>form.textContent.includes('网络连接失败'));check(description.value.includes('十二分钟'),'failed submit preserves draft');
  click('提交报错',form);await wait(()=>submitRelease);check(description.disabled&&form.querySelector('select').disabled&&minutes.disabled&&seconds.disabled,'pending submission freezes its captured fields');submitRelease();await wait(()=>form.textContent.includes('报错已提交'));
  check(payloads.length===2&&payloads[0].clientRequestId===payloads[1].clientRequestId,'retry reuses the original report UUID');
  check(payloads[1].itemId==='episode1'&&payloads[1].category==='subtitle_error','report identifies exact item and category');
  check(payloads[1].context.platform===expectedPlatform,'submitted platform must identify the native host: expected '+expectedPlatform+', got '+payloads[1].context.platform+' (UA '+navigator.userAgent+')');
  check(payloads[1].context.positionSeconds===750,'12 minutes 30 seconds must submit 750 seconds');
  check(calls.filter(c=>c.p==='/reports').every(c=>!c.headers['X-Tigerest-Item-Id']),'report uses account authentication');
  click('关闭',form);
  holdSubmit=false;let now=Date.now();plugin.messages.client.now=()=>now;
  async function sendTime(minuteValue,secondValue,expected){
   now+=3001;click('上报问题');const panel=document.getElementById('tigerest-report-form');
   panel.querySelector('textarea').value='测试发生时间的分秒填写与接口换算。';
   panel.querySelector('[aria-label="发生时间：分钟（可选）"]').value=minuteValue;
   panel.querySelector('[aria-label="发生时间：秒（可选）"]').value=secondValue;
   const before=payloads.length;click('提交报错',panel);await wait(()=>panel.textContent.includes('报错已提交'));
   check(payloads.length===before+1&&payloads.at(-1).context.positionSeconds===expected,'minute/second conversion '+minuteValue+':'+secondValue);
   click('关闭',panel);
   return payloads.at(-1).context;
  }
  await sendTime('','',undefined);await sendTime('0','0',0);await sendTime('','45',45);await sendTime('2','',120);await sendTime('10080','0',604800);
  now+=3001;click('上报问题');const boundary=document.getElementById('tigerest-report-form');
  boundary.querySelector('textarea').value='超过一周的发生时间应该留在本地。';
  const boundaryMinutes=boundary.querySelector('[aria-label="发生时间：分钟（可选）"]'),boundarySeconds=boundary.querySelector('[aria-label="发生时间：秒（可选）"]');
  boundaryMinutes.value='10080';boundarySeconds.value='1';const beforeBoundary=payloads.length;click('提交报错',boundary);
  await wait(()=>boundary.textContent.includes('7 天'));check(payloads.length===beforeBoundary&&!boundaryMinutes.disabled,'over-limit time preserves editable draft');
  for(const [m,s]of [['-1','0'],['1.5','0'],['0','-1'],['0','1.5']]){boundaryMinutes.value=m;boundarySeconds.value=s;click('提交报错',boundary);await new Promise(r=>setTimeout(r,10));check(payloads.length===beforeBoundary,'invalid minute/second must not submit');}
  click('关闭',boundary);
  const savedApi=window.api,savedAndroidApi=window.tigerestAndroidApi,savedUserAgent=navigator.userAgent;
  const platforms=[
   [{isWindows:true},null,'Linux','Windows'],[{isMacos:true},null,'Winnt','macOS'],
   [{isLinux:true},null,'Winnt','Linux'],[{isFreeBSD:true},null,'Linux','FreeBSD'],
   [null,{system:{isAndroid:true}},'Linux','Android'],[null,null,'TigerestTheater/2.4.4 (Winnt; x86_64)','Windows'],
   [null,null,'TigerestTheater/2.4.4 (Darwin; unknown)','macOS'],[null,null,'Unrecognized embedded client',undefined],
  ];
  for(const [system,androidApi,userAgent,expected]of platforms){
   window.api=system?{system}:undefined;window.tigerestAndroidApi=androidApi;
   Object.defineProperty(navigator,'userAgent',{configurable:true,value:userAgent});
   const context=await sendTime('','',undefined);check(context.platform===expected,'native platform/fallback '+userAgent+': expected '+expected+', got '+context.platform);
  }
  window.api=savedApi;window.tigerestAndroidApi=savedAndroidApi;Object.defineProperty(navigator,'userAgent',{configurable:true,value:savedUserAgent});
  click('上报问题');
  const oldView=plugin.state.view;oldView.dispatchEvent(new CustomEvent('viewbeforehide',{bubbles:true}));
  check(!document.getElementById('tigerest-report-form'),'leaving an item closes its report draft');
  document.getElementById('tigerest-message-entry').click();await wait(()=>plugin.messages.state&&!plugin.messages.state.loading);
  hold=true;click('刷新消息');await wait(()=>release);token='another-account';plugin.messages.sync();release();
  await new Promise(r=>setTimeout(r,30));check(!document.getElementById('tigerest-messages'),'account change clears stale private messages');
  plugin.destroy();return {passed:true,repairNotice:true,unifiedRead:true,reportHistory:true,privateSubmission:true,retry:true,accountChange:true,minuteSecondInput:true,platform:expectedPlatform,platformCases:platforms.length,observedUserAgent};
 }).toString()+')('+JSON.stringify(expectedPlatform)+')');
 assert.equal(result.passed,true);console.log(JSON.stringify(result));
}).catch(error=>{console.error(error);process.exitCode=1;});
