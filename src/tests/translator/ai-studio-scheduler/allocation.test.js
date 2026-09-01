import { afterEach, describe, expect, it } from 'vitest';
import { runtime } from './harness.js';
let r;
afterEach(async () => { await r?.close(); });
describe('AI Studio allocation', () => {
    it.each([
        [60, 15, 4, [15, 15, 15, 15]],
        [60, 20, 3, [20, 20, 20]],
        [45, 15, 3, [15, 15, 15]],
        [30, 15, 3, [10, 10, 10]],
        [45, 10, 3, [10, 10, 10]],
    ])('allocates P=%s R=%s across %s keys', (parallel, rpm, keyCount, expected) => {
        r = runtime({parallel,rpm});
        expect(r.ns.allocate(parallel,keyCount,rpm)).toEqual(expected);
    });
    it('keeps remainder deterministic and gives excess keys a non-starving lane', () => {
        r = runtime();
        expect(r.ns.allocate(45,4,15)).toEqual([12,11,11,11]);
        expect(r.ns.allocate(2,4,15)).toEqual([1,1,1,1]);
    });
});
