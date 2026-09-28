const DEFAULT_LOCAL_SERVER_IP = '192.168.5.150';
const DEFAULT_LOCAL_SERVER = `http://${DEFAULT_LOCAL_SERVER_IP}:8095/`;
const DEFAULT_REMOTE_SERVER = 'http://nas.tigerest.top:8095/';
const descriptions = {
    tigerest: '连接大河李斯特专属 EMBY 服务器。服务器访问权限及说明详见 B站充电页面。',
    custom: '连接你自己搭建的 EMBY 服务器。本应用只是播放器，不包含服务器，也不提供自建服务器的影视资源。',
};
const el = id => document.getElementById(id);
let isConnecting = false;
let connectionGeneration = 0;
let mode = '';

function normalizeServer(input) {
    let value = (input || '').trim();
    if (!value) throw new Error('请填写你的 EMBY 服务器地址。');
    if (!/^[a-z][a-z\d+.-]*:\/\//i.test(value)) value = 'http://' + value;
    let url;
    try { url = new URL(value); } catch { throw new Error('地址格式不正确，请填写完整的主机和端口。'); }
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) {
        throw new Error('请使用 HTTP 或 HTTPS 服务器地址，不要在地址中填写账号密码。');
    }
    return url.href;
}

function isTigerestDefaultServer(server) {
    try {
        const url = new URL(normalizeServer(server));
        return url.port === '8095' && [DEFAULT_LOCAL_SERVER_IP, 'nas.tigerest.top'].includes(url.hostname);
    } catch { return false; }
}

function setConnecting(active) {
    isConnecting = active;
    el('address').disabled = active;
    el('spinner').hidden = !active;
    el('connect-button').disabled = active || !el('address').value.trim();
    el('connect-button').textContent = active ? '正在连接…' : '连接服务器';
    el('connect-form').setAttribute('aria-busy', String(active));
}

function showManualConnection(address = '', error = '') {
    el('server-choice').hidden = true;
    el('connect-form').hidden = false;
    el('title').textContent = mode === 'custom' ? '连接自建 EMBY 服务器' : '连接大河专属 EMBY';
    el('address').value = address;
    el('connection-error').textContent = error;
    el('connection-error').hidden = !error;
    el('connection-status').textContent = '';
    setConnecting(false);
    el('address').focus();
}

function cancelConnection() {
    ++connectionGeneration;
    window.jmpCheckServerConnectivity.abort?.();
    window.api?.system.cancelServerConnectivity();
    setConnecting(false);
}

function showChoices() {
    cancelConnection();
    el('server-choice').hidden = false;
    el('connect-form').hidden = true;
    el('choice-description').textContent = '请选择你要连接的服务器。';
}

async function connectServers(servers) {
    if (isConnecting) return;
    const generation = ++connectionGeneration;
    setConnecting(true);
    el('connection-error').hidden = true;
    let error = '';
    for (const input of [...new Set(servers)]) {
        if (generation !== connectionGeneration) return;
        try {
            const server = normalizeServer(input);
            el('address').value = server;
            el('connection-status').textContent = `正在连接 ${server}`;
            const resolvedUrl = await window.jmpCheckServerConnectivity(server);
            if (generation !== connectionGeneration) return;
            // Keep the address and external port chosen by this user.
            window.jmpInfo.settings.main.userWebClient = server;
            window.jmpInfo.settings.main.serverConnectionMode = mode;
            window.location = resolvedUrl;
            return;
        } catch (failure) {
            if (generation !== connectionGeneration) return;
            error = failure.message || '无法连接服务器';
        }
    }
    showManualConnection(el('address').value,
        `${error}。请检查地址、端口及当前网络是否能访问该服务器。`);
}

async function chooseMode(selected) {
    mode = selected;
    window.jmpInfo.settings.main.serverConnectionMode = mode;
    window.jmpInfo.settings.main.userWebClient = '';
    showManualConnection();
    if (mode === 'tigerest') {
        const generation = connectionGeneration;
        const onLan = await window.api.system.isAddressOnLocalSubnet(DEFAULT_LOCAL_SERVER_IP);
        if (generation !== connectionGeneration || mode !== 'tigerest') return;
        await connectServers(onLan ? [DEFAULT_LOCAL_SERVER, DEFAULT_REMOTE_SERVER] : [DEFAULT_REMOTE_SERVER]);
    }
}

for (const selected of ['tigerest', 'custom']) {
    const button = el(`choose-${selected}`);
    button.addEventListener('click', () => chooseMode(selected));
    for (const event of ['mouseenter', 'focus']) {
        button.addEventListener(event, () => { el('choice-description').textContent = descriptions[selected]; });
    }
}
el('connect-form').addEventListener('submit', event => {
    event.preventDefault();
    if (!isConnecting) return connectServers([el('address').value]);
});
el('address').addEventListener('input', () => {
    if (!isConnecting) el('connect-button').disabled = !el('address').value.trim();
});
el('back-button').addEventListener('click', showChoices);
el('offline-button').addEventListener('click', () => window.tigerestOpenOfflineLibrary());
document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && isConnecting) {
        event.preventDefault();
        cancelConnection();
        showManualConnection(el('address').value);
    }
});

(async () => {
    el('server-choice').hidden = false;
    el('connect-form').hidden = true;
    el('choose-tigerest').disabled = el('choose-custom').disabled = true;
    await window.apiPromise;
    el('choose-tigerest').disabled = el('choose-custom').disabled = false;
    const main = window.jmpInfo.settings.main;
    const saved = main.userWebClient || '';
    mode = main.serverConnectionMode || (saved ? (isTigerestDefaultServer(saved) ? 'tigerest' : 'custom') : '');
    if (!['tigerest', 'custom'].includes(mode)) return showChoices();
    main.serverConnectionMode = mode;
    showManualConnection(saved);
    if (mode === 'custom') {
        if (saved) await connectServers([saved]);
    } else {
        const generation = connectionGeneration;
        const onLan = await window.api.system.isAddressOnLocalSubnet(DEFAULT_LOCAL_SERVER_IP);
        if (generation !== connectionGeneration || mode !== 'tigerest') return;
        await connectServers(onLan ? [DEFAULT_LOCAL_SERVER, DEFAULT_REMOTE_SERVER] : [DEFAULT_REMOTE_SERVER]);
    }
})();
