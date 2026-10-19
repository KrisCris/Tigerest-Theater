'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const source = name => fs.readFileSync(path.join(__dirname, '../native', name), 'utf8');

class ClassList {
    constructor() { this.names = new Set(); }
    add(...names) { names.forEach(name => this.names.add(name)); }
    remove(...names) { names.forEach(name => this.names.delete(name)); }
    contains(name) { return this.names.has(name); }
}

function storage(initial = {}) {
    const values = new Map(Object.entries(initial));
    return { values, getItem: key => values.has(key) ? values.get(key) : null, setItem: (key, value) => values.set(key, String(value)) };
}

// Runs serverKind.js for a page at href, answering its public info request with info.
function serverKind({ href = 'https://media.test/jellyfin/web/index.html', info = null, cached = {} } = {}) {
    const url = new URL(href), attributes = new Map(), events = [];
    const context = {
        URL, Promise, JSON, CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init?.detail; } },
        location: { protocol: url.protocol, origin: url.origin, pathname: url.pathname },
        localStorage: storage(cached),
        fetch: async requested => { context.requested = requested; return { ok: !!info, json: async () => info }; },
        dispatchEvent: event => events.push(event),
        document: {
            documentElement: { setAttribute: (name, value) => attributes.set(name, value), removeAttribute: name => attributes.delete(name) },
            addEventListener() {}, querySelector: () => null
        }
    };
    context.window = context;
    vm.runInNewContext(source('serverKind.js'), context);
    return { context, server: context.TigerestServer, attributes, events };
}

test('public info identifies Jellyfin by product name or a 10+ version, and Emby otherwise', () => {
    const { server } = serverKind();
    assert.equal(server.classify({ ProductName: 'Jellyfin Server', Version: '10.9.11' }), 'jellyfin');
    assert.equal(server.classify({ Version: '12.2.0', Id: 'x' }), 'jellyfin');
    assert.equal(server.classify({ ServerName: 'Emby', Version: '4.9.1.80', Id: 'x' }), 'emby');
    assert.equal(server.classify(null), '');
    assert.equal(server.serverBase({ protocol: 'https:', origin: 'https://media.test', pathname: '/jellyfin/web/index.html' }), 'https://media.test/jellyfin');
});

test('a detected Jellyfin server is cached per address and changes credentials, fields and routes', async () => {
    const first = serverKind({ info: { ProductName: 'Jellyfin Server', Version: '10.10.7', Id: 'server' } });
    assert.equal(first.server.kind, '', 'nothing is known before the first answer');
    assert.equal(await first.server.ready, 'jellyfin');
    assert.equal(first.context.requested, 'https://media.test/jellyfin/System/Info/Public');
    assert.equal(first.attributes.get('data-tigerest-server'), 'jellyfin');
    assert.equal(first.events.length, 1);
    assert.equal(first.server.tokenParameter(), 'ApiKey');
    assert.equal(first.server.itemRoute('a b', 'server'), '/details?id=a%20b&serverId=server');
    assert.equal(first.server.fields('DateCreated,PremiereDate,PresentationUniqueKey,UserDataLastPlayedDate,ProviderIds,DisplayOrder'),
        'DateCreated,PresentationUniqueKey,ProviderIds', '10.10 still has PresentationUniqueKey');
    assert.equal(first.server.itemTypes('Movie,Game,AudioBook'), 'Movie,AudioBook');

    const stored = first.context.localStorage.values;
    const later = serverKind({ cached: Object.fromEntries(stored), info: { ProductName: 'Jellyfin Server', Version: '10.11.11', Id: 'server' } });
    assert.equal(later.server.kind, 'jellyfin', 'a later page load knows the kind before the request answers');
    await later.server.ready;
    assert.equal(later.server.version, '10.11.11');
    assert.equal(later.server.fields('DateCreated,PresentationUniqueKey'), 'DateCreated', '10.11 removed PresentationUniqueKey');
    assert.equal(later.events.length, 0, 'an unchanged kind is not announced again');
});

