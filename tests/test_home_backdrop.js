const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
test('a failed resize still releases bitmaps from late concurrent decodes',async()=>{
 let calls=0,closed=0;
 const nodes=[0,1].map(id=>({id,tagName:'IMG',complete:true,naturalWidth:480,naturalHeight:720,closest:()=>null,matches:()=>false,getBoundingClientRect:()=>({x:0,y:0,width:120,height:180,top:0,bottom:180,left:0,right:120})}));
 const root={closest:()=>null,getBoundingClientRect:()=>({width:0,height:0})};
 const context={AbortController,performance,setTimeout,clearTimeout,innerWidth:1000,innerHeight:700,Worker:class{},OffscreenCanvas:class{},
  NodeFilter:{SHOW_ELEMENT:1,FILTER_ACCEPT:1,FILTER_REJECT:2},document:{createTreeWalker:()=>{let i=0;return {nextNode:()=>nodes[i++]||null};}},
  getComputedStyle:()=>({visibility:'visible',display:'block',opacity:'1',backgroundColor:'transparent'}),
  createImageBitmap:async node=>{calls++;if(node.id===0)throw Error('decode failed');await new Promise(r=>setTimeout(r,25));return {close:()=>closed++};}};
 context.window=context;vm.runInNewContext(fs.readFileSync(__dirname+'/../native/homeBackdrop.js','utf8'),context);
 assert.equal(await context.TigerestHomeBackdrop.build(root,new AbortController().signal),null);
 await new Promise(r=>setTimeout(r,40));assert.equal(calls,2);assert.equal(closed,1,'late successful decode is closed after its peer fails');
});

// Exercise the public builder with fresh image elements, as Emby creates new
// controls when returning to the home view. Count source decodes, not copies of
// the small transferable result; keeping the latter independent is essential.
function bitmapFixture(){
 let nodes=[],decodes=0,copies=0;
 const originals=[],all=[];
 const bitmap=(width,height)=>{const b={width,height,closed:false,close(){this.closed=true;}};all.push(b);return b;};
 const root={closest:()=>null,getBoundingClientRect:()=>({width:0,height:0})};
 class FixtureURL extends URL {static createObjectURL(){return 'blob:fixture';}static revokeObjectURL(){}}
 const context={AbortController,performance,setTimeout,clearTimeout,Blob,URL:FixtureURL,location:{href:'http://fixture/'},innerWidth:1000,innerHeight:700,
  Worker:class{postMessage(){queueMicrotask(()=>this.onmessage({data:{bitmap:bitmap(240,168),rasterThread:'worker'}}));}terminate(){}},OffscreenCanvas:class{},
  NodeFilter:{SHOW_ELEMENT:1,FILTER_ACCEPT:1,FILTER_REJECT:2},document:{createTreeWalker:()=>{let i=0;return {nextNode:()=>nodes[i++]||null};}},
  getComputedStyle:()=>({visibility:'visible',display:'block',opacity:'1',backgroundColor:'transparent'}),
 };
 context.createImageBitmap=async(source,options)=>{
  if(source.tagName==='IMG'){decodes++;const b=bitmap(options.resizeWidth,options.resizeHeight);originals.push(b);return b;}
  copies++;assert.equal(source.closed,false,'the retained bitmap must still be alive');return bitmap(options?.resizeWidth??source.width,options?.resizeHeight??source.height);
 };
 context.window=context;vm.runInNewContext(fs.readFileSync(__dirname+'/../native/homeBackdrop.js','utf8'),context);
 return {context,originals,all,get decodes(){return decodes;},get copies(){return copies;},
  async build(src,width=120,height=180){
   nodes=[{tagName:'IMG',complete:true,naturalWidth:480,naturalHeight:720,currentSrc:src,closest:()=>null,matches:()=>false,
    getBoundingClientRect:()=>({x:0,y:0,width,height,top:0,bottom:height,left:0,right:width})}];
   const result=await context.TigerestHomeBackdrop.build(root,new AbortController().signal);assert.ok(result);result.bitmap.close();
  }};
}

