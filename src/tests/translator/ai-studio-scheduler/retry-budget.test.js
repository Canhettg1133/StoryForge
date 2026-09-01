import { afterEach, describe, expect, it } from 'vitest';
import { flush, runtime } from './harness.js';
let r;
afterEach(async () => { await r?.close(); });
describe('Retry shares the real RPM ledger', () => {
    it('holds retry until the next 65-second key wave even when spare RPM exists', async () => {
        r = runtime({parallel:10,rpm:15,count:1}); r.enqueueMany(30); await flush();
        r.enqueue('retry'); await flush();
        expect(r.requests).toHaveLength(10);
        await r.advance(64999); expect(r.requests).toHaveLength(10);
        await r.advance(1);
        expect(r.requests).toHaveLength(20);
        expect(r.requests[10].kind).toBe('retry');
    });
    it('never lets a spare-RPM retry start beside another key wave', async () => {
        r = runtime({parallel:2,rpm:2,count:2}); r.enqueueMany(2); await r.advance(10000);
        expect(r.requests.map(request => ({ keyIndex: request.keyIndex, at: request.at }))).toEqual([
            { keyIndex: 0, at: 100000 }, { keyIndex: 1, at: 110000 },
        ]);

        r.enqueue('retry'); await flush();
        expect(r.requests).toHaveLength(2);
        await r.advance(54999); expect(r.requests).toHaveLength(2);
        await r.advance(1);
        expect(r.requests.slice(2).map(request => ({ keyIndex: request.keyIndex, at: request.at, kind: request.kind })))
            .toEqual([{ keyIndex: 0, at: 165000, kind: 'retry' }]);
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
