'use strict';

// The real Qt WebChannel, networking stack and Chromium page are exercised
// against a loopback fixture. No user's profile or Emby account is touched.
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const net = require('node:net');
const { randomUUID } = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');

async function until(check, label) {
    for (let i = 0; i < 150; i++) {
        const value = await check();
        if (value) return value;
        await delay(100);
    }
    throw new Error(`Timed out: ${label}`);
}
async function listen(server) {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    return server.address().port;
}
async function devtools(url) {
    const socket = new WebSocket(url);
    await new Promise((resolve, reject) => {
        socket.addEventListener('open', resolve, { once: true });
        socket.addEventListener('error', reject, { once: true });
    });
    let id = 0;
    const pending = new Map();
    socket.addEventListener('message', event => {
        const message = JSON.parse(event.data);
        const entry = pending.get(message.id);
        if (!entry) return;
        pending.delete(message.id);
        clearTimeout(entry.timer);
        if (message.error) entry.reject(new Error(JSON.stringify(message.error)));
        else entry.resolve(message.result);
    });
    const send = (method, params = {}) => new Promise((resolve, reject) => {
        const requestId = ++id;
        const timer = setTimeout(() => {
            pending.delete(requestId);
            reject(new Error(`${method} timed out`));
        }, 10000);
        pending.set(requestId, { resolve, reject, timer });
        socket.send(JSON.stringify({ id: requestId, method, params }));
    });
    return {
        send,
        async evaluate(expression) {
            const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
            assert.ok(!result.exceptionDetails, JSON.stringify(result.exceptionDetails));
            return result.result.value;
        },
        close() { socket.close(); },
    };
}

(async () => {
    const executable = path.resolve(process.argv[2]);
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tigerest-onboarding-test-'));
    const id = randomUUID().replaceAll('-', '');
    const profileName = `Onboarding-${id}`;
    const profile = path.join(root, 'profiles', id);
    fs.mkdirSync(profile, { recursive: true });
    fs.writeFileSync(path.join(profile, 'profile.json'), JSON.stringify({ name: profileName }));
    fs.writeFileSync(path.join(profile, 'Tigerest Theater.conf'), JSON.stringify({
        version: 10, sections: { main: { enableWindowsTrayIcon: false } },
    }));
    const requests = [];
    const fixture = http.createServer((req, res) => {
        requests.push(`${req.method} ${req.url}`);
        if (req.url === '/emby/System/Info/Public') {
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ Id: 'onboarding-test-server', ServerName: 'Fixture' }));
        } else if (req.url === '/emby/web/index.html') {
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.end('<!doctype html><title>Fixture Emby</title><p id="fixture">自己的 Emby 已连接</p>');
        } else {
            res.writeHead(403); res.end('Forbidden');
        }
    });
    const fixturePort = await listen(fixture);
    const origin = `http://127.0.0.1:${fixturePort}`;
    let child, cdp;
    async function stop() {
        cdp?.close(); cdp = null;
        if (child && child.exitCode === null) {
            const exited = new Promise(resolve => child.once('exit', resolve));
            child.kill(); await exited;
        }
    }
    async function launch() {
        const reservation = net.createServer();
        const port = await listen(reservation);
        await new Promise(resolve => reservation.close(resolve));
        child = spawn(executable, ['--config-dir', root, '--profile', profileName,
            '--disable-gpu', '--remote-debugging-port', `127.0.0.1:${port}`], {
            windowsHide: !process.env.TIGEREST_ONBOARDING_INSPECT, stdio: 'ignore',
        });
        const target = await until(async () => {
            assert.equal(child.exitCode, null, 'app exited early');
            try {
                const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
                return list.find(item => item.type === 'page');
            } catch { return null; }
        }, 'app devtools');
        cdp = await devtools(target.webSocketDebuggerUrl);
    }
    try {
        await launch();
        await until(() => cdp.evaluate("Boolean(document.querySelector('#choose-custom') && window.api && !document.querySelector('#choose-custom').disabled)"), 'server choices');
        assert.deepEqual(requests, []);
        assert.equal(await cdp.evaluate("document.querySelector('#connect-form').hidden"), true);
        await cdp.evaluate("document.querySelector('#choose-tigerest').focus()");
        assert.match(await cdp.evaluate("document.querySelector('#choice-description').textContent"), /B站充电/);
        // Optional pause for inspection through the native window capture tool.
        if (process.env.TIGEREST_ONBOARDING_INSPECT)
            await delay(45000);
        await cdp.evaluate("document.querySelector('#choose-custom').click()");
        assert.equal(await cdp.evaluate("document.querySelector('#address').value"), '');
        async function submit(address) {
            await cdp.evaluate(`document.querySelector('#address').value = ${JSON.stringify(address)}; document.querySelector('#address').dispatchEvent(new Event('input')); document.querySelector('#connect-form').requestSubmit()`);
        }
        await submit(`${origin}/blocked`);
        await until(() => cdp.evaluate("document.querySelector('#connection-error').textContent.includes('403')"), 'native HTTP error');
        await submit(`${origin}/emby`);
        await until(() => cdp.evaluate("Boolean(document.querySelector('#fixture'))"), 'own server page');
        assert.equal(await cdp.evaluate('location.href'), `${origin}/emby/web/index.html`);
        await until(() => {
            const config = JSON.parse(fs.readFileSync(path.join(profile, 'Tigerest Theater.conf'), 'utf8'));
            return config.sections.main.userWebClient === `${origin}/emby` && config.sections.main.serverConnectionMode === 'custom';
        }, 'persisted custom address');
        await stop();
        await launch();
        await until(() => cdp.evaluate("Boolean(document.querySelector('#fixture'))"), 'saved server reconnection');
        assert.equal(requests.filter(value => value === 'GET /emby/System/Info/Public').length, 2);
        assert.ok(!requests.some(value => value.startsWith('HEAD ')), 'unnecessary HEAD redirect check');
        console.log('PASS: real Qt startup choices, help, empty custom form, HTTP errors, exact port/path, persistent reconnection');
    } finally {
        await stop();
        await new Promise(resolve => fixture.close(resolve));
        assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
        assert.ok(path.basename(root).startsWith('tigerest-onboarding-test-'));
        fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
