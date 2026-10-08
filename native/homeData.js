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
            ParentBackdropImageTags: episode.ParentBackdropImageTags,
            Overview: episode.Overview
        };
    }
    function HomeData(api) { this.api = api; }
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
    HomeData.prototype.load = async function (library, signal) {
        const api = this.api, user = api.getCurrentUserId();
        const favorites = library.kind === 'favorites';
        const types = { music: 'MusicAlbum', books: 'Book,AudioBook', audiobooks: 'MusicAlbum,AudioBook',
            musicvideos: 'MusicVideo', games: 'Game', playlists: 'Playlist', photos: 'Photo,PhotoAlbum' };
        const query = {
            Recursive: true, SortBy: 'DateCreated,SortName', SortOrder: 'Descending', Limit: 100,
            Fields: 'DateCreated,Overview,Genres,PrimaryImageAspectRatio',
            EnableImageTypes: 'Primary,Backdrop,Thumb', ImageTypeLimit: 1,
            IncludeItemTypes: favorites ? 'Series,Movie,Episode,Video,MusicVideo,MusicAlbum,Book,AudioBook,PhotoAlbum,Game' : (types[library.CollectionType] || 'Episode,Movie,Video,MusicVideo,MusicAlbum,Book,AudioBook,PhotoAlbum,Game')
        };
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
            if ((!favorites && cards.size >= 24) || items.length < 100 || (result.TotalRecordCount != null && (page + 1) * 100 >= result.TotalRecordCount)) break;
        }
        const series = Array.from(cards.values()).filter(card => card.latestEpisode);
        if (series.length) {
            try {
                const result = await api.getItems(user, { Ids: series.map(card => card.item.Id).join(','), Fields: query.Fields, EnableImageTypes: query.EnableImageTypes, ImageTypeLimit: 1 }, signal);
                check(signal);
                (result.Items || []).forEach(item => {
                    const card = cards.get(item.Id);
                    if (card) card.item = item;
                });
            } catch (error) { check(signal); /* Keep the series destination if metadata is temporarily unavailable. */ }
        }
        if (favorites) {
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
        return Array.from(cards.values()).sort((a, b) => stamp(b.addedAt) - stamp(a.addedAt)).slice(0, 24);
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