test('Emby keeps its own parameters, fields and item route', async () => {
    const { server } = serverKind({ href: 'http://192.168.1.2:8096/web/index.html', info: { ServerName: 'Home', Version: '4.9.1.80', Id: 'emby' } });
    assert.equal(await server.ready, 'emby');
    assert.equal(server.tokenParameter(), 'api_key');
    assert.equal(server.fields('PremiereDate,UserDataLastPlayedDate'), 'PremiereDate,UserDataLastPlayedDate');
    assert.equal(server.itemTypes('Movie,Game'), 'Movie,Game');
    assert.equal(server.itemRoute('1', 's'), '/item?id=1&serverId=s');
});

test('a Jellyfin stream without credentials receives ApiKey, never api_key', () => {
    const context = { console, URL, window: {} };
    context.window.TigerestServer = { tokenParameter: () => 'ApiKey' };
    vm.runInNewContext(source('mpvVideoPlayer.js'), context);
    const authorize = context.window._tigerestAuthorizedStreamUrl;
    const manager = { getApiClient: () => ({ serverAddress: () => 'https://media.test/jellyfin', accessToken: () => 'token' }) };
    assert.equal(authorize('https://media.test/jellyfin/Videos/1/stream?Static=true', { ServerId: 's' }, manager),
        'https://media.test/jellyfin/Videos/1/stream?Static=true&ApiKey=token');
    const signed = 'https://media.test/jellyfin/Videos/1/stream?Static=true&ApiKey=own';
    assert.equal(authorize(signed, { ServerId: 's' }, manager), signed);
});

test('home requests to Jellyfin omit Emby-only Fields values and item types', async () => {
    const context = { URL, AbortController, Date, Promise, Map, Set, jmpInfo: { settings: { home: {} } } };
    context.window = context;
    context.TigerestServer = {
        fields: list => list.split(',').filter(name => !['PremiereDate', 'CommunityRating', 'PresentationUniqueKey', 'UserDataLastPlayedDate'].includes(name)).join(','),
        itemTypes: list => list.split(',').filter(name => name !== 'Game').join(',')
    };
    vm.runInNewContext(source('homeData.js'), context);
    const queries = [];
    const api = {
        serverId: () => 'jellyfin', getCurrentUserId: () => 'user',
        getUserViews: async () => ({ Items: [] }),
        getItems: async (user, query) => { queries.push(query); return { Items: [], TotalRecordCount: 0 }; },
        getResumableItems: async (user, query) => { queries.push(query); return { Items: [], TotalRecordCount: 0 }; }
    };
    await new context.TigerestHomeData(api).load({ Id: 'library', CollectionType: 'mixed' });
    assert.ok(queries.length >= 3);
    for (const query of queries) {
        if (query.Fields !== undefined) assert.doesNotMatch(query.Fields, /PremiereDate|CommunityRating|PresentationUniqueKey|UserDataLastPlayedDate/);
        if (query.IncludeItemTypes !== undefined) assert.doesNotMatch(query.IncludeItemTypes, /Game/);
    }
});

