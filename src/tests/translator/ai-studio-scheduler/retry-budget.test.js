import { afterEach, describe, expect, it } from 'vitest';
import { flush, runtime } from './harness.js';
let r;
afterEach(async () => { await r?.close(); });
describe('Retry shares the real RPM ledger', () => {
    it('spends spare RPM on retry, never on extra main chunks', async () => {
        r = runtime({parallel:10,rpm:15,count:1}); r.enqueueMany(30); await flush();
        r.enqueue('retry'); await flush();
        expect(r.requests).toHaveLength(11); expect(r.requests.at(-1).kind).toBe('retry');
        await r.advance(64999); expect(r.requests).toHaveLength(11);
    });
    it('dispatches 1 waiting retry + 14 new, not 16 requests', async () => {
        r = runtime({parallel:15,rpm:15,count:1}); r.enqueueMany(40); await flush();
        r.enqueue('retry'); await flush(); expect(r.requests).toHaveLength(15);
        await r.advance(65000);
        expect(r.requests).toHaveLength(30);
        expect(r.requests.slice(15).map(x => x.kind)).toEqual(['retry', ...Array(14).fill('main')]);
    });
    it('retains physical slots for requests older than the RPM window', async () => {
        r = runtime({parallel:15,rpm:15,count:1}); r.enqueue('main',true); r.enqueueMany(40); await flush();
        await r.advance(65000); expect(r.requests).toHaveLength(29);
    });
    it('counts every dispatch at most once and never exceeds the rolling window', async () => {
        r = runtime({parallel:3,rpm:3,count:1}); r.enqueueMany(25); await r.advance(260000);
        for (const request of r.requests) {
            expect(r.requests.filter(x => x.at <= request.at && x.at > request.at - 65000).length).toBeLessThanOrEqual(3);
        }
        expect(r.context.getTranslatorRpmReservationCount('gemini_direct',0)).toBe(0);
    });
});
