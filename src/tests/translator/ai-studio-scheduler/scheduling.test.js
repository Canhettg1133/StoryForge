import vm from 'node:vm';
import { afterEach, describe, expect, it } from 'vitest';
import { flush, runtime } from './harness.js';
let r;
afterEach(async () => { await r?.close(); });
describe('Independent key waves', () => {
    it('opens at 0/10/20 and repeats at 65/75/85 seconds', async () => {
        r = runtime(); r.enqueueMany(100); await flush();
        expect(r.counts()).toEqual([15,0,0]);
        await r.advance(9999); expect(r.counts()).toEqual([15,0,0]);
        await r.advance(1); expect(r.counts()).toEqual([15,15,0]);
        await r.advance(10000); expect(r.counts()).toEqual([15,15,15]);
        await r.advance(45000); expect(r.counts()).toEqual([30,15,15]);
        await r.advance(10000); expect(r.counts()).toEqual([30,30,15]);
        await r.advance(10000); expect(r.counts()).toEqual([30,30,30]);
    });
    it('does not refill new chunks from spare RPM between waves', async () => {
        r = runtime({parallel:30}); r.enqueueMany(100); await r.advance(64999);
        expect(r.counts()).toEqual([10,10,10]);
        await r.advance(1); expect(r.counts()).toEqual([20,10,10]);
    });
    it('keeps the global ten-second gap when key eight overlaps the next cycle', async () => {
        r = runtime({parallel:8,rpm:1,count:8}); r.enqueueMany(30); await r.advance(65000);
        expect(r.counts()[0]).toBe(1); expect(r.counts()[7]).toBe(0);
        await r.advance(5000); expect(r.counts()[7]).toBe(1); expect(r.counts()[0]).toBe(1);
        await r.advance(10000); expect(r.counts()[0]).toBe(2);
    });
    it('uses every key when keys outnumber global slots', async () => {
        r = runtime({parallel:2,rpm:1,count:4}); r.enqueueMany(12); await r.advance(30000);
        expect(r.counts()).toEqual([1,1,1,1]);
    });
    it('uses the global wave lock when key cooldowns expire together', async () => {
        r = runtime({parallel:60,rpm:15,count:4}); r.enqueueMany(60); await r.advance(30000);
        expect(r.counts()).toEqual([15,15,15,15]);

        vm.runInContext("apiKeys.forEach((_, keyIndex) => recordModelKeyError('test-model', keyIndex, 70))", r.context);
        const retrySends = [];
        const jobs = Array.from({ length: 60 }, (_, index) => r.scheduler.enqueue({
            kind: 'retry',
            preferredKeyIndex: Math.floor(index / 15),
            run: async lease => {
                lease.commit();
                retrySends.push({ keyIndex: lease.pair.keyIndex, at: r.now });
            },
        }).catch(error => error));
        r.scheduler.wake(); await flush();

        expect(r.scheduler.snapshot().keys.map(key => Math.ceil(key.waitMs / 1000))).toEqual([70,70,70,70]);
        await r.resumeAfter(100000); expect(retrySends.map(send => send.at)).toEqual(Array(15).fill(230000));
        await r.advance(10000); expect(retrySends.map(send => send.at)).toEqual([
            ...Array(15).fill(230000), ...Array(15).fill(240000),
        ]);
        await r.advance(20000); expect(retrySends.map(send => send.at)).toEqual([
            ...Array(15).fill(230000), ...Array(15).fill(240000),
            ...Array(15).fill(250000), ...Array(15).fill(260000),
        ]);
        await Promise.all(jobs);
    });
    it('never leaves a healthy key stuck at a moving ten-second deadline', async () => {
        r = runtime({parallel:3,rpm:15,count:3}); r.enqueueMany(3); await r.advance(20000);
        await r.advance(65000);
        vm.runInContext("for (let count = 0; count < 15; count += 1) recordTranslatorRpmRequest('gemini_direct', 1)", r.context);
        vm.runInContext("recordModelKeyError('test-model', 1, 1); recordModelKeyError('test-model', 2, 1)", r.context);
        r.scheduler.wake(); await flush();
        await r.advance(1000);

        const firstWait = r.scheduler.snapshot().keys[2].waitMs;
        await r.advance(5000);
        const secondWait = r.scheduler.snapshot().keys[2].waitMs;

        expect(secondWait).toBeLessThanOrEqual(Math.max(0, firstWait - 5000));
    });
    it('releases an RPM-ready key without colliding with the key that recovers later', async () => {
        r = runtime({parallel:3,rpm:15,count:3}); r.enqueueMany(3); await r.advance(85000);
        vm.runInContext("for (let count = 0; count < 15; count += 1) recordTranslatorRpmRequest('gemini_direct', 1)", r.context);
        vm.runInContext("recordModelKeyError('test-model', 0, 100); recordModelKeyError('test-model', 1, 1); recordModelKeyError('test-model', 2, 1)", r.context);
        r.enqueueMany(3); await flush();

        await r.advance(1000);
        expect(r.requests.slice(3).map(request => ({ keyIndex: request.keyIndex, at: request.at })))
            .toEqual([{ keyIndex: 2, at: 186000 }]);
        await r.advance(64000);
        expect(r.requests.slice(3).map(request => ({ keyIndex: request.keyIndex, at: request.at }))).toEqual([
            { keyIndex: 2, at: 186000 }, { keyIndex: 1, at: 250000 },
        ]);
        await r.advance(9999); expect(r.requests).toHaveLength(5);
        await r.advance(1);

        const later = r.requests.slice(3);
        expect(later.map(request => ({ keyIndex: request.keyIndex, at: request.at }))).toEqual([
            { keyIndex: 2, at: 186000 }, { keyIndex: 1, at: 250000 }, { keyIndex: 2, at: 260000 },
        ]);
        expect(later[2].at - later[1].at).toBeGreaterThanOrEqual(10000);
        expect(later[2].at - later[0].at).toBeGreaterThanOrEqual(65000);
    });
    it('keeps later waves ten seconds apart when one cooldown collides with the next key', async () => {
        r = runtime({parallel:4,rpm:1,count:4}); r.enqueueMany(8); await r.advance(30000);
        expect(r.requests.map(request => request.at)).toEqual([100000,110000,120000,130000]);

        vm.runInContext("recordModelKeyError('test-model', 0, 45)", r.context);
        r.scheduler.wake(); await flush();
        await r.advance(45000);
        expect(r.requests.slice(4).map(request => ({ keyIndex: request.keyIndex, at: request.at })))
            .toEqual([{ keyIndex: 0, at: 175000 }]);

        await r.advance(30000);
        const laterWaves = r.requests.slice(4);
        expect(laterWaves.map(request => ({ keyIndex: request.keyIndex, at: request.at }))).toEqual([
            { keyIndex: 0, at: 175000 }, { keyIndex: 1, at: 185000 },
            { keyIndex: 2, at: 195000 }, { keyIndex: 3, at: 205000 },
        ]);
        laterWaves.slice(1).forEach((request, index) => {
            expect(request.at - laterWaves[index].at).toBeGreaterThanOrEqual(10000);
        });
        laterWaves.forEach(request => {
            const previous = r.requests.find(entry => entry.keyIndex === request.keyIndex);
            expect(request.at - previous.at).toBeGreaterThanOrEqual(65000);
        });
    });
    it('measures the global gap from the first real send, not from wave allocation', async () => {
        r = runtime({parallel:2,rpm:1,count:2}); r.enqueueMany(2); await r.advance(10000);
        expect(r.requests.map(request => request.at)).toEqual([100000,110000]);

        let releaseFirstWave;
        const waitForSend = new Promise(resolve => { releaseFirstWave = resolve; });
        const laterSends = [];
        const first = r.scheduler.enqueue({ kind: 'main', preferredKeyIndex: 0, run: async lease => {
            await waitForSend;
            lease.commit();
            laterSends.push({ keyIndex: lease.pair.keyIndex, at: r.now });
        }});
        const second = r.scheduler.enqueue({ kind: 'main', preferredKeyIndex: 1, run: async lease => {
            lease.commit();
            laterSends.push({ keyIndex: lease.pair.keyIndex, at: r.now });
        }});

        await r.advance(65000);
        expect(laterSends).toEqual([]);
        releaseFirstWave(); await flush();
        expect(laterSends).toEqual([{ keyIndex: 0, at: 175000 }]);
        await r.advance(9999); expect(laterSends).toHaveLength(1);
        await r.advance(1);
        expect(laterSends).toEqual([
            { keyIndex: 0, at: 175000 }, { keyIndex: 1, at: 185000 },
        ]);
        await Promise.all([first, second]);
    });
    it('starts another key ten seconds after the final real send in the prior key wave', async () => {
        r = runtime({parallel:4,rpm:2,count:2});
        let releaseDelayedSend;
        const waitForSend = new Promise(resolve => { releaseDelayedSend = resolve; });
        const sends = [];
        const jobs = [
            r.scheduler.enqueue({ kind: 'main', run: async lease => {
                await waitForSend;
                lease.commit();
                sends.push({ keyIndex: lease.pair.keyIndex, at: r.now });
            }}),
            r.scheduler.enqueue({ kind: 'main', run: async lease => {
                lease.commit();
                sends.push({ keyIndex: lease.pair.keyIndex, at: r.now });
            }}),
            r.scheduler.enqueue({ kind: 'main', run: async lease => {
                lease.commit();
                sends.push({ keyIndex: lease.pair.keyIndex, at: r.now });
            }}),
        ].map(job => job.catch(error => error));
        await flush();
        expect(sends).toEqual([{ keyIndex: 0, at: 100000 }]);

        await r.advance(20000);
        expect(sends).toHaveLength(1);
        expect(r.scheduler.snapshot().keys[1]).toMatchObject({reason:'previous-wave',waitMs:0});
        releaseDelayedSend(); await flush();
        expect(sends).toEqual([
            { keyIndex: 0, at: 100000 }, { keyIndex: 0, at: 120000 },
        ]);
        await r.advance(9999); expect(sends).toHaveLength(2);
        await r.advance(1);
        expect(sends).toEqual([
            { keyIndex: 0, at: 100000 }, { keyIndex: 0, at: 120000 },
            { keyIndex: 1, at: 130000 },
        ]);
        await Promise.all(jobs);
    });
    it('starts the next key wave 65 seconds after the final real send in its prior wave', async () => {
        r = runtime({parallel:2,rpm:2,count:1});
        let releaseDelayedSend;
        const waitForSend = new Promise(resolve => { releaseDelayedSend = resolve; });
        const sends = [];
        const delayed = r.scheduler.enqueue({ kind: 'main', run: async lease => {
            await waitForSend;
            lease.commit();
            sends.push(r.now);
        }});
        const immediate = r.scheduler.enqueue({ kind: 'main', run: async lease => {
            lease.commit();
            sends.push(r.now);
        }});
        const nextWave = r.scheduler.enqueue({ kind: 'main', run: async lease => {
            lease.commit();
            sends.push(r.now);
        }});
        await flush();
        expect(sends).toEqual([100000]);

        await r.advance(20000); releaseDelayedSend(); await flush();
        expect(sends).toEqual([100000,120000]);
        await r.advance(64999); expect(sends).toHaveLength(2);
        await r.advance(1); expect(sends).toEqual([100000,120000,185000]);
        await Promise.all([delayed, immediate, nextWave]);
    });
    it('shows the longest real blocker instead of a shorter cooldown', async () => {
        r = runtime({parallel:4,rpm:1,count:4}); r.enqueueMany(4); await r.advance(30000);
        vm.runInContext("recordModelKeyError('test-model', 0, 10)", r.context);
        r.scheduler.wake(); await flush();

        const keyOne = r.scheduler.snapshot().keys[0];
        expect(keyOne.waitMs).toBe(35000);
        expect(keyOne.reason).toBe('wave');
    });
});