// A Jellyfin page with a #homeTab whose visibility the test controls.
function jellyfinPage() {
    const page = { visible: true, connected: true, galleries: [], shown: [] };
    const element = tag => ({ tagName: tag, classList: new ClassList(), children: [], remove() { this.removed = true; }, append(...nodes) { this.children.push(...nodes); } });
    page.tab = {
        ...element('div'), id: 'homeTab',
        getClientRects: () => page.visible ? [{}] : [],
        closest: () => null,
        prepend(node) { this.children.unshift(node); },
        get isConnected() { return page.connected; }
    };
    const listeners = {};
    const routeListeners = new Set();
    const context = {
        console: { info() {}, warn() {} }, Promise, setInterval: () => 7, clearInterval() {},
        addEventListener: (type, fn) => { if (type === 'hashchange') routeListeners.add(fn); },
        removeEventListener: (type, fn) => { if (type === 'hashchange') routeListeners.delete(fn); },
        location: {hash: '#/home', replaced: 0, get href() { return 'http://jf.test/web/index.html' + this.hash; },
            replace(url) { this.replaced++; this.hash = '#' + url.split('#')[1]; }},
        document: {
            head: element('head'),
            getElementById: id => id === 'homeTab' && page.connected ? page.tab : null,
            querySelectorAll: selector => selector === '[id="homeTab"]' && page.connected ? [page.tab] : [],
            querySelector: () => null,
            createElement: element,
            addEventListener: (type, fn) => { listeners[type] = fn; },
            removeEventListener: type => { delete listeners[type]; }
        },
        TigerestHomeGallery: class {
            constructor(host, options) { this.host = host; this.options = options; this.calls = []; page.galleries.push(this); }
            start() { this.calls.push('start'); }
            stop() { this.calls.push('stop'); }
            destroy() { this.calls.push('destroy'); }
        }
    };
    context.window = context;
    vm.runInNewContext(source('jellyfinPlugin.js'), context);
    page.context = context; page.listeners = listeners; page.routeChanged = () => routeListeners.forEach(fn => fn());
    return page;
}

test('the Jellyfin plugin is inert in Emby, which never passes ServerConnections', () => {
    const page = jellyfinPage();
    const plugin = new page.context._tigerestJellyfinPlugin({ events: { on() {} }, appRouter: {} });
    assert.equal(plugin.id, 'tigerestjellyfinplugin');
    assert.equal(plugin.home, undefined);
    assert.equal(page.galleries.length, 0);
    assert.equal(page.context.tigerestSessionConnections, undefined, 'Emby settings keep their router account');
});

test('Jellyfin gets the community, watch-together and home gallery with its own services', async () => {
    const page = jellyfinPage(), created = [], subscriptions = [], shown = [];
    page.context._communityPlugin = class { constructor(options) { created.push(['community', options]); } };
    page.context._watchTogetherPlugin = class { constructor(options) { created.push(['watch', options]); } };
    let reset = 0;
    page.context.TigerestCommunityReset = () => { reset++; };
    const apiClient = { serverId: () => 's' }, connections = { currentApiClient: () => apiClient };
    const events = { on: (target, name, fn) => subscriptions.push([target, name, fn]) };
    const appRouter = { show: path => { shown.push(path); return Promise.resolve(); } };
    const playbackManager = {};
    new page.context._tigerestJellyfinPlugin({ events, appRouter, playbackManager, ServerConnections: connections });

    assert.deepEqual(created.map(([name]) => name), ['community', 'watch']);
    assert.equal(created[0][1].connectionManager, connections);
    assert.equal(created[1][1].playbackManager, playbackManager);
    assert.equal(page.context.tigerestSessionConnections, connections, 'the settings overlay reads the account from Jellyfin');
    const signedOut = subscriptions.find(([target, name]) => target === connections && name === 'localusersignedout');
    signedOut[2]();
    assert.equal(reset, 1);

    assert.equal(page.galleries.length, 1);
    const gallery = page.galleries[0];
    assert.equal(page.tab.children[0], gallery.host, 'the gallery takes the place of the home sections');
    assert.ok(page.tab.classList.contains('tg-jellyfin-home'));
    assert.deepEqual(gallery.calls, ['start']);
    assert.equal(gallery.options.apiProvider(), apiClient);
    await gallery.options.openFavorites();
    assert.equal(page.context.location.hash, '#/home?tab=1');
    assert.deepEqual(shown, []);

    page.visible = false; page.listeners.viewshow();
    assert.deepEqual(gallery.calls, ['start', 'stop']);
    page.visible = true; page.listeners.viewshow();
    assert.deepEqual(gallery.calls, ['start', 'stop', 'start'], 'returning to the home refreshes it');
    page.connected = false; page.listeners.viewshow();
    assert.deepEqual(gallery.calls.at(-1), 'destroy');
    assert.ok(!page.tab.classList.contains('tg-jellyfin-home'));
});

