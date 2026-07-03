import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function read(path) {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

describe('admin split UI contract', () => {
  it('keeps the new admin UI shell and restores old VIP workflows inside it', () => {
    const app = read('apps/admin/src/App.jsx');
    const css = read('apps/admin/src/App.css');

    for (const label of [
      'Tổng quan',
      'Người dùng',
      'Gói VIP',
      'Tính năng trong gói',
      'Điều khoản 18+',
      'Nhật ký',
      'Nâng cao',
      'Cấp VIP 30 ngày',
      'Cấp VIP 90 ngày',
      'Cấp trọn đời',
      'Hủy gói hiện tại',
      'Hủy gói đã đặt lịch',
      'Tự kiểm tra quyền',
      'Tải lại quyền',
    ]) {
      expect(app).toContain(label);
    }

    for (const label of [
      'Chỉnh nội dung trang VIP',
      'Giá VIP',
      'Đoạn giới thiệu',
      'Thông báo thanh toán',
      'Xem trước trên trang tài khoản',
      'Lưu nội dung VIP',
    ]) {
      expect(app).toContain(label);
    }

    expect(app).toContain('admin-sidebar');
    expect(app).toContain('topbar');
    expect(app).toContain('metric-grid');
    expect(app).toContain('split-layout');
    expect(app).toContain('detail-panel');
    expect(css).toContain('.quick-actions');
    expect(css).toContain('.access-check-list');
    expect(css).toContain('.vip-settings-grid');
    expect(css).toContain('.vip-page-preview');
  });

  it('keeps dedicated user-list filters for role, plan, and status', () => {
    const app = read('apps/admin/src/App.jsx');
    const css = read('apps/admin/src/App.css');

    expect(app).toContain('const [roleFilter');
    expect(app).toContain('const [planFilter');
    expect(app).toContain('const [statusFilter');
    expect(app).toContain('admin-user-filters');
    expect(app).toContain('Lọc vai trò');
    expect(app).toContain('Lọc gói');
    expect(app).toContain('Lọc trạng thái');
    expect(css).toContain('.admin-user-filters');
  });

  it('renders a readable audit and usage workspace for non-technical admins', () => {
    const app = read('apps/admin/src/App.jsx');
    const css = read('apps/admin/src/App.css');

    for (const label of [
      'Nhật ký & hoạt động',
      'Nhật ký quản trị',
      'Hoạt động người dùng',
      'Người thực hiện',
      'Người bị tác động',
      'Hành động',
      'Chi tiết',
      'Trạng thái',
      'Kỹ thuật',
      'Raw JSON',
      'IP',
      'User-agent',
    ]) {
      expect(app).toContain(label);
    }

    for (const sourceContract of [
      'const [activityTab',
      'const [selectedAuditId',
      'audit-detail-drawer',
      'admin-activity-tabs',
      'taskLabel',
      'providerLabel',
      'statusLabel',
    ]) {
      expect(app).toContain(sourceContract);
    }

    for (const className of [
      '.admin-activity-tabs',
      '.audit-detail-drawer',
      '.audit-table__primary',
      '.filter-chip',
      '.technical-json',
    ]) {
      expect(css).toContain(className);
    }
  });

  it('does not expose new plan or feature names in the admin UI source', () => {
    const combined = [
      read('apps/admin/src/App.jsx'),
      read('apps/admin/src/adminApi.js'),
      read('packages/access/src/index.js'),
    ].join('\n');

    expect(combined).not.toMatch(/\bpro\b/u);
    expect(combined).not.toMatch(/\benterprise\b/u);
    expect(combined).not.toContain('ai_writer');
    expect(combined).not.toContain('batch_generation');
    expect(combined).not.toContain('canon_tools');
    expect(combined).not.toContain('corpus_lab');
  });

  it('uses Vietnamese with accents and avoids common mojibake in edited admin files', () => {
    const combined = [
      read('apps/admin/src/App.jsx'),
      read('apps/admin/src/adminApi.js'),
      read('apps/admin-api-worker/src/index.js'),
      read('packages/access/src/index.js'),
      read('packages/access/src/vipPageContent.js'),
    ].join('\n');

    for (const label of [
      'Bạn cần đăng nhập trước khi dùng Admin API.',
      'Tính năng này yêu cầu tài khoản VIP.',
      'Khóa tài khoản',
      'Mở tài khoản',
      'Quyền đang mở',
    ]) {
      expect(combined).toContain(label);
    }

    expect(combined).not.toMatch(/Ă|Æ|áº|á»|â€|Ä|Å|�/u);
  });
});
