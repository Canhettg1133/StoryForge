import { afterEach, describe, expect, it } from 'vitest';
import { flush, runtime } from './harness.js';
let r;
afterEach(async () => { await r?.close(); });
describe('Streaming adapter and shared write queue', () => {
    it('bounds read-ahead when the earliest chunk is slow', async () => {
        r = runtime({parallel:2}); r.load('js/features/ai-studio-scheduler/run-adapter.js');
        const run = r.ns.createRun(2); let pulled = 0; let release;
        const source = (async function* () { for(let index=0;index<20;index++) { pulled++; yield {index}; } })();
        const job = run.runChunks(source,async chunk => { if(chunk.index===0) await new Promise(resolve => {release=resolve;}); });
        await flush(); expect(pulled).toBeLessThanOrEqual(4);
        release(); await job; expect(pulled).toBe(20); await run.close();
    });
    it('serializes writes and drains before closing', async () => {
        r = runtime(); r.load('js/features/ai-studio-scheduler/run-adapter.js');
        const run = r.ns.createRun(2); const order = []; let release;
        const first = run.serialWrite(async () => { await new Promise(resolve => {release=resolve;}); order.push(1); });
        const second = run.serialWrite(async () => { order.push(2); });
        await flush(); expect(order).toEqual([]);
        release(); await Promise.all([first,second]); await run.close(); expect(order).toEqual([1,2]);
    });
});
