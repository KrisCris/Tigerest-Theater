const assert = require('node:assert/strict');
const test = require('node:test');
const {frameMetrics} = require('./frame_metrics.cjs');
test('120 Hz cadence and a 60 Hz cap are distinguished against the same budget', () => {
    const fast = frameMetrics(Array(120).fill(1000/120), 120);
    const capped = frameMetrics(Array(60).fill(1000/60), 120);
    assert.ok(Math.abs(fast.callbackFps-120)<0.01);
    assert.equal(fast.estimatedMissedRefreshes,0);
    assert.equal(capped.estimatedMissedRefreshes,60);
    assert.equal(capped.overBudgetFrames,60);
});
test('one hitch remains visible even when most intervals are on time', () => {
    const value=frameMetrics([...Array(119).fill(1000/120),50],120);
    assert.equal(value.maxMs,50);
    assert.equal(value.estimatedMissedRefreshes,5);
    assert.equal(value.overBudgetFrames,1);
});
test('unbounded callbacks are flagged and empty samples cannot pass', () => {
    assert.equal(frameMetrics(Array(200).fill(.4),120).overproducing,true);
    assert.equal(frameMetrics([],120).callbackFps,null);
    assert.throws(()=>frameMetrics([0,8],120));
    assert.throws(()=>frameMetrics([8],0));
});
