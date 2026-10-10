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
