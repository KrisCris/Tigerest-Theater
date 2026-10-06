const assert=require('node:assert/strict'),http=require('node:http');
const {run,delay}=require('./cdp.cjs');
const withBrowser=require('./android_browser.cjs');
(async()=>{
 const target=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><body><header class="skinHeader"><div class="headerTop"><div class="headerRight"><button class="headerUserButton">账户</button></div></div></header><main>服务器登录页</main></body>');});
 await new Promise(r=>target.listen(0,'127.0.0.1',r));const port=target.address().port;
 try {
  run('reverse','tcp:'+port,'tcp:'+port);
  await withBrowser({'/':{type:'text/html',body:'<!doctype html><body>选择服务器</body>'}},async({evaluate})=>{
   const url='http://127.0.0.1:'+port;
   await evaluate(`api.settings.setValue('main','userWebClient',${JSON.stringify(url)})`);
   await evaluate(`location.href=${JSON.stringify(url)};true`).catch(e=>{if(!/navigated|closed/.test(e.message))throw e;});
   for(let i=0;i<70;i++){await delay(100);if(await evaluate('!!window.tigerestAndroidApi&&document.readyState==="complete"'))break;}
   assert.equal(await evaluate('!!window.tigerestAndroidApi'),true,'first navigation from server picker must inject the Android bridge');
   const state=await evaluate('({windowButton:!!document.getElementById("tigerest-window-mode-button"),css:[...document.querySelectorAll("style")].some(s=>s.textContent.includes("--tgs-safe-top")),top:getComputedStyle(document.querySelector(".skinHeader")).paddingTop,metrics:tigerestWindowMetrics})');
   assert.equal(state.windowButton,false);assert.equal(state.css,true);assert.ok(parseFloat(state.top)>=state.metrics.safeInsets.top-1);
   console.log(JSON.stringify({passed:true,firstNavigationBridge:true,androidCss:true,noDesktopWindowButton:true}));
  });
 } finally {run('reverse','--remove','tcp:'+port);target.closeAllConnections();await new Promise(r=>target.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
