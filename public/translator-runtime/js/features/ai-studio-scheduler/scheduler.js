(function (ns) {
    'use strict';
    ns.createScheduler = ({ parallel, rpm, keys, gate, clock = ns.createClock(), onChange = () => {},
        isPaused = () => false, isCancelled = () => false }) => {
        const limit = ns.normalizeParallel(parallel);
        const allocations = ns.allocate(limit, keys.length, rpm);
        const startedAt = clock.now();
        const lanes = keys.map((key, index) => ({ key, limit: allocations[index], inFlight: 0,
            opened: false, opensAt: startedAt + index * ns.STAGGER_MS,
            nextWaveAt: startedAt + index * ns.STAGGER_MS, waveSlots: 0,
            cooldownUntil: 0, recoveryAt: 0, recoveryPending: false }));
        const main = [];
        const retries = [];
        const active = new Set();
        let inFlight = 0;
        let cursor = 0;
        let lastOpenedAt = -Infinity;
        let lastWaveStartedAt = -Infinity;
        let openingLane = null;
        let waveOpeningLane = null;
        let stopped = null;
        let scheduled = false;

        function readLaneHealth(now) {
            const health = lanes.map(lane => gate.health(lane.key));
            const recovering = [];
            lanes.forEach((lane, index) => {
                if (health[index].disabled) {
                    lane.cooldownUntil = 0; lane.recoveryAt = 0; lane.recoveryPending = false;
                    return;
                }
                if (health[index].cooldownMs > 0) {
                    lane.cooldownUntil = Math.max(lane.cooldownUntil, now + health[index].cooldownMs);
                    lane.recoveryPending = true;
                }
                if (lane.recoveryPending) recovering.push({ lane, index });
                else { lane.cooldownUntil = 0; lane.recoveryAt = 0; }
            });
            recovering.sort((left, right) => left.lane.cooldownUntil - right.lane.cooldownUntil || left.index - right.index);
            let previousRecoveryAt = -Infinity;
            recovering.forEach(({ lane }) => {
                const earliest = Math.max(lane.cooldownUntil,
                    Number.isFinite(previousRecoveryAt) ? previousRecoveryAt + ns.STAGGER_MS : now);
                lane.recoveryAt = Math.max(lane.recoveryAt, earliest);
                previousRecoveryAt = lane.recoveryAt;
            });
            return health;
        }
        function getLaneWaitState(lane, health, now) {
            if (health.disabled) return { reason: 'disabled', waitMs: 0 };
            if (isPaused()) return { reason: 'paused', waitMs: 0 };
            const recoveryWaitMs = Math.max(0, lane.recoveryAt - now);
            const retryWaiting = retries.some(job => job.waitingKeyIndex === lane.key.keyIndex);
            const scheduleDeadline = lane.opened
                ? Math.max(lane.nextWaveAt, lastWaveStartedAt + ns.STAGGER_MS)
                : Math.max(lane.opensAt, lastOpenedAt + ns.STAGGER_MS, lastWaveStartedAt + ns.STAGGER_MS);
            const scheduleWaitMs = lane.waveSlots > 0 || (lane.opened && retryWaiting && health.remaining > 0)
                ? 0 : Math.max(0, scheduleDeadline - now);
            const blockers = [
                { reason: lane.opened ? 'wave' : 'stagger', waitMs: scheduleWaitMs },
                { reason: 'rpm', waitMs: health.remaining <= 0 ? health.rpmWaitMs : 0 },
                { reason: 'cooldown', waitMs: health.cooldownMs },
                { reason: 'restagger', waitMs: recoveryWaitMs },
            ];
            return blockers.reduce((longest, blocker) => blocker.waitMs > longest.waitMs ? blocker : longest,
                { reason: 'ready', waitMs: 0 });
        }
        function snapshot() {
            const now = clock.now();
            const laneHealth = readLaneHealth(now);
            return { inFlight, parallel: limit, paused: isPaused(), pending: main.length,
                keys: lanes.map((lane, index) => {
                    const health = laneHealth[index];
                    const { reason, waitMs } = getLaneWaitState(lane, health, now);
                    return { keyIndex: lane.key.keyIndex, limit: lane.limit, inFlight: lane.inFlight,
                        used: getTranslatorRpmRecentCount(TRANSLATOR_PROVIDERS.GEMINI_DIRECT, lane.key.keyIndex),
                        rpm, retries: retries.filter(job => job.waitingKeyIndex === lane.key.keyIndex).length, reason, waitMs };
                }) };
        }
        function emit() { onChange(snapshot()); }
        function stop(error) {
            if (stopped) return;
            stopped = error; clock.clear(); gate.cancel();
            [...main.splice(0), ...retries.splice(0)].forEach(job => job.reject(error));
            emit();
        }
        function wake() {
            if (scheduled || stopped) return;
            scheduled = true;
            Promise.resolve().then(() => { scheduled = false; pump(); }).catch(stop);
        }
        function dispatch(lane, job, partOfWave) {
            const lease = gate.reserve(lane.key, job.kind);
            if (!lease) return false;
            if (partOfWave) lane.waveSlots -= 1;
            inFlight += 1; lane.inFlight += 1;
            const commit = lease.commit;
            let committed = false;
            let deferredForPause = false;
            lease.commit = () => {
                if (stopped || isCancelled()) throw ns.cancelledError();
                if (isPaused() && !committed) { deferredForPause = true; throw new Error('AI_STUDIO_ATTEMPT_PAUSED'); }
                commit();
                const sentAt = clock.now();
                if (!lane.opened) {
                    lane.opened = true; lastOpenedAt = sentAt; openingLane = null;
                }
                if (lane.recoveryPending && sentAt >= lane.recoveryAt) {
                    lane.cooldownUntil = 0; lane.recoveryAt = 0; lane.recoveryPending = false;
                }
                if (!committed && partOfWave) {
                    if (waveOpeningLane === lane) { lastWaveStartedAt = sentAt; waveOpeningLane = null; }
                    lane.nextWaveAt = Math.max(lane.nextWaveAt, sentAt + ns.WINDOW_MS);
                }
                committed = true;
            };
            const task = Promise.resolve().then(() => {
                if (stopped) throw stopped;
                return job.run(lease);
            }).then(job.resolve, error => {
                if (deferredForPause && !committed && !stopped && !isCancelled()) {
                    (job.kind === 'main' ? main : retries).unshift(job);
                } else { gate.fail(lane.key, error); job.reject(error); }
            }).finally(() => {
                lease.release(); inFlight -= 1; lane.inFlight -= 1; wake();
                if (!committed && partOfWave) lane.waveSlots += 1;
                if (!committed && !deferredForPause && lane.inFlight === 0 && openingLane === lane) openingLane = null;
                if (!committed && lane.inFlight === 0 && waveOpeningLane === lane) waveOpeningLane = null;
                active.delete(task);
            });
            active.add(task);
            return true;
        }
        function pump() {
            if (stopped) return;
            if (isCancelled()) { stop(ns.cancelledError()); return; }
            clock.clear();
            const now = clock.now();
            const laneHealth = readLaneHealth(now);
            if (lanes.length === 0 || laneHealth.every(health => health.disabled)) {
                stop(createGeminiRotationError('INVALID_API_KEY', 'Không còn API key AI Studio sử dụng được trong lượt dịch này.', { retryable: false }));
                return;
            }
            if (!isPaused()) {
                const first = cursor;
                for (let offset = 0; offset < lanes.length && inFlight < limit; offset += 1) {
                    const index = (first + offset) % lanes.length;
                    const lane = lanes[index];
                    const health = laneHealth[index];
                    if (health.disabled || health.cooldownMs > 0 || lane.recoveryAt > now || health.remaining <= 0) continue;
                    if (!lane.opened && (now < lane.opensAt || now < lastOpenedAt + ns.STAGGER_MS
                        || (openingLane && openingLane !== lane))) continue;
                    if (!main.length && !retries.length) break;
                    if (now >= lane.nextWaveAt || (!lane.opened && lane.waveSlots <= 0)) {
                        if (now < lastWaveStartedAt + ns.STAGGER_MS
                            || (waveOpeningLane && waveOpeningLane !== lane)) continue;
                        lane.waveSlots = Math.min(lane.limit - lane.inFlight, health.remaining, limit - inFlight);
                        if (lane.waveSlots <= 0) continue;
                        if (!lane.opened) openingLane = lane;
                        waveOpeningLane = lane;
                        lane.nextWaveAt = now + ns.WINDOW_MS;
                    }
                    while (inFlight < limit && lane.inFlight < lane.limit) {
                        const queue = retries.length ? retries : lane.waveSlots > 0 ? main : [];
                        if (!queue.length) break;
                        const job = queue[0];
                        if (!dispatch(lane, job, lane.waveSlots > 0)) break;
                        queue.shift(); cursor = (index + 1) % lanes.length;
                    }
                }
            }
            emit();
            // One bounded heartbeat also observes pause/cancel and cooldown changes made by legacy helpers.
            if (main.length || retries.length || inFlight) clock.arm(now + 250);
        }
        const scheduler = {
            enqueue(options) {
                if (stopped) return Promise.reject(stopped);
                return new Promise((resolve, reject) => {
                    const kind = options.kind || 'main';
                    const waitingLane = lanes.find(lane => lane.key.keyIndex === options.preferredKeyIndex)
                        || lanes[cursor];
                    (kind === 'main' ? main : retries).push({ ...options, kind, resolve, reject,
                        waitingKeyIndex: waitingLane?.key.keyIndex });
                    wake();
                });
            },
            snapshot, wake,
            drain: () => Promise.allSettled([...active]),
            get error() { return stopped; },
            cancel() { stop(ns.cancelledError()); },
            dispose() { stop(ns.cancelledError()); clock.dispose(); },
        };
        clock.setWake(wake);
        return scheduler;
    };
})(globalThis.AiStudioScheduler);
