const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function modules() {
    const registrations = new Map();
    const context = {console, AbortController, setInterval:()=>1, clearInterval(){}, setTimeout:()=>1,
        location:{origin:'http://test.invalid'}, jmpInfo:{version:'test'}, NativeShell:{AppHost:{}}};
    context.window = context; context.globalThis = context;
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