test('versioned artwork is decoded once across rebuilt controls; owned output copies may close',async()=>{
 const f=bitmapFixture(),src='http://fixture/Items/one/Images/Primary?tag=version-one';
 await f.build(src);await f.build(src);
 assert.equal(f.decodes,1,'rebuilding the same versioned artwork must not decode its full-size pixels again');
 assert.equal(f.originals[0].closed,false,'worker-owned copies must not close the reusable bitmap');
 await f.build('http://fixture/Items/one/Images/Primary?tag=version-two');
 assert.equal(f.decodes,2,'a new server image tag must use fresh pixels');
 await f.build(src,240,360);assert.equal(f.decodes,3,'a larger requested raster needs its own decoded size');
 f.context.TigerestHomeBackdrop.dispose();assert.ok(f.originals.every(b=>b.closed),'disposing the renderer releases its retained images');
});

test('mutable URLs are not reused merely because their text is unchanged',async()=>{
 const f=bitmapFixture();
 for(const src of ['http://fixture/avatar.png','http://fixture/Items/one/Images/Primary?tag=','http://fixture/other?tag=not-an-image-version']){
  const before=f.decodes;await f.build(src);await f.build(src);assert.equal(f.decodes-before,2);
 }
 f.context.TigerestHomeBackdrop.dispose();
});

test('the decoded artwork cache evicts old images and stays bounded',async()=>{
 const f=bitmapFixture();
 for(let i=0;i<70;i++)await f.build('qrc:/images/'+i+'.png');
 assert.ok(f.originals.filter(b=>!b.closed).length<=64,'entry count stays bounded');
 const before=f.decodes;await f.build('qrc:/images/0.png');assert.equal(f.decodes,before+1,'an evicted image is decoded on demand');
 f.context.TigerestHomeBackdrop.dispose();assert.ok(f.originals.every(b=>b.closed));
});

test('large decoded images obey a pixel budget as well as the entry limit',async()=>{
 const f=bitmapFixture();
 for(let i=0;i<60;i++)await f.build('qrc:/large/'+i+'.png',2400,3600);
 const retained=f.originals.filter(b=>!b.closed);
 assert.ok(retained.length>0);
 assert.ok(retained.reduce((sum,b)=>sum+b.width*b.height,0)<=4*1024*1024);
 f.context.TigerestHomeBackdrop.dispose();assert.ok(f.originals.every(b=>b.closed));
});

test('disposing during a pending decode does not repopulate the cache',async()=>{
 const f=bitmapFixture(),original=f.context.createImageBitmap;
 f.context.createImageBitmap=async(...args)=>{await new Promise(r=>setTimeout(r,5));return original(...args);};
 const pending=f.build('qrc:/late.png');f.context.TigerestHomeBackdrop.dispose();await pending;
 assert.ok(f.originals.every(b=>b.closed),'late build inputs are released rather than retained after disposal');
});

test('a retained larger artwork also serves smaller background previews',async()=>{
 const f=bitmapFixture(),src='http://fixture/Items/one/Images/Backdrop/0?tag=one';
 await f.build(src,2400,3600);await f.build(src,120,180);
 assert.equal(f.decodes,1,'the same hero artwork should not need another source decode for its smaller panel');
 f.context.TigerestHomeBackdrop.dispose();assert.ok(f.originals.every(b=>b.closed));
});

test('a smaller concurrent decode cannot displace a retained larger raster',async()=>{
 const f=bitmapFixture(),src='http://fixture/Items/one/Images/Primary?tag=concurrent';
 await Promise.all([f.build(src,2400,3600),f.build(src,120,180)]);
 const before=f.decodes;await f.build(src,2400,3600);
 assert.equal(f.decodes,before,'finishing a small capture must not force another large-image source decode');
 f.context.TigerestHomeBackdrop.dispose();assert.ok(f.originals.every(b=>b.closed));
});

