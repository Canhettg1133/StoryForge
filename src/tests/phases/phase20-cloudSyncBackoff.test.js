import { describe, expect, it, vi } from 'vitest';
import {
  clearCloudAutoSyncBackoff,
  clearCloudAutoSyncCooldown,
  getCloudAutoSyncBackoffUntil,
  getCloudAutoSyncCooldownUntil,
  isCloudAutoSyncBackoffActive,
  isCloudAutoSyncCooldownActive,
  noteCloudAutoSyncSuccess,
  noteCloudAutoSyncFailure,
} from '../../components/cloud/CloudAutoSyncAgent.jsx';
import {
  releaseCloudSyncLock,
  tryAcquireCloudSyncLock,
} from '../../services/cloud/cloudAutoSyncService.js';
import {
  createSupabaseFetchWithTimeout as createAppSupabaseFetchWithTimeout,
} from '../../services/cloud/supabaseClient.js';
import {
  createSupabaseFetchWithTimeout as createAdminSupabaseFetchWithTimeout,
} from '../../../apps/admin/src/supabase.js';

describe('phase20 cloud sync outage protection', () => {
  it('backs off auto sync after a failed cycle', () => {
    clearCloudAutoSyncBackoff();

    const backoffUntil = noteCloudAutoSyncFailure(1_000, 300_000);

    expect(backoffUntil).toBe(301_000);
    expect(getCloudAutoSyncBackoffUntil()).toBe(301_000);
    expect(isCloudAutoSyncBackoffActive(300_999)).toBe(true);
    expect(isCloudAutoSyncBackoffActive(301_000)).toBe(false);

    clearCloudAutoSyncBackoff();
    expect(isCloudAutoSyncBackoffActive(300_999)).toBe(false);
  });

  it('uses progressive 5m, 10m, and 30m auto sync failure backoff by default', () => {
    clearCloudAutoSyncBackoff();

    expect(noteCloudAutoSyncFailure(1_000)).toBe(301_000);
    expect(noteCloudAutoSyncFailure(301_000)).toBe(901_000);
    expect(noteCloudAutoSyncFailure(901_000)).toBe(2_701_000);

    clearCloudAutoSyncBackoff();
  });

  it('cools down successful auto sync triggers for five minutes', () => {
    clearCloudAutoSyncCooldown();

    const cooldownUntil = noteCloudAutoSyncSuccess(1_000);

    expect(cooldownUntil).toBe(301_000);
    expect(getCloudAutoSyncCooldownUntil()).toBe(301_000);
    expect(isCloudAutoSyncCooldownActive(300_999)).toBe(true);
    expect(isCloudAutoSyncCooldownActive(301_000)).toBe(false);

    clearCloudAutoSyncCooldown();
  });

  it('uses a localStorage lock so multiple tabs do not sync at the same time', () => {
    localStorage.clear();

    expect(tryAcquireCloudSyncLock({ owner: 'tab-a', now: 1_000, ttlMs: 60_000 })).toBe(true);
    expect(tryAcquireCloudSyncLock({ owner: 'tab-b', now: 2_000, ttlMs: 60_000 })).toBe(false);
    expect(tryAcquireCloudSyncLock({ owner: 'tab-a', now: 3_000, ttlMs: 60_000 })).toBe(true);

    releaseCloudSyncLock('tab-b');
    expect(tryAcquireCloudSyncLock({ owner: 'tab-b', now: 4_000, ttlMs: 60_000 })).toBe(false);

    expect(tryAcquireCloudSyncLock({ owner: 'tab-b', now: 62_000, ttlMs: 60_000 })).toBe(true);
    releaseCloudSyncLock('tab-b');
  });

  it.each([
    ['main app', createAppSupabaseFetchWithTimeout],
    ['admin app', createAdminSupabaseFetchWithTimeout],
  ])('aborts %s Supabase requests that hang longer than the configured timeout', async (_label, createFetch) => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn((_input, init = {}) => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => {
        const error = new Error('aborted');
        error.name = 'AbortError';
        reject(error);
      });
    }));
    const timedFetch = createFetch({ fetchImpl, timeoutMs: 100 });

    const request = timedFetch('/auth/v1/token', { method: 'POST' });
    const expectation = expect(request).rejects.toMatchObject({ name: 'AbortError' });
    await vi.advanceTimersByTimeAsync(100);

    await expectation;
    expect(fetchImpl).toHaveBeenCalledWith('/auth/v1/token', expect.objectContaining({
      method: 'POST',
      signal: expect.any(AbortSignal),
    }));
    vi.useRealTimers();
  });
});
