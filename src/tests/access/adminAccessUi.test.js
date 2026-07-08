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

function readCssRule(css, selector) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const matches = [...css.matchAll(new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`, 'g'))];
  return matches.at(-1)?.[1] || '';
}


describe('admin split UI contract', () => {
  it('keeps the new admin UI shell and restores old VIP workflows inside it', () => {
    const app = readAdminUi();
    const css = readAdminCss();

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
    const app = readAdminUi();
    const css = readAdminCss();

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
    const app = readAdminUi();
    const css = readAdminCss();

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
    const app = readAdminUi();
    const css = readAdminCss();

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
    const app = readAdminUi();
    const api = read('apps/admin/src/adminApi.js');
    const css = readAdminCss();
    const baseCss = read('apps/admin/src/styles/base.css');

    for (const label of [
      'Hoạt động người dùng',
      'Tất cả hoạt động người dùng',
      'Tìm toàn bộ lịch sử',
      'Provider',
      'Tìm kiếm',
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
      'usage-search-control',
      'usage-control-panel',
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
    expect(css).toContain('.usage-search-control');
    expect(baseCss).toContain('grid-template-columns: minmax(260px, 1.35fr) repeat(auto-fit, minmax(150px, 1fr))');
    expect(readCssRule(baseCss, '.usage-search-control .search-box')).toContain('height: 44px');
  });

  it('imports VIP page normalizers wherever the VIP editor calls them', () => {
    const views = read('apps/admin/src/views/AdminViews.jsx');
    const formatters = read('apps/admin/src/utils/adminFormatters.js');
    const viewAccessImport = views.match(/import\s*\{[\s\S]*?\}\s*from '@storyforge\/access';/)?.[0] || '';
    const formatterAccessImport = formatters.match(/import\s*\{[\s\S]*?\}\s*from '@storyforge\/access';/)?.[0] || '';

    expect(viewAccessImport).toContain('normalizeVipPageContent');
    expect(formatterAccessImport).toContain('normalizeVipPageContent');
    expect(views).toContain('const preview = normalizeVipPageContent(form)');
    expect(formatters).toContain('return normalizeVipPageContent(getPlanMetadata(plan).vipPage)');
  });

  it('keeps VIP ranking lazy-loaded outside the overview hot path', () => {
    const app = readAdminUi();
    const api = read('apps/admin/src/adminApi.js');
    const css = readAdminCss();

    for (const label of [
      'Xếp hạng VIP',
      'Top VIP 30 ngày',
      'Bảng xếp hạng tài khoản VIP',
      'Chưa có dữ liệu VIP phù hợp bộ lọc',
      'Loại việc',
      'Khoảng thời gian',
      'Tất cả việc',
      'Viết truyện',
      'Dịch truyện',
      'Tạo ảnh',
      'VIP + trọn đời',
      'Lần dùng gần nhất',
    ]) {
      expect(app).toContain(label);
    }

    for (const sourceContract of [
      "id: 'vip-ranking', label: 'Xếp hạng VIP'",
      'function VipRankingPanel',
      'vipRanking',
      'loadVipRanking',
      'usageRanking',
      "activeView === 'vip-ranking'",
      "onSelectView('vip-ranking')",
    ]) {
      expect(app).toContain(sourceContract);
    }

    expect(app).not.toContain('loadOverviewRanking');
    expect(app).not.toContain('overviewRanking');
    expect(app).not.toContain('OVERVIEW_VIP_RANKING_LIMIT');
    expect(api).toContain('usageRanking:');
    expect(api).toContain("request(`/usage/ranking?${query.toString()}`)");
    expect(api).toContain("overview: () => request('/overview')");
    expect(app.indexOf("id: 'vip-ranking'")).toBeLessThan(app.indexOf("id: 'usage'"));
    expect(css).toContain('.vip-ranking-page');
    expect(css).toContain('.vip-ranking-filter-grid');
    expect(css).toContain('.vip-ranking-metrics');
    expect(css).toContain('.vip-ranking-table');
  });

  it('keeps admin reload actions scoped and avoids stuck loading states', () => {
    const app = readAdminUi();
    const api = read('apps/admin/src/adminApi.js');

    expect(app).toContain('const refreshActiveView');
    expect(app).toContain("activeView === 'vip-ranking'");
    expect(app).toContain("activeView === 'overview'");
    expect(app).toContain("activeView === 'usage'");
    expect(app).toContain('typeof view === \'string\' ? view : activeView');
    expect(app).toContain('const [usageFilters, setUsageFilters]');
    expect(app).toContain('setUsageFilters(normalizedFilters)');
    expect(app).toContain('...usageFilters');
    expect(app).toContain('onClick={refreshActiveView}');
    expect(app).toContain('onRetry={refreshActiveView}');
    expect(app).not.toContain('onClick={loadAdminData}');
    expect(app).not.toContain('onRetry={loadAdminData}');
    expect(app).not.toContain('Could not load admin session.');
    expect(api).toContain('ADMIN_REQUEST_TIMEOUT_MS');
    expect(api).toContain('Yêu cầu Admin API quá lâu');
  });

  it('keeps the admin sidebar navigation scrollable when menus grow', () => {
    const css = readAdminCss();

    expect(css).toContain('.admin-sidebar nav');
    expect(css).toContain('overflow-y: auto');
    expect(css).toContain('overscroll-behavior: contain');
    expect(css).toContain('.admin-account');
    expect(css).toContain('flex-shrink: 0');
  });

  it('does not show a confusing 0-0 usage range on empty pages', () => {
    const app = readAdminUi();

    expect(app).toContain('usageSummaryText');
    expect(app).toContain('Chưa có hoạt động phù hợp');
    expect(app).not.toContain('Hiển thị ${formatter.format(startRow)}-${formatter.format(endRow)}');
  });

  it('keeps known admin-facing error messages in Vietnamese', () => {
    const combined = [
      readAdminUi(),
      read('apps/admin/src/adminApi.js'),
      read('apps/admin-api-worker/src/index.js'),
      read('apps/admin-api-worker/src/storyMirror/index.js'),
    ].join('\n');

    expect(combined).toContain('Cấu trúc dữ liệu Admin chưa khớp');
    expect(combined).toContain('Không tìm thấy route quản trị Sổ tay truyện.');
    expect(combined).not.toContain('Could not load admin session.');
    expect(combined).not.toContain('Feature tắt');
    expect(combined).not.toContain('Missing STORY_MIRROR_BUCKET binding for Admin API.');
    expect(combined).not.toContain('Mirrored story content was not found in R2.');
    expect(combined).not.toContain('A reason is required before reading raw mirrored story content.');
    expect(combined).not.toContain('Quota must be greater than 0.');
    expect(combined).not.toContain('Retention days must be between 1 and 365.');
    expect(combined).not.toContain('Mirrored project was not found.');
    expect(combined).not.toContain('Mirrored scene was not found.');
    expect(combined).not.toContain('Story Mirror admin route was not found.');
  });

  it('does not expose new plan or feature names in the admin UI source', () => {
    const combined = [
      readAdminUi(),
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
      readAdminUi(),
      read('apps/admin/src/adminApi.js'),
      read('apps/admin-api-worker/src/index.js'),
      read('docs/supabase-access-control/007_usage_user_rankings.sql'),
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
