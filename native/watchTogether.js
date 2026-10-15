// 一起看: the header entry and room page (create, join, members, choose the
// film, start together), and the link between Emby playback and the sync engine.
(function () {
    'use strict';
    const Client = window.TigerestWatchClient, Connection = window.TigerestWatchConnection, Sync = window.TigerestWatchSync;
    const {message, uuid} = window.TigerestWatchMessages;
    const statusText = {loading: '加载中', buffering: '缓冲中', ready: '已就绪', playing: '播放中', paused: '在房间页',
        away: '未在观看', ended: '已看完', error: '播放出错'};
    const endedText = {replaced: '你已在其他设备进入这个房间，本机已退出同步。', kicked: '你已被房主移出房间。',
        ended: '房间已结束。', room_closed: '房主已解散房间。', room_expired: '房间已到期结束。',
        auth: '登录已失效，请重新登录后再加入。', protocol: '一起看服务已更新，请升级客户端后再加入。'};
    function node(tag, text, className) {
        const element = document.createElement(tag);
        if (text != null) element.textContent = String(text);
        if (className) element.className = className;
        return element;
    }
    function button(text, action, className = 'tw-button') {
        const element = node('button', text, className);
        element.type = 'button';
        element.addEventListener('click', action);
        return element;
    }
    function clock(ms) {
        const total = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
        const h = Math.floor(total / 3600), m = Math.floor(total / 60) % 60, s = total % 60;
        return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s).padStart(2, '0');
    }
    const genericEpisodeName = /^\s*(第\s*\d+\s*[集话話]|episode\s*\d+|ep?\.?\s*\d+)\s*$/i;
    // [main line, detail line] for a room's media.
    function mediaLines(media) {
        if (!media) return ['还没有选择影片', ''];
        if (!media.seriesName) return [media.title || '', ''];
        const index = media.seasonNumber != null && media.episodeNumber != null ? `第${media.seasonNumber}季 第${media.episodeNumber}集` : '';
        const name = media.title && !genericEpisodeName.test(media.title) ? media.title : '';
        return [media.seriesName, [index, name].filter(Boolean).join(' · ')];
    }
    function mediaTitle(media) {
        return mediaLines(media).filter(Boolean).join(' ');
    }
    function itemTitle(item) {
        if (item.Type === 'Episode') {
            const index = item.ParentIndexNumber != null && item.IndexNumber != null ? `第${item.ParentIndexNumber}季 第${item.IndexNumber}集` : '';
            const name = item.Name && !genericEpisodeName.test(item.Name) ? item.Name : '';
            return [item.SeriesName, [index, name].filter(Boolean).join(' · ')].filter(Boolean).join(' ');
        }
        return (item.Name || '') + (item.ProductionYear ? ' (' + item.ProductionYear + ')' : '');
    }
    async function copyText(text, host) {
        try {
            if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return true; }
        } catch (_) { /* Fall back below. */ }
        const field = node('textarea');
        field.value = text;
        field.setAttribute('readonly', '');
        field.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
        (host || document.body).appendChild(field);
        field.select();
        let copied = false;
        try { copied = document.execCommand('copy'); } catch (_) {}
        field.remove();
        return copied;
    }
    function storedClientId() {
        const key = 'tigerestWatchClientId';
        try {
            let id = localStorage.getItem(key);
            if (!/^[0-9a-f-]{36}$/i.test(id || '')) { id = uuid(); localStorage.setItem(key, id); }
            return id;
        } catch (_) { return uuid(); }
    }
    function platform() {
        const system = window.api?.system;
        if (window.tigerestAndroidApi || system?.isAndroid === true) return 'Android';
        if (window.jmpInfo?.platform === 'ipad') return 'iPadOS';
        if (system?.isMacos === true) return 'macOS';
        return 'Windows';
    }
    function installStyle() {
        if (document.getElementById('tigerest-watch-style')) return;
        const style = node('style');
        style.id = 'tigerest-watch-style';
        style.textContent = `
        #tigerest-watch{color:#e9eff8;background:#141d2b;border:1px solid #3a4b62;border-radius:18px;padding:0;width:min(760px,calc(100vw - 32px));max-width:none;box-shadow:0 24px 90px #0008}
        #tigerest-watch::backdrop{background:#0009}
        #tigerest-watch .tw-shell{display:flex;flex-direction:column;max-height:min(820px,calc(100dvh - 48px))}
        #tigerest-watch .tw-head{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:22px 26px 14px;border-bottom:1px solid #334156}
        #tigerest-watch h2{font-size:24px;margin:0}#tigerest-watch h3{font-size:16px;margin:18px 0 10px;color:#c9d6e6}
        #tigerest-watch .tw-content{padding:10px 26px 24px;overflow:auto}
        #tigerest-watch .tw-muted{color:#a9b8cb;font-size:13px;line-height:1.6}
        #tigerest-watch .tw-row{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin:12px 0}
        #tigerest-watch .tw-button{font:inherit;font-size:14px;background:#24344a;color:#e9eff8;border:1px solid #43556e;border-radius:9px;padding:9px 15px;cursor:pointer}
        #tigerest-watch .tw-button:hover{background:#304c6d}#tigerest-watch .tw-button:disabled{opacity:.45;cursor:default}
        #tigerest-watch .tw-primary{background:#b8862f;border-color:#efc36e;color:#1a1408;font-weight:700}
        #tigerest-watch .tw-primary:hover{background:#d39c3b}
        #tigerest-watch .tw-danger{border-color:#8a4a4a;color:#ffb4b4}
        #tigerest-watch .tw-button:focus-visible,#tigerest-watch input:focus-visible{outline:2px solid #79c5ff;outline-offset:3px}
        #tigerest-watch input{box-sizing:border-box;padding:10px 12px;border:1px solid #59697e;border-radius:9px;background:#1d293b;color:inherit;font:inherit;min-width:0}
        #tigerest-watch .tw-code-input{width:9.5em;letter-spacing:.25em;text-transform:uppercase;font-size:18px;font-weight:700}
        #tigerest-watch .tw-search{flex:1 1 220px}
        #tigerest-watch .tw-status{min-height:22px;margin:10px 0;color:#b5c8de;font-size:14px;white-space:pre-wrap}
        #tigerest-watch .tw-card{padding:16px 18px;margin:12px 0;background:#1d293b;border:1px solid #33435a;border-radius:12px}
        #tigerest-watch .tw-code{font-size:34px;font-weight:800;letter-spacing:.18em;color:#f5d493;font-variant-numeric:tabular-nums}
        #tigerest-watch .tw-film{font-size:18px;font-weight:700;line-height:1.4}
        #tigerest-watch .tw-film-detail{font-size:14px;color:#d6e0ec;margin-top:2px}
        #tigerest-watch .tw-film-head{display:flex;gap:16px;align-items:flex-start}
        #tigerest-watch .tw-film-text{flex:1;min-width:0}#tigerest-watch .tw-film-text p{margin:8px 0 0}
        #tigerest-watch .tw-art{width:176px;aspect-ratio:16/9;object-fit:cover;border-radius:8px;background:#0f1622;flex-shrink:0}
        #tigerest-watch .tw-art-poster{width:96px;aspect-ratio:2/3}
        #tigerest-watch .tw-danger-strong{background:#a33a3a;border-color:#d46a6a;color:#fff;font-weight:700}
        #tigerest-watch .tw-danger-strong:hover{background:#bf4848}
        #tigerest-watch .tw-ask{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:16px;background:#0b111bcc;border-radius:18px;z-index:2}
        #tigerest-watch .tw-ask-card{width:min(400px,100%);box-sizing:border-box;padding:20px 22px;background:#1d293b;border:1px solid #43556e;border-radius:14px;box-shadow:0 18px 60px #000a}
        #tigerest-watch .tw-ask-card h3{margin:0 0 8px;font-size:18px;color:#e9eff8}
        #tigerest-watch .tw-ask-text{margin:0;color:#c3d0df;font-size:14px;line-height:1.6}
        #tigerest-watch .tw-ask-actions{justify-content:flex-end;margin:18px 0 0}
        #tigerest-watch .tw-members{list-style:none;margin:0;padding:0;display:grid;gap:8px}
        #tigerest-watch .tw-member{display:flex;align-items:center;gap:12px;padding:8px 10px;border-radius:10px;background:#172334}
        #tigerest-watch .tw-avatar{width:36px;height:36px;border-radius:50%;background:#2c4d72;display:inline-flex;align-items:center;justify-content:center;overflow:hidden;flex-shrink:0;font-weight:700}
        #tigerest-watch .tw-avatar img{width:100%;height:100%;object-fit:cover}
        #tigerest-watch .tw-member-main{flex:1;min-width:0}#tigerest-watch .tw-member-name{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        #tigerest-watch .tw-tag{font-size:12px;padding:2px 7px;border-radius:999px;background:#2b3c53;color:#c9d6e6;margin-left:6px;font-weight:400}
        #tigerest-watch .tw-tag-owner{background:#5a4520;color:#f5d493}#tigerest-watch .tw-offline{opacity:.55}
        #tigerest-watch .tw-list{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px;margin:10px 0}
        #tigerest-watch .tw-pick{display:flex;flex-direction:column;gap:6px;text-align:start;padding:8px;background:#1d293b;border:1px solid #33435a;border-radius:10px;color:inherit;font:inherit;font-size:13px;cursor:pointer}
        #tigerest-watch .tw-pick:hover,#tigerest-watch .tw-pick[aria-pressed=true]{border-color:#efc36e;background:#2a2f3a}
        #tigerest-watch .tw-pick img{width:100%;aspect-ratio:16/9;object-fit:cover;border-radius:6px;background:#0f1622}
        #tigerest-watch .tw-pick.tw-poster img{aspect-ratio:2/3}
        @media(max-width:600px){#tigerest-watch .tw-head{padding:16px}#tigerest-watch .tw-content{padding:8px 14px 18px}#tigerest-watch .tw-code{font-size:28px}
            #tigerest-watch .tw-art{width:112px}#tigerest-watch .tw-art-poster{width:72px}}
        #tigerest-watch-toast{position:fixed;left:50%;bottom:48px;transform:translateX(-50%);z-index:100000;max-width:min(560px,calc(100vw - 32px));padding:12px 18px;border-radius:12px;background:#141d2bee;border:1px solid #3a4b62;color:#e9eff8;font-size:14px;box-shadow:0 12px 40px #0008;pointer-events:none}
        `;
        (document.head || document.documentElement).appendChild(style);
    }

    class WatchPlugin {
        constructor({connectionManager, events, playbackManager, appRouter}) {
            Object.assign(this, {connectionManager, events, playbackManager, appRouter});
            this.client = new Client();
            this.clientId = storedClientId();
            this.connection = null;
            this.available = false;
            this.healthAt = -Infinity;
            this.avatars = new Map();
            this.sync = null;
            this.lastStop = null;
            this.onStart = (event, player) => this.playbackStarted(player);
            this.onStop = () => this.playbackStopped();
            events?.on(playbackManager, 'playbackstart', this.onStart);
            events?.on(playbackManager, 'playbackstop', this.onStop);
            this.onVisibility = () => {
                if (platform() === 'Android') this.sync?.suspend(document.hidden);
                if (!document.hidden) { this.connection?.wake(); this.checkSession(); }
            };
            document.addEventListener('visibilitychange', this.onVisibility);
            window.addEventListener('online', () => this.connection?.wake());
            this.poll = setInterval(() => this.checkSession(), 1000);
            // Position updates stop while paused; deadlines still need a look.
            this.tick = setInterval(() => {
                if (!this.sync?.attached) return;
                this.readPosition();
                this.sync.control();
            }, 500);
            window.TigerestWatch = {open: () => this.open(), debug: () => this.debug(), loadPaused: itemId => this.loadPaused(itemId)};
            this.checkSession();
        }
        apiClient() { return this.connectionManager.currentApiClient?.(); }
        session() { return Client.session(this.apiClient()); }

        // ---- session, availability and the header entry ------------------
        async checkSession() {
            const session = this.session(), key = Client.supported(session) ? JSON.stringify(session) : '';
            if (key !== this.sessionKey) {
                this.sessionKey = key;
                this.reset();
                this.client.setSession(key ? session : null);
                this.available = false;
                this.healthAt = -Infinity;
                this.restored = false;
            }
            if (!key) { this.entry?.remove(); return; }
            if (!this.available && performance.now() - this.healthAt > 300000) {
                this.healthAt = performance.now();
                try {
                    const health = await this.client.health();
                    if (key !== this.sessionKey) return;
                    this.available = health?.enabled === true;
                } catch (_) { this.available = false; }
            }
            if (!this.available) { this.entry?.remove(); return; }
            this.ensureEntry();
            if (!this.restored) { this.restored = true; this.restore(); }
        }
        ensureEntry() {
            const host = document.querySelector('.headerRight');
            if (!host) return;
            if (!this.entry) {
                installStyle();
                this.entry = button('一起看', () => this.open(), '');
                this.entry.id = 'tigerest-watch-entry';
            }
            const messages = host.querySelector('#tigerest-message-entry');
            if (messages ? this.entry.nextElementSibling !== messages : this.entry.parentElement !== host) {
                if (messages) host.insertBefore(this.entry, messages); else host.prepend(this.entry);
            }
            const room = this.connection?.room;
            const label = room ? '一起看 · ' + (room.members?.length || 1) + '人' : '一起看';
            if (this.entry.textContent !== label) this.entry.textContent = label;
            this.entry.setAttribute('aria-label', room ? '一起看房间 ' + room.code : '一起看');
        }
        // After a restart the server may still hold our seat: reconnect, but
        // never start playback on our own.
        async restore() {
            try {
                const me = await this.client.me();
                this.me = me;
                if (!me?.activeRoom || this.connection) return;
                const ticket = await this.client.ticket(me.activeRoom.roomId, this.clientId);
                const room = (await this.client.room(me.activeRoom.roomId))?.room;
                if (room && !this.connection) this.connect(room, ticket.ticket);
            } catch (_) { /* The room page shows errors when opened. */ }
        }
        reset() {
            this.connection?.dispose();
            this.connection = null;
            this.sync?.clearRoom();
            this.close();
        }

        // ---- room connection ---------------------------------------------
        connect(room, ticket) {
            this.connection?.dispose();
            const connection = new Connection({client: this.client, clientId: this.clientId, platform: platform(),
                appVersion: String(window.jmpInfo?.version || '0').slice(0, 32),
                onEvent: (type, data) => { if (this.connection === connection) this.roomEvent(type, data); },
                log: text => console.info('[Watch] ' + text)});
            this.connection = connection;
            this.ensureSync();
            connection.start(room, ticket);
            this.previousRoom = null;
            this.render();
        }
        ensureSync() {
            if (this.sync) return this.sync;
            const player = window.api?.player;
            if (!player) return null;
            const plugin = this;
            this.sync = new Sync({
                player: {pause: () => player.pause(), play: () => player.play(),
                    seek: ms => player.seekTo(Math.round(ms)), setRate: rate => player.setPlaybackRate(rate)},
                // The clock lives on whichever connection is current.
                clock: {get ready() { return Boolean(plugin.connection?.clock.ready); },
                    get rttMs() { return plugin.connection?.clock.rttMs || 0; },
                    toServer: value => plugin.connectionClock().toServer(value),
                    toLocal: value => plugin.connectionClock().toLocal(value)},
                command: (type, fields) => this.connection ? this.connection.command(type, fields) : Promise.reject(new Error(message('DISCONNECTED'))),
                report: report => this.report(report),
                log: text => console.info('[Watch] ' + text)});
            this.sync.onCommandError = (type, error) => this.notify(message(error.code));
            const sync = this.sync;
            player.playing?.connect(() => sync.onPlaying());
            player.paused?.connect(() => sync.onPaused());
            player.positionUpdate?.connect(ms => sync.onPosition(Number(ms)));
            player.finished?.connect(() => sync.onEnded());
            player.canceled?.connect(() => { this.canceledAt = performance.now(); });
            player.playbackRateChanged?.connect(rate => this.rateChanged(Number(rate)));
            player.backgrounded?.connect(() => sync.suspend(true));
            return sync;
        }
        connectionClock() { return this.connection?.clock || {toServer: v => v, toLocal: v => v}; }
        rateChanged(rate) {
            const sync = this.sync;
            if (!sync?.attached || !this.connection || !Number.isFinite(rate)) return;
            if (Math.abs(rate * 1000 - (sync.rate || 1000)) < 1) return;
            // Speed belongs to the whole room; keep everyone at 1x.
            sync.rate = null;
            sync.setRate(1000);
            this.notify('一起看时播放速度固定为 1 倍。');
        }
        report(report) {
            if (!this.connection) return;
            let state = report.state;
            if (state === 'away' && !this.sync?.suspended) state = this.idleStatus();
            this.connection.status({...report, state});
        }
        // Not in the player: members on the room page take part in a start;
        // everyone else is away.
        // Reporting away removes a member from a waiting start, so a member on
        // the page stays "loading" while that start opens the player.
        idleStatus() {
            const playback = this.connection?.room?.playback;
            if (this.launching && performance.now() - this.launching.at < 30000) return 'loading';
            if (this.panel && playback?.state === 'paused') return 'paused';
            if (this.panel && playback?.state === 'waiting') return 'loading';
            return 'away';
        }
        publish() {
            if (this.sync?.attached) this.sync.publish();
            else this.report({state: 'away', positionMs: this.connection?.room?.playback?.positionMs || 0, sampledAtLocal: performance.now()});
        }
        roomEvent(type, data) {
            const room = this.connection?.room;
            if (type === 'ended') {
                const text = endedText[data.reason];
                this.connection = null;
                this.sync?.clearRoom();
                this.launching = null;
                if (text) this.notify(text);
                this.ensureEntry();
                this.render();
                return;
            }
            if (type === 'welcome' || type === 'state') {
                this.announce(room);
                this.sync?.setRoom(room);
                this.reconcile();
            }
            if (type === 'members') this.announceMembers(room);
            if (type === 'itemChange') this.announceChange(data.change);
            if (type === 'welcome' || type === 'clock') this.publish();
            this.previousRoom = room;
            this.ensureEntry();
            this.render();
        }
        memberName(id) {
            if (id && id === this.connection?.memberId) return '你';
            return this.connection?.room?.members?.find(m => m.memberId === id)?.name || '成员';
        }
        announce(room) {
            const before = this.previousRoom?.playback, after = room?.playback;
            if (!before || !after || after.revision <= before.revision) return;
            const action = after.lastAction, mine = action?.memberId && action.memberId === this.connection.memberId;
            if (!action || mine) return;
            const name = this.memberName(action.memberId);
            const text = {pause: `${name} 暂停了`, play: `${name} 开始播放`, seek: `${name} 跳转到 ${clock(after.positionMs)}`,
                changeItem: room.media?.itemId === this.previousRoom.media?.itemId ? `${name} 开始放映` : `${name} 换成了 ${mediaTitle(room.media)}`,
                buffer: `等待 ${name} 缓冲…`,
                timeout: '有成员没跟上，已先开始播放'}[action.type];
            if (text) this.notify(text);
        }
        announceMembers(room) {
            const before = this.previousRoom?.members || [], after = room?.members || [];
            const known = new Set(before.map(m => m.memberId)), now = new Set(after.map(m => m.memberId));
            for (const member of after) if (!known.has(member.memberId) && member.memberId !== this.connection.memberId) this.notify(member.name + ' 加入了房间');
            for (const member of before) if (!now.has(member.memberId)) this.notify(member.name + ' 离开了房间');
            if (this.previousRoom && room.ownerMemberId && room.ownerMemberId !== this.previousRoom.ownerMemberId)
                this.notify(room.ownerMemberId === this.connection.memberId ? '你现在是房主' : this.memberName(room.ownerMemberId) + ' 现在是房主');
        }
        announceChange(change) {
            if (change.memberId === this.connection.memberId) return;
            if (change.phase === 'pending') this.notify(this.memberName(change.memberId) + ' 正在切换影片…');
            if (change.phase === 'cancelled') this.notify('切换影片已取消');
        }

        // ---- Emby playback ------------------------------------------------
        currentPlayer() { return this.playbackManager?.getCurrentPlayer?.() || this.playbackManager?._currentPlayer; }
        currentItemId() {
            const player = this.currentPlayer();
            if (!player || !this.playbackManager?.isPlaying?.(player)) return null;
            return this.playbackManager.currentItem?.(player)?.Id || null;
        }
        playbackStarted(player) {
            const room = this.connection?.room, item = this.playbackManager.currentItem?.(player);
            if (!room || !item) return;
            this.ensureSync();
            if (item.Id === room.media?.itemId) {
                this.attach(item.Id);
                return;
            }
            // Next episode, autoplay or a playlist pick straight after room
            // playback moves the whole room. Other playback is private.
            const stop = this.lastStop, now = performance.now();
            if (stop && stop.room === room.roomId && now - stop.at < 8000 && !(this.canceledAt > stop.at - 1000) &&
                ['Movie', 'Episode'].includes(item.Type)) {
                const source = this.playbackManager.currentMediaSource?.(player);
                this.lastStop = null;
                this.launching = {itemId: item.Id, at: now};
                this.connection.command('changeItem', {itemId: item.Id, mediaSourceId: String(source?.Id || item.Id), positionMs: 0})
                    .catch(error => { if (error.code !== 'CHANGE_IN_PROGRESS' && error.code !== 'STALE_REVISION') this.notify(message(error.code)); });
            }
        }
        attach(itemId) {
            const sync = this.ensureSync();
            if (!sync) return;
            this.launching = null;
            // Any speed other than 1x bypasses RIFE frame interpolation for the
            // whole item, so with RIFE on, offsets are fixed by held seeks only.
            sync.rateCorrection = !(window.jmpInfo?.settings?.video?.aiRife === true && ['Windows', 'macOS'].includes(platform()));
            sync.attach(itemId);
            this.readPosition();
        }
        // A player loaded stopped at the start of the file reports no
        // position change, so ask for it; until then the member is loading.
        readPosition() {
            const sync = this.sync, player = window.api?.player;
            if (!sync?.attached || sync.local.pos !== null || this.readingPosition || typeof player?.getPosition !== 'function') return;
            this.readingPosition = true;
            Promise.resolve().then(() => player.getPosition()).then(ms => {
                const value = Number(ms);
                if (sync.attached && sync.local.pos === null && Number.isFinite(value) && value >= 0) sync.onPosition(value);
            }).catch(() => {}).finally(() => { this.readingPosition = false; });
        }
        playbackStopped() {
            const sync = this.sync, room = this.connection?.room;
            const wasRoom = Boolean(sync?.attached);
            sync?.detach();
            this.lastStop = wasRoom && room ? {room: room.roomId, at: performance.now()} : null;
            this.publish();
            // Leaving the player while in a room returns to the room page.
            if (wasRoom) setTimeout(() => { if (this.connection && !this.currentItemId() && !this.launching) this.open(); }, 1500);
        }
        // Follow the room's film: load it when the room switched films while we
        // were watching, or when a start was called while we were on the page.
        reconcile() {
            const room = this.connection?.room, media = room?.media;
            if (!media) return;
            const current = this.currentItemId();
            if (current === media.itemId) {
                if (!this.sync?.attached) this.attach(current);
                return;
            }
            const starting = room.playback.state === 'waiting' && room.playback.lastAction?.type === 'changeItem';
            if (starting && (this.sync?.attached || this.panel || current)) this.launch();
        }
        launch() {
            const room = this.connection?.room, media = room?.media, api = this.apiClient();
            if (!media || !api) return;
            if (this.launching?.itemId === media.itemId && performance.now() - this.launching.at < 15000) return;
            const playback = room.playback;
            const position = playback.state === 'playing' && this.connection.clock.ready
                ? playback.positionMs + Math.max(0, this.connection.clock.toServer(performance.now()) - playback.serverTime) + 3000
                : playback.positionMs;
            this.launching = {itemId: media.itemId, at: performance.now()};
            this.close();
            this.publish();
            Promise.resolve(this.playbackManager.play({ids: [media.itemId], serverId: api.serverId(), mediaSourceId: media.mediaSourceId,
                startPositionTicks: Math.round(position * 10000), fullscreen: true})).catch(() => {
                this.launching = null;
                this.notify('无法开始播放，请稍后在一起看页面重试。');
            });
        }

        // The player asks this while loading. Items started for the room load
        // stopped: the room decides when they start, and a player stopped
        // after it began playing jumps ahead on resume.
        loadPaused(itemId) {
            const launching = this.launching, media = this.connection?.room?.media;
            return Boolean(launching && media && String(itemId) === String(media.itemId) && String(launching.itemId) === String(media.itemId) &&
                performance.now() - launching.at < 30000);
        }

        // ---- messages -------------------------------------------------------
        notify(text) {
            if (!text) return;
            if (this.panel) { this.setStatus(text); return; }
            const player = window.api?.player;
            if (this.sync?.attached && typeof player?.userCommand === 'function') {
                const quoted = '"' + String(text).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, ' ') + '"';
                player.userCommand('show-text ' + quoted + ' 3000');
                return;
            }
            if (this.sync?.attached && typeof player?.showMessage === 'function') { player.showMessage(String(text)); return; }
            installStyle();
            let toast = document.getElementById('tigerest-watch-toast');
            if (!toast) { toast = node('div'); toast.id = 'tigerest-watch-toast'; toast.setAttribute('role', 'status'); document.body.appendChild(toast); }
            toast.textContent = text;
            clearTimeout(this.toastTimer);
            this.toastTimer = setTimeout(() => toast.remove(), 3500);
        }
        setStatus(text) { if (this.panel?.status) this.panel.status.textContent = text || ''; }
        // A confirmation sheet inside the room page. Resolves true or false;
        // Esc and the backdrop cancel.
        ask({title, text, confirmText, danger = false}) {
            const panel = this.panel;
            if (!panel) return Promise.resolve(window.confirm(text));
            panel.ask?.resolve(false);
            return new Promise(resolve => {
                const sheet = node('div', null, 'tw-ask'), card = node('div', null, 'tw-ask-card');
                card.setAttribute('role', 'alertdialog');
                card.setAttribute('aria-modal', 'true');
                const heading = node('h3', title), body = node('p', text, 'tw-ask-text');
                heading.id = 'tw-ask-title';
                card.setAttribute('aria-labelledby', heading.id);
                const finish = value => {
                    if (panel.ask?.sheet !== sheet) return;
                    panel.ask = null;
                    sheet.remove();
                    resolve(value);
                };
                const cancel = button('取消', () => finish(false));
                const accept = button(confirmText, () => finish(true), 'tw-button ' + (danger ? 'tw-danger-strong' : 'tw-primary'));
                const row = node('div', null, 'tw-row tw-ask-actions');
                row.append(cancel, accept);
                card.append(heading, body, row);
                sheet.appendChild(card);
                sheet.addEventListener('click', event => { if (event.target === sheet) finish(false); });
                panel.ask = {sheet, resolve: finish};
                panel.dialog.appendChild(sheet);
                (danger ? cancel : accept).focus();
            });
        }

        // ---- room page ------------------------------------------------------
        open() {
            this.checkSession();
            if (!this.available) return;
            installStyle();
            if (this.panel) { this.panel.dialog.focus(); this.render(); return; }
            const dialog = node('dialog');
            dialog.id = 'tigerest-watch';
            dialog.setAttribute('aria-labelledby', 'tw-heading');
            const shell = node('div', null, 'tw-shell'), head = node('div', null, 'tw-head');
            const heading = node('h2', '一起看');
            heading.id = 'tw-heading';
            head.append(heading, button('关闭', () => this.close()));
            const content = node('div', null, 'tw-content');
            shell.append(head, content);
            dialog.appendChild(shell);
            dialog.addEventListener('cancel', event => {
                event.preventDefault();
                if (this.panel?.ask) this.panel.ask.resolve(false); else this.close();
            });
            this.panel = {dialog, content, view: 'room', status: null};
            document.body.appendChild(dialog);
            dialog.showModal();
            this.render();
            this.publish();
            if (this.connection && !this.connection.connected) this.connection.wake();
        }
        close() {
            const panel = this.panel;
            if (!panel) return;
            this.panel = null;
            panel.ask?.resolve(false);
            panel.abort?.abort();
            try { panel.dialog.close(); } catch (_) {}
            panel.dialog.remove();
            this.publish();
        }
        render() {
            const panel = this.panel;
            if (!panel || panel.view !== 'room') return;
            const status = panel.status?.textContent || '';
            panel.content.replaceChildren();
            panel.status = node('p', status, 'tw-status');
            panel.status.setAttribute('role', 'status');
            panel.status.setAttribute('aria-live', 'polite');
            if (this.connection) this.renderRoom(panel); else this.renderLobby(panel);
        }
        renderLobby(panel) {
            const content = panel.content;
            content.append(node('p', '和大河服务器上的朋友同时观看同一部影片。房间里每个人都可以播放、暂停和拖动进度。', 'tw-muted'));
            const create = node('div', null, 'tw-card');
            create.append(node('h3', '创建房间'), node('p', '先选好影片，再把房间码发给朋友。', 'tw-muted'));
            const row = node('div', null, 'tw-row');
            row.append(button('选择影片并创建', () => this.openPicker('create'), 'tw-button tw-primary'));
            create.appendChild(row);
            const join = node('div', null, 'tw-card');
            join.append(node('h3', '加入房间'));
            const form = node('form', null, 'tw-row');
            const input = node('input', null, 'tw-code-input');
            Object.assign(input, {maxLength: 6, placeholder: '房间码', autocomplete: 'off', spellcheck: false});
            input.setAttribute('aria-label', '房间码');
            input.addEventListener('input', () => { input.value = input.value.toUpperCase().replace(/[^0-9A-Z]/g, ''); });
            const submit = node('button', '加入', 'tw-button tw-primary');
            submit.type = 'submit';
            form.append(input, submit);
            form.addEventListener('submit', event => { event.preventDefault(); this.join(input.value, submit); });
            join.appendChild(form);
            if (this.me?.capacity) join.appendChild(node('p', '你创建的房间最多 ' + this.me.capacity + ' 人。', 'tw-muted'));
            content.append(create, join, panel.status);
        }
        renderRoom(panel) {
            const connection = this.connection, room = connection.room, content = panel.content;
            const playback = room.playback, members = room.members || [], owner = room.ownerMemberId === connection.memberId;
            const codeCard = node('div', null, 'tw-card');
            const codeRow = node('div', null, 'tw-row');
            const code = node('span', room.code, 'tw-code');
            const copy = button('复制房间码', async () => {
                const copied = await copyText(room.code, panel.dialog);
                if (!copied) {
                    // Leave the code selected so Ctrl+C or a long press works.
                    getSelection()?.selectAllChildren(code);
                    this.setStatus('无法自动复制，房间码已选中，请手动复制。');
                    return;
                }
                copy.textContent = '已复制';
                clearTimeout(this.copyTimer);
                this.copyTimer = setTimeout(() => { copy.textContent = '复制房间码'; }, 2000);
            });
            codeRow.append(code, copy, node('span', members.length + ' / ' + room.capacity + ' 人', 'tw-muted'));
            codeCard.append(codeRow, node('p', connection.connected ? '把房间码发给朋友，他们在「一起看」里输入即可加入。' : '正在重新连接一起看服务…', 'tw-muted'));
            const film = node('div', null, 'tw-card tw-film-card');
            const filmHead = node('div', null, 'tw-film-head'), filmText = node('div', null, 'tw-film-text');
            const art = this.artwork(room.media);
            if (art) filmHead.appendChild(art);
            const [mainLine, detailLine] = mediaLines(room.media);
            filmText.appendChild(node('div', mainLine, 'tw-film'));
            if (detailLine) filmText.appendChild(node('div', detailLine, 'tw-film-detail'));
            const state = {paused: '已暂停在 ', playing: '正在播放 ', waiting: '等待成员就绪 '}[playback.state] || '';
            filmText.appendChild(node('p', state + clock(playback.positionMs) + ' / ' + clock(room.media?.runTimeMs), 'tw-muted'));
            filmHead.appendChild(filmText);
            film.appendChild(filmHead);
            if (playback.state === 'waiting' && playback.waiting?.memberIds?.length)
                film.appendChild(node('p', '还在等：' + playback.waiting.memberIds.map(id => this.memberName(id)).join('、'), 'tw-muted'));
            if (room.pendingChange) film.appendChild(node('p', this.memberName(room.pendingChange.memberId) + ' 正在切换影片…', 'tw-muted'));
            const actions = node('div', null, 'tw-row');
            const busy = !connection.connected || Boolean(room.pendingChange);
            const start = playback.state === 'paused'
                ? button('开始放映', () => this.startTogether(start), 'tw-button tw-primary')
                : button('进入播放', () => this.launch(), 'tw-button tw-primary');
            start.disabled = busy;
            const change = button('更换影片', () => this.openPicker('change'));
            change.disabled = busy;
            actions.append(start, change);
            film.appendChild(actions);
            if (playback.state === 'paused') film.appendChild(node('p', '开始放映时，正打开这个页面的成员会一起进入播放器，等所有人加载好后同时开始。', 'tw-muted'));
            const people = node('div', null, 'tw-card');
            people.appendChild(node('h3', '成员'));
            const list = node('ul', null, 'tw-members');
            for (const member of members) list.appendChild(this.memberRow(member, owner));
            people.appendChild(list);
            const footer = node('div', null, 'tw-row');
            footer.appendChild(button('离开房间', () => this.leave(), 'tw-button tw-danger'));
            if (owner) footer.appendChild(button('解散房间', () => this.closeRoom(), 'tw-button tw-danger'));
            content.append(codeCard, film, people, panel.status, footer);
        }
        artwork(media) {
            const api = this.apiClient();
            if (!media?.itemId || !api?.getImageUrl) return null;
            const episode = media.type === 'Episode';
            const image = node('img', null, 'tw-art' + (episode ? '' : ' tw-art-poster'));
            image.alt = '';
            image.src = api.getImageUrl(media.itemId, {type: 'Primary', maxWidth: episode ? 360 : 200});
            image.addEventListener('error', () => image.remove(), {once: true});
            return image;
        }
        memberRow(member, owner) {
            const row = node('li', null, 'tw-member' + (member.connection === 'online' ? '' : ' tw-offline'));
            const avatar = node('span', (member.name || '?').slice(0, 1), 'tw-avatar');
            this.loadAvatar(member.avatarPath, avatar);
            const main = node('div', null, 'tw-member-main'), name = node('div', member.name || '成员', 'tw-member-name');
            if (member.memberId === this.connection.memberId) name.appendChild(node('span', '你', 'tw-tag'));
            if (member.role === 'owner') name.appendChild(node('span', '房主', 'tw-tag tw-tag-owner'));
            const detail = [member.connection === 'online' ? statusText[member.status] || member.status : '重新连接中', member.platform];
            if (member.lagging) detail.unshift('没跟上');
            main.append(name, node('div', detail.filter(Boolean).join(' · '), 'tw-muted'));
            row.append(avatar, main);
            if (owner && member.memberId !== this.connection.memberId)
                row.appendChild(button('移出', () => this.kick(member)));
            return row;
        }
        async loadAvatar(path, target) {
            if (!path || !window.TigerestCommunityClient) return;
            try {
                let url = this.avatars.get(path);
                if (!url) {
                    const community = this.community || (this.community = new window.TigerestCommunityClient());
                    community.setSession(this.session());
                    url = URL.createObjectURL(await community.avatar(path));
                    this.avatars.set(path, url);
                }
                const image = node('img');
                image.alt = '';
                image.src = url;
                target.replaceChildren(image);
            } catch (_) { /* Initials stay. */ }
        }

        // ---- actions --------------------------------------------------------
        async withLeave(request, conflictText) {
            try { return await request(false); }
            catch (error) {
                if (error.code !== 'ALREADY_IN_ROOM') throw error;
                const title = error.activeRoom?.title ? '「' + error.activeRoom.title + '」' : '';
                const leave = await this.ask({title: '离开当前房间？', text: (conflictText || '你已在另一个房间') + title + '。离开那个房间并继续吗？',
                    confirmText: '离开并继续'});
                if (!leave) return null;
                return request(true);
            }
        }
        async join(code, submit) {
            const value = String(code || '').trim().toUpperCase();
            if (!/^[2-9A-HJKMNP-Z]{6}$/.test(value)) { this.setStatus('房间码是 6 位字母和数字。'); return; }
            submit.disabled = true;
            this.setStatus('正在加入…');
            try {
                const data = await this.withLeave(leaveCurrent => this.client.joinRoom({code: value, clientId: this.clientId, leaveCurrent}));
                if (!data) { this.setStatus(''); return; }
                this.setStatus('');
                this.connect(data.room, data.ticket);
            } catch (error) { if (!error.code) console.error('[Watch]', error); this.setStatus(message(error.code)); }
            finally { submit.disabled = false; }
        }
        async create(item, sourceId, positionMs) {
            this.setStatus('正在创建房间…');
            // One creation intent keeps one idempotency key across retries; a
            // retry that leaves the current room is a different request.
            const base = {itemId: item.Id, mediaSourceId: sourceId, positionMs, clientId: this.clientId};
            try {
                const data = await this.withLeave(leaveCurrent => this.client.createRoom({...base, leaveCurrent, clientRequestId: uuid()}),
                    '你已在另一个房间');
                if (!data) { this.setStatus(''); return; }
                this.panel && (this.panel.view = 'room');
                this.setStatus('');
                this.connect(data.room, data.ticket);
            } catch (error) { if (!error.code) console.error('[Watch]', error); this.setStatus(message(error.code)); }
        }
        changeTo(item, sourceId, positionMs) {
            this.panel && (this.panel.view = 'room');
            this.render();
            this.setStatus('正在切换影片…');
            this.connection.command('changeItem', {itemId: item.Id, mediaSourceId: sourceId, positionMs})
                .then(() => this.setStatus(''), error => this.setStatus(message(error.code)));
        }
        startTogether(control) {
            const room = this.connection?.room;
            if (!room?.media) return;
            control.disabled = true;
            this.setStatus('正在通知成员加载…');
            // Choosing the current film again puts the room into waiting: every
            // member on this page loads it and the room starts once all are ready.
            this.connection.command('changeItem', {itemId: room.media.itemId, mediaSourceId: room.media.mediaSourceId,
                positionMs: room.playback.positionMs}).then(() => this.setStatus(''), error => {
                control.disabled = false;
                this.setStatus(message(error.code));
            });
        }
        leave() {
            const connection = this.connection;
            if (!connection) return;
            this.connection = null;
            this.sync?.clearRoom();
            connection.leave().catch(() => {});
            this.ensureEntry();
            this.render();
        }
        async closeRoom() {
            if (!await this.ask({title: '解散房间？', text: '解散后所有成员都会退出房间。', confirmText: '解散', danger: true})) return;
            this.connection?.control('close');
        }
        async kick(member) {
            if (!await this.ask({title: '移出 ' + member.name + '？', text: '移出后，他在这个房间存在期间不能再加入。', confirmText: '移出', danger: true})) return;
            this.connection?.command('kick', {memberId: member.memberId}).catch(error => this.setStatus(message(error.code)));
        }

        // ---- film picker ------------------------------------------------------
        openPicker(purpose) {
            const panel = this.panel;
            if (!panel) return;
            panel.view = 'picker';
            panel.abort?.abort();
            panel.abort = new AbortController();
            const content = panel.content;
            content.replaceChildren();
            const top = node('div', null, 'tw-row');
            top.appendChild(button('返回', () => { panel.view = 'room'; panel.abort?.abort(); this.render(); }));
            const form = node('form', null, 'tw-row'), search = node('input', null, 'tw-search');
            Object.assign(search, {type: 'search', placeholder: '搜索电影或剧集'});
            search.setAttribute('aria-label', '搜索电影或剧集');
            const go = node('button', '搜索', 'tw-button');
            go.type = 'submit';
            form.append(search, go);
            const results = node('div');
            panel.status = node('p', '', 'tw-status');
            panel.status.setAttribute('role', 'status');
            content.append(top, node('h3', purpose === 'create' ? '选择要一起看的影片' : '换一部影片'), form, panel.status, results);
            const picker = {purpose, results, signal: panel.abort.signal};
            form.addEventListener('submit', event => { event.preventDefault(); this.search(picker, search.value); });
            const contextId = this.pageItemId();
            if (contextId) this.showItem(picker, contextId); else search.focus();
        }
        pageItemId() {
            const hash = window.location.hash || '', query = hash.includes('?') ? hash.slice(hash.indexOf('?') + 1) : '';
            if (!/\/item\b|details/i.test(hash)) return null;
            const id = new URLSearchParams(query).get('id');
            return id && !id.startsWith('local') ? id : null;
        }
        async request(picker, work) {
            this.setStatus('正在读取…');
            try {
                const value = await work(this.apiClient());
                if (!picker.signal.aborted) this.setStatus('');
                return picker.signal.aborted ? null : value;
            } catch (_) {
                if (!picker.signal.aborted) this.setStatus('读取媒体库失败，请稍后重试。');
                return null;
            }
        }
        pick(item, action, poster) {
            const api = this.apiClient(), element = button('', action, 'tw-pick' + (poster ? ' tw-poster' : ''));
            const tag = poster ? item.ImageTags?.Primary : (item.ImageTags?.Primary || item.ImageTags?.Thumb);
            if (tag && api?.getImageUrl) {
                const image = node('img');
                image.alt = '';
                image.loading = 'lazy';
                image.src = api.getImageUrl(item.Id, {type: item.ImageTags?.Primary ? 'Primary' : 'Thumb', maxWidth: 360, tag});
                element.appendChild(image);
            }
            const episodeName = item.Name && !genericEpisodeName.test(item.Name) ? item.Name : '';
            element.appendChild(node('span', item.Type === 'Episode'
                ? [item.IndexNumber != null ? '第' + item.IndexNumber + '集' : '', episodeName].filter(Boolean).join(' · ') : itemTitle(item)));
            return element;
        }
        async search(picker, text) {
            const term = String(text || '').trim();
            if (!term) return;
            const userId = this.apiClient()?.getCurrentUserId();
            const data = await this.request(picker, api => api.getItems(userId, {SearchTerm: term, IncludeItemTypes: 'Movie,Series',
                Recursive: true, Limit: 30, Fields: 'ProductionYear', EnableImageTypes: 'Primary', ImageTypeLimit: 1}));
            if (!data) return;
            const list = node('div', null, 'tw-list');
            for (const item of data.Items || []) list.appendChild(this.pick(item, () => this.showItem(picker, item.Id), true));
            picker.results.replaceChildren(list);
            if (!data.Items?.length) this.setStatus('没有找到匹配的电影或剧集。');
        }
        async showItem(picker, id) {
            const userId = this.apiClient()?.getCurrentUserId();
            const item = await this.request(picker, api => api.getItem(userId, id));
            if (!item) return;
            if (item.Type === 'Movie') return this.confirm(picker, item);
            if (item.Type === 'Episode') {
                await this.showSeason(picker, item.SeriesId, item.SeasonId, item.Id);
                return this.confirm(picker, item);
            }
            if (item.Type === 'Series') return this.showSeason(picker, item.Id, null, null);
            if (item.Type === 'Season') return this.showSeason(picker, item.SeriesId, item.Id, null);
            this.setStatus('只能一起看电影或剧集的单集，请换一个。');
        }
        async showSeason(picker, seriesId, seasonId, selectedId) {
            const userId = this.apiClient()?.getCurrentUserId();
            const seasons = await this.request(picker, api => api.getSeasons(seriesId, {userId}));
            if (!seasons) return;
            const seasonList = seasons.Items || [];
            const season = seasonList.find(s => s.Id === seasonId) || seasonList.find(s => (s.IndexNumber || 0) > 0) || seasonList[0];
            const episodes = await this.request(picker, api => api.getEpisodes(seriesId, {userId, seasonId: season?.Id,
                Fields: 'MediaSources', EnableImageTypes: 'Primary,Thumb', ImageTypeLimit: 1}));
            if (!episodes) return;
            const wrap = node('div');
            if (seasonList.length > 1) {
                const tabs = node('div', null, 'tw-row');
                for (const entry of seasonList) {
                    const tab = button(entry.Name || '第' + entry.IndexNumber + '季', () => this.showSeason(picker, seriesId, entry.Id, null));
                    tab.setAttribute('aria-pressed', String(entry.Id === season?.Id));
                    tabs.appendChild(tab);
                }
                wrap.appendChild(tabs);
            }
            const list = node('div', null, 'tw-list');
            for (const episode of episodes.Items || []) {
                const element = this.pick(episode, () => this.confirm(picker, episode), false);
                if (episode.Id === selectedId) element.setAttribute('aria-pressed', 'true');
                list.appendChild(element);
            }
            wrap.appendChild(list);
            picker.results.replaceChildren(wrap);
            list.querySelector('[aria-pressed=true]')?.scrollIntoView({block: 'nearest'});
        }
        async confirm(picker, chosen) {
            const userId = this.apiClient()?.getCurrentUserId();
            const item = chosen.MediaSources ? chosen : await this.request(picker, api => api.getItem(userId, chosen.Id));
            if (!item) return;
            const sources = item.MediaSources || [];
            const card = node('div', null, 'tw-card');
            card.appendChild(node('div', itemTitle(item), 'tw-film'));
            let sourceId = sources[0]?.Id || item.Id;
            if (sources.length > 1) {
                const versions = node('div', null, 'tw-row');
                for (const source of sources) {
                    const version = button(source.Name || '版本', () => {
                        sourceId = source.Id;
                        for (const other of versions.children) other.setAttribute('aria-pressed', String(other === version));
                    });
                    version.setAttribute('aria-pressed', String(source.Id === sourceId));
                    versions.appendChild(version);
                }
                card.append(node('p', '选择版本（所有成员使用同一版本）：', 'tw-muted'), versions);
            }
            const resume = Math.floor((item.UserData?.PlaybackPositionTicks || 0) / 10000);
            const run = position => picker.purpose === 'create' ? this.create(item, sourceId, position) : this.changeTo(item, sourceId, position);
            const actions = node('div', null, 'tw-row');
            const verb = picker.purpose === 'create' ? '创建房间' : '换成这部并开始放映';
            actions.appendChild(button(resume > 0 ? verb + '（从头）' : verb, () => run(0), 'tw-button tw-primary'));
            if (resume > 0) actions.appendChild(button(verb + '（从 ' + clock(resume) + '）', () => run(resume)));
            card.appendChild(actions);
            if (picker.purpose !== 'create') card.appendChild(node('p', '换片后，正打开一起看页面和正在观看的成员会一起加载新影片，就绪后同时开始。', 'tw-muted'));
            picker.results.prepend(card);
            card.scrollIntoView({block: 'nearest'});
        }
        debug() {
            // wall: epoch time of this sample, to compare clients on one machine.
            return {wall: performance.timeOrigin + performance.now(), room: this.connection?.room || null, memberId: this.connection?.memberId || null,
                connected: Boolean(this.connection?.connected), sync: this.sync?.snapshot() || null,
                attached: this.sync?.attached || null, launching: this.launching || null};
        }
    }
    window._watchTogetherPlugin = WatchPlugin;
})();
