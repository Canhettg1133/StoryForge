import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Bell,
  BookOpen,
  Check,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Database,
  FileClock,
  Gauge,
  KeyRound,
  LogOut,
  RefreshCw,
  Search,
  Shield,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  UserCog,
  Users,
  Trophy,
  TrendingUp,
  X,
} from 'lucide-react';
import {
  ACCESS_REASONS,
  ADMIN_PERMISSIONS,
  ADMIN_ROLES,
  FEATURE_LABELS_VI,
  PLAN_LABELS_VI,
  ROLE_LABELS_VI,
  STATUS_LABELS_VI,
  createDefaultVipPageContent,
  hasPermission,
  normalizeSiteAnnouncement,
  normalizeVipPageContent,
} from '@storyforge/access';
import { createAdminApiClient } from './adminApi.js';
import { getSupabaseClient, isSupabaseConfigured } from './supabase.js';
import StoryMirrorPage from './features/storyMirror/StoryMirrorPage.jsx';

const NAV_GROUPS = [
  {
    label: 'Vận hành',
    items: [
      { id: 'overview', label: 'Tổng quan', icon: Gauge },
      { id: 'users', label: 'Người dùng', icon: Users },
    ],
  },
  {
    label: 'Gói & quyền',
    items: [
      { id: 'vip', label: 'Gói VIP', icon: Sparkles },
      { id: 'features', label: 'Tính năng trong gói', icon: SlidersHorizontal },
      { id: 'consent', label: 'Điều khoản 18+', icon: ShieldCheck },
    ],
  },
  {
    label: 'Nội dung hệ thống',
    items: [
      { id: 'announcement', label: 'Thông báo', icon: Bell },
      { id: 'story-mirror', label: 'Kho truyện', icon: BookOpen },
    ],
  },
  {
    label: 'Giám sát',
    items: [
      { id: 'audit', label: 'Nhật ký quản trị', icon: FileClock },
      { id: 'vip-ranking', label: 'Xếp hạng VIP', icon: Trophy },
      { id: 'usage', label: 'Hoạt động người dùng', icon: Activity },
      { id: 'advanced', label: 'Nâng cao', icon: Database },
    ],
  },
];

const EMPTY_DATA = {
  users: [],
  catalog: [],
  audit: [],
  usage: [],
  features: [],
  planFeatures: [],
  consent: [],
  announcement: null,
};

const DEFAULT_USAGE_PAGE_SIZE = 100;
const DEFAULT_VIP_RANKING_LIMIT = 20;
const OVERVIEW_VIP_RANKING_LIMIT = 5;

const EMPTY_USAGE_PAGINATION = {
  page: 1,
  pageSize: DEFAULT_USAGE_PAGE_SIZE,
  total: 0,
  totalPages: 0,
  hasNextPage: false,
  hasPreviousPage: false,
};

const EMPTY_USAGE_PAGE_CURSORS = { 1: '' };

const DEFAULT_VIP_RANKING_FILTERS = {
  range: '30d',
  from: '',
  to: '',
  task: 'all',
  plan: 'vip_lifetime',
  provider: 'all',
  status: 'all',
  q: '',
  limit: DEFAULT_VIP_RANKING_LIMIT,
};

const EMPTY_VIP_RANKING = {
  items: [],
  summary: {
    totalUsers: 0,
    totalCount: 0,
    eventCount: 0,
    okCount: 0,
    issueCount: 0,
    lastUsedAt: null,
  },
  filters: DEFAULT_VIP_RANKING_FILTERS,
};

const RANKING_RANGE_OPTIONS = [
  { value: '24h', label: '24 giờ qua' },
  { value: '7d', label: '7 ngày' },
  { value: '30d', label: '30 ngày' },
  { value: '90d', label: '90 ngày' },
  { value: 'this_month', label: 'Tháng này' },
  { value: 'last_month', label: 'Tháng trước' },
  { value: 'all', label: 'Tất cả' },
  { value: 'custom', label: 'Tùy chỉnh' },
];

const RANKING_TASK_OPTIONS = [
  { value: 'all', label: 'Tất cả việc' },
  { value: 'writing', label: 'Viết truyện' },
  { value: 'translation', label: 'Dịch truyện' },
  { value: 'story_chat', label: 'Chat truyện' },
  { value: 'free_chat', label: 'Chat tự do' },
  { value: 'planning', label: 'Lên kế hoạch' },
  { value: 'analysis', label: 'Phân tích' },
  { value: 'image_generation', label: 'Tạo ảnh' },
];

const RANKING_PLAN_OPTIONS = [
  { value: 'vip_lifetime', label: 'VIP + trọn đời' },
  { value: 'vip', label: 'Chỉ VIP' },
  { value: 'lifetime', label: 'Chỉ trọn đời' },
];

const RANKING_LIMIT_OPTIONS = [10, 20, 50];

const DEFAULT_PLAN_FORM = {
  planKey: 'vip',
  status: 'active',
  startsAt: '',
  expiresAt: '',
};

const DEFAULT_OVERRIDE_FORM = {
  featureKey: '',
  enabled: true,
  reason: '',
  expiresAt: '',
};

function formatDate(value) {
  if (!value) return 'Chưa có';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('vi-VN', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date);
}

function formatNumber(value) {
  return new Intl.NumberFormat('vi-VN').format(Number(value) || 0);
}

function isToday(value) {
  if (!value) return false;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  const now = new Date();
  return date.getFullYear() === now.getFullYear()
    && date.getMonth() === now.getMonth()
    && date.getDate() === now.getDate();
}

function addDaysIso(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString();
}

function getUserId(user) {
  return user?.user_id || user?.id || '';
}

function getUserEmail(user) {
  return user?.email || user?.user_email || 'Chưa có email';
}

function getPlanKey(value) {
  if (!value) return 'free';
  if (typeof value === 'string') return value.toLowerCase();
  return String(value.key || value.plan_key || value.plans?.key || 'free').toLowerCase();
}

function getPlanLabel(plan) {
  const key = getPlanKey(plan);
  return PLAN_LABELS_VI[key] || key;
}

function getUserPlans(user) {
  return Array.isArray(user?.user_plans) ? user.user_plans : [];
}

function getPlanTimestamp(plan) {
  const value = plan?.starts_at || plan?.created_at || plan?.expires_at;
  const time = value ? new Date(value).getTime() : 0;
  return Number.isNaN(time) ? 0 : time;
}

function getVisibleUserPlans(user) {
  return [...getUserPlans(user)]
    .sort((left, right) => getPlanTimestamp(right) - getPlanTimestamp(left))
    .slice(0, 5);
}

function getUserPlanStatusLabel(plan) {
  if (!plan) return 'Free';
  const status = String(plan.status || 'active').toLowerCase();
  const expiresAt = plan.expires_at ? new Date(plan.expires_at).getTime() : null;
  if (status === 'active' && expiresAt && expiresAt <= Date.now()) return 'Đã hết hạn';
  if (status === 'active') return 'Đang hiệu lực';
  if (status === 'scheduled') return 'Đã đặt lịch';
  if (status === 'canceled' || status === 'cancelled') return 'Đã hủy';
  return getStatusLabel(status);
}

function getUserPlanStatusTone(plan) {
  if (!plan) return 'neutral';
  const status = String(plan.status || 'active').toLowerCase();
  const expiresAt = plan.expires_at ? new Date(plan.expires_at).getTime() : null;
  if (status === 'active' && expiresAt && expiresAt <= Date.now()) return 'danger';
  if (status === 'active') return 'success';
  if (status === 'scheduled') return 'info';
  if (status === 'canceled' || status === 'cancelled') return 'danger';
  return 'neutral';
}

function getUserPlanExpiryLabel(plan) {
  if (!plan) return 'Chưa có gói VIP đang hoạt động';
  if (!plan.expires_at) return 'Không hết hạn';
  const expiresAt = new Date(plan.expires_at).getTime();
  if (Number.isNaN(expiresAt)) return String(plan.expires_at);
  const label = formatDate(plan.expires_at);
  return expiresAt <= Date.now() ? `Đã hết hạn ${label}` : label;
}

function getUserPlanExpiryShortLabel(plan) {
  if (!plan) return 'Chưa có VIP';
  if (!plan.expires_at) return 'Không hết hạn';
  const expiresAt = new Date(plan.expires_at).getTime();
  if (Number.isNaN(expiresAt)) return String(plan.expires_at);
  const label = formatDate(plan.expires_at);
  return expiresAt <= Date.now() ? `Đã hết hạn ${label}` : label;
}

function isActivePlanExpiringSoon(plan, days = 7) {
  if (!plan?.expires_at) return false;
  const expiresAt = new Date(plan.expires_at).getTime();
  if (Number.isNaN(expiresAt)) return false;
  const now = Date.now();
  return expiresAt > now && expiresAt <= now + (days * 24 * 60 * 60 * 1000);
}

function getUserManagementStats(users) {
  const source = Array.isArray(users) ? users : [];
  return {
    vip: source.filter((user) => ['vip', 'lifetime'].includes(getCurrentUserPlanKey(user))).length,
    expiringSoon: source.filter((user) => isActivePlanExpiringSoon(getActiveUserPlan(user))).length,
    locked: source.filter((user) => String(user.status || 'active').toLowerCase() !== 'active').length,
  };
}

function getRoleLabel(role) {
  return ROLE_LABELS_VI[String(role || 'user').toLowerCase()] || 'Người dùng';
}

function getStatusLabel(status) {
  return STATUS_LABELS_VI[String(status || 'active').toLowerCase()] || String(status || 'active');
}

function getFeatureKey(item) {
  return item?.feature_key || item?.featureKey || item?.key || '';
}

function getFeatureName(data, featureKey) {
  const feature = data.features.find((item) => getFeatureKey(item) === featureKey);
  return feature?.name || FEATURE_LABELS_VI[featureKey] || featureKey;
}

function getPlanFeaturePlanKey(item) {
  return String(item?.plans?.key || item?.plan_key || item?.plan || '').toLowerCase();
}

function getPlanFeatureRows(data, planKey) {
  return data.planFeatures
    .filter((item) => getPlanFeaturePlanKey(item) === String(planKey || '').toLowerCase())
    .sort((left, right) => String(getFeatureKey(left)).localeCompare(String(getFeatureKey(right)), 'vi'));
}

function getActiveUserPlan(user) {
  const plans = getUserPlans(user);
  const now = Date.now();
  return plans
    .filter((item) => String(item.status || '').toLowerCase() === 'active')
    .filter((item) => !item.expires_at || new Date(item.expires_at).getTime() > now)
    .sort((left, right) => new Date(right.starts_at || right.created_at || 0) - new Date(left.starts_at || left.created_at || 0))[0] || null;
}

function getCurrentUserPlanKey(user) {
  return user?.plan || getPlanKey(getActiveUserPlan(user));
}

function summarizeLimits(limits) {
  const source = limits && typeof limits === 'object' ? limits : {};
  const pairs = Object.entries(source).filter(([, value]) => value !== null && value !== undefined && value !== '');
  if (pairs.length === 0) return 'Không giới hạn riêng';
  return pairs
    .slice(0, 3)
    .map(([key, value]) => `${key}: ${value}`)
    .join(' · ');
}

function getPlanMetadata(plan) {
  return plan?.metadata && typeof plan.metadata === 'object' && !Array.isArray(plan.metadata)
    ? plan.metadata
    : {};
}

function getPlanVipPageContent(plan) {
  return normalizeVipPageContent(getPlanMetadata(plan).vipPage);
}

