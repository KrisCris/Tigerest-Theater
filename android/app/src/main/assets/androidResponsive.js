(function () {
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
    }
    window.addEventListener('tigerest-window-changed', apply);
    document.addEventListener('DOMContentLoaded', apply);
})();
