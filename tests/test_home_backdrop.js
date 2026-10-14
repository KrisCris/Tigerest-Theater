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
  copies++;assert.equal(source.closed,false,'the retained bitmap must still be alive');return bitmap(source.width,source.height);
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
