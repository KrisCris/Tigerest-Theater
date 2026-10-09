(function () {
    'use strict';
    const stamp = value => Date.parse(value || '') || 0;
    function check(signal) {
        if (signal && signal.aborted) {
            const error = new Error('Home request cancelled');
            error.name = 'AbortError';
            throw error;
        }
    }
    function seriesFromEpisode(episode) {
        return {
            Id: episode.SeriesId, Type: 'Series', Name: episode.SeriesName || episode.Name,
            ImageTags: episode.SeriesPrimaryImageTag ? { Primary: episode.SeriesPrimaryImageTag } : {},
            ParentBackdropItemId: episode.ParentBackdropItemId,
            ParentBackdropImageTags: episode.ParentBackdropImageTags
        };
    }
    function HomeData(api) { this.api = api; }
    HomeData.orders = Object.freeze({resume: '继续观看', recent: '最近入库', release: '发行时间', rating: '评分'});
    HomeData.normalizeOrder = value => Object.prototype.hasOwnProperty.call(HomeData.orders, value) ? value : 'resume';
    HomeData.prototype.libraries = async function (signal) {
        check(signal);
        const result = await this.api.getUserViews({}, this.api.getCurrentUserId(), signal);
        check(signal);
        const accessible = (result.Items || []).filter(item => item.Id);
        // The built-in server intentionally exposes the four approved home
        // entries. Other servers retain their own complete accessible list.
        const libraries = this.api.serverId() === '62526c3bf747439c99327ddec5fed4a8' ? accessible.slice(0, 3) : accessible;
        return libraries.concat({ Id: 'tigerest-favorites', Name: '收藏', kind: 'favorites' });
    };
    HomeData.prototype.load = async function (library, signal, order = 'resume') {
        order = HomeData.normalizeOrder(order);
        if (order !== 'resume') return this.loadOrdered(library, signal, order);
        const api = this.api, user = api.getCurrentUserId(), cards = new Map(), pages = new Set();
        const favorites = library.kind === 'favorites';
        // A favorite Series need not have favorited Episodes. Filter resume
        // records by their destination work, rather than IsFavorite on each episode.
        const favoriteCards = favorites ? await this.loadOrdered(library, signal, 'recent', Infinity) : null;
        const allowed = favoriteCards && new Set(favoriteCards.map(card => card.item.Id));
        const query = {Recursive: true, SortBy: 'DatePlayed,SortName', SortOrder: 'Descending', Limit: 100,
            Fields: 'DateCreated,Overview,Genres,PrimaryImageAspectRatio,PremiereDate,CommunityRating,PresentationUniqueKey',
            EnableUserData: true, EnableImageTypes: 'Primary,Backdrop,Thumb', ImageTypeLimit: 1};
        if (!favorites) query.ParentId = library.Id;
        const hasResumeEndpoint = typeof api.getResumableItems === 'function';
        try {
            for (let page = 0; cards.size < 24; page++) {
                check(signal);
                const options = {...query, StartIndex: page * 100};
                const result = hasResumeEndpoint ? await api.getResumableItems(user, options, signal)
                    : await api.getItems(user, {...options, Filters: 'IsResumable'}, signal);
                check(signal);
                const items = result.Items || [], key = items.map(item => item.Id).join(',');
                if (pages.has(key)) break;
                pages.add(key);
                for (const item of items) {
                    if (!hasResumeEndpoint && !(item.UserData?.PlaybackPositionTicks > 0 || item.UserData?.PlayedPercentage > 0)) continue;
                    const isEpisode = item.Type === 'Episode' && item.SeriesId, work = isEpisode ? seriesFromEpisode(item) : item;
                    if (!work.Id || (allowed && !allowed.has(work.Id))) continue;
                    const prior = cards.get(work.Id);
                    if (!prior || stamp(item.UserData?.LastPlayedDate) > stamp(prior.resumeItem.UserData?.LastPlayedDate))
                        cards.set(work.Id, {item: work, addedAt: item.DateCreated || '', latestEpisode: isEpisode ? item : null, resumeItem: item});
                }
                if (items.length < 100 || (result.TotalRecordCount != null && (page + 1) * 100 >= result.TotalRecordCount)) break;
            }
        } catch (error) { check(signal); /* An older/offline resume endpoint still permits a recent home. */ }
        const continuing = Array.from(cards.values()).sort((a, b) => stamp(b.resumeItem.UserData?.LastPlayedDate) - stamp(a.resumeItem.UserData?.LastPlayedDate)).slice(0, 24);
        await this.hydrateSeries(continuing, query, signal);
        const filler = continuing.length < 24 ? (favoriteCards || await this.loadOrdered(library, signal, 'recent')) : [];
        check(signal);
        return continuing.concat(filler.filter(card => !cards.has(card.item.Id))).slice(0, 24);
    };
    HomeData.prototype.hydrateSeries = async function (cards, query, signal) {
        const series = cards.filter(card => card.latestEpisode);
        if (!series.length) return;
        try {
            const result = await this.api.getItems(this.api.getCurrentUserId(), {Ids: series.map(card => card.item.Id).join(','),
                Fields: query.Fields, EnableImageTypes: query.EnableImageTypes, ImageTypeLimit: 1}, signal);
            check(signal);
            const byId = new Map(series.map(card => [card.item.Id, card]));
            (result.Items || []).forEach(item => { const card = byId.get(item.Id); if (card) card.item = item; });
        } catch (error) { check(signal); /* Keep the series destination when metadata is unavailable. */ }
    };
    HomeData.prototype.loadOrdered = async function (library, signal, order, limit = 24) {
        const api = this.api, user = api.getCurrentUserId();
        const favorites = library.kind === 'favorites';
        const types = { music: 'MusicAlbum', books: 'Book,AudioBook', audiobooks: 'MusicAlbum,AudioBook',
            musicvideos: 'MusicVideo', games: 'Game', playlists: 'Playlist', photos: 'Photo,PhotoAlbum' };
        const query = {
            Recursive: true, SortBy: (order === 'release' ? 'PremiereDate' : order === 'rating' ? 'CommunityRating' : 'DateCreated') + ',SortName', SortOrder: 'Descending', Limit: 100,
            Fields: 'DateCreated,Overview,Genres,PrimaryImageAspectRatio,PremiereDate,CommunityRating,PresentationUniqueKey',
            EnableImageTypes: 'Primary,Backdrop,Thumb', ImageTypeLimit: 1,
            IncludeItemTypes: favorites ? 'Series,Movie,Episode,Video,MusicVideo,MusicAlbum,Book,AudioBook,PhotoAlbum,Game' : (types[library.CollectionType] || 'Episode,Movie,Video,MusicVideo,MusicAlbum,Book,AudioBook,PhotoAlbum,Game')
        };
        if (order !== 'recent' && !favorites) query.IncludeItemTypes = library.CollectionType === 'tvshows' ? 'Series'
            : types[library.CollectionType] || 'Series,Movie,Video,MusicVideo,MusicAlbum,Book,AudioBook,PhotoAlbum,Game';
        if (favorites) query.IsFavorite = true;
        else query.ParentId = library.Id;
        const cards = new Map();
        const seenPages = new Set();
        for (let page = 0; ; page++) {
            check(signal);
            const result = await api.getItems(user, Object.assign({}, query, { StartIndex: page * 100 }), signal);
            check(signal);
            const items = result.Items || [];
            const pageKey = items.map(item => item.Id).join(',');
            if (seenPages.has(pageKey)) break; // Protect against a server ignoring StartIndex.
            seenPages.add(pageKey);
            items.forEach(item => {
                const episode = item.Type === 'Episode' && item.SeriesId;
                const work = episode ? seriesFromEpisode(item) : item;
                if (!work.Id) return;
                const prior = cards.get(work.Id);
                if (!prior || stamp(item.DateCreated) > stamp(prior.addedAt)) {
                    cards.set(work.Id, { item: work, addedAt: item.DateCreated || '', latestEpisode: episode ? item : null });
                }
            });
            if ((!favorites && cards.size >= limit) || items.length < 100 || (result.TotalRecordCount != null && (page + 1) * 100 >= result.TotalRecordCount)) break;
        }
        await this.hydrateSeries(Array.from(cards.values()), query, signal);
        if (favorites && order === 'recent') {
            const queue = Array.from(cards.values()).filter(card => card.item.Type === 'Series');
            // Bound parallel requests on libraries with many favorite series.
            await Promise.all(Array.from({ length: Math.min(4, queue.length) }, async () => {
                while (queue.length) {
                    const card = queue.shift();
                    check(signal);
                    try {
                        const result = await api.getItems(user, { ParentId: card.item.Id, Recursive: true, IncludeItemTypes: 'Episode', SortBy: 'DateCreated', SortOrder: 'Descending', Limit: 1, Fields: query.Fields }, signal);
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
        return Array.from(cards.values()).sort((a, b) => score(b) - score(a)).slice(0, limit);
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
