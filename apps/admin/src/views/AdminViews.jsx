import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Bell,
  BookOpen,
  Check,
  ChevronLeft,
  ChevronRight,
  Database,
  FileClock,
  RefreshCw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Trophy,
  TrendingUp,
  UserCog,
  Users,
  X,
} from 'lucide-react';
import {
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
import {
  DEFAULT_OVERRIDE_FORM,
  DEFAULT_PLAN_FORM,
  DEFAULT_USAGE_PAGE_SIZE,
  DEFAULT_VIP_RANKING_FILTERS,
  EMPTY_VIP_RANKING,
  RANKING_LIMIT_OPTIONS,
  RANKING_PLAN_OPTIONS,
  RANKING_RANGE_OPTIONS,
  RANKING_TASK_OPTIONS,
} from '../constants/adminDefaults.js';
import { Badge, EmptyState, ErrorState, Metric } from '../components/ui/AdminPrimitives.jsx';
import {
  explainDecision,
  formatDate,
  formatNumber,
  getActiveUserPlan,
  getAuditActorLabel,
  getAuditDetails,
  getAuditKey,
  getAuditStatusLabel,
  getAuditSummary,
  getAuditTargetLabel,
  getCurrentUserPlanKey,
  getFeatureKey,
  getFeatureName,
  getIdentityMeta,
  getPlanFeaturePlanKey,
  getPlanFeatureRows,
  getPlanKey,
  getPlanLabel,
  getPlanVipPageContent,
  getRoleLabel,
  getStatusLabel,
  getUsageProviderLabel,
  getUsageStatusLabel,
  getUsageTaskLabel,
  getUsageUserLabel,
  getUserEmail,
  getUserId,
  getUserManagementStats,
  getUserPlanExpiryLabel,
  getUserPlanExpiryShortLabel,
  getUserPlanStatusLabel,
  getUserPlanStatusTone,
  getVisibleUserPlans,
  isActivePlanExpiringSoon,
  isToday,
  matchesUserPlanExpiryFilter,
  sortUsersByPlanExpiry,
  summarizeLimits,
  toPrettyJson,
} from '../utils/adminFormatters.js';

function OverviewDeferredReports({ onSelectView }) {
  const error = '';
  const loading = false;
  const items = [];

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

export function OverviewPanel({ data, apiBaseUrl, onSelectView }) {
  const userSummary = data.overview?.users?.summary || {};
  const activeUsersFallback = data.users.filter((user) => String(user.status || 'active') === 'active').length;
  const vipUsersFallback = data.users.filter((user) => ['vip', 'lifetime'].includes(getCurrentUserPlanKey(user))).length;
  const activeUsers = userSummary.active ?? userSummary.byStatus?.active ?? activeUsersFallback;
  const vipUsers = userSummary.vip ?? vipUsersFallback;
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
      <OverviewDeferredReports onSelectView={onSelectView} />
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

export function UsersPanel({ data, selectedUserId, setSelectedUserId, onMutation, actor }) {
  const [query, setQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [planFilter, setPlanFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [expiryFilter, setExpiryFilter] = useState('all');
  const [planForm, setPlanForm] = useState(DEFAULT_PLAN_FORM);
  const [vipExtension, setVipExtension] = useState({ amount: '30', unit: 'day' });
  const [overrideForm, setOverrideForm] = useState(DEFAULT_OVERRIDE_FORM);
  const [accessCheck, setAccessCheck] = useState(null);
  const [accessLoading, setAccessLoading] = useState(false);
  const [accessError, setAccessError] = useState('');

  const users = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filteredUsers = data.users.filter((user) => {
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
        && (statusFilter === 'all' || status === statusFilter)
        && matchesUserPlanExpiryFilter(user, expiryFilter);
    });
    return expiryFilter === 'all' ? filteredUsers : sortUsersByPlanExpiry(filteredUsers);
  }, [data.users, expiryFilter, planFilter, query, roleFilter, statusFilter]);
  const selected = users.find((user) => getUserId(user) === selectedUserId) || users[0] || null;
  const selectedId = selected ? getUserId(selected) : '';
  const hasUserFilters = Boolean(query.trim())
    || roleFilter !== 'all'
    || planFilter !== 'all'
    || statusFilter !== 'all'
    || expiryFilter !== 'all';
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
  const vipExtensionAmount = Number(vipExtension.amount);
  const vipExtensionMax = vipExtension.unit === 'month' ? 120 : 3650;
  const vipExtensionValid = Number.isInteger(vipExtensionAmount)
    && vipExtensionAmount >= 1
    && vipExtensionAmount <= vipExtensionMax;
  const quickGrantPlanActions = selected ? [
    {
      key: 'vip-30',
      label: 'Cấp VIP 30 ngày',
      shortLabel: 'VIP 30 ngày',
      title: 'Cấp VIP 30 ngày',
      message: `Cấp VIP 30 ngày cho ${getUserEmail(selected)}?`,
      body: () => ({ operation: 'extend', planKey: 'vip', amount: 30, unit: 'day' }),
      tone: 'primary',
    },
    {
      key: 'vip-90',
      label: 'Cấp VIP 90 ngày',
      shortLabel: 'VIP 90 ngày',
      title: 'Cấp VIP 90 ngày',
      message: `Cấp VIP 90 ngày cho ${getUserEmail(selected)}?`,
      body: () => ({ operation: 'extend', planKey: 'vip', amount: 90, unit: 'day' }),
      tone: 'primary',
    },
    {
      key: 'lifetime',
      label: 'Cấp trọn đời',
      shortLabel: 'Trọn đời',
      title: 'Cấp trọn đời',
      message: `Cấp gói trọn đời cho ${getUserEmail(selected)}?`,
      body: () => ({ operation: 'set', planKey: 'lifetime' }),
      tone: 'primary',
    },
  ] : [];
  const quickPlanActions = selected ? [
    ...quickGrantPlanActions,
    {
      key: 'cancel-current',
      label: 'Hủy gói hiện tại',
      title: 'Hủy gói hiện tại',
      message: `Hủy gói hiện tại của ${getUserEmail(selected)}?`,
      body: () => ({ operation: 'cancel_current' }),
      tone: 'danger',
    },
    {
      key: 'cancel-scheduled',
      label: 'Hủy gói đã đặt lịch',
      title: 'Hủy gói đã đặt lịch',
      message: `Hủy gói đã đặt lịch của ${getUserEmail(selected)}?`,
      body: () => ({ operation: 'cancel_scheduled' }),
      tone: 'danger',
    },
  ] : [];
  const runQuickPlanAction = (action) => runPlanOperation(action.title, action.message, action.body());

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
          <label>
            <span>Lọc hạn VIP</span>
            <select value={expiryFilter} onChange={(event) => setExpiryFilter(event.target.value)}>
              <option value="all">Tất cả thời hạn</option>
              <option value="expiring_7">Sắp hết trong 7 ngày</option>
              <option value="expiring_30">Sắp hết trong 30 ngày</option>
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
              setExpiryFilter('all');
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
      {selected ? (
        <section className="user-mobile-action-strip" aria-label="Cấp VIP nhanh cho người dùng đang chọn">
          <div className="user-mobile-action-strip__summary">
            <span>Cấp VIP nhanh</span>
            <strong>{selectedEmail}</strong>
            <Badge tone={getUserPlanStatusTone(activePlan)}>{getPlanLabel(currentPlanKey)}</Badge>
          </div>
          <div className="user-mobile-action-strip__buttons">
            {quickGrantPlanActions.map((action) => (
              <button
                type="button"
                key={action.key}
                className="button button--primary"
                disabled={!canMutatePlan}
                onClick={() => runQuickPlanAction(action)}
              >
                {action.shortLabel}
              </button>
            ))}
          </div>
        </section>
      ) : null}
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
            <EmptyState
              title={hasUserFilters ? 'Không có người dùng phù hợp' : 'Chưa có người dùng'}
              text={hasUserFilters ? 'Thử điều chỉnh hoặc xóa bộ lọc hiện tại.' : 'Bấm Đồng bộ Auth để nhập danh sách từ Supabase Auth.'}
            />
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
              <div className="admin-mobile-card-list admin-mobile-user-list" aria-label="Danh sách người dùng trên mobile">
                {users.map((user) => {
                  const userId = getUserId(user);
                  const planKey = getCurrentUserPlanKey(user);
                  const userActivePlan = getActiveUserPlan(user);
                  const isSelected = selected && getUserId(selected) === userId;
                  return (
                    <button
                      type="button"
                      key={userId}
                      className={`admin-mobile-card admin-mobile-user-card ${isSelected ? 'is-active' : ''}`}
                      onClick={() => setSelectedUserId(userId)}
                    >
                      <span className="admin-mobile-card__eyebrow">{getRoleLabel(user.system_role || user.role)}</span>
                      <strong>{getUserEmail(user)}</strong>
                      <span>{userId}</span>
                      <div className="admin-mobile-card__meta">
                        <Badge tone={getUserPlanStatusTone(userActivePlan)}>{getPlanLabel(planKey)}</Badge>
                        <Badge tone={String(user.status || 'active') === 'active' ? 'success' : 'danger'}>{getStatusLabel(user.status)}</Badge>
                      </div>
                      <small>Hết hạn: {getUserPlanExpiryShortLabel(userActivePlan)}</small>
                    </button>
                  );
                })}
              </div>
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
                  {quickPlanActions.map((action) => (
                    <button
                      type="button"
                      key={action.key}
                      className={`button ${action.tone === 'danger' ? 'button--danger' : 'button--primary'}`}
                      disabled={!canMutatePlan}
                      onClick={() => runQuickPlanAction(action)}
                    >
                      {action.label}
                    </button>
                  ))}
                </div>
                <div className="vip-extension-form" aria-label="Gia hạn VIP theo ngày hoặc tháng">
                  <label>
                    <span>Gia hạn VIP</span>
                    <input
                      type="number"
                      min="1"
                      max={vipExtensionMax}
                      step="1"
                      inputMode="numeric"
                      value={vipExtension.amount}
                      disabled={!canMutatePlan}
                      onChange={(event) => setVipExtension((current) => ({ ...current, amount: event.target.value }))}
                    />
                  </label>
                  <label>
                    <span>Đơn vị</span>
                    <select
                      value={vipExtension.unit}
                      disabled={!canMutatePlan}
                      onChange={(event) => setVipExtension((current) => ({ ...current, unit: event.target.value }))}
                    >
                      <option value="day">Ngày</option>
                      <option value="month">Tháng lịch</option>
                    </select>
                  </label>
                  <button
                    type="button"
                    className="button button--primary"
                    disabled={!canMutatePlan || !vipExtensionValid}
                    onClick={() => runPlanOperation(
                      'Gia hạn VIP',
                      `Cộng thêm ${vipExtensionAmount} ${vipExtension.unit === 'month' ? 'tháng' : 'ngày'} VIP cho ${getUserEmail(selected)}?`,
                      {
                        operation: 'extend',
                        planKey: 'vip',
                        amount: vipExtensionAmount,
                        unit: vipExtension.unit,
                      },
                    )}
                  >
                    Gia hạn VIP
                  </button>
                </div>
                <p className="detail-section__note">Nếu VIP còn hạn, thời gian mới được cộng nối từ hạn xa nhất; tháng được tính theo tháng lịch.</p>
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
                  disabled={!canMutatePlan
                    || (planForm.planKey === 'vip' && !planForm.expiresAt)
                    || (planForm.status === 'scheduled' && !planForm.startsAt)}
                  onClick={() => runPlanOperation(
                    'Cấp hoặc đặt lịch gói',
                    `Áp dụng gói ${getPlanLabel(planForm.planKey)} cho ${getUserEmail(selected)}?`,
                    {
                      operation: 'set',
                      planKey: planForm.planKey,
                      status: planForm.status,
                      startsAt: planForm.startsAt || undefined,
                      expiresAt: planForm.planKey === 'lifetime' ? undefined : (planForm.expiresAt || undefined),
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

export function VipPanel({ data, onMutation, actor }) {
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

export function AnnouncementPanel({ data, onMutation, actor }) {
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

export function FeaturesPanel({ data, onMutation, actor }) {
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

export function ConsentPanel({ data }) {
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

export function AuditPanel({ data }) {
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
            <>
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
              <div className="admin-mobile-card-list admin-mobile-audit-list" aria-label="Nhật ký quản trị trên mobile">
                {auditItems.map((item) => {
                  const key = getAuditKey(item);
                  const isSelected = selectedAudit && getAuditKey(selectedAudit) === key;
                  return (
                    <button
                      type="button"
                      key={key}
                      className={`admin-mobile-card admin-mobile-audit-card ${isSelected ? 'is-active' : ''}`}
                      onClick={() => setSelectedAuditId(key)}
                    >
                      <span className="admin-mobile-card__eyebrow">{formatDate(item.created_at)}</span>
                      <strong>{getAuditSummary(item)}</strong>
                      <span>{getAuditActorLabel(item)}</span>
                      <small>{getAuditDetails(item)}</small>
                      <div className="admin-mobile-card__meta">
                        <Badge tone="success">{getAuditStatusLabel(item)}</Badge>
                      </div>
                    </button>
                  );
                })}
              </div>
            </>
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

export function VipRankingPanel({ ranking, loading, error, onLoadRanking }) {
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
          <label className="usage-filter-control vip-ranking-filter--range">
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
          <label className="usage-filter-control vip-ranking-filter--task">
            <span>Loại việc</span>
            <select value={filters.task} disabled={loading} onChange={(event) => updateFilter('task', event.target.value)}>
              {RANKING_TASK_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <label className="usage-filter-control vip-ranking-filter--plan">
            <span>Gói</span>
            <select value={filters.plan} disabled={loading} onChange={(event) => updateFilter('plan', event.target.value)}>
              {RANKING_PLAN_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <label className="usage-filter-control vip-ranking-filter--provider">
            <span>Provider</span>
            <select value={filters.provider} disabled={loading} onChange={(event) => updateFilter('provider', event.target.value)}>
              <option value="all">Tất cả provider</option>
              <option value="custom_proxy">Proxy tùy chỉnh</option>
              <option value="ag_proxy">Gemini Proxy AG</option>
              <option value="gemini_direct">Gemini Direct</option>
              <option value="openai_proxy">OpenAI Proxy</option>
            </select>
          </label>
          <label className="usage-filter-control vip-ranking-filter--status">
            <span>Trạng thái</span>
            <select value={filters.status} disabled={loading} onChange={(event) => updateFilter('status', event.target.value)}>
              <option value="all">Tất cả trạng thái</option>
              <option value="ok">Thành công</option>
              <option value="error">Lỗi</option>
              <option value="blocked">Bị chặn</option>
            </select>
          </label>
          <label className="usage-filter-control vip-ranking-filter--limit">
            <span>Hiển thị</span>
            <select value={filters.limit} disabled={loading} onChange={(event) => updateFilter('limit', event.target.value)}>
              {RANKING_LIMIT_OPTIONS.map((limit) => <option key={limit} value={limit}>Top {limit}</option>)}
            </select>
          </label>
          <button type="button" className="button button--primary" disabled={loading} onClick={applyFilters}>
            <Search size={15} />
            Áp dụng lọc
          </button>
          <button type="button" className="button button--ghost" disabled={loading} onClick={() => onLoadRanking({ ...filters, force: true })}>
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
          <>
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
            <div className="admin-mobile-card-list admin-mobile-ranking-list" aria-label="Xếp hạng VIP trên mobile">
              {items.map((item) => (
                <article className="admin-mobile-card admin-mobile-ranking-card" key={item.userId || item.email}>
                  <span className={`rank-badge ${item.rank <= 3 ? 'is-top' : ''}`}>#{item.rank}</span>
                  <strong>{item.displayName || item.email || item.userId}</strong>
                  <span>{item.email || item.userId}</span>
                  <div className="admin-mobile-card__meta">
                    <Badge tone={item.planKey === 'lifetime' ? 'warning' : 'info'}>{item.planName || getPlanLabel(item.planKey)}</Badge>
                    <span>{formatNumber(item.totalCount)} lượt</span>
                  </div>
                  <small>{item.taskSummary || 'Tác vụ AI'} · gần nhất {formatDate(item.lastUsedAt)}</small>
                </article>
              ))}
            </div>
          </>
        )}
      </section>
    </section>
  );
}

export function UsagePanel({
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
  const usageSummaryText = total === 0
    ? (hasActiveUsageFilters
      ? 'Chưa có hoạt động phù hợp bộ lọc.'
      : 'Chưa có hoạt động người dùng để hiển thị.')
    : hasActiveUsageFilters
      ? `Kết quả phù hợp: ${formatter.format(total)} hoạt động`
      : `Hiển thị ${formatter.format(startRow)} đến ${formatter.format(endRow)} trong ${formatter.format(total)} hoạt động`;

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

      <section className="panel panel--table usage-panel">
        <div className="table-toolbar table-toolbar--split usage-control-panel">
          <div className="usage-filter-grid">
            <label className="usage-filter-control usage-search-control">
              <span>Tìm kiếm</span>
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
            </label>
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

        {error ? <ErrorState message={error} onRetry={() => onLoadPage({ page, pageSize, ...currentFilters })} /> : null}

        <div className="usage-page-summary">
          <span>{usageSummaryText}</span>
          <strong>Trang {formatter.format(page)} / {formatter.format(displayTotalPages)}</strong>
        </div>

        {usageItems.length === 0 ? (
          <EmptyState title="Chưa có hoạt động người dùng" text="Bảng `usage_events` chưa có dữ liệu ở trang hiện tại." />
        ) : (
          <>
            <table className="data-table usage-table">
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
            <div className="admin-mobile-card-list admin-mobile-usage-list" aria-label="Hoạt động người dùng trên mobile">
              {usageItems.map((item) => (
                <article className="admin-mobile-card admin-mobile-usage-card" key={item.id || `${item.user_id}-${item.created_at}`}>
                  <span className="admin-mobile-card__eyebrow">{formatDate(item.created_at)}</span>
                  <strong>{getUsageUserLabel(item)}</strong>
                  <span>{getUsageTaskLabel(item)}</span>
                  <div className="admin-mobile-card__meta">
                    <Badge tone={String(item.status || '').toLowerCase() === 'error' ? 'danger' : 'success'}>{getUsageStatusLabel(item)}</Badge>
                    <span>{getUsageProviderLabel(item)} · {item.count || 0} lượt</span>
                  </div>
                  <small>{item.model || 'Không rõ'}</small>
                </article>
              ))}
            </div>
          </>
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

export function AdvancedPanel({ data, onMutation, apiBaseUrl, actor }) {
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
