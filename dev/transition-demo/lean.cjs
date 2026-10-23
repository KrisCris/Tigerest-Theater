'use strict';
// The shipping renderer with its route started at the click, under the cover
// fade. The shipping desktop flow already skips the steady-rectangle and
// quiet-page waits; this variant measured what an earlier route would add.
// On the real Emby client it exposed the sharp new page through the
// half-faded cover (Emby swaps a cached view at once), so it stays a demo.
module.exports = function lean(source) {
    source = source.replace(/\r\n/g, '\n');
    const patch = (from, to) => { if (!source.includes(from)) throw Error('lean patch failed: ' + from.slice(0, 60)); source = source.replace(from, to); };
    patch('window.TigerestHomeTransitions?.dispose?.();', 'window.TigerestHomeTransitionsLean?.dispose?.();');
    patch('window.TigerestHomeTransitions=transitions;', 'window.TigerestHomeTransitionsLean=transitions;');
    patch("settle=touch();",
        "settle=touch();const routed=(async()=>{await new Promise(r=>requestAnimationFrame(r));return options.navigate();})();");
    patch('job.metric.routeStartMs=performance.now()-job.start;\n            const result=await options.navigate();',
        'const result=await routed;');
    return source;
};
