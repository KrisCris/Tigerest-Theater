(function () {
    let header, headerResize, headerChanges, frame, disposed=false, savedHeaderHeight=null;
    function restoreHeaderHeight() {
        if (savedHeaderHeight === null) return;
        const root=document.documentElement;
        if (savedHeaderHeight.value) root.style.setProperty('--header-height',savedHeaderHeight.value,savedHeaderHeight.priority);
        else root.style.removeProperty('--header-height');
        savedHeaderHeight=null;
    }
    function measureHeader() {
        frame=null;
        if (disposed || !document.documentElement) return;
        const next=document.querySelector('.skinHeader');
        if (next !== header) {
            headerResize?.disconnect(); header=next;
            if (header && window.ResizeObserver) {
                headerResize=new ResizeObserver(scheduleHeaderMeasure);
                headerResize.observe(header);
            }
        }
        if (!header || !matchMedia('(max-width:600px)').matches) { restoreHeaderHeight(); return; }
        const height=Math.ceil(header.getBoundingClientRect().height);
        if (!height) return;
        const root=document.documentElement;
        if (savedHeaderHeight === null) savedHeaderHeight={value:root.style.getPropertyValue('--header-height'),priority:root.style.getPropertyPriority('--header-height')};
        const value=height+'px';
        if (root.style.getPropertyValue('--header-height') !== value) root.style.setProperty('--header-height',value);
    }
    function scheduleHeaderMeasure() {
        if (!disposed && !frame) frame=requestAnimationFrame(measureHeader);
    }
    function apply() {
        if (!document.documentElement || !document.head) return;
        let viewport = document.querySelector('meta[name="viewport"]');
        if (!viewport) {
            viewport = document.createElement('meta'); viewport.name = 'viewport';
            viewport.content = 'width=device-width,initial-scale=1'; document.head.appendChild(viewport);
        }
        if (!/viewport-fit\s*=\s*cover/i.test(viewport.content)) {
            viewport.content = viewport.content.replace(/,?\s*viewport-fit\s*=\s*[^,]+/ig, '') + ',viewport-fit=cover';
        }
        const safe = window.tigerestWindowMetrics?.safeInsets || {};
        for (const edge of ['top', 'right', 'bottom', 'left']) {
            document.documentElement.style.setProperty('--tgs-safe-' + edge, (safe[edge] || 0) + 'px');
        }
        document.documentElement.dataset.tigerestWindow = innerWidth < 600 ? 'compact' : innerWidth < 840 ? 'medium' : 'expanded';
        if (!headerChanges) {
            headerChanges=new MutationObserver(scheduleHeaderMeasure);
            headerChanges.observe(document.documentElement,{childList:true,subtree:true});
        }
        scheduleHeaderMeasure();
    }
    window.addEventListener('tigerest-window-changed', apply);
    window.addEventListener('resize', apply);
    document.addEventListener('DOMContentLoaded', apply);
    window.addEventListener('pagehide',()=>{
        disposed=true; headerResize?.disconnect(); headerChanges?.disconnect();
        cancelAnimationFrame(frame); restoreHeaderHeight();
        window.removeEventListener('tigerest-window-changed',apply);
        window.removeEventListener('resize',apply);
    },{once:true});
    if (document.readyState !== 'loading') apply();
})();
