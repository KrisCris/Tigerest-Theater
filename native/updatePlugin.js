(function(global) {
    'use strict';
    if (global.TigerestUpdate) return;
    let api, started, state = {}, dialog, style, title, details, notes, progress, actions;
    let disposed = false, autoInstall = false, installInFlight = false, hiddenDuringDownload = false, revision = 0;
    function invoke(name, ...args) {
        return new Promise((resolve, reject) => {
            if (!api?.system?.[name]) { reject(new Error('此版本暂不支持更新操作')); return; }
            try {
                // Qt uses a callback; Android additionally returns a Promise.
                // Android's compatibility callback maps failures to false; its Promise is authoritative.
                let usesPromise = false;
                const result = api.system[name](...args, value => Promise.resolve().then(() => {
                    if (!usesPromise) resolve(value);
                }));
                if (result?.then) { usesPromise=true; result.then(resolve,reject); }
            } catch (error) { reject(error); }
        });
    }
    function element(tag, text) {
        const node = document.createElement(tag);
        if (text != null) node.textContent = text;
        return node;
    }
    function close() {
        if (state.status === 'available') {
            state = {...state, deferred:true};
            invoke('deferAppUpdate').catch(() => {});
        }
        hiddenDuringDownload = state.status === 'downloading';
        dialog?.close();
    }
    function create() {
        if (dialog) return;
        style = element('style');
        style.textContent = `
          #tigerest-update-dialog { box-sizing:border-box; width:min(520px,calc(100% - 32px)); max-height:calc(100dvh - 32px); overflow:auto; padding:26px; border:1px solid #514732; border-radius:18px; background:#13161d; color:#eceef2; box-shadow:0 22px 80px #0009; font:15px/1.6 system-ui,sans-serif; color-scheme:dark; }
          #tigerest-update-dialog::backdrop { background:#0008; }
          #tigerest-update-dialog h2 { margin:0 0 12px; font-size:22px; color:#ffc341; }
          #tigerest-update-dialog p { white-space:pre-wrap; overflow-wrap:anywhere; margin:10px 0; }
          #tigerest-update-dialog pre { font:inherit; white-space:pre-wrap; overflow-wrap:anywhere; max-height:28vh; overflow:auto; color:#adb3bf; border-top:1px solid #ffffff15; padding-top:12px; }
          #tigerest-update-dialog progress { width:100%; height:9px; accent-color:#ffba27; }
          #tigerest-update-dialog .tg-update-actions { display:flex; flex-wrap:wrap; gap:10px; margin-top:22px; }
          #tigerest-update-dialog button { font:inherit; min-height:44px; padding:9px 16px; border-radius:9px; border:1px solid #48505d; background:#242a35; color:#ecedf2; cursor:pointer; }
          #tigerest-update-dialog button:first-child { background:#ffba27; border-color:#ffba27; color:#17130a; font-weight:650; }
          #tigerest-update-dialog button:focus-visible { outline:2px solid #fff; outline-offset:3px; }
          #tigerest-update-dialog button:disabled { opacity:.5; cursor:wait; }
          @media(max-width:440px) { #tigerest-update-dialog { padding:20px; } #tigerest-update-dialog .tg-update-actions { gap:8px; } }
        `;
        document.head.appendChild(style);
        dialog = element('dialog'); dialog.id = 'tigerest-update-dialog';
        title = element('h2'); title.id = 'tigerest-update-title';
        dialog.setAttribute('aria-labelledby', title.id);
        details = element('p'); details.setAttribute('role','status');
        notes = element('pre');
        progress = element('progress'); progress.max = 100; progress.setAttribute('aria-label','更新下载进度');
        actions = element('div'); actions.className = 'tg-update-actions';
        dialog.append(title, details, progress, notes, actions); document.body.appendChild(dialog);
        dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
    }
    function button(label, action, work) {
        const node = element('button',label); node.type='button'; node.dataset.updateAction=action;
        node.addEventListener('click',async () => {
            node.disabled = true;
            try { await work(); }
            catch (error) { autoInstall=false; receive({...state,status:'error',manual:true,error:error.message || '更新操作失败，请重试'}); }
            finally { node.disabled=false; }
        });
        actions.appendChild(node);
    }
    function install(automatic) {
        if (installInFlight) return Promise.resolve();
        installInFlight=true;
        return invoke('installAppUpdate',automatic).finally(()=>{installInFlight=false;});
    }
    function render() {
        if (disposed || !document.body) return;
        const status = state.status;
        const show = status === 'available' ? !state.deferred :
            status === 'ready' || status === 'installing' || (state.manual && ['checking','current','error','downloading'].includes(status));
        if (!show || hiddenDuringDownload && status === 'downloading') return;
        create();
        title.textContent = ({available:'发现新版本',checking:'检查更新',downloading:'正在下载更新',ready:'更新已准备好',installing:'正在打开安装程序',current:'检查完成',error:'更新未完成'})[status] || '客户端更新';
        const version = state.version ? `当前版本 ${state.currentVersion || '—'} → ${state.version}` : `当前版本 ${state.currentVersion || '—'}`;
        const percent = state.size>0 ? Math.min(100,Math.max(0,Math.round((state.received||0)*100/state.size))) : 0;
        const message = status === 'current' ? '当前平台暂无可安装的新正式版。' :
            status === 'checking' ? '正在检查正式发布，请稍候…' :
            status === 'downloading' ? `已下载 ${percent}%${percent===100?'，正在校验…':''}` :
            status === 'installing' ? '请按系统提示完成更新。取消后可再次安装。' :
            status === 'available' ? `大小约 ${(Number(state.size||0)/1048576).toFixed(1)} MB。下载校验完成后将${state.installLabel || '打开安装程序'}。` : '';
        details.textContent = [version,message,state.error].filter(Boolean).join('\n');
        notes.textContent = String(state.notes || '').slice(0,20000);
        notes.hidden = !notes.textContent || ['checking','current','downloading'].includes(status);
        progress.hidden = status !== 'downloading'; progress.value=percent;
        actions.replaceChildren();
        if (status === 'available' || status === 'error' && state.version && state.size>0) {
            button(status==='error'?'重试下载':'立即更新','download',async()=>{autoInstall=true;hiddenDuringDownload=false;await invoke('downloadAppUpdate');});
        } else if (status === 'ready') {
            button(state.installLabel || '安装更新','install',()=>install(false));
        } else if (status === 'error') {
            button('重新检查','check',()=>check());
        }
        if (status === 'downloading') button('取消下载','cancel',()=>{autoInstall=false;return invoke('cancelAppUpdate');});
        if (status === 'available') button('跳过此版本','skip',async()=>{autoInstall=false;await invoke('skipAppUpdate');dialog.close();});
        button(status==='available'?'稍后':status==='downloading'?'后台下载':'关闭','close',close);
        if (!dialog.open) dialog.showModal();
    }
    function receive(next) {
        if (disposed || !next || typeof next !== 'object') return;
        revision++; state=next;
        if (state.status==='error') autoInstall=false;
        render();
        if (state.status==='ready' && !installInFlight && (autoInstall || state.installAfterDownload)) {
            autoInstall=false; hiddenDuringDownload=false;
            install(true).catch(error=>receive({...state,status:'error',manual:true,error:error.message}));
        }
    }
    function start() {
        if (started) return started;
        started = Promise.resolve().then(()=>global.apiPromise || global.api).then(async value=>{
            if (disposed || !value?.system?.appUpdateState) return;
            api=value; api.system.appUpdateChanged?.connect(receive);
            const seen=revision, initial=await invoke('appUpdateState');
            if (revision===seen) receive(initial);
            await invoke('checkForUpdates',false);
        }).catch(()=>{});
        return started;
    }
    async function check() {
        await start(); hiddenDuringDownload=false; autoInstall=false;
        receive({...state,status:'checking',manual:true,deferred:false,error:''});
        try { await invoke('checkForUpdates',true); }
        catch(error) { receive({...state,status:'error',version:'',size:0,notes:'',error:error.message || '无法检查更新，请重试'}); }
    }
    function destroy() {
        disposed=true;autoInstall=false;api?.system?.appUpdateChanged?.disconnect(receive);
        dialog?.remove();style?.remove();document.removeEventListener('DOMContentLoaded',render);
    }
    global.TigerestUpdate={start,check,close,destroy};
    global._updatePlugin=class { constructor() { this.name='Update Plugin';this.type='input';this.id='updatePlugin';start(); } };
    document.addEventListener('DOMContentLoaded',render,{once:true});
    global.addEventListener('pagehide',destroy,{once:true});
    start();
})(window);
