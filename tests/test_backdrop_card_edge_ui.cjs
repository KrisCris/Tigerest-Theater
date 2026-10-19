// A hovered or focused card lifts its box past its own edge (webAppearance's
// shipped rule). The background capture must still see the lifted part.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const withBrowser = require('./community_browser.cjs');
const root = path.resolve(__dirname, '..');
const appearance = fs.readFileSync(path.join(root, 'native/webAppearance.js'), 'utf8');
const start = appearance.indexOf('.portraitCard:hover .cardBox'), hover = appearance.slice(start, appearance.indexOf('}', start) + 1);
assert.match(hover, /translateY\(-\d+px\)/, 'the product hover rule lifts the card box');
const page = `<!doctype html><style>body{margin:0;background:#0b0d12}.card{position:absolute;left:100px;top:calc(100vh + 3px);width:200px;height:300px}
.cardBox{width:200px;height:300px;background:rgb(255,0,0)}${hover}</style><div id="root"><div class="card portraitCard"><div class="cardBox"></div></div></div><script src="/backdrop.js"></script>`;
withBrowser({'/': {type: 'text/html', body: page}, '/backdrop.js': {path: path.join(root, 'native/homeBackdrop.js')}}, async ({evaluate, call}) => {
    await call('DOM.enable'); await call('CSS.enable');
    const {root: documentNode} = await call('DOM.getDocument');
    const {nodeId} = await call('DOM.querySelector', {nodeId: documentNode.nodeId, selector: '.card'});
    await call('CSS.forcePseudoState', {nodeId, forcedPseudoClasses: ['hover']});
    const shape = await evaluate(`({height: innerHeight, card: document.querySelector('.card').getBoundingClientRect().top, box: document.querySelector('.cardBox').getBoundingClientRect().top})`);
    assert.ok(shape.card > shape.height && shape.box < shape.height, 'fixture: the card starts below the viewport, its lifted box shows ' + JSON.stringify(shape));
    const pixel = await evaluate(`(async () => {
      const r = await TigerestHomeBackdrop.build(document.getElementById('root'), new AbortController().signal);
      const canvas = document.createElement('canvas'); canvas.width = r.width; canvas.height = r.height;
      const ctx = canvas.getContext('2d'); ctx.drawImage(r.bitmap, 0, 0); r.bitmap.close();
      return [...ctx.getImageData(Math.round(200 * r.width / innerWidth), r.height - 1, 1, 1).data];
    })()`);
    assert.ok(pixel[0] > 120 && pixel[0] > pixel[1] * 3, 'the lifted card box is in the capture: ' + JSON.stringify(pixel));
    console.log(JSON.stringify({passed: true, shape, pixel}));
}).catch(error => { console.error(error); process.exitCode = 1; });
