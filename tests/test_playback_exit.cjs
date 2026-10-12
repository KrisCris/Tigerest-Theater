// Exercise the shipped Windows client with actual libmpv video output. The
// process must exit normally, not merely hide its window or stop one media item.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const withBrowser = require('./community_browser.cjs');
const frame = Buffer.alloc(64 * 36 * 3 / 2, 128);
frame.fill(32, 0, 64 * 36);
const video = Buffer.concat([Buffer.from('YUV4MPEG2 W64 H36 F24:1 Ip A1:1 C420jpeg\n'),
    ...Array.from({length: 24 * 30}, () => Buffer.concat([Buffer.from('FRAME\n'), frame]))]);
const routes = {
    '/': {type: 'text/html', body: '<!doctype html><title>Isolated playback exit regression</title>'},
    '/clip.y4m': {type: 'video/x-yuv4mpeg', body: video}
};

(async () => {
    const rows = [];
    const cases = process.env.TIGEREST_EXIT_CASE ? [process.env.TIGEREST_EXIT_CASE] :
        ['api-exit', 'CLOSE_WIN', 'Alt+F4', 'exit-during-controls', 'idle-api-exit'];
    for (const method of cases) {
        await withBrowser(routes, async ({evaluate, process: child, profile}) => {
            await evaluate(`(${(async idle => {
                await window.initCompleted;
                if (idle) return true;
                let visible = false, position = 0;
                api.player.windowVisible.connect(value => visible = value);
                api.player.positionUpdate.connect(value => position = value);
                await api.window.beginPlaybackSession();
                if (!await api.player.load(location.origin + '/clip.y4m', {autoplay: true},
                    {type: 'video', frameRate: 24}, null, null)) throw Error('native load rejected');
                for (let i = 0; i < 180; i++) {
                    if (visible && position > 0) return true;
                    await new Promise(resolve => setTimeout(resolve, 50));
                }
                throw Error('video was not visibly playing before the exit request');
            }).toString()})(${method === 'idle-api-exit'})`);
            const started = Date.now();
            let timer;
            const exited = new Promise((resolve, reject) => {
                timer = setTimeout(() => reject(Error(method + ': process still alive after 12 seconds')), 12000);
                child.once('exit', (code, signal) => {
                    clearTimeout(timer);
                    resolve({method, code, signal, elapsedMs: Date.now() - started});
                });
            });
            try {
                // Delay only to let the WebChannel reply reach this harness.
                // keypress exercises mpv's native key bindings, including the
                // CLOSE_WIN event emitted by its Windows WM_CLOSE handler.
                const action = method === 'exit-during-controls' ? `(async () => {
                    const fullscreen = await api.window.isFullScreen();
                    await api.system.exit();
                    await Promise.all([api.player.pause(), api.player.seekTo(1000), api.player.clearQueue(),
                        api.player.setVolume(37), api.player.userCommand('keypress Alt+F4'),
                        api.window.setFullScreen(!fullscreen), api.system.exit()]);
                })()` : method.endsWith('api-exit') ? 'api.system.exit()' :
                    `api.player.userCommand(${JSON.stringify('keypress ' + method)})`;
                await evaluate(`setTimeout(() => ${action}, 50); true`);
                const result = await exited;
                assert.equal(result.code, 0, method + ': graceful exit code');
                assert.equal(result.signal, null, method + ': must not require a forced kill');
                rows.push(result);
            } catch (error) {
                for (const file of fs.readdirSync(profile, {recursive: true})) {
                    if (path.basename(file) === 'Tigerest Theater.log')
                        console.error(fs.readFileSync(path.join(profile, file), 'utf8').split('\n').slice(-25).join('\n'));
                }
                throw error;
            } finally { clearTimeout(timer); }
        }, {settings: {mpv: {enableDanmaku: false}, home: {startupFullscreen: method === 'Alt+F4'}}, startupTimeout: 30000,
            prepareProfile: async (_, folder) => {
                // Explicit quit must exit even when ordinary red-X close would
                // minimize to tray. This writes only this test's temp profile.
                const file = path.join(folder, 'Tigerest Theater.conf');
                const config = JSON.parse(fs.readFileSync(file, 'utf8'));
                config.sections.main.enableWindowsTrayIcon = true;
                fs.writeFileSync(file, JSON.stringify(config));
            }});
    }
    console.log(JSON.stringify({playbackExit: rows, scope: 'real Windows client, libmpv and local Y4M; isolated profiles; native key binding/API exit paths'}));
})().catch(error => {console.error(error); process.exitCode = 1;});
