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

    // Both Jellyfin layouts keep the home tab in #homeTab and its favorites in
    // the tab with data-index 1. The gallery replaces the home tab's sections
    // while that tab is shown and leaves the favorites tab alone.
    function JellyfinHome({appRouter, connections}) {
        this.appRouter = appRouter;
        this.connections = connections;
        this.tab = null; this.page = null; this.host = null; this.gallery = null; this.shown = false;
        this.sync = () => this.update();
        document.addEventListener('viewshow', this.sync);
        this.timer = setInterval(this.sync, 400);
        this.update();
    }
    JellyfinHome.prototype.visibleTab = function () {
        // Jellyfin may retain a hidden cached home before the current page.
        // Its duplicate ID must not prevent mounting the visible replacement.
        return Array.from(document.querySelectorAll('[id="homeTab"]'))
            .find(tab => tab.getClientRects().length && !tab.closest('.hide')) || null;
    };
    JellyfinHome.prototype.openFavorites = function () {
        // The legacy layout has emby-tabs; the Modern one reads the tab from the address.
        // Modern keeps hidden Legacy tab buttons too. Clicking those changes the
        // tab without changing the route, so returning to /home cannot restore it.
        if (document.querySelector('#reactRoot .MuiAppBar-positionFixed:not(.skinHeader)')) {
            // React changes the tab without mounting another page or emitting
            // viewshow. appRouter.show waits for that event and would leave all
            // later showItem calls waiting. Follow Modern's own hash links.
            window.location.hash = '#/home?tab=1';
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
            tab.classList.add('tg-jellyfin-home');
            this.page?.classList.add('tg-jellyfin-home-page');
            tab.prepend(this.host);
            this.gallery = new window.TigerestHomeGallery(this.host, {apiProvider: () => this.connections.currentApiClient?.(),
                router: this.appRouter, openFavorites: () => this.openFavorites()});
        }
        if (!this.shown) {
            this.shown = true;
            Promise.resolve(this.gallery.start()).catch(error => console.warn('Tigerest Theater: unable to show the home', error));
        }
    };
    JellyfinHome.prototype.unmount = function () {
        this.gallery?.destroy();
        this.host?.remove();
        this.tab?.classList.remove('tg-jellyfin-home');
        this.page?.classList.remove('tg-jellyfin-home-page');
        this.tab = this.page = this.host = this.gallery = null; this.shown = false;
    };
    JellyfinHome.prototype.destroy = function () {
        clearInterval(this.timer);
        document.removeEventListener('viewshow', this.sync);
        this.unmount();
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
            this.home = new JellyfinHome({appRouter, connections: connectionManager});
            console.info('Tigerest Theater: Jellyfin plugins registered');
        }
    }

    window._tigerestJellyfinPlugin = TigerestJellyfinPlugin;
})();
