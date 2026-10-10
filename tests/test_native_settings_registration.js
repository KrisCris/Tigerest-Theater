const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function modules() {
    const registrations = new Map();
    const context = {console, AbortController, setInterval:()=>1, clearInterval(){}, setTimeout:()=>1,
        location:{origin:'http://test.invalid'}, jmpInfo:{version:'test',
            sections:['main','home','audio','video','subtitles','mpv','danmaku','other'].map((key,order)=>({key,order:order+1})),
            settingsDescriptions:Object.fromEntries(['main','home','audio','video','subtitles','mpv','danmaku','other'].map(key=>[key,[]]))}, NativeShell:{AppHost:{}}};
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

// Both Emby's drawer and settings overview use this route filter.
const menuRoutes = routes => routes.filter(route=>route.type==='settings' && route.settingsType!=='user');

test('legacy settings URL remains routable without adding a menu entry', () => {
    const {context,registrations}=modules();
    assert.ok(context.appStartInfo.plugins.includes('tigerest/settings.js'));
    const plugin = new (registrations.get('tigerest/settings.js').factory())();
    const route = plugin.getRoutes().find(route=>route.path==='settings.html');
    assert.ok(route);
    assert.equal(menuRoutes([route]).length,0,'legacy parent must be absent from both native settings menus');
    assert.equal(route.contentPath,'none');
    assert.equal(route.templateType,'settings');
    assert.equal(route.settingsTheme,true,'the integrated page retains the Emby settings drawer');
    assert.equal(route.title,'MPV 播放设置');
    assert.ok(registrations.has(route.controller));
});

test('only supported categories appear once in native settings menus', () => {
    const {context,registrations}=modules();
    const plugin=new (registrations.get('tigerest/settings.js').factory())();
    const routes=menuRoutes(plugin.getRoutes());
    assert.deepEqual(Array.from(routes,route=>route.tigerestSettingsSection),
        ['main','home','audio','video','subtitles','mpv','danmaku','other']);
    for(const route of routes){
        assert.equal(route.type,'settings');
        assert.equal(route.settingsTheme,true);
        assert.ok(route.order>=25 && route.order<26);
        assert.ok(registrations.has(route.controller));
    }
    context.tigerestAndroidApi={};
    context.jmpInfo.sections=context.jmpInfo.sections.filter(section=>section.key!=='other');
    const androidRoutes=menuRoutes(plugin.getRoutes());
    assert.equal(androidRoutes.some(route=>route.title==='客户端设置'),false);
    assert.equal(androidRoutes.filter(route=>route.title==='客户端').length,1);
    assert.equal(plugin.getRoutes().some(route=>route.tigerestSettingsSection==='other'),false,
        'unsupported categories are not exposed');
    assert.equal(plugin.getRoutes().find(route=>route.tigerestSettingsSection==='mpv').title,'播放器');
});

test('category routes use semantic Emby material icons from shared category metadata', () => {
    const {context,registrations}=modules();
    const plugin=new (registrations.get('tigerest/settings.js').factory())();
    // Verified against Emby 4.10's mi_2024_05 font cmap: desktop_windows,
    // volume_up, videocam, closed_caption, high_quality, chat and tune.
    const icons={main:'&#xe30c;',home:'&#xe88a;',audio:'&#xe050;',video:'&#xe04b;',subtitles:'&#xe01c;',
        mpv:'&#xe024;',danmaku:'&#xe0b7;',other:'&#xe429;'};
    for(const android of [false,true]){
        context.tigerestAndroidApi=android?{}:null;
        const categories=context.tigerestSettingsCategories();
        for(const route of menuRoutes(plugin.getRoutes())){
            assert.equal(route.icon,icons[route.tigerestSettingsSection]);
            assert.equal(route.icon,categories.find(section=>section.key===route.tigerestSettingsSection).icon,
                'the category metadata supplies the native route icon on every platform');
            assert.notEqual(route.icon,'&#xe5cc;','category icons are not hierarchy arrows');
        }
    }
});

test('default MPV shortcut selects its category while legacy deep links remain supported', async () => {
    const {context,registrations}=modules();
    const routes=new (registrations.get('tigerest/settings.js').factory())().getRoutes();
    for(const route of routes)route.path='/plugins/tigerest-native-settings/'+route.path;
    const shown=[];
    const router={getRoutes:()=>routes,show:path=>shown.push(path)};
    context.Emby={importModule:async()=>router};
    const shell=fs.readFileSync(__dirname+'/../native/nativeshell.js','utf8');
    vm.runInNewContext(shell.slice(shell.indexOf('async function openTigerestSettings('),shell.indexOf('window.tigerestMountSettings =')),context);
    await context.openTigerestSettings();
    await context.openTigerestSettings('main');
    assert.deepEqual(shown,['/plugins/tigerest-native-settings/settings/mpv.html','/plugins/tigerest-native-settings/settings/main.html']);
    router.getRoutes=()=>routes.filter(route=>route.path.endsWith('/settings.html'));
    await context.openTigerestSettings('subtitles');
    assert.equal(shown.at(-1),'/plugins/tigerest-native-settings/settings.html?section=subtitles');
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
