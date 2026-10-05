const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../native/nativeshell.js'),'utf8');
const start=source.indexOf('function installWindowModeEntry()'),end=source.indexOf('\ninstallMpvSettingsEntry();',start);
assert.ok(start>=0&&end>start);
let observer,mutations=0,button,fullscreen=false,change;
const document={head:{appendChild(){}},documentElement:{},getElementById:id=>id==='tigerest-window-mode-button'?button:id==='tigerest-window-mode-style'?{}:null,querySelector:()=>({parentElement:{insertBefore:b=>{button=b;}}}),createElement:()=>({addEventListener(){},setAttribute(){},get textContent(){return this.value||'';},set textContent(value){this.value=value;mutations++;}})};
const window={initCompleted:Promise.resolve(),api:{window:{isFullScreen:async()=>fullscreen,fullScreenSwitched:{connect:fn=>{change=fn;}}}}};
vm.runInNewContext(source.slice(start,end)+'\ninstallWindowModeEntry();',{document,window,MutationObserver:class{constructor(fn){observer=fn;}observe(){}},console});
(async()=>{
 await new Promise(r=>setImmediate(r));
 const before=mutations;observer();observer();
 assert.equal(mutations,before,'unchanged button must not create child-list mutations in its own observer');
 fullscreen=true;await change();assert.equal(button.textContent,'窗口');
 console.log('window button: observer terminates and fullscreen label updates');
})().catch(e=>{console.error(e);process.exitCode=1;});