test('returning home mounts the visible page when Jellyfin retains an older hidden homeTab', () => {
    const old = jellyfinPage(), fresh = jellyfinPage();
    const plugin = new old.context._tigerestJellyfinPlugin({events:{on(){}}, appRouter:{},
        ServerConnections:{currentApiClient:()=>null}});
    const firstGallery = plugin.home.gallery;
    old.visible = false;
    old.context.document.querySelectorAll = () => [old.tab, fresh.tab];
    old.listeners.viewshow();
    assert.equal(plugin.home.tab, fresh.tab);
    assert.equal(firstGallery.calls.at(-1), 'destroy');
    assert.ok(!old.tab.classList.contains('tg-jellyfin-home'));
    assert.ok(fresh.tab.classList.contains('tg-jellyfin-home'));
    assert.deepEqual(plugin.home.gallery.calls, ['start']);
    fresh.visible = false; old.visible = true;
    old.listeners.viewshow();
    assert.equal(plugin.home.tab, old.tab, 'cached pages can become visible again');
    assert.ok(!fresh.tab.classList.contains('tg-jellyfin-home'));
    plugin.home.destroy();
});

test('hash-only tab changes stop and resume the gallery without a polling tick', () => {
    const page = jellyfinPage();
    const plugin = new page.context._tigerestJellyfinPlugin({events:{on(){}}, appRouter:{}, ServerConnections:{}});
    const gallery = page.galleries[0];
    page.visible = false; page.routeChanged();
    assert.deepEqual(gallery.calls, ['start', 'stop']);
    page.visible = true; page.routeChanged();
    assert.deepEqual(gallery.calls, ['start', 'stop', 'start']);
    plugin.home.destroy();
});

test('Modern favorites changes the hash without starting a legacy navigation promise', async () => {
    const page = jellyfinPage(), shown = [];
    let legacyClicks = 0;
    page.context.document.querySelector = selector => selector.includes('MuiAppBar') ? {}
        : selector.includes('emby-tab-button') ? { click: () => legacyClicks++ } : null;
    const plugin = new page.context._tigerestJellyfinPlugin({events:{on(){}},
        appRouter:{show: route => { shown.push(route); return Promise.resolve(); }},
        ServerConnections:{currentApiClient:()=>null}});
    await plugin.home.openFavorites();
    assert.equal(page.context.location.hash, '#/home?tab=1');
    assert.equal(page.context.location.replaced, 1, 'like the Legacy tab, favorites adds no history entry');
    assert.deepEqual(shown, [], 'same-page tab changes do not emit the viewshow appRouter waits for');
    assert.equal(legacyClicks, 0, 'a hidden tab must not desynchronize Modern route state');
});

test('Legacy favorites still uses its tab button', async () => {
    const page = jellyfinPage();
    let clicks = 0;
    page.context.document.querySelector = selector => selector.includes('emby-tab-button')
        ? {click: () => clicks++} : null;
    const plugin = new page.context._tigerestJellyfinPlugin({events:{on(){}},
        appRouter:{show: () => { throw Error('Legacy favorites must use its tab'); }},
        ServerConnections:{currentApiClient:()=>null}});
    await plugin.home.openFavorites();
    assert.equal(clicks, 1);
    assert.equal(page.context.location.hash, '#/home');
});

test('a first visit to Jellyfin is not recorded as an Emby server', () => {
    const context = {
        console: { info() {}, warn() {} }, AbortController, URL, setTimeout: () => 1, clearTimeout() {}, setInterval: () => 1, clearInterval() {},
        location: { protocol: 'https:', origin: 'https://media.test', pathname: '/jellyfin/web/index.html', host: 'media.test' },
        jmpInfo: { version: 'test', settings: { main: {} } }, NativeShell: { AppHost: {} },
        localStorage: storage(),
        XMLHttpRequest: class {
            open(method, url) { this.url = url; }
            send() { this.status = 200; this.responseText = JSON.stringify({ ProductName: 'Jellyfin Server', Version: '12.2.0', Id: 'server' }); }
        },
        TigerestServer: { isJellyfin: () => false, remember: info => info.ProductName ? 'jellyfin' : 'emby' }
    };
    context.window = context; context.globalThis = context;
    context.define = () => {};
    vm.runInNewContext(source('embycompat.js'), context);
    assert.equal(context.localStorage.getItem('servercredentials3'), null);
});

