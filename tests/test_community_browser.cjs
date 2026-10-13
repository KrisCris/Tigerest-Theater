const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const test = require('node:test');

test('a browser terminated by signal reports its startup error and cleans up', {
    skip: process.platform === 'win32'
}, () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tigerest-browser-exit-test-'));
    try {
        const browser = path.join(root, 'browser');
        const driver = path.join(root, 'driver.cjs');
        fs.writeFileSync(browser, '#!/bin/sh\nprintf "fixture display unavailable\\n" >&2\nkill -TERM $$\n', {mode: 0o755});
        const harness = path.join(__dirname, 'community_browser.cjs');
        fs.writeFileSync(driver, `require(${JSON.stringify(harness)})({}, async () => {
            throw Error('an exited browser must not run the fixture');
        }).catch(error => { console.error(error); process.exitCode = 1; });`);
        const result = spawnSync(process.execPath, [driver, browser, '--webengine'], {
            encoding: 'utf8', timeout: 3000,
            env: {...process.env, TMPDIR: root, TMP: root, TEMP: root}
        });
        assert.equal(result.error, undefined, 'signal exit must finish before the outer test timeout');
        assert.equal(result.status, 1);
        assert.match(result.stderr, /SIGTERM/);
        assert.match(result.stderr, /fixture display unavailable/);
        assert.deepEqual(fs.readdirSync(root).sort(), ['browser', 'driver.cjs'], 'isolated browser profile was removed');
    } finally {
        fs.rmSync(root, {recursive: true, force: true});
    }
});
