(function () {
    'use strict';

    // Jellyfin's web client constructs each plugin NativeShell.getPlugins()
    // names with its own services. Emby registers the same features as AMD
    // modules in embycompat.js and never passes ServerConnections, so the
    // plugin stays inert there.
    const styleId = 'tigerest-jellyfin-home-style';
    const css = `
    #homeTab.tg-jellyfin-home > .sections { display: none !important; }
    #homeTab.tg-jellyfin-home { padding: 0 !important; }
    /* The gallery owns the shown home and pads the safe area itself, but the
       page shell keeps the room of the navigation above it: the Legacy page
       pads below .skinHeader, Modern 10.x pads below its fixed app bar and
       Modern 12.2 puts a spacer under that bar. The homeGallery hides
       .skinHeader; the Modern app bar and its spacer go with it. */
    body.tg-home-active .page.tg-jellyfin-home-page { padding-top: 0 !important; }
    body.tg-home-active #reactRoot .MuiAppBar-positionFixed:not(.skinHeader),
    body.tg-home-active #reactRoot .MuiAppBar-positionFixed:not(.skinHeader) + div[aria-hidden="true"]:not([class]) { display: none !important; }
    `;

    const modernLayout = () => !!document.querySelector('#reactRoot .MuiAppBar-positionFixed:not(.skinHeader)');
    const visiblePage = () => Array.from(document.querySelectorAll('.page'))
        .filter(node => !node.classList.contains('hide') && node.getClientRects().length).at(-1) || null;

    // The shared home motion follows Emby's page.js and view manager. Jellyfin
    // routes through the address instead: the hash is the view state, a
    // page.js replace is a hash replace, and favorites is the home's second
    // tab, named in the address by Modern and a same-page tab in Legacy, where
    // the address stays #/home. It is reported as Emby's favorites address.
    function replaceHash(address) {
        const oldURL = location.href, newURL = oldURL.split('#')[0] + '#' + address;
        if (!window.tigerestIPadApi) { location.replace(newURL); return; }
        // WKWebView can reload the document on absolute location.replace(),
        // discarding the native bridge and the motion return chain. Retain the
        // router's history state, and announce the actual hash replacement.
        history.replaceState(history.state, '', newURL);
        if (oldURL !== newURL) {
            window.dispatchEvent(new PopStateEvent('popstate', {state: history.state}));
            window.dispatchEvent(new HashChangeEvent('hashchange', {oldURL, newURL}));
        }
    }
    const favoritesPath = '/home?tab=favorites';
    function legacyFavorites() {
        return !modernLayout() && !!visiblePage()?.querySelector('#favoritesTab.is-active');
    }
    function jellyfinRoute() {
        const address = location.hash.replace(/^#!?/, '') || '/home';
        const [pathname, search = ''] = address.split('?');
        const params = Object.fromEntries(new URLSearchParams(search));
        if (pathname === '/home' && (params.tab === '1' || legacyFavorites())) return {path: favoritesPath, params: {...params, tab: 'favorites'}};
        return {path: address, params};
    }
    function legacyHomeTab(index) {
        const page = visiblePage();
        if (!page?.querySelector('#homeTab')) return null;
        return page.querySelector(`.emby-tab-button[data-index="${index}"]`) || document.querySelector(`.headerTabs .emby-tab-button[data-index="${index}"]`);
    }
    // A back navigation restores the cached home with its last tab; select the
    // wanted one once that page is shown.
    function selectLegacyTab(index, until = Date.now() + 3000) {
        const button = legacyHomeTab(index);
        if (button) { if (!button.classList.contains('emby-tab-button-active')) button.click(); return; }
        if (Date.now() < until) setTimeout(() => selectLegacyTab(index, until), 50);
    }
    let removeCardNavigation = null;
    function attachMotion({appRouter, connections}) {
        const motion = window.TigerestHomeMotion;
        if (!motion) return null;
        removeCardNavigation?.();
        const go = replaceHash;
        const pageJs = {
            replace(target) {
                const address = String(target).replace(/^#!?/, ''), home = jellyfinRoute().path.startsWith('/home');
                if (modernLayout()) return go(address === favoritesPath ? '/home?tab=1' : address);
                if (address === favoritesPath) {
                    // Only a detail opened from the home returns to its favorites:
                    // leave the detail and show the tab on the restored home.
                    if (home) return legacyHomeTab(1)?.click();
                    history.back(); return selectLegacyTab(1);
                }
                if (address === '/home' && home) return legacyHomeTab(0)?.click();
                return go(address);
            },
            back() {
                if (legacyFavorites()) return legacyHomeTab(0)?.click();
                history.back();
            }
        };
        const libraryUrl = library => {
            if (library.kind === 'favorites') return favoritesPath;
            const route = appRouter.getRouteUrl({...library, ServerId: connections.currentApiClient().serverId()});
            return route.replace(appRouter.baseUrl?.() || '', '').replace(/^#!?/, '');
        };
        // back() and show() wait on any earlier show() that never saw its view.
        const settle = result => Promise.race([result, new Promise(resolve => setTimeout(resolve, 2500))]);
        const dispose = motion.attach({router: appRouter, pageJs, manager: connections, viewManager: {currentViewInfo: jellyfinRoute}, libraryUrl, settle});
        // Modern React cards use a plain overlay link instead of the legacy
        // itemAction handler. Send that link through the same router hook as
        // the gallery so WKWebView retains the document and return context.
        const openCard = event => {
            if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            const anchor = event.target.closest?.('.card .cardScalable > a[href]');
            if (!anchor || anchor.matches('.itemAction,.cardImageContainer') || anchor.hasAttribute('download')
                || (anchor.target && anchor.target !== '_self')
                || event.target.closest('button,input,select,textarea,[data-action]')) return;
            const card = anchor.closest('.card[data-id]'), item = card?.dataset;
            if (!item || !['Movie', 'Series', 'Season', 'Episode', 'Video'].includes(item.type)) return;
            const url = new URL(anchor.href, location.href), current = new URL(location.href);
            const [path, query] = url.hash.replace(/^#!?/, '').split('?'), params = new URLSearchParams(query);
            if (url.origin !== current.origin || url.pathname !== current.pathname || url.search !== current.search
                || path !== '/details' || params.get('id') !== item.id) return;
            const serverId = item.serverid || connections.currentApiClient().serverId();
            if (params.has('serverId') && params.get('serverId') !== serverId) return;
            event.preventDefault(); event.stopPropagation();
            appRouter.showItem({Id: item.id, Type: item.type, ServerId: serverId}, serverId);
        };
        document.addEventListener('click', openCard, true);
        const remove = () => {
            document.removeEventListener('click', openCard, true);
            if (removeCardNavigation === remove) removeCardNavigation = null;
        };
        removeCardNavigation = remove;
        return () => { remove(); dispose?.(); };
    }

    // Jellyfin's desktop detail page floats a 25vw poster over the backdrop and
    // starts the text 32.45vw from the left. Below Jellyfin's own 62.5em
    // breakpoint that leaves a narrow title column, the Android gutter splits
    // the title from the content, and branding themes may pin the poster under
    // a taller header. The compact page follows the Emby compact detail: the
    // poster beside the title, everything else in one column on the gutter.
    // The measured header clearance keeps the poster and standalone pages
    // (server choice, login) below the fixed navigation; the safe area is
    // already part of that header, so it is never added twice.
    const layoutStyleId = 'tigerest-jellyfin-layout-style';
    const layoutCss = `
    /* Branding may give the top row 2em padding and pull the tabs over it
       with a negative margin. Keep two normal rows inside one header; its
       measured height, including the native safe area, clears the library. */
    html.layout-desktop .skinHeader .headerTop { padding-block: 8px !important;
      background: transparent !important; box-shadow: none !important; border-bottom: 0 !important; }
    html.layout-desktop .skinHeader .headerTabs.sectionTabs,
    html.layout-desktop body:has(#indexPage.homePage) .skinHeader .headerTabs.sectionTabs {
      margin-top: 0 !important; padding-top: 0 !important; margin-bottom: 8px !important; }
    html.layout-desktop .libraryPage:not(.itemDetailPage):not(.tg-jellyfin-home-page) {
      padding-top: calc(var(--tg-jf-header-clearance, 0px) + 12px) !important; }
    @media (max-width: 62.5em) {
      html.layout-desktop #itemDetailPage {
        --tg-jf-gutter-start: max(12px, 3.3vw, calc(var(--tgs-safe-start, 0px) + 12px), calc(env(safe-area-inset-left, 0px) + 12px));
        --tg-jf-gutter-end: max(12px, 3.3vw, calc(var(--tgs-safe-end, 0px) + 12px), calc(env(safe-area-inset-right, 0px) + 12px));
        --tg-jf-poster: clamp(140px, 30vw, 240px);
      }
      html.layout-desktop #itemDetailPage:has(.detailImageContainer .portraitCard) { --tg-jf-poster: clamp(90px, 18vw, 130px); }
      html.layout-desktop #itemDetailPage:has(.detailImageContainer .squareCard) { --tg-jf-poster: clamp(110px, 24vw, 170px); }
      html.layout-desktop #itemDetailPage #itemBackdrop { min-height: calc(var(--tg-jf-header-clearance, 0px) + 12px) !important; }
      html.layout-desktop #itemDetailPage .detailLogo { display: none !important; }
      html.layout-desktop #itemDetailPage .detailPagePrimaryContainer { display: grid !important; grid-template-columns: minmax(0, 1fr); gap: 12px 16px; align-items: center;
        padding-block: 12px 0 !important; padding-inline: var(--tg-jf-gutter-start) var(--tg-jf-gutter-end) !important; }
      html.layout-desktop #itemDetailPage .detailPagePrimaryContainer:has(> .detailImageContainer .card) { grid-template-columns: var(--tg-jf-poster) minmax(0, 1fr); }
      html.layout-desktop #itemDetailPage .detailPagePrimaryContainer > .detailImageContainer { grid-column: 1; grid-row: 1; align-self: start; margin: 0 !important; }
      html.layout-desktop #itemDetailPage .detailPagePrimaryContainer > .detailImageContainer .card { position: relative !important; inset: auto !important; float: none !important;
        width: 100% !important; max-width: none !important; max-height: none !important; margin: 0 !important; translate: none !important; }
      html.layout-desktop #itemDetailPage .detailPagePrimaryContainer > .detailRibbon { display: contents !important; }
      html.layout-desktop #itemDetailPage .detailPagePrimaryContainer > .detailRibbon > * { grid-column: 1 / -1; }
      html.layout-desktop #itemDetailPage .detailPagePrimaryContainer > .detailRibbon > .infoWrapper { grid-column: -2; grid-row: 1; }
      /* A wrapping column sizes each title to its full text; wrap the text instead. */
      html.layout-desktop #itemDetailPage .infoWrapper .nameContainer { flex-wrap: nowrap; }
      html.layout-desktop #itemDetailPage .infoWrapper .nameContainer > * { max-width: 100%; white-space: normal; overflow-wrap: anywhere; }
      html.layout-desktop #itemDetailPage .detailPagePrimaryContainer > .detailRibbon > .mainDetailButtons { flex-wrap: wrap; justify-content: flex-start; margin: 0 !important; }
      html.layout-desktop #itemDetailPage .detailPagePrimaryContainer > .detailPagePrimaryContent { grid-column: 1 / -1; min-width: 0; padding: 0 !important; }
      html.layout-desktop #itemDetailPage .detailPageSecondaryContainer { padding-inline: var(--tg-jf-gutter-start) var(--tg-jf-gutter-end) !important; }
      html.layout-desktop #itemDetailPage .detailPageContent { padding-inline: 0 !important; }
    }
    /* Wide pages keep Jellyfin's or the theme's columns. The Android gutter
       would otherwise move only the title, and a pinned poster clears the
       header by the measured amount. */
    @media not all and (max-width: 62.5em) {
      /* Keep the floating artwork out of the adjacent flex ribbon's layout.
         WebKit otherwise adds the float width to the ribbon's own gutter. */
      html.layout-desktop #itemDetailPage .detailPagePrimaryContainer > .detailImageContainer { display: flow-root; height: 0; }
      html.layout-desktop.tg-jf-detail-aligned #itemDetailPage .detailRibbon { padding-inline-start: var(--tg-jf-content-start) !important; }
    }
    html.layout-desktop #itemDetailPage .detailImageContainer .card { translate: 0 var(--tg-jf-card-shift, 0px); }
    html.tg-jf-standalone .standalonePage:not(.hide) { padding-top: max(4.5em, calc(var(--tg-jf-header-clearance, 0px) + 1em),
      calc(var(--tgs-safe-top, 0px) + 1em), calc(env(safe-area-inset-top, 0px) + 1em)) !important; }
    html.tg-jf-empty-header .skinHeader { display: none !important; }
    `;
    const actionable = 'button, a[href], input, select, textarea, [role="button"], [tabindex]:not([tabindex="-1"])';
    // Ignores the hiding this layout applies to the header itself.
    function hasAction(header) {
        return Array.from(header.querySelectorAll(actionable)).some(node => {
            if (node.disabled) return false;
            for (let element = node; element && element !== header; element = element.parentElement) {
                const style = getComputedStyle(element);
                if (style.display === 'none' || style.visibility === 'hidden') return false;
            }
            return true;
        });
    }
    // Offsets ignore scrolling, wherever Jellyfin scrolls the page.
    function documentTop(node) {
        let top = 0;
        for (let element = node; element; element = element.offsetParent) top += element.offsetTop;
        return top;
    }
    // Modern pages emit no viewshow, so a timer follows route and header changes.
    function JellyfinLayout() {
        this.values = {};
        this.sync = () => this.update();
        this.headers = [];
        this.headerResize = window.ResizeObserver ? new ResizeObserver(this.sync) : null;
        document.addEventListener('viewshow', this.sync);
        window.addEventListener?.('hashchange', this.sync);
        window.addEventListener?.('resize', this.sync);
        this.timer = setInterval(this.sync, 400);
        this.update();
    }
    JellyfinLayout.prototype.update = function () {
        const root = document.documentElement;
        if (!root || !document.head || !window.getComputedStyle) return;
        if (!document.getElementById(layoutStyleId)) {
            const style = document.createElement('style'); style.id = layoutStyleId; style.textContent = layoutCss; document.head.append(style);
        }
        const page = visiblePage();
        const standalone = !!page?.classList.contains('standalonePage');
        const skin = document.querySelector('.skinHeader');
        const headers = Array.from(document.querySelectorAll('.skinHeader, #reactRoot .MuiAppBar-positionFixed'));
        if (headers.length !== this.headers.length || headers.some((node, i) => node !== this.headers[i])) {
            this.headerResize?.disconnect();
            this.headers = headers;
            headers.forEach(node => this.headerResize?.observe(node));
        }
        const empty = standalone && !!skin && !hasAction(skin);
        // Show a header that gained an action before measuring it.
        if (root.classList.contains('tg-jf-empty-header') !== empty) root.classList.toggle('tg-jf-empty-header', empty);
        let bottom = 0;
        for (const header of headers) {
            const rect = header.getBoundingClientRect();
            if (rect.height && rect.top <= 1 && getComputedStyle(header).position === 'fixed') bottom = Math.max(bottom, rect.bottom);
        }
        const clearance = page ? Math.max(0, Math.ceil(bottom - documentTop(page))) : 0;
        let shift = 0, contentStart = 0;
        if (page?.id === 'itemDetailPage') {
            const card = page.querySelector('.detailPagePrimaryContainer > .detailImageContainer .card');
            const rect = card?.getBoundingClientRect();
            if (rect?.height) {
                const pinned = getComputedStyle(card).position === 'fixed';
                const applied = parseFloat(this.values['--tg-jf-card-shift']) || 0;
                shift = Math.max(0, Math.ceil(bottom + 8 - (pinned ? rect.top - applied : documentTop(card))));
            }
            const content = page.querySelector('.detailPagePrimaryContent');
            if (content) contentStart = parseFloat(getComputedStyle(content).paddingInlineStart) || 0;
        }
        const set = (name, value) => {
            if (this.values[name] === value) return;
            this.values[name] = value;
            if (value === null) root.style.removeProperty(name); else root.style.setProperty(name, value);
        };
        set('--tg-jf-header-clearance', clearance + 'px');
        set('--tg-jf-card-shift', shift ? shift + 'px' : null);
        set('--tg-jf-content-start', contentStart ? contentStart + 'px' : null);
        root.classList.toggle('tg-jf-detail-aligned', !!contentStart);
        root.classList.toggle('tg-jf-standalone', standalone);
    };
    JellyfinLayout.prototype.destroy = function () {
        clearInterval(this.timer);
        this.headerResize?.disconnect();
        document.removeEventListener('viewshow', this.sync);
        window.removeEventListener?.('hashchange', this.sync);
        window.removeEventListener?.('resize', this.sync);
        const root = document.documentElement;
        for (const name of Object.keys(this.values)) root?.style.removeProperty(name);
        root?.classList.remove('tg-jf-detail-aligned', 'tg-jf-standalone', 'tg-jf-empty-header');
        document.getElementById(layoutStyleId)?.remove();
    };

    // Both Jellyfin layouts keep the home tab in #homeTab and its favorites in
    // the tab with data-index 1. The gallery replaces the home tab's sections
    // while that tab is shown and leaves the favorites tab alone.
    function JellyfinHome({appRouter, connections}) {
        this.appRouter = appRouter;
        this.connections = connections;
        this.tab = null; this.page = null; this.host = null; this.gallery = null; this.shown = false;
        this.sync = () => this.update();
        this.routeSync = () => {
            this.update();
            // React may commit its tab visibility after the hash event.
            if (window.requestAnimationFrame) {
                cancelAnimationFrame(this.routeFrame);
                this.routeFrame = requestAnimationFrame(this.sync);
            }
        };
        document.addEventListener('viewshow', this.sync);
        window.addEventListener?.('hashchange', this.routeSync);
        this.timer = setInterval(this.sync, 400);
        this.update();
    }
    JellyfinHome.prototype.visibleTab = function () {
        const visible = tab => tab && tab.getClientRects().length && !tab.closest('.hide');
        const first = document.getElementById('homeTab');
        if (visible(first)) return first;
        // Legacy keeps a second home page for an address that names a tab.
        return Array.from(document.querySelectorAll?.('#homeTab') || []).find(visible) || null;
    };
    JellyfinHome.prototype.openFavorites = function () {
        // The legacy layout has emby-tabs; the Modern one reads the tab from the address.
        // Modern keeps hidden Legacy tab buttons too. Clicking those changes the
        // tab without changing the route, so returning to /home cannot restore it.
        if (modernLayout()) {
            // React changes the tab without mounting another page or emitting
            // viewshow. appRouter.show waits for that event and would leave all
            // later showItem calls waiting. Follow Modern's own hash links, in
            // place like the Legacy tab: returning home then leaves one entry.
            replaceHash('/home?tab=1');
            return Promise.resolve();
        }
        const page = this.tab?.closest('.page') || document;
        const button = page.querySelector?.('.emby-tab-button[data-index="1"]') || document.querySelector('.headerTabs .emby-tab-button[data-index="1"]');
        if (button) { button.click(); return Promise.resolve(); }
        window.location.hash = '#/home?tab=1';
        return Promise.resolve();
    };
    JellyfinHome.prototype.update = function () {
        if (!window.TigerestHomeGallery || !document.head) return;
        const tab = this.visibleTab();
        if (this.tab && !this.tab.isConnected) this.unmount();
        if (!tab) {
            if (this.shown) { this.shown = false; this.gallery?.stop(); }
            return;
        }
        if (tab !== this.tab) {
            this.unmount();
            if (!document.getElementById(styleId)) {
                const style = document.createElement('style'); style.id = styleId; style.textContent = css; document.head.append(style);
            }
            this.tab = tab; this.page = tab.closest('.page');
            this.host = document.createElement('div');
            // Jellyfin switches home tabs on a horizontal touch swipe unless the
            // swipe starts inside a scroller it marks animatedScrollX. The poster
            // rail and library row scroll sideways, and Emby's home has no swipe
            // tabs, so the whole gallery opts out like Jellyfin's own rows.
            this.host.classList.add('animatedScrollX');
            tab.classList.add('tg-jellyfin-home');
            this.page?.classList.add('tg-jellyfin-home-page');
            tab.prepend(this.host);
            this.gallery = new window.TigerestHomeGallery(this.host, {apiProvider: () => this.connections.currentApiClient?.(),
                router: this.appRouter, openFavorites: () => this.openFavorites()});
            window.TigerestHomeMotion?.setGallery(this.gallery);
        }
        if (!this.shown) {
            this.shown = true;
            Promise.resolve(this.gallery.start()).catch(error => console.warn('Tigerest Theater: unable to show the home', error));
        }
    };
    JellyfinHome.prototype.unmount = function () {
        if (this.gallery && window.TigerestHomeMotion?.gallery === this.gallery) window.TigerestHomeMotion.setGallery(null);
        this.gallery?.destroy();
        this.host?.remove();
        this.tab?.classList.remove('tg-jellyfin-home');
        this.page?.classList.remove('tg-jellyfin-home-page');
        this.tab = this.page = this.host = this.gallery = null; this.shown = false;
    };
    JellyfinHome.prototype.destroy = function () {
        clearInterval(this.timer);
        window.cancelAnimationFrame?.(this.routeFrame);
        window.removeEventListener?.('hashchange', this.routeSync);
        document.removeEventListener('viewshow', this.sync);
        this.unmount();
    };

    // Tigerest Theater styles Jellyfin's own theme, so a server's custom CSS
    // (Dashboard > Branding) starts off for each user as if "Disable server
    // provided custom CSS" were checked in Display settings. Unchecking it
    // there is respected. Jellyfin reads the setting only when a user loads,
    // so the first session also switches off the style it already added.
    function ServerCssDefault(connections, events) {
        this.connections = connections; this.css = null; this.server = undefined;
        this.update = this.update.bind(this);
        if (typeof MutationObserver === 'function') {
            this.observer = new MutationObserver(records => {
                if (records.some(record => record.target.nodeName === 'STYLE' || record.target.parentNode?.nodeName === 'STYLE'
                    || Array.prototype.some.call(record.addedNodes, node => node.nodeName === 'STYLE'))) this.update();
            });
            this.observer.observe(document.documentElement, {childList: true, subtree: true, characterData: true});
        }
        events.on(connections, 'localusersignedin', this.update);
        this.update();
    }
    ServerCssDefault.prototype.disabled = function () {
        const user = this.connections.currentApiClient?.()?.getCurrentUserId?.();
        // Jellyfin's appSettings key; signed-out pages use the unprefixed one.
        const key = user ? user + '-disableCustomCss' : 'disableCustomCss';
        try {
            if (localStorage.getItem(key) === null) localStorage.setItem(key, 'true');
            return localStorage.getItem(key) !== 'false';
        } catch { return true; }
    };
    ServerCssDefault.prototype.update = function () {
        const off = this.disabled(), api = this.connections.currentApiClient?.();
        const server = api?.serverId?.();
        if (api && server !== this.server) {
            this.server = server; this.css = null;
            Promise.resolve(api.getJSON?.(api.getUrl('Branding/Configuration'))).then(config => {
                if (server !== this.server) return;
                this.css = String(config?.CustomCss || '').trim() || null;
                if (this.css) this.update();
            }).catch(() => {});
        }
        if (!this.css) return;
        for (const style of document.querySelectorAll('style')) {
            if (style.textContent.trim() !== this.css) continue;
            if (off) style.media = 'not all';
            else if (style.media === 'not all') style.removeAttribute('media');
        }
    };

    class TigerestJellyfinPlugin {
        constructor({events, appRouter, playbackManager, ServerConnections} = {}) {
            this.name = 'Tigerest Theater';
            this.id = 'tigerestjellyfinplugin';
            this.type = 'tigerest';
            if (!ServerConnections || !events || !appRouter) return;
            const connectionManager = ServerConnections;
            // The settings overlay reads the signed-in account from here.
            window.tigerestSessionConnections = connectionManager;
            if (window._communityPlugin) this.community = new window._communityPlugin({connectionManager, events, appRouter});
            if (window._watchTogetherPlugin) this.watch = new window._watchTogetherPlugin({connectionManager, events, playbackManager, appRouter});
            // Logout starts a network operation: clear community drafts before it finishes.
            this.signedOut = () => { window.TigerestCommunityReset?.(); window.TigerestHomeMotion?.reset(); };
            events.on(connectionManager, 'localusersignedout', this.signedOut);
            this.serverCss = new ServerCssDefault(connectionManager, events);
            this.layout = new JellyfinLayout();
            this.disposeMotion = attachMotion({appRouter, connections: connectionManager});
            this.home = new JellyfinHome({appRouter, connections: connectionManager});
            console.info('Tigerest Theater: Jellyfin plugins registered');
        }
    }

    window._tigerestJellyfinPlugin = TigerestJellyfinPlugin;
})();
