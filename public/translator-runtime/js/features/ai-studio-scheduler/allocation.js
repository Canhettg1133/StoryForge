(function (ns) {
    'use strict';
    ns.allocate = (parallel, keyCount, rpm) => {
        const count = Math.max(0, Math.trunc(Number(keyCount)) || 0);
        if (!count) return [];
        const limit = ns.normalizeParallel(parallel);
        const rate = normalizeTranslatorRpm(rpm);
        // These lanes share the global semaphore; no key is permanently assigned zero.
        if (count > limit) return new Array(count).fill(1);
        return distributeTranslatorWaveAcrossKeys(Math.min(limit, count * rate), count, rate);
    };
})(globalThis.AiStudioScheduler);
