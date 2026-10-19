'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

// Only the browser DOM and native network boundary are doubled. The shipped
// connection controller runs unchanged, including asynchronous cancellation.
function page({ saved = '', mode = '', lan = false, connect, switching = false, editAddress, finishSelection } = {}) {
    const elements = new Map();
    function element(id) {
        if (!elements.has(id)) elements.set(id, {
            value: '', textContent: '', hidden: false, disabled: false, style: {},
            attributes: new Map([['data-original-text', '服务器地址']]),
            listeners: new Map(), classList: { add() {}, remove() {} },
            addEventListener(event, listener) { this.listeners.set(event, listener); },
            getAttribute(name) { return this.attributes.get(name); },
            setAttribute(name, value) { this.attributes.set(name, value); },
            focus() { this.listeners.get('focus')?.({ target: this }); },
            async emit(event) {
                return this.listeners.get(event)?.({ target: this, preventDefault() {}, stopPropagation() {} });
            },
        });
        return elements.get(id);
    }
    const requests = [];
    const settings = { main: { userWebClient: saved, serverConnectionMode: mode } };
    const check = async url => {
        requests.push(url);
        return connect ? connect(url) : `${url.replace(/\/+$/, '')}/web/index.html`;
    };
    check.abort = () => {};
    const window = {
        apiPromise: Promise.resolve(), jmpInfo: { settings }, location: switching ? { search: '?choose=1' } : '',
        history: { length: switching ? 2 : 1, back() { window.wentBack = true; } },
        tigerestAndroidApi: editAddress ? { system: { editServerAddress: editAddress } } : null,
        api: { system: { isAddressOnLocalSubnet: () => lan, cancelServerConnectivity() {}, finishServerSelection: finishSelection } },
        jmpCheckServerConnectivity: check, tigerestOpenOfflineLibrary() {},
    };
    const context = vm.createContext({
        window, URL, console: { log() {}, error() {}, warn() {} },
        document: { getElementById: element, addEventListener() {}, removeEventListener() {} },
    });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../native/find-webclient.js'), 'utf8'), context);
    return { element, requests, settings, window, context };
}
const settle = () => new Promise(resolve => setImmediate(resolve));

test('native selection owns saving and navigation; Back cannot split its commit', async () => {
    let finish, args;
    const p = page({ saved: 'https://old.example/', mode: 'custom', switching: true,
        finishSelection: (...values) => { args = values; return new Promise(resolve => { finish = resolve; }); } });
    await settle();
    await p.element('choose-custom').emit('click');
    p.element('address').value = 'https://new.example/';
    const pending = p.element('connect-form').emit('submit');
    await settle();
    assert.deepEqual(args, ['https://new.example/', 'custom', 'https://new.example/web/index.html']);
    await p.element('cancel-switch-button').emit('click');
    assert.equal(p.window.tigerestServerSelectionBack(), true);
    assert.equal(p.window.wentBack, undefined);
    assert.equal(p.settings.main.userWebClient, 'https://old.example/');
    finish(true); await pending;
    assert.deepEqual(p.window.location, { search: '?choose=1' });
});

test('rejected native selection retains old settings and allows another choice', async () => {
    const p = page({ saved: 'https://old.example/', mode: 'custom', switching: true,
        finishSelection: async () => false });
    await settle(); await p.element('choose-custom').emit('click');
    p.element('address').value = 'https://new.example/';
    await p.element('connect-form').emit('submit');
    assert.equal(p.settings.main.userWebClient, 'https://old.example/');
    assert.equal(p.element('connection-error').hidden, false);
    await p.element('cancel-switch-button').emit('click');
    assert.equal(p.window.wentBack, true);
});

test('first launch waits for a server choice without probing any server', async () => {
    const p = page({ lan: true });
    await settle();
    assert.deepEqual(p.requests, []);
    assert.equal(p.element('server-choice').hidden, false);
    assert.equal(p.element('connect-form').hidden, true);
});

test('self-hosted choice opens a blank form and connects directly to the supplied IP and port', async () => {
    const p = page();
    await settle();
    await p.element('choose-custom').emit('click');
    assert.equal(p.element('address').value, '');
    p.element('address').value = '  192.168.114.114:8097  ';
    await p.element('connect-form').emit('submit');
    await settle();
    assert.deepEqual(p.requests, ['http://192.168.114.114:8097/']);
    assert.equal(p.settings.main.serverConnectionMode, 'custom');
    assert.equal(p.window.location, 'http://192.168.114.114:8097/web/index.html');
});

