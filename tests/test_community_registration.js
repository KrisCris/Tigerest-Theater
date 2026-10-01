const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
test('community plugin is registered with Emby and bundled before compatibility startup', () => {
    const registrations = new Map();
    const context = {console, Promise, setInterval:()=>1, clearInterval(){}, setTimeout:()=>1, clearTimeout(){},
        location:{origin:'http://test.invalid'}, jmpInfo:{version:'test'}, NativeShell:{AppHost:{}}, appStartInfo:{},
        _communityPlugin:class {constructor(options){this.options=options;}}};
    context.window = context; context.globalThis = context;
    vm.createContext(context);
    vm.runInContext(fs.readFileSync(path.join(__dirname,'../native/embycompat.js'),'utf8'), context);
    context.define=(id, deps, factory)=>registrations.set(id,{deps,factory});
    assert.ok(context.appStartInfo.plugins.includes('tigerest/community.js'));
    const registration=registrations.get('tigerest/community.js');
    const connectionManager={}, events={};
    const instance=new (registration.factory({default:connectionManager},{default:events}))();
    assert.equal(instance.options.connectionManager,connectionManager);
    assert.equal(instance.options.events,events);
    const script=fs.readFileSync(path.join(__dirname,'../src/system/SystemComponent.cpp'),'utf8');
    assert.ok(script.indexOf('extension/communityClient.js') < script.indexOf('extension/communityPlugin.js'));
    assert.ok(script.indexOf('extension/communityPlugin.js') < script.indexOf('extension/embycompat.js'));
});