test('same-origin versioned server artwork decodes from its cached bytes, off the page thread',async()=>{
 // Chromium decodes an <img> source on the main thread while the media wall
 // scrolls; a Blob source is decoded on a worker thread.
 const f=bitmapFixture(),requests=[],sources=[],original=f.context.createImageBitmap;let fail=false;
 f.context.location={href:'http://fixture/web/index.html',origin:'http://fixture'};
 f.context.fetch=async(url,options)=>{requests.push([url,options.cache,options.mode,options.credentials]);if(fail)throw Error('offline');return {ok:true,blob:async()=>({blobSource:url})};};
 f.context.createImageBitmap=async(source,options)=>{sources.push(source.blobSource?'blob':source.tagName||'bitmap');
  return source.blobSource?original({tagName:'IMG'},options):original(source,options);};
 await f.build('http://fixture/emby/Items/7/Images/Primary?maxHeight=540&tag=v7');
 assert.deepEqual(requests,[['http://fixture/emby/Items/7/Images/Primary?maxHeight=540&tag=v7','only-if-cached','same-origin','same-origin']]);
 assert.deepEqual(sources,['blob','bitmap'],'decoded from bytes, then copied for the worker');
 sources.length=0;await f.build('http://other.example/Items/7/Images/Primary?tag=v7');await f.build('http://fixture/avatar.png');
 assert.deepEqual(sources.filter(s=>s!=='bitmap'),['IMG','IMG'],'cross-origin and mutable images keep the element source');
 sources.length=0;fail=true;await f.build('http://fixture/Items/8/Images/Primary?tag=v8');
 assert.deepEqual(sources.filter(s=>s!=='bitmap'),['IMG'],'a failed fetch falls back to the element');
 f.context.TigerestHomeBackdrop.dispose();assert.ok(f.originals.every(b=>b.closed));
});

test('an off-screen media card is skipped as a whole subtree',async()=>{
 // Long media walls hold hundreds of cards; their contents are never in view.
 const measured=[],node=(name,top,children=[])=>({name,tagName:'DIV',childElementCount:children.length,textContent:'',children,closest:()=>null,
  matches:selector=>name.startsWith('card')&&selector.includes('.card'),getBoundingClientRect(){measured.push(name);return {x:0,y:top,width:100,height:100,top,bottom:top+100,left:0,right:100};}});
 const root=node('root',0,[node('card-visible',10,[node('visible-image',10)]),node('card-below',5000,[node('below-image',5000),node('below-title',5100)])]);
 const order=[];(function flat(n){for(const c of n.children){order.push(c);flat(c);}})(root);
 const context={AbortController,performance,setTimeout,clearTimeout,innerWidth:1000,innerHeight:700,Worker:class{postMessage(){queueMicrotask(()=>this.onmessage({data:{bitmap:{close(){}}}}));}terminate(){}},OffscreenCanvas:class{},
  Blob,URL:class extends URL{static createObjectURL(){return 'blob:x';}static revokeObjectURL(){}},createImageBitmap:async()=>({close(){}}),
  NodeFilter:{SHOW_ELEMENT:1,FILTER_ACCEPT:1,FILTER_REJECT:2},getComputedStyle:()=>({visibility:'visible',display:'block',opacity:'1',backgroundColor:'transparent'}),
  document:{createTreeWalker:(start,show,filter)=>{const queue=[...order];return {nextNode(){while(queue.length){const n=queue.shift();
   if(filter.acceptNode(n)===2){const skip=new Set();(function all(x){for(const c of x.children){skip.add(c);all(c);}})(n);for(let i=queue.length-1;i>=0;i--)if(skip.has(queue[i]))queue.splice(i,1);continue;}return n;}return null;}};}}};
 context.window=context;vm.runInNewContext(fs.readFileSync(__dirname+'/../native/homeBackdrop.js','utf8'),context);
 assert.ok(await context.TigerestHomeBackdrop.build(root,new AbortController().signal));
 assert.ok(measured.includes('visible-image'),'visible card contents are captured');
 assert.deepEqual(measured.filter(n=>n.startsWith('below')),[],'contents of an off-screen card are not measured');
});

