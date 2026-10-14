// rAF scheduling metrics, not a count of physically presented display frames.
function frameMetrics(intervals, targetHz) {
    if (!Number.isFinite(targetHz) || targetHz <= 0
        || intervals.some(v => !Number.isFinite(v) || v <= 0)) {
        throw new RangeError('positive frame intervals and target refresh rate required');
    }
    const budgetMs = 1000/targetHz;
    const sorted = [...intervals].sort((a,b)=>a-b);
    const percentile = p => sorted.length ? sorted[Math.ceil(sorted.length*p)-1] : null;
    const totalMs = intervals.reduce((a,b)=>a+b,0);
    const callbackFps = totalMs ? intervals.length*1000/totalMs : null;
    return {
        samples:intervals.length,targetHz,budgetMs,callbackFps,
        p50Ms:percentile(.5),p95Ms:percentile(.95),maxMs:sorted.at(-1)??null,
        // Half a refresh of tolerance allows normal scheduling jitter, but
        // still counts a repeated/missed refresh as a hitch.
        overBudgetFrames:intervals.filter(v=>v>budgetMs*1.5).length,
        estimatedMissedRefreshes:intervals.reduce((n,v)=>n+Math.max(0,Math.round(v/budgetMs)-1),0),
        overproducing:callbackFps!==null && callbackFps>targetHz*1.1,
    };
}
module.exports = {frameMetrics};
