'use strict';

// The remembered-server model shared by the native chooser and server pages.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const history = require('../native/serverHistory.js');

const at = n => 1_700_000_000_000 + n;
const servers = text => JSON.parse(text).servers;

test('addresses keep scheme, IPv6 host, port and base path; only the web client page is dropped', () => {
    const cases = {
        'https://Media.Example.org:8920/jellyfin/web/index.html?x=1#/home': 'https://media.example.org:8920/jellyfin/',
        'http://192.168.1.2:8096/web/': 'http://192.168.1.2:8096/',
        'http://[fe80::1]:8096/emby': 'http://[fe80::1]:8096/emby/',
        'https://example.org:443/': 'https://example.org/',
        'http://example.org:80/Media/': 'http://example.org/Media/',
        'http://example.org/website': 'http://example.org/website/',
    };
    for (const [input, expected] of Object.entries(cases)) assert.equal(history.canonicalAddress(input), expected, input);
    for (const invalid of ['', 'ftp://example.org/', 'http://user:pass@example.org/', 'javascript:alert(1)', 'not a url'])
        assert.equal(history.canonicalAddress(invalid), null, invalid);
});

test('the same address is one record; scheme, port and base path keep servers apart', () => {
    let text = '';
    for (const [n, address] of ['https://host.example/jellyfin/', 'https://host.example/jellyfin/web/index.html',
        'https://host.example/emby/', 'http://host.example/jellyfin/', 'https://host.example:8920/jellyfin/'].entries())
        text = history.remember(text, {mode: 'custom', address, at: at(n)});
    assert.deepEqual(servers(text).map(server => server.address), [
        'https://host.example:8920/jellyfin/', 'http://host.example/jellyfin/', 'https://host.example/emby/', 'https://host.example/jellyfin/']);
});

test('the dedicated LAN and public addresses are one logical entry with the last successful address', () => {
    let text = history.remember('', {mode: 'tigerest', address: 'http://192.168.5.150:8095/', at: at(1)});
    text = history.remember(text, {mode: 'tigerest', address: 'http://nas.tigerest.top:8095/', at: at(2)});
    assert.deepEqual(servers(text), [{mode: 'tigerest', address: 'http://nas.tigerest.top:8095/', lastConnectedAt: at(2)}]);
    // A self-hosted server on a similar address is never folded into it.
    text = history.remember(text, {mode: 'custom', address: 'http://nas.tigerest.top:8096/', at: at(3)});
    assert.equal(servers(text).length, 2);
});

test('aliases of one server and different servers with the same name stay separate', () => {
    let text = history.remember('', {mode: 'custom', address: 'http://192.168.1.2:8096/', at: at(1)});
    text = history.remember(text, {mode: 'custom', address: 'https://media.example.org/', at: at(2)});
    text = history.annotate(text, {mode: 'custom', address: 'http://192.168.1.2:8096/', name: 'Home', kind: 'jellyfin', serverId: 'abc'});
    text = history.annotate(text, {mode: 'custom', address: 'https://media.example.org/', name: 'Home', kind: 'jellyfin', serverId: 'abc'});
    assert.equal(servers(text).length, 2, 'a shared identity alone does not merge user-entered addresses');
    text = history.remember(text, {mode: 'custom', address: 'https://other.example/', at: at(3)});
    text = history.annotate(text, {mode: 'custom', address: 'https://other.example/', name: 'Home', kind: 'emby'});
    assert.deepEqual(servers(text).map(server => [server.name, server.kind]), [['Home', 'emby'], ['Home', 'jellyfin'], ['Home', 'jellyfin']]);
});

test('reconnecting keeps learned metadata and moves the server to the front', () => {
    let text = history.remember('', {mode: 'custom', address: 'https://a.example/', at: at(1)});
    text = history.annotate(text, {mode: 'custom', address: 'https://a.example/web/index.html', name: 'A', kind: 'emby', serverId: 'id-1'});
    text = history.remember(text, {mode: 'custom', address: 'https://b.example/', at: at(2)});
    text = history.remember(text, {mode: 'custom', address: 'https://a.example/', at: at(3)});
    assert.deepEqual(servers(text)[0], {mode: 'custom', address: 'https://a.example/', name: 'A', kind: 'emby', serverId: 'id-1', lastConnectedAt: at(3)});
});

test('annotation never creates a record and unknown server types are omitted', () => {
    const text = history.remember('', {mode: 'custom', address: 'https://a.example/', at: at(1)});
    assert.equal(history.annotate(text, {mode: 'custom', address: 'https://unknown.example/', name: 'X', kind: 'jellyfin'}), text);
    const annotated = history.annotate(text, {mode: 'custom', address: 'https://a.example/', name: 'A', kind: 'plex', serverId: '../../x'});
    assert.deepEqual(servers(annotated)[0], {mode: 'custom', address: 'https://a.example/', name: 'A', lastConnectedAt: at(1)});
});

test('hostile names are bounded plain text without control or direction overrides', () => {
    let text = history.remember('', {mode: 'custom', address: 'https://a.example/', at: at(1)});
    text = history.annotate(text, {mode: 'custom', address: 'https://a.example/', name: '‮<img src=x onerror=alert(1)>\u0000' + 'x'.repeat(200), kind: 'emby'});
    const [record] = history.list(text);
    assert.equal(record.name.startsWith('<img src=x onerror=alert(1)>'), true, 'markup is kept as text for textContent rendering');
    assert.equal(/[\u0000‮]/.test(record.name), false);
    assert.equal(record.name.length, 80);
});

