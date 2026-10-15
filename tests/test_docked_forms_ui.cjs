// Emby aligns its form columns to the left whenever the navigation drawer is
// docked, which leaves most of a wide window empty. The appearance script
// keeps them centered beside the drawer, in a real Chromium layout.
const assert = require('node:assert/strict');
const path = require('node:path');
const withBrowser = require('./community_browser.cjs');
const root = path.resolve(__dirname, '..');
const routes = {
    // The three rules Emby 4.8 to 4.10 apply to a settings form's column:
    // a .readOnlyContent wrapper (4.10, client settings) or the form itself (4.8, 4.9).
    '/': {type: 'text/html', body: `<!doctype html><style>
      body{margin:0}.mainDrawer{position:fixed;left:0;top:0;bottom:0;width:240px}
      .page{position:absolute;top:0;left:240px;right:0;height:300px}.page+.page{top:300px}
      .padded-left{padding-left:43px}.padded-right{padding-right:43px}
      form, .readOnlyContent {max-width:80ch}
      .auto-center {margin-inline:auto}
      .page-withDockedDrawer .auto-center {margin-inline:0}
      </style><aside class="mainDrawer"></aside>
      <div class="page page-withDockedDrawer"><div class="scrollSlider padded-left padded-right">
      <div class="readOnlyContent auto-center"><form>Display settings</form></div></div></div>
      <div class="page page-withDockedDrawer"><div class="scrollSlider padded-left padded-right">
      <form class="auto-center fieldsets">Playback settings</form></div></div>
      <script src="/appearance.js"></script>`},
    '/appearance.js': {path: path.join(root, 'native/webAppearance.js')},
};
withBrowser(routes, async ({evaluate, call}) => {
    for (const width of [1280, 2560]) {
        await call('Emulation.setDeviceMetricsOverride', {width, height: 900, deviceScaleFactor: 1, mobile: false});
        const columns = await evaluate(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => {
          resolve([...document.querySelectorAll('.scrollSlider > .auto-center')].map(element => {
            const column = element.getBoundingClientRect(), slider = element.parentElement;
            const area = slider.getBoundingClientRect(), style = getComputedStyle(slider);
            return {kind: element.className, left: column.left - area.left - parseFloat(style.paddingLeft),
                    right: area.right - parseFloat(style.paddingRight) - column.right, width: column.width,
                    ready: document.body.classList.contains('tigerest-appearance-ready')};
          }));
        })))`);
        assert.equal(columns.length, 2);
        for (const gaps of columns) {
            assert.equal(gaps.ready, true, 'appearance script did not start');
            assert.ok(Math.abs(gaps.left - gaps.right) <= 1, `form column is centered beside the docked drawer at ${width}px ${JSON.stringify(gaps)}`);
            if (width === 2560) assert.ok(gaps.left > 500, `wide windows keep the column off the drawer edge ${JSON.stringify(gaps)}`);
        }
    }
    console.log('docked drawer forms: wrapped and bare form columns centered at 1280 and 2560 px');
}).catch(error => { console.error(error); process.exitCode = 1; });
