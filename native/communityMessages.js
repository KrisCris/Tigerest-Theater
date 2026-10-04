(function () {
    'use strict';
    const Client=window.TigerestCommunityClient;
    const node=(tag,text,className)=>{
        const element=document.createElement(tag);
        if(text!=null)element.textContent=String(text);
        if(className)element.className=className;
        return element;
    };
    const button=(label,action)=>{
        const element=node('button',label,'tm-button');element.type='button';
        element.addEventListener('click',action);return element;
    };
    const time=value=>{
        const date=new Date(value);return Number.isNaN(date.getTime())?'':date.toLocaleString();
    };
    const body=comment=>comment?.state==='visible'?(comment.body||''):'评论已删除';
    function style(){
        if(document.getElementById('tigerest-messages-style'))return;
        const sheet=node('style');sheet.id='tigerest-messages-style';
        sheet.textContent=`
        #tigerest-message-entry{font:inherit;color:inherit;background:transparent;border:1px solid #59697e;border-radius:20px;padding:7px 13px;margin:0 8px;cursor:pointer;white-space:nowrap}
        #tigerest-message-entry:focus-visible{outline:2px solid #79c5ff;outline-offset:3px}
        #tigerest-messages{color:#e9eff8;background:#141d2b;border:1px solid #3a4b62;border-radius:18px;padding:0;width:min(780px,calc(100vw - 32px));max-width:none;box-shadow:0 24px 90px #0008}
        #tigerest-messages::backdrop{background:#0009}
        #tigerest-messages .tm-shell{display:flex;flex-direction:column;max-height:min(800px,calc(100dvh - 48px))}
        #tigerest-messages .tm-head{padding:24px 26px 16px;border-bottom:1px solid #334156}
        #tigerest-messages .tm-title{display:flex;justify-content:space-between;gap:14px;align-items:center}
        #tigerest-messages h2{font-size:25px;margin:0}#tigerest-messages p{margin:8px 0}
        #tigerest-messages .tm-muted{color:#a9b8cb;font-size:13px;line-height:1.5}
        #tigerest-messages .tm-toolbar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:16px}
        #tigerest-messages .tm-button{font:inherit;font-size:14px;background:#24344a;color:#e9eff8;border:1px solid #43556e;border-radius:8px;padding:8px 13px;cursor:pointer}
        #tigerest-messages .tm-button:hover{background:#304c6d}
        #tigerest-messages .tm-button[aria-pressed=true]{background:#175487;border-color:#72bbf2}
        #tigerest-messages .tm-button:disabled{opacity:.45;cursor:default}
        #tigerest-messages .tm-button:focus-visible{outline:2px solid #79c5ff;outline-offset:3px}
        #tigerest-messages .tm-content{padding:8px 26px 22px;overflow:auto}
        #tigerest-messages .tm-status{margin:12px 0;color:#b5c8de;font-size:14px;white-space:pre-wrap}
        #tigerest-messages .tm-card{padding:18px;margin:12px 0;background:#1d293b;border:1px solid #33435a;border-radius:12px}
        #tigerest-messages .tm-unread{border-left:3px solid #72c6ff}
        #tigerest-messages .tm-card-head{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap}
        #tigerest-messages .tm-topic{color:#87c8fa;font-size:14px;margin:10px 0}
        #tigerest-messages .tm-body{white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.65;margin:12px 0;font-size:15px}
        #tigerest-messages blockquote{margin:12px 0;padding:10px 14px;background:#111b29;border-left:2px solid #506884;border-radius:4px}
        #tigerest-messages .tm-empty{text-align:center;padding:40px 10px;color:#a9b8cb}
        @media(max-width:600px){#tigerest-messages .tm-head{padding:18px 16px 14px}#tigerest-messages .tm-content{padding:6px 14px 18px}#tigerest-messages h2{font-size:22px}#tigerest-messages .tm-card{padding:14px}}
        `;
        (document.head||document.documentElement).appendChild(sheet);
    }
    class CommunityMessages {
        constructor({connectionManager,openDiscussion}){
            this.connectionManager=connectionManager;this.openDiscussion=openDiscussion;
            this.client=new Client();this.summaryVersion=0;this.lastSummary=0;this.unread=0;
        }
        session(){return Client.session(this.connectionManager.currentApiClient?.());}
        valid(state){
            return this.state===state && this.sessionKey===JSON.stringify(this.session()) && Boolean(this.client.context);
        }
        sync(){
            const session=this.session(),key=Client.supported(session)?JSON.stringify(session):'';
            if(this.blockedKey===key)return;
            if(key!==this.sessionKey){
                this.reset();this.sessionKey=key;
                if(key)this.client.setSession(session);
            }
            if(!key)return;
            const host=document.querySelector('.headerRight');
            if(host && !this.entry?.isConnected){
                style();this.entry=button('消息',()=>this.open());this.entry.id='tigerest-message-entry';
                host.prepend(this.entry);this.badge();
            }
            if(!document.hidden && Date.now()-this.lastSummary>=60000)this.refreshSummary();
        }
        badge(){
            if(!this.entry)return;
            this.entry.textContent='消息'+(this.unread>0?' · '+(this.unread>99?'99+':this.unread):'');
            this.entry.setAttribute('aria-label','消息中心'+(this.unread>0?'，'+this.unread+' 条未读回复':''));
        }
        async refreshSummary(){
            if(!this.client.context||this.state?.loading||this.state?.busy)return;
            this.lastSummary=Date.now();
            const version=++this.summaryVersion,key=this.sessionKey;
            try{
                const summary=await this.client.messageSummary();
                if(version!==this.summaryVersion||key!==JSON.stringify(this.session()))return;
                this.updateUnread(summary);
            }catch(error){
                // Authentication invalidates this account, even if a newer view
                // superseded the poll that discovered it. Never clear a new account.
                if(error.status===401&&key===this.sessionKey&&key===JSON.stringify(this.session()))this.reset(true);
                // A badge refresh must never interrupt browsing or playback.
            }
        }
        updateUnread(data){
            if(Number.isFinite(data.unreadCount))this.unread=Math.max(0,data.unreadCount);
            this.badge();
        }
        open(){
            this.sync();if(!this.client.context)return;
            if(this.state){this.state.panel.focus();return;}
            style();const panel=node('dialog');panel.id='tigerest-messages';
            panel.setAttribute('aria-labelledby','tm-heading');
            const state={panel,kind:'replies',version:0,ids:new Set(),cursor:null,busy:false};
            this.state=state;
            const shell=node('div',null,'tm-shell'),head=node('div',null,'tm-head');
            const title=node('div',null,'tm-title'),heading=node('h2','消息中心');heading.id='tm-heading';
            title.append(heading,button('关闭',()=>this.close()));head.append(title,node('p','查看你的发言，以及其他人对你的回复。','tm-muted'));
            const toolbar=node('div',null,'tm-toolbar');state.tabs=[];
            for(const [kind,label] of [['replies','收到的回复'],['sent','我的发言']]){
                const tab=button(label,()=>{if(state.busy||state.kind===kind)return;state.kind=kind;this.load(state);});
                tab.dataset.kind=kind;state.tabs.push(tab);toolbar.appendChild(tab);
            }
            state.refresh=button('刷新消息',()=>this.load(state));toolbar.appendChild(state.refresh);
            state.readAll=button('全部已读',()=>this.readAll(state));toolbar.appendChild(state.readAll);head.appendChild(toolbar);
            const content=node('div',null,'tm-content');state.status=node('p','','tm-status');
            state.status.setAttribute('role','status');state.status.setAttribute('aria-live','polite');
            state.list=node('div');state.more=button('加载更多消息',()=>this.load(state,true));state.more.hidden=true;
            content.append(state.status,state.list,state.more);shell.append(head,content);panel.appendChild(shell);
            panel.addEventListener('cancel',e=>{e.preventDefault();this.close();});
            document.body.appendChild(panel);panel.showModal();
            this.load(state);
        }
        controls(state){
            state.refresh.disabled=Boolean(state.loading||state.busy);
            state.more.disabled=Boolean(state.loading||state.busy);
            state.readAll.hidden=state.kind!=='replies';
            state.readAll.disabled=Boolean(state.loading||state.busy||!state.through||!this.unread);
            for(const tab of state.tabs){tab.disabled=state.busy;tab.setAttribute('aria-pressed',String(tab.dataset.kind===state.kind));}
        }
        error(state,error){
            if(this.state!==state||this.sessionKey!==JSON.stringify(this.session())||error.name==='AbortError')return;
            if(error.status===401){this.reset(true);return;}
            state.status.textContent=error.status===404?'消息功能尚未启用，请联系管理员升级评论服务。':
                error.message+(error.requestId?'（请求编号：'+error.requestId+'）':'');
        }
        async load(state,more=false){
            if(!this.valid(state)||state.busy||(more&&(!state.cursor||state.loading)))return;
            const version=++state.version,kind=state.kind,cursor=more?state.cursor:null;
            ++this.summaryVersion;
            state.loading=true;state.status.textContent='正在加载消息…';
            // Keep a successful page through transient errors, but never mix tabs.
            if(state.loadedKind!==kind){state.ids.clear();state.list.replaceChildren();state.cursor=null;state.more.hidden=true;state.through=null;}
            this.controls(state);
            try{
                const data=await this.client.messages(kind,cursor);
                if(!this.valid(state)||version!==state.version)return;
                if(!more){state.ids.clear();state.list.replaceChildren();}
                state.loadedKind=kind;
                if(kind==='replies'){
                    this.updateUnread(data);this.lastSummary=Date.now();
                    state.through=data.readThroughToken;
                }
                for(const message of data.items||[]){
                    const id=kind==='replies'?message.id:message.comment?.id;
                    if(!id||state.ids.has(id))continue;state.ids.add(id);
                    state.list.appendChild(this.card(state,message));
                }
                if(!state.ids.size)state.list.appendChild(node('p',kind==='sent'?'还没有发言，去喜欢的作品聊聊吧。':'还没有收到回复。','tm-empty'));
                state.cursor=data.nextCursor;state.more.hidden=!state.cursor;
                state.status.textContent=kind==='replies'?'未读回复 '+this.unread+' 条':'你发表过的评论和回复';
            }catch(error){if(version===state.version||error.status===401)this.error(state,error);}
            finally{if(this.valid(state)&&version===state.version){state.loading=false;this.controls(state);}}
        }
        card(state,message){
            const received=state.kind==='replies',comment=(received?message.reply:message.comment)||{};
            const available=message.availability!=='unavailable',location=available?message.location:null;
            const card=node('article',null,'tm-card');card.dataset.messageId=received?message.id:comment.id;
            const unread=received&&!message.isRead&&!message.readAt;card.classList.toggle('tm-unread',unread);
            const header=node('div',null,'tm-card-head');
            header.append(node('strong',comment.author?.name||'用户'),node('span',time(message.createdAt||comment.createdAt),'tm-muted'));
            card.appendChild(header);
            if(location)card.appendChild(node('p',(location.scope==='episode'?'本集 · ':'作品 · ')+
                (location.workTitle?location.workTitle+' · ':'')+(location.title||'未命名作品'),'tm-topic'));
            if(available&&message.originalComment){
                const original=node('blockquote');original.append(node('div','回复的原发言','tm-muted'),node('div',body(message.originalComment),'tm-body'));card.appendChild(original);
            }
            card.appendChild(node('div',available?(comment.replyToAuthor?'回复 @'+comment.replyToAuthor.name+'：\n':'')+body(comment):'内容已不可用','tm-body'));
            const actions=node('div',null,'tm-toolbar');
            let read;
            const markRead=async()=>{
                state.busy=true;++this.summaryVersion;this.controls(state);
                try{
                    const result=await this.client.readMessage(message.id);if(!this.valid(state))return;
                    ++this.summaryVersion;this.lastSummary=Date.now();this.updateUnread(result);
                    message.isRead=true;message.readAt=new Date().toISOString();card.classList.remove('tm-unread');read?.remove();
                    state.status.textContent='未读回复 '+this.unread+' 条';
                }finally{if(this.valid(state)){state.busy=false;this.controls(state);}}
            };
            if(location?.itemId){
                const open=button(location.canNavigate?'查看讨论':'查看作品',async()=>{
                    if(!this.valid(state)||state.busy||state.loading||open.disabled)return;
                    open.disabled=true;
                    try{
                        if(received&&!message.isRead&&!message.readAt)await markRead();
                        if(!this.valid(state))return;
                        await this.openDiscussion?.(message);if(this.valid(state))this.close();
                    }
                    catch(error){this.error(state,error);}
                    finally{open.disabled=false;}
                });
                actions.appendChild(open);
            }else actions.appendChild(node('span','作品当前不可访问','tm-muted'));
            if(unread){
                read=button('标为已读',async()=>{
                    if(!this.valid(state)||state.busy||state.loading||read.disabled)return;
                    read.disabled=true;
                    try{await markRead();}catch(error){this.error(state,error);}
                    finally{read.disabled=false;}
                });
                actions.appendChild(read);
            }
            card.appendChild(actions);return card;
        }
        async readAll(state){
            if(!this.valid(state)||state.readAll.disabled)return;
            state.busy=true;++this.summaryVersion;this.controls(state);
            const through=state.through;
            try{
                const result=await this.client.readAllMessages(through);if(!this.valid(state))return;
                ++this.summaryVersion;this.updateUnread(result);this.lastSummary=Date.now();
                state.busy=false;await this.load(state);
            }catch(error){
                if(error.status===400&&this.valid(state)){
                    state.through=null;state.busy=false;await this.load(state);
                    if(this.valid(state)&&state.through)state.status.textContent='消息快照已更新，请再次点击全部已读。';
                }else this.error(state,error);
            }
            finally{if(this.valid(state)){state.busy=false;this.controls(state);}}
        }
        close(){
            const state=this.state;this.state=null;
            if(state){this.client.cancelRequests();++this.summaryVersion;state.panel.close();state.panel.remove();}
            this.entry?.focus();
        }
        reset(block=false){
            const key=Client.supported(this.session())?JSON.stringify(this.session()):'';
            this.close();this.client.clear();++this.summaryVersion;
            this.entry?.remove();this.entry=null;this.sessionKey='';this.unread=0;this.lastSummary=0;
            this.blockedKey=block?key:null;
        }
        destroy(){this.reset();}
    }
    window.TigerestCommunityMessages=CommunityMessages;
})();
