// Self-service display name and password on the real account dialog, backed by
// an isolated native-bridge fixture of the comment network (contract 2026-10-16).
const assert=require('node:assert/strict'),path=require('node:path');
const withBrowser=require('./community_browser.cjs');
const files=['communityClient','communityBridge','communitySession','communityPublicClient','communityAvatar','communityAccount','communityMessages','communityPlugin'];
const routes=Object.fromEntries(files.map(file=>['/'+file+'.js',{path:path.join(__dirname,'../native/'+file+'.js')}]));
routes['/']={type:'text/html',body:'<html><meta charset="utf-8"><div class="headerRight"></div><div class="itemView"><h1>资料测试</h1><div class="peopleSection"></div></div>'+files.map(file=>'<script src="/'+file+'.js"></script>').join('')+'</html>'};
withBrowser(routes,async({evaluate})=>{
 const waitFor=async expression=>{for(let i=0;i<150;i++){if(await evaluate(expression))return;await new Promise(resolve=>setTimeout(resolve,50));}throw Error('Timed out: '+expression);};
 const dialog='#tigerest-community-account';
 const click=async label=>evaluate(`Array.from(document.querySelectorAll('${dialog} button')).find(button=>button.textContent===${JSON.stringify(label)}).click()`);
 const settle=()=>waitFor(`Array.from(document.querySelectorAll('${dialog} button')).every(button=>!button.disabled)`);
 const status=()=>evaluate(`document.querySelector('${dialog} [role="status"]').textContent`);
 const set=(label,value)=>evaluate(`document.querySelector('${dialog} [aria-label=${JSON.stringify(label)}]').value=${JSON.stringify(value)}`);
 const count=path=>evaluate(`calls.filter(call=>call.path===${JSON.stringify(path)}).length`);
 await evaluate(`
 window.calls=[];window.saved={};window.name='自己';window.password='old-password';window.revoked=false;
 window.profile=true;window.account={authKind:'password',canChangeDisplayName:true,canChangePassword:true};
 window.profileReply=null;window.passwordReply=null;let listener;
 const selfId='11111111-1111-4111-8111-111111111111';
 window.respond=(id,data,status=200,code='NETWORK_UNAVAILABLE',headers={})=>setTimeout(()=>listener(id,{status,headers,body:JSON.stringify(status===200||status===201?{data,requestId:'00000000-0000-4000-8000-000000000000'}:{error:{code,message:code}})}),0);
 const session=()=>({accessToken:'fixture-access',refreshToken:'fixture-refresh',tokenType:'Bearer',expiresAt:'2099-01-01T00:00:00Z',refreshExpiresAt:'2099-02-01T00:00:00Z',author:{id:selfId,name}});
 const comment=(id,body)=>({id,author:{id:selfId,name},body,state:'visible',createdAt:'2026-10-16T01:00:00Z',permissions:{canReply:true,canDelete:true}});
 window.api={system:{communityResponse:{connect:callback=>listener=callback},communityCancel(){},communitySetEmbySession(session,callback){callback(true)},
 communityCredential(operation,key,value,callback){if(operation==='write')saved[key]=value;if(operation==='remove')delete saved[key];callback({ok:true,value:saved[key]||''});},
 communitySourceAvatar(id){setTimeout(()=>listener(id,{status:404,body:'{}'}),0);},
 communityRequest(id,request){calls.push(request);const p=request.path,method=request.method,body=request.body?JSON.parse(request.body):null;
  if(p==='/capabilities')return respond(id,{enabled:true,auth:['password','emby-exchange'],embyExchangeServerId:'62526c3bf747439c99327ddec5fed4a8',registrationEnabled:true,mediaIdentity:'tmdb-aired',
   passwordPolicy:{minLength:8,maxLength:128,lengthUnit:'unicode-code-point',allowControlCharacters:false},
   ...(profile?{profilePolicy:{displayName:{minLength:1,maxLength:60,lengthUnit:'unicode-code-point',trim:true},authKinds:['password'],requestsPerMinute:5}}:{})});
  if(p==='/auth/emby')return respond(id,{...session(),author:{id:'emby-author',name:'大河用户'}});
  if(p==='/auth/register'||p==='/auth/refresh')return respond(id,session(),p==='/auth/register'?201:200);
  if(p==='/auth/login')return body.password===password?respond(id,session()):respond(id,null,401,'AUTH_INVALID');
  if(revoked)return respond(id,null,401,'AUTH_INVALID');
  if(p==='/me'&&method==='GET')return respond(id,{author:{id:selfId,name},muted:false,...(account?{account}:{})});
  if(p==='/me/profile'){
   if(profileReply)return profileReply(id,body);
   name=body.displayName;return respond(id,{author:{id:selfId,name}});
  }
  if(p==='/me/password'){
   if(passwordReply)return passwordReply(id,body);
   if(body.currentPassword!==password)return respond(id,null,401,'AUTH_INVALID');
   password=body.newPassword;revoked=true;return respond(id,{passwordChanged:true,loginRequired:true});
  }
  if(p==='/topics/resolve')return respond(id,{id:'topic',scope:'work',title:'资料测试'});
  if(p.startsWith('/topics/topic/comments'))return respond(id,{items:[comment('root','我的旧评论')],nextCursor:null,rootCount:1});
  return respond(id,{items:[],nextCursor:null,unreadCount:0});
 }}};
 window.emby={serverId:()=> 'external',getCurrentUserId:()=> 'u1',accessToken:()=> 'PRIVATE-EXTERNAL-TOKEN',serverAddress:()=> 'http://other.invalid'};
 window.plugin=new _communityPlugin({connectionManager:{currentApiClient:()=>emby}});
 document.querySelector('.itemView').dispatchEvent(new CustomEvent('itemshow',{bubbles:true,detail:{item:{Id:'movie',Type:'Movie',ProviderIds:{Tmdb:'42'}}}}));
 `);
 await waitFor(`plugin.state&&!plugin.state.loading`);

 // Registration asks for the password twice and only the comparison sees the repeat.
 await evaluate(`plugin.account.show()`);await waitFor(`!!document.querySelector('${dialog} [aria-label="用户名"]')`);
 await click('注册新账号');
 assert.deepEqual(await evaluate(`Array.from(document.querySelectorAll('${dialog} label')).filter(label=>!label.hidden).map(label=>label.querySelector('input').getAttribute('aria-label'))`),
  ['用户名','显示名称（1–60 字符）','密码','确认密码'],'registration fields in reading order');
 await set('用户名','fixture');await set('显示名称（1–60 字符）','自己');await set('密码','new-account-1');await set('确认密码','new-account-2');
 await click('注册并登录');await settle();
 assert.equal(await status(),'两次输入的密码不一致。');
 assert.equal(await count('/auth/register'),0,'a mismatched repeat sends nothing');
 await set('确认密码','new-account-1');await click('注册并登录');
 await waitFor(`!document.querySelector('${dialog}').open`);
 assert.deepEqual(Object.keys(JSON.parse(await evaluate(`calls.find(call=>call.path==='/auth/register').body`))).sort(),['displayName','password','username'],'the repeat is never sent');
 await evaluate(`password='new-account-1'`);
 await waitFor(`plugin.state.topic?.id==='topic'&&!plugin.state.loading`);

 // A password account with the announced capability edits its display name.
 await evaluate(`plugin.account.show()`);await waitFor(`!!document.querySelector('${dialog} [aria-label="显示昵称（1–60 个字符）"]')`);
 assert.equal(await evaluate(`document.querySelector('${dialog} [aria-label="显示昵称（1–60 个字符）"]').value`),'自己');
 assert.deepEqual(await evaluate(`Array.from(document.querySelectorAll('${dialog} h3'),h=>h.textContent)`),['显示昵称','修改密码']);
 await set('显示昵称（1–60 个字符）','名'.repeat(61));await click('保存昵称');await settle();
 assert.match(await status(),/1–60 个字符.*61/);
 await set('显示昵称（1–60 个字符）','   ');await click('保存昵称');await settle();
 assert.match(await status(),/不能只填空格/);
 assert.equal(await count('/me/profile'),0,'invalid names are rejected locally and the old name stays');
 assert.equal(await evaluate(`plugin.account.session.tokens.author.name`),'自己');
 const listings=()=>evaluate(`calls.filter(call=>call.path.startsWith('/topics/topic/comments?')).length`);
 const listed=await listings();
 assert.ok(listed>0,'the comment list was loaded before the rename');
 await evaluate(`plugin.state.input.value='还没发的草稿';plugin.updateComposer(plugin.state)`);
 await set('显示昵称（1–60 个字符）','  新名字  ');await click('保存昵称');await settle();
 assert.equal(await status(),'昵称已改为「新名字」。');
 assert.deepEqual(JSON.parse(await evaluate(`calls.find(call=>call.path==='/me/profile').body`)),{displayName:'新名字'},'only the trimmed name, no identity fields');
 assert.equal(await evaluate(`calls.find(call=>call.path==='/me/profile').method`),'PUT');
 assert.equal(await evaluate(`plugin.account.session.tokens.author.name`),'新名字');
 assert.equal(await evaluate(`document.querySelector('${dialog} p').textContent.startsWith('当前评论账号：新名字')`),true);
 await waitFor(`calls.filter(call=>call.path.startsWith('/topics/topic/comments?')).length>${listed}&&!plugin.state.loading`);
 assert.equal(await evaluate(`plugin.state.input.value`),'还没发的草稿','the list reloads under the new name and keeps the draft');
 assert.equal(await evaluate(`plugin.state.panel.textContent.includes('新名字')`),true);
 assert.equal(await evaluate(`JSON.parse(saved[Object.keys(saved)[0]]).author.name`),'新名字','the stored session carries the new name');

 // Rate limits report the wait; a lost response is settled by reading /me, not by resubmitting.
 await evaluate(`profileReply=(id)=>respond(id,null,429,'RATE_LIMITED',{'retry-after':'42'})`);
 await set('显示昵称（1–60 个字符）','再改一次');await click('保存昵称');await settle();
 assert.equal(await status(),'操作过于频繁，请等待 42 秒后重试。');
 await evaluate(`profileReply=(id,body)=>{name=body.displayName;setTimeout(()=>listener(id,{status:0,error:'connection reset'}),0);}`);
 const profileCalls=await count('/me/profile');
 await set('显示昵称（1–60 个字符）','断线后的名字');await click('保存昵称');await settle();
 assert.equal(await status(),'昵称已改为「断线后的名字」。','the name read back from /me confirms the save');
 assert.equal(await count('/me/profile'),profileCalls+1,'no automatic resubmission');
 await evaluate(`profileReply=null`);

 // A wrong current password leaves the session and the password alone, and is never resubmitted.
 await set('当前密码','not-my-password');await set('新密码（8–128 个字符）','next-password');await set('确认新密码','next-password');
 await click('修改密码');await settle();
 assert.equal(await status(),'当前密码不正确，密码没有修改。');
 assert.equal(await count('/me/password'),1,'a 401 is not retried with the old password');
 assert.notEqual(await evaluate(`plugin.account.session.tokens`),null,'a wrong password does not sign the account out');
 await set('当前密码','new-account-1');await set('确认新密码','next-passw0rd');await click('修改密码');await settle();
 assert.equal(await status(),'两次输入的密码不一致。');
 assert.equal(await count('/me/password'),1);
 await set('确认新密码','next-password');await click('修改密码');
 await waitFor(`!!document.querySelector('${dialog} [aria-label="用户名"]')`);
 assert.equal(await status(),'密码已修改，所有设备上的评论登录都已退出。请用新密码重新登录。');
 assert.deepEqual(Object.keys(JSON.parse(await evaluate(`calls.filter(call=>call.path==='/me/password').at(-1).body`))).sort(),['currentPassword','newPassword']);
 assert.equal(await evaluate(`plugin.account.session.tokens`),null);
 assert.equal(await evaluate(`Object.keys(saved).length`),0,'the old session is removed from secure storage');
 await set('用户名','fixture');await set('密码','next-password');await evaluate(`revoked=false`);await click('登录');
 await waitFor(`!document.querySelector('${dialog}').open`);
 assert.equal(await evaluate(`plugin.account.session.tokens.author.name`),'断线后的名字','the name survives the password change');

 // A lost password response: a session that still works proves nothing changed.
 await evaluate(`passwordReply=(id)=>setTimeout(()=>listener(id,{status:0,error:'connection reset'}),0)`);
 await evaluate(`plugin.account.show()`);await waitFor(`!!document.querySelector('${dialog} [aria-label="当前密码"]')`);
 await set('当前密码','next-password');await set('新密码（8–128 个字符）','third-password');await set('确认新密码','third-password');
 await click('修改密码');await settle();
 assert.equal(await status(),'网络中断，密码没有修改，请重试。');
 // ...and a session that ended with it proves the change went through.
 await evaluate(`passwordReply=(id,body)=>{password=body.newPassword;revoked=true;setTimeout(()=>listener(id,{status:0,error:'connection reset'}),0);}`);
 await click('修改密码');
 await waitFor(`!!document.querySelector('${dialog} [aria-label="用户名"]')`);
 assert.match(await status(),/密码已修改/);
 await evaluate(`passwordReply=null;revoked=false;dialogClose=document.querySelector('${dialog}').close()`);

 // Services without the new fields, accounts without the right, and Emby accounts get no name editor.
 await evaluate(`profile=false;plugin.account.session.caps=null;plugin.account.show()`);
 await waitFor(`!!document.querySelector('${dialog} [aria-label="用户名"]')`);
 await set('用户名','fixture');await set('密码','third-password');await click('登录');
 await waitFor(`!document.querySelector('${dialog}').open`);
 await evaluate(`plugin.account.show()`);await waitFor(`!!document.querySelector('${dialog} [aria-label="当前密码"]')`);
 assert.equal(await evaluate(`!!document.querySelector('${dialog} [aria-label^="显示昵称"]')`),false,'an older service offers only the password change');
 await evaluate(`profile=true;account={authKind:'password',canChangeDisplayName:false,canChangePassword:true};plugin.account.session.caps=null;plugin.account.show()`);
 await waitFor(`!!document.querySelector('${dialog} [aria-label="当前密码"]')`);
 assert.equal(await evaluate(`!!document.querySelector('${dialog} [aria-label^="显示昵称"]')`),false,'no edit right, no editor');
 await evaluate(`document.querySelector('${dialog}').close();emby.serverId=()=> '62526c3bf747439c99327ddec5fed4a8';emby.accessToken=()=> 'nas-token';plugin.account.sync();plugin.account.show()`);
 await waitFor(`document.querySelector('${dialog} [role="status"]').textContent==='已使用大河 Emby 账号登录公共评论。'`);
 assert.equal(await evaluate(`document.querySelectorAll('${dialog} input').length`),0,'Emby accounts manage name and password in Emby');
 assert.equal(await evaluate(`calls.some(call=>call.path==='/me/profile'&&call.headers?.Authorization!=='Bearer fixture-access')`),false);
 assert.equal(await evaluate(`JSON.stringify(calls).includes('PRIVATE-EXTERNAL-TOKEN')`),false);
 await evaluate(`plugin.destroy()`);
 console.log('profile UI: registration repeat, capability-gated name editor, trimmed rename with list reload and kept draft, 429 and lost-response read-back, wrong-password without resubmission, password repeat, re-login after change, and no editor for older services or Emby accounts passed');
}).catch(error=>{console.error(error);process.exitCode=1;});