test('cancelling a build cancels its artwork requests and decodes nothing afterwards',async()=>{
 // A scroll or click aborts a stale rebuild; its fetches must stop with it
 // and no element decode may stand in for an aborted request.
 const requests=[],nodes=Array.from({length:4},(_,i)=>({tagName:'IMG',complete:true,naturalWidth:480,naturalHeight:720,currentSrc:`http://fixture/Items/${i}/Images/Primary?tag=v1`,
  closest:()=>null,matches:()=>false,getBoundingClientRect:()=>({x:0,y:0,width:120,height:180,top:0,bottom:180,left:0,right:120})}));
 let decodes=0,rejectOnAbort=false;
 const context={AbortController,performance,setTimeout,clearTimeout,URL,location:{href:'http://fixture/',origin:'http://fixture'},innerWidth:1000,innerHeight:700,Worker:class{},OffscreenCanvas:class{},
  NodeFilter:{SHOW_ELEMENT:1,FILTER_ACCEPT:1,FILTER_REJECT:2},document:{createTreeWalker:()=>{let i=0;return {nextNode:()=>nodes[i++]||null};}},
  getComputedStyle:()=>({visibility:'visible',display:'block',opacity:'1',backgroundColor:'transparent'}),
  fetch:(url,options)=>new Promise((resolve,reject)=>{const request={url,signal:options.signal,resolve};requests.push(request);
   if(rejectOnAbort)options.signal?.addEventListener('abort',()=>reject(Object.assign(Error('aborted'),{name:'AbortError'})));}),
  createImageBitmap:async(source,options)=>{decodes++;return {width:options?.resizeWidth||29,height:options?.resizeHeight||44,close(){}};}};
 const root={closest:()=>null,getBoundingClientRect:()=>({width:0,height:0})};
 context.window=context;vm.runInNewContext(fs.readFileSync(__dirname+'/../native/homeBackdrop.js','utf8'),context);
 for(const rejecting of [false,true]){
  rejectOnAbort=rejecting;requests.length=0;decodes=0;
  const builds=Array.from({length:3},()=>{const controller=new AbortController(),build=context.TigerestHomeBackdrop.build(root,controller.signal);return {controller,build};});
  await new Promise(r=>setTimeout(r,5));
  assert.ok(requests.length>0&&requests.every(r=>r.signal&&!r.signal.aborted),'each artwork request carries its build signal');
  builds.forEach(b=>b.controller.abort());
  assert.ok(requests.every(r=>r.signal.aborted),'aborting a build aborts its requests');
  requests.forEach(r=>r.resolve({ok:true,blob:async()=>({})}));
  assert.deepEqual(await Promise.all(builds.map(b=>b.build)),[null,null,null]);
  await new Promise(r=>setTimeout(r,5));
  assert.equal(decodes,0,(rejecting?'rejected':'late')+' requests of an aborted build decode nothing, not even the element');
 }
 context.TigerestHomeBackdrop.dispose();
});

test('a cached artwork is not requested again',async()=>{
 const f=bitmapFixture(),requests=[];
 f.context.location={href:'http://fixture/web/index.html',origin:'http://fixture'};
 f.context.fetch=async url=>{requests.push(url);return {ok:true,blob:async()=>({blobSource:url})};};
 const original=f.context.createImageBitmap;f.context.createImageBitmap=(source,options)=>original(source.blobSource?{tagName:'IMG'}:source,options);
 const src='http://fixture/Items/9/Images/Primary?tag=v9';
 await f.build(src);await f.build(src);
 assert.equal(requests.length,1,'the second capture reuses the decoded artwork');
 f.context.TigerestHomeBackdrop.dispose();
});
