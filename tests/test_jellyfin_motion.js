// The shared home motion driven through the Jellyfin plugin with a router that
// behaves like Jellyfin 10.9-12.2: hash history, showItem() without a returned
// promise, back() waiting for any pending show(), and favorites in the address
// (Modern) or as a same-page tab that keeps #/home (Legacy).
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const source = name => fs.readFileSync(__dirname + '/../native/' + name, 'utf8');

function jellyfin({modern = true} = {}) {
    const entries = ['/home'], calls = [], effects = [], listeners = {}, routeListeners = new Set();
    let index = 0, legacyTab = 0;
    const account = {user: 'one', server: 's'};
    const address = () => entries[index];
    const changed = () => { for (const fn of [...routeListeners]) fn(); };
    const push = next => { entries.splice(index + 1); entries.push(next); index++; changed(); };
    const location = {
        get hash() { return '#' + address(); },
        set hash(value) { calls.push(['push', value.replace(/^#/, '')]); push(value.replace(/^#/, '')); },
        get href() { return 'http://jf.test/web/index.html#' + address(); },
        replace(url) { const next = url.split('#')[1]; calls.push(['replace', next]); entries[index] = next; changed(); }
    };
    const history = {back() { calls.push(['back']); if (index > 0) { index--; changed(); } }};
    const tabButton = tab => ({click() { calls.push(['tab', tab]); legacyTab = tab; }, classList: {contains: name => name === 'emby-tab-button-active' && legacyTab === tab}});
    const page = () => {
        const current = address(), detail = current.startsWith('/details'), home = current.startsWith('/home');
        return {
            id: detail ? 'itemDetailPage' : home ? 'indexPage' : 'moviesPage',
            classList: {contains: () => false}, getClientRects: () => [{}], getBoundingClientRect: () => ({width: 800, height: 600}),
            matches: selector => detail && selector.split(',').includes('.itemDetailPage'), contains: () => true, querySelectorAll: () => [],
            querySelector: selector => {
                if (!home || modern) return null;
                if (selector === '#homeTab') return {};
                if (selector === '#favoritesTab.is-active') return legacyTab === 1 ? {} : null;
                const tab = /data-index="(\d)"/.exec(selector);
                return tab ? tabButton(Number(tab[1])) : null;
            }
        };
    };
    const document = {
        head: null, body: {classList: {contains: () => false}},
        addEventListener: (type, fn) => { listeners[type] = fn; }, removeEventListener() {},
        getElementById: () => null, createElement: () => ({}),
        querySelector: selector => selector.includes('MuiAppBar') ? (modern ? {} : null)
            : selector.includes('emby-tab-button') ? page().querySelector(selector) : null,
        querySelectorAll: selector => selector.includes('.page') ? [page()] : []
    };
    // Jellyfin's appRouter: show() resolves when the next view is shown.
    const router = {
        promiseShow: null,
        baseUrl: () => 'http://jf.test/web',
        getRouteUrl: item => item.Type === 'CollectionFolder' ? `#/movies?topParentId=${item.Id}&collectionType=movies` : `#/details?id=${item.Id}&serverId=${item.ServerId}`,
        async show(path) {
            if (this.promiseShow) await this.promiseShow;
            calls.push(['show', path.replace(/^#/, '')]);
            this.promiseShow = new Promise(resolve => { this.resolveOnNextShow = resolve; });
            push(path.replace(/^#/, ''));
            this.promiseShow = null; this.resolveOnNextShow();
        },
        showItem(item, serverId) { this.show(this.getRouteUrl({...item, ServerId: item.ServerId || serverId})); },
        async back() {
            if (this.promiseShow) await this.promiseShow;
            this.promiseShow = new Promise(resolve => {
                const listener = () => { routeListeners.delete(listener); this.promiseShow = null; resolve(); };
                routeListeners.add(listener); history.back();
            });
            return this.promiseShow;
        },
        goHome() { return this.show('/home'); }
    };
    const context = {
        console: {info() {}, warn() {}}, Promise, Date, URL, URLSearchParams, AbortController,
        setTimeout: (...args) => setTimeout(...args), clearTimeout: (...args) => clearTimeout(...args), setInterval: () => 1, clearInterval() {},
        location, history, document, addEventListener() {}, removeEventListener() {},
        TigerestHomeTransitions: {
            poster: async options => { effects.push(['poster', options.direction, options.itemId]); return options.navigate(); },
            library: async options => { effects.push(['library']); return options.navigate(); },
            homeReturn: async options => { effects.push(['home']); return options.navigate(); },
            cancel() {}
        }
    };
    context.window = context;
    vm.runInNewContext(source('homeMotion.js') + '\n;\n' + source('jellyfinPlugin.js'), context);
    const original = {back: router.back, showItem: router.showItem};
    const manager = {currentApiClient: () => ({serverId: () => account.server, getCurrentUserId: () => account.user})};
    const plugin = new context._tigerestJellyfinPlugin({events: {on() {}}, appRouter: router, ServerConnections: manager});
    // A pointer press on a card's artwork, as Jellyfin renders library and detail cards.
    const press = id => { const image = {isConnected: true}, card = {dataset: {id}, querySelector: () => image, closest: selector => selector === '.itemsContainer' ? null : card};
        listeners.pointerdown({target: {closest: () => card}}); return image; };
    const motion = context.TigerestHomeMotion;
    // What the home gallery does for a library and for a poster.
    const openLibrary = library => motion.openLibrary({gallery: {}, library, navigate: () => library.kind === 'favorites'
        ? plugin.home.openFavorites() : router.showItem({...library, ServerId: 's'}, 's')});
    const openItem = (item, library) => motion.openItem({card: {item}, library, source: {}, navigate: () => router.showItem({...item, ServerId: 's'}, 's')});
    return {router, original, plugin, motion, calls, effects, account, press, openLibrary, openItem,
        get address() { return address(); }, get entries() { return entries.slice(0, index + 1); }, get legacyTab() { return legacyTab; }};
}
const movies = {Id: 'L', Type: 'CollectionFolder', CollectionType: 'movies'}, favorites = {Id: 'tigerest-favorites', kind: 'favorites'};
const libraryAddress = '/movies?topParentId=L&collectionType=movies';
const work = {Id: 'work', Type: 'Movie'};

test('Jellyfin attaches the shared motion to its own router', () => {
    const s = jellyfin();
    assert.notEqual(s.router.back, s.original.back, 'back returns through the motion');
    assert.notEqual(s.router.showItem, s.original.showItem, 'cards open through the motion');
    assert.equal(s.motion.handleNativeBack(), false, 'the home keeps its own back');
});

test('home, library, detail, then back to the library and back to the home', async () => {
    const s = jellyfin();
    await s.openLibrary(movies);
    assert.equal(s.address, libraryAddress);
    s.press('work'); s.router.showItem({...work, ServerId: 's'});
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(s.address, '/details?id=work&serverId=s');
    await s.router.back();
    assert.equal(s.address, libraryAddress, 'the detail returns to its poster wall');
    await s.router.back();
    assert.equal(s.address, '/home');
    assert.deepEqual(s.effects, [['library'], ['poster', 'enter', 'work'], ['poster', 'return', 'work'], ['home']]);
    assert.deepEqual(s.entries, ['/home']);
});

test('a poster opened on the home returns to its library, which then returns home', async () => {
    const s = jellyfin();
    await s.openItem(work, movies);
    assert.deepEqual(s.entries, ['/home', '/details?id=work&serverId=s']);
    assert.equal(s.motion.handleNativeBack(), true, 'Android back follows the same return');
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.deepEqual(s.entries, ['/home', libraryAddress], 'the library replaces the detail entry');
    await s.router.back();
    assert.deepEqual(s.entries, ['/home']);
    assert.deepEqual(s.effects, [['poster', 'enter', 'work'], ['poster', 'return', 'work'], ['home']]);
});

test('an episode opened on its series returns to the series, then to the library', async () => {
    const s = jellyfin();
    await s.openItem({Id: 'series', Type: 'Series'}, movies);
    s.press('episode'); s.router.showItem({Id: 'episode', Type: 'Episode', ServerId: 's'});
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(s.address, '/details?id=episode&serverId=s');
    await s.router.back();
    assert.equal(s.address, '/details?id=series&serverId=s');
    await s.router.back();
    assert.deepEqual(s.entries, ['/home', libraryAddress]);
    assert.deepEqual(s.effects, [['poster', 'enter', 'series'], ['poster', 'enter', 'episode'], ['poster', 'return', 'episode'], ['poster', 'return', 'series']]);
    assert.equal(s.motion.entry, null);
});

for (const artwork of ['both', 'neither', 'episode']) test(`series, season and episode retain parents with artwork on ${artwork}`, async () => {
    const s = jellyfin();
    await s.openItem({Id: 'series', Type: 'Series'}, movies);
    for (const [Id, Type] of [['season', 'Season'], ['episode', 'Episode']]) {
        if (artwork === 'both' || artwork === Id) s.press(Id);
        s.router.showItem({Id, Type, ServerId: 's'});
        await new Promise(resolve => setTimeout(resolve, 0));
    }
    await s.router.back();
    assert.equal(s.address, '/details?id=season&serverId=s');
    await s.router.back();
    assert.equal(s.address, '/details?id=series&serverId=s');
    await s.router.back();
    assert.deepEqual(s.entries, ['/home', libraryAddress]);
    assert.deepEqual(s.effects.map(value => value.slice(0, 3)), [
        ['poster','enter','series'], ['poster','enter','season'], ['poster','enter','episode'],
        ['poster','return','episode'], ['poster','return','season'], ['poster','return','series']
    ]);
});

for (const modern of [true, false]) {
    const layout = modern ? 'Modern' : 'Legacy';
    test(`${layout} favorites opened on the home return home without another history entry`, async () => {
        const s = jellyfin({modern});
        await s.openLibrary(favorites);
        if (modern) assert.equal(s.address, '/home?tab=1'); else assert.equal(s.legacyTab, 1);
        s.press('work'); s.router.showItem({...work, ServerId: 's'});
        await new Promise(resolve => setTimeout(resolve, 0));
        await s.router.back();
        if (modern) assert.equal(s.address, '/home?tab=1'); else assert.equal(s.legacyTab, 1);
        await s.router.back();
        assert.equal(s.address, '/home'); assert.equal(s.legacyTab, 0);
        assert.deepEqual(s.entries, ['/home']);
        assert.deepEqual(s.effects, [['library'], ['poster', 'enter', 'work'], ['poster', 'return', 'work'], ['home']]);
    });
    test(`${layout} favorite opened on the home returns to the favorites, then home`, async () => {
        const s = jellyfin({modern});
        await s.openItem(work, favorites);
        await s.router.back();
        await new Promise(resolve => setTimeout(resolve, 120));
        if (modern) assert.deepEqual(s.entries, ['/home', '/home?tab=1']); else assert.equal(s.legacyTab, 1);
        await s.router.back();
        assert.deepEqual(s.entries, ['/home']); assert.equal(s.legacyTab, 0);
        assert.deepEqual(s.effects, [['poster', 'enter', 'work'], ['poster', 'return', 'work'], ['home']]);
    });
}

test('the return context belongs to the account that opened it', async () => {
    const s = jellyfin();
    await s.openItem(work, movies);
    s.account.user = 'two';
    assert.equal(s.motion.handleNativeBack(), false);
    await s.router.back();
    assert.deepEqual(s.entries, ['/home'], 'another account gets the original back');
    assert.deepEqual(s.effects, [['poster', 'enter', 'work']]);
});

test('a Jellyfin navigation promise left pending cannot hold the transition', async t => {
    const s = jellyfin();
    await s.openLibrary(movies);
    t.mock.timers.enable({apis: ['setTimeout']});
    s.router.promiseShow = new Promise(() => {});
    let settled = false;
    const back = s.router.back().then(() => { settled = true; });
    await Promise.resolve();
    t.mock.timers.tick(3000);
    for (let i = 0; i < 5; i++) await Promise.resolve();
    assert.equal(settled, true, 'the home return finishes and releases its cover');
    t.mock.timers.reset();
    await back;
});
