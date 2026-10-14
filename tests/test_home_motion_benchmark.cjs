const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('transition benchmark counts work before the first callback', async () => {
    // Execute the actual browser measurement function with a controlled frame
    // clock, rather than relying on a timing-sensitive busy loop in CI.
    const source = fs.readFileSync(path.join(__dirname, 'bench_home_motion.cjs'), 'utf8');
    const measurement = source.slice(source.indexOf('window.measure=async'), source.indexOf('window.heroBusy='));
    let clock = 0, handle = 0;
    const callbacks = new Map();
    const context = {
        window: {}, navigateLog: [], routeDelay: 150, TigerestHomeTransitions: {last: {}},
        performance: {now: () => clock},
        Element: {prototype: {animate() {}}},
        PerformanceObserver: class {static supportedEntryTypes = []; disconnect() {}},
        MessageChannel: class {
            port1 = {};
            port2 = {postMessage: () => this.port1.onmessage()};
        },
        setTimeout: callback => queueMicrotask(callback),
        requestAnimationFrame: callback => {callbacks.set(++handle, callback); return handle;},
        cancelAnimationFrame: id => callbacks.delete(id),
    };
    context.window = context;
    vm.runInNewContext(measurement, context);
    const result = context.measure(() => {clock += 250; return Promise.resolve();});
    // Pre-roll (when present), followed by the delayed first transition frame.
    for (let i = 0; i < 4; i++) {
        await Promise.resolve();
        if (callbacks.size) {
            clock += 1000 / 120;
            const current = [...callbacks.values()]; callbacks.clear();
            current.forEach(callback => callback(clock));
        }
    }
    const sample = await result;
    assert.ok(sample.firstFrameMs >= 250, 'startup latency must remain explicit');
    assert.ok(Math.max(...sample.intervals) >= 250, 'initial stall must enter worst interval and missed-refresh metrics');
    assert.ok(sample.intervals.reduce((sum, value) => sum + value, 0) >= 250);
    assert.equal(sample.frameTimes.length, sample.intervals.length + 1);
    assert.equal(callbacks.size, 0, 'measurement must stop its frame collector');
});
