// Servers this client profile has successfully opened, kept as one versioned
// JSON string in the native setting main.knownServers. Records hold display
// metadata only: credentials stay in each server origin's own web storage.
// The schema is shared with the Apple client; see
// docs/superpowers/specs/2026-10-19-server-history-contract.md.
(function (root) {
    const VERSION = 1, LIMIT = 20, NAME_LIMIT = 80;
    const DEDICATED = 'tigerest';

    // Keep scheme, host (IPv6 included), port and base path; only the web
    // client's own page and the URL's query/fragment are not part of it.
    function canonicalAddress(input) {
        let url;
        try { url = new URL(String(input || '').trim()); } catch { return null; }
        if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) return null;
        let path = url.pathname.replace(/\/web(?:\/(?:index\.html)?)?$/i, '/');
        if (!path.endsWith('/')) path += '/';
        return `${url.protocol}//${url.host}${path}`;
    }

    // The dedicated server's LAN and public addresses are one logical server.
    function recordKey(mode, address) {
        if (mode === DEDICATED) return DEDICATED;
        const canonical = canonicalAddress(address);
        return canonical ? 'custom:' + canonical : null;
    }

    function cleanText(value) {
        return String(value ?? '').replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g, '').trim().slice(0, NAME_LIMIT);
    }

    function sanitize(record) {
        if (!record || typeof record !== 'object') return null;
        const mode = record.mode === DEDICATED ? DEDICATED : record.mode === 'custom' ? 'custom' : null;
        const address = canonicalAddress(record.address);
        if (!mode || !address) return null;
        const clean = {key: recordKey(mode, address), mode, address};
        const name = cleanText(record.name);
        if (name) clean.name = name;
        if (record.kind === 'emby' || record.kind === 'jellyfin') clean.kind = record.kind;
        if (typeof record.serverId === 'string' && /^[A-Za-z0-9-]{1,64}$/.test(record.serverId)) clean.serverId = record.serverId;
        const at = Number(record.lastConnectedAt);
        clean.lastConnectedAt = Number.isFinite(at) && at > 0 ? Math.floor(at) : 0;
        return clean;
    }

    // Unreadable or foreign data yields an empty list rather than an error, so a
    // damaged setting can never block choosing a server.
    function parse(text) {
        let data;
        try { data = JSON.parse(text || '{}'); } catch { return []; }
        if (!data || data.version !== VERSION || !Array.isArray(data.servers)) return [];
        const seen = new Set(), servers = [];
        for (const raw of data.servers) {
            const record = sanitize(raw);
            if (record && !seen.has(record.key)) { seen.add(record.key); servers.push(record); }
        }
        return order(servers).slice(0, LIMIT);
    }

    function order(servers) {
        return servers.slice().sort((a, b) => b.lastConnectedAt - a.lastConnectedAt);
    }

    function serialize(servers) {
        return JSON.stringify({version: VERSION, servers: order(servers).slice(0, LIMIT).map(({key, ...record}) => record)});
    }

    // The history after a successful connection. Metadata already learned for
    // the same server is kept; the native transaction commits this text only
    // once the server's web page has loaded.
    function remember(text, {mode, address, at = Date.now(), replacing = null}) {
        const record = sanitize({mode, address, lastConnectedAt: at});
        if (!record) throw new Error('无效的服务器地址');
        const servers = parse(text).filter(server => server.key !== replacing || replacing === record.key);
        const previous = servers.find(server => server.key === record.key);
        const next = {...previous, ...record};
        if (mode === DEDICATED) delete next.serverId;
        return serialize([next, ...servers.filter(server => server.key !== record.key)]);
    }

    // Name/type learned by the loaded server page. Never creates a record.
    function annotate(text, {mode, address, name, kind, serverId}) {
        const key = recordKey(mode, address);
        const servers = parse(text), index = servers.findIndex(server => server.key === key);
        if (index < 0) return text;
        const updated = sanitize({...servers[index], name: name || servers[index].name, kind: kind || servers[index].kind,
            serverId: mode === DEDICATED ? undefined : serverId || servers[index].serverId});
        if (JSON.stringify(updated) === JSON.stringify(servers[index])) return text;
        servers[index] = updated;
        return serialize(servers);
    }

    function forget(text, key) {
        return serialize(parse(text).filter(server => server.key !== key));
    }

    // Records to show. A server saved before this history existed appears once,
    // honestly undated; earlier servers that were never kept are not invented.
    function list(text, {current = '', mode = ''} = {}) {
        const servers = parse(text);
        const key = current ? recordKey(mode, current) : null;
        if (key && !servers.some(server => server.key === key)) {
            const migrated = sanitize({mode, address: current});
            if (migrated) servers.push(migrated);
        }
        return servers.map(server => ({...server, current: server.key === key}));
    }

    const api = {VERSION, LIMIT, canonicalAddress, recordKey, parse, serialize, remember, annotate, forget, list};
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.TigerestServerHistory = api;
}(typeof window !== 'undefined' ? window : globalThis));
