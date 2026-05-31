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
  Layers3,
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
  ADMIN_ROLES,
  PLAN_LABELS_VI,
  ROLE_LABELS_VI,
  STATUS_LABELS_VI,
  hasPermission,
  ADMIN_PERMISSIONS,
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

function formatDate(value) {
  if (!value) return 'Chưa có';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('vi-VN', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date);
}

function getUserId(user) {
  return user?.user_id || user?.id || '';
}

function getUserEmail(user) {
  return user?.email || user?.user_email || 'Chưa có email';
}

function getPlanLabel(plan) {
  return PLAN_LABELS_VI[String(plan || 'free').toLowerCase()] || String(plan || 'free');
}

function getRoleLabel(role) {
  return ROLE_LABELS_VI[String(role || 'user').toLowerCase()] || 'Người dùng';
}

function getStatusLabel(status) {
  return STATUS_LABELS_VI[String(status || 'active').toLowerCase()] || String(status || 'active');
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
        <p>Đăng nhập bằng tài khoản đã được cấp role support, admin hoặc owner.</p>
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
  const vipUsers = data.users.filter((user) => ['vip', 'pro', 'enterprise'].includes(String(user.plan || '').toLowerCase())).length;
  const enabledFeatures = data.features.filter((feature) => feature.enabled !== false).length;
  const recentAudit = data.audit.slice(0, 5);

  return (
    <section className="content-grid">
      <div className="section-header">
        <div>
          <h1>Tổng quan</h1>
          <p>Trạng thái quản trị người dùng, gói và tính năng của StoryForge.</p>
        </div>
        <Badge tone="info">{apiBaseUrl}</Badge>
      </div>
      <div className="metric-grid">
        <Metric label="Người dùng active" value={activeUsers} icon={Users} tone="success" />
        <Metric label="Tài khoản VIP+" value={vipUsers} icon={Sparkles} tone="warning" />
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
          <EmptyState title="Chưa có nhật ký" text="Các mutation nhạy cảm sẽ xuất hiện ở đây." />
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
  const users = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return data.users;
    return data.users.filter((user) => [
      getUserEmail(user),
      getUserId(user),
      user.plan,
      user.role,
      user.status,
    ].some((value) => String(value || '').toLowerCase().includes(needle)));
  }, [data.users, query]);
  const selected = users.find((user) => getUserId(user) === selectedUserId) || users[0] || null;

  useEffect(() => {
    if (!selectedUserId && selected) setSelectedUserId(getUserId(selected));
  }, [selected, selectedUserId, setSelectedUserId]);

  const canMutatePlan = hasPermission(actor, ADMIN_PERMISSIONS.USERS_PLAN_UPDATE);
  const canMutateStatus = hasPermission(actor, ADMIN_PERMISSIONS.USERS_STATUS_UPDATE);
  const canMutateAccess = hasPermission(actor, ADMIN_PERMISSIONS.USERS_ROLE_UPDATE);

  return (
    <section className="content-grid">
      <div className="section-header">
        <div>
          <h1>Người dùng</h1>
          <p>Quét nhanh trạng thái, role, gói và quyền truy cập.</p>
        </div>
        <div className="search-box">
          <Search size={16} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm email, role, gói" />
        </div>
      </div>
      <div className="split-layout">
        <section className="panel panel--table">
          {users.length === 0 ? (
            <EmptyState title="Chưa có người dùng" text="Dùng Sync Auth ở mục Nâng cao để nhập danh sách từ Supabase Auth." />
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
                      <td><Badge tone={user.role === 'owner' ? 'danger' : 'info'}>{getRoleLabel(user.role)}</Badge></td>
                      <td><Badge tone={String(user.plan || 'free') === 'free' ? 'neutral' : 'warning'}>{getPlanLabel(user.plan)}</Badge></td>
                      <td><Badge tone={String(user.status || 'active') === 'active' ? 'success' : 'danger'}>{getStatusLabel(user.status)}</Badge></td>
                      <td>{formatDate(user.updated_at || user.access_updated_at || user.plan_updated_at)}</td>
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
                  <span>{getUserId(selected)}</span>
                </div>
              </header>
              <label>
                <span>Gói</span>
                <select
                  value={selected.plan || 'free'}
                  disabled={!canMutatePlan}
                  onChange={(event) => onMutation({
                    title: 'Cập nhật gói người dùng',
                    message: `Đổi gói của ${getUserEmail(selected)} sang ${getPlanLabel(event.target.value)}?`,
                    action: () => onMutation.api.updateUserPlan(getUserId(selected), event.target.value),
                  })}
                >
                  {Object.keys(PLAN_LABELS_VI).map((plan) => <option key={plan} value={plan}>{PLAN_LABELS_VI[plan]}</option>)}
                </select>
              </label>
              <label>
                <span>Trạng thái</span>
                <select
                  value={selected.status || 'active'}
                  disabled={!canMutateStatus}
                  onChange={(event) => onMutation({
                    title: 'Cập nhật trạng thái',
                    message: `Đổi trạng thái của ${getUserEmail(selected)} sang ${getStatusLabel(event.target.value)}?`,
                    action: () => onMutation.api.updateUserStatus(getUserId(selected), event.target.value),
                  })}
                >
                  {Object.keys(STATUS_LABELS_VI).map((status) => <option key={status} value={status}>{STATUS_LABELS_VI[status]}</option>)}
                </select>
              </label>
              <label>
                <span>Vai trò</span>
                <select
                  value={selected.role || 'user'}
                  disabled={!canMutateAccess}
                  onChange={(event) => onMutation({
                    title: 'Cập nhật quyền truy cập',
                    message: `Đổi role của ${getUserEmail(selected)} sang ${getRoleLabel(event.target.value)}?`,
                    action: () => onMutation.api.updateUserAccess(getUserId(selected), event.target.value),
                  })}
                >
                  {Object.values(ADMIN_ROLES).map((role) => <option key={role} value={role}>{ROLE_LABELS_VI[role]}</option>)}
                </select>
              </label>
              <div className="detail-meta">
                <span>Lần đăng nhập: {formatDate(selected.last_seen_at)}</span>
                <span>Cập nhật auth: {formatDate(selected.auth_updated_at)}</span>
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

function VipPanel({ data }) {
  return (
    <section className="content-grid">
      <div className="section-header">
        <div>
          <h1>Gói VIP</h1>
          <p>Danh mục gói đang dùng cho cấp quyền và giới hạn tính năng.</p>
        </div>
      </div>
      <section className="panel">
        {data.catalog.length === 0 ? (
          <EmptyState title="Chưa có catalog" text="Tạo dữ liệu `storyforge_plan_catalog` trong Supabase để hiển thị gói." />
        ) : (
          <div className="plan-grid">
            {data.catalog.map((plan) => (
              <article className="plan-tile" key={plan.id || plan.key}>
                <header>
                  <BookOpen size={18} />
                  <strong>{plan.name || getPlanLabel(plan.key)}</strong>
                </header>
                <p>{plan.description || 'Chưa có mô tả.'}</p>
                <Badge tone={plan.enabled === false ? 'neutral' : 'success'}>{plan.enabled === false ? 'Tắt' : 'Đang bật'}</Badge>
              </article>
            ))}
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
          <p>Điều khiển feature flag và mapping gói theo từng capability.</p>
        </div>
      </div>
      <div className="dual-panels">
        <section className="panel">
          <header className="panel-header">
            <h2>Feature flags</h2>
            <Badge tone="info">{data.features.length}</Badge>
          </header>
          {data.features.length === 0 ? (
            <EmptyState title="Chưa có feature" text="Bảng `storyforge_features` chưa có dữ liệu." />
          ) : (
            <div className="feature-list">
              {data.features.map((feature) => {
                const id = feature.id || feature.key;
                const enabled = feature.enabled !== false;
                return (
                  <div className="feature-row" key={id}>
                    <div>
                      <strong>{feature.name || feature.key}</strong>
                      <span>{feature.description || feature.category || 'Feature'}</span>
                    </div>
                    <button
                      type="button"
                      className={`toggle ${enabled ? 'is-on' : ''}`}
                      disabled={!canWriteFeature}
                      aria-pressed={enabled}
                      onClick={() => onMutation({
                        title: enabled ? 'Tắt feature' : 'Bật feature',
                        message: `${enabled ? 'Tắt' : 'Bật'} ${feature.name || feature.key}?`,
                        action: () => onMutation.api.updateFeature(id, { enabled: !enabled }),
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
            <EmptyState title="Chưa có mapping" text="Bảng `storyforge_plan_features` chưa có dữ liệu." />
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
                  const id = item.id || `${item.plan}-${item.feature_key}`;
                  const enabled = item.enabled !== false;
                  return (
                    <tr key={id}>
                      <td>{getPlanLabel(item.plan)}</td>
                      <td>{item.feature_key || item.featureKey}</td>
                      <td>
                        <button
                          type="button"
                          className={`status-button ${enabled ? 'is-on' : ''}`}
                          disabled={!canWritePlanFeature}
                          onClick={() => onMutation({
                            title: 'Cập nhật tính năng trong gói',
                            message: `${enabled ? 'Tắt' : 'Bật'} feature này trong gói ${getPlanLabel(item.plan)}?`,
                            action: () => onMutation.api.updatePlanFeature(id, { enabled: !enabled }),
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
          <p>Theo dõi consent, phiên bản điều khoản và trạng thái xác nhận.</p>
        </div>
      </div>
      <section className="panel panel--table">
        {data.consent.length === 0 ? (
          <EmptyState title="Chưa có consent" text="Chưa ghi nhận điều khoản nào từ người dùng." />
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Người dùng</th>
                <th>Loại</th>
                <th>Phiên bản</th>
                <th>Trạng thái</th>
                <th>Thời gian</th>
              </tr>
            </thead>
            <tbody>
              {data.consent.map((item) => (
                <tr key={item.id || `${item.user_id}-${item.created_at}`}>
                  <td>{item.email || item.user_id}</td>
                  <td>{item.kind || 'adult_content'}</td>
                  <td>{item.version || 'v1'}</td>
                  <td><Badge tone={item.accepted ? 'success' : 'danger'}>{item.accepted ? 'Đã đồng ý' : 'Từ chối'}</Badge></td>
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

function AuditPanel({ data }) {
  return (
    <section className="content-grid">
      <div className="section-header">
        <div>
          <h1>Nhật ký</h1>
          <p>Audit log cho mutation nhạy cảm trong admin console.</p>
        </div>
      </div>
      <section className="panel panel--table">
        {data.audit.length === 0 ? (
          <EmptyState title="Chưa có audit log" text="Các thao tác cập nhật role, gói, feature sẽ được ghi lại." />
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
                  <td>{item.target_type}:{item.target_id}</td>
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
            message: 'Nhập danh sách user từ Supabase Auth vào bảng access quản trị?',
            action: () => onMutation.api.syncAuth(),
          })}
        >
          <RefreshCw size={16} />
          Sync Auth
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
            <EmptyState title="Chưa có usage" text="Bảng usage chưa có dữ liệu để hiển thị." />
          ) : (
            <div className="usage-list">
              {data.usage.slice(0, 8).map((item) => (
                <div className="usage-row" key={item.id || `${item.user_id}-${item.period}`}>
                  <Activity size={15} />
                  <strong>{item.email || item.user_id}</strong>
                  <span>{item.requests || 0} request</span>
                  <span>{item.tokens || 0} token</span>
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
      const [users, catalog, audit, usage, features, planFeatures, consent] = await Promise.all([
        adminApi.users(),
        adminApi.catalog(),
        adminApi.audit(),
        adminApi.usage(),
        adminApi.features(),
        adminApi.planFeatures(),
        adminApi.consent(),
      ]);

      setActor(me.actor);
      setData({
        users: users.items || [],
        catalog: catalog.items || [],
        audit: audit.items || [],
        usage: usage.items || [],
        features: features.items || [],
        planFeatures: planFeatures.items || [],
        consent: consent.items || [],
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
    if (activeView === 'vip') return <VipPanel data={data} />;
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
