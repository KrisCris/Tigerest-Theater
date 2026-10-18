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
    `;

    // Both Jellyfin layouts keep the home tab in #homeTab and its favorites in
    // the tab with data-index 1. The gallery replaces the home tab's sections
    // while that tab is shown and leaves the favorites tab alone.
    function JellyfinHome({appRouter, connections}) {
        this.appRouter = appRouter;
        this.connections = connections;
        this.tab = null; this.host = null; this.gallery = null; this.shown = false;
        this.sync = () => this.update();
        document.addEventListener('viewshow', this.sync);
        this.timer = setInterval(this.sync, 400);
        this.update();
    }
    JellyfinHome.prototype.visibleTab = function () {
        const tab = document.getElementById('homeTab');
        return tab && tab.getClientRects().length && !tab.closest('.hide') ? tab : null;
    };
    JellyfinHome.prototype.openFavorites = function () {
        // The legacy layout has emby-tabs; the Modern one reads the tab from the address.
        const page = this.tab?.closest('.page') || document;
        const button = page.querySelector?.('.emby-tab-button[data-index="1"]') || document.querySelector('.headerTabs .emby-tab-button[data-index="1"]');
        if (button) { button.click(); return Promise.resolve(); }
        return Promise.resolve(this.appRouter.show('/home?tab=1'));
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
            this.tab = tab;
            this.host = document.createElement('div');
            tab.classList.add('tg-jellyfin-home');
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
        this.tab = this.host = this.gallery = null; this.shown = false;
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
