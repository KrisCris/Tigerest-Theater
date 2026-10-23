// Prototype: poster transitions that run the route, the flight and the cover in
// parallel. Same poster() options as native/homeTransitions.js.
//
// The current renderer covers the old page with a blurred copy of itself
// (prewarmed worker raster or DOM clone), waits for the cover, then the route,
// then a quiet page, and only then flies the poster: the stages add up.
// Here the click starts all of them at once:
//   - the cover is the poster's own artwork drawn into a tiny canvas and scaled
//     up (a free blur), so nothing has to be prepared or invalidated;
//   - the poster flies at once to where its target was last time (detail
//     posters sit at the same place for a viewport; a return lands on the card
//     it left), and is retargeted mid-flight if the real target differs;
//   - the cover lifts as soon as the new page is ready and the poster is close
//     to landing, so the total is the longest stage, not their sum.
(function () {
    'use strict';
    window.TigerestHomeTransitionsNext?.dispose?.();
    const box = node => node?.getBoundingClientRect();
    const usable = node => { const b = box(node); return !!node?.isConnected && b.width > 1 && b.height > 1 && getComputedStyle(node).visibility !== 'hidden'; };
    const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
    const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
    const page = () => Array.from(document.querySelectorAll('.mainAnimatedPage,.page')).filter(node =>
        !node.classList.contains('hide') && usable(node)).at(-1);
    const FLIGHT = 620, COVER_IN = 150, REVEAL = 260, ROUTE_AFTER = 60;
    const ease = 'cubic-bezier(.22,.72,.18,1)', soft = 'cubic-bezier(.4,0,.6,1)';
    // Landing rectangles from earlier transitions, per direction and viewport.
    const landings = new Map(), origins = new Map();
    let active = null, last = null;

    const style = document.createElement('style');
    style.textContent = `
      .tgn-input{position:fixed;inset:0;z-index:2147483002;touch-action:none}
      .tgn-cover{position:fixed;inset:0;z-index:2147483000;pointer-events:none;overflow:hidden;background:#0b0d12;contain:strict}
      .tgn-cover canvas{position:absolute;left:-20%;top:-20%;width:140%;height:140%;filter:blur(56px) saturate(.9) brightness(.42)}
      .tgn-cover::after{content:'';position:absolute;inset:0;background:radial-gradient(120% 90% at 30% 40%,transparent,#0b0d12cc)}
      .tgn-poster{position:fixed;z-index:2147483001;pointer-events:none;transform-origin:0 0;background-size:cover;background-position:center;will-change:transform;box-shadow:0 18px 50px #0008}`;
    document.head.append(style);

    function url(node) {
        if (node?.currentSrc || node?.src) return node.currentSrc || node.src;
        const match = /url\((?:"([^"]*)"|'([^']*)'|([^)]*))\)/.exec(node ? getComputedStyle(node).backgroundImage : '');
        return match && (match[1] || match[2] || match[3]);
    }
    const plain = rect => ({x: rect.x, y: rect.y, width: rect.width, height: rect.height});
    const differs = (a, b, px = .5) => ['x','y','width','height'].some(k => Math.abs(a[k] - b[k]) > px);
    const transform = (from, to) => `translate3d(${to.x - from.x}px,${to.y - from.y}px,0) scale(${to.width / from.width},${to.height / from.height})`;

    // Before the destination has ever been seen: a large poster left of centre.
    function guess(from, direction) {
        if (direction === 'return') return from;
        const height = Math.min(innerHeight * .5, 360), width = height * from.width / from.height;
        return {x: Math.max(24, innerWidth * .06), y: Math.max(64, innerHeight * .12), width, height};
    }
    function ambience(source) {
        // 16x24 pixels of the artwork, scaled to the screen by the compositor.
        const canvas = document.createElement('canvas'); canvas.width = 16; canvas.height = 24;
        try { if (source.tagName === 'IMG' && source.complete) canvas.getContext('2d').drawImage(source, 0, 0, 16, 24); } catch {}
        return canvas;
    }
    async function settle(job, target, limit) {
        // A short look for the page to stop changing, never longer than `limit`:
        // the flight is already running, so this only times the reveal.
        const begin = performance.now();
        let changed = begin;
        const observer = new MutationObserver(() => { changed = performance.now(); });
        observer.observe(page() || document.body, {subtree: true, childList: true, attributes: true, attributeFilter: ['src','class','style']});
        while (!job.signal.aborted && performance.now() - begin < limit) {
            await frame();
            const img = target.tagName === 'IMG' ? target : null;
            if ((!img || img.complete) && performance.now() - changed >= 80) break;
        }
        observer.disconnect();
        job.metric.settleMs = performance.now() - begin;
    }
    function clean(job) {
        job.done = true;
        job.animations.forEach(a => a.cancel()); job.layers.forEach(n => n.remove());
        job.held.forEach(({node, value}) => { node.style.visibility = value; });
        if (active === job) active = null;
    }
    function hold(job, node) {
        if (!node || job.held.some(h => h.node === node)) return;
        job.held.push({node, value: node.style.visibility}); node.style.visibility = 'hidden';
    }
    async function run(kind, perform) {
        if (active) return;
        const controller = new AbortController();
        const job = active = {controller, signal: controller.signal, animations: [], layers: [], held: [], start: performance.now(), metric: {kind, engine: 'next'}};
        const input = document.createElement('div'); input.className = 'tgn-input';
        for (const type of ['pointerdown','click','dblclick','wheel','touchmove']) input.addEventListener(type, e => { e.preventDefault(); e.stopPropagation(); }, {passive: false});
        document.body.append(input); job.layers.push(input);
        try { return await perform(job); }
        finally { clean(job); last = {...job.metric, totalMs: performance.now() - job.start}; }
    }
    async function simple(job, navigate) {
        const result = await navigate(); job.metric.fallback = reduced() ? 'reduced-motion' : 'missing-poster'; return result;
    }

    const transitions = {
        get busy() { return !!active; }, get last() { return last; },
        cancel(reason = 'reset') { if (active) { active.controller.abort(reason); clean(active); } },
        dispose() { transitions.cancel(); style.remove(); },
        forget() { landings.clear(); origins.clear(); },
        poster(options) { return run('poster', async job => {
            const {source, navigate, findTarget, direction = 'enter', itemId} = options;
            const artwork = url(source);
            if (reduced() || !usable(source) || !artwork) return simple(job, navigate);
            const from = plain(box(source)), previous = page();
            const key = direction + ':' + innerWidth + 'x' + innerHeight;
            const remembered = direction === 'return' ? origins.get(itemId + ':' + innerWidth + 'x' + innerHeight) : landings.get(key);
            let to = remembered || guess(from, direction);
            job.metric.predicted = !!remembered;

            const cover = document.createElement('div'); cover.className = 'tgn-cover'; cover.append(ambience(source));
            const poster = document.createElement('div'); poster.className = 'tgn-poster';
            Object.assign(poster.style, {left: from.x + 'px', top: from.y + 'px', width: from.width + 'px', height: from.height + 'px',
                backgroundImage: 'url(' + JSON.stringify(artwork) + ')', borderRadius: getComputedStyle(source).borderRadius});
            document.body.append(cover, poster); job.layers.push(cover, poster); hold(job, source);
            const track = a => { job.animations.push(a); a.finished.catch(() => {}); return a; };

            // 1. Everything starts now.
            track(cover.animate([{opacity: 0}, {opacity: 1}], {duration: COVER_IN, easing: soft, fill: 'both'}));
            let flight = track(poster.animate([{transform: 'none'}, {transform: transform(from, to)}], {duration: FLIGHT, easing: ease, fill: 'both'}));
            let landAt = performance.now() + FLIGHT;
            const flightEnd = () => landAt;
            job.metric.posterFirstMotionMs = 0;
            const routed = (async () => {
                await frame(); await new Promise(r => setTimeout(r, ROUTE_AFTER));
                job.metric.routeStartMs = performance.now() - job.start;
                const result = await navigate();
                job.metric.routeDoneMs = performance.now() - job.start;
                return result;
            })();

            // 2. Find the real target and retarget the flight if the guess was off.
            let target = null;
            if (options.prepareTarget) { await routed; if (!usable(findTarget())) await options.prepareTarget(job.signal); }
            const giveUp = performance.now() + 2400;
            while (!job.signal.aborted && performance.now() < giveUp) {
                const node = findTarget();
                if (node && node !== source && page() !== previous && usable(node)) { target = node; break; }
                await frame();
            }
            if (job.signal.aborted) return routed;
            if (!target) {
                job.metric.fallback = 'missing-target';
                await routed;
                await Promise.all([cover, poster].map(n => track(n.animate([{opacity: 1}, {opacity: 0}], {duration: REVEAL, easing: soft, fill: 'both'})).finished.catch(() => {})));
                return routed;
            }
            job.metric.targetFoundMs = performance.now() - job.start;
            if (direction === 'return' && (box(target).bottom > innerHeight || box(target).top < 0)) target.scrollIntoView({block: 'center', inline: 'nearest', behavior: 'instant'});
            hold(job, target);
            const retarget = minimum => {
                const actual = plain(box(target));
                if (!differs(actual, to)) return false;
                const now = getComputedStyle(poster).transform;
                const remaining = Math.max(minimum, flightEnd() - performance.now());
                poster.style.transform = now; flight.cancel(); to = actual; landAt = performance.now() + remaining;
                flight = track(poster.animate([{transform: now}, {transform: transform(from, to)}], {duration: remaining, easing: 'cubic-bezier(.25,.6,.25,1)', fill: 'both'}));
                job.metric.retargets = (job.metric.retargets || 0) + 1;
                return true;
            };
            job.metric.guessErrorPx = Math.max(...['x','y','width','height'].map(k => Math.abs(plain(box(target))[k] - to[k])));
            retarget(240);

            // 3. Reveal when the page has (briefly) settled and the poster is near
            //    its landing; it never waits for a fully quiet page.
            const result = await routed;
            await settle(job, target, 320);
            retarget(180);
            const wait = flightEnd() - performance.now() - REVEAL * .6;
            if (wait > 0) await new Promise(r => setTimeout(r, wait));
            job.metric.revealStartMs = performance.now() - job.start;
            await Promise.all([
                track(cover.animate([{opacity: 1}, {opacity: 0}], {duration: REVEAL, easing: soft, fill: 'both'})).finished.catch(() => {}),
                flight.finished.catch(() => {})
            ]);
            // A late layout change: rejoin the real rectangle before handing over.
            if (retarget(120)) await flight.finished.catch(() => {});
            const landed = plain(box(poster)), actual = plain(box(target));
            job.metric.landingErrorPx = Math.max(...['x','y','width','height'].map(k => Math.abs(landed[k] - actual[k])));
            job.metric.landedMs = performance.now() - job.start;
            landings.set(key, actual);
            if (direction === 'enter' && itemId != null) origins.set(itemId + ':' + innerWidth + 'x' + innerHeight, from);
            return result;
        }); }
    };
    window.TigerestHomeTransitionsNext = transitions;
}());
