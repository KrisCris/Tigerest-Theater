const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function modules() {
    const registrations = new Map();
    const context = {console, AbortController, setInterval:()=>1, clearInterval(){}, setTimeout:()=>1,
        location:{origin:'http://test.invalid'}, jmpInfo:{version:'test',
            sections:['main','audio','video','subtitles','mpv','danmaku','other'].map((key,order)=>({key,order:order+1})),
            settingsDescriptions:Object.fromEntries(['main','audio','video','subtitles','mpv','danmaku','other'].map(key=>[key,[]]))}, NativeShell:{AppHost:{}}};
    context.window = context; context.globalThis = context;
    const shell=fs.readFileSync(__dirname+'/../native/nativeshell.js','utf8');
    const categoriesStart=shell.indexOf('function getTigerestSettingsCategories(');
    if(categoriesStart>=0){
        vm.runInNewContext(shell.slice(categoriesStart,shell.indexOf('function installTigerestSettingsMenu(',categoriesStart)),context);
        context.tigerestSettingsCategories=context.getTigerestSettingsCategories;
    }
    vm.runInNewContext(fs.readFileSync(__dirname+'/../native/embycompat.js','utf8'), context);
    context.define=(id,deps,factory)=>registrations.set(id,{deps,factory});
    return {context,registrations};
}

test('MPV settings register a client settings route rendered within Emby', () => {
    const {context,registrations}=modules();
    assert.ok(context.appStartInfo.plugins.includes('tigerest/settings.js'));
    const plugin = new (registrations.get('tigerest/settings.js').factory())();
    const [route] = plugin.getRoutes();
    assert.equal(route.type,'settings');
    assert.notEqual(route.settingsType,'user');
    assert.equal(route.contentPath,'none');
    assert.equal(route.templateType,'settings');
    assert.equal(route.settingsTheme,true,'the integrated page retains the Emby settings drawer');
    assert.equal(route.title,'MPV 播放设置');
    assert.ok(registrations.has(route.controller));
});

test('supported categories register immediately after the parent as native Emby routes', () => {
    const {context,registrations}=modules();
    const plugin=new (registrations.get('tigerest/settings.js').factory())();
    const routes=plugin.getRoutes();
    assert.deepEqual(Array.from(routes.slice(1),route=>route.tigerestSettingsSection),
        ['main','audio','video','subtitles','mpv','danmaku','other']);
    for(const route of routes.slice(1)){
        assert.equal(route.type,'settings');
        assert.equal(route.settingsTheme,true);
        assert.ok(route.order>routes[0].order && route.order<routes[0].order+1);
        assert.ok(registrations.has(route.controller));
    }
    context.tigerestAndroidApi={};
    context.jmpInfo.sections=context.jmpInfo.sections.filter(section=>section.key!=='other');
    assert.equal(plugin.getRoutes()[0].title,'客户端设置');
    assert.equal(plugin.getRoutes().some(route=>route.tigerestSettingsSection==='other'),false,
        'unsupported categories are not exposed');
    assert.equal(plugin.getRoutes().find(route=>route.tigerestSettingsSection==='mpv').title,'播放器');
});

test('native category controllers keep the selected category through pause and resume', async () => {
    const {context,registrations}=modules();
    const plugin=new (registrations.get('tigerest/settings.js').factory())();
    const route=plugin.getRoutes().find(route=>route.tigerestSettingsSection==='video');
    assert.ok(route,'video is a native settings route');
    const mounted=[],target={classList:{add(){}}},view={querySelector:()=>target};
    context.tigerestMountSettings=async(host,section)=>{mounted.push(section);return {dispose(){}};};
    function Base(){} Base.prototype.onResume=function(){};Base.prototype.onPause=function(){};
    const Controller=registrations.get(route.controller).factory({default:Base},{default:{}});
    const controller=new Controller(view,{});
    controller.onResume({});await Promise.resolve();controller.onPause({});controller.onResume({});await Promise.resolve();
    assert.deepEqual(mounted,['video','video']);
});

test('settings view releases mounted controls on navigation, including a pending mount', async () => {
    const {context,registrations}=modules();
    const mounts=[], target={classList:{add(){}}}, view={querySelector:()=>target};
    context.tigerestMountSettings=()=>new Promise(resolve=>mounts.push(resolve));
    function Base() {} Base.prototype.onResume=function(){}; Base.prototype.onPause=function(){};
    const Controller=registrations.get('tigerest/settings-view.js').factory({default:Base},{default:{}});
    const controller=new Controller(view,{section:'video'});
    controller.onResume({}); controller.onPause({});
    let disposed=0; mounts[0]({dispose(){disposed++;}}); await Promise.resolve(); await Promise.resolve();
    assert.equal(disposed,1);
    controller.onResume({}); mounts[1]({dispose(){disposed++;}}); await Promise.resolve(); await Promise.resolve();
    controller.onPause({}); assert.equal(disposed,2);
});