test('a Jellyfin download goes through the offline library, and other addresses download as given', async () => {
    const downloads = [], started = [];
    let opened = 0;
    const context = {
        console, URL, Promise, setTimeout,
        HTMLAnchorElement: class { dispatchEvent() { return true; } },
        document: {},
        location: { href: 'https://media.test/jellyfin/web/index.html' },
        window: null
    };
    context.window = context;
    context.apiPromise = Promise.resolve({ player: {} });
    context.api = { system: { startDownload: info => { started.push(info); return 'id'; } } };
    context.ApiClient = {
        getCurrentUserId: () => 'user',
        getItem: async () => ({ Name: 'Movie', MediaType: 'Video', Container: 'mkv' }),
        getPlaybackInfo: async () => ({ MediaSources: [{ SupportsDirectPlay: true, Container: 'mkv' }] }),
        serverAddress: () => 'https://media.test/jellyfin'
    };
    context.NativeShell = { AppHost: { getDeviceProfile: () => ({}) }, downloadFile: info => downloads.push(info) };
    vm.runInNewContext(source('offline.js'), context);
    context.tigerestOpenOfflineLibrary = () => { opened++; };

    const url = 'https://media.test/jellyfin/Items/abc/Download?ApiKey=token';
    await context.tigerestEnqueueDownload(url);
    assert.equal(downloads.length, 1);
    assert.equal(downloads[0].url, url, 'Jellyfin has no DirectStreamUrl; its download address is used as given');
    assert.equal(downloads[0].itemId, 'abc');
    assert.equal(downloads[0].fileName, 'Movie.mkv');
    assert.equal(opened, 1);

    await context.tigerestEnqueueDownload('https://media.test/jellyfin/some/file.bin');
    assert.deepEqual(started.map(info => info.url), ['https://media.test/jellyfin/some/file.bin']);
});

test('no page script takes a Jellyfin view change for leaving the page', () => {
    // Jellyfin's web client dispatches untrusted, bubbling pagehide events from view
    // elements. Every page-lifecycle listener checks for the browser's pagehide for
    // the document and is not a once listener, which a view change would use up.
    const root = path.join(__dirname, '..');
    const files = ['native', 'android/app/src/main/assets', 'apple/Resources']
        .flatMap(folder => fs.readdirSync(path.join(root, folder)).filter(name => name.endsWith('.js')).map(name => folder + '/' + name));
    const listeners = [];
    for (const file of files) {
        const text = fs.readFileSync(path.join(root, file), 'utf8');
        for (const [call] of text.matchAll(/addEventListener\(\s*['"]pagehide['"][^;]*/g)) {
            const handler = /^addEventListener\(\s*['"]pagehide['"]\s*,\s*([\w$]+)\s*\)$/.exec(call)?.[1];
            assert.ok(handler, `${file}: ${call}`);
            const guard = new RegExp(`const ${handler}\\s*=\\s*event\\s*=>\\s*\\{\\s*if\\s*\\(\\s*!event\\.isTrusted\\s*\\|\\|\\s*\\(event\\.target\\s*!==\\s*(global\\.)?document\\s*&&\\s*event\\.target\\s*!==\\s*(global|window)\\)\\)\\s*return;\\s*(global|window)\\.removeEventListener\\(\\s*'pagehide'\\s*,\\s*${handler}\\s*\\)`);
            assert.match(text, guard, `${file}: ${handler} must only follow the document's own pagehide`);
            listeners.push(file);
        }
    }
    assert.deepEqual(listeners.sort(), ['android/app/src/main/assets/androidBridge.js', 'android/app/src/main/assets/androidResponsive.js',
        'apple/Resources/ipadBridge.js', 'apple/Resources/ipadResponsive.js', 'native/communityAccount.js', 'native/updatePlugin.js']);
});
