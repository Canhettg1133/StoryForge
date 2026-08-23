import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAdminApiClient } from './adminApi.js';

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

describe('admin API mutation idempotency', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('reuses the same mutation id after an uncertain VIP extension failure and rotates it after success', async () => {
    const bodies = [];
    vi.stubGlobal('fetch', vi.fn(async (_url, init = {}) => {
      bodies.push(JSON.parse(init.body));
      if (bodies.length === 1) return jsonResponse({ error: 'temporary failure' }, 500);
      return jsonResponse({ ok: true, item: { id: 'vip-row' } });
    }));
    const client = createAdminApiClient({
      baseUrl: 'https://admin-api.storyforge.test',
      getAccessToken: async () => 'token',
    });
    const body = { operation: 'extend', planKey: 'vip', amount: 30, unit: 'day' };

    await expect(client.setUserPlan('user-1', body)).rejects.toThrow();
    await expect(client.setUserPlan('user-1', body)).resolves.toMatchObject({ ok: true });
    await expect(client.setUserPlan('user-1', body)).resolves.toMatchObject({ ok: true });

    expect(bodies[0].mutationId).toMatch(/^[0-9a-f-]{36}$/iu);
    expect(bodies[1].mutationId).toBe(bodies[0].mutationId);
    expect(bodies[2].mutationId).not.toBe(bodies[1].mutationId);
  });

  it('reuses a guide mutation id after failure without changing the caller payload', async () => {
    const bodies = [];
    vi.stubGlobal('fetch', vi.fn(async (_url, init = {}) => {
      bodies.push(JSON.parse(init.body));
      if (bodies.length === 1) return jsonResponse({ error: 'temporary failure' }, 500);
      return jsonResponse({ ok: true, setupGuides: { revision: 2, items: [] } });
    }));
    const client = createAdminApiClient({
      baseUrl: 'https://admin-api.storyforge.test',
      getAccessToken: async () => 'token',
    });
    const body = { expectedRevision: 1, items: [] };

    await expect(client.updateSetupGuides(body)).rejects.toThrow();
    await expect(client.updateSetupGuides(body)).resolves.toMatchObject({ ok: true });

    expect(bodies[0].mutationId).toMatch(/^[0-9a-f-]{36}$/iu);
    expect(bodies[1].mutationId).toBe(bodies[0].mutationId);
    expect(body).toEqual({ expectedRevision: 1, items: [] });
  });
});


