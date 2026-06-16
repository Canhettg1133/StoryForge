import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function read(path) {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

describe('split admin access static contracts', () => {
  it('documents the canonical access schema and keeps the newer schema out of the deploy guide', () => {
    const schema = read('docs/supabase-access-control/001_access_control_schema.sql');
    const seed = read('docs/supabase-access-control/002_access_control_seed.sql');
    const deploy = read('docs/ADMIN_SPLIT_DEPLOY.md');

    for (const table of [
      'public.profiles',
      'public.plans',
      'public.user_plans',
      'public.features',
      'public.plan_features',
      'public.user_entitlement_overrides',
      'public.consent_versions',
      'public.admin_audit_logs',
    ]) {
      expect(schema).toContain(table);
    }

    expect(seed).toContain("'free'");
    expect(seed).toContain("'vip'");
    expect(seed).toContain("'lifetime'");
    expect(deploy).toContain('docs/supabase-access-control/001_access_control_schema.sql');
    expect(deploy).not.toContain('docs/supabase-admin-seed.sql');
    expect(`${schema}\n${seed}\n${deploy}`).not.toContain('storyforge_plan_catalog');
  });

  it('keeps Gemini Direct in the access catalog, migration, admin docs, and provider UI mapping', () => {
    const seed = read('docs/supabase-access-control/002_access_control_seed.sql');
    const migration = read('docs/supabase-access-control/004_add_gemini_direct_feature.sql');
    const deploy = read('docs/ADMIN_SPLIT_DEPLOY.md');
    const settings = read('src/pages/Settings/Settings.jsx');

    for (const content of [seed, migration, deploy]) {
      expect(content).toContain('provider.gemini_direct');
    }
    expect(seed).toContain("'provider.gemini_direct'");
    expect(migration).toContain("'provider.gemini_direct'");
    expect(migration).toContain('create or replace function public.bump_all_access_versions()');
    expect(migration).toContain('where true');
    expect(deploy).toContain('docs/supabase-access-control/004_add_gemini_direct_feature.sql');
    expect(settings).toContain('PROVIDERS.GEMINI_DIRECT');
    expect(settings).toContain('ACCESS_FEATURES.GEMINI_DIRECT');
    expect(settings).toContain('PROVIDERS.GEMINI_DIRECT) return ACCESS_FEATURES.GEMINI_DIRECT');
    expect(settings).toContain('AI Studio, dành cho VIP');
    expect(settings).not.toContain('AI Studio (free)');
    expect(settings).not.toContain('free tier');
  });

  it('keeps the root app routes focused on user access while admin UI calls the worker API', () => {
    const app = read('src/App.jsx');
    const sidebar = read('src/components/common/Sidebar.jsx');
    const vite = read('vite.config.js');
    const adminApi = read('apps/admin/src/adminApi.js');

    expect(app).toContain('AccessProvider');
    expect(app).toContain('path="/login"');
    expect(sidebar).toContain('Tài khoản & VIP');
    expect(vite).toContain('/api/me/access');
    expect(vite).toContain('/api/me/adult-consent');
    expect(vite).not.toContain('/api/admin/users');
    expect(adminApi).toContain('VITE_ADMIN_API_BASE_URL');
    expect(adminApi).toContain('/users/sync-auth');
  });

  it('keeps edited access files in Vietnamese with accents and no common mojibake', () => {
    const combined = [
      read('src/components/access/AccessGate.jsx'),
      read('src/components/access/AccountAccessSummary.jsx'),
      read('src/components/support/SupportDonateModal.jsx'),
      read('src/config/supportContact.js'),
      read('src/pages/Dashboard/Dashboard.jsx'),
      read('src/pages/Login/Login.jsx'),
      read('src/services/access/accessControl.js'),
      read('packages/access/src/vipPageContent.js'),
      read('apps/admin/src/App.jsx'),
      read('apps/admin-api-worker/src/index.js'),
    ].join('\n');

    for (const text of [
      'copy email và nhắn admin cấp VIP',
      'Tính năng này đang tạm tắt',
      'Bị chặn riêng',
      'Xác nhận tuổi',
      'Quyền tài khoản',
      'Tài khoản & VIP StoryForge',
      'Hỗ trợ & cộng đồng',
      'Ủng hộ dự án',
      'Quay về',
      'TRAN VAN DAT',
    ]) {
      expect(combined).toContain(text);
    }

    expect(combined).not.toMatch(/Ă|Æ|áº|á»|â€|Ä|Å|�/u);
  });
});
