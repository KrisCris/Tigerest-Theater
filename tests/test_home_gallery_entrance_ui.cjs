// The page entrance moves the home with an animated transform. A measurement
// taken meanwhile (Android applies window insets as the entrance starts) must
// size the gallery for where the page settles, not keep the entrance offset.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const withBrowser = require('./community_browser.cjs');
const root = path.resolve(__dirname, '..');
const routes = {
    '/': {type: 'text/html', body: `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
      html,body {margin:0;height:100%;background:#101216;color:#eee;font:16px sans-serif;}
      :root {--tgs-safe-top:43px;--tgs-safe-bottom:16px;}
      .hide {display:none!important;}
      .mainAnimatedPage {bottom:0;contain:layout style size;left:0;position:absolute;right:0;top:0;}
      .navigation {height:60px;}
      .slide-in {animation:slide-in 400ms both;} @keyframes slide-in {from {translate:0 72px;} to {translate:0 0;}}
      </style>
      <div id="details" class="page mainAnimatedPage">详情</div>
      <div id="homePage" class="page mainAnimatedPage hide"><div id="navigation" class="navigation hide"></div><div id="homeTab"><div id="home"></div></div></div>
      <script>window.jmpInfo={settings:{home:{}},capabilities:{desktopWindowControls:false},homeArtPath:location.origin+'/home-art'};</script>
      <script src="/data.js"></script><script src="/gallery.js"></script>`},
    '/data.js': {path: path.join(root, 'native/homeData.js')},
    '/gallery.js': {path: path.join(root, 'native/homeGallery.js')},
    '/poster.svg': {type: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900"><rect width="1600" height="900" fill="#315064"/></svg>'},
};
for (const name of ['anime', 'movies', 'series', 'favorites']) routes['/home-art/' + name + '.png'] = {type: 'image/png', path: path.join(root, 'native/home-art', name + '.png')};

withBrowser(routes, async ({call, evaluate}) => {
    await call('Emulation.setDeviceMetricsOverride', {width: 948, height: 847, deviceScaleFactor: 1, mobile: true});
    await call('Emulation.setEmulatedMedia', {features: [{name: 'prefers-reduced-motion', value: 'no-preference'}]});
    // The native clients run the real appearance script in its own world.
    const {frameTree} = await call('Page.getFrameTree');
    const {executionContextId} = await call('Page.createIsolatedWorld', {frameId: frameTree.frame.id, worldName: 'appearance-entrance'});
    const appearance = await call('Runtime.evaluate', {contextId: executionContextId, returnByValue: true,
        expression: fs.readFileSync(path.join(root, 'native/webAppearance.js'), 'utf8')});
    assert.equal(appearance.exceptionDetails, undefined);

    await evaluate('(' + (function () {
        const check = (ok, message) => { if (!ok) throw Error(message); };
        const frame = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const until = async (fn, label) => {
            for (let i = 0; i < 1000; i++) { const value = fn(); if (value) return value; await new Promise(resolve => setTimeout(resolve, 4)); }
            throw Error('timeout: ' + label);
        };
        const api = {serverId: () => 'fixture-server', serverAddress: () => location.origin, getCurrentUserId: () => 'user',
            getUserViews: async () => ({Items: [{Id: 'movies', Name: '电影', CollectionType: 'movies'}, {Id: 'shows', Name: '剧集', CollectionType: 'tvshows'}]}),
            getItems: async (user, query) => query.Ids ? {Items: query.Ids.split(',').map(id => ({Id: id, Type: 'Movie', Name: '作品 ' + id, BackdropImageTags: ['image']}))}
                : {Items: [{Id: (query.ParentId || 'all') + '-new', Name: '最近入库作品', Type: 'Movie', DateCreated: '2026-10-09', BackdropImageTags: ['image']}]},
            getImageUrl: () => location.origin + '/poster.svg'};
        const homePage = document.getElementById('homePage'), details = document.getElementById('details');
        const tab = document.getElementById('homeTab'), navigation = document.getElementById('navigation');
        const gallery = new TigerestHomeGallery(document.getElementById('home'), {apiProvider: () => api, router: {showItem() {}, showFavorites() {}}});
        const height = () => parseFloat(gallery.root.style.getPropertyValue('--home-height'));
        const expected = () => innerHeight - (navigation.classList.contains('hide') ? 0 : 60) - 8;
        const expectHeight = label => check(Math.abs(height() - expected()) < .5, `${label}: height ${height()}, expected ${expected()}`);
        const animation = (node, name) => until(() => node.getAnimations().find(item => item.animationName === name), name);
        window.fixture = {check, frame, until, gallery, homePage, tab, navigation, expectHeight, animation,
            async settled(label) {
                await frame();
                expectHeight(label);
                const box = gallery.root.getBoundingClientRect();
                check(Math.abs(box.bottom - (innerHeight - 8)) < .5, `${label}: bottom ${box.bottom}, expected ${innerHeight - 8}`);
                const style = getComputedStyle(gallery.root);
                check(style.paddingTop === '53px' && style.paddingBottom === '40px', `${label}: the gallery keeps its safe area ${style.paddingTop}/${style.paddingBottom}`);
            },
            // Jellyfin shows the page; the plugin starts the gallery at viewshow
            // and the appearance script starts the page entrance shortly after.
            async showHome() {
                details.classList.add('hide'); homePage.classList.remove('hide');
                homePage.dispatchEvent(new CustomEvent('viewshow', {bubbles: true}));
                void gallery.start({});
                const entrance = await animation(homePage, 'tigerestPageEnter');
                check(homePage.getBoundingClientRect().top > 1, 'the entrance offsets the page while the home is measured');
                return entrance;
            },
            async entranceDone(entrance) {
                await entrance.finished.catch(() => {});
                await until(() => !homePage.classList.contains('tigerest-page-enter'), 'entrance cleanup');
            },
            leaveHome() {
                gallery.stop(); homePage.classList.add('hide'); details.classList.remove('hide');
                details.dispatchEvent(new CustomEvent('viewshow', {bubbles: true}));
            },
            // Window inset changes arrive as resize events, also mid-entrance.
            remeasure() { dispatchEvent(new Event('resize')); },
        };
        // Runs after the gallery's own listener, which was added first.
        addEventListener('resize', () => {
            if (innerHeight === 948 && !fixture.rotation) fixture.rotation = {duringEntrance: homePage.getAnimations().some(item => item.animationName === 'tigerestPageEnter')};
        });
    }).toString() + ')()');

    const step = (label, body) => evaluate('(async () => { const {check, frame, until, gallery, homePage, tab, navigation, expectHeight, animation} = fixture; '
        + body + ' })().then(() => ' + JSON.stringify(label) + ')').then(done => console.log('passed:', done));

    await step('page entrance', `
        const entrance = await fixture.showHome();
        fixture.remeasure(); expectHeight('during the page entrance');
        await fixture.entranceDone(entrance); await fixture.settled('after the page entrance');`);

    await step('re-entered home with navigation above it', `
        fixture.leaveHome(); navigation.classList.remove('hide'); await frame();
        const entrance = await fixture.showHome();
        fixture.remeasure(); expectHeight('a laid-out navigation offset is kept during the entrance');
        await fixture.entranceDone(entrance); await fixture.settled('re-entered home with navigation above it');
        fixture.leaveHome(); navigation.classList.add('hide'); await frame();
        await fixture.entranceDone(await fixture.showHome()); await fixture.settled('re-entered home without navigation');`);

    await step('tab entrance', `
        tab.classList.add('tigerest-tab-enter-forward');
        const entrance = await animation(tab, 'tigerestTabEnterForward');
        check(Math.abs(tab.getBoundingClientRect().top) > 1, 'the tab entrance scales the home while it is measured');
        fixture.remeasure(); expectHeight('during the tab entrance');
        await entrance.finished.catch(() => {}); tab.classList.remove('tigerest-tab-enter-forward');
        await fixture.settled('after the tab entrance');`);

    for (const ending of ['ends', 'is cancelled']) await step('an ancestor animation ' + ending, `
        homePage.classList.add('slide-in');
        const slide = await animation(homePage, 'slide-in');
        check(homePage.getBoundingClientRect().top > 1, 'the slide offsets the page while the home is measured');
        fixture.remeasure();
        ${ending === 'is cancelled' ? "homePage.classList.remove('slide-in');" : ''}
        await slide.finished.catch(() => {}); homePage.classList.remove('slide-in');
        await fixture.settled('after an ancestor animation ${ending}');`);

    // Rotating the device mid-entrance resizes the actual viewport.
    await evaluate(`(async () => { fixture.leaveHome(); await fixture.frame(); fixture.entrance = await fixture.showHome(); })()`);
    await call('Emulation.setDeviceMetricsOverride', {width: 847, height: 948, deviceScaleFactor: 1, mobile: true});
    await step('rotation during the entrance', `
        const rotation = await until(() => fixture.rotation, 'rotation resize event');
        check(rotation.duringEntrance, 'the rotation arrives during the entrance');
        expectHeight('rotated during the entrance');
        await fixture.entranceDone(fixture.entrance); await fixture.settled('after rotating during the entrance');`);
}).catch(error => { console.error(error); process.exitCode = 1; });