function explainDecision(decision) {
  if (!decision) return 'Chưa tải quyền';
  if (decision.allowed && decision.source === 'plan') {
    return `Mở theo gói ${getPlanLabel(decision.detail)}`;
  }
  if (decision.allowed && decision.source === 'override_grant') {
    return 'Mở bằng cấp riêng';
  }
  if (decision.allowed) return 'Quyền đang mở';

  switch (decision.reason) {
    case ACCESS_REASONS.AUTH_REQUIRED:
      return 'Chưa đăng nhập';
    case ACCESS_REASONS.USER_BANNED:
      return 'Tài khoản đang bị khóa';
    case ACCESS_REASONS.FEATURE_DISABLED:
      return 'Feature tắt';
    case ACCESS_REASONS.OVERRIDE_BLOCKED:
      return 'Bị chặn riêng';
    case ACCESS_REASONS.AGE_CONFIRMATION_REQUIRED:
    case ACCESS_REASONS.ADULT_TERMS_REQUIRED:
    case ACCESS_REASONS.ADULT_TERMS_VERSION_OUTDATED:
      return 'Cần xác nhận 18+';
    default:
      return 'Thiếu VIP hoặc gói chưa mở tính năng';
  }
}

function getIdentityLabel(identity, fallback) {
  if (!identity) return fallback;
  if (identity.email) return identity.email;
  if (identity.displayName) return identity.displayName;
  if (identity.label && identity.label !== identity.id) return identity.label;
  return fallback;
}

function getIdentityMeta(identity) {
  if (!identity) return '';
  const parts = [identity.roleLabel, identity.statusLabel].filter(Boolean);
  return parts.join(' · ');
}

function getAuditActorLabel(item) {
  return getIdentityLabel(item.actor, item.actor_email || 'Không rõ người thực hiện');
}

function getAuditTargetLabel(data, item) {
  if (item.target_user_id) {
    return getIdentityLabel(item.target, item.target_email || 'Không rõ người dùng');
  }
  if (item.target_feature_key) return getFeatureName(data, item.target_feature_key);
  return item.resource_label || 'Hệ thống';
}

function getAuditSummary(item) {
  return item.summary || item.action_summary || item.action || 'Thao tác quản trị';
}

function getAuditDetails(item) {
  return item.details || item.change_summary || 'Chưa có mô tả thay đổi.';
}

function getAuditStatusLabel(item) {
  return item.statusLabel || item.status_label || 'Đã ghi nhận';
}

function getAuditKey(item) {
  return item.id || `${item.action || 'audit'}-${item.created_at || ''}`;
}

function getUsageUserLabel(item) {
  return getIdentityLabel(item.user, item.email || 'Không rõ người dùng');
}

function getUsageTaskLabel(item) {
  return item.taskLabel || item.feature_key || 'Tác vụ AI';
}

function getUsageProviderLabel(item) {
  return item.providerLabel || item.provider || 'Không rõ provider';
}

function getUsageStatusLabel(item) {
  return item.statusLabel || item.status || 'Không rõ';
}

function toPrettyJson(value) {
  try {
    return JSON.stringify(value ?? {}, null, 2);
  } catch {
    return '{}';
  }
}

function Badge({ tone = 'neutral', children }) {
  return <span className={`admin-badge admin-badge--${tone}`}>{children}</span>;
}

function EmptyState({ title, text }) {
  return (
    <div className="empty-state">
      <ClipboardList size={22} />
      <strong>{title}</strong>
      <span>{text}</span>
    </div>
  );
}

function ErrorState({ message, onRetry }) {
  return (
    <div className="error-state">
      <AlertTriangle size={18} />
      <span>{message}</span>
      {onRetry ? (
        <button type="button" className="button button--ghost" onClick={onRetry}>
          <RefreshCw size={15} />
          Tải lại
        </button>
      ) : null}
    </div>
  );
}

function ConfirmDialog({ pending, onCancel, onConfirm }) {
  if (!pending) return null;
  return (
    <div className="modal-backdrop" role="presentation">
      <div className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
        <header>
          <AlertTriangle size={20} />
          <h2 id="confirm-title">{pending.title}</h2>
        </header>
        <p>{pending.message}</p>
        <footer>
          <button type="button" className="button button--ghost" onClick={onCancel}>
            <X size={16} />
            Hủy
          </button>
          <button type="button" className="button button--danger" onClick={onConfirm}>
            <Check size={16} />
            Xác nhận
          </button>
        </footer>
      </div>
    </div>
  );
}

function SetupScreen() {
  return (
    <main className="auth-screen">
      <section className="auth-panel">
        <Shield size={34} />
        <h1>StoryForge Admin</h1>
        <p>Cần cấu hình `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` và `VITE_ADMIN_API_BASE_URL` trước khi mở console quản trị.</p>
      </section>
    </main>
  );
}

function LoginScreen({ onLogin, authError, loading }) {
  return (
    <main className="auth-screen">
      <section className="auth-panel">
        <ShieldCheck size={34} />
        <h1>StoryForge Admin</h1>
        <p>Đăng nhập bằng tài khoản đã được cấp role hỗ trợ, quản trị hoặc chủ sở hữu.</p>
        {authError ? <ErrorState message={authError} /> : null}
        <button type="button" className="button button--primary" onClick={onLogin} disabled={loading}>
          <KeyRound size={17} />
          {loading ? 'Đang mở đăng nhập' : 'Đăng nhập Google'}
        </button>
      </section>
    </main>
  );
}

function AppShell({ actor, activeView, onSelectView, onLogout, children }) {
  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <div className="brand-block">
          <div className="brand-mark">SF</div>
          <div>
            <strong>StoryForge</strong>
            <span>Admin Console</span>
          </div>
        </div>
        <nav aria-label="Admin navigation">
          {NAV_GROUPS.map((group) => (
            <div className="nav-group" key={group.label}>
              <span className="nav-group__label">{group.label}</span>
              {group.items.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    type="button"
                    key={item.id}
                    className={`nav-item ${activeView === item.id ? 'is-active' : ''}`}
                    onClick={() => onSelectView(item.id)}
                  >
                    <Icon size={18} />
                    <span>{item.label}</span>
                    <ChevronRight size={15} />
                  </button>
                );
              })}
            </div>
          ))}
        </nav>
        <div className="admin-account">
          <span>{actor?.email || 'Admin'}</span>
          <Badge tone={actor?.role === ADMIN_ROLES.OWNER ? 'danger' : 'info'}>{getRoleLabel(actor?.role)}</Badge>
          <button type="button" className="button button--ghost" onClick={onLogout}>
            <LogOut size={15} />
            Đăng xuất
          </button>
        </div>
      </aside>
      {children}
    </div>
  );
}

