'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {test}=require('node:test');
class Signal {
    handlers=new Set();
    connect(fn){this.handlers.add(fn);}
    disconnect(fn){this.handlers.delete(fn);}
    emit(value){for(const fn of this.handlers)fn(value);}
}
class Element {
    constructor(tag,className,text){this.tag=tag;this.className=className||'';this.textContent=text||'';this.children=[];this.listeners=new Map();this.style={};this.dataset={};}
    appendChild(child){this.children.push(child);return child;}
    append(...children){children.forEach(child=>this.appendChild(child));}
    addEventListener(name,fn){this.listeners.set(name,fn);}
    async emit(name){if(!this.disabled)return this.listeners.get(name)?.({target:this});}
    all(){return [this,...this.children.flatMap(child=>child.all())];}
}
const source=fs.readFileSync(path.join(__dirname,'../native/nativeshell.js'),'utf8');
const start=source.indexOf('function createRifeExtensionPanel(');
const end=source.indexOf('async function mountTigerestSettings(',start);
const settle=()=>new Promise(resolve=>setImmediate(resolve));
function panel(initial={}){
    assert.ok(start>=0,'Windows extension panel must exist in shipped settings code');
    const calls=[],timers=new Map();let status={state:'notInstalled',busy:false,packages:[{id:'rife-nvidia',version:'1.0.0',downloadSize:2100000000,unpackedSize:2630000000,downloadAvailable:false}],runtime:{activated:false},...initial};
    const settings={aiRifeModel:'rife-4.25',aiRifeTarget:60};
    const signal=new Signal();
    const player={rifeExtensionStatus:async()=>status,rifeExtensionStatusChanged:signal,
        downloadRifeExtension:async(...args)=>{calls.push(['download',...args]);return true;},
        importRifeExtension:async(...args)=>{calls.push(['import',...args]);return true;},
        cancelRifeExtensionOperation:(...args)=>calls.push(['cancel',...args]),
        removeRifeExtension:async(...args)=>{calls.push(['remove',...args]);return true;}};
    const context=vm.createContext({console,setInterval:fn=>{const id=timers.size+1;timers.set(id,fn);return id;},clearInterval:id=>timers.delete(id)});
    vm.runInContext(source.slice(start,end),context);
    const result=context.createRifeExtensionPanel({element:(...args)=>new Element(...args),player,settings,
        save:(key,value)=>{settings[key]=value;calls.push(['setting',key,value]);},notify:message=>calls.push(['notice',message])});
    const get=label=>result.node.all().find(node=>node.textContent===label);
    return {result,calls,settings,signal,timers,get,update(value){status={...status,...value};signal.emit(status);},context};
}
test('opening settings shows package sizes and never starts a download',async()=>{
    const p=panel();await settle();
    assert.deepEqual(p.calls,[]);
    const text=p.result.node.all().map(n=>n.textContent).join(' ');
    assert.match(text,/2\.10 GB/);assert.match(text,/2\.63 GB/);
    assert.equal(p.get('下载扩展').disabled,true);
    await p.get('导入离线包').emit('click');assert.deepEqual(p.calls,[['import']]);
    p.result.dispose();
});
test('download uses catalog ID and blocks repeated clicks during native work',async()=>{
    const p=panel({packages:[{id:'fixed-id',version:'1.0.0',downloadSize:2e9,unpackedSize:3e9,downloadAvailable:true}]});await settle();
    await Promise.all([p.get('下载扩展').emit('click'),p.get('下载扩展').emit('click')]);
    assert.deepEqual(p.calls,[['download','fixed-id']]);
    p.update({state:'downloading',busy:true,doneBytes:1e9,totalBytes:2e9});
    assert.match(p.result.node.all().map(n=>n.textContent).join(' '),/50%/);
    assert.equal(p.get('导入离线包').disabled,true);
    await p.get('取消操作').emit('click');assert.deepEqual(p.calls.at(-1),['cancel']);
    p.result.dispose();
});
test('restart requirement and engine preparation are shown separately',async()=>{
    const p=panel({state:'restartRequired',restartRequired:true});await settle();
    assert.match(p.result.node.all().map(n=>n.textContent).join(' '),/重启/);
    p.update({state:'ready',restartRequired:false,runtime:{activated:true,enginePreparing:true}});
    assert.match(p.result.node.all().map(n=>n.textContent).join(' '),/准备完成后自动开始/);
    p.result.dispose();
});
test('failed install remains retryable and errors are rendered as text',async()=>{
    const p=panel();await settle();p.update({state:'error',error:'<bad hash>',busy:false});
    assert.match(p.result.node.all().map(n=>n.textContent).join(' '),/<bad hash>/);
    assert.equal(p.get('导入离线包').disabled,false);
    await p.get('导入离线包').emit('click');assert.deepEqual(p.calls,[['import']]);p.result.dispose();
});
test('presets save actual model and integer target preferences',async()=>{
    const p=panel();await settle();const select=p.result.node.all().find(n=>n.tag==='select');
    for(const [preset,model,fps] of [['quality','rife-4.25-heavy',60],['high','rife-4.25-lite',240],['4k','rife-4.25-lite',120],['balanced','rife-4.25',60]]){
        select.value=preset;await select.emit('change');
        assert.equal(p.settings.aiRifeModel,model);assert.equal(p.settings.aiRifeTarget,fps);
    }
    p.settings.aiRifeTarget=0;p.result.refreshPreferences();assert.equal(select.value,'custom');p.result.dispose();
});
test('closing disconnects status signal and polling',async()=>{
    const p=panel();await settle();assert.equal(p.signal.handlers.size,1);assert.equal(p.timers.size,1);
    p.result.dispose();assert.equal(p.signal.handlers.size,0);assert.equal(p.timers.size,0);
});
test('successful removal disables the removal control',async()=>{
    const p=panel({state:'ready',installedVersion:'trusted-version'});await settle();
    assert.equal(p.get('移除扩展').disabled,false);
    p.update({state:'restartRequired',restartRequired:true,installedVersion:'',removalPending:false});
    assert.equal(p.get('移除扩展').disabled,true);p.result.dispose();
});
test('Mac player does not receive Windows extension controls',()=>{
    const p=panel();const value=p.context.createRifeExtensionPanel({element:()=>{throw Error('unexpected UI');},player:{}});
    assert.equal(value,null);p.result.dispose();
});
