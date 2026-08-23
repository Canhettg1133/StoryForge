(function registerTranslatorHanCorrectionRunner(global) {
    'use strict';

    async function run(options = {}) {
        const items = Array.isArray(options.items) ? options.items.slice() : [];
        const requestedParallel = Math.max(1, Number(options.requestedParallel) || 1);
        const getPlan = typeof options.getPlan === 'function'
            ? options.getPlan
            : async ({ remainingChunks }) => ({ capacity: Math.min(requestedParallel, remainingChunks) });
        const correctItem = typeof options.correctItem === 'function'
            ? options.correctItem
            : async item => ({ ok: true, item });
        const shouldCancel = typeof options.shouldCancel === 'function' ? options.shouldCancel : () => false;
        const results = [];
        let cursor = 0;

        while (cursor < items.length && !shouldCancel()) {
            const remainingChunks = items.length - cursor;
            const plan = await getPlan({ requestedParallel, remainingChunks });
            if (shouldCancel()) break;
            const capacity = Math.max(1, Math.min(remainingChunks, Number(plan?.capacity) || 1));
            const wave = items.slice(cursor, cursor + capacity);
            if (typeof options.assignWave === 'function') options.assignWave(wave, plan);
            const waveResults = await Promise.all(wave.map(correctItem));
            results.push(...waveResults);
            cursor += wave.length;
            if (typeof options.onWaveComplete === 'function') {
                options.onWaveComplete({
                    processed: cursor,
                    remaining: items.length - cursor,
                    wave,
                    results: waveResults,
                });
            }
        }

        return {
            processed: cursor,
            results,
            cancelled: shouldCancel(),
        };
    }

    const runner = Object.freeze({ run });
    global.TranslatorCorrectionRunner = runner;
    global.TranslatorHanCorrectionRunner = runner;
}(typeof globalThis !== 'undefined' ? globalThis : self));
