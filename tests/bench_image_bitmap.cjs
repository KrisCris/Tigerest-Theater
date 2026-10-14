// Opt-in native-engine regression/performance probe. No server account is used.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const withBrowser=require('./community_browser.cjs');
const option=name=>process.argv.find(a=>a.startsWith('--'+name+'='))?.split('=').slice(1).join('=');
const fixtures=path.resolve(option('fixtures')||''),output=option('output'),expected=option('expect');
assert.ok(option('fixtures'),'supply --fixtures=<synthetic corpus directory>');
const names=['large.jpg','alpha.png','wide.png','orientation.jpg','sixteen.png','animated.gif'];
const routes={'/':{type:'text/html',body:'<!doctype html><title>Image bitmap probe</title><style>body{margin:0;background:#17263a;color:white}img{position:fixed;left:-10000px;width:32px;height:32px}</style><p>Isolated image decoding probe</p>'}};
const hashes={};
for(const name of names){const p=path.join(fixtures,name);routes['/'+name]={path:p,type:name.endsWith('.jpg')?'image/jpeg':name.endsWith('.gif')?'image/gif':'image/png'};hashes[name]=crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');}
withBrowser(routes,async({evaluate})=>{
 await evaluate(`window.TigerestHomeTransitions?.dispose?.();true`);
 const result=await evaluate(`(async()=>{
  const load=async(src,realm=window)=>{const n=new realm.Image();n.src=src;await n.decode();return n;};
  const images={};for(const name of ${JSON.stringify(names)})images[name]=await load('/'+name);
  const pixels=async b=>{const c=document.createElement('canvas');c.width=b.width;c.height=b.height;const ctx=c.getContext('2d');ctx.drawImage(b,0,0);const data=ctx.getImageData(0,0,c.width,c.height).data;
   const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',data))].map(n=>n.toString(16).padStart(2,'0')).join('');return {width:b.width,height:b.height,hash};};
  const cases=[
   ['alpha','alpha.png',{resizeWidth:48,resizeHeight:32}],
   ['alpha-straight','alpha.png',{resizeWidth:48,resizeHeight:32,premultiplyAlpha:'none'}],
   ['flip','alpha.png',{resizeWidth:48,resizeHeight:32,imageOrientation:'flipY'}],
   ['crop','alpha.png',{resizeWidth:32,resizeHeight:20},[5,7,40,24]],
   ['outside-crop','alpha.png',{resizeWidth:32,resizeHeight:20},[-12,-8,120,90]],
   ['blank-crop','alpha.png',{resizeWidth:16,resizeHeight:16},[9999,9999,8,8]],
   ['wide-default','wide.png',{resizeWidth:48,resizeHeight:32}],
   ['wide-no-conversion','wide.png',{resizeWidth:48,resizeHeight:32,colorSpaceConversion:'none'}],
   ['orientation','orientation.jpg',{resizeWidth:48,resizeHeight:64}],
   ['orientation-none','orientation.jpg',{resizeWidth:48,resizeHeight:64,imageOrientation:'none'}],
   ['orientation-crop','orientation.jpg',{resizeWidth:32,resizeHeight:24},[8,10,70,50]],
   ['sixteen','sixteen.png',{resizeWidth:48,resizeHeight:32}],
   ['animated-first-frame','animated.gif',{resizeWidth:32,resizeHeight:24}],
   ...['pixelated','low','medium','high'].map(q=>['quality-'+q,'alpha.png',{resizeWidth:47,resizeHeight:31,resizeQuality:q}])
  ];
  const checks={};for(const [name,file,opts,crop] of cases){const b=await createImageBitmap(images[file],...(crop||[]),opts);try{checks[name]=await pixels(b);}finally{b.close();}}
  const changing=await load('/alpha.png'),promise=createImageBitmap(changing,{resizeWidth:48,resizeHeight:32});changing.src='/orientation.jpg';
  const snapshot=await promise;checks['source-snapshot']=await pixels(snapshot);snapshot.close();
  const crossURL=new URL('/alpha.png',location.href);crossURL.hostname='localhost';const foreign=await load(crossURL.href);
  const opaque=await createImageBitmap(foreign,{resizeWidth:32,resizeHeight:24});const security={};
  try{await pixels(opaque);security.readback='allowed';}catch(e){security.readback=e.name;}
  try{const copy=structuredClone(opaque,{transfer:[opaque]});copy.close();security.transfer='allowed';}catch(e){security.transfer=e.name;}opaque.close();
  // A surviving parent caller must still receive the result when only the
  // source image's document disappears during decoding.
  const sourceFrame=document.createElement('iframe');document.body.append(sourceFrame);
  const childImage=await load('/large.jpg',sourceFrame.contentWindow);
  if(childImage.ownerDocument!==sourceFrame.contentDocument)throw Error('Fixture image must belong to child document');
  await new Promise(resolve=>setTimeout(resolve,200));
  const parentPromise=createImageBitmap(childImage,{resizeWidth:240,resizeHeight:160});sourceFrame.remove();
  let detachedTimer;
  const detachedSource=await Promise.race([
   parentPromise.then(async b=>{try{return {completed:true,pixels:await pixels(b)};}finally{b.close();}}),
   new Promise(resolve=>{detachedTimer=setTimeout(()=>resolve({completed:false}),2000);})
  ]);clearTimeout(detachedTimer);
  if(!detachedSource.completed)throw Error('Parent bitmap promise stranded when source iframe was removed');
  const parentReference=await createImageBitmap(images['large.jpg'],{resizeWidth:240,resizeHeight:160});
  try{if(JSON.stringify(detachedSource.pixels)!==JSON.stringify(await pixels(parentReference)))throw Error('Detached source pixels changed');}finally{parentReference.close();}
  const frame=document.createElement('iframe');document.body.append(frame);
  frame.contentWindow.createImageBitmap(images['large.jpg'],{resizeWidth:240,resizeHeight:160}).then(b=>b.close(),()=>{});frame.remove();await new Promise(r=>setTimeout(r,150));
  const calls=[],intervals=[];let id,previous=await new Promise(requestAnimationFrame);
  const tick=t=>{intervals.push(t-previous);previous=t;id=requestAnimationFrame(tick);};id=requestAnimationFrame(tick);
  try{for(let i=0;i<3;i++){const t=performance.now(),pending=createImageBitmap(images['large.jpg'],{resizeWidth:240,resizeHeight:160}),syncMs=performance.now()-t;const b=await pending;calls.push({syncMs,totalMs:performance.now()-t,width:b.width,height:b.height});b.close();await new Promise(r=>setTimeout(r,30));}}
  finally{cancelAnimationFrame(id);}
  return {checks,security,detachedSource,calls,maxSyncMs:Math.max(...calls.map(c=>c.syncMs)),maxFrameIntervalMs:Math.max(...intervals)};
 })()`);
 assert.equal(result.security.readback,'SecurityError','cross-origin bitmap must remain unreadable');
 assert.equal(result.security.transfer,'DataCloneError','cross-origin bitmap must remain nontransferable');
 assert.deepEqual(result.checks['source-snapshot'],result.checks.alpha,'changing src after the call must not change its captured pixels');
 const report={fixtures:hashes,...result};if(output)fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');
 if(expected){const before=JSON.parse(fs.readFileSync(expected));assert.deepEqual(report.fixtures,before.fixtures,'use the same corpus');assert.deepEqual(report.checks,before.checks,'all transformed pixels must match the previous engine');assert.deepEqual(report.security,before.security);}
 console.log(JSON.stringify({pixelCases:Object.keys(result.checks).length,security:result.security,maxSyncMs:result.maxSyncMs,maxFrameIntervalMs:result.maxFrameIntervalMs,calls:result.calls}));
 if(process.argv.includes('--assert-async'))assert.ok(result.maxSyncMs<=8.33,'source decoding exceeds one 120 Hz UI frame: '+result.maxSyncMs+' ms');
},{gpu:true,visible:true}).catch(error=>{console.error(error);process.exitCode=1;});
