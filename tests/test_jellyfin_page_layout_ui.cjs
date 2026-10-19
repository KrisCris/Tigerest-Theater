// Browser geometry for Jellyfin's item detail and standalone (server, login)
// pages. The pages copy the 10.11/12.2 DOM, the stock stylesheet, a branding
// theme that pins the poster under a taller header, the Android safe-area
// rules and both the Legacy (.skinHeader) and Modern (MUI app bar) shells.
const assert = require('node:assert/strict');
const path = require('node:path');
const withBrowser = require('./community_browser.cjs');
const root = path.resolve(__dirname, '..');
const fixtures = path.join(__dirname, 'fixtures/jellyfin-detail');

function setup() {
    const html = document.documentElement;
    const settle = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 30))));
    const box = node => {
        if (!node || !node.getClientRects().length) return null;
        const r = node.getBoundingClientRect();
        return r.width < 0.5 || r.height < 0.5 ? null : {x: r.left, y: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height};
    };
    const overlap = (a, b) => Math.min(a.r, b.r) - Math.max(a.x, b.x) > 0.5 && Math.min(a.b, b.b) - Math.max(a.y, b.y) > 0.5;
    const union = boxes => boxes.length ? boxes.reduce((a, b) => ({x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), r: Math.max(a.r, b.r), b: Math.max(a.b, b.b)})) : null;

    function environment({android, theme, width, height}) {
        document.getElementById('android').sheet.disabled = !android;
        document.getElementById('theme').sheet.disabled = !theme;
        const safe = {top: android ? 43.43 : 0, left: android && width > height ? 32 : 0};
        for (const edge of ['top', 'right', 'bottom', 'left']) html.style.setProperty('--tgs-safe-' + edge, (safe[edge] || 0) + 'px');
        return safe;
    }
    function legacyHeader({back, actions, logo}) {
        return `<div class="skinHeader focuscontainer-x skinHeader-withBackground semiTransparent">
          <div class="flex align-items-center flex-grow headerTop">
            <div class="headerLeft"><button type="button" class="headerButton headerButtonLeft headerBackButton paper-icon-button-light${back ? '' : ' hide'}">&lsaquo;</button><h3 class="pageTitle pageTitleWithLogo pageTitleWithDefaultLogo${logo ? '' : ' hide'}" style="background-image:linear-gradient(90deg,#7a5cff,#00a4dc)"></h3></div>
            <div class="headerRight"><button type="button" class="headerButton headerSearchButton${actions ? '' : ' hide'}">S</button><button type="button" class="headerButton headerUserButton${actions ? '' : ' hide'}">U</button></div>
          </div></div>`;
    }
    function shell(kind, safe, page, header = {back: true, actions: true}) {
        return kind === 'modern'
            ? `<header class="MuiAppBar-root MuiAppBar-positionFixed"><div class="MuiToolbar-root"><button type="button">Menu</button></div></header><div aria-hidden="true" style="height:${48 + safe.top}px"></div><main>${page}</main>`
            : `${legacyHeader(header)}<div class="mainAnimatedPages skinBody">${page}</div>`;
    }
    function detail(kind) {
        const portrait = kind === 'movie', modern = kind === 'series';
        const name = kind === 'episode'
            ? '<h1 class="parentName focuscontainer-x"><bdi><a class="button-link">Probe Series</a></bdi></h1><h3 class="itemName infoText subtitle focuscontainer-x"><bdi>S1:E1 - An episode title long enough to need the full column</bdi></h3>'
            : `<h1 class="itemName infoText parentNameLast">Probe ${kind} with a long title</h1>`;
        const buttons = ['btnPlay', 'btnShuffle hide', 'btnPlaystate', 'btnUserRating', 'btnMoreCommands']
            .map(name => `<button type="button" class="button-flat ${name} detailButton emby-button"><div class="detailButton-content"><span class="material-icons detailButton-icon"></span></div></button>`).join('');
        const cards = Array.from({length: 4}, (_, i) => `<div class="card overflowBackdropCard"><div class="cardBox"><div class="cardScalable"><div class="cardPadder cardPadder-backdrop"></div><div class="cardImageContainer cardContent" style="background:#345"></div></div><div class="cardText">Episode ${i + 1}</div></div></div>`).join('');
        const section = (name, title) => `<div class="verticalSection detailVerticalSection ${name} emby-scroller-container"><h2 class="sectionTitle sectionTitle-cards padded-right">${title}</h2><div class="emby-scroller"><div class="scrollSlider focuscontainer-x itemsContainer">${cards}</div></div></div>`;
        // 12.2 renders the series sections inside the primary content; 10.x
        // renders "more from season" and cast in the secondary container.
        return `<div id="itemDetailPage" class="page libraryPage itemDetailPage noSecondaryNavPage selfBackdropPage mainAnimatedPage">
          <div id="itemBackdrop" class="itemBackdrop" style="background-image:linear-gradient(#456,#123)"></div>
          <div class="detailLogo" style="background-image:linear-gradient(#fff,#999)"></div>
          <div class="detailPageWrapperContainer"><div class="detailPagePrimaryContainer">
            <div class="detailImageContainer hide-mobile"><div class="card ${portrait ? 'portraitCard' : 'backdropCard'}"><div class="cardBox"><div class="cardScalable"><div class="cardPadder cardPadder-${portrait ? 'portrait' : 'backdrop'}"></div><div class="cardImageContainer coveredImage cardContent" style="background-image:linear-gradient(#a85,#542)"></div></div></div></div></div>
            <div class="detailRibbon padded-left padded-right">
              <div class="infoWrapper"><div class="detailImageContainer hide-desktop hide-tv"></div><div class="nameContainer">${name}</div>
                <div class="itemMiscInfo itemMiscInfo-primary"><div class="mediaInfoItem">2024</div><div class="mediaInfoItem">45 min</div><div class="endsAt mediaInfoItem">Ends at 22:30</div></div></div>
              <div class="mainDetailButtons focuscontainer-x">${buttons}</div>
            </div>
            <div class="detailPagePrimaryContent padded-right"><div class="detailSection">
              <form class="trackSelections focuscontainer-x">${['Video', 'Audio', 'Subtitles'].map(label => `<div class="selectContainer trackSelectionFieldContainer"><label class="selectLabel">${label}</label><select class="detailTrackSelect"><option>${label} 1 - a long stream description</option></select></div>`).join('')}</form>
              <div class="detailSectionContent"><p class="overview detail-clamp-text"><bdi>${'An overview sentence that runs across several lines. '.repeat(8)}</bdi></p></div>
              <div class="itemDetailsGroup"></div>${modern ? section('nextUpSection', 'Next Up') + section('childrenSection', 'Seasons') : ''}
            </div></div>
          </div>
          <div class="detailPageSecondaryContainer ${modern ? 'padded-left ' : ''}padded-bottom-page">${modern ? '' : `<div class="detailPageContent">${section('moreFromSeasonSection', 'More from Season 1')}</div>`}</div>
          </div></div>`;
    }
    async function show(markup) {
        const host = document.getElementById('reactRoot');
        host.innerHTML = markup;
        const page = [...host.querySelectorAll('.page')].at(-1);
        page?.dispatchEvent(new CustomEvent('viewshow', {bubbles: true}));
        await settle();
        return page;
    }

    window.checkDetail = async (width, height) => {
        const failures = [];
        for (const android of [false, true]) for (const theme of [false, true]) for (const shellKind of ['legacy', 'modern'])
            for (const kind of ['episode', 'movie', 'series']) {
                const label = `${width}x${height} ${android ? 'android' : 'windows'} ${theme ? 'theme' : 'stock'} ${shellKind} ${kind}`;
                const fail = message => failures.push(label + ': ' + message + ' actions=' + JSON.stringify([...document.querySelectorAll('.skinHeader button, .skinHeader a')].map(n=>({cls:n.className,display:getComputedStyle(n).display,hidden:n.hidden}))) + ' clearance=' + html.style.getPropertyValue('--tg-jf-header-clearance'));
                const safe = environment({android, theme, width, height});
                const page = await show(shell(shellKind, safe, detail(kind)));
                const header = box(document.querySelector('.skinHeader, header.MuiAppBar-root'));
                const headerBottom = header ? header.b : 0;
                const card = box(page.querySelector('.detailImageContainer.hide-mobile .card'));
                const info = box(page.querySelector('.infoWrapper'));
                const buttons = [...page.querySelectorAll('.mainDetailButtons > .detailButton')].map(box).filter(Boolean);
                const row = union(buttons);
                const tracks = box(page.querySelector('form.trackSelections'));
                const overview = box(page.querySelector('.overview'));
                const sections = [...page.querySelectorAll('.detailVerticalSection')].map(box).filter(Boolean);
                if (!card || !info || !row || !overview || !tracks || sections.length === 0) { fail('missing content ' + JSON.stringify({card, info, row, overview, tracks, sections: sections.length})); continue; }
                for (const [name, item] of Object.entries({card, info, buttons: row})) {
                    if (item.y < headerBottom - 0.5) fail(`${name} top ${item.y.toFixed(1)} is under the header ending at ${headerBottom.toFixed(1)}`);
                }
                const parts = {card, info, buttons: row, tracks, overview, ...Object.fromEntries(sections.map((s, i) => ['section' + i, s]))};
                const names = Object.keys(parts);
                for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) {
                    if (overlap(parts[names[i]], parts[names[j]])) fail(`${names[i]} overlaps ${names[j]} ${JSON.stringify([parts[names[i]], parts[names[j]]])}`);
                }
                for (const [name, item] of Object.entries(parts)) if (item.x < -0.5 || item.r > width + 0.5) fail(`${name} is clipped horizontally ${item.x.toFixed(1)}..${item.r.toFixed(1)}`);
                for (let i = 0; i < buttons.length; i++) for (let j = i + 1; j < buttons.length; j++) if (overlap(buttons[i], buttons[j])) fail('detail buttons overlap');
                if (html.scrollWidth > width + 1 || innerWidth !== width) fail(`the page scrolls sideways: ${html.scrollWidth}px in a ${innerWidth}px viewport`);
                for (const line of page.querySelectorAll('.nameContainer > *, .itemMiscInfo')) {
                    const item = box(line);
                    if (item && (item.x < info.x - 0.5 || item.r > info.r + 0.5)) fail(`${line.className} runs out of the title column ${item.x.toFixed(1)}..${item.r.toFixed(1)}`);
                    if (width <= 1000 && line.scrollWidth > line.clientWidth + 1) fail(`${line.className} is cut off`);
                }
                if (width <= 1000) {
                    // One column of content with the poster beside the title.
                    const gutter = Math.max(12, 0.033 * width, (android ? safe.left : 0) + 12);
                    for (const [name, item] of Object.entries({card, buttons: row, tracks, overview, ...Object.fromEntries(sections.map((s, i) => ['section' + i, s]))})) {
                        if (Math.abs(item.x - gutter) > 1.5) fail(`${name} starts at ${item.x.toFixed(1)}, not the ${gutter.toFixed(1)} gutter`);
                    }
                    if (info.x < card.r + 8 || info.x > card.r + 28) fail(`title column starts at ${info.x.toFixed(1)} beside a poster ending at ${card.r.toFixed(1)}`);
                    if (info.w < 120) fail('title column is too narrow: ' + info.w.toFixed(1));
                    if (card.w > width * 0.45 || card.w < 80) fail('poster width ' + card.w.toFixed(1));
                    if (overview.r > width - gutter + 1.5 && overview.r > width - 12 - 1) fail('overview reaches the right edge ' + overview.r.toFixed(1));
                    if (box(page.querySelector('.detailLogo'))) fail('the wide logo stays above the compact detail');
                    // The navigation offset is applied once: the poster follows the
                    // theme's backdrop or the header, whichever ends lower.
                    const pageTop = page.getBoundingClientRect().top;
                    const backdrop = (theme ? 0.2 : 0.4) * height;
                    const expected = Math.max(headerBottom, pageTop + backdrop);
                    if (card.y > expected + 40) fail(`poster starts at ${card.y.toFixed(1)}, far below ${expected.toFixed(1)}: navigation counted twice`);
                } else {
                    if (Math.abs(info.x - overview.x) > 2) fail(`title starts at ${info.x.toFixed(1)} but the content at ${overview.x.toFixed(1)}`);
                    if (card.r > info.x + 0.5) fail('poster runs into the title column');
                }
            }
        return failures;
    };

    window.checkStandalone = async (width, height) => {
        const failures = [];
        const pages = {
            selectserver: {header: {back: false, actions: false, logo: true}, page: `<div id="selectServerPage" class="page standalonePage pageContainer mainAnimatedPage"><div class="margin-auto-y padded-bottom-page"><div class="verticalSection"><div class="padded-left padded-right"><h1 class="sectionTitle sectionTitle-cards">Select Server</h1></div><div class="servers"><button type="button" class="card overflowSquareCard loginSquareCard">TIGEREST-STUDIO</button></div></div><div class="padded-top padded-left padded-right"><a href="#/addserver" class="raised cancel btnAddServer">Add Server</a></div></div></div>`},
            login: {header: {back: false, actions: false, logo: true}, page: `<div id="loginPage" class="page standalonePage backdropPage mainAnimatedPage"><div class="padded-left padded-right padded-bottom-page margin-auto-y"><form class="manualLoginForm margin-auto-x"><div class="padded-left padded-right"><h1 class="sectionTitle">Please sign in</h1></div><div class="inputContainer"><label for="txtManualName">User</label><input id="txtManualName" type="text"></div><div class="inputContainer"><label for="txtManualPassword">Password</label><input id="txtManualPassword" type="password"></div><button type="submit" class="raised button-submit block">Sign In</button></form></div></div>`},
            addserver: {header: {back: true, actions: false, logo: true}, page: `<div class="page standalonePage mainAnimatedPage"><div class="padded-left padded-right padded-bottom-page"><form class="addServerForm"><h1>Connect to Server</h1><div class="inputContainer"><label for="txtServerHost">Host</label><input id="txtServerHost" type="text" inputmode="url"></div><button type="submit" class="raised button-submit block">Connect</button><button type="button" class="raised button-cancel block btnCancel">Cancel</button></form></div></div>`}
        };
        for (const android of [false, true]) for (const theme of [false, true]) for (const shellKind of ['legacy', 'modern']) for (const [name, spec] of Object.entries(pages)) {
            const label = `${width}x${height} ${android ? 'android' : 'windows'} ${theme ? 'theme' : 'stock'} ${shellKind} ${name}`;
            const fail = message => failures.push(label + ': ' + message + ' actions=' + JSON.stringify([...document.querySelectorAll('.skinHeader button, .skinHeader a')].map(n=>({cls:n.className,display:getComputedStyle(n).display,hidden:n.hidden}))) + ' clearance=' + html.style.getPropertyValue('--tg-jf-header-clearance'));
            const safe = environment({android, theme, width, height});
            const page = await show(shell(shellKind, safe, spec.page, spec.header));
            const headerNode = document.querySelector(shellKind === 'modern' ? 'header.MuiAppBar-root' : '.skinHeader');
            const header = box(headerNode);
            const first = [...page.querySelectorAll('h1, input, button, a')].map(box).filter(Boolean).sort((a, b) => a.y - b.y)[0];
            if (!first) { fail('no visible content'); continue; }
            const top = Math.max(header ? header.b : 0, safe.top);
            if (first.y < top + 4) fail(`first control at ${first.y.toFixed(1)} is under the header/status bar ending at ${top.toFixed(1)}`);
            if (shellKind === 'legacy') {
                if (spec.header.back && !header) fail('a header with a back button was hidden');
                // Native builds inject functional settings/offline buttons.
                // Preserve those headers; only genuinely empty headers hide.
                const actions = [...headerNode.querySelectorAll('button,a[href],input')].some(node =>
                    !node.disabled && getComputedStyle(node).display !== 'none' && getComputedStyle(node).visibility !== 'hidden');
                if (!spec.header.back && !actions && header) fail(`an empty ${header.h.toFixed(1)}px header still covers the page`);
            } else if (!header) fail('the Modern app bar was hidden');
            // The theme moves the login form down by its own margin.
            const own = parseFloat(getComputedStyle(page.firstElementChild).marginTop) || 0;
            if (first.y > top + own + 140) fail(`first control pushed down to ${first.y.toFixed(1)}`);
        }
        // The empty header returns with a back button and on other pages.
        const safe = environment({android: true, theme: true, width, height});
        const login = await show(shell('legacy', safe, pages.login.page, pages.login.header));
        document.querySelector('.headerBackButton').classList.remove('hide');
        await new Promise(resolve => setTimeout(resolve, 600));
        await settle();
        const header = box(document.querySelector('.skinHeader'));
        if (!header) failures.push(`${width}: a back button added after showing the login page stays hidden`);
        else if (box(login.querySelector('input')).y < header.b) failures.push(`${width}: login fields stay under the restored header`);
        await show(shell('legacy', safe, detail('episode')));
        if (!box(document.querySelector('.skinHeader'))) failures.push(`${width}: leaving the standalone page keeps the header hidden`);
        return failures;
    };
}

