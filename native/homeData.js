(function () {
    'use strict';
    const stamp = value => Date.parse(value || '') || 0;
    // Emby 4.8 returns UserData.LastPlayedDate only when it is asked for.
    const fields = 'DateCreated,Overview,Genres,PrimaryImageAspectRatio,PremiereDate,CommunityRating,PresentationUniqueKey,UserDataLastPlayedDate';
    const images = {EnableUserData: true, EnableImageTypes: 'Primary,Backdrop,Thumb', ImageTypeLimit: 1};
    const types = {music: 'MusicAlbum', books: 'Book,AudioBook', audiobooks: 'MusicAlbum,AudioBook',
        musicvideos: 'MusicVideo', games: 'Game', playlists: 'Playlist', photos: 'Photo,PhotoAlbum'};
    const playable = library => types[library.CollectionType] || 'Episode,Movie,Video,MusicVideo,MusicAlbum,Book,AudioBook,PhotoAlbum,Game';
    // Series built from one episode carry only its series name and artwork.
    const stubs = new WeakSet();
    function check(signal) {
        if (signal && signal.aborted) {
            const error = new Error('Home request cancelled');
            error.name = 'AbortError';
            throw error;
        }
    }
    function seriesFromEpisode(episode) {
        const series = {
            Id: episode.SeriesId, Type: 'Series', Name: episode.SeriesName || episode.Name,
            ImageTags: episode.SeriesPrimaryImageTag ? { Primary: episode.SeriesPrimaryImageTag } : {},
            ParentBackdropItemId: episode.ParentBackdropItemId,
            ParentBackdropImageTags: episode.ParentBackdropImageTags
        };
        stubs.add(series);
        return series;
    }
    const isCount = value => Number.isSafeInteger(value) && value >= 0;
    // Different Emby item IDs can be presentations of the same work. Use its
    // server-provided identity only; matching titles must not merge remakes.
    function uniqueWorks(cards) {
        const byWork = new Map();
        for (const card of cards) {
            const key = JSON.stringify([card.item.Type, card.item.PresentationUniqueKey ? 'presentation' : 'id', card.item.PresentationUniqueKey || card.item.Id]);
            const prior = byWork.get(key);
            if (!prior) { byWork.set(key, {...card}); continue; }
            if ((card.lastPlayed || 0) > (prior.lastPlayed || 0)) {
                prior.lastPlayed = card.lastPlayed; prior.resumeItem = card.resumeItem;
            }
            if (stamp(card.addedAt) > stamp(prior.addedAt)) prior.addedAt = card.addedAt;
            if (stamp(card.latestEpisode?.DateCreated) > stamp(prior.latestEpisode?.DateCreated)) prior.latestEpisode = card.latestEpisode;
        }
        const result = Array.from(byWork.values());
        result.forEach(card => {
            if (card.lastPlayed === undefined) return;
            delete card.newEpisode;
            if (card.latestEpisode && card.latestEpisode.UserData?.Played !== true && stamp(card.latestEpisode.DateCreated) > card.lastPlayed)
                card.newEpisode = card.latestEpisode;
        });
        return result;
    }
    function withWatchState(cards) {
        cards.forEach(card => {
            const played = card.item.UserData?.Played;
            card.watchState = {unwatched: typeof played === 'boolean' ? !played : null};
        });
        return cards;
    }
    function HomeData(api) { this.api = api; }
    HomeData.orders = Object.freeze({resume: '继续观看', recent: '最近入库', release: '发行时间', rating: '评分'});
    HomeData.normalizeOrder = value => Object.prototype.hasOwnProperty.call(HomeData.orders, value) ? value : 'resume';
    // Every entry the home may show, in the server's own order.
    HomeData.prototype.candidates = async function (signal) {
        check(signal);
        const result = await this.api.getUserViews({}, this.api.getCurrentUserId(), signal);
        check(signal);
        const accessible = (result.Items || []).filter(item => item.Id);
        // The built-in server intentionally exposes the four approved home
        // entries. Other servers retain their own complete accessible list.
        const libraries = this.api.serverId() === '62526c3bf747439c99327ddec5fed4a8' ? accessible.slice(0, 3) : accessible;
        return libraries.concat({ Id: 'tigerest-favorites', Name: '收藏', kind: 'favorites' });
    };
    // The entries the viewer chose, in their order. With nothing chosen, or
    // nothing left of the choice, the home shows every candidate.
    HomeData.prototype.libraries = async function (signal) {
        const candidates = await this.candidates(signal);
        const shown = HomeData.arrange(candidates, HomeData.readLayout(HomeData.layoutKey(this.api))).filter(row => row.visible);
        return shown.length ? shown.map(row => row.library) : candidates;
    };
    // The home layout is kept per device in the client setting home.libraryLayout:
    // {"<serverId>/<userId>": ["libraryId", "!hiddenLibraryId", ...]}, newest last.
    HomeData.layoutKey = api => api.serverId() + '/' + api.getCurrentUserId();
    const layouts = source => {
        try { const value = JSON.parse(source || '{}'); return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
        catch (error) { return {}; }
    };
    HomeData.readLayout = (key, source = window.jmpInfo?.settings?.home?.libraryLayout) => {
        const entries = layouts(source)[key];
        return Array.isArray(entries) ? entries.filter(entry => typeof entry === 'string' && entry.length > 0) : null;
    };
    // Returns the new setting text. Android keeps text settings under 4096
    // characters, so the servers used longest ago give way first.
    HomeData.writeLayout = (key, rows, source = window.jmpInfo?.settings?.home?.libraryLayout) => {
        const all = layouts(source);
        delete all[key];
        if (rows) all[key] = rows.map(row => (row.visible ? '' : '!') + row.library.Id);
        for (const other of Object.keys(all)) {
            if (JSON.stringify(all).length <= 4000 || other === key) break;
            delete all[other];
        }
        return Object.keys(all).length ? JSON.stringify(all) : '';
    };
    // Saved entries first, in their order; libraries added since follow as shown.
    HomeData.arrange = (candidates, entries) => {
        const byId = new Map(candidates.map(library => [library.Id, library])), rows = [], placed = new Set();
        for (const entry of entries || []) {
            const hidden = entry.startsWith('!'), id = hidden ? entry.slice(1) : entry, library = byId.get(id);
            if (library && !placed.has(id)) { placed.add(id); rows.push({ library, visible: !hidden }); }
        }
        candidates.forEach(library => { if (!placed.has(library.Id)) rows.push({ library, visible: true }); });
        return rows;
    };
    HomeData.prototype.load = async function (library, signal, order = 'resume') {
        order = HomeData.normalizeOrder(order);
        if (order !== 'resume') return withWatchState(await this.loadOrdered(library, signal, order));
        const api = this.api, user = api.getCurrentUserId(), favorites = library.kind === 'favorites';
        // A favorite Series need not have favorited Episodes. Filter playback
        // records by their destination work, rather than IsFavorite on each episode.
        const favoriteScan = favorites ? await this.collect(library, signal, 'recent', Infinity) : null;
        const allowed = favoriteScan && new Set(favoriteScan.cards.map(card => card.item.Id));
        const [resumed, played, recent] = await Promise.all([this.history(library, signal, 'resume', allowed),
            this.history(library, signal, 'played', allowed), favoriteScan || this.collect(library, signal, 'recent', 24)]);
        check(signal);
        // Watched works lead the row: by their last play, or by a newer episode
        // that arrived afterwards and is still unwatched. Works never played follow.
        const cards = new Map(), scanned = new Map(recent.cards.map(card => [card.item.Id, card]));
        const watched = (work, at) => {
            if (!cards.has(work.Id)) {
                const known = scanned.get(work.Id);
                cards.set(work.Id, {item: known ? known.item : work, addedAt: known ? known.addedAt : work.DateCreated || '',
                    latestEpisode: known ? known.latestEpisode : null, lastPlayed: at});
            }
            return cards.get(work.Id);
        };
        resumed.records.forEach(record => { watched(record.work, record.at).resumeItem = record.item; });
        played.records.forEach(record => {
            const card = watched(record.work, record.at);
            // The progress bar describes the most recent play, not an abandoned older episode.
            if (record.at > card.lastPlayed) { card.lastPlayed = record.at; delete card.resumeItem; }
        });
        const arrived = (card, episode) => {
            if (episode && episode.UserData?.Played !== true && stamp(episode.DateCreated) > card.lastPlayed) card.newEpisode = episode;
        };
        cards.forEach(card => arrived(card, card.latestEpisode));
        // Episodes outside the recent window and works older than the loaded
        // history each need one small request. Bound them to what can reach the row.
        const historyCutoff = Math.max(resumed.cutoff, played.cutoff);
        const unknownLatest = recent.complete ? [] : Array.from(cards.values()).filter(card => card.item.Type === 'Series'
            && !card.latestEpisode && card.lastPlayed < recent.oldest).sort((a, b) => b.lastPlayed - a.lastPlayed).slice(0, 8);
        const unknownHistory = historyCutoff ? recent.cards.filter(card => !cards.has(card.item.Id) && card.latestEpisode
            && card.latestEpisode.UserData?.Played !== true && stamp(card.latestEpisode.DateCreated) > historyCutoff).slice(0, 8) : [];
        const episodes = {Recursive: true, IncludeItemTypes: 'Episode', Limit: 1, Fields: 'DateCreated,UserDataLastPlayedDate', EnableUserData: true, EnableImages: false};
        const queue = unknownLatest.map(card => async () => {
            const result = await api.getItems(user, {...episodes, ParentId: card.item.Id, SortBy: 'DateCreated,SortName', SortOrder: 'Descending',
                IsMissing: false, IsVirtualUnaired: false, IsPlaceHolder: false, ExcludeLocationTypes: 'Virtual'}, signal);
            const latest = (result.Items || [])[0];
            if (latest) { card.latestEpisode = latest; card.addedAt = latest.DateCreated || card.addedAt; arrived(card, latest); }
        }).concat(unknownHistory.map(known => async () => {
            const result = await api.getItems(user, {...episodes, ParentId: known.item.Id, IsPlayed: true, SortBy: 'DatePlayed,SortName', SortOrder: 'Descending'}, signal);
            const last = (result.Items || [])[0];
            if (last?.UserData?.Played === true) arrived(watched(known.item, stamp(last.UserData.LastPlayedDate)), known.latestEpisode);
        }));
        await Promise.all(Array.from({length: Math.min(6, queue.length)}, async () => {
            while (queue.length) {
                check(signal);
                try { await queue.shift()(); } catch (error) { check(signal); /* Keep the order known without this work. */ }
            }
        }));
        check(signal);
        const activity = card => Math.max(card.lastPlayed, card.newEpisode ? stamp(card.newEpisode.DateCreated) : 0);
        const continuing = Array.from(cards.values()).sort((a, b) => activity(b) - activity(a));
        continuing.forEach(card => {
            if (card.newEpisode) { card.latestEpisode = card.newEpisode; card.addedAt = card.newEpisode.DateCreated || card.addedAt; }
        });
        await this.hydrateSeries(continuing, signal);
        check(signal);
        const combined = uniqueWorks(continuing.concat(recent.cards.filter(card => !cards.has(card.item.Id))));
        combined.sort((a, b) => Number(b.lastPlayed !== undefined) - Number(a.lastPlayed !== undefined)
            || (a.lastPlayed !== undefined ? activity(b) - activity(a) : stamp(b.addedAt) - stamp(a.addedAt)));
        return withWatchState(combined.slice(0, 24));
    };
    // One record per work from the newest play: 'resume' reads partly played
    // items, 'played' completed ones. A work absent from the records was last
    // played at or before the returned cutoff; 0 means nothing was left unread.
    HomeData.prototype.history = async function (library, signal, kind, allowed) {
        const api = this.api, user = api.getCurrentUserId(), records = new Map(), pages = new Set();
        // Emby 4.8 to 4.10 answer Items/Resume with nothing unless the item types are named.
        const query = {Recursive: true, SortBy: 'DatePlayed,SortName', SortOrder: 'Descending', Limit: 100, Fields: fields, ...images,
            IncludeItemTypes: playable(library)};
        if (library.kind !== 'favorites') query.ParentId = library.Id;
        if (kind === 'played') query.IsPlayed = true;
        const endpoint = kind === 'resume' && typeof api.getResumableItems === 'function';
        let complete = false, oldest = 0;
        try {
            for (let page = 0; page < 10; page++) {
                check(signal);
                const options = {...query, StartIndex: page * 100};
                const result = endpoint ? await api.getResumableItems(user, options, signal)
                    : await api.getItems(user, kind === 'resume' ? {...options, Filters: 'IsResumable'} : options, signal);
                check(signal);
                const items = result.Items || [], key = items.map(item => item.Id).join(',');
                if (pages.has(key)) { complete = true; break; }
                pages.add(key);
                for (const item of items) {
                    const data = item.UserData || {}, at = stamp(data.LastPlayedDate);
                    if (at && (!oldest || at < oldest)) oldest = at;
                    // Recency needs a play date; a played flag alone cannot place a work.
                    if (kind === 'played' ? data.Played !== true || !at
                        : !endpoint && !(data.PlaybackPositionTicks > 0 || data.PlayedPercentage > 0)) continue;
                    const isEpisode = item.Type === 'Episode' && item.SeriesId, work = isEpisode ? seriesFromEpisode(item) : item;
                    if (!work.Id || (allowed && !allowed.has(work.Id))) continue;
                    const prior = records.get(work.Id);
                    if (!prior || at > prior.at) records.set(work.Id, {work, item, at});
                }
                if (items.length < 100 || (result.TotalRecordCount != null && (page + 1) * 100 >= result.TotalRecordCount)) { complete = true; break; }
                if (records.size >= 24) {
                    const current = Array.from(records.values()), works = current.map(record => ({item: record.work}));
                    await this.hydrateSeries(works, signal);
                    works.forEach((card, index) => { current[index].work = card.item; });
                    if (uniqueWorks(works).length >= 24) break;
                }
            }
        } catch (error) { check(signal); complete = true; /* An older/offline endpoint still permits the rest of the home. */ }
        return {records: Array.from(records.values()), cutoff: complete ? 0 : oldest};
    };
    HomeData.prototype.hydrateSeries = async function (cards, signal) {
        const series = cards.filter(card => stubs.has(card.item));
        if (!series.length) return;
        for (let start = 0; start < series.length; start += 100) {
            check(signal);
            const batch = series.slice(start, start + 100);
            try {
                // Otherwise Emby omits all but one ID in each presentation group,
                // leaving the omitted stubs without their shared identity.
                const result = await this.api.getItems(this.api.getCurrentUserId(), {Ids: batch.map(card => card.item.Id).join(','),
                    GroupByPresentationUniqueKey: false, Limit: 100, Fields: fields, ...images}, signal);
                check(signal);
                const byId = new Map(batch.map(card => [card.item.Id, card]));
                (result.Items || []).forEach(item => { const card = byId.get(item.Id); if (card) card.item = item; });
            } catch (error) { check(signal); /* Keep the series destination when metadata is unavailable. */ }
        }
    };
    HomeData.prototype.loadOrdered = async function (library, signal, order, limit = 24) {
        return uniqueWorks((await this.collect(library, signal, order, limit)).cards).slice(0, limit);
    };
    // Every scanned work, sorted. For the recent order, complete means no work
    // was left unread; otherwise no episode after oldest (a timestamp) is missing.
    HomeData.prototype.collect = async function (library, signal, order, limit) {
        const api = this.api, user = api.getCurrentUserId();
        const favorites = library.kind === 'favorites';
        const query = {
            Recursive: true, SortBy: (order === 'release' ? 'PremiereDate' : order === 'rating' ? 'CommunityRating' : 'DateCreated') + ',SortName', SortOrder: 'Descending', Limit: 100,
            Fields: fields, ...images,
            IncludeItemTypes: favorites ? 'Series,Movie,Episode,Video,MusicVideo,MusicAlbum,Book,AudioBook,PhotoAlbum,Game' : playable(library)
        };
        if (order !== 'recent' && !favorites) query.IncludeItemTypes = library.CollectionType === 'tvshows' ? 'Series'
            : types[library.CollectionType] || 'Series,Movie,Video,MusicVideo,MusicAlbum,Book,AudioBook,PhotoAlbum,Game';
        if (favorites) query.IsFavorite = true;
        else query.ParentId = library.Id;
        const cards = new Map();
        const seenPages = new Set();
        let complete = favorites, oldest = 0;
        for (let page = 0; ; page++) {
            check(signal);
            const result = await api.getItems(user, Object.assign({}, query, { StartIndex: page * 100 }), signal);
            check(signal);
            const items = result.Items || [];
            const pageKey = items.map(item => item.Id).join(',');
            if (seenPages.has(pageKey)) { complete = true; break; } // Protect against a server ignoring StartIndex.
            seenPages.add(pageKey);
            items.forEach(item => {
                const episode = item.Type === 'Episode' && item.SeriesId;
                const work = episode ? seriesFromEpisode(item) : item;
                const added = stamp(item.DateCreated);
                if (added && (!oldest || added < oldest)) oldest = added;
                if (!work.Id) return;
                const prior = cards.get(work.Id);
                if (!prior || added > stamp(prior.addedAt)) {
                    cards.set(work.Id, { item: work, addedAt: item.DateCreated || '', latestEpisode: episode ? item : null });
                }
            });
            if (items.length < 100 || (result.TotalRecordCount != null && (page + 1) * 100 >= result.TotalRecordCount)) { complete = true; break; }
            if (!favorites && cards.size >= limit) {
                const current = Array.from(cards.values());
                await this.hydrateSeries(current, signal);
                if (uniqueWorks(current).length >= limit) break;
            }
        }
        await this.hydrateSeries(Array.from(cards.values()), signal);
        if (favorites && order === 'recent') {
            const queue = Array.from(cards.values()).filter(card => card.item.Type === 'Series');
            // Bound parallel requests on libraries with many favorite series.
            await Promise.all(Array.from({ length: Math.min(4, queue.length) }, async () => {
                while (queue.length) {
                    const card = queue.shift();
                    check(signal);
                    try {
                        const result = await api.getItems(user, { ParentId: card.item.Id, Recursive: true, IncludeItemTypes: 'Episode', SortBy: 'DateCreated', SortOrder: 'Descending', Limit: 1, Fields: fields, EnableUserData: true }, signal);
                        check(signal);
                        const latest = (result.Items || [])[0];
                        if (latest) { card.addedAt = latest.DateCreated || card.addedAt; card.latestEpisode = latest; }
                    } catch (error) { check(signal); }
                }
            }));
        }
        check(signal);
        const score = card => order === 'rating' ? Number(card.item.CommunityRating) || 0
            : order === 'release' ? stamp(card.item.PremiereDate || (card.item.ProductionYear ? card.item.ProductionYear + '-01-01' : '')) : stamp(card.addedAt);
        return {cards: Array.from(cards.values()).sort((a, b) => score(b) - score(a)), complete, oldest};
    };
    HomeData.prototype.loadWatchProgress = async function (cards, signal, onProgress) {
        const api = this.api, user = api.getCurrentUserId();
        const queue = cards.filter(card => card.item.Type === 'Series' && !isCount(card.watchState?.total));
        // Enrich after the artwork is visible. Each worker reads just two count
        // responses; never download the episode catalogue or use season counts.
        await Promise.all(Array.from({length: Math.min(4, queue.length)}, async () => {
            while (queue.length) {
                check(signal);
                const card = queue.shift();
                const query = {ParentId: card.item.Id, Recursive: true, IncludeItemTypes: 'Episode',
                    IsMissing: false, IsVirtualUnaired: false, IsPlaceHolder: false, ExcludeLocationTypes: 'Virtual',
                    EnableTotalRecordCount: true, Limit: 0};
                try {
                    const [all, completed] = await Promise.all([
                        api.getItems(user, query, signal), api.getItems(user, {...query, IsPlayed: true}, signal)
                    ]);
                    check(signal);
                    const total = all.TotalRecordCount, played = completed.TotalRecordCount;
                    if (!isCount(total) || !isCount(played) || played > total) continue;
                    card.watchState = {unwatched: total > 0 ? played < total : null, played, total};
                    if (onProgress) onProgress(card);
                } catch (error) { check(signal); /* Unknown counts never become an invented zero. */ }
            }
        }));
        check(signal);
    };
    HomeData.prototype.artwork = function (item, purpose) {
        if (!item) return '';
        const tags = item.ImageTags || {};
        const options = { maxWidth: purpose === 'hero' ? 1920 : purpose === 'poster' ? 960 : 480, quality: 90 };
        let id = item.Id;
        if (purpose === 'poster' && tags.Primary) { options.type = 'Primary'; options.tag = tags.Primary; }
        else if (purpose === 'cover' && tags.Thumb) { options.type = 'Thumb'; options.tag = tags.Thumb; }
        else if (purpose === 'cover' && tags.Primary) { options.type = 'Primary'; options.tag = tags.Primary; }
        else if (item.BackdropImageTags && item.BackdropImageTags.length) { options.type = 'Backdrop'; options.index = 0; options.tag = item.BackdropImageTags[0]; }
        else if (item.ParentBackdropItemId && item.ParentBackdropImageTags && item.ParentBackdropImageTags.length) { id = item.ParentBackdropItemId; options.type = 'Backdrop'; options.index = 0; options.tag = item.ParentBackdropImageTags[0]; }
        else if (tags.Thumb) { options.type = 'Thumb'; options.tag = tags.Thumb; }
        else if (tags.Primary) { options.type = 'Primary'; options.tag = tags.Primary; }
        else return '';
        return this.api.getImageUrl(id, options);
    };
    window.TigerestHomeData = HomeData;
}());