test('invalid persisted data yields an empty list and is replaced on the next success', () => {
    for (const damaged of ['{', 'null', '[]', '{"version":2,"servers":[]}', '{"version":1,"servers":{}}',
        '{"version":1,"servers":[{"mode":"custom","address":"javascript:alert(1)"},{"mode":"other","address":"https://a.example/"}]}'])
        assert.deepEqual(history.parse(damaged), [], damaged);
    const text = history.remember('{', {mode: 'custom', address: 'https://a.example/', at: at(1)});
    assert.equal(servers(text).length, 1);
});

test('the list is bounded to the most recent successes', () => {
    let text = '';
    for (let n = 0; n < history.LIMIT + 5; n++) text = history.remember(text, {mode: 'custom', address: `https://s${n}.example/`, at: at(n)});
    const kept = servers(text);
    assert.equal(kept.length, history.LIMIT);
    assert.equal(kept[0].address, `https://s${history.LIMIT + 4}.example/`);
    assert.equal(kept.at(-1).address, 'https://s5.example/');
});

test('the one saved address migrates as an undated current entry; nothing else is invented', () => {
    assert.deepEqual(history.list('', {current: 'https://old.example/jellyfin/', mode: 'custom'}), [
        {key: 'custom:https://old.example/jellyfin/', mode: 'custom', address: 'https://old.example/jellyfin/', lastConnectedAt: 0, current: true}]);
    assert.deepEqual(history.list('', {}), []);
    const text = history.remember('', {mode: 'custom', address: 'https://old.example/jellyfin/web/index.html', at: at(1)});
    assert.deepEqual(history.list(text, {current: 'https://old.example/jellyfin/', mode: 'custom'}).map(server => [server.address, server.current]),
        [['https://old.example/jellyfin/', true]]);
});

test('the first success after an upgrade keeps the migrated address, unless it was the one edited', () => {
    const old = {mode: 'custom', address: 'https://old.example/emby/'};
    const next = history.remember('', {mode: 'custom', address: 'https://new.example/jellyfin/', at: at(5), current: old});
    assert.deepEqual(servers(next), [{mode: 'custom', address: 'https://new.example/jellyfin/', lastConnectedAt: at(5)},
        {mode: 'custom', address: 'https://old.example/emby/', lastConnectedAt: 0}]);
    // Already remembered: the record keeps its date and metadata.
    const named = history.annotate(history.remember('', {mode: 'custom', address: old.address, at: at(1)}), {...old, name: 'Old'});
    assert.deepEqual(servers(history.remember(named, {mode: 'custom', address: 'https://new.example/jellyfin/', at: at(5), current: old}))[1],
        {mode: 'custom', address: 'https://old.example/emby/', name: 'Old', lastConnectedAt: at(1)});
    // Editing the current address replaces it instead of keeping both.
    assert.deepEqual(servers(history.remember('', {mode: 'custom', address: 'https://new.example/jellyfin/', at: at(5), current: old,
        replacing: 'custom:https://old.example/emby/'})).map(server => server.address), ['https://new.example/jellyfin/']);
    // The dedicated server migrates as its one logical entry; unusable current values are ignored.
    assert.deepEqual(servers(history.remember('', {mode: 'custom', address: 'https://new.example/', at: at(5),
        current: {mode: 'tigerest', address: 'http://nas.tigerest.top:8095/'}})).map(server => server.mode), ['custom', 'tigerest']);
    assert.equal(history.remember('', {mode: 'custom', address: 'https://new.example/', at: at(5), current: {mode: '', address: 'nonsense'}}),
        history.remember('', {mode: 'custom', address: 'https://new.example/', at: at(5)}));
});

test('removing a record and editing an address replace only the chosen record', () => {
    let text = history.remember('', {mode: 'custom', address: 'https://a.example/', at: at(1)});
    text = history.remember(text, {mode: 'custom', address: 'https://b.example/', at: at(2)});
    text = history.remember(text, {mode: 'custom', address: 'https://c.example/', at: at(3), replacing: 'custom:https://b.example/'});
    assert.deepEqual(servers(text).map(server => server.address), ['https://c.example/', 'https://a.example/']);
    text = history.forget(text, 'custom:https://a.example/');
    assert.deepEqual(servers(text).map(server => server.address), ['https://c.example/']);
});

test('records hold metadata only: no credentials, tokens or users survive', () => {
    const text = JSON.stringify({version: 1, servers: [{mode: 'custom', address: 'https://a.example/', lastConnectedAt: at(1),
        accessToken: 'secret', password: 'secret', userId: 'u', name: 'A'}]});
    assert.equal(/secret|userId/.test(history.remember(text, {mode: 'custom', address: 'https://a.example/', at: at(2)})), false);
});

test('the model is pure: each profile passes its own setting text and no browser storage is used', () => {
    const context = vm.createContext({window: {}, URL, JSON, Number, String, Math, Date, Set, Error, Array, Object, globalThis: {}});
    Object.defineProperty(context.window, 'localStorage', {get() { throw new Error('profile history must not use origin storage'); }});
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../native/serverHistory.js'), 'utf8'), context);
    const model = context.window.TigerestServerHistory;
    const first = model.remember('', {mode: 'custom', address: 'https://a.example/', at: at(1)});
    const second = model.remember('', {mode: 'custom', address: 'https://b.example/', at: at(1)});
    assert.notEqual(first, second);
    assert.equal(model.parse(second).some(server => server.address === 'https://a.example/'), false);
});
