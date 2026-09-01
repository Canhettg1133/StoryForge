(function (ns) {
    'use strict';
    ns.createClock = (options = {}) => {
        const now = options.now || (() => Date.now());
        const later = options.setTimeout || setTimeout;
        const clear = options.clearTimeout || clearTimeout;
        let timer = null;
        let disposed = false;
        let wake = () => {};
        const clearTimer = () => { if (timer !== null) clear(timer); timer = null; };
        const visible = () => { if (!disposed) wake(); };
        if (typeof document !== 'undefined') document.addEventListener('visibilitychange', visible);
        return {
            now,
            setWake(callback) { wake = callback; },
            arm(deadline) {
                clearTimer();
                if (disposed || !Number.isFinite(deadline)) return;
                timer = later(() => { timer = null; wake(); }, Math.max(1, Math.min(1000, deadline - now())));
            },
            clear: clearTimer,
            dispose() {
                disposed = true; clearTimer();
                if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', visible);
            },
        };
    };
})(globalThis.AiStudioScheduler);
