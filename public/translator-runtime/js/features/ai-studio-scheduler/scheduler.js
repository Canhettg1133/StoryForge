(function (ns) {
    'use strict';
    ns.createScheduler = ({ parallel, rpm, keys, gate, clock = ns.createClock(), onChange = () => {},
        isPaused = () => false, isCancelled = () => false }) => {
        const limit = ns.normalizeParallel(parallel);
        const allocations = ns.allocate(limit, keys.length, rpm);
        const startedAt = clock.now();
        const lanes = keys.map((key, index) => ({ key, index, limit: allocations[index], inFlight: 0,
            opened: false, opensAt: startedAt + index * ns.STAGGER_MS,
            nextWaveAt: startedAt + index * ns.STAGGER_MS, pendingCommits: 0,
            waveSlots: 0, retrySlots: 0 }));
        const main = [];
        const retries = [];
        const active = new Set();
        let inFlight = 0;
        let cursor = 0;
        let lastWaveSentAt = -Infinity;
        let activeSendingLane = null;
        let stopped = null;
        let scheduled = false;

        function getLaneWaitState(lane, health, now) {
            if (health.disabled) return { reason: 'disabled', waitMs: 0 };
            if (isPaused()) return { reason: 'paused', waitMs: 0 };
            if (activeSendingLane && activeSendingLane !== lane) return { reason: 'previous-wave', waitMs: 0 };
            const ownDeadline = lane.opened ? lane.nextWaveAt : lane.opensAt;
            const crossKeyDeadline = lastWaveSentAt + ns.STAGGER_MS;
            const scheduleWaitMs = Math.max(0, ownDeadline - now, crossKeyDeadline - now);
            const blockers = [
                { reason: lane.opened ? 'wave' : 'stagger', waitMs: scheduleWaitMs },
                { reason: 'rpm', waitMs: health.remaining <= 0 ? health.rpmWaitMs : 0 },
                { reason: 'cooldown', waitMs: health.cooldownMs },
            ];
            return blockers.reduce((longest, blocker) => blocker.waitMs > longest.waitMs ? blocker : longest,
                { reason: 'ready', waitMs: 0 });
        }
        function snapshot() {
            const now = clock.now();
            const laneHealth = lanes.map(lane => gate.health(lane.key));
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
        function releaseActiveWaveIfDone(lane) {
            if (activeSendingLane !== lane || lane.pendingCommits > 0) return;
            if (lane.waveSlots <= 0 || lane.inFlight <= 0) {
                lane.waveSlots = 0; lane.retrySlots = 0; activeSendingLane = null;
            }
        }
        function dispatch(lane, job) {
            const lease = gate.reserve(lane.key, job.kind);
            if (!lease) return false;
            inFlight += 1; lane.inFlight += 1; lane.pendingCommits += 1;
            const commit = lease.commit;
            let committed = false;
            let pendingCommitReleased = false;
            let deferredForPause = false;
            const releasePendingCommit = () => {
                if (pendingCommitReleased) return;
                pendingCommitReleased = true;
                lane.pendingCommits = Math.max(0, lane.pendingCommits - 1);
                releaseActiveWaveIfDone(lane);
            };
            lease.commit = () => {
                if (stopped || isCancelled()) throw ns.cancelledError();
                if (isPaused() && !committed) { deferredForPause = true; throw new Error('AI_STUDIO_ATTEMPT_PAUSED'); }
                commit();
                if (!committed) {
                    const sentAt = clock.now();
                    lane.opened = true;
                    lastWaveSentAt = Math.max(lastWaveSentAt, sentAt);
                    lane.nextWaveAt = Math.max(lane.nextWaveAt, sentAt + ns.WINDOW_MS);
                    committed = true;
                    releasePendingCommit();
                }
            };
            const task = Promise.resolve().then(() => {
                if (stopped) throw stopped;
                return job.run(lease);
            }).then(job.resolve, error => {
                if (deferredForPause && !committed && !stopped && !isCancelled()) {
                    (job.kind === 'main' ? main : retries).unshift(job);
                    cursor = lane.index;
                } else { gate.fail(lane.key, error); job.reject(error); }
            }).finally(() => {
                if (!committed) releasePendingCommit();
                lease.release(); inFlight -= 1; lane.inFlight -= 1; releaseActiveWaveIfDone(lane); wake();
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
            const laneHealth = lanes.map(lane => gate.health(lane.key));
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
                    if (health.disabled || health.cooldownMs > 0 || health.remaining <= 0) continue;
                    if (!main.length && !retries.length) break;
                    const continuingWave = activeSendingLane === lane && lane.waveSlots > 0;
                    let openedWave = false;
                    if (!continuingWave) {
                        const ownDeadline = lane.opened ? lane.nextWaveAt : lane.opensAt;
                        if (lane.pendingCommits > 0 || now < ownDeadline || now < lastWaveSentAt + ns.STAGGER_MS
                            || activeSendingLane) continue;
                        const waveLimit = Math.min(lane.limit - lane.inFlight, health.remaining, limit - inFlight);
                        if (waveLimit <= 0) continue;
                        lane.waveSlots = waveLimit;
                        lane.retrySlots = Math.min(retries.length, waveLimit);
                        activeSendingLane = lane;
                        openedWave = true;
                    }
                    let dispatched = 0;
                    while (lane.waveSlots > 0 && inFlight < limit && lane.inFlight < lane.limit) {
                        const queue = lane.retrySlots > 0 && retries.length ? retries : main;
                        if (!queue.length) break;
                        const job = queue[0];
                        if (!dispatch(lane, job)) break;
                        queue.shift(); lane.waveSlots -= 1;
                        if (queue === retries) lane.retrySlots -= 1;
                        dispatched += 1; cursor = (index + 1) % lanes.length;
                    }
                    if (openedWave && dispatched === 0 && lane.pendingCommits === 0) {
                        lane.waveSlots = 0; lane.retrySlots = 0; activeSendingLane = null;
                    } else releaseActiveWaveIfDone(lane);
                    if (dispatched > 0) break;
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
