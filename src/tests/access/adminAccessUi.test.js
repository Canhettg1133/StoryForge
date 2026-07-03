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

  it('shows a modern user management workspace with visible VIP expiry and scrollable details', () => {
    const app = read('apps/admin/src/App.jsx');
    const css = read('apps/admin/src/App.css');

    for (const label of [
      'Tổng người dùng',
      'Đang hiển thị',
      'VIP/Trọn đời',
      'Sắp hết hạn',
      'Đang bị khóa',
      'Đang chọn',
      'Đồng bộ Auth',
      'Bộ lọc người dùng',
      'Danh sách người dùng',
      'Chưa có VIP',
      'Hết hạn',
      'Tình trạng gói',
      'Gói hiện tại',
      'Ngày hết hạn',
      'Cập nhật lần cuối',
      'Lịch sử gói gần đây',
      'Chưa có gói VIP đang hoạt động',
      'Thao tác nhanh',
    ]) {
      expect(app).toContain(label);
    }

    for (const sourceContract of [
      'getUserPlanExpiryLabel',
      'getUserPlanStatusTone',
      'user-summary-strip',
      'user-list-scroll',
      'user-plan-card',
      'user-plan-table',
      'user-detail-scroll',
      'user-control-surface',
      'user-control-surface__title',
      'user-filter-grid',
      'user-workspace',
      'user-table-panel',
      'user-table-toolbar',
      'user-selected-stat',
      'user-email-cell',
      'user-expiry-cell',
      'user-updated-cell',
      'user-quick-actions-card',
      'user-plan-history',
      'getUserPlanExpiryShortLabel',
      'getUserManagementStats',
      'isActivePlanExpiringSoon',
    ]) {
      expect(app).toContain(sourceContract);
    }

    for (const className of [
      '.user-summary-strip',
      '.user-list-scroll',
      '.user-detail-scroll',
      '.user-plan-card',
      '.user-plan-table',
      '.user-control-surface',
      '.user-control-surface__title',
      '.user-workspace',
      '.user-table-panel',
      '.user-table-toolbar',
      '.user-selected-stat',
      '.user-email-cell',
      '.user-expiry-cell',
      '.user-updated-cell',
      '.user-quick-actions-card',
      '.user-plan-history',
    ]) {
      expect(css).toContain(className);
    }
    expect(app.indexOf('user-quick-actions-card')).toBeLessThan(app.indexOf('user-plan-card'));
    expect(app).not.toContain('Luồng chính cho vận hành hằng ngày');
    expect(css).toContain('position: sticky');
    expect(css).toContain('min-width: 0;');
    expect(css).toContain('width: 100%;');
    expect(css).toContain('minmax(210px, 1.6fr)');
    expect(css).toContain('min-height: clamp(520px');
  });

  it('renders a readable audit workspace for non-technical admins', () => {
    const app = read('apps/admin/src/App.jsx');
    const css = read('apps/admin/src/App.css');

    for (const label of [
      'Nhật ký quản trị',
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
      'const [selectedAuditId',
      'audit-detail-drawer',
    ]) {
      expect(app).toContain(sourceContract);
    }

    for (const className of [
      '.audit-detail-drawer',
      '.audit-table__primary',
      '.filter-chip',
      '.technical-json',
    ]) {
      expect(css).toContain(className);
    }
  });

  it('separates user activity into its own menu page with server pagination', () => {
    const app = read('apps/admin/src/App.jsx');
    const api = read('apps/admin/src/adminApi.js');
    const css = read('apps/admin/src/App.css');

    for (const label of [
      'Hoạt động người dùng',
      'Tất cả hoạt động người dùng',
      'Tìm toàn bộ lịch sử',
      'Provider',
      'Dòng mỗi trang',
      'Trang',
      'Áp dụng lọc',
      'Tải lại hoạt động',
      'Không tải toàn bộ usage cùng lúc',
    ]) {
      expect(app).toContain(label);
    }

    for (const sourceContract of [
      "id: 'audit', label: 'Nhật ký quản trị'",
      "id: 'usage', label: 'Hoạt động người dùng'",
      'function UsagePanel',
      'usagePagination',
      'usagePageCursors',
      'usage-filter-grid',
      'usage-filter-control',
      'loadUsagePage',
      'setUsagePageSize',
      'hasNextPage',
      'hasPreviousPage',
      'nextCursor',
    ]) {
      expect(app).toContain(sourceContract);
    }

    expect(api).toContain('cursor =');
    expect(api).toContain('knownTotal =');
    expect(api).toContain("query.set('q', q)");
    expect(api).toContain("request(`/usage?${query.toString()}`)");
    expect(app).not.toContain('const [activityTab');
    expect(app).not.toContain('admin-activity-tabs');
    expect(css).toContain('.usage-pagination');
    expect(css).toContain('.usage-page-summary');
    expect(css).toContain('.usage-filter-grid');
    expect(css).toContain('minmax(150px, 1fr)');
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
