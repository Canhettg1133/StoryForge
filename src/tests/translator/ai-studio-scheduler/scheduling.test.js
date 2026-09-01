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
    it('does not wait for key eight before key one repeats', async () => {
        r = runtime({parallel:8,rpm:1,count:8}); r.enqueueMany(30); await r.advance(65000);
        expect(r.counts()[0]).toBe(2); expect(r.counts()[7]).toBe(0);
        await r.advance(5000); expect(r.counts()[7]).toBe(1);
    });
    it('uses every key when keys outnumber global slots', async () => {
        r = runtime({parallel:2,rpm:1,count:4}); r.enqueueMany(12); await r.advance(30000);
        expect(r.counts()).toEqual([1,1,1,1]);
    });
});
