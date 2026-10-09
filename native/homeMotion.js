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
    const libraryUrl = library => {
        if (library.kind === 'favorites') return '/home?tab=favorites';
        const route = bindings.router.getRouteUrl({...library, ServerId: bindings.manager.currentApiClient().serverId()});
        const base = bindings.router.baseUrl?.();
        return base ? route.replace(base, '') : route;
    };
    const matchesEntry = () => entry && entry.account === account() && String(current().params?.id || '') === String(entry.itemId);
    const matchesLibrary = () => libraryContext && libraryContext.account === account() && path() === libraryContext.path;
    function itemFromCard(card) {
        const id = card?.dataset.id || card?.dataset.itemId;
        if (id) return {Id: id};
        const list = card?.closest('.itemsContainer');
        return list?.getItemFromElement?.(card) || null;
    }
    function visibleRoot() {
        return Array.from(document.querySelectorAll('.mainAnimatedPage,.page')).filter(node =>
            !node.classList.contains('hide') && node.getBoundingClientRect().width > 0).at(-1) || document;
    }
    async function prepareLibraryPoster(id, signal, presentationKey) {
        const until = Date.now() + 1600;
        let lists = [];
        while (!signal.aborted && Date.now() < until) {
            lists = Array.from(visibleRoot().querySelectorAll('.virtualItemsContainer')).filter(list => list._itemSource?.length && list.fetchItems);
            if (lists.length) break;
            await new Promise(resolve => setTimeout(resolve, 32));
        }
        if (signal.aborted) return;
        for (const list of lists) {
            let targetId = id;
            let index = list.indexOfItemId?.(String(id)) ?? -1;
            if (index < 0) {
                // fetchItems retains this original list's library, filters and ordering.
                // Fetch only lightweight rows; the virtual scroller loads visible artwork itself.
                try {
                    const result = await list.fetchItems({StartIndex: 0, Limit: Math.min(2000,list._itemSource.length),
                        Fields: 'SortName,PresentationUniqueKey', EnableImages: false, EnableUserData: false, EnableTotalRecordCount: false},signal);
                    if (signal.aborted) return;
                    const items = result.Items || result;
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
            if (index >= 0) { list.scrollToIndex(index,{behavior: 'instant'},false); return targetId; }
        }
    }
    function posterNode(id, detail = false) {
        if (!document.querySelectorAll) return null;
        const roots = Array.from(document.querySelectorAll('.mainAnimatedPage,.page'))
            .filter(node => !node.classList.contains('hide') && node.getBoundingClientRect().width > 0);
        const root = roots.at(-1) || document;
        if (detail) {
            // Emby keeps a hidden side-poster before the visible main poster in DOM order.
            for (const selector of ['.detailImageContainer-main img.cardImage','.detailImageContainer img','.detailImageContainer .primaryImage','.detailImageContainer','.itemDetailImage']) {
                const visible = Array.from(root.querySelectorAll(selector)).find(node => {
                    const rect = node.getBoundingClientRect();
                    return rect.width > 1 && rect.height > 1 && getComputedStyle(node).visibility !== 'hidden';
                });
                if (visible) return visible;
            }
            return null;
        }
        const card = Array.from(root.querySelectorAll('.card,[data-id],[data-item-id]')).find(node => String(itemFromCard(node)?.Id) === String(id));
        return card?.querySelector('img.cardImage,img,.cardImageContainer') || (card?.matches('.cardImageContainer') ? card : null);
    }
    const motion = {
        get entry() { return entry; },
        get gallery() { return gallery; },
        get busy() { return !!window.TigerestHomeTransitions?.busy; },
        setGallery(value) { gallery = value; },
        reset() { ++revision; entry = libraryContext = pressedPoster = null; window.TigerestHomeTransitions?.cancel(); },
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
                    const returning = entry, fromHome = returning.origin === 'home';
                    const navigate = () => fromHome ? options.pageJs.replace(returning.libraryPath, {}, true) : originals.back.apply(router, args);
                    let targetId = returning.itemId;
                    await effect('poster', {source: posterNode(returning.itemId, true), itemId: returning.itemId,
                        findTarget: () => posterNode(targetId), prepareTarget: async signal => {
                            targetId = await prepareLibraryPoster(returning.itemId,signal,returning.presentationKey) || targetId;
                        }, navigate, direction: 'return'});
                    if (ticket === revision && returning.account === account()) {
                        entry = null;
                        libraryContext = {library: returning.library, path: returning.libraryPath, account: returning.account,
                            favoritesReturn: fromHome ? 'pop' : returning.favoritesReturn};
                    }
                    return;
                }
                if (matchesLibrary()) {
                    if (libraryContext.library.kind === 'favorites') return home.apply(router, args);
                    const ticket = ++revision;
                    const result = await effect('homeReturn', {navigate: () => originals.back.apply(router, args), findGallery: () => gallery});
                    if (ticket === revision) entry = libraryContext = null;
                    return result;
                }
                return originals.back.apply(router, args);
            };
            const home = async function (...args) {
                if (motion.busy) return;
                const ticket = ++revision, favorites = matchesLibrary() && libraryContext.library.kind === 'favorites';
                const navigate = favorites ? (libraryContext.favoritesReturn === 'pop' ? () => options.pageJs.back() : () => options.pageJs.replace('/home', {}, true))
                    : () => originals.goHome.apply(router, args);
                const result = await effect('homeReturn', {navigate, findGallery: () => gallery});
                if (ticket === revision) entry = libraryContext = null;
                return result;
            };
            const showItem = function (item, ...args) {
                const pending = pressedPoster;
                const resolved = typeof item === 'object' ? item : pending?.item;
                if (!motion.busy && resolved && ['Movie','Series','Video'].includes(resolved.Type)
                    && pending?.id === String(resolved.Id) && (typeof item === 'object' || String(item) === pending.id) && Date.now() - pending.at < 2000 && matchesLibrary()) {
                    pressedPoster = null;
                    return motion.openItem({card: {item: resolved}, library: libraryContext.library, source: pending.node,
                        origin: 'library', navigate: () => originals.showItem.call(router, item, ...args)});
                }
                return originals.showItem.call(router, item, ...args);
            };
            const capture = event => {
                const node = event.target.closest?.('.cardImageContainer,.cardOverlayContainer,img.cardImage');
                const card = node?.closest('.card,[data-id]'), item = itemFromCard(card);
                if (item && !motion.busy) pressedPoster = {id: String(item.Id), item, node: card.querySelector('img.cardImage,img,.cardImageContainer') || node, at: Date.now()};
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
            const previous = entry, ticket = ++revision;
            entry = {itemId: card.item.Id, presentationKey: card.item.PresentationUniqueKey, library, account: account(), origin, favoritesReturn: libraryContext?.favoritesReturn,
                libraryPath: origin === 'home' ? libraryUrl(library) : path()};
            try {
                return await effect('poster', {source, itemId: card.item.Id, findTarget: () => posterNode(card.item.Id, true), navigate, direction: 'enter'});
            } catch (error) { if (ticket === revision) entry = previous; throw error; }
        },
        async openLibrary({gallery: home, library, navigate}) {
            if (motion.busy) return;
            const ticket = ++revision, session = account();
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
