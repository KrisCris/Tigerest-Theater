// Exercise the real client entries; native navigation and settings are the boundary doubles.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const withBrowser = require('./community_browser.cjs');
const shell = fs.readFileSync(path.join(__dirname, '../native/nativeshell.js'), 'utf8');
const history = fs.readFileSync(path.join(__dirname, '../native/serverHistory.js'), 'utf8');
const entries = shell.slice(shell.indexOf('function installHorizontalShelfDragging()'), shell.indexOf('\ninstallServerSwitchEntry();'));
const makePage = windowControls => `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{margin:0;background:#151923;color:#fff;font:16px sans-serif}.headerRight{display:flex;justify-content:flex-end;gap:4px}.headerButton{min-width:44px;height:40px}</style><body>
<script>
(async () => {
${history}
window.switches = 0; window.opened = []; window.saved = [];
window.tigerestSwitchServer = () => switches++;
window.tigerestOpenMpvSettings = section => opened.push(section);
window.tigerestOpenOfflineLibrary = () => opened.push('offline');
// The page is served from the remembered server's base path.
const current = window.current = location.origin + '/jellyfin/';
window.errors = []; window.addEventListener('error', event => errors.push(event.message));
window.jmpInfo = {capabilities: {desktopWindowControls: ${windowControls}}, settings: {main: {userWebClient: current, serverConnectionMode: 'custom',
  knownServers: TigerestServerHistory.remember('', {mode: 'custom', address: current, at: 1700000000000})}}};
window.fullscreen = false; window.fullscreenRequests = [];
window.api = {settings: {value: async () => jmpInfo.settings.main.knownServers}, window: {setCursorVisibility() {}, isFullScreen: async () => fullscreen,
  setFullScreen: async value => { fullscreenRequests.push(value); fullscreen = value; }, fullScreenSwitched: {connect() {}}}};
window.initCompleted = Promise.resolve();
let identity = null, ready; const readyPromise = new Promise(resolve => { ready = resolve; });
window.TigerestServer = {base: location.origin + '/jellyfin', get identity() { return identity; }, ready: readyPromise, headerUserButton: () => document.querySelector('.headerUserButton')};
window.finishIdentity = value => { identity = value; ready('jellyfin'); };
${entries};installServerSwitchEntry();
})();</script>`;
const page = makePage(false);
// Run in a real same-origin child realm. Qt injects its full native shell into
// the top frame; those observers must not bind a second copy to fixture buttons.
const host = '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body,iframe{margin:0;width:100%;height:100%;border:0}iframe{display:block}</style><iframe id="fixture" src="/jellyfin/web/index.html"></iframe>';
withBrowser({'/': {type: 'text/html', body: host}, '/jellyfin/web/index.html': {type: 'text/html', body: page},
    '/modern/web/index.html': {type: 'text/html', body: makePage(true)}}, async ({evaluate: rawEvaluate, call}) => {
    const evaluate = expression => rawEvaluate(`document.getElementById('fixture').contentWindow.eval(${JSON.stringify(expression)})`);
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
    const settle = () => evaluate('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))');
    await rawEvaluate('(async () => { await window.initCompleted; window.TigerestUpdate?.destroy(); })()');
    for (let i = 0; i < 50 && !await evaluate(`location.pathname === '/jellyfin/web/index.html' && !!window.finishIdentity`).catch(() => false); i++) await wait(50);
    await evaluate(`document.body.insertAdjacentHTML('beforeend', '<header class="skinHeader"><div class="headerRight"><button class="headerButton" id="cast">投屏</button><button class="headerButton headerUserButton" aria-label="账户">A</button></div></header>')`);
    await wait(80);
    // One named client menu replaces the separate MPV and server buttons.
    const header = await evaluate(`({ids: [...document.querySelectorAll('.headerRight > *')].map(n => n.id || n.className),
        text: document.querySelector('#tigerest-mpv-settings-button').textContent, popup: document.querySelector('#tigerest-mpv-settings-button').getAttribute('aria-haspopup'),
        label: document.querySelector('#tigerest-mpv-settings-button').getAttribute('aria-label')})`);
    assert.deepEqual(header.ids, ['cast', 'tigerest-mpv-settings-button', 'headerButton headerUserButton'], 'only one client entry is added to the toolbar');
    assert.equal(header.text, '客户端');
    assert.equal(header.popup, 'menu');
    assert.match(header.label, /切换服务器/);
    // Jellyfin's avatar is an inline background on an inner .headerButton div:
    // the whole picture fills the round button, without a second button look.
    await evaluate(`document.body.insertAdjacentHTML('beforeend', '<div class="headerRight" id="jf-avatar-row"><button class="headerButton headerButtonRight headerUserButton paper-icon-button-light headerUserButtonRound" title="Tigerest"><div class="headerButton headerButtonRight paper-icon-button-light headerUserButtonRound" style="background-image:url(&quot;data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%27400%27 height=%27400%27/%3E&quot;)"></div></button></div>')`);
    await wait(80);
    const avatar = await evaluate(`(() => { const button = document.querySelector('#jf-avatar-row .headerUserButton'), inner = button.firstElementChild, s = getComputedStyle(inner), a = button.getBoundingClientRect(), b = inner.getBoundingClientRect();
      return {size: s.backgroundSize, position: s.backgroundPosition, repeat: s.backgroundRepeat, color: s.backgroundColor, border: s.borderTopWidth, blur: s.backdropFilter, image: s.backgroundImage.startsWith('url('),
        fills: Math.abs(a.width - b.width) < 3 && Math.abs(a.height - b.height) < 3 && Math.abs(a.left - b.left) < 2 && Math.abs(a.top - b.top) < 2}; })()`);
    assert.deepEqual(avatar, {size: 'cover', position: '50% 50%', repeat: 'no-repeat', color: 'rgba(0, 0, 0, 0)', border: '0px', blur: 'none', image: true, fills: true}, 'Jellyfin avatar fills its button');
    await evaluate(`document.getElementById('jf-avatar-row').remove()`);
    for (const width of [390, 600, 847, 948, 1280]) {
        await call('Emulation.setDeviceMetricsOverride', {width, height: 800, deviceScaleFactor: 1, mobile: width < 900});
        await settle();
        await evaluate(`document.querySelector('#tigerest-mpv-settings-button').click()`);
        const menu = await evaluate(`(() => { const menu = document.querySelector('#tigerest-client-menu'), rect = menu.getBoundingClientRect();
          return {items: [...menu.querySelectorAll('[role=menuitem]')].map(n => n.firstChild.textContent), server: menu.querySelector('.tigerest-client-menu-name').textContent,
            inside: rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight, focused: document.activeElement.getAttribute('role'),
            expanded: document.querySelector('#tigerest-mpv-settings-button').getAttribute('aria-expanded'), scroll: document.documentElement.scrollWidth <= innerWidth}; })()`);
        assert.deepEqual(menu.items, ['切换 / 管理服务器', '播放器设置（MPV）', '客户端设置', '下载与离线媒体'], width + ': menu hierarchy');
        assert.equal(menu.server, await evaluate('location.host'), width + ': current server shown before the server names itself');
        assert.ok(menu.inside && menu.scroll, width + ': menu fits the viewport');
        assert.equal(menu.focused, 'menuitem', width + ': keyboard focus moves into the menu');
        assert.equal(menu.expanded, 'true');
        await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true}))`);
        assert.equal(await evaluate(`!document.querySelector('#tigerest-client-menu') && document.activeElement.id`), 'tigerest-mpv-settings-button', width + ': Escape closes and returns focus');
    }
    // Arrow keys move through items; Enter/click runs the action once.
    await evaluate(`document.querySelector('#tigerest-mpv-settings-button').click()`);
    await evaluate(`for (const key of ['ArrowDown', 'ArrowDown']) document.dispatchEvent(new KeyboardEvent('keydown', {key, bubbles: true}))`);
    assert.equal(await evaluate('document.activeElement.firstChild.textContent'), '客户端设置');
    await evaluate('document.activeElement.click()');
    assert.deepEqual(await evaluate('opened'), ['main']);
    await evaluate(`document.querySelector('#tigerest-mpv-settings-button').click(); document.querySelector('#tigerest-client-menu [role=menuitem]').click()`);
    assert.equal(await evaluate('switches'), 1, 'switch item opens the native chooser once');
    // Outside pointer and Android Back close the menu without acting.
    await evaluate(`document.querySelector('#tigerest-mpv-settings-button').click(); document.body.dispatchEvent(new PointerEvent('pointerdown', {bubbles: true}))`);
    assert.equal(await evaluate(`!!document.querySelector('#tigerest-client-menu')`), false);
    await evaluate(`document.querySelector('#tigerest-mpv-settings-button').click()`);
    assert.equal(await evaluate('window.tigerestClientMenuBack()'), true);
    assert.equal(await evaluate('window.tigerestClientMenuBack()'), false, 'Back continues normally once the menu is closed');
    // A replaced header gets one working entry again.
    await evaluate(`document.querySelector('.headerRight').replaceWith(document.querySelector('.headerRight').cloneNode(true))`);
    await wait(80);
    assert.equal(await evaluate(`document.querySelectorAll('#tigerest-mpv-settings-button').length`), 1);
    await evaluate(`document.querySelector('#tigerest-mpv-settings-button').click()`);
    assert.equal(await evaluate(`!!document.querySelector('#tigerest-client-menu')`), false, 'a cloned button has no handler; remount waits for removal');
    await evaluate(`document.querySelector('#tigerest-mpv-settings-button').remove()`);
    await wait(80);
    await evaluate(`document.querySelector('#tigerest-mpv-settings-button').click()`);
    assert.equal(await evaluate(`!!document.querySelector('#tigerest-client-menu')`), true);
    await evaluate('window.tigerestClientMenuBack()');
    // Jellyfin's Modern app bar (rendered later) takes the entry from the hidden legacy header.
    await evaluate(`document.querySelector('.skinHeader').style.display = 'none';
      document.body.insertAdjacentHTML('beforeend', '<div class="MuiAppBar-root"><div class="MuiBox-root"><button aria-controls="app-user-menu" aria-label="User menu">U</button></div></div>')`);
    await wait(80);
    assert.equal(await evaluate(`document.querySelector('#tigerest-mpv-settings-button').parentElement.classList.contains('tigerest-header-actions')
      && document.querySelector('#tigerest-mpv-settings-button').nextElementSibling.getAttribute('aria-controls')`), 'app-user-menu');
    await evaluate(`document.querySelector('#tigerest-mpv-settings-button').click()`);
    assert.equal(await evaluate(`!!document.querySelector('#tigerest-client-menu') && document.querySelectorAll('#tigerest-mpv-settings-button').length`), 1);
    await evaluate('window.tigerestClientMenuBack()');
    // The home names the connected server and opens the same chooser.
    await evaluate(`document.body.insertAdjacentHTML('beforeend', '<section class="tg-home"><nav><div class="tg-home-nav-heading"><p class="tg-home-eyebrow">我的媒体</p></div></nav></section>')`);
    await wait(80);
    assert.equal(await evaluate(`document.querySelectorAll('.tg-home .tigerest-home-server').length`), 1);
    await evaluate(`finishIdentity({name: 'Living room', serverId: 'abc'})`);
    await wait(30);
    assert.equal(await evaluate(`document.querySelector('.tigerest-home-server').textContent`), 'Living room');
    assert.equal(await evaluate(`document.querySelector('.tigerest-home-server').getAttribute('aria-label')`), '当前服务器：Living room。切换服务器');
    await evaluate(`document.querySelector('.tigerest-home-server').click()`);
    assert.equal(await evaluate('switches'), 2);
    // Media mutations elsewhere do not add entries or rescan the home.
    await evaluate(`for (let i = 0; i < 50; i++) document.body.append(document.createElement('div'))`);
    await wait(80);
    assert.equal(await evaluate(`document.querySelectorAll('.tigerest-home-server,#tigerest-mpv-settings-button').length`), 2);
    // Stock server-list entries open the client chooser; the page does not navigate.
    await evaluate(`document.body.insertAdjacentHTML('beforeend', '<a id="stock" href="#/selectserver">Select server</a><button class="btnSelectServer" id="login-change">Change server</button><button class="btnAddServer" id="add">Add</button><ul class="MuiMenu-list"><li role="menuitem" id="modern"><svg data-testid="StorageIcon"></svg><span>Select server</span></li><li role="menuitem" id="logout"><svg data-testid="LogoutIcon"></svg>Sign out</li></ul>')`);
    await evaluate(`window.signedOut = 0; document.querySelector('#logout').addEventListener('click', () => signedOut++)`);
    await evaluate(`for (const id of ['stock', 'login-change', 'add', 'logout']) document.getElementById(id).click(); document.querySelector('#modern span').click()`);
    assert.equal(await evaluate('switches'), 5, 'select-server links, buttons and the Modern menu item open the client chooser');
    assert.equal(await evaluate('signedOut'), 1, 'sign-out and add-server keep their own behavior');
    assert.equal(await evaluate('location.hash'), '', 'the stock server list is not opened');
    // Logged-out pages keep one in-page entry, also after rebuilding their content.
    await evaluate(`document.body.insertAdjacentHTML('beforeend', '<div class="standalonePage" id="login"><h1>Login</h1></div>')`);
    await wait(80);
    assert.equal(await evaluate(`document.querySelector('#login .tigerest-switch-entry').textContent`), '切换服务器');
    await evaluate(`document.querySelector('#login').innerHTML = '<form><input></form>'`);
    await wait(80);
    assert.equal(await evaluate(`document.querySelectorAll('#login .tigerest-switch-entry').length`), 1);
    // The loaded server page names its remembered record after the load.
    for (let i = 0; i < 60 && !await evaluate(`JSON.parse(jmpInfo.settings.main.knownServers).servers[0].name === 'Living room'`); i++) await wait(50);
    assert.deepEqual(await evaluate(`JSON.parse(jmpInfo.settings.main.knownServers).servers[0]`),
        {mode: 'custom', address: await evaluate('current'), name: 'Living room', kind: 'jellyfin', serverId: 'abc', lastConnectedAt: 1_700_000_000_000});
    // Desktop window controls on Jellyfin Modern: the legacy header stays in the
    // DOM but hidden, and the app bar renders after it.
    await call('Emulation.setDeviceMetricsOverride', {width: 1280, height: 800, deviceScaleFactor: 1, mobile: false});
    await evaluate(`location.href = '/modern/web/index.html'`).catch(() => {});
    for (let i = 0; i < 50 && !await evaluate(`location.pathname === '/modern/web/index.html' && !!window.finishIdentity`).catch(() => false); i++) await wait(50);
    const legacyHeader = '<div class="skinHeader" style="display:none"><div class="headerRight"><button class="headerButton headerUserButton" aria-label="账户">A</button></div></div>';
    const appBar = '<div class="MuiAppBar-root"><div class="MuiBox-root" id="bar"><button id="search">S</button><button aria-controls="app-user-menu" aria-label="User menu">U</button></div></div>';
    await evaluate(`document.body.insertAdjacentHTML('beforeend', ${JSON.stringify(legacyHeader)})`);
    await wait(80);
    await evaluate(`document.body.insertAdjacentHTML('beforeend', ${JSON.stringify(appBar)})`);
    await wait(120);
    const toolbar = () => evaluate(`({errors, ids: [...document.querySelector('[aria-controls="app-user-menu"]').parentElement.children].map(n => n.id || n.getAttribute('aria-controls')),
      legacy: document.querySelectorAll('.skinHeader [id^=tigerest-]').length, windows: document.querySelectorAll('#tigerest-window-mode-button').length,
      visible: ['#tigerest-window-mode-button', '#tigerest-mpv-settings-button'].every(s => document.querySelector(s)?.getBoundingClientRect().width > 0),
      label: document.querySelector('#tigerest-window-mode-button')?.textContent})`);
    const modernIds = ['search', 'tigerest-window-mode-button', 'tigerest-mpv-settings-button', 'app-user-menu'];
    let modern = await toolbar();
    assert.deepEqual(modern, {errors: [], ids: modernIds, legacy: 0, windows: 1, visible: true, label: '全屏'}, 'both controls move to the visible app bar');
    // Window button removed while the client menu already sits in the app bar.
    await evaluate(`document.querySelector('#tigerest-window-mode-button').remove()`);
    await wait(80);
    assert.deepEqual(await toolbar(), modern, 'the window button remounts beside the client menu');
    // The app bar is rebuilt; the hidden legacy header is rebuilt too.
    await evaluate(`document.querySelector('.MuiAppBar-root').remove(); document.body.insertAdjacentHTML('beforeend', ${JSON.stringify(appBar)})`);
    await wait(80);
    await evaluate(`document.querySelector('.skinHeader').remove(); document.body.insertAdjacentHTML('afterbegin', ${JSON.stringify(legacyHeader)})`);
    await wait(80);
    assert.deepEqual(await toolbar(), modern, 'rebuilt headers keep one control each in the app bar');
    // The window button keeps its state and action; the client menu still opens.
    await evaluate(`document.querySelector('#tigerest-window-mode-button').click()`);
    await wait(60);
    assert.deepEqual(await evaluate(`({requests: fullscreenRequests, pressed: document.querySelector('#tigerest-window-mode-button').getAttribute('aria-pressed'),
      label: document.querySelector('#tigerest-window-mode-button').textContent})`), {requests: [true], pressed: 'true', label: '窗口'});
    await evaluate(`document.querySelector('#tigerest-mpv-settings-button').click()`);
    assert.equal(await evaluate(`!!document.querySelector('#tigerest-client-menu') && errors.length`), 0);
    await evaluate('window.tigerestClientMenuBack()');
    console.log(JSON.stringify({passed: true, widths: 5, menu: true, home: true, stock: true, standalone: true, annotate: true, modernWindowControls: true}));
}).catch(error => { console.error(error); process.exitCode = 1; });