test('saved custom server failure stays on that server and exposes the connection error', async () => {
    const p = page({ saved: 'http://192.168.114.114:8097/', mode: 'custom',
        connect: async () => { throw new Error('HTTP 403'); } });
    await settle();
    assert.deepEqual(p.requests, ['http://192.168.114.114:8097/']);
    assert.equal(p.element('address').value, 'http://192.168.114.114:8097/');
    assert.match(p.element('connection-error').textContent, /403/);
    assert.equal(p.element('connect-form').hidden, false);
});

test('exclusive server choice tries LAN first only on that subnet, then the public domain', async () => {
    const p = page({ lan: true, connect: async url => {
        if (url.includes('192.168.5.150')) throw new Error('unavailable');
        return `${url}web/index.html`;
    } });
    await settle();
    await p.element('choose-tigerest').emit('click');
    await settle();
    assert.deepEqual(p.requests, ['http://192.168.5.150:8095/', 'http://nas.tigerest.top:8095/']);
    assert.equal(p.settings.main.userWebClient, 'http://nas.tigerest.top:8095/');
});

test('hover and keyboard focus expose the appropriate server explanation', async () => {
    const p = page();
    await settle();
    await p.element('choose-tigerest').emit('mouseenter');
    assert.match(p.element('choice-description').textContent, /B站充电/);
    await p.element('choose-custom').emit('focus');
    assert.match(p.element('choice-description').textContent, /播放器.*不包含服务器/);
});

test('asynchronous native subnet result false uses the public dedicated server only', async () => {
    const p = page({ lan: Promise.resolve(false) });
    await settle();
    await p.element('choose-tigerest').emit('click');
    assert.deepEqual(p.requests, ['http://nas.tigerest.top:8095/']);
});

test('returning to choices during native subnet lookup cannot start a stale connection', async () => {
    let finish;
    const p = page({ lan: new Promise(resolve => { finish = resolve; }) });
    await settle();
    const pending = p.element('choose-tigerest').emit('click');
    await p.element('back-button').emit('click');
    await p.element('choose-custom').emit('click');
    finish(true);
    await pending;
    assert.deepEqual(p.requests, []);
    assert.equal(p.settings.main.serverConnectionMode, '');
    assert.equal(p.element('address').value, '');
});

test('explicit switching shows choices without connecting or erasing the saved server', async () => {
    const p = page({ saved: 'https://example.org/jellyfin/', mode: 'custom', switching: true });
    await settle();
    assert.deepEqual(p.requests, []);
    assert.equal(p.element('server-choice').hidden, false);
    await p.element('choose-custom').emit('click');
    assert.equal(p.element('address').value, 'https://example.org/jellyfin/');
    await p.element('back-button').emit('click');
    await p.element('cancel-switch-button').emit('click');
    assert.equal(p.window.wentBack, true);
    assert.equal(p.settings.main.userWebClient, 'https://example.org/jellyfin/');
    assert.equal(p.settings.main.serverConnectionMode, 'custom');
});

test('failed replacement leaves the original launch destination intact', async () => {
    const p = page({ saved: 'https://old.example/', mode: 'custom', switching: true, connect: async () => { throw Error('offline'); } });
    await settle();
    await p.element('choose-custom').emit('click');
    p.element('address').value = 'https://new.example/';
    await p.element('connect-form').emit('submit');
    assert.equal(p.settings.main.userWebClient, 'https://old.example/');
    assert.equal(p.settings.main.serverConnectionMode, 'custom');
});

test('Android native address editing preserves cancel and sends accepted text through normal validation', async () => {
    let result = null;
    const p = page({ switching: true, saved: 'https://old.example/', mode: 'custom', editAddress: async () => result });
    await settle();
    await p.element('choose-custom').emit('click');
    await p.element('address').emit('click');
    assert.equal(p.element('address').value, 'https://old.example/');
    result = 'https://example.org:8920/jellyfin/';
    await p.element('address').emit('click');
    assert.equal(p.element('address').value, result);
    assert.equal(p.settings.main.userWebClient, 'https://old.example/');
    await p.element('connect-form').emit('submit');
    assert.deepEqual(p.requests, [result]);
    assert.equal(p.settings.main.userWebClient, result);
});

test('back cancels an in-flight connection and a late result cannot navigate or save it', async () => {
    let finish;
    const p = page({ mode: 'custom', connect: () => new Promise(resolve => { finish = resolve; }) });
    await settle();
    p.element('address').value = 'http://192.168.114.114:8097';
    const pending = p.element('connect-form').emit('submit');
    await settle();
    await p.element('back-button').emit('click');
    finish('http://192.168.114.114:8097/web/index.html');
    await pending;
    await settle();
    assert.equal(p.window.location, '');
    assert.equal(p.settings.main.userWebClient, '');
    assert.equal(p.element('server-choice').hidden, false);
});
