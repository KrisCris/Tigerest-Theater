// Automatic fault reports. Main-thread stalls (native watchdog) and playback
// startup timeouts become private community reports with the diagnostics log,
// sent without asking. Setting main.autoFaultReports turns this off.
const STORAGE_KEY = 'tigerest-fault-playback';
const MAX_REPORTS_PER_LAUNCH = 3;
// A fault is tied to the item that was playing shortly before it.
const PLAYBACK_CONTEXT_MS = 30 * 60 * 1000;
const RETRY_MS = 20000;
const ATTACH_WAIT_MS = 120000;
const MAX_STACK_TEXT = 900000;

let playback = null;
try { playback = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || 'null'); } catch (_) { playback = null; }
let messages = null;
let attachTimer = null;
let started = null;
let sent = 0;
const queue = [];

function enabled() {
    const settings = window.jmpInfo?.settings?.main;
    return window.api?.system?.isWindows === true && settings?.autoFaultReports !== false;
}

function call(target, name) {
    if (typeof target?.[name] !== 'function') return Promise.resolve(null);
    return new Promise(resolve => {
        let settled = false;
        const finish = value => { if (!settled) { settled = true; clearTimeout(timer); resolve(value); } };
        const timer = setTimeout(() => finish(null), 5000);
        try {
            const result = target[name](finish);
            if (result?.then) result.then(finish, () => finish(null));
            else if (result !== undefined) finish(result);
        } catch (_) { finish(null); }
    });
}

function setPlayback(context) {
    if (!context?.itemId) return;
    playback = {
        itemId: String(context.itemId),
        serverId: context.serverId ? String(context.serverId) : null,
        mediaSourceId: context.mediaSourceId ? String(context.mediaSourceId) : null,
        at: Date.now()
    };
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(playback)); } catch (_) { }
}

function playbackFor(time) {
    if (!playback?.itemId || !Number.isFinite(playback.at)) return null;
    const age = time - playback.at;
    return age >= -60000 && age <= PLAYBACK_CONTEXT_MS ? playback : null;
}

const seconds = ms => (Math.max(0, Number(ms) || 0) / 1000).toFixed(1);

function describe(fault) {
    const version = window.jmpInfo?.version ? `客户端 ${window.jmpInfo.version}。` : '';
    if (fault.kind === 'main-thread-stall' && fault.unrecovered)
        return `自动故障报告：上次运行时客户端主线程卡住至少 ${seconds(fault.durationMs)} 秒，没有恢复（窗口未响应，可能被强制结束）。附带卡住时的线程调用栈。${fault.appVersion ? `出错版本 ${fault.appVersion}。` : version}`;
    if (fault.kind === 'main-thread-stall')
        return `自动故障报告：客户端主线程卡住 ${seconds(fault.durationMs)} 秒后恢复（期间窗口未响应）。诊断日志含卡住时的线程调用栈。${version}`;
    return `自动故障报告：${fault.message || '播放器启动超时'}，已等待 ${seconds(fault.elapsedMs)} 秒。${fault.nativeDelayMs > 1500 ? `原生端 ${seconds(fault.nativeDelayMs)} 秒未响应。` : ''}${version}`;
}

// A process that never recovered left only its stacks; its log belonged to an
// earlier session and is not imported.
function stackSnapshot(fault) {
    const stacks = Array.isArray(fault.stacks) ? fault.stacks.filter(s => typeof s === 'string') : [];
    if (!stacks.length) return null;
    let text = `Unrecovered main-thread stall from a previous run; version ${fault.appVersion || 'unknown'}, started ${fault.startedAt || 'unknown'}, at least ${fault.durationMs || 0} ms\n`;
    let truncated = false;
    for (const stack of stacks) {
        // eslint-disable-next-line no-control-regex
        const clean = stack.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g, ' ');
        if (text.length + clean.length + 2 > MAX_STACK_TEXT) { truncated = true; break; }
        text += '\n' + clean + '\n';
    }
    return {capturedAt: new Date().toISOString(), truncated, logText: text};
}

async function deliver(entry) {
    if (!enabled() || sent >= MAX_REPORTS_PER_LAUNCH) return true;
    const fault = entry.fault;
    const context = playbackFor(entry.at);
    if (!context) {
        console.warn('[Fault] Not reported: no recent playback to attach it to');
        return true;
    }
    if (!messages?.autoReport) return false;
    const details = {};
    if (context.mediaSourceId) details.mediaSourceId = context.mediaSourceId;
    const result = await messages.autoReport({
        itemId: context.itemId,
        description: describe(fault),
        context: details,
        snapshot: fault.unrecovered ? stackSnapshot(fault) : null,
        collect: !fault.unrecovered
    });
    if (result === 'unavailable') return false;
    if (result === 'sent') {
        sent++;
        console.info(`[Fault] Automatic report sent: ${fault.kind}`);
    }
    return true;
}

async function drain() {
    clearTimeout(attachTimer);
    attachTimer = null;
    while (queue.length) {
        const entry = queue[0];
        let done;
        try {
            done = await deliver(entry);
        } catch (error) {
            const retryable = !error?.status || error.status === 429 || error.status >= 500;
            console.warn('[Fault] Automatic report failed:', error?.status || '', error?.message || error);
            done = !retryable || entry.retried;
            if (!done) {
                entry.retried = true;
                attachTimer = setTimeout(drain, RETRY_MS);
                return;
            }
        }
        if (!done) {
            // No account session yet (startup, sign-in). Keep waiting a while.
            if (Date.now() - entry.queuedAt < ATTACH_WAIT_MS) attachTimer = setTimeout(drain, 5000);
            else queue.shift();
            return;
        }
        queue.shift();
    }
}

function record(fault) {
    if (!fault || typeof fault !== 'object' || !enabled()) return;
    const at = fault.unrecovered ? Date.parse(fault.startedAt) || Date.now() : Date.now();
    const key = fault.kind + ':' + (fault.startedAt || Math.floor(at / 60000));
    if (queue.some(entry => entry.key === key)) return;
    queue.push({fault, at, key, queuedAt: Date.now(), retried: false});
    if (queue.length === 1 && !attachTimer) drain();
}

function start() {
    if (started) return started;
    started = Promise.resolve(window.api || window.apiPromise).then(async api => {
        const system = api?.system;
        if (!system) return;
        system.mainThreadStallRecovered?.connect(fault => record({...fault}));
        const unfinished = await call(system, 'takeUnfinishedFault');
        if (unfinished && typeof unfinished === 'object' && unfinished.kind) record({...unfinished});
    }).catch(() => {});
    return started;
}

function attach(instance) {
    messages = instance;
    if (queue.length && !attachTimer) drain();
}

window.TigerestFaultReports = {start, attach, record, setPlayback, enabled};
// nativeshell.js creates window.apiPromise later in the same injected bundle.
setTimeout(start, 0);
