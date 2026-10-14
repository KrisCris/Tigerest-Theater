// Ambient artwork must remain local without changing either crossfade layer.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const withBrowser = require('./community_browser.cjs');
const source = process.env.TIGEREST_AMBIENT_REFERENCE || path.resolve(__dirname, '../native/webAppearance.js');
const routes = {
    '/': {type:'text/html', body:`<!doctype html><style>
      body{margin:0} .backgroundContainer{inset:0} .page{position:relative;visibility:hidden}
      </style><div class="backgroundContainer"></div><main class="page"></main>`},
    '/a.svg': {type:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240"><rect width="320" height="240" fill="#edbd46"/><circle cx="70" cy="70" r="65" fill="#891737"/></svg>'},
    '/b.svg': {type:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240"><rect width="320" height="240" fill="#237dba"/><circle cx="250" cy="170" r="65" fill="#96dbc8"/></svg>'},
};
withBrowser(routes, async ({call, evaluate, url}) => {
    await call('Emulation.setDeviceMetricsOverride',{width:800,height:600,deviceScaleFactor:1,mobile:false});
    await evaluate(`document.querySelector('main').innerHTML = '<div><span>unrelated content</span></div>'.repeat(1500)`);
    const {frameTree} = await call('Page.getFrameTree');
    const {executionContextId} = await call('Page.createIsolatedWorld',{
        frameId:frameTree.frame.id,worldName:'ambient-fixture',
    });
    async function isolated(expression) {
        const r = await call('Runtime.evaluate',{contextId:executionContextId,expression,awaitPromise:true,returnByValue:true});
        assert.equal(r.exceptionDetails,undefined);
        return r.result.value;
    }
    // Replace the injected stylesheet in the same task, before either world's
    // head observer runs. Production native injection remains enabled.
    await isolated(`document.querySelector('style[data-tigerest-owned="web-appearance"]')?.remove();\n${fs.readFileSync(source,'utf8')}`);
    await isolated(`window.ambientState = () => {
        const bg=document.querySelector('.backgroundContainer'),root=document.documentElement;
        const owner=bg.style.getPropertyValue('--tgs-ambient-image-a') ? bg : root;
        const phase=root.classList.contains('tigerest-ambient-phase-b')?'b':'a';
        const styles=['::before','::after'].map(p=>{const s=getComputedStyle(bg,p);return {image:s.backgroundImage,opacity:s.opacity,filter:s.filter,transform:s.transform,transition:s.transitionDuration};});
        return {active:owner.style.getPropertyValue('--tgs-ambient-image-'+phase),phase,styles,
            unrelated:getComputedStyle(document.querySelector('main span')).getPropertyValue('--tgs-ambient-image-a'),
            rootClass:root.classList.contains('tigerest-ambient-phase-b')};
    };
    window.setAmbient = name => new Promise((resolve,reject)=>{
        const art=document.createElement('img');art.className='primaryImage';
        art.src=${JSON.stringify(url)}+'/'+name+'.svg';
        updateTigerestAmbient(art);const deadline=performance.now()+2500;
        const poll=()=>{if(ambientState().active.includes('/'+name+'.svg'))return resolve();
            if(performance.now()>deadline)return reject(Error('Ambient artwork failed to load'));setTimeout(poll,10);};poll();
    });`);
    const frames=[],states=[];
    for(const name of ['a','b','a']) {
        await isolated(`setAmbient('${name}')`);
        // Pause at the same point in every crossfade, then verify the end state.
        const sample=await isolated(`new Promise(resolve=>requestAnimationFrame(()=>{
            const bg=document.querySelector('.backgroundContainer');
            for(const animation of bg.getAnimations({subtree:true})){animation.pause();animation.currentTime=425;}
            resolve(ambientState());
        }))`);
        assert.ok(sample.styles.every(s=>s.filter.includes('blur(58px)')));
        assert.ok(sample.styles.every(s=>s.transition.includes('0.85s')));
        const midpoint=await call('Page.captureScreenshot',{format:'png'});
        frames.push(crypto.createHash('sha256').update(Buffer.from(midpoint.data,'base64')).digest('hex'));
        await isolated(`for(const animation of document.querySelector('.backgroundContainer').getAnimations({subtree:true}))animation.finish()`);
        const state=await isolated('ambientState()');states.push(state);
        if(!process.env.TIGEREST_AMBIENT_REFERENCE) {
            assert.equal(state.unrelated.trim(),'','background artwork must not propagate to unrelated content');
        }
    }
    assert.equal(states[1].phase,'b');
    assert.equal(states[1].styles[0].opacity,'0');
    assert.equal(states[1].styles[1].opacity,'0.92');
    await isolated(`setAmbient('b').then(()=>new Promise(resolve=>setTimeout(resolve,950)))`);
    const before=await isolated('ambientState()');
    await isolated(`const old=document.querySelector('.backgroundContainer'),wrapper=document.createElement('section');
        wrapper.innerHTML='<div class="backgroundContainer"></div>';old.replaceWith(wrapper);
        new Promise(resolve=>setTimeout(resolve,0))`);
    const after=await isolated('ambientState()');

    assert.deepEqual(after.styles,before.styles,'background replacement preserves both layers and their appearance');
    assert.equal(after.active,before.active);
    if(process.env.TIGEREST_AMBIENT_BASELINE_RESULT) {
        const reference=JSON.parse(fs.readFileSync(process.env.TIGEREST_AMBIENT_BASELINE_RESULT,'utf8'));
        assert.deepEqual(frames,reference.midpointHashes,'crossfade pixels must match the reference implementation');
    }
    console.log(JSON.stringify({midpointHashes:frames,phases:states.map(s=>s.phase),replacement:true,isolated:!process.env.TIGEREST_AMBIENT_REFERENCE}));
},{gpu:true}).catch(error=>{console.error(error);process.exitCode=1});
