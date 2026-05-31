import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ACCESS_FEATURES, ACCESS_REASONS, PLAN_STATUSES } from '../../services/access/accessControl.js';
import {
  createDefaultPlanForm,
  getAccessDecisionLabel,
  getFeatureDisplayName,
  getPlanStatusLabel,
} from '../../pages/AdminAccess/adminAccessLabels.js';

describe('admin access UI copy', () => {
  it('uses Vietnamese labels with diacritics for the new admin surface', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/pages/AdminAccess/AdminAccess.jsx'), 'utf8');
    const layout = readFileSync(resolve(process.cwd(), 'src/pages/AdminAccess/AdminLayout.jsx'), 'utf8');
    const combined = `${source}\n${layout}`;

    for (const label of ['Tổng quan', 'Người dùng', 'Gói VIP', 'Tính năng trong gói', 'Điều khoản 18+', 'Nhật ký', 'Nâng cao', 'Trung tâm quản lý VIP & quyền truy cập']) {
      expect(combined).toContain(label);
    }
    expect(source).toContain('Tổng quan vận hành');
    expect(source).toContain('Tìm tài khoản, chọn một dòng rồi xử lý nhanh ở panel bên phải.');
    expect(source).toContain('Nhập email hoặc tên người dùng');
    expect(source).toContain('Cập nhật lần cuối');
    expect(source).toContain('Khóa tài khoản');
    expect(source).toContain('Tùy chọn nâng cao');
    expect(source).toContain('Quyền chỉnh riêng');
    expect(source).toContain('Chi tiết kỹ thuật');
    expect(source).toContain('Mã kỹ thuật của tính năng');
    expect(source).toContain('Sửa thông tin tính năng');
    expect(source).toContain('Đang sửa tính năng');
    expect(source).toContain('Mã kỹ thuật đang khóa');
    expect(source).toContain('Tạo tính năng mới');
    expect(source).toContain('Chỉ dùng khi đội kỹ thuật đã thêm tính năng vào hệ thống.');
    expect(source).toContain('Nếu mục tiêu là cấp VIP');
    expect(source).toContain('Cấp VIP 30 ngày');
    expect(source).toContain('Cấp trọn đời');
    expect(source).toContain('admin-access-feature-matrix');
    expect(source).toContain('Áp dụng bộ lọc');
    expect(source).toContain('Đồng bộ user Auth');
    expect(source).not.toContain('Feature key');
    expect(source).not.toContain('Catalog tính năng');
    expect(source).not.toContain('fail closed');
    expect(source).not.toContain('Lọc usage');
    expect(source).not.toContain('Lọc lượt sử dụng');
    expect(source).not.toContain('Cấp override tính năng');
    expect(source).not.toContain('Override riêng');
    expect(source).not.toContain('Lưu override');

    expect(combined).not.toMatch(/Ã|Â|Ä|Æ|áº|á»|Ă|Ð/u);
  });

  it('shows access decisions and form options as Vietnamese labels instead of raw keys', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/pages/AdminAccess/AdminAccess.jsx'), 'utf8');

    expect(source).toContain('getFeatureDisplayName(featureKey)');
    expect(source).toContain('getAccessDecisionLabel(decision)');
    expect(source).toContain('getPlanStatusLabel(status)');
    expect(getFeatureDisplayName(ACCESS_FEATURES.TRANSLATOR_ACCESS)).toBe('Dịch truyện');
    expect(getAccessDecisionLabel({ allowed: false, reason: ACCESS_REASONS.AGE_CONFIRMATION_REQUIRED })).toBe('Cần xác nhận đủ 18 tuổi');
    expect(getPlanStatusLabel(PLAN_STATUSES.ACTIVE)).toBe('Đang hiệu lực');
  });

  it('defaults a newly granted VIP plan to expire after 30 days', () => {
    const form = createDefaultPlanForm(new Date(2026, 4, 26, 10, 15));

    expect(form.planKey).toBe('vip');
    expect(form.status).toBe(PLAN_STATUSES.ACTIVE);
    expect(form.startsAt).toBe('');
    expect(form.expiresAt).toBe('2026-06-25T10:15');
  });
});
