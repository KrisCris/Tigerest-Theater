// Jellyfin 10.9–12.2 registers its controls as customized built-ins through the
// webcomponents.js v0 polyfill (Jellyfin's own chunk, BSD licensed, in
// fixtures/jellyfin-webcomponents). The polyfill upgrades any element carrying a
// registered `is` attribute, also inside open shadow trees, whenever such a tree
// is attached or another control is registered. The static page copies kept for
// the home transitions must stay pictures there: an upgraded copy of emby-input
// fails in attachedCallback, and the failure also aborts the next lazily
// registered control, which left a delayed sign-in on the login page.
const assert = require('node:assert/strict');
const path = require('node:path');
const withBrowser = require('./community_browser.cjs');
const root = path.resolve(__dirname, '..');
const embedded = process.argv.includes('--webengine') || !!process.env.TIGEREST_ANDROID_FIXTURE;

// Mirrors the callbacks of Jellyfin's emby-input (main.jellyfin.bundle.js,
// 10.11.11) and records the lifecycle of every v0 and native control.
function controls() {
    const errors = window.fixtureErrors = [];
    addEventListener('error', event => errors.push(event.message));
    addEventListener('unhandledrejection', event => errors.push(String(event.reason)));
    const calls = window.controlCalls = [];
    const define = (name, base, extend, created, attached) => {
        const prototype = Object.create(base.prototype);
        prototype.createdCallback = function () { calls.push(['created', name, this]); created?.call(this); };
        prototype.attachedCallback = function () { calls.push(['attached', name, this]); attached?.call(this); };
        document.registerElement(name, {prototype, extends: extend});
    };
    let inputs = 0;
    define('emby-input', HTMLInputElement, 'input', function () {
        if (!this.id) this.id = 'embyinput' + ++inputs;
        if (this.classList.contains('emby-input')) return;
        this.classList.add('emby-input');
        const label = this.ownerDocument.createElement('label');
        label.innerText = this.getAttribute('label') || '';
        label.classList.add('inputLabel');
        label.htmlFor = this.id;
        this.parentNode.insertBefore(label, this);
        this.labelElement = label;
    }, function () { this.labelElement.htmlFor = this.id; });
    define('emby-button', HTMLButtonElement, 'button', function () { this.classList.add('emby-button'); });
    // Views import their remaining controls on demand, after the document has
    // been upgraded: the home sections only once the user has signed in.
    window.loadControl = name => define(name, HTMLDivElement, 'div', function () { this.classList.add(name); });
    // Emby's controls are native customized built-ins.
    const natives = window.nativeCalls = [];
    customElements.define('tigerest-native-panel', class extends HTMLDivElement {
        constructor() { super(); natives.push(this); }
        connectedCallback() { natives.push(this); }
    }, {extends: 'div'});
}

const routes = {
    '/': {type: 'text/html', body: `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
      html,body {margin:0;background:#101722;color:#eee;font:16px sans-serif;}
      .hide {display:none!important;}
      .page {position:fixed;inset:0;padding:40px;background:#17263a;}
      .inputLabel {display:block;margin:12px 0 4px;color:rgb(170,190,210);}
      .emby-input {display:block;box-sizing:border-box;width:280px;padding:6px;border:2px solid rgb(31,79,121);background:#0d1520;color:#fff;}
      .emby-button {margin-top:16px;padding:8px 20px;border:0;background:rgb(0,164,220);color:#fff;}
      .emby-scroller {width:320px;height:120px;overflow:auto;border:3px solid rgb(121,79,31);}
      .nativePanel {margin-top:12px;padding:4px;border:1px solid rgb(64,128,96);}
      </style>
      <script>self.webpackChunk = {push: ([, modules]) => Object.values(modules).forEach(module => module())};</script>
      <script src="/webcomponents.js"></script><script src="/controls.js"></script>
      ${embedded ? '' : '<script src="/backdrop.js"></script><script src="/transitions.js"></script>'}
      <div class="skinHeader"></div><div class="mainAnimatedPages"></div>`},
    '/webcomponents.js': {path: path.join(__dirname, 'fixtures/jellyfin-webcomponents/node_modules.webcomponents.js.bundle.js')},
    '/controls.js': {body: '(' + controls.toString() + ')();'},
    '/backdrop.js': {path: path.join(root, 'native/homeBackdrop.js')},
    '/transitions.js': {path: path.join(root, 'native/homeTransitions.js')},
};

