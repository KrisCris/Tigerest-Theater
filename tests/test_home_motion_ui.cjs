const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),withBrowser=require('./community_browser.cjs');
const root=path.resolve(__dirname,'..'),renderer=path.join(root,'native/homeTransitions.js');
assert.ok(fs.existsSync(renderer),'production transition renderer exists');
const routes={
 '/':{type:'text/html',body:`<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="http://localhost:PORT/theme.css"><style>body{margin:0;background:#101722;color:white;font:18px sans-serif}.page{position:fixed;inset:0;padding:60px;box-sizing:border-box;background:linear-gradient(120deg,#34495c,#101722)}.hide{display:none}.cardImage{width:100px;height:150px;object-fit:cover}.detailImageContainer{width:200px;height:300px;margin:70px 0 0 80px;background-size:cover}h1{margin:30px 0}</style><div class="page" id="home"><h1>首页</h1><img id="source" class="cardImage" src="/poster.svg"></div><div class="page hide" id="detail"><div class="detailImageContainer" style="background-image:url('/poster.svg')"></div><h1>作品详情</h1></div><div class="page hide" id="library"><h1>媒体夹</h1><div data-id="work"><img class="cardImage" src="/poster.svg"></div></div><script src="/transitions.js"></script><script src="/motion.js"></script>`},
 '/theme.css':{type:'text/css',body:'h1{color:rgb(227,194,143)}'},
 '/poster.svg':{type:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="480" height="720"><rect width="480" height="720" fill="#856633"/><circle cx="240" cy="280" r="140" fill="#c5b185"/></svg>'},
 '/transitions.js':{path:renderer},'/motion.js':{path:path.join(root,'native/homeMotion.js')}
};
// localhost and 127.0.0.1 are different origins. CSSOM access must not be needed.
routes['/'].body=routes['/'].body.replace('http://localhost:PORT/theme.css','/theme.css');
withBrowser(routes,async({evaluate,call,url})=>{
 await evaluate(`document.querySelector('link').href=${JSON.stringify(url.replace('127.0.0.1','localhost')+'/theme.css')}`);
 await evaluate(`window.fixture={state:{params:{},contextPath:'/home'},show(name){document.querySelectorAll('.page').forEach(p=>p.classList.toggle('hide',p.id!==name));this.state.params=name==='detail'?{id:'work'}:{};this.state.contextPath='/'+name;},async route(name,delay=0){await new Promise(r=>setTimeout(r,delay));this.show(name);}};window.router={showItem:()=>fixture.route('detail'),back:()=>fixture.route('home'),goHome:()=>fixture.route('home'),getRouteUrl:()=>'/library'};TigerestHomeMotion.attach({router,pageJs:{replace:()=>fixture.route('library')},manager:{currentApiClient:()=>({serverId:()=> 'fixture',getCurrentUserId:()=> 'user'})},viewManager:{currentViewInfo:()=>fixture.state}});`);
 const begin=()=>evaluate(`window.pending=TigerestHomeMotion.openItem({card:{item:{Id:'work',Type:'Movie'}},library:{Id:'library',Type:'CollectionFolder'},source:document.querySelector('#source'),navigate:()=>fixture.route('detail',450)});true`);
 await begin();
 assert.equal(await evaluate('TigerestHomeTransitions.busy'),true);
 await new Promise(r=>setTimeout(r,380));
 const waiting=await evaluate(`({busy:TigerestHomeTransitions.busy,veil:+getComputedStyle(document.querySelector('.tigerest-motion-veil')).opacity,poster:!!document.querySelector('.tigerest-motion-poster'),old:!document.querySelector('#home').classList.contains('hide')})`);
 assert.ok(waiting.busy&&waiting.poster&&waiting.veil>.99&&waiting.old,'blur remains opaque while the real route loads');
 await evaluate('pending');
 const landed=await evaluate(`({metric:TigerestHomeTransitions.last,leaks:document.querySelectorAll('.tigerest-motion-layer,[data-tigerest-poster-held]').length,busy:TigerestHomeTransitions.busy,detail:!document.querySelector('#detail').classList.contains('hide')})`);
 assert.ok(landed.detail&&!landed.busy&&landed.leaks===0);assert.ok(landed.metric.landingErrorPx<2,'poster meets the actual background-image detail poster');assert.ok(landed.metric.surfaces.every(s=>s.width<=240));
 await evaluate('router.back()');assert.equal(await evaluate('fixture.state.contextPath'),'/library');
 await evaluate('router.back()');assert.equal(await evaluate('fixture.state.contextPath'),'/home');
 await evaluate(`window.failure=TigerestHomeMotion.openItem({card:{item:{Id:'work'}},library:{Id:'library'},source:document.querySelector('#source'),navigate:async()=>{throw Error('fixture offline');}}).then(()=>false,()=>true)`);
 assert.equal(await evaluate('failure'),true);assert.equal(await evaluate('TigerestHomeTransitions.busy||!!document.querySelector(".tigerest-motion-layer")'),false);
 await begin();await call('Emulation.setDeviceMetricsOverride',{width:900,height:700,deviceScaleFactor:1,mobile:false});await evaluate('pending');
 assert.equal(await evaluate('TigerestHomeTransitions.busy||!!document.querySelector(".tigerest-motion-layer")'),false,'resize releases all effects');
 await evaluate(`fixture.show('home');window.missing=TigerestHomeTransitions.poster({source:null,findTarget:()=>null,navigate:()=>fixture.route('detail')})`);await evaluate('missing');
 assert.equal(await evaluate('fixture.state.contextPath'),'/detail');assert.equal(await evaluate('TigerestHomeTransitions.busy'),false);
 await call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
 await evaluate(`fixture.show('home');window.reduced=TigerestHomeTransitions.poster({source:document.querySelector('#source'),findTarget:()=>document.querySelector('.detailImageContainer'),navigate:()=>fixture.route('detail')});true`);
 assert.equal(await evaluate('!!document.querySelector(".tigerest-motion-poster,.tigerest-motion-veil")'),false);await evaluate('reduced');
 console.log('production motion fixture:',JSON.stringify({checks:10,landed}));
},{gpu:true,visible:true}).catch(error=>{console.error(error);process.exitCode=1;});
