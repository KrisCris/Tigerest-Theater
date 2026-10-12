(function(){
    'use strict';
    class CommunityBridge {
        constructor(system){
            this.system=system;this.pending=new Map();this.sequence=0;this.prefix=Date.now().toString(36)+'-';
            system.communityResponse.connect((id,result)=>this.pending.get(id)?.finish(result));
            this.store={read:async key=>{const r=await this.call('communityCredential','read',key,'');if(!r?.ok)throw Error('安全存储不可用');return r.value||null;},
                write:async(key,value)=>(await this.call('communityCredential','write',key,value))?.ok===true,
                remove:async key=>(await this.call('communityCredential','remove',key,''))?.ok===true};
            this.transport=this.transport.bind(this);
        }
        call(method,...args){
            return new Promise((resolve,reject)=>{
                let done=false;const timer=setTimeout(()=>finish(null,new Error('原生请求超时')),20000);
                const finish=(value,error)=>{if(done)return;done=true;clearTimeout(timer);error?reject(error):resolve(value);};
                try{const result=this.system[method](...args,value=>finish(value));if(result?.then)result.then(v=>finish(v),()=>finish(null,new Error('原生请求失败')));}catch(_){finish(null,new Error('原生功能不可用'));}
            });
        }
        transport(path,{method='GET',headers={},body,signal,responseType='json'}={}){
            return this.request('communityRequest',{path,method,headers,body:body??'',responseType},signal);
        }
        async sourceAvatar(emby,{signal}={}){
            try{
                const result=await this.request('communitySourceAvatar',{...emby},signal);
                const snapshot=typeof result?.body==='string'?JSON.parse(result.body):result?.body;
                if(result?.status!==200 || !snapshot)return undefined;
                if(snapshot.hash===null && snapshot.imageBase64===null)return Object.freeze({hash:null,imageBase64:null});
                if(/^[a-f0-9]{64}$/.test(snapshot.hash||'') && typeof snapshot.imageBase64==='string' && snapshot.imageBase64.length>0 && snapshot.imageBase64.length<=349528 && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(snapshot.imageBase64))return Object.freeze({hash:snapshot.hash,imageBase64:snapshot.imageBase64});
            }catch(error){if(error?.name==='AbortError')throw error;}
            return undefined;
        }
        request(method,payload,signal){
            return new Promise((resolve,reject)=>{
                const id=this.prefix+(++this.sequence);let timer;
                const cancel=()=>{this.system.communityCancel(id);finish(null,Object.assign(new Error('请求已取消'),{name:'AbortError'}));};
                const finish=(result,error)=>{if(!this.pending.delete(id))return;clearTimeout(timer);signal?.removeEventListener('abort',cancel);error?reject(error):result?.error?reject(new Error('公共评论网络连接失败')):resolve(result);};
                this.pending.set(id,{finish});signal?.addEventListener('abort',cancel,{once:true});
                if(signal?.aborted){cancel();return;}
                timer=setTimeout(()=>{if(method==='communitySourceAvatar'){this.system.communityCancel(id);finish(null,new Error('头像读取超时'));}else cancel();},17000);
                try{const pending=this.system[method](id,payload);pending?.catch?.(()=>finish(null,new Error('原生请求失败')));}catch(_){finish(null,new Error('原生功能不可用'));}
            });
        }
        setEmby(session){return this.call('communitySetEmbySession',session||{});}
    }
    window.TigerestCommunityBridge=CommunityBridge;
})();
