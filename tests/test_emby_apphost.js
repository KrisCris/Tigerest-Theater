'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

// Loads the shipped Emby start-up script and returns the app host module Emby
// receives, built over the given native host.
function appHost(nativeHost) {
    const registrations = new Map();
    const context = {
        console: { info() {}, warn() {} }, AbortController, URL, setTimeout: () => 1, clearTimeout() {}, setInterval: () => 1, clearInterval() {},
        location: { protocol: 'qrc:', origin: 'qrc://', pathname: '/', host: '' },
        jmpInfo: { version: 'test', settings: { main: {} } }, NativeShell: { AppHost: nativeHost },
        localStorage: { getItem: () => null, setItem() {} },
    };
    context.window = context; context.globalThis = context;
    context.define = (id, deps, factory) => registrations.set(id, factory);
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../native/embycompat.js'), 'utf8'), context);
    return registrations.get('tigerest/apphost.js')();
}

// Emby 4.8 connectionmanager.js reportCapabilities(), run on every sign-in
// and reconnection; 4.9 and later call getSyncProfile() only when the app
// supports sync.
const reportCapabilities = host =>
    (host.getSyncProfile ? host.getSyncProfile() : Promise.resolve(null)).then(profile => ({ DeviceProfile: profile }));

test('Emby 4.8 can report capabilities, so signing in completes', async () => {
    const profile = { Name: 'Tigerest Theater' };
    assert.deepEqual(await reportCapabilities(appHost({ getSyncProfile: () => profile })), { DeviceProfile: profile });
    assert.deepEqual(await reportCapabilities(appHost({})), { DeviceProfile: null });
});
