import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function read(path) {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

describe('admin plan operations', () => {
  it('uses user_plans rows for grant, cancel current, and cancel scheduled operations', () => {
    const worker = read('apps/admin-api-worker/src/index.js');
    const adminUi = read('apps/admin/src/App.jsx');
    const adminApi = read('apps/admin/src/adminApi.js');

    expect(worker).toContain("USER_PLANS_TABLE = 'user_plans'");
    expect(worker).toContain("operation === 'set'");
    expect(worker).toContain("operation === 'cancel_current'");
    expect(worker).toContain("operation === 'cancel_scheduled'");
    expect(worker).toContain('status: PLAN_STATUSES.CANCELLED');
    expect(worker).not.toContain('plan_updated_at');

    expect(adminUi).toContain('Cấp VIP 30 ngày');
    expect(adminUi).toContain('Cấp VIP 90 ngày');
    expect(adminUi).toContain('Cấp trọn đời');
    expect(adminUi).toContain('Hủy gói hiện tại');
    expect(adminUi).toContain('Hủy gói đã đặt lịch');
    expect(adminApi).toContain('/plan');
    expect(adminApi).toContain('operation');
  });
});
