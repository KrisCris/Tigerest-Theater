// The glass header: skinHeader blurs the page under it. Its rows, buttons,
// title and tabs also carry backdrop filters (ours on .headerTop, the header
// controls', and a theme's !important ones). In Chromium an element with a
// backdrop filter is a Backdrop Root, so those children only re-filter the
// header's own flat background, yet each costs a filter pass on every
// scrolled frame (device scroll P95 16.7 ms with them, 8.5 ms without).
// Painting that colour directly must look the same, at rest and on hover.
// Real webAppearance and header-control styles; the theme rules mirror a
// popular Jellyfin theme's header selectors.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const withBrowser = require('./community_browser.cjs');
const root = path.resolve(__dirname, '..');
const shell = fs.readFileSync(path.join(root, 'native/nativeshell.js'), 'utf8');
const controls = shell.slice(shell.indexOf('function installHeaderControlsStyle()'), shell.indexOf('function currentServerLabel()'));
// A colourful wall under the header makes any real backdrop blur visible.
const stripes = Array.from({length: 60}, (_, i) => `<div style="height:14px;background:hsl(${i * 47 % 360} 90% ${40 + i % 3 * 15}%)"></div>`).join('');
const page = `<!doctype html><meta charset="utf-8"><style>
body{margin:0;font:16px system-ui}.skinHeader{position:fixed;inset:0 0 auto;z-index:999;display:flex;flex-direction:column;contain:layout style paint}
.headerTop{display:flex;padding:.54em 0}.headerLeft{flex-grow:1;display:flex;align-items:center;gap:8px}.headerRight{display:flex}
.headerTabs{display:flex;justify-content:center}.emby-tabs-slider{display:flex;border-radius:50px}
.emby-tab-button{padding:.7em 1.2em;border:0;background:transparent;color:#fff}
.headerButton{appearance:none;width:2.6em;height:2.6em;border:0;border-radius:50%;background:transparent;color:inherit}.native{appearance:auto}
.headerButton,.pageTitle,.emby-tabs-slider{-webkit-backdrop-filter:blur(15px)!important;backdrop-filter:blur(15px)!important}
.emby-tabs-slider{background-color:rgba(20,20,24,.69)!important}
</style>
<div class="skinHeader skinHeader-withBackground semiTransparent"><div class="headerTop"><div class="headerLeft"><button class="headerButton headerBackButton">‹</button><h3 class="pageTitle">电影</h3><button class="pageTitle native">原生</button></div>
<div class="headerRight"><button class="headerButton" id="search">⌕</button><button class="headerButton headerUserButton">☺</button></div></div>
<div class="headerTabs"><div class="tabs-viewmenubar"><div class="tabs-viewmenubar-slider emby-tabs-slider"><button class="emby-tab-button main-tab-button emby-tab-button-active">电影</button><button class="emby-tab-button main-tab-button">收藏</button></div></div></div></div>
<main>${stripes}</main><script src="/appearance.js"></script><script>${controls};installHeaderControlsStyle();</script>`;
withBrowser({'/': {type: 'text/html', body: page}, '/appearance.js': {path: path.join(root, 'native/webAppearance.js')}}, async ({evaluate, call}) => {
    const frames = () => evaluate('new Promise(r => setTimeout(() => requestAnimationFrame(() => requestAnimationFrame(r)), 400))');
    await call('Emulation.setDeviceMetricsOverride', {width: 600, height: 400, deviceScaleFactor: 1, mobile: false});
    const {userAgent} = await call('Browser.getVersion');
    const load = async agent => {
        await call('Emulation.setUserAgentOverride', {userAgent: agent});
        await call('Page.reload', {ignoreCache: true});
        for (let i = 0; i < 100 && !await evaluate(`document.readyState === 'complete' && !!document.getElementById('tigerest-header-controls-style')`).catch(() => false); i++) await new Promise(r => setTimeout(r, 50));
        await call('Input.dispatchMouseEvent', {type: 'mouseMoved', x: 300, y: 390});
        await frames();
    };
    const filters = () => evaluate(`Object.fromEntries(['.skinHeader', '.headerTop', '.headerBackButton', '.pageTitle', '#search', '.emby-tabs-slider'].map(s => [s, getComputedStyle(document.querySelector(s)).backdropFilter]))`);
    const header = {x: 0, y: 0, width: 600, height: 120, scale: 1};
    const shot = async () => (await call('Page.captureScreenshot', {format: 'png', clip: header})).data;
    const hover = async () => {
        const at = await evaluate(`(() => { const r = document.getElementById('search').getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`);
        await call('Input.dispatchMouseEvent', {type: 'mouseMoved', x: at[0], y: at[1]}); await frames();
        const image = await shot();
        await call('Input.dispatchMouseEvent', {type: 'mouseMoved', x: 300, y: 390}); await frames();
        return image;
    };
    // The previous nested filter stack: an engine without Backdrop Roots.
    await load(userAgent.replace(/(?:Headless)?Chrome\/[\d.]+/, 'Fixture/1'));
    const nestedFilters = await filters();
    assert.equal(nestedFilters['.headerTop'], 'blur(20px) saturate(1.32)', 'fixture: the nested stack is present ' + JSON.stringify(nestedFilters));
    const nested = {rest: await shot(), hover: await hover()};
    await load(userAgent);
    const shipped = await filters();
    assert.equal(shipped['.skinHeader'], 'blur(20px) saturate(1.32)', 'the header keeps its glass');
    for (const child of ['.headerTop', '.headerBackButton', '.pageTitle', '#search', '.emby-tabs-slider'])
        assert.equal(shipped[child], 'none', `${child} runs no filter pass of its own: ${JSON.stringify(shipped)}`);
    assert.equal(await evaluate(`getComputedStyle(document.querySelector('.native')).backdropFilter`), 'blur(15px)', 'a native-appearance control keeps its own filter');
    const flat = {rest: await shot(), hover: await hover()};
    assert.equal((await filters())['#search'], 'none', 'leaving a control restores its flat glass');
    await evaluate(`document.head.insertAdjacentHTML('beforeend', '<style>html body .skinHeader{backdrop-filter:none!important}</style>')`); await frames();
    const clear = await shot();
    const compare = (a, b) => evaluate(`(async () => {
      async function pixels(data) { const image = await createImageBitmap(await (await fetch('data:image/png;base64,' + data)).blob());
        const c = new OffscreenCanvas(image.width, image.height), x = c.getContext('2d'); x.drawImage(image, 0, 0); return x.getImageData(0, 0, c.width, c.height).data; }
      const a = await pixels(${JSON.stringify(a)}), b = await pixels(${JSON.stringify(b)}), d = [];
      for (let i = 0; i < a.length; i += 4) d.push(Math.max(...[0, 1, 2].map(k => Math.abs(a[i + k] - b[i + k]))));
      d.sort((x, y) => x - y);
      return {mean: d.reduce((s, v) => s + v, 0) / d.length, p99: d[Math.floor(d.length * .99)], over20: d.filter(v => v > 20).length, max: d.at(-1)};
    })()`);
    const rest = await compare(flat.rest, nested.rest), hovered = await compare(flat.hover, nested.hover), glass = await compare(flat.rest, clear);
    assert.ok(glass.mean > 4, 'fixture: the header glass itself is visible ' + JSON.stringify(glass));
    for (const [name, d] of [['at rest', rest], ['on hover', hovered]])
        // Left: the antialiased rim of rounded corners (a clipped backdrop
        // versus a rounded background) and the top row's soft drop shadow,
        // which the old filter also copied under the tabs.
        assert.ok(d.mean < .8 && d.p99 <= 8 && d.over20 <= 80, `the flattened header looks the same ${name}: ${JSON.stringify(d)}`);
    console.log(JSON.stringify({passed: true, shipped, rest, hovered, glassVsNone: glass}));
}).catch(error => { console.error(error); process.exitCode = 1; });
