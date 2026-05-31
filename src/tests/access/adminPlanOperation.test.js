import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function read(path) {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

describe('admin plan operations', () => {
  it('uses explicit cancel operations instead of inserting cancelled plan rows', () => {
    const planApi = read('api/admin/users/[id]/plan.js');
    const adminUi = read('src/pages/AdminAccess/AdminAccess.jsx');

    expect(planApi).toContain('cancel_current');
    expect(planApi).toContain('cancel_scheduled');
    expect(planApi).toContain("status === PLAN_STATUSES.CANCELLED");
    expect(planApi).toContain('operation !== PLAN_OPERATIONS.SET');
    expect(adminUi).toContain("submitCancelPlan('cancel_current')");
    expect(adminUi).toContain("submitCancelPlan('cancel_scheduled')");
    expect(adminUi).toContain('Hủy gói hiện tại');
    expect(adminUi).toContain('Hủy gói đã đặt lịch');
  });
});
