import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function read(path) {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

const ADMIN_UI_FILES = [
  'apps/admin/src/App.jsx',
  'apps/admin/src/constants/navigation.js',
  'apps/admin/src/constants/adminDefaults.js',
  'apps/admin/src/utils/adminFormatters.js',
  'apps/admin/src/components/ui/AdminPrimitives.jsx',
  'apps/admin/src/layout/AdminShell.jsx',
  'apps/admin/src/views/AdminViews.jsx',
  'apps/admin/src/features/storyMirror/StoryMirrorPage.jsx',
];

const ADMIN_CSS_FILES = [
  'apps/admin/src/App.css',
  'apps/admin/src/styles/base.css',
  'apps/admin/src/styles/shell.css',
  'apps/admin/src/styles/components.css',
  'apps/admin/src/styles/pages.css',
  'apps/admin/src/styles/responsive.css',
  'apps/admin/src/features/storyMirror/storyMirror.css',
];

function readAdminUi() {
  return ADMIN_UI_FILES.map((file) => read(file)).join('\n');
}

function readAdminCss() {
  return ADMIN_CSS_FILES.map((file) => read(file)).join('\n');
}


describe('admin plan operations', () => {
  it('uses user_plans rows for grant, cancel current, and cancel scheduled operations', () => {
    const worker = read('apps/admin-api-worker/src/index.js');
    const adminUi = readAdminUi();
    const adminApi = read('apps/admin/src/adminApi.js');

    expect(worker).toContain("USER_PLANS_TABLE = 'user_plans'");
    expect(worker).toContain("operation === 'set'");
    expect(worker).toContain("operation === 'cancel_current'");
    expect(worker).toContain("operation === 'cancel_scheduled'");
    expect(worker).toContain('status: PLAN_STATUSES.CANCELLED');
    expect(worker).not.toContain('plan_updated_at');

    expect(adminUi).toContain('Cấp VIP 30 ngày');
    expect(adminUi).toContain('Cấp VIP 90 ngày');
    expect(adminUi).toContain("operation: 'extend'");
    expect(adminUi).toContain("unit: 'day'");
    expect(adminUi).toContain('<option value="month">Tháng lịch</option>');
    expect(adminUi).toContain('Gia hạn VIP');
    expect(adminUi).toContain('Cấp trọn đời');
    expect(adminUi).toContain('Hủy gói hiện tại');
    expect(adminUi).toContain('Hủy gói đã đặt lịch');
    expect(adminApi).toContain('/plan');
    expect(adminApi).toContain('operation');
  });
});
