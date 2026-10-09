(function () {
    'use strict';
    let active = null, last = null;
    const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const box = node => node?.getBoundingClientRect();
    const usable = node => { const b = box(node); return node?.isConnected && b?.width > 1 && b.height > 1; };
    const page = () => Array.from(document.querySelectorAll('.mainAnimatedPage,.page')).filter(node =>
        !node.classList.contains('hide') && usable(node) && getComputedStyle(node).visibility !== 'hidden').at(-1);
    const style = document.createElement('style');
    style.id = 'tigerest-home-motion-style';
    style.textContent = `
      body.tigerest-motion-busy{pointer-events:none!important}
      .tigerest-motion-layer{position:fixed;inset:0;z-index:2147483000;pointer-events:none!important;overflow:hidden;contain:layout paint}
      .tigerest-motion-veil,.tigerest-motion-scene,.tigerest-motion-frozen{position:absolute;inset:0}
      .tigerest-motion-frozen{filter:blur(7px);transform:scale(1.018);transform-origin:center}
      .tigerest-motion-scene>canvas{position:absolute;inset:-2%;width:104%;height:104%}
      .tigerest-motion-poster{position:fixed;z-index:2147483001;pointer-events:none;transform-origin:0 0;overflow:hidden;background-size:cover;background-position:center;will-change:transform}
      @media(max-width:900px){
        .view-item-item .detailMainContainer:has(.detailImageContainer-main.detailImageContainer-portrait){display:grid!important;grid-template-columns:clamp(90px,18vw,130px) minmax(0,1fr);gap:12px 18px;align-items:center}
        .view-item-item .detailImageContainer-main.detailImageContainer-portrait{display:block!important;grid-column:1;grid-row:1/3;width:100%!important;max-width:none!important;margin:0!important;align-self:center}
        .view-item-item .detailImageContainer-main.detailImageContainer-portrait .card{width:100%!important;padding:0!important;margin:0!important}
        .view-item-item .detailImageContainer-main.detailImageContainer-portrait .cardBox{margin:0!important}
        .view-item-item .detailMainContainer:has(.detailImageContainer-main.detailImageContainer-portrait)>.detailTextContainer{display:contents}
        .view-item-item .detailMainContainer:has(.detailImageContainer-main.detailImageContainer-portrait)>.detailTextContainer>*{grid-column:1/-1}
        .view-item-item .detailMainContainer:has(.detailImageContainer-main.detailImageContainer-portrait)>.detailTextContainer>.detailNameContainer{grid-column:2;grid-row:1;align-self:end;margin:0}
        .view-item-item .detailMainContainer:has(.detailImageContainer-main.detailImageContainer-portrait)>.detailTextContainer>.detail-mediaInfoPrimary{grid-column:2;grid-row:2;align-self:start;margin:0}
      }
    `;
    function ensureStyle() { if (!style.isConnected) document.head.append(style); }
    if (document.head) ensureStyle(); else document.addEventListener('DOMContentLoaded',ensureStyle,{once:true});
    function sleep(job, ms) {
        return new Promise(resolve => {
            if (job.signal.aborted) return resolve();
            const done = () => { clearTimeout(timer); job.signal.removeEventListener('abort', done); resolve(); };
            const timer = setTimeout(done, ms); job.signal.addEventListener('abort', done, {once: true});
        });
    }
    function animate(job, node, frames, options) {
        if (!node || job.signal.aborted) return Promise.resolve();
        const a = node.animate(frames, {...options, fill: 'both'}); job.animations.push(a);
        return a.finished.catch(() => {});
    }
    async function wait(job, predicate, timeout = 2400) {
        const until = performance.now() + timeout;
        while (!job.signal.aborted && performance.now() < until) {
            const result = predicate(); if (result) return result;
            await sleep(job, 32);
        }
        return null;
    }
    function hold(job, node) {
        if (!node || job.held.some(h => h.node === node)) return;
        job.held.push({node, value: node.style.visibility});
        node.style.visibility = 'hidden'; node.setAttribute('data-tigerest-poster-held', '');
    }
    function layer(job) {
        const node = document.createElement('div'); node.className = 'tigerest-motion-layer';
        node.inert = true; node.setAttribute('aria-hidden', 'true');
        job.layers.push(node); document.body.append(node); return node;
    }
    function clean(job) {
        job.animations.forEach(a => a.cancel()); job.layers.forEach(n => n.remove());
        job.held.forEach(({node,value}) => { node.style.visibility = value; node.removeAttribute('data-tigerest-poster-held'); });
        job.canvases.forEach(n => { n.width = n.height = 1; });
        cancelAnimationFrame(job.frame);
        if (active === job) { active = null; document.body.classList.remove('tigerest-motion-busy'); }
    }
    async function run(kind, perform) {
        if (active) return;
        ensureStyle();
        const controller = new AbortController(), job = {controller, signal: controller.signal, animations: [], layers: [], held: [], canvases: [], frames: [], metric: {kind, surfaces: []}};
        active = job; document.body.classList.add('tigerest-motion-busy');
        const start = performance.now(), tick = t => { job.frames.push(t); if (!job.signal.aborted) job.frame = requestAnimationFrame(tick); };
        job.frame = requestAnimationFrame(tick);
        try { return await perform(job); }
        finally {
            clean(job);
            const intervals = job.frames.slice(1).map((t,i) => t - job.frames[i]), sorted = [...intervals].sort((a,b) => a-b);
            last = {...job.metric, totalMs: performance.now()-start, interrupted: job.signal.aborted,
                medianIntervalMs: sorted[Math.floor(sorted.length/2)] || 0, p95IntervalMs: sorted[Math.floor(sorted.length*.95)] || 0};
        }
    }
    function url(node) {
        if (node?.currentSrc || node?.src) return node.currentSrc || node.src;
        const match = /url\((?:"([^"]*)"|'([^']*)'|([^)]*))\)/.exec(node ? getComputedStyle(node).backgroundImage : '');
        return match && (match[1] || match[2] || match[3]);
    }
    // Copy stylesheet elements instead of reading cssRules: Emby may serve CSS from another origin.
    // The shadow tree isolates duplicate IDs and makes the frozen controls inert.
    function frozen(job, blur = true) {
        const host = document.createElement('div'); host.className = 'tigerest-motion-frozen';
        if (!blur) { host.style.filter = 'none'; host.style.transform = 'none'; }
        const home = document.body.classList.contains('tg-home-active') ? document.querySelector('.tg-home-host') : null;
        const shadow = host.attachShadow({mode: 'open'}), html = document.documentElement.cloneNode(false), body = document.body.cloneNode(!home);
        html.classList.add('tigerest-motion-html'); body.classList.remove('tigerest-motion-busy');
        let originalRoot = document.body, copyRoot = body;
        if (home) {
            originalRoot = home; copyRoot = home.cloneNode(true); body.append(copyRoot);
            const rect = box(home), inherited = getComputedStyle(document.body);
            Object.assign(copyRoot.style,{position:'absolute',left:rect.x+'px',top:rect.y+'px',width:rect.width+'px',height:rect.height+'px'});
            Object.assign(body.style,{margin:'0',font:inherited.font,color:inherited.color,background:inherited.backgroundColor});
            // The home has its own complete stylesheet. Avoid reparsing all of Emby's
            // cached view styles and cloning hidden views for every poster press.
            for (const node of document.querySelectorAll('.backgroundContainer,.backdropContainer')) {
                const copy=node.cloneNode(true), r=box(node), s=getComputedStyle(node);
                Object.assign(copy.style,{position:'fixed',left:r.x+'px',top:r.y+'px',width:r.width+'px',height:r.height+'px',opacity:s.opacity,filter:s.filter});
                body.prepend(copy);
            }
        }
        const originals = [originalRoot,...originalRoot.querySelectorAll('*')], copies = [copyRoot,...copyRoot.querySelectorAll('*')];
        const scrolls = [];
        originals.forEach((node,i) => {
            const clone = copies[i];
            if (clone !== body && !body.contains(clone)) return;
            if (node.closest('.tigerest-motion-layer,.tigerest-motion-poster') || node.matches('script,iframe,object,embed,audio,video')) { clone.remove(); return; }
            if (node.matches('.mainAnimatedPage.hide,.page.hide')) { clone.remove(); return; }
            const r = box(node);
            if (r.width && r.height && r.bottom >= 0 && r.top <= innerHeight) {
                const computed = getComputedStyle(node);
                for (const property of ['opacity','transform','filter']) clone.style[property] = computed[property];
            }
            if (node.tagName === 'IMG') { clone.removeAttribute('srcset'); clone.src = node.currentSrc || node.src; clone.loading = 'eager'; }
            for (const attr of Array.from(clone.attributes)) if (/^on/i.test(attr.name)) clone.removeAttribute(attr.name);
            if (node.scrollLeft || node.scrollTop) scrolls.push([clone,node.scrollLeft,node.scrollTop]);
        });
        Object.assign(html.style,{display:'block',width:innerWidth+'px',height:innerHeight+'px',overflow:'hidden'});
        Object.assign(body.style,{width:innerWidth+'px',height:innerHeight+'px',pointerEvents:'none'});
        const computed = getComputedStyle(document.documentElement);
        for (const name of computed) if (name.startsWith('--')) html.style.setProperty(name,computed.getPropertyValue(name));
        document.querySelectorAll('style,link[rel="stylesheet"]').forEach(node => {
            if (node === style || node.closest('.tigerest-motion-layer')) return;
            if (home && node.tagName === 'LINK') return;
            const copy = node.cloneNode(true);
            if (copy.tagName === 'STYLE') copy.textContent = copy.textContent.replace(/:root\b/g,'.tigerest-motion-html');
            else copy.href = node.href;
            shadow.append(copy);
        });
        const override = document.createElement('style');
        override.textContent = '*{animation:none!important;transition:none!important;pointer-events:none!important}';
        shadow.append(override,html); html.append(body);
        job.syncs ||= []; job.syncs.push(() => scrolls.forEach(([n,x,y]) => { n.scrollLeft=x; n.scrollTop=y; }));
        return host;
    }
    function heavy(job) {
        const scale = Math.min(1,240/innerWidth), canvas = document.createElement('canvas');
        canvas.width = Math.min(240,Math.round(innerWidth*scale)); canvas.height = Math.round(innerHeight*scale);
        const ctx = canvas.getContext('2d'); ctx.scale(scale,scale); ctx.fillStyle='#0b0d12'; ctx.fillRect(0,0,innerWidth,innerHeight);
        const root = document.body.classList.contains('tg-home-active') ? document.querySelector('.tg-home-host') || document.body : document.body;
        for (const node of [root,...root.querySelectorAll('*')]) {
            if (node.closest('.tigerest-motion-layer,.tigerest-motion-poster,[data-tigerest-poster-held]')) continue;
            const r = box(node); if (!r.width || !r.height || r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) continue;
            const s = getComputedStyle(node); if (s.display==='none' || s.visibility==='hidden' || +s.opacity===0) continue;
            ctx.save();ctx.globalAlpha=+s.opacity;
            if (s.backgroundColor !== 'rgba(0, 0, 0, 0)' && s.backgroundColor !== 'transparent') {ctx.fillStyle=s.backgroundColor;ctx.fillRect(r.x,r.y,r.width,r.height);}
            if (node.tagName==='IMG' && node.complete && node.naturalWidth) {
                const factor=Math.max(r.width/node.naturalWidth,r.height/node.naturalHeight);
                ctx.beginPath();ctx.rect(r.x,r.y,r.width,r.height);ctx.clip();
                ctx.drawImage(node,r.x+(r.width-node.naturalWidth*factor)/2,r.y+(r.height-node.naturalHeight*factor)/2,node.naturalWidth*factor,node.naturalHeight*factor);
            } else if (node.childElementCount===0 && node.textContent.trim()) {
                ctx.fillStyle=s.color;ctx.font=s.font || '16px sans-serif';ctx.textBaseline='top';ctx.fillText(node.textContent.trim().slice(0,100),r.x,r.y,r.width);
            }
            ctx.restore();
        }
        const result=document.createElement('canvas');result.width=canvas.width;result.height=canvas.height;
        const blur=result.getContext('2d');blur.filter='blur(5px)';blur.drawImage(canvas,0,0);canvas.width=canvas.height=1;
        job.canvases.push(result);job.metric.surfaces.push({width:result.width,height:result.height,blur:5});
        return result;
    }
    function scene(job) {
        const group=document.createElement('div');group.className='tigerest-motion-scene';
        const light=frozen(job), bitmap=heavy(job);group.append(light,bitmap);return {group,bitmap};
    }
    function sync(job) { job.syncs?.forEach(fn => fn()); }
    async function simple(job,navigate) {
        const before=page(), result=await navigate();
        const target=await wait(job,()=>{const n=page();return n!==before?n:null;},1200);
        if (target) await animate(job,target,[{opacity:0},{opacity:1}],{duration:110});
        job.metric.fallback=reduced()?'reduced-motion':'missing-poster';return result;
    }
    const transitions = {
        get busy() { return !!active; }, get last() { return last; },
        cancel(reason = 'reset') { if (active) { const job=active;job.controller.abort(reason);clean(job); } },
        poster(options) { return run('poster',async job => {
            const source=options.source, artwork=url(source);
            if (reduced() || !usable(source) || !artwork) return simple(job,options.navigate);
            const from=box(source), previous=page(), begin=performance.now();
            const floating=document.createElement('div');floating.className='tigerest-motion-poster';floating.setAttribute('aria-hidden','true');
            Object.assign(floating.style,{left:from.x+'px',top:from.y+'px',width:from.width+'px',height:from.height+'px',backgroundImage:'url('+JSON.stringify(artwork)+')',borderRadius:getComputedStyle(source).borderRadius});
            job.layers.push(floating);document.body.append(floating);hold(job,source);
            const fromScene=scene(job), cover=layer(job), veil=document.createElement('div');veil.className='tigerest-motion-veil';veil.append(fromScene.group);cover.append(veil);sync(job);
            job.metric.prepareMs=performance.now()-begin;
            const soft='cubic-bezier(.4,0,.6,1)';
            // Reach an opaque blur before changing the real page. Slow routes stay covered.
            await Promise.all([animate(job,veil,[{opacity:0},{opacity:1}],{duration:210,easing:soft}),
                animate(job,fromScene.bitmap,[{opacity:0,offset:0},{opacity:0,offset:.25},{opacity:1,offset:1}],{duration:210,easing:soft})]);
            if (job.signal.aborted && job.signal.reason !== 'resize') return;
            const result=await options.navigate();
            if (job.signal.aborted) return result;
            if (options.prepareTarget) {
                await wait(job,()=>page()!==previous && page());
                if (!job.signal.aborted && !usable(options.findTarget())) await options.prepareTarget(job.signal);
            }
            let target=await wait(job,()=>{const n=options.findTarget();return page()!==previous && usable(n)?n:null;});
            if (target && options.direction==='return') {target.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'});await sleep(job,64);}
            if (!usable(target)) { job.metric.fallback='missing-target';await animate(job,cover,[{opacity:1},{opacity:0}],{duration:220,easing:soft});return result; }
            // Allow image decoding and responsive layout to finish before reading the landing rectangle.
            if (target.tagName==='IMG' && !target.complete) await wait(job,()=>target.complete,1200);
            let prior=box(target), steady=0;
            for (let i=0;i<18 && steady<5 && !job.signal.aborted;i++) {
                await sleep(job,32); const current=box(target);
                steady=Math.max(...['x','y','width','height'].map(k=>Math.abs(current[k]-prior[k])))<.5 ? steady+1 : 0;prior=current;
            }
            if(job.signal.aborted)return result;
            const to=box(target);hold(job,target);
            const toScene=scene(job);veil.append(toScene.group);sync(job);
            const duration=720;
            const transform = rect => `translate3d(${rect.x-from.x}px,${rect.y-from.y}px,0) scale(${rect.width/from.width},${rect.height/from.height})`;
            const fly = async () => {
                const a=floating.animate([{transform:'none'},{transform:transform(to)}],{duration,easing:'cubic-bezier(.32,.05,.2,1)',fill:'both'});
                job.animations.push(a);a.finished.catch(()=>{});
                await sleep(job,560);if(job.signal.aborted)return;
                // Emby can finish responsive layout during the flight. Rejoin its final
                // rectangle in the last 160 ms, without reading geometry every frame.
                const at=getComputedStyle(floating).transform;floating.style.transform=at;a.cancel();
                await animate(job,floating,[{transform:at},{transform:transform(box(target))}],{duration:160,easing:'cubic-bezier(.2,.6,.3,1)'});
            };
            await Promise.all([
                fly(),
                animate(job,toScene.group,[{opacity:0,offset:0},{opacity:0,offset:.16},{opacity:1,offset:.48},{opacity:1,offset:1}],{duration,easing:'linear'}),
                ...[fromScene.bitmap,toScene.bitmap].map(node=>animate(job,node,[{opacity:1,offset:0},{opacity:1,offset:.56,easing:soft},{opacity:0,offset:.88},{opacity:0,offset:1}],{duration,easing:'linear'})),
                animate(job,veil,[{opacity:1,offset:0},{opacity:1,offset:.7,easing:soft},{opacity:0,offset:1}],{duration,easing:'linear'})
            ]);
            const landing=box(floating), actual=box(target);
            job.metric.landingErrorPx=Math.max(...['x','y','width','height'].map(key=>Math.abs(landing[key]-actual[key])));
            return result;
        }); },
        library({gallery,navigate,samePage = false}) { return run('library',async job => {
            if (reduced() || !gallery?.active) return simple(job,navigate);
            const cover=layer(job), copy=frozen(job,false);cover.style.background='#0b0d12';cover.append(copy);sync(job);
            const shadow=copy.shadowRoot;
            const nav=shadow.querySelector('.tg-home-nav'), rail=shadow.querySelector('.tg-home-rail'), stage=shadow.querySelector('.tg-home-stage');
            const accelerated='cubic-bezier(.65,0,.85,.25)';
            await Promise.all([
                animate(job,nav,[{transform:'none',opacity:1,offset:0},{transform:'translate3d(0,18px,0) rotate(1deg)',opacity:1,offset:.19},{transform:'translate3d(-36px,-130vh,0) rotate(-7deg)',opacity:0,offset:1}],{duration:380,easing:accelerated}),
                animate(job,rail,[{transform:'none',opacity:1,offset:0},{transform:'translate3d(-24px,0,0) skewX(-2deg)',opacity:1,offset:.16},{transform:'translate3d(130vw,0,0) skewX(8deg)',opacity:0,offset:1}],{duration:410,easing:accelerated}),
                animate(job,stage,[{opacity:1,transform:'none'},{opacity:0,transform:'scale(.95)'}],{duration:260}),
                animate(job,copy,[{opacity:1,offset:0},{opacity:1,offset:.58},{opacity:0,offset:1}],{duration:410})
            ]);
            if (job.signal.aborted && job.signal.reason !== 'resize') return;
            cover.style.background='#0b0d12';const previous=page(),result=await navigate();
            const target=await wait(job,()=>{const n=page();return n && (n!==previous || (samePage && !gallery.active)) ? n : null;});
            if (target && !job.signal.aborted) {
                await sleep(job,100);const incoming=frozen(job,false);cover.replaceChildren(incoming);sync(job);
                await animate(job,incoming,[{opacity:0,transform:'scale(.82)',offset:0},{opacity:1,transform:'scale(1.008)',offset:.82},{opacity:1,transform:'none',offset:1}],{duration:460,easing:'cubic-bezier(.16,.8,.22,1)'});
            }
            return result;
        }); },
        homeReturn({navigate,findGallery}) { return run('homeReturn',async job => {
            if (reduced()) return simple(job,navigate);
            const cover=layer(job),copy=frozen(job,false);cover.style.background='#0b0d12';cover.append(copy);sync(job);
            await animate(job,copy,[{opacity:1,transform:'none'},{opacity:0,transform:'scale(.82)'}],{duration:320,easing:'cubic-bezier(.6,0,.8,.4)'});
            if (job.signal.aborted && job.signal.reason !== 'resize') return;
            cover.style.background='#0b0d12';const result=await navigate();
            const home=await wait(job,()=>{const g=findGallery();return g?.active?g:null;});
            if (home && !job.signal.aborted) {
                cover.remove();
                // start/onResume owns the shipping Gallery entrance. Never replace its keyframes.
                await wait(job,()=>home.root.classList.contains('tg-entered'),4000);
            }
            return result;
        }); }
    };
    window.addEventListener('resize',()=>transitions.cancel('resize'));
    window.TigerestHomeTransitions=transitions;
}());
