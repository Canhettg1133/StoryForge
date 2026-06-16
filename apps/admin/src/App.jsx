import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  BookOpen,
  Check,
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
  normalizeVipPageContent,
} from '@storyforge/access';
import { createAdminApiClient } from './adminApi.js';
import { getSupabaseClient, isSupabaseConfigured } from './supabase.js';

const NAV_ITEMS = [
  { id: 'overview', label: 'Tổng quan', icon: Gauge },
  { id: 'users', label: 'Người dùng', icon: Users },
  { id: 'vip', label: 'Gói VIP', icon: Sparkles },
  { id: 'features', label: 'Tính năng trong gói', icon: SlidersHorizontal },
  { id: 'consent', label: 'Điều khoản 18+', icon: ShieldCheck },
  { id: 'audit', label: 'Nhật ký', icon: FileClock },
  { id: 'advanced', label: 'Nâng cao', icon: Database },
];

const EMPTY_DATA = {
  users: [],
  catalog: [],
  audit: [],
  usage: [],
  features: [],
  planFeatures: [],
  consent: [],
};

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
  const plans = Array.isArray(user?.user_plans) ? user.user_plans : [];
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
          {NAV_ITEMS.map((item) => {
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

function OverviewPanel({ data, actor, apiBaseUrl, onSelectView }) {
  const activeUsers = data.users.filter((user) => String(user.status || 'active') === 'active').length;
  const vipUsers = data.users.filter((user) => ['vip', 'lifetime'].includes(getCurrentUserPlanKey(user))).length;
  const enabledFeatures = data.features.filter((feature) => feature.active !== false).length;
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
        <Metric label="Feature đang bật" value={enabledFeatures} icon={SlidersHorizontal} tone="info" />
        <Metric label="Quyền hiện tại" value={getRoleLabel(actor?.role)} icon={ShieldCheck} tone="danger" />
      </div>
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
                <span>{item.action || 'audit'}</span>
                <strong>{item.actor_email || item.actor_user_id || 'system'}</strong>
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
  const [planForm, setPlanForm] = useState(DEFAULT_PLAN_FORM);
  const [overrideForm, setOverrideForm] = useState(DEFAULT_OVERRIDE_FORM);
  const [accessCheck, setAccessCheck] = useState(null);
  const [accessLoading, setAccessLoading] = useState(false);
  const [accessError, setAccessError] = useState('');

  const users = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return data.users;
    return data.users.filter((user) => [
      getUserEmail(user),
      getUserId(user),
      getCurrentUserPlanKey(user),
      user.system_role || user.role,
      user.status,
    ].some((value) => String(value || '').toLowerCase().includes(needle)));
  }, [data.users, query]);
  const selected = users.find((user) => getUserId(user) === selectedUserId) || users[0] || null;
  const selectedId = selected ? getUserId(selected) : '';

  useEffect(() => {
    if (!selectedUserId && selected) setSelectedUserId(getUserId(selected));
  }, [selected, selectedUserId, setSelectedUserId]);

  useEffect(() => {
    setAccessCheck(null);
    setAccessError('');
  }, [selectedId]);

  const canMutatePlan = hasPermission(actor, ADMIN_PERMISSIONS.USERS_PLAN_UPDATE);
  const canMutateStatus = hasPermission(actor, ADMIN_PERMISSIONS.USERS_STATUS_UPDATE);
  const canMutateAccess = hasPermission(actor, ADMIN_PERMISSIONS.USERS_ROLE_UPDATE);
  const canMutateOverride = hasPermission(actor, ADMIN_PERMISSIONS.USERS_OVERRIDE_UPDATE);

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

  return (
    <section className="content-grid">
      <div className="section-header">
        <div>
          <h1>Người dùng</h1>
          <p>Quét nhanh trạng thái, role, gói và quyền truy cập. Chọn một dòng để thao tác ở panel bên phải.</p>
        </div>
        <div className="search-box">
          <Search size={16} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm email, role, gói" />
        </div>
      </div>
      <div className="split-layout">
        <section className="panel panel--table">
          {users.length === 0 ? (
            <EmptyState title="Chưa có người dùng" text="Dùng đồng bộ Auth ở mục Nâng cao để nhập danh sách từ Supabase Auth." />
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Gói</th>
                  <th>Trạng thái</th>
                  <th>Cập nhật</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => {
                  const userId = getUserId(user);
                  const planKey = getCurrentUserPlanKey(user);
                  return (
                    <tr
                      key={userId}
                      className={selected && getUserId(selected) === userId ? 'is-selected' : ''}
                      onClick={() => setSelectedUserId(userId)}
                    >
                      <td>
                        <strong>{getUserEmail(user)}</strong>
                        <span>{userId}</span>
                      </td>
                      <td><Badge tone={(user.system_role || user.role) === 'owner' ? 'danger' : 'info'}>{getRoleLabel(user.system_role || user.role)}</Badge></td>
                      <td><Badge tone={planKey === 'free' ? 'neutral' : 'warning'}>{getPlanLabel(planKey)}</Badge></td>
                      <td><Badge tone={String(user.status || 'active') === 'active' ? 'success' : 'danger'}>{getStatusLabel(user.status)}</Badge></td>
                      <td>{formatDate(user.updated_at || user.metadata?.auth_updated_at)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>
        <aside className="detail-panel">
          {selected ? (
            <>
              <header>
                <UserCog size={20} />
                <div>
                  <h2>{getUserEmail(selected)}</h2>
                  <span>{selectedId}</span>
                </div>
              </header>

              <section className="detail-section">
                <h3>Thao tác nhanh</h3>
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
  return (
    <section className="content-grid">
      <div className="section-header">
        <div>
          <h1>Nhật ký</h1>
          <p>Audit log cho thao tác nhạy cảm trong admin console.</p>
        </div>
      </div>
      <section className="panel panel--table">
        {data.audit.length === 0 ? (
          <EmptyState title="Chưa có audit log" text="Các thao tác cập nhật role, gói và feature sẽ được ghi lại." />
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Hành động</th>
                <th>Actor</th>
                <th>Đối tượng</th>
                <th>Thời gian</th>
              </tr>
            </thead>
            <tbody>
              {data.audit.map((item) => (
                <tr key={item.id || `${item.action}-${item.created_at}`}>
                  <td><strong>{item.action}</strong></td>
                  <td>{item.actor_email || item.actor_user_id}</td>
                  <td>{item.target_user_id || item.target_feature_key || 'hệ thống'}</td>
                  <td>{formatDate(item.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
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
                  <strong>{item.email || item.user_id}</strong>
                  <span>{item.count || 0} lượt</span>
                  <span>{item.feature_key || item.provider || 'access'}</span>
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

  const loadAdminData = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const me = await adminApi.me();
      const [users, catalog, audit, usage, features, consent] = await Promise.all([
        adminApi.users(),
        adminApi.catalog(),
        adminApi.audit(),
        adminApi.usage(),
        adminApi.features(),
        adminApi.consent(),
      ]);

      setActor(me.actor);
      setData({
        users: users.users || users.items || [],
        catalog: catalog.plans || catalog.items || [],
        audit: audit.items || [],
        usage: usage.items || [],
        features: features.items || catalog.features || [],
        planFeatures: catalog.planFeatures || [],
        consent: consent.items || catalog.consentVersions || [],
      });
    } catch (error) {
      setLoadError(error.message || 'Không tải được dữ liệu admin.');
      setActor(null);
    } finally {
      setLoading(false);
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
    if (session) loadAdminData();
  }, [session, loadAdminData]);

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
    if (activeView === 'overview') return <OverviewPanel data={data} actor={actor} apiBaseUrl={adminApi.baseUrl} onSelectView={setActiveView} />;
    if (activeView === 'users') return <UsersPanel data={data} selectedUserId={selectedUserId} setSelectedUserId={setSelectedUserId} onMutation={openMutationConfirm} actor={actor} />;
    if (activeView === 'vip') return <VipPanel data={data} onMutation={openMutationConfirm} actor={actor} />;
    if (activeView === 'features') return <FeaturesPanel data={data} onMutation={openMutationConfirm} actor={actor} />;
    if (activeView === 'consent') return <ConsentPanel data={data} />;
    if (activeView === 'audit') return <AuditPanel data={data} />;
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
