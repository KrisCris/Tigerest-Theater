// Real native renderer: visual fidelity, asynchronous recovery and resource lifetime.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const withBrowser=require('./community_browser.cjs'),root=path.resolve(__dirname,'..');
const source=path.join(root,'native/ambientBackdrop.js');
const viewport={width:Number(process.env.TIGEREST_AMBIENT_WIDTH||800),height:Number(process.env.TIGEREST_AMBIENT_HEIGHT||600),deviceScaleFactor:Number(process.env.TIGEREST_AMBIENT_DPR||1),mobile:false};
const routes={'/':{type:'text/html',body:'<!doctype html><style>body{margin:0}.backgroundContainer{inset:0}</style><div class="backgroundContainer"></div>'}};
for(const n of ['a','b'])routes['/'+n+'.png']={type:'image/png',path:process.env.TIGEREST_AMBIENT_ART?path.join(root,'native/home-art',n==='a'?'series.png':'movies.png'):path.join(__dirname,'fixtures/ambient-'+n+'.png')};
withBrowser(routes,async({call,evaluate,url})=>{
 if(process.env.TIGEREST_AMBIENT_REQUIRE_EMBEDDED){
  assert.equal(await evaluate('typeof window.TigerestAmbientBackdrop?.refresh'),'function','Mac shell includes the renderer');
  assert.equal(await evaluate(`new Promise(resolve=>{const end=performance.now()+3000;const check=()=>TigerestAmbientBackdrop.inspect().ready?resolve(true):performance.now()>end?resolve(false):setTimeout(check,20);check();})`),true,'renderer initializes from DocumentCreation without a manual refresh');
 }
 await call('Emulation.setDeviceMetricsOverride',viewport);
 await evaluate('window.TigerestAmbientBackdrop?.dispose();true');
 await evaluate(`window.ambientFixtureSet=phase=>{const bg=document.querySelector('.backgroundContainer');for(const n of ['a','b'])bg.style.setProperty('--tgs-ambient-image-'+n,'url("'+${JSON.stringify(url)}+'/'+n+'.png")');document.documentElement.classList.toggle('tigerest-ambient-phase-b',phase==='b');};ambientFixtureSet('a');new Promise(r=>setTimeout(r,1000))`);
 const images={};
 async function capture(name,renderer){
  for(const phase of ['a','b']){
   await evaluate(`ambientFixtureSet('${phase}');${renderer?'TigerestAmbientBackdrop.refresh()':'true'}`);
   await evaluate('new Promise(r=>setTimeout(r,950))');
   images[name+phase]=(await call('Page.captureScreenshot',{format:'png'})).data;
  }
  await evaluate(`ambientFixtureSet('a');${renderer?'TigerestAmbientBackdrop.refresh()':'true'}`);
  await evaluate(`new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>{for(const a of document.querySelector('.backgroundContainer').getAnimations({subtree:true})){a.pause();a.currentTime=425;}r();})))`);
  images[name+'mid']=(await call('Page.captureScreenshot',{format:'png'})).data;
  await evaluate(`for(const a of document.querySelector('.backgroundContainer').getAnimations({subtree:true}))a.finish();true`);
 }
 await capture('original',false);
 if(fs.existsSync(source))await evaluate(fs.readFileSync(source,'utf8'));
 assert.equal(await evaluate('typeof window.TigerestAmbientBackdrop?.refresh'),'function','ambient renderer installs its lifecycle API');
 await evaluate('TigerestAmbientBackdrop.refresh()');
 let state=await evaluate('TigerestAmbientBackdrop.inspect()');assert.equal(state.ready,1);assert.equal(state.backgrounds,1);
 await capture('prepared',true);
 const differences=await evaluate(`(async()=>{
  const data=${JSON.stringify(images)},out=[];
  async function pixels(key){const image=await createImageBitmap(await(await fetch('data:image/png;base64,'+data[key])).blob()),c=document.createElement('canvas');c.width=image.width;c.height=image.height;const x=c.getContext('2d',{willReadFrequently:true});x.drawImage(image,0,0);image.close();return x.getImageData(0,0,c.width,c.height).data;}
  for(const phase of ['a','b','mid']){const a=await pixels('original'+phase),b=await pixels('prepared'+phase);let sum=0,max=0;for(let i=0;i<a.length;i++)if(i%4!==3){const d=Math.abs(a[i]-b[i]);sum+=d;max=Math.max(max,d);}out.push({phase,mean:sum/(a.length*.75),max});}return out;
 })()`);
 for(const d of differences){assert.ok(d.mean<1.3,'ambient mean color difference: '+JSON.stringify(d));assert.ok(d.max<=5,'ambient maximum color difference: '+JSON.stringify(d));}
 const geometry=await evaluate(`(()=>{const bg=document.querySelector('.backgroundContainer'),canvases=[...bg.querySelectorAll('canvas[data-tigerest-ambient]')];return {count:canvases.length,hidden:getComputedStyle(bg,'::before').visibility,canvasPixels:canvases.map(c=>[c.width,c.height])};})()`);
 assert.equal(geometry.count,2);assert.equal(geometry.hidden,'hidden');assert.ok(geometry.canvasPixels.every(([w,h])=>w<=1600&&h<=1600));
 // Server styles can arrive after the background element itself. Falling
 // back while its filter is absent must not loop on unchanged class writes.
 await evaluate(`window.ambientOverride=document.createElement('style');ambientOverride.textContent='.backgroundContainer::before{filter:none!important;transition:none!important}';document.head.append(ambientOverride);true`);
 assert.equal(await evaluate(`getComputedStyle(document.querySelector('.backgroundContainer'),'::before').filter`),'none','exercise a genuinely unsupported filter');
 await evaluate('TigerestAmbientBackdrop.refresh();new Promise(r=>setTimeout(r,80))');
 assert.equal((await evaluate('TigerestAmbientBackdrop.inspect()')).ready,0,'an unsupported filter uses CSS without blocking the event loop');
 await evaluate(`ambientOverride.textContent='.backgroundContainer::before{transition:none!important}';TigerestAmbientBackdrop.refresh()`);
 assert.equal((await evaluate('TigerestAmbientBackdrop.inspect()')).ready,1,'restoring the supported filter resumes prepared backgrounds');
 await evaluate('ambientOverride.remove();true');
 // A very wide external display still has a strict texture budget, including
 // the transparent blur padding and integer rounding on both sides.
 await call('Emulation.setDeviceMetricsOverride',{width:3000,height:1000,deviceScaleFactor:1,mobile:false});
 await evaluate('TigerestAmbientBackdrop.refresh()');
 const resized=await evaluate(`[...document.querySelectorAll('canvas[data-tigerest-ambient]')].map(c=>[c.width,c.height])`);
 assert.ok(resized.every(([w,h])=>w<=1600&&h<=1600),'resized texture budget: '+JSON.stringify(resized));
 await call('Emulation.setDeviceMetricsOverride',{width:800,height:600,deviceScaleFactor:1,mobile:false});
 await evaluate('TigerestAmbientBackdrop.refresh()');
 await call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
 const reduced=await evaluate(`[...document.querySelectorAll('canvas[data-tigerest-ambient]')].map(c=>({transform:getComputedStyle(c).transform,transition:getComputedStyle(c).transitionDuration}))`);
 assert.ok(reduced.every(s=>s.transform==='none'&&s.transition==='0s'),'reduced motion is preserved');
 await call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
 await evaluate(`(async()=>{for(let i=0;i<5;i++){const old=document.querySelector('.backgroundContainer'),bg=document.createElement('div');bg.className='backgroundContainer';bg.style.cssText=old.style.cssText;old.replaceWith(bg);await TigerestAmbientBackdrop.refresh();}})()`);
 state=await evaluate('TigerestAmbientBackdrop.inspect()');assert.equal(state.backgrounds,1,'detached backgrounds release their state');assert.equal(state.ready,1);
 await evaluate(`document.querySelector('.backgroundContainer').style.setProperty('--tgs-ambient-image-a','url("${url}/missing.png")');document.documentElement.classList.remove('tigerest-ambient-phase-b');TigerestAmbientBackdrop.refresh()`);
 assert.equal(await evaluate(`getComputedStyle(document.querySelector('.backgroundContainer'),'::before').visibility`),'visible','failed preparation returns to the original CSS background');
 await evaluate(`ambientFixtureSet('b');TigerestAmbientBackdrop.refresh()`);
 assert.equal((await evaluate('TigerestAmbientBackdrop.inspect()')).ready,1,'new artwork recovers after a failed request');
 // A completed asynchronous bitmap write has no src/style/class mutation.
 // It must explicitly invalidate a snapshot prepared with the previous pixels.
 await evaluate(`window.originalInvalidate=TigerestHomeTransitions.invalidate;window.ambientInvalidations=0;TigerestHomeTransitions.invalidate=(...args)=>{ambientInvalidations++;return originalInvalidate(...args);};document.querySelector('.backgroundContainer').style.setProperty('--tgs-ambient-image-a','url("${url}/b.png?new")');TigerestAmbientBackdrop.refresh()`);
 assert.ok(await evaluate('ambientInvalidations>0'),'prepared pixels invalidate the frozen transition cache');
 await evaluate('TigerestHomeTransitions.invalidate=originalInvalidate;true');
 // Hold a real worker's second slot to observe the interval between its two
 // results, then supersede the pending pair before its late result arrives.
 await evaluate(`TigerestAmbientBackdrop.dispose();window.OriginalAmbientWorker=Worker;window.heldAmbient=null;window.holdAmbientSlot=null;
  window.Worker=class extends OriginalAmbientWorker{postMessage(data,...rest){if(data.slot===holdAmbientSlot){holdAmbientSlot=null;heldAmbient=()=>super.postMessage(data,...rest);}else super.postMessage(data,...rest);}};
  window.ambientPixels=()=>[...document.querySelectorAll('canvas[data-tigerest-ambient]')].map(c=>{const out=document.createElement('canvas');out.width=c.width;out.height=c.height;const x=out.getContext('2d');x.drawImage(c,0,0);return Array.from(x.getImageData(c.width>>1,c.height>>1,1,1).data);});ambientFixtureSet('a');true`);
 await evaluate(fs.readFileSync(source,'utf8'));await evaluate('TigerestAmbientBackdrop.refresh()');
 const beforePair=await evaluate('ambientPixels()');
 await evaluate(`holdAmbientSlot='b';const bg=document.querySelector('.backgroundContainer');bg.style.setProperty('--tgs-ambient-image-a','url("${url}/b.png?pair")');bg.style.setProperty('--tgs-ambient-image-b','url("${url}/a.png?pair")');document.documentElement.classList.add('tigerest-ambient-phase-b');window.pendingAmbient=TigerestAmbientBackdrop.refresh();new Promise((r,j)=>{const start=performance.now();const check=()=>heldAmbient?r():performance.now()-start>2000?j(Error('worker was not held')):setTimeout(check,10);check();})`);
 assert.deepEqual(await evaluate('ambientPixels()'),beforePair,'a pair does not partially replace the visible artwork');
 await evaluate(`ambientFixtureSet('a');TigerestAmbientBackdrop.refresh();heldAmbient();heldAmbient=null;pendingAmbient`);
 assert.deepEqual(await evaluate('ambientPixels()'),beforePair,'superseded worker completion cannot show stale artwork');
 assert.equal(await evaluate(`document.querySelector('.backgroundContainer').dataset.tigerestAmbientPhase`),'a');
 await evaluate('TigerestAmbientBackdrop.dispose();window.Worker=()=>{throw Error("fixture unavailable worker")};true');
 await evaluate(fs.readFileSync(source,'utf8'));await evaluate('TigerestAmbientBackdrop.refresh()');
 assert.equal((await evaluate('TigerestAmbientBackdrop.inspect()')).ready,0,'worker creation failure retains CSS');
 await evaluate(`window.Worker=OriginalAmbientWorker;document.documentElement.classList.add('tigerest-ambient-phase-b');TigerestAmbientBackdrop.refresh()`);
 assert.equal((await evaluate('TigerestAmbientBackdrop.inspect()')).ready,1,'a later update recovers after worker creation failure');
 await evaluate('TigerestAmbientBackdrop.dispose();true');
 assert.equal(await evaluate('document.querySelectorAll("canvas[data-tigerest-ambient]").length'),0);
 state=await evaluate('TigerestAmbientBackdrop.inspect()');assert.equal(state.backgrounds,0);assert.equal(state.pending,0);
 console.log(JSON.stringify({viewport,differences,geometry,resized,reducedMotion:true,replacement:true,fallback:true,atomicPair:true,staleCompletion:true,workerRecovery:true,disposal:true}));
},{gpu:true}).catch(e=>{console.error(e);process.exitCode=1});
