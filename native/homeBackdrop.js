(function () {
    'use strict';
    // Rasterize only small decoded images in a worker. Full-size poster decoding
    // and Canvas clipping used to block the first animation frame on the UI thread.
    function paint(records,width,height,scale) {
          const canvas=new OffscreenCanvas(width,height),ctx=canvas.getContext('2d');
          ctx.scale(scale,scale);ctx.fillStyle='#0b0d12';ctx.fillRect(0,0,width/scale,height/scale);
          for(const r of records){
            ctx.save();ctx.globalAlpha=r.alpha;
            if(r.background){ctx.fillStyle=r.background;ctx.fillRect(r.x,r.y,r.w,r.h);}
            if(r.bitmap){
              const factor=Math.max(r.w/r.bitmap.width,r.h/r.bitmap.height);
              ctx.beginPath();ctx.rect(r.x,r.y,r.w,r.h);ctx.clip();
              ctx.drawImage(r.bitmap,r.x+(r.w-r.bitmap.width*factor)/2,r.y+(r.h-r.bitmap.height*factor)/2,r.bitmap.width*factor,r.bitmap.height*factor);
            }else if(r.text){ctx.fillStyle=r.color;ctx.font=r.font||'16px sans-serif';ctx.textBaseline='top';ctx.fillText(r.text,r.x,r.y,r.w);}
            ctx.restore();
          }
          const result=new OffscreenCanvas(width,height),blur=result.getContext('2d');
          blur.filter='blur(5px)';blur.drawImage(canvas,0,0);
          return result.transferToImageBitmap();
    }
    const workerSource = `${paint.toString()}
      self.onmessage = event => {
        const {records,width,height,scale}=event.data, begin=performance.now();
        try {
          const bitmap=paint(records,width,height,scale);
          self.postMessage({bitmap,rasterMs:performance.now()-begin,rasterThread:'worker'},[bitmap]);
        }catch(error){self.postMessage({error:String(error)});}
        finally{for(const r of records)r.bitmap?.close();}
      };`;
    async function build(root, signal) {
        if (!window.Worker || !window.OffscreenCanvas || !window.createImageBitmap) return null;
        const begin = performance.now(), scale = Math.min(1,240/innerWidth);
        const width = Math.min(240,Math.round(innerWidth*scale)), height = Math.round(innerHeight*scale), records = [], images = [];
        for (const node of [root,...root.querySelectorAll('*')]) {
            if (signal.aborted) return null;
            if (node.closest('.tigerest-motion-layer,.tigerest-motion-poster,.tigerest-motion-cache,[data-tigerest-poster-held]')) continue;
            const r=node.getBoundingClientRect();
            if (!r.width || !r.height || r.bottom<0 || r.top>innerHeight || r.right<0 || r.left>innerWidth) continue;
            const s=getComputedStyle(node);if (s.visibility==='hidden' || s.display==='none' || +s.opacity===0) continue;
            const record={x:r.x,y:r.y,w:r.width,h:r.height,alpha:+s.opacity,
                background:s.backgroundColor==='transparent'||s.backgroundColor==='rgba(0, 0, 0, 0)'?null:s.backgroundColor};
            if (node.tagName==='IMG' && node.complete && node.naturalWidth) images.push({node,record});
            else if (!node.childElementCount && node.textContent.trim()) Object.assign(record,{text:node.textContent.trim().slice(0,100),font:s.font,color:s.color});
            records.push(record);
        }
        const captureMs=performance.now()-begin, resizeStart=performance.now(), owned=[];
        try {
            // Bound concurrent decodes and keep transferred images below 240px.
            let index=0,decodeFailed=false;
            await Promise.allSettled(Array.from({length:Math.min(4,images.length)},async()=>{
                while(index<images.length && !signal.aborted && !decodeFailed){
                    const {node,record}=images[index++];
                    const w=Math.max(1,Math.min(240,Math.ceil(Math.max(record.w*scale,record.h*scale*node.naturalWidth/node.naturalHeight))));
                    let bitmap;
                    try{bitmap=await createImageBitmap(node,{resizeWidth:w,resizeHeight:Math.max(1,Math.round(w*node.naturalHeight/node.naturalWidth)),resizeQuality:'low'});}
                    catch(error){decodeFailed=true;throw error;}
                    owned.push(bitmap);record.bitmap=bitmap;
                }
            }));
            if (signal.aborted || decodeFailed) return null;
            const resizeMs=performance.now()-resizeStart;
            const result=await new Promise(resolve=>{
                const objectUrl=URL.createObjectURL(new Blob([workerSource],{type:'text/javascript'}));
                let worker,timer,done=false;
                const finish=value=>{
                    if(done){value?.bitmap?.close();return;}done=true;
                    clearTimeout(timer);signal.removeEventListener('abort',abort);worker?.terminate();URL.revokeObjectURL(objectUrl);resolve(value);
                };
                const abort=()=>finish(null);
                try {
                    worker=new Worker(objectUrl);worker.onmessage=event=>finish(event.data.error?null:event.data);worker.onerror=()=>finish(null);
                    signal.addEventListener('abort',abort,{once:true});timer=setTimeout(abort,2000);
                    worker.postMessage({records,width,height,scale},owned);
                }catch(error){
                    // Native Android appasset images may be non-origin-clean.
                    // A failed transfer keeps all inputs here; compose only the
                    // already resized bitmaps without weakening origin policies.
                    if(error.name==='DataCloneError'&&!signal.aborted){
                        try{const start=performance.now();finish({bitmap:paint(records,width,height,scale),rasterMs:performance.now()-start,rasterThread:'main-small'});}
                        catch{finish(null);}
                    }else finish(null);
                }
            });
            return result && {...result,width,height,captureMs,resizeMs,totalMs:performance.now()-begin};
        }catch(error){return null;}
        finally{owned.forEach(bitmap=>bitmap.close());}
    }
    window.TigerestHomeBackdrop={build};
}());