withBrowser(routes, async ({evaluate, call}) => {
    await call('Emulation.setEmulatedMedia', {features: [{name: 'prefers-reduced-motion', value: 'no-preference'}]});
    await evaluate('(' + (async function () {
        const until = async (fn, label, timeout = 10000) => {
            const deadline = performance.now() + timeout;
            for (;;) {
                const value = fn(); if (value) return value;
                if (performance.now() > deadline) throw Error('timeout: ' + label);
                await new Promise(resolve => setTimeout(resolve, 16));
            }
        };
        const frame = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        await until(() => window.CustomElements?.ready && window.TigerestHomeTransitions, 'polyfill and transitions');
        const pages = document.querySelector('.mainAnimatedPages');
        const copied = node => node.getRootNode() instanceof ShadowRoot;
        window.fixture = {
            until, frame, seen: 0,
            login: `<form><div class="inputContainer"><input is="emby-input" type="text" id="txtManualName" label="用户名"></div>
                <div class="inputContainer"><input is="emby-input" type="password" id="txtManualPassword" label="密码"></div>
                <div is="tigerest-native-panel" class="nativePanel">记住我</div>
                <button is="emby-button" type="submit" class="raised button-submit block">登录</button></form>`,
            home: `<div is="emby-scroller" class="homeScroller"><div style="width:900px;height:400px">
                <button is="emby-button" type="button" class="card">作品</button></div></div>`,
            // Like Jellyfin's view container: insert the view, let the polyfill
            // upgrade it, then announce it.
            async showView(id, html) {
                for (const view of pages.children) view.classList.add('hide');
                const view = document.createElement('div');
                view.id = id; view.className = 'page mainAnimatedPage'; view.innerHTML = html;
                pages.append(view);
                await new Promise(resolve => setTimeout(resolve));
                view.dispatchEvent(new CustomEvent('viewshow', {bubbles: true}));
                return view;
            },
            // The automatic prewarm copies the view a moment after it settles.
            async snapshotOf(id) {
                const shadow = await until(() => {
                    const tree = TigerestHomeTransitions.cacheState.snapshot ? document.querySelector('.tigerest-motion-cache')?.firstElementChild.shadowRoot : null;
                    return tree?.getElementById(id) && tree;
                }, 'snapshot of ' + id);
                await frame();
                return {live: document.getElementById(id), copy: shadow.getElementById(id)};
            },
            attached: node => controlCalls.some(([kind, , target]) => kind === 'attached' && target === node),
            inspect({live, copy}, check) {
                check(copy, 'the snapshot holds the current view');
                if (!copy) return;
                check(!fixtureErrors.length, 'no page errors: ' + fixtureErrors.splice(0).join(' | '));
                const upgraded = controlCalls.slice(this.seen).filter(([, , node]) => copied(node)).map(([kind, name]) => kind + ' ' + name);
                this.seen = controlCalls.length;
                check(!upgraded.length, 'the polyfill upgraded copied controls: ' + upgraded.join(', '));
                check(!nativeCalls.some(copied), 'copies construct or connect no native customized built-in');
                check(!copy.querySelector('[is]'), 'copies carry no is attribute');
                const labels = view => Array.from(view.querySelectorAll('label'), label => label.textContent).join(',');
                check(labels(copy) === labels(live), `the copy shows the live labels only: ${labels(copy)} / ${labels(live)}`);
                const parts = view => Array.from(view.querySelectorAll('input,button,label,.nativePanel,.homeScroller'));
                const originals = parts(live), copies = parts(copy);
                check(originals.length === copies.length, 'the copy keeps every control');
                originals.forEach((node, index) => {
                    const twin = copies[index], a = node.getBoundingClientRect(), b = twin.getBoundingClientRect();
                    check(['x', 'y', 'width', 'height'].every(key => Math.abs(a[key] - b[key]) < 1), `${node.className} keeps its geometry`);
                    for (const property of ['border-top-color', 'background-color', 'color'])
                        check(getComputedStyle(node).getPropertyValue(property) === getComputedStyle(twin).getPropertyValue(property), `${node.className} keeps its ${property}`);
                });
            },
            checkLogin(view, check) {
                for (const input of view.querySelectorAll('input')) check(input.labelElement?.htmlFor === input.id && this.attached(input), input.id + ' is a working Jellyfin input');
            },
        };
    }).toString() + ')()');

    const failures = [];
    const step = async (label, body) => {
        const problems = await evaluate(`(async () => { const problems = [], check = (ok, message) => { if (!ok) problems.push(message); };
            ${body}
            return problems; })()`);
        console.log(problems.length ? 'failed: ' + label + '\n  ' + problems.join('\n  ') : 'passed: ' + label);
        failures.push(...problems.map(problem => label + ': ' + problem));
    };

    await step('login page snapshot', `
        const view = await fixture.showView('loginPage', fixture.login);
        fixture.checkLogin(view, check);
        fixture.inspect(await fixture.snapshotOf('loginPage'), check);`);

    // The user waited on the login page, so its copy is attached before signing in.
    await step('delayed sign-in', `
        try { loadControl('emby-scroller'); } catch (error) { check(false, 'the home controls failed to load: ' + error.message); }
        const view = await fixture.showView('homePage', fixture.home);
        const scroller = view.querySelector('.homeScroller');
        check(scroller.classList.contains('emby-scroller') && fixture.attached(scroller), 'the home scroller is a working control');
        fixture.inspect(await fixture.snapshotOf('homePage'), check);`);

    await step('re-entered login page', `
        const view = await fixture.showView('loginAgain', fixture.login);
        fixture.checkLogin(view, check);
        fixture.inspect(await fixture.snapshotOf('loginAgain'), check);
        try { loadControl('emby-itemscontainer'); } catch (error) { check(false, 'later controls failed to load: ' + error.message); }
        await fixture.showView('homeAgain', fixture.home);
        await fixture.frame();
        check(!fixtureErrors.length, 'signing in again raises no errors: ' + fixtureErrors.join(' | '));`);

    assert.deepEqual(failures, [], 'static page copies must stay inert under the Jellyfin polyfill');
}).catch(error => { console.error(error); process.exitCode = 1; });
