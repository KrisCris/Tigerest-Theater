const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
function setup(){
 const sent=[],context={window:{},setTimeout,clearTimeout,console,URL};context.window=context;
 const file=path.join(__dirname,'../app/src/main/assets/androidBridge.js');
 vm.createContext(context);vm.runInContext(fs.existsSync(file)?fs.readFileSync(file,'utf8'):'',context);
 assert.equal(typeof context.createAndroidBridge,'function','platform transport is implemented');
 const bridge=context.createAndroidBridge({postMessage:s=>sent.push(JSON.parse(s))},{settings:{},sections:[],settingsDescriptions:{}});
 return {bridge,sent};
}
test('load forwards actual metadata and resolves Qt-style callback from the native reply',async()=>{
 const {bridge,sent}=setup();let callback;
 const p=bridge.api.player.load('https://media.example/video',{startMilliseconds:24000},{metadata:{IndexNumber:3}},1,-1,result=>callback=result);
 assert.equal(sent[0].method,'load');assert.equal(sent[0].args.length,5);assert.equal(sent[0].args[1].startMilliseconds,24000);
 bridge.receive({id:sent[0].id,result:true});assert.equal(await p,true);assert.equal(callback,true);bridge.close();
});
test('native failure rejects calls and disconnect really removes event delivery',async()=>{
 const {bridge,sent}=setup();let positions=[];const listener=p=>positions.push(p);
 bridge.api.player.positionUpdate.connect(listener);bridge.receive({component:'player',signal:'positionUpdate',args:[25000]});
 bridge.api.player.positionUpdate.disconnect(listener);bridge.receive({component:'player',signal:'positionUpdate',args:[26000]});
 assert.deepEqual(positions,[25000]);const p=bridge.api.settings.setValue('video','cache',-1);
 bridge.receive({id:sent[0].id,error:'值超出范围'});await assert.rejects(p,/值超出范围/);bridge.close();
});
test('closing the page cancels pending operations and late responses cannot settle new calls',async()=>{
 const {bridge,sent}=setup();const pending=bridge.api.player.getPosition();bridge.close();await assert.rejects(pending,/页面已关闭/);
 bridge.receive({id:sent[0].id,result:999});await assert.rejects(bridge.api.player.play(),/页面已关闭/);
});
