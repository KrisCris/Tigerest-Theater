// Avatar work has its own lifecycle: accepting a comment never depends on an image upload.
(function(){
    'use strict';
    const abort=()=>Object.assign(new Error('请求已取消'),{name:'AbortError'});
    const validSnapshot=value=>value && (value.hash===null && value.imageBase64===null ||
        /^[0-9a-f]{64}$/.test(value.hash||'') && typeof value.imageBase64==='string' && value.imageBase64.length>0 &&
        value.imageBase64.length<=349528 && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value.imageBase64));
    const failureMessages={
        AVATAR_INVALID:'头像格式不符合要求，下次发言时将重新读取。',
        AVATAR_HASH_MISMATCH:'头像校验失败，下次发言时将重新读取。',
        BODY_TOO_LARGE:'头像超过大小限制，下次发言时将重新读取。',
        UNSUPPORTED_MEDIA_TYPE:'头像上传格式不受支持，请更新客户端。',
        AVATAR_SOURCE_MANAGED:'此账号的头像由大河服务同步。'
    };
    class CommunityAvatar {
        constructor({session,sourceAvatar,now=Date.now}){
            Object.assign(this,{session,sourceAvatar,now});this.listeners=new Set();this.controllers=new Set();this.generation=0;this.version=0;
            this.status={message:'',retryable:false,busy:false,retryAt:0};
        }
        subscribe(listener){this.listeners.add(listener);return()=>this.listeners.delete(listener);}
        emit(author){if(author)this.version++;for(const listener of this.listeners){try{listener({status:this.status,author});}catch(_){}}}
        setStatus(message='',retryable=false,busy=false){this.status={message,retryable,busy,retryAt:this.retryAt||0};this.emit();}
        binding(){return JSON.stringify([this.generation,this.session.generation,this.session.fingerprint,this.session.tokens?.author?.id]);}
        current(binding){return binding===this.binding();}
        enabled(){const p=this.session.caps?.avatarPolicy;return p?.sync==='sha256-on-comment' && p.mimeType==='image/png' && p.maxBytes===262144 && p.maxWidth===128 && p.maxHeight===128 && p.uploadBodyMaxBytes===393216;}
        clear(){
            this.generation++;for(const controller of this.controllers)controller.abort();this.controllers.clear();
            this.pending=null;this.task=null;this.flight=null;this.author=null;this.retryAt=0;this.setStatus();
        }
        async prepare(attempt){
            await this.session.ready();
            if(!this.enabled()||this.session.trusted())return;
            const binding=this.binding(),controller=new AbortController();this.controllers.add(controller);
            let snapshot;
            try{snapshot=await this.sourceAvatar?.({...this.session.emby},{signal:controller.signal});}
            catch(_){/* Unknown source keeps the existing central avatar. */}
            finally{this.controllers.delete(controller);}
            if(!this.current(binding)||controller.signal.aborted)throw abort();
            // A lost comment response may already have committed the first snapshot.
            // Recheck the source, but freeze the original payload and UUID for that retry.
            if(!attempt.avatar){
                attempt.avatar={binding,snapshot:validSnapshot(snapshot)?Object.freeze({hash:snapshot.hash,imageBase64:snapshot.imageBase64}):undefined};
                if(attempt.avatar.snapshot!==undefined)attempt.payload.avatarHash=attempt.avatar.snapshot.hash;
            }
            if(!this.current(attempt.avatar.binding))throw abort();
        }
        sent(result,attempt){
            const state=attempt.avatar,sync=result?.avatarSync;
            if(!state||!this.current(state.binding)||state.snapshot===undefined||!this.enabled()||this.session.trusted())return;
            // Every accepted new source supersedes an older retry, even when already in sync.
            this.task?.controller?.abort();this.task=null;this.pending=null;
            if(sync?.required!==true){this.setStatus();return;}
            if(!Number.isSafeInteger(sync.expectedRevision)||sync.expectedRevision<0)return;
            this.task=this.pending={binding:state.binding,body:Object.freeze({expectedRevision:sync.expectedRevision,...state.snapshot}),author:{...this.session.tokens.author}};
            this.flight=null;this.retry();
        }
        retry(){
            const task=this.pending;
            if(!task||!this.current(task.binding))return Promise.resolve();
            if(this.flight)return this.flight;
            if(this.now()<(this.retryAt||0)){
                this.setStatus('评论已发送；头像同步需等待 '+Math.ceil((this.retryAt-this.now())/1000)+' 秒后重试。',true);return Promise.resolve();
            }
            const work=this.upload(task);this.flight=work;
            work.finally(()=>{if(this.flight===work)this.flight=null;});return work;
        }
        async upload(task){
            const controller=new AbortController();task.controller=controller;this.controllers.add(controller);
            const current=()=>this.pending===task&&this.current(task.binding)&&!controller.signal.aborted;
            this.setStatus('评论已发送，正在同步头像…',false,true);
            try{
                const result=await this.session.request('/me/avatar',{method:'PUT',body:task.body,signal:controller.signal});
                if(!current())return;
                this.author={...task.author,avatarPath:result.avatarPath||null};this.pending=null;this.retryAt=0;
                this.setStatus('评论已发送，头像已同步。');this.emit(this.author);
            }catch(error){
                if(!current())return;
                if(error.status===409){
                    this.pending=null;this.setStatus('评论已发送；头像已在其他设备更新。');
                    try{
                        const me=await this.session.request('/me',{signal:controller.signal});
                        if(this.task===task&&this.current(task.binding)&&!controller.signal.aborted){this.author=me.author;this.emit(this.author);}
                    }catch(_){/* Keep the prior image if the profile refresh also fails. */}
                    return;
                }
                if(error.status===429){
                    this.retryAt=this.now()+Math.max(1,error.retryAfter||3)*1000;
                    this.setStatus('评论已发送；头像同步过于频繁，请等待 '+Math.max(1,error.retryAfter||3)+' 秒后重试。',true);return;
                }
                const retryable=!error.status||error.status>=500;
                if(!retryable)this.pending=null;
                this.setStatus('评论已发送；'+(failureMessages[error.code]||'头像暂未同步，原头像仍保留。'),retryable);
            }finally{this.controllers.delete(controller);}
        }
    }
    class AvatarView {
        constructor({client,valid=()=>true,coordinator}){
            Object.assign(this,{client,valid,coordinator});this.generation=0;this.cache=new Map();this.nodes=new Map();this.urls=new Set();this.controllers=new Set();this.beginRead();
        }
        beginRead(){this.readVersion=this.coordinator?.version||0;}
        clear(){
            this.generation++;for(const controller of this.controllers)controller.abort();this.controllers.clear();
            for(const url of this.urls)URL.revokeObjectURL(url);this.urls.clear();this.cache.clear();this.nodes.clear();
        }
        render(author={}){
            if(this.coordinator?.version>this.readVersion&&this.coordinator.author?.id===author.id)author={...author,...this.coordinator.author};
            const holder=document.createElement('span');holder.className='tc-avatar';holder.setAttribute('aria-hidden','true');
            holder.style.cssText='width:36px;height:36px;border-radius:50%;background:#2c4d72;color:white;display:inline-flex;align-items:center;justify-content:center;overflow:hidden;flex-shrink:0';
            this.nodes.set(holder,{...author});this.paint(holder,author);return holder;
        }
        update(author){
            if(!author?.id)return;
            for(const [holder,old]of this.nodes){if(old.id===author.id){const next={...old,...author};this.nodes.set(holder,next);this.paint(holder,next);}}
        }
        paint(holder,author){
            holder.textContent=Array.from(author.name||'?')[0];const generation=this.generation,path=author.avatarPath;
            if(!path)return;
            if(!this.cache.has(path)){
                const controller=new AbortController();this.controllers.add(controller);
                const load=this.client.avatar(path,{signal:controller.signal}).then(blob=>{
                    if(generation!==this.generation||!this.valid()||controller.signal.aborted)return null;
                    const url=URL.createObjectURL(blob);this.urls.add(url);return url;
                }).catch(()=>null).finally(()=>this.controllers.delete(controller));
                this.cache.set(path,load);
            }
            this.cache.get(path).then(url=>{
                if(!url||generation!==this.generation||!this.valid()||this.nodes.get(holder)?.avatarPath!==path)return;
                const image=document.createElement('img');image.alt='';image.style.cssText='width:100%;height:100%;object-fit:cover';
                image.addEventListener('error',()=>{
                    if(generation===this.generation&&this.valid()&&this.nodes.get(holder)?.avatarPath===path)holder.textContent=Array.from(author.name||'?')[0];
                },{once:true});
                image.src=url;holder.replaceChildren(image);
            });
        }
    }
    window.TigerestCommunityAvatar=CommunityAvatar;window.TigerestCommunityAvatarView=AvatarView;
})();
