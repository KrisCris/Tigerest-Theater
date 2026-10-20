// A poster transition waits for the background capture. Its server artwork
// is read from bytes the page already has in the HTTP cache; when they are
// gone (evicted, or served uncacheable), the capture must not download the
// artwork again. Real Chromium HTTP cache and the real module.
const assert = require('node:assert/strict'), path = require('node:path');
const withBrowser = require('./community_browser.cjs');
const root = path.resolve(__dirname, '..');
const artwork = '/Items/7/Images/Primary';
let downloads = 0;
const page = `<!doctype html><style>body{margin:0;background:#0b0d12}img{position:absolute;left:0;top:0;width:100vw;height:100vh;object-fit:cover}</style>
<div id="root"><img src="${artwork}?tag=v7"></div><script src="/backdrop.js"></script>`;
const routes = new Proxy({'/': {type: 'text/html', body: page}, '/backdrop.js': {path: path.join(root, 'native/homeBackdrop.js')},
    [artwork]: {type: 'image/png', path: path.join(__dirname, 'fixtures/ambient-a.png')}}, {
    get(target, key) { if (key === artwork) downloads++; return target[key]; },
});
withBrowser(routes, async ({evaluate, call}) => {
    const capture = `(async () => {
      const img = document.querySelector('img'); await img.decode();
      const begin = performance.now(), r = await TigerestHomeBackdrop.build(document.getElementById('root'), new AbortController().signal);
      const canvas = document.createElement('canvas'); canvas.width = r.width; canvas.height = r.height;
      const ctx = canvas.getContext('2d'); ctx.drawImage(r.bitmap, 0, 0); r.bitmap.close();
      return {ms: performance.now() - begin, pixel: [...ctx.getImageData(r.width >> 1, r.height >> 1, 1, 1).data]};
    })()`;
    const background = [11, 13, 18];
    const showsArtwork = pixel => pixel.slice(0, 3).some((v, i) => Math.abs(v - background[i]) > 12);
    const loaded = downloads;
    assert.equal(loaded, 1, 'the page loads its artwork once');
    const cached = await evaluate(capture);
    assert.ok(showsArtwork(cached.pixel), 'cached bytes: artwork is in the capture ' + JSON.stringify(cached));
    assert.equal(downloads, loaded, 'cached bytes are read without a request');
    // The element still holds its decoded image, the HTTP cache does not.
    await call('Network.enable'); await call('Network.clearBrowserCache');
    // A fresh module instance: the first capture's decoded copy is not reused.
    await evaluate(`document.querySelector('script[src="/backdrop.js"]').remove(); new Promise((resolve, reject) => {
      const s = document.createElement('script'); s.src = '/backdrop.js?fresh'; s.onload = resolve; s.onerror = reject; document.body.append(s); })`);
    const evicted = await evaluate(capture);
    assert.ok(showsArtwork(evicted.pixel), 'evicted bytes: the element is decoded instead ' + JSON.stringify(evicted));
    assert.equal(downloads, loaded, 'evicted artwork is not downloaded again for a capture');
    console.log(JSON.stringify({passed: true, downloads, cachedMs: Math.round(cached.ms), evictedMs: Math.round(evicted.ms)}));
}).catch(error => { console.error(error); process.exitCode = 1; });
