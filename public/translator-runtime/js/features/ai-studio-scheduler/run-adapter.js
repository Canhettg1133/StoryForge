(function (ns) {
    'use strict';
    let runId = 0;
    ns.createRun = parallel => {
        if (ns.activeRun) throw new Error('AI_STUDIO_RUN_ALREADY_ACTIVE');
        const limit = ns.normalizeParallel(parallel);
        const models = getActiveModels();
        const keys = apiKeys.map((key, keyIndex) => ({ key, keyIndex, model: models[0]?.name }))
            .filter(pair => String(pair.key || '').trim() && pair.model);
        const gate = ns.createAttemptGate(keys);
        const controller = new AbortController();
        const previousKeys = new Map();
        let writeTail = Promise.resolve();
        let closed = false;
        const paused = () => isPaused || (typeof hasStoryForgeFeature === 'function' && !hasStoryForgeFeature('translator.access'));
        const scheduler = ns.createScheduler({ parallel: limit, rpm: rpmPerKey, keys, gate,
            isPaused: paused,
            isCancelled: () => cancelRequested || controller.signal.aborted,
            onChange: state => ns.renderStatus?.(state),
        });
        const check = () => {
            if (closed || cancelRequested || controller.signal.aborted) throw ns.cancelledError();
            if (scheduler.error) throw scheduler.error;
        };
        const run = {
            id: ++runId, parallel: limit, scheduler,
            wake: scheduler.wake,
            check,
            async waitWhilePaused() { while (paused()) await run.sleep(100); check(); },
            sleep(ms) {
                return new Promise((resolve, reject) => {
                    const deadline = Date.now() + ms;
                    let timer;
                    const finish = error => {
                        clearTimeout(timer); controller.signal.removeEventListener('abort', abort);
                        if (error) reject(error); else resolve();
                    };
                    const abort = () => finish(ns.cancelledError());
                    const tick = () => {
                        try { check(); } catch (error) { finish(error); return; }
                        if (Date.now() >= deadline) { finish(); return; }
                        timer = setTimeout(tick, Math.min(250, deadline - Date.now()));
                    };
                    controller.signal.addEventListener('abort', abort, { once: true }); tick();
                });
            },
            scheduleAttempt(options, send) {
                try { check(); } catch (error) { return Promise.reject(error); }
                return scheduler.enqueue({ kind: options.kind, preferredKeyIndex: previousKeys.get(options.chunkIndex),
                    run: async lease => {
                        check();
                        previousKeys.set(options.chunkIndex, lease.pair.keyIndex);
                        try {
                            const result = await send(lease.pair, { directSignal: lease.signal, onDirectDispatch: lease.commit, directOnly: true });
                            check();
                            return result;
                        } catch (error) {
                            if (lease.signal.aborted) {
                                if (controller.signal.aborted || cancelRequested) throw ns.cancelledError();
                                throw createTranslatorError('GEMINI_TIMEOUT', { provider: 'Gemini', model: lease.pair.model,
                                    keyIndex: lease.pair.keyIndex, timeoutSeconds: 120, retryable: true });
                            }
                            throw error;
                        }
                    },
                });
            },
            serialWrite(operation) {
                const next = writeTail.then(operation);
                writeTail = next.catch(() => {});
                return next;
            },
            async runChunks(source, execute) {
                const jobs = new Set();
                const readWindow = [];
                let failure = null;
                try {
                    for await (const chunk of source) {
                        check();
                        await run.waitWhilePaused();
                        const entry = { done: false };
                        readWindow.push(entry);
                        const job = Promise.resolve().then(() => execute(chunk, run))
                            .catch(error => { failure = error; run.cancel(); })
                            .finally(() => {
                                entry.done = true; jobs.delete(job);
                                while (readWindow[0]?.done) readWindow.shift();
                            });
                        jobs.add(job);
                        // Completed out-of-order chunks also occupy the read-ahead window.
                        while (jobs.size >= limit || readWindow.length >= 2 * limit) {
                            await Promise.race(jobs); if (failure) throw failure; check();
                        }
                    }
                    await Promise.all(jobs);
                    if (failure) throw failure;
                    check();
                } catch (error) {
                    run.cancel(); await Promise.allSettled(jobs); throw error;
                } finally {
                    await writeTail;
                }
            },
            cancel() { controller.abort(); scheduler.cancel(); },
            async close() {
                run.cancel(); await scheduler.drain(); await writeTail; closed = true; scheduler.dispose();
                if (ns.activeRun === run) ns.activeRun = null;
                ns.finishStatus?.(); ns.refreshSettings?.();
            },
        };
        ns.activeRun = run;
        ns.refreshSettings?.();
        return run;
    };
})(globalThis.AiStudioScheduler);
