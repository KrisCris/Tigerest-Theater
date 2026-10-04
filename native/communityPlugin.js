(function () {
    'use strict';
    const Client = window.TigerestCommunityClient;
    const styleId = 'tigerest-community-style';
    function node(tag, text, className) {
        const element = document.createElement(tag);
        if (text != null) element.textContent = String(text);
        if (className) element.className = className;
        return element;
    }
    function button(text, action) {
        const element = node('button', text, 'tc-button');
        element.type = 'button';
        element.addEventListener('click', action);
        return element;
    }
    function time(value) {
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? '' : date.toLocaleString();
    }
    function installStyle() {
        if (document.getElementById(styleId)) return;
        const style = node('style');
        style.id = styleId;
        style.textContent = `
        #tigerest-community{padding:24px clamp(16px,4vw,48px);color:inherit;max-width:1200px;box-sizing:border-box;width:100%;align-self:center}
        #tigerest-community h2{font-size:24px;margin:0 0 16px}#tigerest-community h3{font-size:18px;margin:12px 0}
        #tigerest-community .tc-toolbar,#tigerest-community .tc-actions{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin:12px 0}
        #tigerest-community .tc-button{font:inherit;color:inherit;background:rgba(127,145,170,.15);border:1px solid rgba(127,145,170,.35);border-radius:8px;padding:8px 14px;cursor:pointer}
        #tigerest-community .tc-button:hover{background:rgba(77,155,235,.3)}#tigerest-community .tc-button:focus-visible,#tigerest-community textarea:focus-visible,#tigerest-community select:focus-visible{outline:2px solid #65b8ff;outline-offset:3px}
        #tigerest-community .tc-button[aria-pressed=true]{background:#24649d;color:white;border-color:#65b8ff}
        #tigerest-community button:disabled{opacity:.45;cursor:default}
        #tigerest-community textarea{box-sizing:border-box;width:100%;min-height:96px;resize:vertical;background:rgba(127,145,170,.08);color:inherit;border:1px solid rgba(127,145,170,.45);border-radius:10px;padding:12px;font:inherit}
        #tigerest-community .tc-muted{opacity:.72;font-size:14px}#tigerest-community .tc-status{min-height:24px;margin:8px 0;white-space:pre-wrap}
        #tigerest-community .tc-card{border-top:1px solid rgba(127,145,170,.22);padding:20px 0}
        #tigerest-community .tc-highlight{outline:2px solid #72c6ff;outline-offset:6px;border-radius:6px;background:rgba(77,155,235,.08)}
        #tigerest-community .tc-header{display:flex;gap:10px;align-items:center}#tigerest-community .tc-avatar{width:36px;height:36px;border-radius:50%;background:#2c4d72;color:white;display:flex;align-items:center;justify-content:center;overflow:hidden;flex-shrink:0}
        #tigerest-community .tc-avatar img{width:100%;height:100%;object-fit:cover}
        #tigerest-community .tc-body{white-space:pre-wrap;overflow-wrap:anywhere;margin:12px 0;line-height:1.65}
        #tigerest-community .tc-replies{margin:12px 0 0 20px;padding-left:16px;border-left:2px solid rgba(127,145,170,.3)}
        #tigerest-community .tc-replies .tc-card{padding:12px 0}#tigerest-community .tc-dialog,#tigerest-community .tc-management{padding:16px;background:rgba(127,145,170,.1);border-radius:10px;margin:12px 0}
        #tigerest-community select{font:inherit;color:inherit;background:#243344;padding:8px;border:1px solid #678;border-radius:6px}
        @media(max-width:600px){#tigerest-community{padding:20px 14px}#tigerest-community .tc-replies{margin-left:8px;padding-left:10px}}
        `;
        (document.head || document.documentElement).appendChild(style);
    }
    class CommunityPlugin {
        constructor({connectionManager, events, appRouter}) {
            this.connectionManager = connectionManager;
            this.events = events;
            this.client = new Client();
            this.appRouter=appRouter;
            this.messages=window.TigerestCommunityMessages?new window.TigerestCommunityMessages({
                connectionManager,openDiscussion:message=>this.openDiscussion(message)}):null;
            this.epoch = 0;
            this.itemShow = event => this.onItem(event);
            this.viewShow = event => this.onView(event);
            this.hideView = event => {
                const view=this.state?.view || this.metadataView;
                if (view && (event.target === view || event.target.contains?.(view))) this.close();
            };
            this.sessionChanged = () => {this.close();this.pendingFocus=null;this.messages?.reset(true);};
            this.signedIn = () => {this.close();this.pendingFocus=null;this.messages?.reset();this.messages?.sync();};
            document.addEventListener('itemshow', this.itemShow);
            document.addEventListener('viewshow', this.viewShow);
            document.addEventListener('viewbeforehide', this.hideView);
            events?.on(connectionManager, 'localusersignedout', this.sessionChanged);
            events?.on(connectionManager, 'localusersignedin', this.signedIn);
            this.poll = setInterval(() => {
                if (this.state && !this.valid(this.state)) this.close();
                this.messages?.sync();
            }, 500);
            // Logout starts a network operation: clear drafts before it finishes.
            this.reset = this.sessionChanged;
            window.TigerestCommunityReset = this.reset;
            this.messages?.sync();
        }
        session() { return Client.session(this.connectionManager.currentApiClient?.()); }
        async openDiscussion(message) {
            const session=this.session(),location=message.location;
            if(!Client.supported(session)||message.availability==='unavailable'||!location?.itemId||
                location.embyServerId!==session.serverId||!this.appRouter?.show)throw new Error('无法打开讨论');
            const focus={itemId:String(location.itemId),scope:location.scope,topicId:location.topicId,
                rootId:location.canNavigate?location.rootId:null,commentId:location.canNavigate?location.commentId:null,
                sessionKey:JSON.stringify(session)};
            this.pendingFocus=focus;
            if(this.state?.item.Id===focus.itemId && this.valid(this.state)){
                this.state.scope=focus.scope==='episode'&&this.state.item.Type==='Episode'?'episode':'work';
                this.state.focus=focus;this.pendingFocus=null;await this.load(this.state);return;
            }
            try {await this.appRouter.show('/item?id='+encodeURIComponent(focus.itemId)+'&serverId='+encodeURIComponent(session.serverId));}
            catch(error){if(this.pendingFocus===focus)this.pendingFocus=null;throw error;}
        }
        valid(state) {
            if (this.state !== state) return false;
            const session = this.session();
            return Client.supported(session) && state.sessionKey === JSON.stringify(session);
        }
        async onView(event) {
            const view=event.target.closest?.('.itemView') || event.target.querySelector?.('.itemView');
            const id=event.detail?.params?.id;
            if(!view || !id || String(id).startsWith('local'))return;
            if(this.state?.view===view && this.state.item.Id===id && this.valid(this.state))return;
            this.close();
            const api=this.connectionManager.currentApiClient?.();
            const session=this.session();
            if(!Client.supported(session))return;
            const epoch=this.epoch;
            const controller=new AbortController();this.metadataController=controller;this.metadataView=view;
            const signal=event.detail?.currentResumeSignal || event.detail?.signal;
            signal?.addEventListener('abort',()=>controller.abort(),{once:true});
            if(signal?.aborted)controller.abort();
            try {
                const item=await api.getItem(session.userId,id,{},controller.signal);
                if(controller.signal.aborted || epoch!==this.epoch || JSON.stringify(this.session())!==JSON.stringify(session))return;
                this.onItem({target:view,detail:{item,signal}});
            }catch(_){/* Detail metadata errors must not interrupt Emby navigation. */}
        }
        onItem(event) {
            const item = event.detail?.item;
            const view = event.target.closest?.('.itemView') || event.target;
            this.close();
            if (!item?.Id || !['Movie','Series','Season','Episode'].includes(item.Type)) return;
            const session = this.session();
            if (!this.client.setContext(session, item.Id)) return;
            installStyle();
            const panel = node('section');
            panel.id = 'tigerest-community';
            panel.setAttribute('aria-label', '评论区');
            const state = {panel, view, item, sessionKey:JSON.stringify(session), scope:item.Type==='Episode'?'episode':'work',
                avatars:new Map(), urls:new Set(), rootIds:new Set(), version:0, reply:null, busy:false};
            this.state = state;
            if(this.pendingFocus?.itemId===String(item.Id)&&this.pendingFocus.sessionKey===state.sessionKey){
                state.focus=this.pendingFocus;this.pendingFocus=null;
                state.scope=state.focus.scope==='episode'&&item.Type==='Episode'?'episode':'work';
            }
            event.detail?.signal?.addEventListener('abort', () => {if (this.state===state) this.close();}, {once:true});
            if (event.detail?.signal?.aborted) {this.close();return;}
            panel.appendChild(node('h2', '评论区'));
            const toolbar = node('div', null, 'tc-toolbar');
            state.tabs = [];
            const scopes = item.Type==='Episode' ? [['episode','本集评论'],['work','作品评论']] : [['work','作品评论']];
            for (const [scope, label] of scopes) {
                const tab = button(label, () => {
                    if (!this.valid(state) || state.busy || state.scope===scope) return;
                    this.client.cancelRequests();
                    state.scope=scope;state.focus=null;
                    state.input.value='';state.reply=null;state.dialog.replaceChildren();
                    this.updateComposer(state);this.load(state);
                });
                tab.dataset.scope=scope;toolbar.appendChild(tab);state.tabs.push(tab);
            }
            state.refresh = button('刷新评论', () => this.load(state));
            toolbar.appendChild(state.refresh);panel.appendChild(toolbar);
            state.topicLabel = node('div', '正在加载…', 'tc-muted');panel.appendChild(state.topicLabel);
            state.status = node('div', '', 'tc-status');state.status.setAttribute('role','status');state.status.setAttribute('aria-live','polite');panel.appendChild(state.status);
            state.dialog = node('div');panel.appendChild(state.dialog);
            state.composer = node('form');
            state.replyLabel = node('div', '', 'tc-muted');state.composer.appendChild(state.replyLabel);
            state.cancelReply = button('取消回复', () => {state.reply=null;this.updateComposer(state);});state.composer.appendChild(state.cancelReply);
            state.input = node('textarea');state.input.placeholder='说说你的看法（最多 2000 字）';state.input.setAttribute('aria-label','评论内容');
            state.input.addEventListener('input',()=>this.updateComposer(state));state.composer.appendChild(state.input);
            const footer=node('div',null,'tc-toolbar');
            state.send=button('发表评论',()=>this.submit(state));footer.appendChild(state.send);
            state.counter=node('span','0 / 2000','tc-muted');footer.appendChild(state.counter);state.composer.appendChild(footer);
            state.composer.addEventListener('submit',e=>{e.preventDefault();this.submit(state);});
            panel.appendChild(state.composer);
            state.list=node('div');panel.appendChild(state.list);
            state.more=button('加载更多评论',()=>this.loadMore(state));panel.appendChild(state.more);state.more.hidden=true;
            state.management=node('div');panel.appendChild(state.management);
            (view.querySelector('.itemMainScrollSlider') || view.querySelector('.scrollSlider') || view).appendChild(panel);
            this.load(state);
        }
        async load(state) {
            if (!this.valid(state) || state.busy) return;
            const version=++state.version;
            const focus=state.focus;state.focus=null;
            state.loading=true;state.me=null;state.topic=null;state.cursor=null;state.rootIds.clear();
            state.list.replaceChildren();state.more.hidden=true;
            state.status.textContent='正在加载评论…';
            for(const tab of state.tabs) tab.setAttribute('aria-pressed',String(tab.dataset.scope===state.scope));
            this.updateComposer(state);
            try {
                const me=await this.client.me();
                if(!this.valid(state)||version!==state.version)return;
                state.me=me;
                this.adminButton(state);
                const topic=await this.client.resolve(state.scope);
                if(!this.valid(state)||version!==state.version)return;
                state.topic=topic;
                state.topicLabel.textContent=(state.scope==='episode'?'当前发言对象：本集 · ':'当前发言对象：作品 · ')+(topic.title||state.item.Name||'');
                const anchor=focus?.topicId===topic.id?focus.rootId:null;
                let data,missing=false;
                try{data=await this.client.comments(topic.id,null,anchor);}
                catch(error){
                    if(!anchor||error.status!==404)throw error;
                    if(!this.valid(state)||version!==state.version)return;
                    missing=true;data=await this.client.comments(topic.id);
                }
                if(!this.valid(state)||version!==state.version)return;
                this.appendRoots(state,data);
                state.status.textContent=me.muted?'你已被禁言，可浏览评论和删除自己的评论。':('以 '+me.author.name+' 的身份发言');
                if(anchor&&!missing){await this.focusComment(state,version,focus,data);if(!this.valid(state)||version!==state.version)return;}
                if(missing||(focus?.commentId&&!anchor))state.status.textContent='目标评论已不可用，已显示当前讨论。';
            } catch(error) {if(version===state.version)this.showError(state,error);}
            finally {if(this.valid(state)&&version===state.version){state.loading=false;this.updateComposer(state);}}
        }
        updateComposer(state) {
            const length=Array.from(state.input.value.trim()).length;
            state.counter.textContent=length+' / 2000';
            state.input.disabled=Boolean(!state.me || state.me.muted || state.loading || state.busy);
            state.send.disabled=state.input.disabled || !state.topic || length<1 || length>2000;
            state.send.textContent=state.reply?'发送回复':'发表评论';
            state.cancelReply.hidden=!state.reply;
            state.replyLabel.textContent=state.reply?'正在回复 @'+state.reply.author.name:'';
            state.refresh.disabled=Boolean(state.loading||state.busy);
            for(const tab of state.tabs)tab.disabled=Boolean(state.busy);
        }
        async focusComment(state,version,focus,data) {
            const root=data.items?.find(comment=>comment.id===focus.rootId);
            if(!root)return;
            if(focus.commentId!==focus.rootId){
                let replies;
                try{replies=await this.client.replies(focus.rootId,null,focus.commentId);}
                catch(error){
                    if(error.status!==404)throw error;
                    if(this.valid(state)&&version===state.version)state.status.textContent='目标回复已不可用，已显示当前讨论。';
                    return;
                }
                if(!this.valid(state)||version!==state.version)return;
                root.replies=replies.items||[];root.repliesNextCursor=replies.nextCursor;
            }
            const existing=Array.from(state.list.children).find(row=>row.dataset.commentId===root.id);
            const card=this.card(state,root);
            if(existing)existing.replaceWith(card);
            else {state.list.querySelector('.tc-empty')?.remove();state.rootIds.add(root.id);state.list.prepend(card);}
            const target=focus.commentId===root.id?card:Array.from(card.querySelectorAll('[data-comment-id]')).find(row=>row.dataset.commentId===focus.commentId);
            if(!target){state.status.textContent='目标评论已不可用，已显示当前讨论。';return;}
            target.classList.add('tc-highlight');target.tabIndex=-1;target.focus({preventScroll:true});
            target.scrollIntoView({block:'center',behavior:'smooth'});
        }
        showError(state,error) {
            if(this.state!==state||error.name==='AbortError')return;
            state.status.textContent=error.message+(error.requestId?'（请求编号：'+error.requestId+'）':'');
            if(error.status===401){state.me=null;state.input.value='';state.reply=null;state.list.replaceChildren();state.management.replaceChildren();this.updateComposer(state);}
        }
        async submit(state) {
            if(!this.valid(state)||state.send.disabled||state.busy)return;
            state.busy=true;this.updateComposer(state);
            let sent=false, deletedError=null;
            try {await this.client.send(state.topic.id,state.input.value,state.reply);
                if(!this.valid(state))return;
                state.input.value='';state.reply=null;sent=true;
            } catch(error) {
                this.showError(state,error);
                if(error.code==='TARGET_DELETED'){state.reply=null;deletedError=error;}
                if(error.code==='USER_MUTED'){
                    try {state.me=await this.client.me();}catch(_){}
                }
            } finally {if(this.valid(state)){state.busy=false;this.updateComposer(state);}}
            if(sent){await this.load(state);this.messages?.refreshSummary();}
            else if(deletedError){await this.load(state);this.showError(state,deletedError);}
        }
        appendRoots(state,data) {
            for(const comment of data.items || []) {
                if(state.rootIds.has(comment.id))continue;
                state.rootIds.add(comment.id);
                state.list.appendChild(this.card(state,comment));
            }
            if(!state.rootIds.size)state.list.appendChild(node('p','暂无评论，来聊聊这部作品吧。','tc-empty tc-muted'));
            state.cursor=data.nextCursor;state.more.hidden=!state.cursor;
        }
        async loadMore(state) {
            if(!this.valid(state)||state.more.disabled||!state.cursor)return;
            const version=state.version;state.more.disabled=true;
            try {const data=await this.client.comments(state.topic.id,state.cursor);
                if(this.valid(state)&&version===state.version)this.appendRoots(state,data);
            }catch(error){this.showError(state,error);}
            finally {state.more.disabled=false;}
        }
        avatar(state,author) {
            const holder=node('span',(author.name||'?').slice(0,1),'tc-avatar');holder.setAttribute('aria-hidden','true');
            if(!author.avatarPath)return holder;
            if(!state.avatars.has(author.avatarPath)) {
                state.avatars.set(author.avatarPath,this.client.avatar(author.avatarPath).then(blob=>{
                    if(!this.valid(state))return null;
                    const url=URL.createObjectURL(blob);state.urls.add(url);return url;
                }).catch(()=>null));
            }
            state.avatars.get(author.avatarPath).then(url=>{
                if(!url||!this.valid(state))return;
                const image=node('img');image.alt='';image.src=url;
                image.addEventListener('error',()=>holder.replaceChildren(node('span',(author.name||'?').slice(0,1))),{once:true});
                holder.replaceChildren(image);
            });
            return holder;
        }
        card(state,comment,isReply=false) {
            const card=node('article',null,'tc-card');card.dataset.commentId=comment.id;
            const header=node('div',null,'tc-header');header.appendChild(this.avatar(state,comment.author));
            const names=node('div');names.appendChild(node('strong',comment.author.name));names.appendChild(node('div',time(comment.createdAt),'tc-muted'));header.appendChild(names);card.appendChild(header);
            const text=comment.state==='visible'?(comment.replyToAuthor?'回复 @'+comment.replyToAuthor.name+'：\n':'')+(comment.body||''):'评论已删除';
            card.appendChild(node('div',text,'tc-body'));
            const actions=node('div',null,'tc-actions');
            if(comment.permissions?.canReply)actions.appendChild(button('回复',()=>{
                if(!this.valid(state)||state.busy||state.me?.muted)return;
                state.reply=comment;this.updateComposer(state);state.input.focus();state.composer.scrollIntoView({block:'nearest',behavior:'smooth'});
            }));
            if(comment.permissions?.canDelete)actions.appendChild(button('删除',()=>this.deleteDialog(state,comment,false)));
            if(state.me?.isCommentAdmin){
                if(comment.permissions?.canModerate)actions.appendChild(button('管理删除',()=>this.deleteDialog(state,comment,true)));
                actions.appendChild(button('禁言',()=>this.muteDialog(state,comment.author)));
            }
            card.appendChild(actions);
            if(!isReply) {
                const replies=node('div',null,'tc-replies');const ids=new Set();
                const append=items=>{for(const reply of items || []){if(ids.has(reply.id))continue;ids.add(reply.id);replies.appendChild(this.card(state,reply,true));}};
                append(comment.replies);
                let cursor=comment.repliesNextCursor;
                const more=button('加载更多回复',async()=>{
                    if(!this.valid(state)||more.disabled)return;
                    const version=state.version;more.disabled=true;
                    try {const data=await this.client.replies(comment.id,cursor);
                        if(this.valid(state)&&version===state.version){append(data.items);cursor=data.nextCursor;more.hidden=!cursor;}
                    }catch(error){this.showError(state,error);}
                    finally {more.disabled=false;}
                });
                more.hidden=!cursor;card.appendChild(replies);card.appendChild(more);
            }
            return card;
        }
        dialog(state,title) {
            if(!this.valid(state)||state.busy)return null;
            const box=node('div',null,'tc-dialog');box.setAttribute('role','group');box.setAttribute('aria-label',title);box.appendChild(node('h3',title));
            state.dialog.replaceChildren(box);box.scrollIntoView({block:'nearest',behavior:'smooth'});return box;
        }
        async mutation(state,operation,refresh=true) {
            if(!this.valid(state)||state.busy)return;
            state.busy=true;this.updateComposer(state);
            let success=false;
            try {await operation();if(!this.valid(state))return;state.dialog.replaceChildren();state.status.textContent='操作完成';success=true;}
            catch(error){this.showError(state,error);}
            finally {if(this.valid(state)){state.busy=false;this.updateComposer(state);}}
            if(success&&refresh){state.reply=null;await this.load(state);}
            return success;
        }
        deleteDialog(state,comment,admin) {
            const box=this.dialog(state,admin?'管理员删除评论':'删除这条评论？');if(!box)return;
            let scope=null,reason=null;
            if(admin){
                scope=node('select');scope.setAttribute('aria-label','删除范围');
                scope.appendChild(new Option('仅此评论','single'));
                if(!comment.rootId)scope.appendChild(new Option('整条讨论（含所有回复）','thread'));
                box.appendChild(scope);reason=node('textarea');reason.placeholder='删除原因（1–200 字）';reason.setAttribute('aria-label','删除原因');box.appendChild(reason);
            }else box.appendChild(node('p','删除后正文将清除；已有回复会保留。'));
            box.appendChild(button('确认删除',()=>{
                if(admin&&!this.reason(state,reason.value))return;
                return this.mutation(state,()=>admin?this.client.moderate(comment.id,scope.value,reason.value.trim()):this.client.remove(comment.id));
            }));box.appendChild(button('取消',()=>state.dialog.replaceChildren()));
        }
        reason(state,value) {
            const length=Array.from(value.trim()).length;
            if(length<1||length>200){state.status.textContent='请输入 1–200 字的操作原因。';return false;}return true;
        }
        muteDialog(state,author) {
            const box=this.dialog(state,'禁言 @'+author.name);if(!box)return;
            const duration=node('select');duration.setAttribute('aria-label','禁言时长');
            for(const [seconds,label] of [[3600,'1 小时'],[86400,'1 天'],[604800,'7 天'],[0,'永久']])duration.appendChild(new Option(label,String(seconds)));
            box.appendChild(duration);
            const reason=node('textarea');reason.placeholder='禁言原因（1–200 字）';reason.setAttribute('aria-label','禁言原因');box.appendChild(reason);
            box.appendChild(button('确认禁言',()=>{if(this.reason(state,reason.value))this.mutation(state,()=>this.client.mute(author.id,Number(duration.value),reason.value.trim()));}));
            box.appendChild(button('取消',()=>state.dialog.replaceChildren()));
        }
        adminButton(state) {
            if(state.admin)state.admin.remove();
            state.management.replaceChildren();
            if(!state.me.isCommentAdmin)return;
            state.admin=button('管理',()=>this.manage(state));state.refresh.parentElement.appendChild(state.admin);
        }
        async manage(state,kind='mutes') {
            if(!this.valid(state)||!state.me?.isCommentAdmin)return;
            state.management.replaceChildren();
            const box=node('div',null,'tc-management');state.management.appendChild(box);
            box.appendChild(node('h3','评论管理'));
            const toolbar=node('div',null,'tc-toolbar');box.appendChild(toolbar);
            toolbar.appendChild(button('禁言列表',()=>this.manage(state,'mutes')));toolbar.appendChild(button('管理记录',()=>this.manage(state,'actions')));
            const list=node('div');box.appendChild(list);
            const ids=new Set();let cursor=null;
            const more=button('加载更多记录',()=>load());box.appendChild(more);
            const load=async()=>{
                if(more.disabled||!this.valid(state))return;
                more.disabled=true;
                try {const data=await (kind==='mutes'?this.client.mutes(cursor):this.client.actions(cursor));
                    if(!this.valid(state)||!box.isConnected)return;
                    for(const record of data.items || []){
                        if(ids.has(record.id))continue;ids.add(record.id);
                        const row=node('div',null,'tc-card');
                        if(kind==='mutes'){
                            row.appendChild(node('strong',record.name));
                            row.appendChild(node('div',record.muteState==='permanent'?'永久禁言':(record.mutedUntil?'禁言至 '+time(record.mutedUntil):'禁言'),'tc-muted'));
                            row.appendChild(button('解除禁言',async()=>{if(await this.mutation(state,()=>this.client.unmute(record.id),false))this.manage(state,kind);}));
                        }else {
                            const labels={delete_single:'删除评论',delete_thread:'删除整条讨论',mute:'禁言',unmute:'解除禁言'};
                            row.appendChild(node('div',(labels[record.action]||record.action)+' · '+time(record.createdAt)));
                            row.appendChild(node('div',record.reason||'','tc-body'));
                            row.appendChild(node('div','操作人 '+record.actorId+' · 对象 '+record.targetId,'tc-muted'));
                        }
                        list.appendChild(row);
                    }
                    if(!ids.size)list.appendChild(node('p','暂无记录','tc-muted'));
                    cursor=data.nextCursor;more.hidden=!cursor;
                }catch(error){this.showError(state,error);}
                finally{more.disabled=false;}
            };
            await load();
        }
        close() {
            this.epoch++;
            this.metadataController?.abort();this.metadataController=null;this.metadataView=null;
            this.client.clear();
            if(this.state){for(const url of this.state.urls)URL.revokeObjectURL(url);this.state.panel.remove();}
            this.state=null;
        }
        destroy() {
            this.close();clearInterval(this.poll);
            this.messages?.destroy();
            document.removeEventListener('itemshow',this.itemShow);document.removeEventListener('viewbeforehide',this.hideView);
            document.removeEventListener('viewshow',this.viewShow);
            this.events?.off(this.connectionManager,'localusersignedout',this.sessionChanged);
            this.events?.off(this.connectionManager,'localusersignedin',this.signedIn);
            if(window.TigerestCommunityReset===this.reset)delete window.TigerestCommunityReset;
        }
    }
    window._communityPlugin=CommunityPlugin;
})();