function Metric({ label, value, icon: Icon, tone = 'neutral' }) {
  return (
    <div className={`metric metric--${tone}`}>
      <Icon size={20} />
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function OverviewRankingPreview({ ranking, loading, error, onSelectView }) {
  const items = ranking?.items || [];

  return (
    <section className="panel overview-ranking-panel">
      <header className="panel-header">
        <div>
          <h2>Top VIP 30 ngày</h2>
          <span>Tài khoản VIP và trọn đời dùng nhiều nhất gần đây</span>
        </div>
        <button type="button" className="button button--ghost" onClick={() => onSelectView('vip-ranking')}>
          <Trophy size={15} />
          Xem xếp hạng
        </button>
      </header>
      {error ? (
        <div className="ranking-inline-error">{error}</div>
      ) : loading ? (
        <div className="ranking-skeleton-list" aria-label="Đang tải xếp hạng VIP">
          {[0, 1, 2].map((index) => <span key={index} />)}
        </div>
      ) : items.length === 0 ? (
        <EmptyState title="Chưa có dữ liệu VIP" text="Chưa có tài khoản VIP dùng AI trong 30 ngày gần đây." />
      ) : (
        <div className="overview-ranking-list">
          {items.map((item) => (
            <div className="overview-ranking-row" key={item.userId || item.email}>
              <strong>#{item.rank}</strong>
              <div>
                <b>{item.displayName || item.email || item.userId}</b>
                <span>{item.email || item.userId}</span>
              </div>
              <em>{formatNumber(item.totalCount)} lượt</em>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function OverviewPanel({ data, apiBaseUrl, onSelectView, ranking, rankingLoading, rankingError }) {
  const activeUsers = data.users.filter((user) => String(user.status || 'active') === 'active').length;
  const vipUsers = data.users.filter((user) => ['vip', 'lifetime'].includes(getCurrentUserPlanKey(user))).length;
  const auditToday = data.audit.filter((item) => isToday(item.created_at)).length;
  const usageErrors = data.usage.filter((item) => String(item.status || '').toLowerCase() === 'error').length;
  const recentAudit = data.audit.slice(0, 5);

  return (
    <section className="content-grid">
      <div className="section-header">
        <div>
          <h1>Tổng quan</h1>
          <p>Trạng thái quản trị người dùng, gói VIP và quyền truy cập của StoryForge.</p>
        </div>
        <Badge tone="info">{apiBaseUrl}</Badge>
      </div>
      <div className="metric-grid">
        <Metric label="Người dùng hoạt động" value={activeUsers} icon={Users} tone="success" />
        <Metric label="Tài khoản VIP" value={vipUsers} icon={Sparkles} tone="warning" />
        <Metric label="Thao tác hôm nay" value={auditToday} icon={FileClock} tone="info" />
        <Metric label="Lỗi usage gần đây" value={usageErrors} icon={AlertTriangle} tone={usageErrors > 0 ? 'danger' : 'success'} />
      </div>
      <OverviewRankingPreview
        ranking={ranking}
        loading={rankingLoading}
        error={rankingError}
        onSelectView={onSelectView}
      />
      <section className="panel">
        <header className="panel-header">
          <h2>Nhật ký mới</h2>
          <button type="button" className="button button--ghost" onClick={() => onSelectView('audit')}>
            Mở nhật ký
          </button>
        </header>
        {recentAudit.length === 0 ? (
          <EmptyState title="Chưa có nhật ký" text="Các thao tác cấp VIP, hủy gói và đổi quyền sẽ xuất hiện ở đây." />
        ) : (
          <div className="audit-list">
            {recentAudit.map((item) => (
              <div className="audit-row" key={item.id || `${item.action}-${item.created_at}`}>
                <span>{getAuditSummary(item)}</span>
                <strong>{getAuditActorLabel(item)}</strong>
                <time>{formatDate(item.created_at)}</time>
              </div>
            ))}
          </div>
        )}
      </section>
    </section>
  );
}

function UsersPanel({ data, selectedUserId, setSelectedUserId, onMutation, actor }) {
  const [query, setQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [planFilter, setPlanFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [planForm, setPlanForm] = useState(DEFAULT_PLAN_FORM);
  const [overrideForm, setOverrideForm] = useState(DEFAULT_OVERRIDE_FORM);
  const [accessCheck, setAccessCheck] = useState(null);
  const [accessLoading, setAccessLoading] = useState(false);
  const [accessError, setAccessError] = useState('');

  const users = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return data.users.filter((user) => {
      const role = String(user.system_role || user.role || 'user').toLowerCase();
      const plan = getCurrentUserPlanKey(user);
      const status = String(user.status || 'active').toLowerCase();
      const matchesQuery = !needle || [
        getUserEmail(user),
        getUserId(user),
        user.display_name || user.displayName,
        plan,
        role,
        status,
      ].some((value) => String(value || '').toLowerCase().includes(needle));
      return matchesQuery
        && (roleFilter === 'all' || role === roleFilter)
        && (planFilter === 'all' || plan === planFilter)
        && (statusFilter === 'all' || status === statusFilter);
    });
  }, [data.users, planFilter, query, roleFilter, statusFilter]);
  const selected = users.find((user) => getUserId(user) === selectedUserId) || users[0] || null;
  const selectedId = selected ? getUserId(selected) : '';
  const hasUserFilters = Boolean(query.trim()) || roleFilter !== 'all' || planFilter !== 'all' || statusFilter !== 'all';
  const userStats = useMemo(() => getUserManagementStats(data.users), [data.users]);

  useEffect(() => {
    if (selected && selectedUserId !== getUserId(selected)) setSelectedUserId(getUserId(selected));
  }, [selected, selectedUserId, setSelectedUserId]);

  useEffect(() => {
    setAccessCheck(null);
    setAccessError('');
  }, [selectedId]);

  const canMutatePlan = hasPermission(actor, ADMIN_PERMISSIONS.USERS_PLAN_UPDATE);
  const canMutateStatus = hasPermission(actor, ADMIN_PERMISSIONS.USERS_STATUS_UPDATE);
  const canMutateAccess = hasPermission(actor, ADMIN_PERMISSIONS.USERS_ROLE_UPDATE);
  const canMutateOverride = hasPermission(actor, ADMIN_PERMISSIONS.USERS_OVERRIDE_UPDATE);
  const canSyncAuth = hasPermission(actor, ADMIN_PERMISSIONS.ADMIN_SYNC_AUTH);

  const reloadAccess = useCallback(async () => {
    if (!selectedId) return;
    setAccessLoading(true);
    setAccessError('');
    try {
      const payload = await onMutation.api.userAccess(selectedId);
      setAccessCheck(payload.access || null);
    } catch (error) {
      setAccessError(error.message || 'Không tải được quyền người dùng.');
    } finally {
      setAccessLoading(false);
    }
  }, [onMutation.api, selectedId]);

  const runPlanOperation = (title, message, body) => onMutation({
    title,
    message,
    action: async () => {
      await onMutation.api.setUserPlan(selectedId, body);
      await reloadAccess();
    },
  });

  const activePlan = selected ? getActiveUserPlan(selected) : null;
  const currentPlanKey = selected ? getCurrentUserPlanKey(selected) : 'free';
  const selectedPlans = selected ? getVisibleUserPlans(selected) : [];
  const selectedEmail = selected ? getUserEmail(selected) : 'Chưa chọn';

  return (
    <section className="content-grid user-page">
      <div className="section-header user-page-header">
        <div>
          <h1>Người dùng</h1>
          <p>Quản lý tài khoản, gói VIP, trạng thái và quyền riêng của người dùng.</p>
        </div>
        <div className="section-header__actions">
          <button
            type="button"
            className="button button--ghost"
            disabled={!canSyncAuth}
            onClick={() => onMutation({
              title: 'Đồng bộ Auth',
              message: 'Đồng bộ tài khoản Supabase Auth còn thiếu vào danh sách người dùng admin?',
              action: () => onMutation.api.syncAuth(),
            })}
          >
            <RefreshCw size={15} />
            Đồng bộ Auth
          </button>
        </div>
      </div>
      <section className="user-control-surface" aria-label="Bộ lọc người dùng">
        <div className="user-control-surface__top">
          <div className="user-control-surface__title">
            <h2>Bộ lọc người dùng</h2>
            <span>{users.length} kết quả phù hợp</span>
          </div>
          <div className="search-box user-search-box">
            <Search size={16} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm email, id, tên" />
          </div>
        </div>
        <div className="admin-user-filters user-filter-grid">
          <label>
            <span>Lọc vai trò</span>
            <select value={roleFilter} onChange={(event) => setRoleFilter(event.target.value)}>
              <option value="all">Tất cả vai trò</option>
              {Object.entries(ROLE_LABELS_VI).map(([role, label]) => (
                <option key={role} value={role}>{label}</option>
              ))}
            </select>
          </label>
          <label>
            <span>Lọc gói</span>
            <select value={planFilter} onChange={(event) => setPlanFilter(event.target.value)}>
              <option value="all">Tất cả gói</option>
              {Object.entries(PLAN_LABELS_VI).map(([plan, label]) => (
                <option key={plan} value={plan}>{label}</option>
              ))}
            </select>
          </label>
          <label>
            <span>Lọc trạng thái</span>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              <option value="all">Tất cả trạng thái</option>
              {Object.entries(STATUS_LABELS_VI).map(([status, label]) => (
                <option key={status} value={status}>{label}</option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="filter-chip"
            disabled={!hasUserFilters}
            onClick={() => {
              setQuery('');
              setRoleFilter('all');
              setPlanFilter('all');
              setStatusFilter('all');
            }}
          >
            Xóa bộ lọc
          </button>
        </div>
        <div className="user-summary-strip user-insight-strip">
          <div>
            <span>Tổng người dùng</span>
            <strong>{data.users.length}</strong>
          </div>
          <div>
            <span>Đang hiển thị</span>
            <strong>{users.length}</strong>
          </div>
          <div>
            <span>VIP/Trọn đời</span>
            <strong>{userStats.vip}</strong>
          </div>
          <div>
            <span>Sắp hết hạn</span>
            <strong>{userStats.expiringSoon}</strong>
          </div>
          <div>
            <span>Đang bị khóa</span>
            <strong>{userStats.locked}</strong>
          </div>
          <div className="user-selected-stat" title={selectedEmail}>
            <span>Đang chọn</span>
            <strong>{selectedEmail}</strong>
          </div>
        </div>
      </section>
      <div className="split-layout user-workspace">
        <section className="panel panel--table user-table-panel">
          <div className="user-table-toolbar">
            <div>
              <h2>Danh sách người dùng</h2>
              <span>{users.length} tài khoản trong bộ lọc hiện tại</span>
            </div>
            <Badge tone="info">{selected ? 'Đã chọn 1 người dùng' : 'Chưa chọn'}</Badge>
          </div>
          {users.length === 0 ? (
            <EmptyState title="Chưa có người dùng" text="Bấm Đồng bộ Auth để nhập danh sách từ Supabase Auth." />
          ) : (
            <div className="user-list-scroll">
              <table className="data-table user-table">
                <thead>
                  <tr>
                    <th>Email</th>
                    <th>Vai trò</th>
                    <th>Gói</th>
                    <th>Hết hạn</th>
                    <th>Trạng thái</th>
                    <th>Cập nhật</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((user) => {
                    const userId = getUserId(user);
                    const planKey = getCurrentUserPlanKey(user);
                    const userActivePlan = getActiveUserPlan(user);
                    return (
                      <tr
                        key={userId}
                        className={selected && getUserId(selected) === userId ? 'is-selected' : ''}
                        onClick={() => setSelectedUserId(userId)}
                      >
                        <td className="user-email-cell">
                          <strong>{getUserEmail(user)}</strong>
                          <span>{userId}</span>
                        </td>
                        <td><Badge tone={(user.system_role || user.role) === 'owner' ? 'danger' : 'info'}>{getRoleLabel(user.system_role || user.role)}</Badge></td>
                        <td><Badge tone={getUserPlanStatusTone(userActivePlan)}>{getPlanLabel(planKey)}</Badge></td>
                        <td className="user-expiry-cell">
                          <strong>{getUserPlanExpiryShortLabel(userActivePlan)}</strong>
                          <span>{getUserPlanStatusLabel(userActivePlan)}</span>
                        </td>
                        <td><Badge tone={String(user.status || 'active') === 'active' ? 'success' : 'danger'}>{getStatusLabel(user.status)}</Badge></td>
                        <td className="user-updated-cell">{formatDate(user.updated_at || user.metadata?.auth_updated_at)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
        <aside className="detail-panel user-detail-scroll user-detail-panel">
          {selected ? (
            <>
              <header>
                <UserCog size={20} />
                <div>
                  <h2>{getUserEmail(selected)}</h2>
                  <span>{selectedId}</span>
                </div>
              </header>

              <section className="detail-section user-quick-actions-card">
                <div className="detail-section__header">
                  <h3>Thao tác nhanh</h3>
                  <Badge tone={getUserPlanStatusTone(activePlan)}>{getPlanLabel(currentPlanKey)}</Badge>
                </div>
                <div className="quick-actions">
                  <button
                    type="button"
                    className="button button--primary"
                    disabled={!canMutatePlan}
                    onClick={() => runPlanOperation(
                      'Cấp VIP 30 ngày',
                      `Cấp VIP 30 ngày cho ${getUserEmail(selected)}?`,
                      { operation: 'set', planKey: 'vip', expiresAt: addDaysIso(30) },
                    )}
                  >
                    Cấp VIP 30 ngày
                  </button>
                  <button
                    type="button"
                    className="button button--primary"
                    disabled={!canMutatePlan}
                    onClick={() => runPlanOperation(
                      'Cấp VIP 90 ngày',
                      `Cấp VIP 90 ngày cho ${getUserEmail(selected)}?`,
                      { operation: 'set', planKey: 'vip', expiresAt: addDaysIso(90) },
                    )}
                  >
                    Cấp VIP 90 ngày
                  </button>
                  <button
                    type="button"
                    className="button button--primary"
                    disabled={!canMutatePlan}
                    onClick={() => runPlanOperation(
                      'Cấp trọn đời',
                      `Cấp gói trọn đời cho ${getUserEmail(selected)}?`,
                      { operation: 'set', planKey: 'lifetime' },
                    )}
                  >
                    Cấp trọn đời
                  </button>
                  <button
                    type="button"
                    className="button button--danger"
                    disabled={!canMutatePlan}
                    onClick={() => runPlanOperation(
                      'Hủy gói hiện tại',
                      `Hủy gói hiện tại của ${getUserEmail(selected)}?`,
                      { operation: 'cancel_current' },
                    )}
                  >
                    Hủy gói hiện tại
                  </button>
                  <button
                    type="button"
                    className="button button--danger"
                    disabled={!canMutatePlan}
                    onClick={() => runPlanOperation(
                      'Hủy gói đã đặt lịch',
                      `Hủy gói đã đặt lịch của ${getUserEmail(selected)}?`,
                      { operation: 'cancel_scheduled' },
                    )}
                  >
                    Hủy gói đã đặt lịch
                  </button>
                </div>
              </section>

              <section className="detail-section user-plan-card">
                <div className="user-plan-card__header">
                  <h3>Tình trạng gói</h3>
                  <Badge tone={getUserPlanStatusTone(activePlan)}>{getUserPlanStatusLabel(activePlan)}</Badge>
                </div>
                <div className="user-plan-card__grid">
                  <div>
                    <span>Gói hiện tại</span>
                    <strong>{getPlanLabel(currentPlanKey)}</strong>
                  </div>
                  <div>
                    <span>Ngày hết hạn</span>
                    <strong>{getUserPlanExpiryLabel(activePlan)}</strong>
                  </div>
                  <div>
                    <span>Cập nhật lần cuối</span>
                    <strong>{formatDate(selected.updated_at || selected.auth_updated_at || selected.metadata?.auth_updated_at)}</strong>
                  </div>
                </div>
                <details className="user-plan-history">
                  <summary>Lịch sử gói gần đây</summary>
                  <div className="user-plan-table" aria-label="Lịch sử gói gần đây">
                    {selectedPlans.length === 0 ? (
                      <span>Chưa có gói VIP đang hoạt động</span>
                    ) : (
                      selectedPlans.map((plan, index) => (
                        <div className="user-plan-row" key={plan.id || `${getPlanKey(plan)}-${plan.starts_at || plan.created_at || index}`}>
                          <div>
                            <strong>{getPlanLabel(plan)}</strong>
                            <span>{getUserPlanStatusLabel(plan)} · Bắt đầu {formatDate(plan.starts_at || plan.created_at)}</span>
                          </div>
                          <div>
                            <span>Hết hạn</span>
                            <strong>{getUserPlanExpiryLabel(plan)}</strong>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </details>
              </section>

              <section className="detail-section">
                <h3>Trạng thái tài khoản</h3>
                <div className="inline-actions">
                  <Badge tone={selected.status === 'active' ? 'success' : 'danger'}>{getStatusLabel(selected.status)}</Badge>
                  <button
                    type="button"
                    className={selected.status === 'active' ? 'button button--danger' : 'button button--primary'}
                    disabled={!canMutateStatus}
                    onClick={() => onMutation({
                      title: selected.status === 'active' ? 'Khóa tài khoản' : 'Mở tài khoản',
                      message: `${selected.status === 'active' ? 'Khóa' : 'Mở'} tài khoản ${getUserEmail(selected)}?`,
                      action: async () => {
                        await onMutation.api.updateUserStatus(selectedId, selected.status === 'active' ? 'banned' : 'active');
                        await reloadAccess();
                      },
                    })}
                  >
                    {selected.status === 'active' ? 'Khóa tài khoản' : 'Mở tài khoản'}
                  </button>
                </div>
              </section>

              <details className="detail-section">
                <summary>Cấp hoặc đặt lịch gói bằng form</summary>
                <label>
                  <span>Gói</span>
                  <select value={planForm.planKey} onChange={(event) => setPlanForm((form) => ({ ...form, planKey: event.target.value }))}>
                    {Object.keys(PLAN_LABELS_VI).map((plan) => <option key={plan} value={plan}>{PLAN_LABELS_VI[plan]}</option>)}
                  </select>
                </label>
                <label>
                  <span>Trạng thái</span>
                  <select value={planForm.status} onChange={(event) => setPlanForm((form) => ({ ...form, status: event.target.value }))}>
                    <option value="active">Có hiệu lực ngay</option>
                    <option value="scheduled">Đặt lịch</option>
                  </select>
                </label>
                <label>
                  <span>Bắt đầu</span>
                  <input type="datetime-local" value={planForm.startsAt} onChange={(event) => setPlanForm((form) => ({ ...form, startsAt: event.target.value }))} />
                </label>
                <label>
                  <span>Hết hạn</span>
                  <input type="datetime-local" value={planForm.expiresAt} onChange={(event) => setPlanForm((form) => ({ ...form, expiresAt: event.target.value }))} />
                </label>
                <button
                  type="button"
                  className="button button--primary"
                  disabled={!canMutatePlan}
                  onClick={() => runPlanOperation(
                    'Cấp hoặc đặt lịch gói',
                    `Áp dụng gói ${getPlanLabel(planForm.planKey)} cho ${getUserEmail(selected)}?`,
                    {
                      operation: 'set',
                      planKey: planForm.planKey,
                      status: planForm.status,
                      startsAt: planForm.startsAt || undefined,
                      expiresAt: planForm.expiresAt || undefined,
                    },
                  )}
                >
                  Áp dụng gói
                </button>
              </details>

              <details className="detail-section">
                <summary>Vai trò quản trị</summary>
                <label>
                  <span>Vai trò</span>
                  <select
                    value={selected.system_role || selected.role || 'user'}
                    disabled={!canMutateAccess}
                    onChange={(event) => onMutation({
                      title: 'Cập nhật vai trò',
                      message: `Đổi vai trò của ${getUserEmail(selected)} sang ${getRoleLabel(event.target.value)}?`,
                      action: () => onMutation.api.updateUserAccess(selectedId, event.target.value),
                    })}
                  >
                    {Object.values(ADMIN_ROLES).map((role) => <option key={role} value={role}>{ROLE_LABELS_VI[role]}</option>)}
                  </select>
                </label>
              </details>

              <details className="detail-section">
                <summary>Cấp/chặn riêng từng feature</summary>
                <label>
                  <span>Tính năng</span>
                  <select value={overrideForm.featureKey} onChange={(event) => setOverrideForm((form) => ({ ...form, featureKey: event.target.value }))}>
                    <option value="">Chọn tính năng</option>
                    {data.features.map((feature) => (
                      <option key={feature.key} value={feature.key}>{feature.name || FEATURE_LABELS_VI[feature.key] || feature.key}</option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Quyền riêng</span>
                  <select value={overrideForm.enabled ? 'true' : 'false'} onChange={(event) => setOverrideForm((form) => ({ ...form, enabled: event.target.value === 'true' }))}>
                    <option value="true">Cấp riêng</option>
                    <option value="false">Chặn riêng</option>
                  </select>
                </label>
                <label>
                  <span>Lý do</span>
                  <input value={overrideForm.reason} onChange={(event) => setOverrideForm((form) => ({ ...form, reason: event.target.value }))} placeholder="Ví dụ: hỗ trợ kiểm thử" />
                </label>
                <label>
                  <span>Hết hạn</span>
                  <input type="datetime-local" value={overrideForm.expiresAt} onChange={(event) => setOverrideForm((form) => ({ ...form, expiresAt: event.target.value }))} />
                </label>
                <button
                  type="button"
                  className="button button--primary"
                  disabled={!canMutateOverride || !overrideForm.featureKey}
                  onClick={() => onMutation({
                    title: overrideForm.enabled ? 'Cấp riêng feature' : 'Chặn riêng feature',
                    message: `${overrideForm.enabled ? 'Cấp' : 'Chặn'} ${getFeatureName(data, overrideForm.featureKey)} cho ${getUserEmail(selected)}?`,
                    action: async () => {
                      await onMutation.api.setUserFeatureOverride(selectedId, {
                        operation: 'set',
                        featureKey: overrideForm.featureKey,
                        enabled: overrideForm.enabled,
                        reason: overrideForm.reason,
                        expiresAt: overrideForm.expiresAt || undefined,
                      });
                      await reloadAccess();
                    },
                  })}
                >
                  Lưu quyền riêng
                </button>
              </details>

              <section className="detail-section">
                <header className="detail-section__header">
                  <div>
                    <h3>Tự kiểm tra quyền</h3>
                    <span>Gói hiện tại: {getPlanLabel(currentPlanKey)} · Hết hạn: {formatDate(activePlan?.expires_at)}</span>
                  </div>
                  <button type="button" className="button button--ghost" onClick={reloadAccess} disabled={accessLoading}>
                    <RefreshCw size={15} />
                    {accessLoading ? 'Đang tải' : 'Tải lại quyền'}
                  </button>
                </header>
                {accessError ? <ErrorState message={accessError} /> : null}
                {!accessCheck ? (
                  <EmptyState title="Chưa tải quyền" text="Bấm tải lại để xem feature nào đang mở hoặc bị khóa và lý do." />
                ) : (
                  <div className="access-check-list">
                    {Object.entries(accessCheck.features || {}).map(([featureKey, decision]) => (
                      <div className="access-check-row" key={featureKey}>
                        <div>
                          <strong>{getFeatureName(data, featureKey)}</strong>
                          <span>{explainDecision(decision)}</span>
                        </div>
                        <Badge tone={decision.allowed ? 'success' : 'neutral'}>{decision.allowed ? 'Quyền đang mở' : 'Đang khóa'}</Badge>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <div className="detail-meta">
                <span>Lần đăng nhập: {formatDate(selected.last_seen_at || selected.metadata?.last_sign_in_at)}</span>
                <span>Cập nhật auth: {formatDate(selected.auth_updated_at || selected.metadata?.auth_updated_at)}</span>
              </div>
            </>
          ) : (
            <EmptyState title="Chưa chọn người dùng" text="Chọn một hàng để xem chi tiết." />
          )}
        </aside>
      </div>
    </section>
  );
}

function VipPageSettingsPanel({ plan, canWriteCatalog, onMutation }) {
  const [form, setForm] = useState(() => getPlanVipPageContent(plan));

  useEffect(() => {
    setForm(getPlanVipPageContent(plan));
  }, [plan?.id, plan?.updated_at]);

  if (!plan) {
    return (
      <section className="panel">
        <EmptyState title="Chưa có gói VIP" text="Cần có plan `vip` trong bảng `plans` trước khi chỉnh nội dung trang VIP." />
      </section>
    );
  }

  const updateField = (field, value) => {
    setForm((current) => ({
      ...current,
      [field]: value,
    }));
  };

  const updatePriceLabel = (value) => {
    setForm((current) => {
      const oldDefault = createDefaultVipPageContent(current.priceLabel);
      const nextDefault = createDefaultVipPageContent(value);
      return {
        ...current,
        priceLabel: value,
        introText: current.introText === oldDefault.introText ? nextDefault.introText : current.introText,
        paymentNotice: current.paymentNotice === oldDefault.paymentNotice ? nextDefault.paymentNotice : current.paymentNotice,
      };
    });
  };

  const preview = normalizeVipPageContent(form);
  const saveContent = () => {
    const vipPage = normalizeVipPageContent(form);
    setForm(vipPage);
    onMutation({
      title: 'Lưu nội dung trang VIP',
      message: 'Cập nhật nội dung hiển thị trên trang Tài khoản & VIP?',
      action: () => onMutation.api.updateCatalogPlan(plan.id, { vipPage }),
    });
  };

  return (
    <section className="panel vip-page-settings">
      <header className="panel-header">
        <div>
          <h2>Chỉnh nội dung trang VIP</h2>
          <span>Chỉnh giá và nội dung người dùng thấy ở trang Tài khoản & VIP. Layout và nút hành động vẫn cố định.</span>
        </div>
        <Badge tone={canWriteCatalog ? 'info' : 'neutral'}>{canWriteCatalog ? 'Có quyền sửa' : 'Chỉ xem'}</Badge>
      </header>

      <div className="vip-settings-grid">
        <div className="vip-page-form">
          <label>
            <span>Tiêu đề</span>
            <input
              value={form.title}
              onChange={(event) => updateField('title', event.target.value)}
              disabled={!canWriteCatalog}
            />
          </label>
          <label>
            <span>Giá VIP</span>
            <input
              value={form.priceLabel}
              onChange={(event) => updatePriceLabel(event.target.value)}
              disabled={!canWriteCatalog}
              placeholder="50.000đ"
            />
          </label>
          <label className="vip-page-field--wide">
            <span>Đoạn giới thiệu</span>
            <textarea
              rows={4}
              value={form.introText}
              onChange={(event) => updateField('introText', event.target.value)}
              disabled={!canWriteCatalog}
            />
          </label>
          <label className="vip-page-field--wide">
            <span>Thông báo thanh toán</span>
            <textarea
              rows={3}
              value={form.paymentNotice}
              onChange={(event) => updateField('paymentNotice', event.target.value)}
              disabled={!canWriteCatalog}
            />
          </label>
          <label className="vip-page-field--wide">
            <span>Hỗ trợ & cộng đồng</span>
            <textarea
              rows={2}
              value={form.supportText}
              onChange={(event) => updateField('supportText', event.target.value)}
              disabled={!canWriteCatalog}
            />
          </label>
          <label>
            <span>Khi đã có VIP</span>
            <input
              value={form.signedInVipText}
              onChange={(event) => updateField('signedInVipText', event.target.value)}
              disabled={!canWriteCatalog}
            />
          </label>
          <label>
            <span>Khi chưa có VIP</span>
            <input
              value={form.signedInFreeText}
              onChange={(event) => updateField('signedInFreeText', event.target.value)}
              disabled={!canWriteCatalog}
            />
          </label>
          <label className="vip-page-field--wide">
            <span>Khi chưa đăng nhập</span>
            <input
              value={form.signedOutText}
              onChange={(event) => updateField('signedOutText', event.target.value)}
              disabled={!canWriteCatalog}
            />
          </label>
        </div>

        <aside className="vip-page-preview" aria-label="Xem trước trên trang tài khoản">
          <span>Xem trước trên trang tài khoản</span>
          <h3>{preview.title}</h3>
          <p>{preview.introText}</p>
          <div className="vip-page-preview__steps">
            <strong>Đăng nhập Google</strong>
            <strong>Liên hệ admin</strong>
          </div>
          <div className="vip-page-preview__notice">
            {preview.paymentNotice}
          </div>
          <small>{preview.supportText}</small>
        </aside>
      </div>

      <footer className="vip-page-settings__actions">
        <button
          type="button"
          className="button button--primary"
          onClick={saveContent}
          disabled={!canWriteCatalog}
        >
          <Check size={16} />
          Lưu nội dung VIP
        </button>
      </footer>
    </section>
  );
}

function VipPanel({ data, onMutation, actor }) {
  const canWriteCatalog = hasPermission(actor, ADMIN_PERMISSIONS.CATALOG_WRITE);
  const vipPlan = data.catalog.find((plan) => getPlanKey(plan) === 'vip') || null;

  return (
    <section className="content-grid">
      <div className="section-header">
        <div>
          <h1>Gói VIP</h1>
          <p>Danh mục gói chính thức: miễn phí, VIP và trọn đời. Không thêm gói ngoài hệ này.</p>
        </div>
      </div>
      <VipPageSettingsPanel plan={vipPlan} canWriteCatalog={canWriteCatalog} onMutation={onMutation} />
      <section className="panel">
        {data.catalog.length === 0 ? (
          <EmptyState title="Chưa có catalog" text="Tạo dữ liệu trong bảng `plans` để hiển thị gói." />
        ) : (
          <div className="plan-grid">
            {data.catalog.map((plan) => {
              const planKey = getPlanKey(plan);
              const planFeatures = getPlanFeatureRows(data, planKey);
              const enabledFeatureCount = planFeatures.filter((item) => item.enabled !== false).length;
              const planEnabled = plan.active !== false;

              return (
                <article className="plan-tile" key={plan.id || plan.key}>
                  <header>
                    <BookOpen size={18} />
                    <strong>{plan.name || getPlanLabel(plan.key)}</strong>
                    <Badge tone={planEnabled ? 'success' : 'neutral'}>{planEnabled ? 'Đang bật' : 'Tắt'}</Badge>
                  </header>
                  <p>{plan.description || 'Chưa có mô tả.'}</p>
                  <div className="plan-tile__meta">
                    <span>{enabledFeatureCount}/{planFeatures.length} feature đang bật</span>
                    <span>Khóa gói: {plan.key}</span>
                  </div>
                  {planFeatures.length === 0 ? (
                    <EmptyState title="Chưa có feature" text="Gói này chưa được gắn tính năng." />
                  ) : (
                    <div className="plan-feature-list">
                      {planFeatures.slice(0, 6).map((item) => {
                        const featureKey = getFeatureKey(item);
                        return (
                          <div className="plan-feature-pill" key={item.id || `${planKey}-${featureKey}`}>
                            <span>{getFeatureName(data, featureKey)}</span>
                            <Badge tone={item.enabled === false ? 'neutral' : 'info'}>{item.enabled === false ? 'Tắt' : 'Bật'}</Badge>
                            <small>{summarizeLimits(item.limit_json)}</small>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  <button
                    type="button"
                    className={`status-button ${planEnabled ? 'is-on' : ''}`}
                    disabled={!canWriteCatalog}
                    onClick={() => onMutation({
                      title: planEnabled ? 'Tắt gói' : 'Bật gói',
                      message: `${planEnabled ? 'Tắt' : 'Bật'} gói ${plan.name || getPlanLabel(plan.key)}?`,
                      action: () => onMutation.api.updateCatalogPlan(plan.id, { active: !planEnabled }),
                    })}
                  >
                    {planEnabled ? 'Đang bật' : 'Đang tắt'}
                  </button>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </section>
  );
}

function AnnouncementPanel({ data, onMutation, actor }) {
  const canWriteCatalog = hasPermission(actor, ADMIN_PERMISSIONS.CATALOG_WRITE);
  const [form, setForm] = useState(() => normalizeSiteAnnouncement(data.announcement));

  useEffect(() => {
    setForm(normalizeSiteAnnouncement(data.announcement));
  }, [data.announcement]);

  const updateField = (field, value) => {
    setForm((current) => ({
      ...current,
      [field]: value,
    }));
  };

  const preview = normalizeSiteAnnouncement(form);
  const saveContent = () => {
    const announcement = normalizeSiteAnnouncement(form);
    setForm(announcement);
    onMutation({
      title: 'Lưu thông báo',
      message: 'Cập nhật thông báo hệ thống hiển thị cho người dùng?',
      action: () => onMutation.api.updateAnnouncement(announcement),
    });
  };

  return (
    <section className="content-grid">
      <div className="section-header">
        <div>
          <h1>Thông báo</h1>
          <p>Chỉnh một thông báo hệ thống công khai. Người dùng sẽ thấy lại khi nội dung chính thay đổi phiên bản.</p>
        </div>
        <Badge tone={preview.enabled ? 'success' : 'neutral'}>{preview.enabled ? 'Đang bật' : 'Đang tắt'}</Badge>
      </div>

      <section className="panel announcement-settings">
        <header className="panel-header">
          <div>
            <h2>Chỉnh thông báo hệ thống</h2>
            <span>Nội dung là plain text. Link nút chính chỉ chấp nhận HTTPS để an toàn.</span>
          </div>
          <Badge tone={canWriteCatalog ? 'info' : 'neutral'}>{canWriteCatalog ? 'Có quyền sửa' : 'Chỉ xem'}</Badge>
        </header>

        <div className="announcement-settings-grid">
          <div className="announcement-form">
            <label className="announcement-toggle-row">
              <span>Bật thông báo</span>
              <button
                type="button"
                className={`toggle ${form.enabled ? 'is-on' : ''}`}
                aria-pressed={form.enabled}
                disabled={!canWriteCatalog}
                onClick={() => updateField('enabled', !form.enabled)}
              >
                <span />
              </button>
            </label>
            <label>
              <span>Tiêu đề</span>
              <input
                value={form.title}
                onChange={(event) => updateField('title', event.target.value)}
                disabled={!canWriteCatalog}
              />
            </label>
            <label className="announcement-field--wide">
              <span>Nội dung thông báo</span>
              <textarea
                rows={6}
                value={form.body}
                onChange={(event) => updateField('body', event.target.value)}
                disabled={!canWriteCatalog}
              />
            </label>
            <label>
              <span>Nhãn nút</span>
              <input
                value={form.primaryActionLabel}
                onChange={(event) => updateField('primaryActionLabel', event.target.value)}
                disabled={!canWriteCatalog}
              />
            </label>
            <label>
              <span>Link nút chính</span>
              <input
                value={form.primaryActionUrl}
                onChange={(event) => updateField('primaryActionUrl', event.target.value)}
                disabled={!canWriteCatalog}
                placeholder="https://story-forge-kohl.vercel.app/"
              />
            </label>
          </div>

          <aside className="announcement-preview" aria-label="Xem trước thông báo">
            <span>Xem trước thông báo</span>
            <div className="announcement-preview__header">
              <Bell size={18} />
              <h3>{preview.title}</h3>
            </div>
            <p>{preview.body}</p>
            <a href={preview.primaryActionUrl} target="_blank" rel="noreferrer">
              {preview.primaryActionLabel}
            </a>
            <small>Phiên bản {preview.revision}</small>
          </aside>
        </div>

        <footer className="vip-page-settings__actions">
          <button
            type="button"
            className="button button--primary"
            onClick={saveContent}
            disabled={!canWriteCatalog}
          >
            <Check size={16} />
            Lưu thông báo
          </button>
        </footer>
      </section>
    </section>
  );
}

function FeaturesPanel({ data, onMutation, actor }) {
  const canWriteFeature = hasPermission(actor, ADMIN_PERMISSIONS.FEATURES_WRITE);
  const canWritePlanFeature = hasPermission(actor, ADMIN_PERMISSIONS.PLAN_FEATURES_WRITE);

  return (
    <section className="content-grid">
      <div className="section-header">
        <div>
          <h1>Tính năng trong gói</h1>
          <p>Điều khiển feature flag và mapping gói theo đúng hệ VIP cũ.</p>
        </div>
      </div>
      <div className="dual-panels">
        <section className="panel">
          <header className="panel-header">
            <h2>Feature flags</h2>
            <Badge tone="info">{data.features.length}</Badge>
          </header>
          {data.features.length === 0 ? (
            <EmptyState title="Chưa có feature" text="Bảng `features` chưa có dữ liệu." />
          ) : (
            <div className="feature-list">
              {data.features.map((feature) => {
                const featureKey = feature.key;
                const active = feature.active !== false;
                return (
                  <div className="feature-row" key={featureKey}>
                    <div>
                      <strong>{feature.name || FEATURE_LABELS_VI[featureKey] || featureKey}</strong>
                      <span>{feature.description || feature.category || 'Feature'}</span>
                    </div>
                    <button
                      type="button"
                      className={`toggle ${active ? 'is-on' : ''}`}
                      disabled={!canWriteFeature}
                      aria-pressed={active}
                      onClick={() => onMutation({
                        title: active ? 'Tắt feature' : 'Bật feature',
                        message: `${active ? 'Tắt' : 'Bật'} ${feature.name || featureKey}?`,
                        action: () => onMutation.api.updateFeature(featureKey, { active: !active }),
                      })}
                    >
                      <span />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </section>
        <section className="panel">
          <header className="panel-header">
            <h2>Plan features</h2>
            <Badge tone="warning">{data.planFeatures.length}</Badge>
          </header>
          {data.planFeatures.length === 0 ? (
            <EmptyState title="Chưa có mapping" text="Bảng `plan_features` chưa có dữ liệu." />
          ) : (
            <table className="data-table data-table--compact">
              <thead>
                <tr>
                  <th>Gói</th>
                  <th>Feature</th>
                  <th>Trạng thái</th>
                </tr>
              </thead>
              <tbody>
                {data.planFeatures.map((item) => {
                  const featureKey = getFeatureKey(item);
                  const planKey = getPlanFeaturePlanKey(item);
                  const enabled = item.enabled !== false;
                  return (
                    <tr key={item.id || `${planKey}-${featureKey}`}>
                      <td>{getPlanLabel(planKey)}</td>
                      <td>{getFeatureName(data, featureKey)}</td>
                      <td>
                        <button
                          type="button"
                          className={`status-button ${enabled ? 'is-on' : ''}`}
                          disabled={!canWritePlanFeature}
                          onClick={() => onMutation({
                            title: 'Cập nhật tính năng trong gói',
                            message: `${enabled ? 'Tắt' : 'Bật'} tính năng này trong gói ${getPlanLabel(planKey)}?`,
                            action: () => onMutation.api.setPlanFeature(featureKey, { planKey, enabled: !enabled }),
                          })}
                        >
                          {enabled ? 'Bật' : 'Tắt'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </section>
  );
}

function ConsentPanel({ data }) {
  return (
    <section className="content-grid">
      <div className="section-header">
        <div>
          <h1>Điều khoản 18+</h1>
          <p>Theo dõi phiên bản điều khoản 18+ đang có hiệu lực.</p>
        </div>
      </div>
      <section className="panel panel--table">
        {data.consent.length === 0 ? (
          <EmptyState title="Chưa có điều khoản" text="Bảng `consent_versions` chưa có dữ liệu." />
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Khóa</th>
                <th>Phiên bản</th>
                <th>Tiêu đề</th>
                <th>Trạng thái</th>
                <th>Hiệu lực</th>
              </tr>
            </thead>
            <tbody>
              {data.consent.map((item) => (
                <tr key={item.id || `${item.key}-${item.version}`}>
                  <td>{item.key}</td>
                  <td>{item.version}</td>
                  <td>{item.title}</td>
                  <td><Badge tone={item.active ? 'success' : 'neutral'}>{item.active ? 'Đang hiệu lực' : 'Tắt'}</Badge></td>
                  <td>{formatDate(item.effective_at || item.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </section>
  );
}

function AuditPanel({ data }) {
  const [selectedAuditId, setSelectedAuditId] = useState('');
  const [auditQuery, setAuditQuery] = useState('');

  const auditItems = useMemo(() => {
    const needle = auditQuery.trim().toLowerCase();
    if (!needle) return data.audit;
    return data.audit.filter((item) => [
      getAuditSummary(item),
      getAuditDetails(item),
      getAuditActorLabel(item),
      getAuditTargetLabel(data, item),
      item.action,
      item.resource_label,
    ].some((value) => String(value || '').toLowerCase().includes(needle)));
  }, [auditQuery, data, data.audit]);

  const selectedAudit = auditItems.find((item) => getAuditKey(item) === selectedAuditId) || auditItems[0] || null;

  useEffect(() => {
    if (selectedAudit && selectedAuditId !== getAuditKey(selectedAudit)) {
      setSelectedAuditId(getAuditKey(selectedAudit));
    }
  }, [selectedAudit, selectedAuditId]);

  return (
    <section className="content-grid">
      <div className="section-header">
        <div>
          <h1>Nhật ký quản trị</h1>
          <p>Theo dõi thao tác quản trị nhạy cảm: cấp gói, đổi vai trò, sửa feature, đồng bộ Auth và thay đổi hệ thống.</p>
        </div>
        <Badge tone="info">{data.audit.length} nhật ký</Badge>
      </div>

      <div className="activity-layout">
        <section className="panel panel--table">
          <div className="table-toolbar">
            <div className="search-box">
              <Search size={16} />
              <input value={auditQuery} onChange={(event) => setAuditQuery(event.target.value)} placeholder="Tìm người, hành động, chi tiết" />
            </div>
            <Badge tone="neutral">{auditItems.length} nhật ký</Badge>
          </div>
          {auditItems.length === 0 ? (
            <EmptyState title="Chưa có audit log" text="Các thao tác cập nhật role, gói và feature sẽ được ghi lại." />
          ) : (
            <table className="data-table audit-table">
              <thead>
                <tr>
                  <th>Thời gian</th>
                  <th>Người thực hiện</th>
                  <th>Hành động</th>
                  <th>Người bị tác động</th>
                  <th>Chi tiết</th>
                  <th>Trạng thái</th>
                </tr>
              </thead>
              <tbody>
                {auditItems.map((item) => {
                  const key = getAuditKey(item);
                  return (
                    <tr
                      key={key}
                      className={selectedAudit && getAuditKey(selectedAudit) === key ? 'is-selected' : ''}
                      onClick={() => setSelectedAuditId(key)}
                    >
                      <td>{formatDate(item.created_at)}</td>
                      <td className="audit-table__primary">
                        <strong>{getAuditActorLabel(item)}</strong>
                        <span>{getIdentityMeta(item.actor) || 'Admin'}</span>
                      </td>
                      <td><strong>{getAuditSummary(item)}</strong></td>
                      <td>{getAuditTargetLabel(data, item)}</td>
                      <td>{getAuditDetails(item)}</td>
                      <td><Badge tone="success">{getAuditStatusLabel(item)}</Badge></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>

        <aside className="audit-detail-drawer">
          {selectedAudit ? (
            <>
              <header>
                <FileClock size={20} />
                <div>
                  <h2>{getAuditSummary(selectedAudit)}</h2>
                  <span>{formatDate(selectedAudit.created_at)}</span>
                </div>
              </header>
              <section className="detail-section">
                <h3>Người thực hiện</h3>
                <strong>{getAuditActorLabel(selectedAudit)}</strong>
                <span>{getIdentityMeta(selectedAudit.actor) || 'Không có metadata vai trò'}</span>
              </section>
              <section className="detail-section">
                <h3>Người bị tác động</h3>
                <strong>{getAuditTargetLabel(data, selectedAudit)}</strong>
                <span>{getIdentityMeta(selectedAudit.target) || selectedAudit.resource_label || 'Hệ thống'}</span>
              </section>
              <section className="detail-section">
                <h3>Chi tiết</h3>
                <p>{getAuditDetails(selectedAudit)}</p>
              </section>
              <details className="detail-section">
                <summary>Kỹ thuật</summary>
                <div className="key-value-list key-value-list--wide">
                  <span>Actor ID</span>
                  <strong>{selectedAudit.actor_user_id || 'Không có'}</strong>
                  <span>Target ID</span>
                  <strong>{selectedAudit.target_user_id || selectedAudit.target_feature_key || 'Không có'}</strong>
                  <span>Action</span>
                  <strong>{selectedAudit.action || 'Không có'}</strong>
                  <span>IP</span>
                  <strong>{selectedAudit.security?.ip || selectedAudit.ip_address || 'Không có'}</strong>
                  <span>User-agent</span>
                  <strong>{selectedAudit.security?.userAgent || selectedAudit.user_agent || 'Không có'}</strong>
                </div>
                <details className="technical-json">
                  <summary>Raw JSON</summary>
                  <pre>{toPrettyJson({
                    before: selectedAudit.change?.before ?? selectedAudit.before_json,
                    after: selectedAudit.change?.after ?? selectedAudit.after_json,
                  })}</pre>
                </details>
              </details>
            </>
          ) : (
            <EmptyState title="Chưa chọn nhật ký" text="Chọn một dòng để xem chi tiết kỹ thuật." />
          )}
        </aside>
      </div>
    </section>
  );
}

function VipRankingMetric({ label, value, icon: Icon, tone = 'neutral' }) {
  return (
    <div className={`vip-ranking-metric vip-ranking-metric--${tone}`}>
      <Icon size={18} />
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function VipRankingSkeleton() {
  return (
    <div className="vip-ranking-skeleton" aria-label="Đang tải bảng xếp hạng VIP">
      {[0, 1, 2, 3, 4].map((index) => <span key={index} />)}
    </div>
  );
}

function VipRankingPanel({ ranking, loading, error, onLoadRanking }) {
  const [filters, setFilters] = useState(DEFAULT_VIP_RANKING_FILTERS);
  const items = ranking?.items || [];
  const summary = ranking?.summary || EMPTY_VIP_RANKING.summary;
  const hasCustomRange = filters.range === 'custom';

  const updateFilter = (field, value) => {
    setFilters((current) => ({
      ...current,
      [field]: field === 'limit' ? Number(value) : value,
    }));
  };

  const applyFilters = () => onLoadRanking(filters);

  return (
    <section className="content-grid vip-ranking-page">
      <div className="section-header">
        <div>
          <h1>Xếp hạng VIP</h1>
          <p>Bảng xếp hạng tài khoản VIP và trọn đời dùng StoryForge nhiều nhất theo thời gian, loại việc và provider.</p>
        </div>
        <Badge tone="warning">{formatNumber(summary.totalUsers)} tài khoản phù hợp</Badge>
      </div>

      <section className="panel vip-ranking-control-panel" aria-label="Bộ lọc xếp hạng VIP">
        <div className="vip-ranking-filter-grid">
          <label className="usage-filter-control vip-ranking-search">
            <span>Tìm tài khoản</span>
            <input
              value={filters.q}
              onChange={(event) => updateFilter('q', event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') applyFilters();
              }}
              placeholder="Email, tên hoặc user id"
            />
          </label>
          <label className="usage-filter-control">
            <span>Khoảng thời gian</span>
            <select value={filters.range} disabled={loading} onChange={(event) => updateFilter('range', event.target.value)}>
              {RANKING_RANGE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          {hasCustomRange ? (
            <>
              <label className="usage-filter-control">
                <span>Từ ngày</span>
                <input type="date" value={filters.from} disabled={loading} onChange={(event) => updateFilter('from', event.target.value)} />
              </label>
              <label className="usage-filter-control">
                <span>Đến ngày</span>
                <input type="date" value={filters.to} disabled={loading} onChange={(event) => updateFilter('to', event.target.value)} />
              </label>
            </>
          ) : null}
          <label className="usage-filter-control">
            <span>Loại việc</span>
            <select value={filters.task} disabled={loading} onChange={(event) => updateFilter('task', event.target.value)}>
              {RANKING_TASK_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <label className="usage-filter-control">
            <span>Gói</span>
            <select value={filters.plan} disabled={loading} onChange={(event) => updateFilter('plan', event.target.value)}>
              {RANKING_PLAN_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <label className="usage-filter-control">
            <span>Provider</span>
            <select value={filters.provider} disabled={loading} onChange={(event) => updateFilter('provider', event.target.value)}>
              <option value="all">Tất cả provider</option>
              <option value="custom_proxy">Proxy tùy chỉnh</option>
              <option value="ag_proxy">Gemini Proxy AG</option>
              <option value="gemini_direct">Gemini Direct</option>
              <option value="openai_proxy">OpenAI Proxy</option>
            </select>
          </label>
          <label className="usage-filter-control">
            <span>Trạng thái</span>
            <select value={filters.status} disabled={loading} onChange={(event) => updateFilter('status', event.target.value)}>
              <option value="all">Tất cả trạng thái</option>
              <option value="ok">Thành công</option>
              <option value="error">Lỗi</option>
              <option value="blocked">Bị chặn</option>
            </select>
          </label>
          <label className="usage-filter-control">
            <span>Hiển thị</span>
            <select value={filters.limit} disabled={loading} onChange={(event) => updateFilter('limit', event.target.value)}>
              {RANKING_LIMIT_OPTIONS.map((limit) => <option key={limit} value={limit}>Top {limit}</option>)}
            </select>
          </label>
          <button type="button" className="button button--primary" disabled={loading} onClick={applyFilters}>
            <Search size={15} />
            Áp dụng lọc
          </button>
          <button type="button" className="button button--ghost" disabled={loading} onClick={() => onLoadRanking(filters)}>
            <RefreshCw size={15} />
            Tải lại
          </button>
        </div>
      </section>

      <div className="vip-ranking-metrics">
        <VipRankingMetric label="Tổng lượt dùng" value={formatNumber(summary.totalCount)} icon={TrendingUp} tone="info" />
        <VipRankingMetric label="VIP có hoạt động" value={formatNumber(summary.totalUsers)} icon={Users} tone="success" />
        <VipRankingMetric label="Lượt thành công" value={formatNumber(summary.okCount)} icon={Check} tone="success" />
        <VipRankingMetric label="Lỗi hoặc bị chặn" value={formatNumber(summary.issueCount)} icon={AlertTriangle} tone={summary.issueCount > 0 ? 'danger' : 'success'} />
        <VipRankingMetric label="Lần dùng gần nhất" value={formatDate(summary.lastUsedAt)} icon={Activity} tone="neutral" />
      </div>

      <section className="panel panel--table">
        <div className="table-toolbar">
          <div>
            <h2>Bảng xếp hạng tài khoản VIP</h2>
            <span>Sắp xếp theo tổng lượt dùng, sau đó theo lần dùng gần nhất.</span>
          </div>
          <Badge tone="info">{formatNumber(items.length)} dòng</Badge>
        </div>

        {error ? <ErrorState message={error} onRetry={() => onLoadRanking(filters)} /> : null}

        {loading ? (
          <VipRankingSkeleton />
        ) : items.length === 0 ? (
          <EmptyState title="Chưa có dữ liệu VIP phù hợp bộ lọc" text="Thử đổi khoảng thời gian, loại việc hoặc provider để xem thêm dữ liệu." />
        ) : (
          <table className="data-table vip-ranking-table">
            <thead>
              <tr>
                <th>Hạng</th>
                <th>Tài khoản</th>
                <th>Gói</th>
                <th>Tổng lượt</th>
                <th>Request</th>
                <th>Trạng thái</th>
                <th>Loại việc nổi bật</th>
                <th>Lần dùng gần nhất</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.userId || item.email}>
                  <td><span className={`rank-badge ${item.rank <= 3 ? 'is-top' : ''}`}>#{item.rank}</span></td>
                  <td className="vip-ranking-user-cell">
                    <strong>{item.displayName || item.email || item.userId}</strong>
                    <span>{item.email || item.userId}</span>
                  </td>
                  <td><Badge tone={item.planKey === 'lifetime' ? 'warning' : 'info'}>{item.planName || getPlanLabel(item.planKey)}</Badge></td>
                  <td className="numeric-cell">{formatNumber(item.totalCount)}</td>
                  <td className="numeric-cell">{formatNumber(item.eventCount)}</td>
                  <td className="vip-ranking-status-cell">
                    <span>{formatNumber(item.okCount)} thành công</span>
                    <span>{formatNumber(item.issueCount)} lỗi/chặn</span>
                  </td>
                  <td>{item.taskSummary || 'Tác vụ AI'}</td>
                  <td className="numeric-cell">{formatDate(item.lastUsedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </section>
  );
}

function UsagePanel({
  data,
  pagination,
  loading,
  error,
  onLoadPage,
  setUsagePageSize,
}) {
  const [usageQuery, setUsageQuery] = useState('');
  const [providerFilter, setProviderFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const page = pagination?.page || 1;
  const pageSize = pagination?.pageSize || DEFAULT_USAGE_PAGE_SIZE;
  const total = pagination?.total || 0;
  const totalPages = pagination?.totalPages || 0;
  const displayTotalPages = Math.max(1, totalPages);
  const formatter = useMemo(() => new Intl.NumberFormat('vi-VN'), []);
  const hasUsageSearch = Boolean(usageQuery.trim());
  const hasActiveUsageFilters = hasUsageSearch || providerFilter !== 'all' || statusFilter !== 'all';
  const usageItems = data.usage;
  const currentFilters = {
    q: usageQuery.trim(),
    provider: providerFilter,
    status: statusFilter,
  };

  const startRow = total === 0 ? 0 : ((page - 1) * pageSize) + 1;
  const endRow = total === 0 ? 0 : Math.min(total, ((page - 1) * pageSize) + data.usage.length);

  const applyUsageFilters = () => {
    onLoadPage({
      page: 1,
      pageSize,
      ...currentFilters,
      resetCursor: true,
    });
  };

  return (
    <section className="content-grid">
      <div className="section-header">
        <div>
          <h1>Hoạt động người dùng</h1>
          <p>Tất cả hoạt động người dùng được đọc từ usage_events theo phân trang server. Không tải toàn bộ usage cùng lúc để admin vẫn nhanh khi dữ liệu lớn.</p>
        </div>
        <Badge tone="info">{formatter.format(total)} hoạt động</Badge>
      </div>

      <section className="panel panel--table">
        <div className="table-toolbar table-toolbar--split">
          <div className="search-box">
            <Search size={16} />
            <input
              value={usageQuery}
              onChange={(event) => setUsageQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') applyUsageFilters();
              }}
              placeholder="Tìm toàn bộ lịch sử: email, user id, tác vụ, model"
            />
          </div>
          <div className="usage-filter-grid">
            <label className="usage-filter-control">
              <span>Provider</span>
              <select value={providerFilter} disabled={loading} onChange={(event) => setProviderFilter(event.target.value)}>
                <option value="all">Tất cả provider</option>
                <option value="custom_proxy">Proxy tùy chỉnh</option>
                <option value="ag_proxy">Gemini Proxy AG</option>
                <option value="gemini_direct">Gemini Direct</option>
                <option value="openai_proxy">OpenAI Proxy</option>
              </select>
            </label>
            <label className="usage-filter-control">
              <span>Trạng thái</span>
              <select value={statusFilter} disabled={loading} onChange={(event) => setStatusFilter(event.target.value)}>
                <option value="all">Tất cả trạng thái</option>
                <option value="ok">Thành công</option>
                <option value="error">Lỗi</option>
                <option value="blocked">Bị chặn</option>
              </select>
            </label>
            <label className="usage-filter-control">
              <span>Dòng mỗi trang</span>
              <select
                value={pageSize}
                disabled={loading}
                onChange={(event) => setUsagePageSize(Number(event.target.value), currentFilters)}
              >
                <option value={50}>50</option>
                <option value={100}>100</option>
                <option value={200}>200</option>
              </select>
            </label>
            <button type="button" className="button button--primary" disabled={loading} onClick={applyUsageFilters}>
              <Search size={15} />
              Áp dụng lọc
            </button>
            <button type="button" className="button button--ghost" disabled={loading} onClick={() => onLoadPage({ page, pageSize, ...currentFilters })}>
              <RefreshCw size={15} />
              Tải lại hoạt động
            </button>
          </div>
        </div>

        {error ? <ErrorState message={error} onRetry={() => onLoadPage({ page, pageSize })} /> : null}

        <div className="usage-page-summary">
          <span>
            {hasActiveUsageFilters
              ? `Kết quả phù hợp: ${formatter.format(total)} hoạt động`
              : `Hiển thị ${formatter.format(startRow)}-${formatter.format(endRow)} trong ${formatter.format(total)} hoạt động`}
          </span>
          <strong>Trang {formatter.format(page)} / {formatter.format(displayTotalPages)}</strong>
        </div>

        {usageItems.length === 0 ? (
          <EmptyState title="Chưa có hoạt động người dùng" text="Bảng `usage_events` chưa có dữ liệu ở trang hiện tại." />
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Thời gian</th>
                <th>Người dùng</th>
                <th>Tác vụ</th>
                <th>Provider</th>
                <th>Model</th>
                <th>Số lượt</th>
                <th>Trạng thái</th>
              </tr>
            </thead>
            <tbody>
              {usageItems.map((item) => (
                <tr key={item.id || `${item.user_id}-${item.created_at}`}>
                  <td>{formatDate(item.created_at)}</td>
                  <td className="audit-table__primary">
                    <strong>{getUsageUserLabel(item)}</strong>
                    <span>{getIdentityMeta(item.user) || 'Người dùng'}</span>
                  </td>
                  <td>{getUsageTaskLabel(item)}</td>
                  <td>{getUsageProviderLabel(item)}</td>
                  <td>{item.model || 'Không rõ'}</td>
                  <td>{item.count || 0}</td>
                  <td><Badge tone={String(item.status || '').toLowerCase() === 'error' ? 'danger' : 'success'}>{getUsageStatusLabel(item)}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <div className="usage-pagination" aria-label="Phân trang hoạt động người dùng">
          <button
            type="button"
            className="button button--ghost"
            disabled={loading || !pagination?.hasPreviousPage}
            onClick={() => onLoadPage({
              page: page - 1,
              pageSize,
              knownTotal: total,
              ...currentFilters,
            })}
          >
            <ChevronLeft size={16} />
            Trang trước
          </button>
          <span>Trang {formatter.format(page)} / {formatter.format(displayTotalPages)}</span>
          <button
            type="button"
            className="button button--ghost"
            disabled={loading || !pagination?.hasNextPage}
            onClick={() => onLoadPage({
              page: page + 1,
              pageSize,
              cursor: pagination?.nextCursor || '',
              knownTotal: total,
              ...currentFilters,
            })}
          >
            Trang sau
            <ChevronRight size={16} />
          </button>
        </div>
      </section>
    </section>
  );
}

function AdvancedPanel({ data, onMutation, apiBaseUrl, actor }) {
  const canSync = hasPermission(actor, ADMIN_PERMISSIONS.ADMIN_SYNC_AUTH);
  return (
    <section className="content-grid">
      <div className="section-header">
        <div>
          <h1>Nâng cao</h1>
          <p>Đồng bộ Auth, kiểm tra API base và xem usage gần nhất.</p>
        </div>
        <button
          type="button"
          className="button button--primary"
          disabled={!canSync}
          onClick={() => onMutation({
            title: 'Đồng bộ Supabase Auth',
            message: 'Nhập danh sách user từ Supabase Auth vào bảng profiles?',
            action: () => onMutation.api.syncAuth(),
          })}
        >
          <RefreshCw size={16} />
          Đồng bộ Auth
        </button>
      </div>
      <div className="dual-panels">
        <section className="panel">
          <header className="panel-header">
            <h2>Admin API</h2>
            <Badge tone="info">{apiBaseUrl}</Badge>
          </header>
          <div className="key-value-list">
            <span>Route user</span>
            <strong>/users</strong>
            <span>Route access</span>
            <strong>/users/:id/access</strong>
            <span>Route feature</span>
            <strong>/features</strong>
            <span>Route audit</span>
            <strong>/audit</strong>
          </div>
        </section>
        <section className="panel">
          <header className="panel-header">
            <h2>Usage gần nhất</h2>
            <Badge tone="warning">{data.usage.length}</Badge>
          </header>
          {data.usage.length === 0 ? (
            <EmptyState title="Chưa có usage" text="Bảng `usage_events` chưa có dữ liệu để hiển thị." />
          ) : (
            <div className="usage-list">
              {data.usage.slice(0, 8).map((item) => (
                <div className="usage-row" key={item.id || `${item.user_id}-${item.created_at}`}>
                  <Activity size={15} />
                  <strong>{getUsageUserLabel(item)}</strong>
                  <span>{item.count || 0} lượt</span>
                  <span>{getUsageTaskLabel(item)} · {getUsageProviderLabel(item)}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </section>
  );
}

export default function App() {
  const [session, setSession] = useState(null);
  const [authLoading, setAuthLoading] = useState(isSupabaseConfigured());
  const [authError, setAuthError] = useState('');
  const [actor, setActor] = useState(null);
  const [data, setData] = useState(EMPTY_DATA);
  const [usagePagination, setUsagePagination] = useState(EMPTY_USAGE_PAGINATION);
  const [usagePageCursors, setUsagePageCursors] = useState(EMPTY_USAGE_PAGE_CURSORS);
  const [usageLoading, setUsageLoading] = useState(false);
  const [usageError, setUsageError] = useState('');
  const [vipRanking, setVipRanking] = useState(EMPTY_VIP_RANKING);
  const [vipRankingLoading, setVipRankingLoading] = useState(false);
  const [vipRankingError, setVipRankingError] = useState('');
  const [overviewRanking, setOverviewRanking] = useState(EMPTY_VIP_RANKING);
  const [overviewRankingLoading, setOverviewRankingLoading] = useState(false);
  const [overviewRankingError, setOverviewRankingError] = useState('');
  const [activeView, setActiveView] = useState('overview');
  const [selectedUserId, setSelectedUserId] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [pendingConfirm, setPendingConfirm] = useState(null);

  const adminApi = useMemo(() => createAdminApiClient({
    getAccessToken: async () => {
      const current = await getSupabaseClient().auth.getSession();
      return current.data.session?.access_token || '';
    },
  }), []);

  const loadActor = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const me = await adminApi.me();
      setActor(me.actor);
    } catch (error) {
      setLoadError(error.message || 'Could not load admin session.');
      setActor(null);
    } finally {
      setLoading(false);
    }
  }, [adminApi]);

  const loadAdminData = useCallback(async (view = activeView) => {
    setLoading(true);
    setLoadError('');
    try {
      const viewToLoad = view || activeView;
      if (viewToLoad === 'overview') {
        const [users, audit, usage] = await Promise.all([
          adminApi.users(),
          adminApi.audit(),
          adminApi.usage({ page: 1, pageSize: DEFAULT_USAGE_PAGE_SIZE }),
        ]);
        setData((current) => ({
          ...current,
          users: users.users || users.items || [],
          audit: audit.items || [],
          usage: usage.items || [],
        }));
        setUsagePagination(usage.pagination || EMPTY_USAGE_PAGINATION);
        setUsagePageCursors(EMPTY_USAGE_PAGE_CURSORS);
        setUsageError('');
        return;
      }

      if (viewToLoad === 'users') {
        const [users, features] = await Promise.all([
          adminApi.users(),
          adminApi.features(),
        ]);
        setData((current) => ({
          ...current,
          users: users.users || users.items || [],
          features: features.items || [],
        }));
        return;
      }

      if (viewToLoad === 'vip') {
        const catalog = await adminApi.catalog();
        setData((current) => ({
          ...current,
          catalog: catalog.plans || catalog.items || [],
          features: catalog.features || current.features,
          planFeatures: catalog.planFeatures || [],
          consent: catalog.consentVersions || current.consent,
        }));
        return;
      }

      if (viewToLoad === 'announcement') {
        const announcement = await adminApi.announcement();
        setData((current) => ({
          ...current,
          announcement: announcement.announcement || null,
        }));
        return;
      }

      if (viewToLoad === 'features') {
        const [features, catalog] = await Promise.all([
          adminApi.features(),
          adminApi.catalog(),
        ]);
        setData((current) => ({
          ...current,
          features: features.items || [],
          catalog: catalog.plans || catalog.items || current.catalog,
          planFeatures: catalog.planFeatures || [],
        }));
        return;
      }

      if (viewToLoad === 'consent') {
        const consent = await adminApi.consent();
        setData((current) => ({
          ...current,
          consent: consent.items || [],
        }));
        return;
      }

      if (viewToLoad === 'audit') {
        const audit = await adminApi.audit();
        setData((current) => ({
          ...current,
          audit: audit.items || [],
        }));
        return;
      }

      if (viewToLoad === 'usage' || viewToLoad === 'advanced') {
        const usage = await adminApi.usage({ page: 1, pageSize: DEFAULT_USAGE_PAGE_SIZE });
        setData((current) => ({
          ...current,
          usage: usage.items || [],
        }));
        setUsagePagination(usage.pagination || EMPTY_USAGE_PAGINATION);
        setUsagePageCursors(EMPTY_USAGE_PAGE_CURSORS);
        setUsageError('');
        return;
      }

      if (viewToLoad === 'vip-ranking') {
        return;
      }

      if (viewToLoad === 'story-mirror') {
        return;
      }
    } catch (error) {
      setLoadError(error.message || 'Không tải được dữ liệu admin.');
    } finally {
      setLoading(false);
    }
  }, [activeView, adminApi]);

  const loadUsagePage = useCallback(async ({
    page = 1,
    pageSize = DEFAULT_USAGE_PAGE_SIZE,
    q = '',
    provider = 'all',
    status = 'all',
    cursor,
    knownTotal = usagePagination.total,
    resetCursor = false,
  } = {}) => {
    setUsageLoading(true);
    setUsageError('');
    const nextCursor = page <= 1 || resetCursor
      ? ''
      : (cursor ?? usagePageCursors[page] ?? '');
    try {
      const usage = await adminApi.usage({
        page,
        pageSize,
        q,
        provider,
        status,
        cursor: nextCursor,
        knownTotal,
      });
      setData((current) => ({
        ...current,
        usage: usage.items || [],
      }));
      const pagination = usage.pagination || {
        ...EMPTY_USAGE_PAGINATION,
        page,
        pageSize,
      };
      setUsagePagination(pagination);
      setUsagePageCursors((current) => {
        const base = resetCursor || page <= 1 ? { ...EMPTY_USAGE_PAGE_CURSORS } : { ...current };
        base[page] = nextCursor;
        if (pagination.nextCursor) base[page + 1] = pagination.nextCursor;
        return base;
      });
    } catch (error) {
      setUsageError(error.message || 'Không tải được hoạt động người dùng.');
    } finally {
      setUsageLoading(false);
    }
  }, [adminApi, usagePageCursors, usagePagination.total]);

  const setUsagePageSize = useCallback((pageSize, filters = {}) => {
    loadUsagePage({ page: 1, pageSize, ...filters, resetCursor: true });
  }, [loadUsagePage]);

  const loadVipRanking = useCallback(async (filters = DEFAULT_VIP_RANKING_FILTERS) => {
    setVipRankingLoading(true);
    setVipRankingError('');
    try {
      const ranking = await adminApi.usageRanking(filters);
      setVipRanking({
        ...EMPTY_VIP_RANKING,
        ...ranking,
        items: ranking.items || [],
        summary: ranking.summary || EMPTY_VIP_RANKING.summary,
      });
    } catch (error) {
      setVipRankingError(error.message || 'Không tải được bảng xếp hạng VIP.');
    } finally {
      setVipRankingLoading(false);
    }
  }, [adminApi]);

  const loadOverviewRanking = useCallback(async () => {
    setOverviewRankingLoading(true);
    setOverviewRankingError('');
    try {
      const ranking = await adminApi.usageRanking({
        ...DEFAULT_VIP_RANKING_FILTERS,
        limit: OVERVIEW_VIP_RANKING_LIMIT,
      });
      setOverviewRanking({
        ...EMPTY_VIP_RANKING,
        ...ranking,
        items: ranking.items || [],
        summary: ranking.summary || EMPTY_VIP_RANKING.summary,
      });
    } catch (error) {
      setOverviewRankingError(error.message || 'Không tải được Top VIP 30 ngày.');
    } finally {
      setOverviewRankingLoading(false);
    }
  }, [adminApi]);

  useEffect(() => {
    if (!isSupabaseConfigured()) return undefined;
    const client = getSupabaseClient();
    let mounted = true;
    client.auth.getSession()
      .then(({ data: authData }) => {
        if (!mounted) return;
        setSession(authData.session || null);
        setAuthLoading(false);
      })
      .catch((error) => {
        if (!mounted) return;
        setAuthError(error.message || 'Không đọc được phiên đăng nhập.');
        setAuthLoading(false);
      });

    const { data: listener } = client.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession || null);
    });

    return () => {
      mounted = false;
      listener?.subscription?.unsubscribe?.();
    };
  }, []);

  useEffect(() => {
    if (session) loadActor();
  }, [session, loadActor]);

  useEffect(() => {
    if (session && actor) loadAdminData();
  }, [session, actor, loadAdminData]);

  useEffect(() => {
    if (!session || !actor) return;
    if (activeView === 'overview') loadOverviewRanking();
    if (activeView === 'vip-ranking') loadVipRanking(DEFAULT_VIP_RANKING_FILTERS);
  }, [activeView, actor, loadOverviewRanking, loadVipRanking, session]);

  const login = async () => {
    setAuthLoading(true);
    setAuthError('');
    try {
      const { error } = await getSupabaseClient().auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: window.location.origin },
      });
      if (error) throw error;
    } catch (error) {
      setAuthError(error.message || 'Không mở được đăng nhập Google.');
      setAuthLoading(false);
    }
  };

  const logout = async () => {
    await getSupabaseClient().auth.signOut();
    setActor(null);
    setData(EMPTY_DATA);
    setUsagePagination(EMPTY_USAGE_PAGINATION);
    setUsagePageCursors(EMPTY_USAGE_PAGE_CURSORS);
    setUsageError('');
    setVipRanking(EMPTY_VIP_RANKING);
    setVipRankingLoading(false);
    setVipRankingError('');
    setOverviewRanking(EMPTY_VIP_RANKING);
    setOverviewRankingLoading(false);
    setOverviewRankingError('');
  };

  const openMutationConfirm = (config) => {
    setPendingConfirm(config);
  };
  openMutationConfirm.api = adminApi;

  const confirmMutation = async () => {
    if (!pendingConfirm) return;
    const action = pendingConfirm.action;
    setPendingConfirm(null);
    setLoading(true);
    setLoadError('');
    try {
      await action();
      await loadAdminData();
    } catch (error) {
      setLoadError(error.message || 'Không thực hiện được thao tác admin.');
    } finally {
      setLoading(false);
    }
  };

  if (!isSupabaseConfigured()) return <SetupScreen />;
  if (!session) return <LoginScreen onLogin={login} authError={authError} loading={authLoading} />;

  const panel = (() => {
    if (activeView === 'overview') {
      return (
        <OverviewPanel
          data={data}
          apiBaseUrl={adminApi.baseUrl}
          onSelectView={setActiveView}
          ranking={overviewRanking}
          rankingLoading={overviewRankingLoading}
          rankingError={overviewRankingError}
        />
      );
    }
    if (activeView === 'users') return <UsersPanel data={data} selectedUserId={selectedUserId} setSelectedUserId={setSelectedUserId} onMutation={openMutationConfirm} actor={actor} />;
    if (activeView === 'vip') return <VipPanel data={data} onMutation={openMutationConfirm} actor={actor} />;
    if (activeView === 'announcement') return <AnnouncementPanel data={data} onMutation={openMutationConfirm} actor={actor} />;
    if (activeView === 'story-mirror') return <StoryMirrorPage adminApi={adminApi} actor={actor} />;
    if (activeView === 'features') return <FeaturesPanel data={data} onMutation={openMutationConfirm} actor={actor} />;
    if (activeView === 'consent') return <ConsentPanel data={data} />;
    if (activeView === 'audit') return <AuditPanel data={data} />;
    if (activeView === 'vip-ranking') {
      return (
        <VipRankingPanel
          ranking={vipRanking}
          loading={vipRankingLoading}
          error={vipRankingError}
          onLoadRanking={loadVipRanking}
        />
      );
    }
    if (activeView === 'usage') {
      return (
        <UsagePanel
          data={data}
          pagination={usagePagination}
          loading={usageLoading}
          error={usageError}
          onLoadPage={loadUsagePage}
          setUsagePageSize={setUsagePageSize}
        />
      );
    }
    return <AdvancedPanel data={data} onMutation={openMutationConfirm} apiBaseUrl={adminApi.baseUrl} actor={actor} />;
  })();

  return (
    <AppShell actor={actor} activeView={activeView} onSelectView={setActiveView} onLogout={logout}>
      <main className="admin-main">
        <header className="topbar">
          <div>
            <span>Admin riêng</span>
            <strong>StoryForge quản trị</strong>
          </div>
          <button type="button" className="button button--ghost" onClick={loadAdminData} disabled={loading}>
            <RefreshCw size={15} />
            {loading ? 'Đang tải' : 'Tải lại'}
          </button>
        </header>
        {loadError ? <ErrorState message={loadError} onRetry={loadAdminData} /> : null}
        {panel}
      </main>
      <ConfirmDialog pending={pendingConfirm} onCancel={() => setPendingConfirm(null)} onConfirm={confirmMutation} />
    </AppShell>
  );
}