withBrowser({
    '/': {type: 'text/html', body: `<!doctype html><html class="layout-desktop"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
      <link rel="stylesheet" href="/jellyfin.css"><link id="android" rel="stylesheet" href="/android.css"><link id="theme" rel="stylesheet" href="/theme.css">
      <style>body{background:#101010;color:#ddd}.flex{display:flex}.align-items-center{align-items:center}.flex-grow{flex-grow:1}
      #reactRoot,.mainAnimatedPages,main{position:relative;min-height:100vh}
      .MuiAppBar-positionFixed{position:fixed;top:0;left:0;right:0;display:flex;flex-direction:column;z-index:1100;background:#202020}.MuiToolbar-root{height:48px;display:flex;align-items:center}
      .inputContainer{margin-bottom:1.8em}input{display:block;width:100%;box-sizing:border-box;height:2.4em}.raised{display:block;padding:.9em 1em;margin:.5em 0}.loginSquareCard{width:10em;height:10em}</style>
      <script src="/jellyfin.js"></script>
      </head><body dir="ltr"><div id="reactRoot"></div></body></html>`},
    '/jellyfin.css': {type: 'text/css', path: path.join(fixtures, 'jellyfin-10.11.css')},
    '/theme.css': {type: 'text/css', path: path.join(fixtures, 'branded-theme.css')},
    '/android.css': {type: 'text/css', path: path.join(root, 'android/app/src/main/assets/androidResponsive.css')},
    '/jellyfin.js': {path: path.join(root, 'native/jellyfinPlugin.js')}
}, async ({evaluate, call}) => {
    await call('Emulation.setEmulatedMedia', {features: [{name: 'prefers-reduced-motion', value: 'reduce'}]});
    await evaluate(`(${setup})();window.tigerestPlugin=new _tigerestJellyfinPlugin({events:{on(){}},appRouter:{},ServerConnections:{currentApiClient:()=>null}});true`);
    const failures = [];
    for (const [width, height] of [[390, 844], [600, 900], [847, 948], [948, 847], [1280, 800]]) {
        await call('Emulation.setDeviceMetricsOverride', {width, height, deviceScaleFactor: 1, mobile: true});
        failures.push(...await evaluate(`checkDetail(${width},${height})`));
        failures.push(...await evaluate(`checkStandalone(${width},${height})`));
    }
    assert.equal(failures.length, 0, `${failures.length} layout failures:\n${failures.slice(0, process.env.TIGEREST_LAYOUT_ALL ? Infinity : 80).join('\n')}`);
    console.log(JSON.stringify({passed: true, widths: [390, 600, 847, 948, 1280]}));
}, {gpu: true, visible: process.argv.includes('--webengine'), startupTimeout: 30000})
    .catch(error => { console.error(error); process.exitCode = 1; });
