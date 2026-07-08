import { describe, expect, it, vi } from 'vitest';
import {
  clearCloudAutoSyncBackoff,
  getCloudAutoSyncBackoffUntil,
  isCloudAutoSyncBackoffActive,
  noteCloudAutoSyncFailure,
} from '../../components/cloud/CloudAutoSyncAgent.jsx';
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
