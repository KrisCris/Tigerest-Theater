(function () {
    'use strict';

    // Emby and Jellyfin each serve their own web client, and these extensions
    // run inside whichever one the user connected to. The public system info
    // identifies the server; the answer is cached per address so a later page
    // load knows it before the web client starts.
    const STORAGE_PREFIX = 'tigerestServerKind:';

    function classify(info) {
        if (!info || typeof info !== 'object') return '';
        if (/jellyfin/i.test(String(info.ProductName || ''))) return 'jellyfin';
        // Jellyfin releases start at 10.x (now 12.x); Emby is still 4.x.
        const major = Number.parseInt(String(info.Version || ''), 10);
        if (Number.isFinite(major) && major >= 10) return 'jellyfin';
        return info.Id || info.Version ? 'emby' : '';
    }

    // The web client lives under /web; a path before it is a reverse-proxy prefix.
    function serverBase(location) {
        if (!location || !/^https?:$/.test(location.protocol)) return '';
        const match = /^(.*?)\/web(?:\/|$)/i.exec(location.pathname || '');
        return match ? location.origin + match[1] : '';
    }

    function readCache(base) {
        try {
            const value = base ? JSON.parse(localStorage.getItem(STORAGE_PREFIX + base) || 'null') : null;
            return value && typeof value === 'object' ? {kind: String(value.kind || ''), version: String(value.version || '')} : {kind: '', version: ''};
        } catch (_) { return {kind: '', version: ''}; }
    }

    function writeCache(base, value) {
        try { if (base && value.kind) localStorage.setItem(STORAGE_PREFIX + base, JSON.stringify(value)); } catch (_) { /* private mode */ }
    }

    const base = serverBase(window.location);
    let {kind, version} = readCache(base);

    // Compares the server version with major.minor; unknown counts as older.
    function atLeast(major, minor = 0) {
        const [a, b] = String(version).split('.').map(part => Number.parseInt(part, 10));
        if (!Number.isFinite(a)) return false;
        return a > major || (a === major && (Number.isFinite(b) ? b : 0) >= minor);
    }

    // The desktop page appearance runs in an isolated script world and reads
    // the answer from the shared DOM.
    function mark() {
        const root = document.documentElement;
        if (!root) return false;
        if (kind) root.setAttribute('data-tigerest-server', kind);
        else root.removeAttribute('data-tigerest-server');
        return true;
    }
    if (!mark()) document.addEventListener('readystatechange', mark, {once: true});

    function remember(info) {
        const detected = classify(info);
        if (!detected) return kind;
        const detectedVersion = String(info.Version || '');
        if (detected !== kind || detectedVersion !== version) {
            const changed = detected !== kind;
            kind = detected;
            version = detectedVersion;
            writeCache(base, {kind, version});
            mark();
            if (changed) window.dispatchEvent(new CustomEvent('tigerest-server-kind', {detail: kind}));
        }
        return kind;
    }

    const ready = !base ? Promise.resolve(kind) : fetch(base + '/System/Info/Public', {credentials: 'omit', cache: 'no-store'})
        .then(response => response.ok ? response.json() : null)
        .then(remember)
        .catch(() => kind);

    // Jellyfin's Fields parameter is an enum of optional data, not the names
    // of response properties. These are Emby request names, or data Jellyfin
    // always returns; 10.11 also dropped PresentationUniqueKey from the enum.
    const EMBY_ONLY_FIELDS = new Set(['userdatalastplayeddate', 'premieredate', 'communityrating', 'productionyear',
        'seriesid', 'seasonid', 'displayorder', 'officialrating', 'criticrating', 'indexnumber', 'parentindexnumber',
        'runtimeticks', 'name', 'type', 'mediatype', 'imagetags']);
    // Item kinds Emby knows and Jellyfin's BaseItemKind does not.
    const EMBY_ONLY_TYPES = new Set(['game', 'gamesystem']);

    function filterList(list, drop) {
        return String(list || '').split(',').map(value => value.trim()).filter(value => value && !drop(value.toLowerCase())).join(',');
    }

    window.TigerestServer = {
        get kind() { return kind; },
        get version() { return version; },
        get base() { return base; },
        isJellyfin() { return kind === 'jellyfin'; },
        isEmby() { return kind === 'emby'; },
        ready,
        classify,
        serverBase,
        remember,
        atLeast,
        // Jellyfin 12 accepts only the ApiKey query parameter; Emby reads api_key.
        tokenParameter() { return kind === 'jellyfin' ? 'ApiKey' : 'api_key'; },
        fields(list) {
            if (kind !== 'jellyfin') return list;
            return filterList(list, value => EMBY_ONLY_FIELDS.has(value) || (value === 'presentationuniquekey' && !(version && !atLeast(10, 11))));
        },
        itemTypes(list) {
            return kind === 'jellyfin' ? filterList(list, value => EMBY_ONLY_TYPES.has(value)) : list;
        },
        // Emby names its item page item.html; Jellyfin calls it details.
        itemRoute(id, serverId) {
            return (kind === 'jellyfin' ? '/details' : '/item') + '?id=' + encodeURIComponent(id) + '&serverId=' + encodeURIComponent(serverId);
        },
        // Emby and Jellyfin's legacy layout keep header actions in .headerRight
        // beside .headerUserButton; Jellyfin's Modern layout puts its user menu
        // in an app bar of its own.
        headerUserButton() {
            const legacy = document.querySelector('.headerUserButton');
            if (legacy?.parentElement) return legacy;
            const modern = document.querySelector('[aria-controls="app-user-menu"]');
            if (!modern?.parentElement) return null;
            modern.parentElement.classList.add('tigerest-header-actions');
            return modern;
        },
        headerActions() {
            return document.querySelector('.skinHeader .headerRight, .headerTop .headerRight, .headerRight')
                || this.headerUserButton()?.parentElement || null;
        }
    };
})();
