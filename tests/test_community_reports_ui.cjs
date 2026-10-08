const assert=require('node:assert/strict'),path=require('node:path');
const android=process.argv.includes('--android');
const withBrowser=require(android?'../android/tests/android_browser.cjs':'./community_browser.cjs');
const root=path.resolve(__dirname,'..'),embedded=android||process.argv.includes('--webengine');
const scripts=embedded?'':'<script src="/client.js"></script><script src="/messages.js"></script><script src="/plugin.js"></script>';
withBrowser({
 '/':{type:'text/html',body:'<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="background:#151923;color:white"><div class="headerRight"></div><div class="itemView"><div class="itemMainScrollSlider"><h1>单集详情</h1></div></div>'+scripts},
 '/client.js':{path:path.join(root,'native/communityClient.js')},'/messages.js':{path:path.join(root,'native/communityMessages.js')},'/plugin.js':{path:path.join(root,'native/communityPlugin.js')}
},async({evaluate})=>{
 const result=await evaluate('('+ (async function(){
  const check=(v,m)=>{if(!v)throw Error(m);},wait=async fn=>{for(let i=0;i<150;i++){if(fn())return;await new Promise(r=>setTimeout(r,10));}throw Error('condition timeout');};
  const find=(text,scope=document)=>[...scope.querySelectorAll('button')].find(b=>b.textContent===text),click=(text,scope)=>{const b=find(text,scope);check(b,'button '+text);b.click();};
  await wait(()=>window._communityPlugin&&window.TigerestCommunityMessages);
  const server='62526c3bf747439c99327ddec5fed4a8';let token='report-fixture',unread=2,failSubmit=true,hold=false,release,submitRelease;
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
   if(p==='/reports'){payloads.push(JSON.parse(options.body));if(failSubmit){failSubmit=false;throw Error('lost response');}await new Promise(r=>submitRelease=r);return ok({report:{...report,id:'new-report',status:'open',resolution:null},replayed:true});}
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
  const description=form.querySelector('textarea');description.value='太短';click('提交报错',form);await wait(()=>form.textContent.includes('10–2000'));
  check(payloads.length===0,'invalid report stays local');
  description.value='十二分钟之后中文字幕比声音提前了三秒。';form.querySelector('select').value='subtitle_error';
  click('提交报错',form);await wait(()=>form.textContent.includes('网络连接失败'));check(description.value.includes('十二分钟'),'failed submit preserves draft');
  click('提交报错',form);await wait(()=>submitRelease);check(description.disabled&&form.querySelector('select').disabled,'pending submission freezes its captured fields');submitRelease();await wait(()=>form.textContent.includes('报错已提交'));
  check(payloads.length===2&&payloads[0].clientRequestId===payloads[1].clientRequestId,'retry reuses the original report UUID');
  check(payloads[1].itemId==='episode1'&&payloads[1].category==='subtitle_error','report identifies exact item and category');
  check(calls.filter(c=>c.p==='/reports').every(c=>!c.headers['X-Tigerest-Item-Id']),'report uses account authentication');
  click('关闭',form);
  click('上报问题');
  const oldView=plugin.state.view;oldView.dispatchEvent(new CustomEvent('viewbeforehide',{bubbles:true}));
  check(!document.getElementById('tigerest-report-form'),'leaving an item closes its report draft');
  document.getElementById('tigerest-message-entry').click();await wait(()=>plugin.messages.state&&!plugin.messages.state.loading);
  hold=true;click('刷新消息');await wait(()=>release);token='another-account';plugin.messages.sync();release();
  await new Promise(r=>setTimeout(r,30));check(!document.getElementById('tigerest-messages'),'account change clears stale private messages');
  plugin.destroy();return {passed:true,repairNotice:true,unifiedRead:true,reportHistory:true,privateSubmission:true,retry:true,accountChange:true};
 }).toString()+')()');
 assert.equal(result.passed,true);console.log(JSON.stringify(result));
}).catch(error=>{console.error(error);process.exitCode=1;});
