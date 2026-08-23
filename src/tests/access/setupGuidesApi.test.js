import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSetupGuidesWebHandler } from '../../../api/_web/public-content.js';
import {
  clearSetupGuidesClientCacheForTests,
  getSetupGuides,
} from '../../../src/features/setupGuides/setupGuidesClient.js';

function responseConfig(revision = 2) {
  return {
    ok: true,
    source: 'database',
    setupGuides: {
      revision,
      items: [{ id: 'direct', label: 'Direct', url: '/guide', icon: 'book' }],
    },
  };
}

describe('public setup guides API', () => {
  afterEach(() => {
    clearSetupGuidesClientCacheForTests();
    localStorage.clear();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('filters disabled/private fields and sends a five-minute shared cache policy', async () => {
    const handler = createSetupGuidesWebHandler({
      fetchSetupGuides: async () => ({
        key: 'setup_guides',
        revision: 4,
        value_json: {
          privateNote: 'hidden',
          items: [
            { id: 'one', label: 'One', url: '/guide', icon: 'book', enabled: true, token: 'hidden' },
            { id: 'two', label: 'Two', url: '/guide/proxy', icon: 'book', enabled: false },
          ],
        },
      }),
    });

    const response = await handler(new Request('https://storyforge.test/api/setup-guides'));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toContain('s-maxage=300');
    expect(response.headers.get('Cache-Control')).not.toContain('stale-while-revalidate');
    expect(payload.setupGuides).toEqual({
      revision: 4,
      items: [{ id: 'one', label: 'One', url: '/guide', icon: 'book' }],
    });
    expect(JSON.stringify(payload)).not.toContain('hidden');
  });

  it('coalesces concurrent server reads and serves the fresh server cache', async () => {
    let releaseFetch;
    const fetchSetupGuides = vi.fn(() => new Promise((resolve) => {
      releaseFetch = () => resolve({
        key: 'setup_guides',
        revision: 9,
        value_json: { items: [{ id: 'direct', label: 'Direct', url: '/guide', enabled: true, icon: 'book' }] },
      });
    }));
    const handler = createSetupGuidesWebHandler({ fetchSetupGuides, now: () => 1_000 });
    const request = new Request('https://storyforge.test/api/setup-guides');

    const first = handler(request);
    const second = handler(request);
    expect(fetchSetupGuides).toHaveBeenCalledTimes(1);
    releaseFetch();

    const [firstResponse, secondResponse] = await Promise.all([first, second]);
    expect((await firstResponse.json()).setupGuides.revision).toBe(9);
    expect((await secondResponse.json()).setupGuides.revision).toBe(9);

    const cachedResponse = await handler(request);
    expect((await cachedResponse.json()).setupGuides.revision).toBe(9);
    expect(fetchSetupGuides).toHaveBeenCalledTimes(1);
  });

  it('refreshes the server cache after the runtime clock moves backwards', async () => {
    let nowMs = 2_000;
    let revision = 2;
    const fetchSetupGuides = vi.fn(async () => ({
      key: 'setup_guides',
      revision: revision++,
      value_json: { items: [{ id: 'direct', label: 'Direct', url: '/guide', enabled: true, icon: 'book' }] },
    }));
    const handler = createSetupGuidesWebHandler({ fetchSetupGuides, now: () => nowMs });
    const request = new Request('https://storyforge.test/api/setup-guides');

    expect((await (await handler(request)).json()).setupGuides.revision).toBe(2);
    nowMs = 1_000;
    expect((await (await handler(request)).json()).setupGuides.revision).toBe(3);
    expect(fetchSetupGuides).toHaveBeenCalledTimes(2);
  });

  it('uses one in-flight request and then serves a fresh local cache', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-23T00:00:00.000Z'));
    let resolveFetch;
    const fetchMock = vi.fn(() => new Promise((resolve) => {
      resolveFetch = () => resolve(new Response(JSON.stringify(responseConfig()), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));
    }));

    const first = getSetupGuides({ fetchImpl: fetchMock });
    const second = getSetupGuides({ fetchImpl: fetchMock });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    resolveFetch();
    await expect(Promise.all([first, second])).resolves.toEqual([
      responseConfig().setupGuides,
      responseConfig().setupGuides,
    ]);

    await expect(getSetupGuides({ fetchImpl: fetchMock })).resolves.toEqual(responseConfig().setupGuides);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('uses a fresh localStorage entry without a network request after memory reset', async () => {
    localStorage.setItem('storyforge.setup-guides.v1', JSON.stringify({
      cachedAt: Date.now(),
      setupGuides: responseConfig(6).setupGuides,
    }));
    clearSetupGuidesClientCacheForTests();
    const fetchMock = vi.fn();

    await expect(getSetupGuides({ fetchImpl: fetchMock })).resolves.toEqual(responseConfig(6).setupGuides);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refreshes a localStorage entry whose timestamp is in the future', async () => {
    localStorage.setItem('storyforge.setup-guides.v1', JSON.stringify({
      cachedAt: 2_000,
      setupGuides: responseConfig(6).setupGuides,
    }));
    clearSetupGuidesClientCacheForTests();
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(responseConfig(7)), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));

    await expect(getSetupGuides({ fetchImpl: fetchMock, now: () => 1_000 })).resolves.toEqual(
      responseConfig(7).setupGuides,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('returns stale safe data when refreshing fails', async () => {
    localStorage.setItem('storyforge.setup-guides.v1', JSON.stringify({
      cachedAt: 1,
      setupGuides: responseConfig(8).setupGuides,
    }));
    const fetchMock = vi.fn().mockRejectedValue(new Error('offline'));

    await expect(getSetupGuides({ fetchImpl: fetchMock, now: () => 999_999_999 })).resolves.toEqual(
      responseConfig(8).setupGuides,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});


