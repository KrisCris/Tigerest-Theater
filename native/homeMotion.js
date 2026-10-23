(function () {
    'use strict';
    let bindings = null, entry = null, libraryContext = null, gallery = null, pressedPoster = null, revision = 0;
    const account = () => {
        const api = bindings?.manager.currentApiClient?.();
        return api ? [api.serverId(), api.getCurrentUserId()].join('|') : '';
    };
    const current = () => bindings?.viewManager?.currentViewInfo?.() || {};
    const path = () => current().contextPath || current().path || bindings?.router.currentViewPath?.() || '';
    const effect = (kind, options) => window.TigerestHomeTransitions?.[kind]
        ? window.TigerestHomeTransitions[kind](options) : Promise.resolve().then(options.navigate);
    // Emby and Jellyfin item detail pages; only Emby has virtual library lists.
    const isDetail = node => !!(node.matches?.('.view-item-item') || node.matches?.('.itemDetailPage'));
    // A client whose router can leave a navigation promise pending bounds it,
    // so a transition cover never waits on it forever.
    const settle = result => bindings?.settle ? bindings.settle(result) : result;
    const libraryUrl = library => {
        if (bindings.libraryUrl) return bindings.libraryUrl(library);
        if (library.kind === 'favorites') return '/home?tab=favorites';
        const route = bindings.router.getRouteUrl({...library, ServerId: bindings.manager.currentApiClient().serverId()});
        const base = bindings.router.baseUrl?.();
        return base ? route.replace(base, '') : route;
    };
    const matchesEntry = () => entry && entry.account === account() && String(current().params?.id || '') === String(entry.itemId);
    const matchesLibrary = () => libraryContext && libraryContext.account === account() && path() === libraryContext.path;
    function itemFromCard(card) {
        const list = card?.closest('.itemsContainer'), item = list?.getItemFromElement?.(card);
        if (item) return item;
        const id = card?.dataset.id || card?.dataset.itemId;
        if (id) return {Id: id};
        return null;
    }
    function visibleRoot() {
        return Array.from(document.querySelectorAll('.mainAnimatedPage,.page')).filter(node =>
            !node.classList.contains('hide') && node.getBoundingClientRect().width > 0).at(-1) || document;
    }
    function currentLibrary() {
        if (matchesLibrary()) return libraryContext.library;
        const root=visibleRoot(), params=current().params||{};
        if (isDetail(root) || document.body.classList.contains('tg-home-active')) return null;
        if (params.tab==='favorites' || /[?&]tab=favorites(?:&|$)/.test(path())) return {Id:'tigerest-favorites',kind:'favorites'};
        const id=params.topParentId||params.parentId;
        return id ? {Id:id,Type:'CollectionFolder'} : null;
    }
    // A wall that answers a return from a detail page waits on its queries.
    // The first query each wall makes is learned while it loads; a return
    // sends it again as soon as it is pressed, with the rows holding the item
    // when an index read while the home was idle knows its position.
    const WALL_QUERIES = 'tigerest-wall-queries', INDEX_MS = 10 * 60 * 1000, SENT_MS = 4000;
    const walls = {learning: null, index: new Map(), sent: new Map(), timer: 0, reading: null};
    const wallKey = (api, libraryId) => [api.serverId(), api.getCurrentUserId(), libraryId].join('|');
    const queryKey = (user, options) => user + '|' + Object.keys(options).filter(key => options[key] !== undefined).sort()
        .map(key => key + '=' + options[key]).join('&');
    function learnedQueries() { try { return JSON.parse(localStorage.getItem(WALL_QUERIES) || '{}') || {}; } catch { return {}; } }
    function wallApi() {
        const api = bindings?.manager.currentApiClient?.();
        if (!api || typeof api.getItems !== 'function' || !api.getCurrentUserId?.()) return null;
        if (!api.tigerestGetItems) {
            const getItems = api.tigerestGetItems = api.getItems;
            api.getItems = function (user, options, ...rest) {
                if (options && typeof options === 'object') {
                    const learning = walls.learning;
                    if (learning?.api === this && performance.now() < learning.until && String(options.ParentId) === String(learning.libraryId)
                        && !options.Ids && !(options.StartIndex > 0) && options.Limit > 0) {
                        walls.learning = null;
                        const all = learnedQueries(); all[learning.key] = {...options};
                        try { localStorage.setItem(WALL_QUERIES, JSON.stringify(all)); } catch {}
                    }
                    const key = queryKey(user, options), sent = walls.sent.get(key);
                    if (sent) {
                        walls.sent.delete(key);
                        if (performance.now() - sent.at < SENT_MS) return sent.promise.catch(() => getItems.call(this, user, options, ...rest));
                    }
                }
                return getItems.call(this, user, options, ...rest);
            };
        }
        return api;
    }
    function indexPosition(index, id, presentationKey) {
        if (!index || Date.now() - index.at > INDEX_MS) return -1;
        const at = index.ids.indexOf(String(id));
        return at >= 0 || !presentationKey ? at : index.keys.indexOf(presentationKey);
    }
    // Learn the query of the wall that is about to load.
    function learnWall(library) {
        const api = library?.Id && library.kind !== 'favorites' ? wallApi() : null;
        walls.learning = api ? {api, libraryId: library.Id, key: wallKey(api, library.Id), until: performance.now() + 3000} : null;
    }
    // Chunk starts of a virtual wall from item `from` to item `to`. A screen
    // around a work holds its row near the top and about a chunk below it.
    function chunkStarts(from, to, chunk, total) {
        const starts = [];
        for (let start = Math.floor(Math.max(0, from) / chunk) * chunk; start <= to && start < total; start += chunk) starts.push(start);
        return starts;
    }
    function sendWallQueries(library, id, presentationKey) {
        learnWall(library);
        const api = walls.learning?.api, options = api && learnedQueries()[walls.learning.key];
        if (!options) return;
        const user = api.getCurrentUserId(), send = query => {
            const key = queryKey(user, query);
            if (!walls.sent.has(key)) walls.sent.set(key, {at: performance.now(), promise: api.tigerestGetItems.call(api, user, query)});
        };
        send(options);
        // Emby's virtual wall loads rows in chunks of its first query's size;
        // the first query is the first chunk.
        const known = walls.index.get(walls.learning.key), at = indexPosition(known, id, presentationKey), chunk = options.Limit;
        if (at >= 0 && chunk > 0 && window.TigerestServer?.kind === 'emby')
            for (const start of chunkStarts(at - chunk / 2, at + chunk, chunk, known.ids.length)) if (start > 0) send({...options, StartIndex: start, EnableTotalRecordCount: false});
    }
    // Light rows (ID and server key) of a wall in its own order and filters.
    async function readIndex(api, key, options, signal) {
        const result = await api.tigerestGetItems.call(api, api.getCurrentUserId(), {...options, StartIndex: 0, Limit: 2000,
            Fields: 'SortName,PresentationUniqueKey', EnableImages: false, EnableUserData: false, EnableTotalRecordCount: false}, signal);
        const items = result?.Items || result || [];
        if (!signal?.aborted && Array.isArray(items)) walls.index.set(key, {at: Date.now(), ids: items.map(item => String(item.Id)), keys: items.map(item => item.PresentationUniqueKey)});
    }
    // Read the index of every learned wall while the home is idle.
    function readIndexes(delay = 2500) {
        clearTimeout(walls.timer);
        const idle = window.requestIdleCallback ? task => window.requestIdleCallback(task, {timeout: 3000}) : task => setTimeout(task, 0);
        walls.timer = setTimeout(() => idle(async () => {
            const api = wallApi(), libraries = gallery?.libraries || [];
            if (!api || walls.reading || !libraries.length) return;
            const queries = learnedQueries(), abort = walls.reading = new AbortController();
            try {
                for (const library of libraries) {
                    const key = wallKey(api, library.Id), index = walls.index.get(key);
                    if (!queries[key] || (index && Date.now() - index.at < INDEX_MS)) continue;
                    // A transition keeps the network and main thread to itself.
                    while (motion.busy && !abort.signal.aborted) await new Promise(resolve => setTimeout(resolve, 500));
                    if (abort.signal.aborted || api !== bindings?.manager.currentApiClient?.()) break;
                    try { await readIndex(api, key, queries[key], abort.signal); } catch {}
                }
            } finally { if (walls.reading === abort) walls.reading = null; }
        }), delay);
    }
    async function prepareLibraryPoster(id, signal, presentationKey, library) {
        const until = Date.now() + 1600;
        let lists = [];
        while (!signal.aborted && Date.now() < until) {
            lists = Array.from(visibleRoot().querySelectorAll('.virtualItemsContainer')).filter(list => list._itemSource?.length && list.fetchItems);
            if (lists.length) break;
            // Jellyfin renders the loaded page of cards without a virtual list.
            const rendered = posterNode(id)?.getBoundingClientRect();
            if (rendered?.width > 1 && rendered.height > 1) return;
            await new Promise(resolve => setTimeout(resolve, 32));
        }
        if (signal.aborted) return;
        // A card restored where it was left keeps its place, so the poster can
        // fly back to it before the list is consulted.
        const shown = posterNode(id)?.getBoundingClientRect();
        if (shown?.width > 1 && shown.height > 1 && shown.top >= 0 && shown.bottom <= innerHeight) return;
        const api = library?.Id ? wallApi() : null, key = api && wallKey(api, library.Id), known = key && walls.index.get(key);
        for (const list of lists) {
            let targetId = id;
            let index = list.indexOfItemId?.(String(id)) ?? -1;
            // An index of the same length was read in this wall's order.
            if (index < 0 && known?.ids.length === list._itemSource.length) {
                index = indexPosition(known, id, presentationKey);
                if (index >= 0) targetId = known.ids[index];
            }
            if (index < 0) {
                // fetchItems retains this original list's library, filters and ordering.
                // Fetch only lightweight rows; the virtual scroller loads visible artwork itself.
                try {
                    const result = await list.fetchItems({StartIndex: 0, Limit: Math.min(2000,list._itemSource.length),
                        Fields: 'SortName,PresentationUniqueKey', EnableImages: false, EnableUserData: false, EnableTotalRecordCount: false},signal);
                    if (signal.aborted) return;
                    const items = result.Items || result;
                    if (key && items.length === list._itemSource.length) walls.index.set(key, {at: Date.now(), ids: items.map(item => String(item.Id)), keys: items.map(item => item.PresentationUniqueKey)});
                    index = items.findIndex(item => String(item.Id) === String(id));
                    // Emby may merge multiple versions into one library poster whose ID
                    // differs from the recent episode's SeriesId. Match its server key.
                    if (index < 0) {
                        if (!presentationKey) {
                            const api = bindings.manager.currentApiClient();
                            const metadata = await api.getItems(api.getCurrentUserId(), {Ids: String(id),
                                Fields: 'PresentationUniqueKey', EnableImages: false, EnableUserData: false},signal);
                            presentationKey = metadata.Items?.[0]?.PresentationUniqueKey;
                        }
                        if (signal.aborted) return;
                        if (presentationKey) index = items.findIndex(item => item.PresentationUniqueKey === presentationKey);
                    }
                    if (index >= 0) targetId = items[index].Id;
                } catch (error) { if (signal.aborted) return; continue; }
            }
            if (index >= 0) {
                list.scrollToIndex(index,{behavior: 'instant'},false);
                // Load the rows on screen now; the scroller requests them only
                // after its scroll debounce, about 170 ms later. A screen spans
                // more than one chunk; next frame the scroller's range says which.
                const chunk = list.virtualChunkSize, requested = new Set();
                const load = (from, to) => {
                    for (const start of chunkStarts(from, to, chunk, list._itemSource.length))
                        if (!list._itemSource[start] && !requested.has(start)) { requested.add(start); list.loadItems(start, signal); }
                };
                if (chunk > 0 && typeof list.loadItems === 'function') {
                    load(index - chunk / 2, index + chunk);
                    window.requestAnimationFrame?.(() => { const active = !signal.aborted && list.getActiveItems?.(); if (active) load(active.firstIndex, active.lastIndex); });
                }
                return targetId;
            }
        }
    }
    // Where the detail poster is drawn in a desktop-sized window, measured on
    // Emby 4.10 and on Jellyfin 10.11 with jellyfinPlugin.js's layout: a first
    // press flies straight there. A landing remembered from an earlier press
    // is preferred, and a page laid out differently is met by the correction
    // that follows the real poster.
    const PRESET_TYPES = {Movie: 'feature', Series: 'feature', Episode: 'feature', Season: 'folder', BoxSet: 'folder'};
    function posterShape(item) {
        const ratio = Number(item.PrimaryImageAspectRatio);
        if (ratio > 0) return ratio >= 1.3 ? 'thumb' : ratio > .8 ? 'square' : 'portrait';
        return item.Type === 'Episode' ? 'thumb' : 'portrait';
    }
    function detailPreset(item, shape) {
        const w = window.innerWidth, h = window.innerHeight, html = document.documentElement?.classList, group = PRESET_TYPES[item.Type];
        const aspect = {portrait: 1.5, thumb: .5625}[shape];
        if (!group || !aspect || !html || !(w > h)) return null;
        if (window.TigerestServer?.kind === 'jellyfin') {
            // Wider than 62.5em the poster is a quarter of the window, pushed
            // below the header when the window is short.
            if (w <= 1000 || !html.contains('layout-desktop')) return null;
            return {x: .03299 * w - .36, y: Math.max(67.2, .4 * h - 192.8), width: w / 4, height: w / 4 * aspect};
        }
        if (window.TigerestServer?.kind === 'emby') {
            // Beside the docked 238 px drawer; the page gutter widens at 1440 px.
            // Folders draw a narrower poster, and wide images a wider card.
            if (w < 1000 || w >= 3440 || !html.contains('withFullDrawer') || (shape === 'thumb' && group === 'folder')) return null;
            const card = shape === 'thumb' ? Math.min(.28 * w, 714) : group === 'folder' ? Math.min(.14 * w, 338.96) : Math.min(w / 4, .46667 * h, 338.96);
            return {x: w >= 1440 ? 291.94 : 277.5, y: 103.7, width: card - 10.67, height: (card - 10.67) * aspect};
        }
        return null;
    }
    function posterNode(id, detail = false) {
        if (!document.querySelectorAll) return null;
        const roots = Array.from(document.querySelectorAll('.mainAnimatedPage,.page'))
            .filter(node => !node.classList.contains('hide') && node.getBoundingClientRect().width > 0);
        const root = roots.at(-1) || document;
        if (detail) {
            // Emby keeps a hidden side-poster before the visible main poster in DOM order.
            // Jellyfin draws its detail poster as a card background. Below 50em Emby
            // hides an episode's 16:9 image and shows it only as the top backdrop.
            for (const selector of ['.detailImageContainer-main img.cardImage','.detailImageContainer img','.detailImageContainer .primaryImage',
                '.detailImageContainer .cardImageContainer','.detailImageContainer','.itemDetailImage','.itemBackdropContainer > .itemBackdrop']) {
                const visible = Array.from(root.querySelectorAll(selector)).find(node => {
                    const rect = node.getBoundingClientRect();
                    return rect.width > 1 && rect.height > 1 && getComputedStyle(node).visibility !== 'hidden';
                });
                if (visible) return visible;
            }
            return null;
        }
        const cards = Array.from(root.querySelectorAll('.card,[data-id],[data-item-id]')).filter(node => String(itemFromCard(node)?.Id) === String(id));
        // Jellyfin's legacy home keeps the hidden home tab's cards before the active favorites tab.
        const card = cards.find(node => node.getBoundingClientRect?.().width > 1) || cards[0];
        return card?.querySelector('img.cardImage') || card?.querySelector('img') || card?.querySelector('.cardImageContainer') || card?.querySelector('.listItemImage') || (card?.matches('.cardImageContainer') ? card : null);
    }
    const motion = {
        get entry() { return entry; },
        get gallery() { return gallery; },
        get busy() { return !!window.TigerestHomeTransitions?.busy; },
        setGallery(value) { gallery = value; if (value) readIndexes(); },
        reset() {
            ++revision; entry = libraryContext = pressedPoster = null; window.TigerestHomeTransitions?.cancel();
            clearTimeout(walls.timer); walls.reading?.abort(); walls.learning = null; walls.index.clear(); walls.sent.clear();
        },
        attach(options) {
            if (bindings?.router === options.router) return bindings.dispose;
            bindings?.dispose();
            bindings = {...options};
            const router = options.router, originals = {back: router.back, goHome: router.goHome, showItem: router.showItem};
            const back = async function (...args) {
                if (motion.busy) return;
                if (entry && entry.account !== account()) motion.reset();
                if (matchesEntry()) {
                    const ticket = ++revision;
                    const returning = entry, fromHome = returning.origin === 'home', nested = returning.origin === 'detail';
                    const navigate = () => fromHome ? options.pageJs.replace(returning.libraryPath, {}, true) : settle(originals.back.apply(router, args));
                    let targetId = returning.itemId;
                    if (fromHome) sendWallQueries(returning.library, returning.itemId, returning.presentationKey);
                    // A restored detail page keeps the pressed card; another card for the same episode may precede it.
                    const pressed = () => returning.source?.isConnected && visibleRoot().contains(returning.source) ? returning.source : null;
                    // Fly back to where the card was left; a library opened from home
                    // was never shown, so it reuses where this work's card was before.
                    await effect('poster', {source: posterNode(returning.itemId, true), itemId: returning.itemId,
                        findTarget: () => pressed() || posterNode(targetId), prepareTarget: nested ? undefined : async signal => {
                            targetId = await prepareLibraryPoster(returning.itemId,signal,returning.presentationKey,fromHome ? returning.library : null) || targetId;
                        }, navigate, direction: 'return', landingRect: returning.sourceRect, revealCards: !nested,
                        landingKey: fromHome ? ['wall', window.TigerestServer?.kind || '', returning.libraryPath, returning.itemId].join('|') : undefined});
                    if (ticket === revision && returning.account === account()) {
                        entry = returning.parent;
                        if (!nested) libraryContext = returning.homeOwned ? {library: returning.library, path: returning.libraryPath, account: returning.account,
                            favoritesReturn: fromHome ? 'pop' : returning.favoritesReturn} : null;
                    }
                    return;
                }
                if (matchesLibrary()) {
                    if (libraryContext.library.kind === 'favorites') return home.apply(router, args);
                    const ticket = ++revision;
                    const result = await effect('homeReturn', {navigate: () => settle(originals.back.apply(router, args)), findGallery: () => gallery});
                    if (ticket === revision) entry = libraryContext = null;
                    return result;
                }
                return originals.back.apply(router, args);
            };
            const home = async function (...args) {
                if (motion.busy) return;
                const ticket = ++revision, favorites = matchesLibrary() && libraryContext.library.kind === 'favorites';
                const navigate = favorites ? (libraryContext.favoritesReturn === 'pop' ? () => options.pageJs.back() : () => options.pageJs.replace('/home', {}, true))
                    : () => settle(originals.goHome.apply(router, args));
                const result = await effect('homeReturn', {navigate, findGallery: () => gallery});
                if (ticket === revision) entry = libraryContext = null;
                return result;
            };
            const showItem = function (item, ...args) {
                const pending = pressedPoster;
                const resolved = typeof item === 'object' ? item : pending?.item;
                const navigate = () => originals.showItem.call(router, item, ...args);
                const pressed = !motion.busy && resolved && pending?.id === String(resolved.Id)
                    && (typeof item === 'object' || String(item) === pending.id) && Date.now() - pending.at < 2000;
                const library = pressed && ['Movie','Series','Video'].includes(resolved.Type) && currentLibrary();
                if (library) {
                    pressedPoster = null;
                    return motion.openItem({card: {item: resolved}, library, source: pending.node, origin: 'library', navigate});
                }
                // Keep the complete series -> season -> episode parent chain.
                if (!motion.busy && resolved && ['Season', 'Episode'].includes(resolved.Type) && isDetail(visibleRoot())) {
                    pressedPoster = null;
                    return motion.openItem({card: {item: resolved}, library: null, source: pressed ? pending.node : null, origin: 'detail', navigate});
                }
                return navigate();
            };
            const capture = event => {
                const node = event.target.closest?.('.cardImageContainer,.cardOverlayContainer,img.cardImage,.listItemImage,.card .cardScalable > a[href]');
                const card = node?.closest('.card,.listItem,[data-id]'), item = itemFromCard(card);
                if (item && !motion.busy) pressedPoster = {id: String(item.Id), item, node: card.querySelector('img.cardImage') || card.querySelector('img') || card.querySelector('.cardImageContainer') || card.querySelector('.listItemImage') || node, at: Date.now()};
            };
            document.addEventListener('pointerdown', capture, true);
            router.back = back; router.goHome = home; router.showItem = showItem;
            const dispose = () => {
                for (const [name, hook] of Object.entries({back, goHome: home, showItem})) if (router[name] === hook) router[name] = originals[name];
                document.removeEventListener('pointerdown', capture, true);
                if (bindings?.dispose === dispose) { motion.reset(); bindings = null; }
            };
            bindings.dispose = dispose;
            return dispose;
        },
        async openItem({card, library, source, navigate, origin = 'home'}) {
            if (motion.busy) return;
            if (!bindings) return navigate();
            const previous = entry, ticket = ++revision, nested = origin === 'detail';
            // Returning from a nested detail page restores the flight back from the page below it.
            const parent = nested && matchesEntry() ? previous : null;
            entry = {itemId: card.item.Id, presentationKey: card.item.PresentationUniqueKey, library, account: account(), origin,
                homeOwned: !nested && (origin === 'home' || !!matchesLibrary()), favoritesReturn: libraryContext?.favoritesReturn,
                libraryPath: origin === 'home' ? libraryUrl(library) : path(), parent, source: nested ? source : null,
                sourceRect: origin === 'home' || !source?.getBoundingClientRect ? null : (({x, y, width, height}) => ({x, y, width, height}))(source.getBoundingClientRect())};
            const shape = posterShape(card.item);
            try {
                return await effect('poster', {source, itemId: card.item.Id, findTarget: () => posterNode(card.item.Id, true), navigate, direction: 'enter',
                    landingKey: ['detail', window.TigerestServer?.kind || '', card.item.Type || '', shape].join('|'), presetRect: detailPreset(card.item, shape)});
            } catch (error) { if (ticket === revision) entry = previous; throw error; }
        },
        async openLibrary({gallery: home, library, navigate}) {
            if (motion.busy) return;
            // Without attached route services the transition renderer cannot
            // restore the return context; navigate directly.
            if (!bindings) return navigate();
            const ticket = ++revision, session = account();
            learnWall(library);
            const result = await effect('library', {gallery: home, navigate, samePage: library.kind === 'favorites'});
            if (bindings && ticket === revision && session === account()) {
                libraryContext = {library, path: path() || libraryUrl(library), account: session, favoritesReturn: 'replace'}; entry = null;
            }
            return result;
        },
        handleNativeBack() {
            if (motion.busy) return true;
            if (!bindings || (!matchesEntry() && !matchesLibrary())) return false;
            Promise.resolve(bindings.router.back()).catch(error => console.warn('Tigerest Theater: back navigation failed', error));
            return true;
        }
    };
    window.TigerestHomeMotion = motion;
}());
