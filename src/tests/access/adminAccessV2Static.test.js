import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function read(path) {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

describe('admin access v2 static contracts', () => {
  it('documents auth profile sync with trigger and allows multiple active plans for union access', () => {
    const schema = read('docs/supabase-access-control/001_access_control_schema.sql');

    expect(schema).toContain('handle_new_auth_user_profile');
    expect(schema).toContain('on_auth_user_created_access_profile');
    expect(schema).toContain('auth.users');
    expect(schema).toContain('drop index if exists public.one_active_plan_per_user');
    expect(schema).not.toMatch(/create unique index if not exists one_active_plan_per_user/u);
  });

  it('has a server-only sync-auth admin endpoint with Auth Admin pagination', () => {
    const api = read('api/admin/users/sync-auth.js');
    const client = read('src/services/access/accessClient.js');
    const vite = read('vite.config.js');

    expect(api).toContain('requireAdmin(req)');
    expect(api).toContain('auth.admin.listUsers');
    expect(api).toContain('page');
    expect(api).toContain('perPage');
    expect(api).toContain('system_role');
    expect(api).toContain('status');
    expect(api).not.toContain('VITE_SUPABASE_SERVICE_ROLE');
    expect(client).toContain('syncAdminAuthUsers');
    expect(vite).toContain('/api/admin/users/sync-auth');
  });

  it('separates AdminLayout from the main StoryForge app sidebar', () => {
    const app = read('src/App.jsx');
    const sidebar = read('src/components/common/Sidebar.jsx');
    const adminLayout = read('src/pages/AdminAccess/AdminLayout.jsx');

    expect(app).toContain('AdminLayout');
    expect(app).toContain('path="/admin"');
    expect(sidebar).not.toContain('/admin/access');
    for (const label of ['Tổng quan', 'Người dùng', 'Gói VIP', 'Tính năng trong gói', 'Điều khoản 18+', 'Nhật ký', 'Nâng cao']) {
      expect(adminLayout).toContain(label);
    }
  });

  it('keeps admin pages scrollable inside the locked app root', () => {
    const globalCss = read('src/styles/index.css');
    const adminLayoutCss = read('src/pages/AdminAccess/AdminLayout.css');

    expect(globalCss).toMatch(/body\s*\{[^}]*overflow:\s*hidden/u);
    expect(globalCss).toMatch(/#root\s*\{[^}]*height:\s*100vh[^}]*overflow:\s*hidden/su);
    expect(adminLayoutCss).toMatch(/\.admin-layout\s*\{[^}]*height:\s*100vh[^}]*overflow:\s*hidden/su);
    expect(adminLayoutCss).toMatch(/\.admin-layout-main\s*\{[^}]*min-height:\s*0[^}]*overflow-y:\s*auto/su);
    expect(adminLayoutCss).toContain('-webkit-overflow-scrolling: touch');
  });

  it('keeps the advanced warning compact instead of stretching with grid rows', () => {
    const adminCss = read('src/pages/AdminAccess/AdminAccess.css');

    expect(adminCss).toMatch(/\.admin-access-grid\s*\{[^}]*align-items:\s*start/su);
    expect(adminCss).toMatch(/\.admin-access-panel--warning\s*\{[^}]*grid-column:\s*1\s*\/\s*-1/su);
    expect(adminCss).toMatch(/\.admin-access-panel--warning\s*\{[^}]*align-self:\s*start/su);
  });

  it('supports immutable feature keys and feature plan management from admin UI/API', () => {
    const createApi = read('api/admin/features.js');
    const updateApi = read('api/admin/features/[key].js');
    const adminUi = read('src/pages/AdminAccess/AdminAccess.jsx');

    expect(createApi).toContain('feature.create');
    expect(updateApi).toContain('feature.update');
    expect(updateApi).toContain('FEATURE_KEY_IMMUTABLE');
    expect(adminUi).toContain('Mã kỹ thuật của tính năng');
    expect(adminUi).toContain('Chỉ dùng khi đội kỹ thuật đã thêm tính năng vào hệ thống.');
    expect(adminUi).toContain('Khi tắt, người dùng sẽ không mở được tính năng này');
  });

  it('keeps new access UI copy in Vietnamese with diacritics and no common mojibake', () => {
    const combined = [
      read('src/pages/AdminAccess/AdminAccess.jsx'),
      read('src/pages/AdminAccess/AdminLayout.jsx'),
      read('src/components/access/AccessGate.jsx'),
      read('src/components/access/AccountAccessSummary.jsx'),
      read('src/pages/Login/Login.jsx'),
      read('src/services/access/accessControl.js'),
    ].join('\n');

    for (const text of [
      'copy email và nhắn admin cấp VIP',
      'Tính năng này đang tạm tắt',
      'Bị chặn riêng',
      'Xác nhận tuổi',
      'Quyền tài khoản',
      'Tài khoản & VIP StoryForge',
    ]) {
      expect(combined).toContain(text);
    }

    expect(combined).not.toMatch(/Ä|áº|á»|Æ|Ă/u);
  });

  it('provides a dedicated login and VIP guidance flow for locked features', () => {
    const app = read('src/App.jsx');
    const login = read('src/pages/Login/Login.jsx');
    const loginCss = read('src/pages/Login/Login.css');
    const accessGate = read('src/components/access/AccessGate.jsx');
    const accountSummary = read('src/components/access/AccountAccessSummary.jsx');
    const sidebar = read('src/components/common/Sidebar.jsx');

    expect(app).toContain('path="/login"');
    expect(login).toContain('Tài khoản & VIP StoryForge');
    expect(login).toContain('Copy email rồi nhắn admin cấp VIP cho đúng tài khoản này.');
    expect(login).toContain('Gửi email và nói: cấp VIP cho tài khoản này.');
    expect(login).not.toContain('đồng bộ Cloud Sync');
    expect(login).toContain('signInWithGoogle({ returnPath: returnTo })');
    expect(login).toContain('login-page__quick-flow');
    expect(loginCss).toContain('@media (max-width: 520px)');
    expect(loginCss).toContain('grid-template-columns: 1fr');
    expect(accessGate).toContain('/login?returnTo=');
    expect(accountSummary).toContain('/login?returnTo=');
    expect(sidebar).toContain('Tài khoản & VIP');
  });

  it('refreshes access silently after the first load so admin does not flash the full loading screen', () => {
    const context = read('src/services/access/AccessContext.jsx');

    expect(context).toContain('initialLoadDoneRef');
    expect(context).toContain('silent = false');
    expect(context).toContain('const shouldShowLoading = !silent || !initialLoadDoneRef.current');
    expect(context).toContain("refreshAccess({ token: session?.access_token || '', silent: true })");
  });
});
