// The shared transition cache watches page mutations while a media wall
// scrolls, lazy-loads posters and animates. Deciding whether a mutation
// matters must not read layout; real modules in Chrome.
const assert = require('node:assert/strict'), path = require('node:path');
const withBrowser = require('./community_browser.cjs');
const root = path.resolve(__dirname, '..');
const cards = Array.from({length: 120}, (_, i) => `<div class="card"><div class="cardImageContainer" style="background:#2${i % 10}3"></div><div class="cardText">作品 ${i}</div></div>`).join('');
const page = `<!doctype html><meta charset="utf-8"><style>body{margin:0;background:#101216;color:#eee;font:14px system-ui}.skinHeader{position:fixed;inset:0 0 auto;height:60px;background:#181c24}
.page{padding:70px 20px;display:flex;flex-wrap:wrap;gap:12px}.page.hide{display:none}.card{width:160px}.cardImageContainer{height:220px}</style>
<div class="skinHeader"><span id="clock">00:00</span></div><div class="mainAnimatedPage page hide" id="cached"><div class="card" id="old">旧页面</div></div>
<div class="mainAnimatedPage page" id="wall">${cards}</div>
<script>window.jmpInfo = {settings: {}};</script><script src="/backdrop.js"></script><script src="/transitions.js"></script>`;
withBrowser({'/': {type: 'text/html', body: page}, '/backdrop.js': {path: path.join(root, 'native/homeBackdrop.js')},
    '/transitions.js': {path: path.join(root, 'native/homeTransitions.js')}}, async ({evaluate, call}) => {
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
    await call('Emulation.setEmulatedMedia', {features: [{name: 'prefers-reduced-motion', value: 'no-preference'}]});
    const ready = async () => { for (let i = 0; i < 200 && !await evaluate('TigerestHomeTransitions.cacheState.ready'); i++) await wait(25); return evaluate('TigerestHomeTransitions.cacheState.ready'); };
    await evaluate('TigerestHomeTransitions.prewarm()');
    assert.equal(await ready(), true, 'the page cache warms');
    // Lazy-load and animation style churn inside the visible wall: count layout
    // reads made by the observer itself, before any debounced rebuild.
    const reads = await evaluate(`new Promise(resolve => {
      const original = Element.prototype.getBoundingClientRect; let reads = 0;
      Element.prototype.getBoundingClientRect = function () { reads++; return original.call(this); };
      const nodes = [...document.querySelectorAll('#wall .cardImageContainer')];
      let round = 0;
      const step = () => {
        for (const node of nodes.slice(round * 10, round * 10 + 10)) { node.style.opacity = String(0.5 + round / 40); node.classList.toggle('lazy-loaded'); }
        if (++round < 12) setTimeout(step, 0);
        else setTimeout(() => { Element.prototype.getBoundingClientRect = original; resolve(reads); }, 0);
      };
      step();
    })`);
    assert.equal(reads, 0, 'mutation relevance is decided without layout reads');
    assert.equal(await evaluate('TigerestHomeTransitions.cacheState.ready'), false, 'a change in the visible page still invalidates the cache');
    // Changes in a hidden cached view, or a same-value attribute write, keep it.
    assert.equal(await ready(), true, 'the cache warms again after the page settles');
    await evaluate(`document.querySelector('#old').classList.add('changed'); const n = document.querySelector('#wall .card'); n.className = n.className`);
    await wait(20);
    assert.equal(await evaluate('TigerestHomeTransitions.cacheState.ready'), true, 'hidden views and no-op writes do not invalidate');
    // The header is part of the picture.
    await evaluate(`document.querySelector('.skinHeader').classList.add('scrolled')`);
    await wait(20);
    assert.equal(await evaluate('TigerestHomeTransitions.cacheState.ready'), false, 'header changes invalidate');
    console.log(JSON.stringify({passed: true, observerLayoutReads: reads}));
}).catch(error => { console.error(error); process.exitCode = 1; });
