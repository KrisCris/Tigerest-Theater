// Public client for the independently deployed, private community service.
(function () {
    'use strict';
    const trustedServer = '62526c3bf747439c99327ddec5fed4a8';
    const messages = {
        AUTH_REQUIRED: '请登录 Emby 后使用评论区。', AUTH_INVALID: '登录已失效，请重新登录。',
        SERVER_NOT_ALLOWED: '此服务器暂未开放评论区。', FORBIDDEN: '没有执行此操作的权限。',
        USER_MUTED: '你已被禁言，暂时无法发表或回复。', NOT_FOUND: '内容不可见或已删除，请刷新评论。',
        TARGET_DELETED: '回复目标已删除，请刷新后重新选择。', PROTECTED_ADMIN: '评论管理员不可被禁言。',
        IDEMPOTENCY_CONFLICT: '本次发送的内容已变更，请刷新后重试。',
        AUTH_UNAVAILABLE: '身份验证服务暂不可用，请稍后重试。',
        COMMUNITY_UNAVAILABLE: '评论服务暂不可用，请稍后重试。',
        MESSAGES_UNAVAILABLE: '消息功能尚未启用，请联系管理员升级评论服务。'
    };
    function abortError() { const error = new Error('评论请求已取消'); error.name = 'AbortError'; return error; }
    function uuid() {
        // Emby is served over HTTP, where randomUUID may be unavailable.
        if (window.crypto.randomUUID) return window.crypto.randomUUID();
        const bytes = window.crypto.getRandomValues(new Uint8Array(16));
        bytes[6] = (bytes[6] & 15) | 64;
        bytes[8] = (bytes[8] & 63) | 128;
        const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
        return [hex.slice(0,8),hex.slice(8,12),hex.slice(12,16),hex.slice(16,20),hex.slice(20)].join('-');
    }
    class CommunityClient {
        constructor({ fetch: request = window.fetch.bind(window), now = Date.now } = {}) {
            this.fetch = request;
            this.now = now;
            this.generation = 0;
            this.controllers = new Set();
            this.pendingSend = null;
            this.cooldownUntil = 0;
        }
        static session(api) {
            if (!api) return null;
            return {serverId: api.serverId?.(), userId: api.getCurrentUserId?.(),
                token: api.accessToken?.(), address: api.serverAddress?.()};
        }
        static supported(session) {
            if (!session?.token || !session.userId || session.serverId !== trustedServer) return false;
            try {
                const url = new URL(session.address);
                return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password &&
                    ['192.168.5.150', 'nas.tigerest.top'].includes(url.hostname.toLowerCase());
            } catch (_) { return false; }
        }
        setSession(session) { return this.setContext(session); }
        setContext(session, itemId = null) {
            const next = CommunityClient.supported(session) ? {...session, itemId: itemId ? String(itemId) : null} : null;
            const key = next ? JSON.stringify(next) : '';
            if (key !== this.contextKey) {
                this.clear();
                this.contextKey = key;
                this.context = next;
                this.base = next ? 'http://' + (new URL(next.address).hostname === '192.168.5.150'
                    ? '192.168.5.150' : 'nas.tigerest.top') + ':18443/community/v1' : null;
            }
            return Boolean(this.context);
        }
        cancelRequests() {
            this.generation++;
            for (const controller of this.controllers) controller.abort();
            this.controllers.clear();
            this.pendingSend = null;
        }
        clear() {
            this.cancelRequests();
            this.context = null;
            this.contextKey = '';
            this.base = null;
            this.cooldownUntil = 0;
        }
        async request(path, {method = 'GET', body, item = false, image = false} = {}) {
            if (!this.context) throw new Error(messages.AUTH_REQUIRED);
            if (item && !this.context.itemId) throw new Error('请先打开可访问的媒体详情。');
            const generation = this.generation;
            const controller = new AbortController();
            this.controllers.add(controller);
            const timeout = setTimeout(() => controller.abort(), 15000);
            const headers = {'X-Emby-Token': this.context.token,
                'X-Emby-Server-Id': this.context.serverId, 'X-Emby-User-Id': this.context.userId};
            if (item) headers['X-Tigerest-Item-Id'] = this.context.itemId;
            if (body !== undefined) headers['Content-Type'] = 'application/json';
            try {
                const response = await this.fetch(this.base + path, {method, headers,
                    body: body === undefined ? undefined : JSON.stringify(body),
                    credentials: 'omit', redirect: 'error', cache: 'no-store', signal: controller.signal});
                if (generation !== this.generation) throw abortError();
                if (response.ok && image) {
                    if (!/^image\/(png|jpeg|webp)(;|$)/i.test(response.headers.get('Content-Type') || ''))
                        throw new Error('头像暂不可用');
                    const blob = await response.blob();
                    if (generation !== this.generation) throw abortError();
                    if (blob.size > 5 * 1024 * 1024) throw new Error('头像暂不可用');
                    return blob;
                }
                const payload = await response.json();
                if (generation !== this.generation) throw abortError();
                if (!response.ok) {
                    const code = String(payload.error?.code || 'UNKNOWN');
                    let message = messages[code] || '评论请求失败，请稍后重试。';
                    let retryAfter = 0;
                    if (response.status === 429) {
                        retryAfter = Math.min(86400, Math.max(1, Number(response.headers.get('Retry-After')) || 3));
                        this.cooldownUntil = Math.max(this.cooldownUntil, this.now() + retryAfter * 1000);
                        message = '操作过于频繁，请等待 ' + retryAfter + ' 秒后重试。';
                    }
                    const error = new Error(message);
                    Object.assign(error, {code, status: response.status, retryAfter});
                    // Only display a UUID request ID; never forward backend error text.
                    if (/^[0-9a-f-]{36}$/i.test(payload.requestId || '')) error.requestId = payload.requestId;
                    if (response.status === 401) this.clear();
                    throw error;
                }
                return payload.data;
            } catch (error) {
                if (generation !== this.generation) {
                    if (error.status === 401) throw error;
                    throw abortError();
                }
                if (error.name === 'AbortError') throw new Error('评论请求超时，请重试。');
                if (error.status) throw error;
                throw new Error('网络连接失败，请重试。');
            } finally {
                clearTimeout(timeout);
                this.controllers.delete(controller);
            }
        }
        me() { return this.request('/me'); }
        resolve(scope) { return this.request('/topics/resolve', {method:'POST', body:{itemId:this.context?.itemId, scope}}); }
        page(path, cursor, item = true, anchorId = null, limit = 20) {
            if (cursor && anchorId) return Promise.reject(new Error('定位与分页不能同时使用。'));
            return this.request(path + (path.includes('?') ? '&' : '?') + 'limit=' + limit +
                (cursor ? '&cursor=' + encodeURIComponent(cursor) : '') +
                (anchorId ? '&anchorId=' + encodeURIComponent(anchorId) : ''), {item});
        }
        comments(topicId, cursor, anchorId) { return this.page('/topics/' + encodeURIComponent(topicId) + '/comments', cursor, true, anchorId, 10); }
        replies(rootId, cursor, anchorId) { return this.page('/comments/' + encodeURIComponent(rootId) + '/replies', cursor, true, anchorId); }
        async send(topicId, text, reply = null) {
            const body = text.trim();
            if (!body || Array.from(body).length > 2000) throw new Error('请输入 1–2000 个字符。');
            const wait = Math.ceil((this.cooldownUntil - this.now()) / 1000);
            if (wait > 0) throw new Error('请等待 ' + wait + ' 秒后重试。');
            const path = reply ? '/comments/' + encodeURIComponent(reply.rootId || reply.id) + '/replies'
                : '/topics/' + encodeURIComponent(topicId) + '/comments';
            const key = JSON.stringify([path, body, reply?.id]);
            if (this.pendingSend?.key !== key)
                this.pendingSend = {key, payload: {body, clientRequestId: uuid()}};
            if (reply) this.pendingSend.payload.replyToId = reply.id;
            const result = await this.request(path, {method:'POST', body:this.pendingSend.payload, item:true});
            this.pendingSend = null;
            this.cooldownUntil = Math.max(this.cooldownUntil, this.now() + 3000);
            return result;
        }
        remove(id) { return this.request('/comments/' + encodeURIComponent(id), {method:'DELETE', item:true}); }
        moderate(id, scope, reason) { return this.request('/admin/comments/' + encodeURIComponent(id) + '/delete',
            {method:'POST', body:{scope, reason}}); }
        mute(id, durationSeconds, reason) { return this.request('/admin/authors/' + encodeURIComponent(id) + '/mute',
            {method:'PUT', body:{durationSeconds, reason}}); }
        unmute(id) { return this.request('/admin/authors/' + encodeURIComponent(id) + '/mute', {method:'DELETE'}); }
        mutes(cursor) { return this.page('/admin/mutes', cursor, false); }
        actions(cursor) { return this.page('/admin/actions', cursor, false); }
        messageSummary() { return this.request('/me/replies?limit=1'); }
        messages(kind = 'replies', cursor, unreadOnly = false) {
            if (!['sent', 'replies'].includes(kind)) return Promise.reject(new Error('消息类型无效。'));
            return this.page(kind === 'sent' ? '/me/comments' : '/me/replies?unreadOnly=' + Boolean(unreadOnly), cursor, false);
        }
        readMessage(id) { return this.request('/me/replies', {method:'POST', body:{messageIds:[id]}}); }
        readAllMessages(readThroughToken) {
            if (typeof readThroughToken !== 'string' || !readThroughToken) return Promise.reject(new Error('消息快照无效，请刷新后重试。'));
            return this.request('/me/replies', {method:'POST', body:{readThroughToken}});
        }
        adminMessages(filters = {}, cursor) {
            const query = new URLSearchParams({limit:'20'});
            for (const key of ['query', 'kind', 'state', 'rootId']) {
                if (filters[key]) query.set(key, String(filters[key]));
            }
            if (cursor) query.set('cursor', cursor);
            return this.request('/admin/messages?' + query);
        }
        avatar(path) {
            if (!/^\/community\/v1\/avatars\/[0-9a-z-]+(?:\?v=[^#]*)?$/i.test(path || ''))
                return Promise.reject(new Error('头像暂不可用'));
            return this.request(path.slice('/community/v1'.length), {image:true});
        }
    }
    window.TigerestCommunityClient = CommunityClient;
})();
