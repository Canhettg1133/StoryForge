import vm from 'node:vm';
import { afterEach, describe, expect, it } from 'vitest';
import { flush, runtime } from './harness.js';
let r;
afterEach(async () => { await r?.close(); });
describe('Scheduler lifecycle', () => {
    it('keeps first actual key sends staggered after an unsent pause',async()=>{
        r=runtime({parallel:2,rpm:1,count:2});let paused=false, prepare;
        const sends=[];
        const scheduler=r.ns.createScheduler({parallel:2,rpm:1,keys:r.keys,gate:r.gate,isPaused:()=>paused});
        const jobs=[0,1].map(()=>scheduler.enqueue({run:async lease=>{
            if(!prepare)await new Promise(resolve=>{prepare=resolve;});
            lease.commit();sends.push({key:lease.pair.keyIndex,at:r.now});
        }}).catch(e=>e));
        await flush();paused=true;prepare();await flush();await r.advance(20000);
        paused=false;scheduler.wake();await flush();
        expect(sends).toHaveLength(1);expect(sends[0].key).toBe(0);
        await r.advance(10000);await Promise.all(jobs);expect(sends[1].at-sends[0].at).toBeGreaterThanOrEqual(10000);
        scheduler.dispose();
    });
    it('requeues an unsent lease when pause occurs after reservation',async()=>{
        r=runtime({parallel:1,count:1});let paused=false, calls=0, prepare;
        const scheduler=r.ns.createScheduler({parallel:1,rpm:15,keys:r.keys,gate:r.gate,isPaused:()=>paused});
        const job=scheduler.enqueue({run:async lease=>{
            if(!prepare)await new Promise(resolve=>{prepare=resolve;});
            lease.commit();calls++;
        }}).catch(error=>error);
        await flush();paused=true;prepare();await flush();
        expect(calls).toBe(0);expect(r.context.getTranslatorRpmReservationCount('gemini_direct',0)).toBe(0);
        paused=false;scheduler.wake();await flush();
        expect(await job).toBeUndefined();expect(calls).toBe(1);scheduler.dispose();
    });
    it('cancels pending and in-flight attempts without refunding sent RPM', async () => {
        r = runtime({parallel:1,rpm:1,count:1}); r.enqueueMany(5,'main',true); await flush();
        r.scheduler.cancel(); await flush();
        expect(r.context.getTranslatorRpmRecentCount('gemini_direct',0)).toBe(1);
        expect(r.context.getTranslatorRpmReservationCount('gemini_direct',0)).toBe(0);
        await r.advance(130000); expect(r.requests).toHaveLength(1);
    });
    it('releases an unsent reservation after a preparation error', async () => {
        r = runtime({parallel:1,count:1});
        await expect(r.scheduler.enqueue({run:async () => { throw new Error('prepare'); }})).rejects.toThrow('prepare');
        await flush();
        expect(r.context.getTranslatorRpmRecentCount('gemini_direct',0)).toBe(0);
        expect(r.context.getTranslatorRpmReservationCount('gemini_direct',0)).toBe(0);
    });
    it('does not let a cooling key block another key', async () => {
        r = runtime({parallel:2,rpm:1,count:2});
        vm.runInContext("recordModelKeyError('test-model',0,90)",r.context);
        r.enqueueMany(8); await r.advance(10000);
        expect(r.counts()).toEqual([0,1]);
    });
    it('releases a partially filled wave when its key enters cooldown', async () => {
        r = runtime({parallel:4,rpm:2,count:2});
        let releaseFirst;
        const holdFirst = new Promise(resolve => { releaseFirst = resolve; });
        const sends = [];
        const first = r.scheduler.enqueue({kind:'main',run:async lease=>{
            lease.commit();sends.push({key:lease.pair.keyIndex,at:r.now});
            vm.runInContext(`recordModelKeyError('test-model',${lease.pair.keyIndex},90)`,r.context);
            await holdFirst;
        }}).catch(error=>error);
        await flush();
        const second = r.scheduler.enqueue({kind:'main',run:async lease=>{
            lease.commit();sends.push({key:lease.pair.keyIndex,at:r.now});
        }}).catch(error=>error);
        await flush();
        expect(sends).toEqual([{key:0,at:100000}]);

        releaseFirst();await flush();
        await r.advance(9999);expect(sends).toHaveLength(1);
        await r.advance(1);
        expect(sends).toEqual([{key:0,at:100000},{key:1,at:110000}]);
        await Promise.all([first,second]);
    });
    it('terminates when every key is permanently invalid', async () => {
        r = runtime({parallel:1,count:1});
        r.gate.fail(r.keys[0],{code:'INVALID_API_KEY'});
        await expect(r.enqueue()).rejects.toMatchObject({retryable:false});
    });
    it('pauses the actual run and preserves its RPM across resume', async () => {
        r = runtime({parallel:1,rpm:1,count:1}); r.load('js/features/ai-studio-scheduler/run-adapter.js');
        const run = r.ns.createRun(1);
        vm.runInContext('isPaused = true',r.context);
        const job = run.scheduleAttempt({kind:'main'},async (pair, options) => { options.onDirectDispatch(); return pair.keyIndex; });
        await r.advance(65000); expect(r.context.getTranslatorRpmRecentCount('gemini_direct',0)).toBe(0);
        vm.runInContext('isPaused = false',r.context); run.wake(); await flush();
        expect(await job).toBe(0); expect(r.context.getTranslatorRpmRecentCount('gemini_direct',0)).toBe(1);
        await run.close(); expect(r.ns.activeRun).toBeNull();
    });
});
