(function () {
    'use strict';
    let bindings = null, entry = null, libraryContext = null, gallery = null, pressedPoster = null;
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
    function posterNode(id, detail = false) {
        if (!document.querySelectorAll) return null;
        const roots = Array.from(document.querySelectorAll('.mainAnimatedPage,.page'))
            .filter(node => !node.classList.contains('hide') && node.getBoundingClientRect().width > 0);
        const root = roots.at(-1) || document;
        if (detail) return root.querySelector('.detailImageContainer img,.detailImageContainer .primaryImage,.detailImageContainer,.itemDetailImage');
        const card = Array.from(root.querySelectorAll('[data-id],[data-item-id]')).find(node => (node.dataset.id || node.dataset.itemId) === String(id));
        return card?.querySelector('img.cardImage,img,.cardImageContainer') || (card?.matches('.cardImageContainer') ? card : null);
    }
    const motion = {
        get entry() { return entry; },
        get gallery() { return gallery; },
        get busy() { return !!window.TigerestHomeTransitions?.busy; },
        setGallery(value) { gallery = value; },
        reset() { entry = libraryContext = pressedPoster = null; window.TigerestHomeTransitions?.cancel(); },
        attach(options) {
            if (bindings?.router === options.router) return bindings.dispose;
            bindings?.dispose();
            bindings = {...options};
            const router = options.router, originals = {back: router.back, goHome: router.goHome, showItem: router.showItem};
            const back = async function (...args) {
                if (motion.busy) return;
                if (entry && entry.account !== account()) motion.reset();
                if (matchesEntry()) {
                    const returning = entry, fromHome = returning.origin === 'home';
                    const navigate = () => fromHome ? options.pageJs.replace(returning.libraryPath, {}, true) : originals.back.apply(router, args);
                    await effect('poster', {source: posterNode(returning.itemId, true), itemId: returning.itemId,
                        findTarget: () => posterNode(returning.itemId), navigate, direction: 'return'});
                    entry = null;
                    libraryContext = {library: returning.library, path: returning.libraryPath, account: returning.account};
                    return;
                }
                if (matchesLibrary()) {
                    if (libraryContext.library.kind === 'favorites') return home.apply(router, args);
                    const result = await effect('homeReturn', {navigate: () => originals.back.apply(router, args), findGallery: () => gallery});
                    entry = libraryContext = null;
                    return result;
                }
                return originals.back.apply(router, args);
            };
            const home = async function (...args) {
                if (motion.busy) return;
                const result = await effect('homeReturn', {navigate: () => originals.goHome.apply(router, args), findGallery: () => gallery});
                entry = libraryContext = null;
                return result;
            };
            const showItem = function (item, ...args) {
                const pending = pressedPoster;
                if (!motion.busy && item && typeof item === 'object' && ['Movie','Series','Video'].includes(item.Type)
                    && pending?.id === String(item.Id) && Date.now() - pending.at < 2000 && matchesLibrary()) {
                    pressedPoster = null;
                    return motion.openItem({card: {item}, library: libraryContext.library, source: pending.node,
                        origin: 'library', navigate: () => originals.showItem.call(router, item, ...args)});
                }
                return originals.showItem.call(router, item, ...args);
            };
            const capture = event => {
                const node = event.target.closest?.('.cardImageContainer,img.cardImage');
                const card = node?.closest('[data-id]');
                if (card && !motion.busy) pressedPoster = {id: card.dataset.id, node: node.querySelector?.('img') || node, at: Date.now()};
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
            const previous = entry;
            entry = {itemId: card.item.Id, library, account: account(), origin, libraryPath: origin === 'home' ? libraryUrl(library) : path()};
            try {
                return await effect('poster', {source, itemId: card.item.Id, findTarget: () => posterNode(card.item.Id, true), navigate, direction: 'enter'});
            } catch (error) { entry = previous; throw error; }
        },
        async openLibrary({gallery: home, library, navigate}) {
            if (motion.busy) return;
            const result = await effect('library', {gallery: home, navigate});
            if (bindings) { libraryContext = {library, path: path() || libraryUrl(library), account: account()}; entry = null; }
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
