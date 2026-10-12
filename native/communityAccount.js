(function(){
    'use strict';
    let singleton;
    const element=(tag,text)=>{const e=document.createElement(tag);if(text!=null)e.textContent=text;return e;};
    class Account {
        constructor(connectionManager){
            this.connectionManager=connectionManager;
            this.listeners=new Set();
            this.bridge=new window.TigerestCommunityBridge(window.api?.system||window.tigerestAndroidApi?.system);
            this.session=new window.TigerestCommunitySession({transport:this.bridge.transport,store:this.bridge.store,
                onTrust:session=>{window.TigerestCommunityClient.setTrustedServer(this.session?.caps?.embyExchangeServerId||'');this.mappingSession(session);},onChange:()=>this.identityChanged()});
            if(window.TigerestCommunityAvatar)this.avatars=new window.TigerestCommunityAvatar({session:this.session,sourceAvatar:(emby,options)=>this.bridge.sourceAvatar(emby,options)});
            window.TigerestCommunityClient.setTrustedServer('');this.sync();
            window.addEventListener('pagehide',()=>this.session.setSession(null),{once:true});
        }
        subscribe(listener){this.listeners.add(listener);return ()=>this.listeners.delete(listener);}
        identityChanged(){
            const identity=JSON.stringify([this.session.fingerprint,this.session.tokens?.author?.id||null]);
            if(identity===this.identity)return;
            const previous=this.identity;this.identity=identity;
            this.avatars?.clear();
            for(const listener of this.listeners)listener({previous,identity,author:this.session.tokens?.author||null});
        }
        async mappingSession(emby){
            const key=JSON.stringify(emby);
            if(this.mappingContext!==key){
                this.mappingContext=key;this.mappingKey=null;this.mappingFlight=null;this.mappingRetryAt=0;
                await this.bridge.setEmby(null).catch(()=>{});
            }
            if(!emby||this.mappingContext!==key||this.mappingKey===key||Date.now()<this.mappingRetryAt||this.mappingFlight===key)return;
            this.mappingFlight=key;
            try{
                const response=await this.bridge.transport('/mapping-capabilities');
                if(this.mappingContext!==key)return;
                if(response.status===404){await this.bridge.setEmby({...emby,mappingAuth:'legacy'});this.mappingKey=key;return;}
                const caps=JSON.parse(response.body);
                if(response.status===200&&caps.success===true&&caps.writeAuth?.includes('emby-session')){
                    if(await this.bridge.setEmby(emby)!==false)this.mappingKey=key;
                }
            }catch(_){/* A transient capability failure must remain retryable. */}
            finally{if(this.mappingContext===key){this.mappingFlight=null;this.mappingRetryAt=Date.now()+30000;}}
        }
        sync(){
            const emby=window.TigerestCommunityClient.session(this.connectionManager.currentApiClient?.());
            if(this.blockedKey===JSON.stringify(emby))return null;
            this.blockedKey=null;
            if(this.session.setSession(emby)){
                this.dialog?.close();this.dialog?.remove();this.dialog=null;
                if(emby)this.session.discover().catch(()=>{});
            }
            if(emby&&this.session.trusted())this.mappingSession(emby);
            return emby;
        }
        reset(){this.blockedKey=JSON.stringify(window.TigerestCommunityClient.session(this.connectionManager.currentApiClient?.()));this.session.setSession(null);this.dialog?.close();}
        async show(onDone=()=>{}){
            this.dialog?.close();this.dialog?.remove();
            const dialog=element('dialog');this.dialog=dialog;dialog.id='tigerest-community-account';
            dialog.style.cssText='color:#e9eff8;background:#172335;border:1px solid #526882;border-radius:14px;padding:24px;width:min(420px,calc(100vw - 64px))';
            const title=element('h2','公共评论账号'),status=element('p','正在连接评论服务…'),form=element('form'),controls=element('div');
            status.setAttribute('role','status');status.style.whiteSpace='pre-wrap';form.style.cssText='display:grid;gap:12px';controls.style.cssText='display:flex;gap:10px;flex-wrap:wrap;margin-top:16px';
            const close=element('button','关闭');close.type='button';close.onclick=()=>dialog.close();controls.append(close);
            dialog.append(title,status,form,controls);document.body.append(dialog);dialog.showModal();
            const current=()=>this.dialog===dialog&&dialog.open;
            const addButton=(label,action)=>{const b=element('button',label);b.type='button';b.className='tc-button';b.onclick=action;controls.prepend(b);return b;};
            const run=async operation=>{
                for(const input of dialog.querySelectorAll('input,button'))input.disabled=true;
                try{await operation();if(!current())return;dialog.close();onDone();}
                catch(error){if(current())status.textContent=error.message;}
                finally{for(const input of dialog.querySelectorAll('input,button'))input.disabled=false;}
            };
            const field=(label,type,autocomplete)=>{
                const wrap=element('label',label),input=element('input');input.type=type;input.autocomplete=autocomplete;input.required=true;
                input.setAttribute('aria-label',label);input.style.cssText='box-sizing:border-box;display:block;width:100%;padding:9px;margin-top:5px;font:inherit';wrap.append(input);form.append(wrap);return input;
            };
            try{
                const caps=await this.session.discover();if(!current())return;
                const policy=this.session.passwordPolicy?.()||{minLength:12,maxLength:128};
                const passwordLabel=prefix=>prefix+'（'+policy.minLength+'–'+policy.maxLength+' 个字符）';
                const helpText='可使用字母、数字和符号，不可包含换行等控制字符。';
                if(this.session.trusted()){
                    await this.session.ready();if(!current())return;
                    status.textContent='已使用大河 Emby 账号登录公共评论。';return;
                }
                try{await this.session.ready();}catch(error){if(!['LOGIN_REQUIRED','AUTH_REQUIRED','AUTH_INVALID'].includes(error.code))throw error;}
                if(!current())return;
                if(this.session.tokens){
                    status.textContent='当前评论账号：'+this.session.tokens.author.name+(this.session.persisted?'':'\n安全存储不可用，本次登录仅在当前运行期间有效。');
                    addButton('退出评论账号',()=>run(()=>this.session.logout()));
                    const old=field('当前密码','password','current-password'),next=field(passwordLabel('新密码'),'password','new-password');
                    const help=element('small',helpText);help.id='tc-password-requirements';next.parentElement.append(help);next.setAttribute('aria-describedby',help.id);
                    addButton('修改密码',()=>{if(form.reportValidity())run(()=>this.session.changePassword(old.value,next.value));});
                    form.onsubmit=e=>e.preventDefault();return;
                }
                status.textContent='使用独立评论账号参与公共讨论。你的 Emby 登录凭据只用于自己的服务器。';
                const username=field('用户名','text','username'),password=field('密码','password','current-password');
                const passwordHelp=element('small',helpText);passwordHelp.id='tc-password-requirements';passwordHelp.hidden=true;
                password.parentElement.append(passwordHelp);password.setAttribute('aria-describedby',passwordHelp.id);
                let displayName,register=false;
                const submit=addButton('登录',()=>{if(form.reportValidity())run(()=>register?this.session.register(username.value,displayName.value,password.value):this.session.login(username.value,password.value));});
                form.onsubmit=e=>{e.preventDefault();submit.click();};
                if(caps.registrationEnabled)addButton('注册新账号',event=>{
                    register=!register;event.target.textContent=register?'已有账号，返回登录':'注册新账号';submit.textContent=register?'注册并登录':'登录';
                    if(!displayName){displayName=field('显示名称（1–60 字符）','text','nickname');displayName.maxLength=120;}
                    displayName.parentElement.hidden=!register;displayName.required=register;password.autocomplete=register?'new-password':'current-password';
                    password.parentElement.firstChild.textContent=register?passwordLabel('密码'):'密码';
                    passwordHelp.hidden=!register;
                    status.textContent=register?'用户名 3–32 位，以字母开头，可含数字、_、.、-。':'请输入评论账号和密码。';
                });
            }catch(error){if(current()){
                status.textContent=error.message;addButton('重试连接',()=>this.show(onDone));
                if(this.session.renewalError)addButton('重新登录',()=>{this.session.tokens=null;this.session.renewalError=null;this.session.onChange();this.show(onDone);});
            }}
        }
    }
    window.TigerestCommunityAccount={get(connectionManager){if(!singleton)singleton=new Account(connectionManager);return singleton;}};
})();
