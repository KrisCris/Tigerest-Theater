'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

// Runs the shipped Emby start-up script on a web client page. Only storage
// and the same-origin request for public server information are doubled.
function start({ origin, pathname = '/web/index.html', chosen = '', stored = null, info = { Id: 'server-id', ServerName: 'My Emby' }, status = 200 }) {
    const storage = new Map(stored ? [['servercredentials3', JSON.stringify(stored)]] : []), requests = [];
    class XMLHttpRequest {
        open(method, url, async) { requests.push({ method, url, async }); }
        send() { this.status = status; this.responseText = JSON.stringify(info); }
    }
    const context = {
        console: { warn() {} }, AbortController, Date, URL, XMLHttpRequest, setTimeout: () => 1, clearTimeout() {}, setInterval: () => 1, clearInterval() {},
        location: { origin, pathname }, NativeShell: { AppHost: {} },
        jmpInfo: { version: 'test', settings: { main: { userWebClient: chosen } } },
        localStorage: { getItem: key => storage.has(key) ? storage.get(key) : null, setItem: (key, value) => storage.set(key, String(value)) },
    };
    context.window = context; context.globalThis = context;
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../native/embycompat.js'), 'utf8'), context);
    const credentials = storage.has('servercredentials3') ? JSON.parse(storage.get('servercredentials3')) : null;
    return { credentials, requests, welcome: storage.get('welcome_seen') };
}

test('a chosen self-hosted server is recorded so Emby opens its sign-in instead of Emby Connect', () => {
    const { credentials, requests, welcome } = start({ origin: 'http://media.example:8096', chosen: 'http://media.example:8096/' });
    assert.deepEqual(requests, [{ method: 'GET', url: 'http://media.example:8096/System/Info/Public', async: false }]);
    assert.equal(credentials.Servers.length, 1);
    const [server] = credentials.Servers;
    assert.equal(server.Id, 'server-id'); assert.equal(server.Name, 'My Emby');
    assert.equal(server.ManualAddress, 'http://media.example:8096', 'keep the address and port the user entered');
    assert.equal(server.LastConnectionMode, 2); assert.equal(server.LocalAddress, undefined);
    assert.equal(welcome, '1');
});

test('a reverse-proxy path prefix stays part of the server address', () => {
    const { credentials, requests } = start({ origin: 'https://example.org', pathname: '/emby/web/index.html', chosen: 'https://example.org/emby' });
    assert.equal(requests[0].url, 'https://example.org/emby/System/Info/Public');
    assert.equal(credentials.Servers[0].ManualAddress, 'https://example.org/emby');
});

test('known servers, other origins and unavailable server information leave Emby unchanged', () => {
    const existing = { Servers: [{ Id: 'saved', ManualAddress: 'http://media.example:8096' }] };
    const saved = start({ origin: 'http://media.example:8096', chosen: 'http://media.example:8096/', stored: existing });
    assert.deepEqual(saved.requests, [], 'no request once Emby knows a server');
    assert.deepEqual(saved.credentials, existing); assert.equal(saved.welcome, '1');
    const other = start({ origin: 'http://elsewhere.example:8096', chosen: 'http://media.example:8096/' });
    assert.deepEqual(other.requests, []); assert.equal(other.credentials, null); assert.equal(other.welcome, undefined);
    for (const failure of [{ status: 503 }, { info: { ServerName: 'no id' } }]) {
        const unavailable = start({ origin: 'http://media.example:8096', chosen: 'http://media.example:8096/', ...failure });
        assert.equal(unavailable.credentials, null, 'fall back to the standard Emby start'); assert.equal(unavailable.welcome, undefined);
    }
});

test('the Tigerest server keeps its fixed record without a request', () => {
    const { credentials, requests, welcome } = start({ origin: 'http://nas.tigerest.top:8095' });
    assert.deepEqual(requests, []);
    assert.equal(credentials.Servers[0].Id, '62526c3bf747439c99327ddec5fed4a8');
    assert.equal(credentials.Servers[0].ManualAddress, 'http://nas.tigerest.top:8095'); assert.equal(welcome, '1');
});
