import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('Cloudflare preview server policy', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('returns PREVIEW_PROFILE_REQUIRED without inserting a missing profile or Free plan', async () => {
    const insert = vi.fn();
    const supabase = {
      auth: {
        getUser: vi.fn(async () => ({
          data: { user: { id: 'preview-user', email: 'preview@example.com' } },
          error: null,
        })),
      },
      from: vi.fn((table) => ({
        select() {
          return this;
        },
        eq() {
          return this;
        },
        maybeSingle: vi.fn(async () => ({
          data: table === 'profiles' ? null : { id: 'unexpected' },
          error: null,
        })),
        insert,
      })),
    };

    vi.doMock('../../../api/_lib/supabaseAdmin.js', () => ({
      getSupabaseAdminConfig: () => ({ configured: true }),
      getSupabaseAdminClient: () => supabase,
    }));
    const { authenticateRequest } = await import('../../../api/_lib/access-control.js');

    const result = await authenticateRequest(new Request('https://storyforge.test/api/me/access', {
      headers: { Authorization: 'Bearer preview-storyforge-token' },
    }), {
      runtime: { env: { DEPLOYMENT_MODE: 'preview' } },
    });

    expect(result).toMatchObject({
      ok: false,
      status: 409,
      reason: 'PREVIEW_PROFILE_REQUIRED',
    });
    expect(supabase.from).toHaveBeenCalledWith('profiles');
    expect(supabase.from).not.toHaveBeenCalledWith('plans');
    expect(supabase.from).not.toHaveBeenCalledWith('user_plans');
    expect(insert).not.toHaveBeenCalled();
  });
});
