import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Ban,
  CheckCircle2,
  Crown,
  Edit3,
  Plus,
  RefreshCw,
  Search,
  Settings,
  ToggleRight,
} from 'lucide-react';
import { useUserAccess } from '../../hooks/useUserAccess';
import {
  ACCESS_FEATURES,
  PLAN_STATUSES,
  USER_STATUSES,
} from '../../services/access/accessControl.js';
import {
  getAdminAudit,
  getAdminCatalog,
  getAdminUsage,
  getAdminUserAccess,
  createAdminFeature,
  listAdminUsers,
  setAdminPlanFeature,
  setAdminUserFeatureOverride,
  setAdminUserPlan,
  setAdminUserStatus,
  syncAdminAuthUsers,
  updateAdminFeature,
  upsertAdminConsentVersion,
} from '../../services/access/accessClient.js';
import {
  createDefaultPlanForm,
  getAccessDecisionLabel,
  getAccessSourceLabel,
  getAuditActionLabel,
  getFeatureCategoryLabel,
  getFeatureDisplayName,
  getPlanDisplayName,
  getPlanStatusLabel,
  getSystemRoleLabel,
  getUserStatusLabel,
} from './adminAccessLabels.js';
import './AdminAccess.css';

const TABS = [
  'overview',
  'users',
  'plans',
  'plan-features',
  'adult',
  'audit',
  'advanced',
];

const DEFAULT_CATALOG = {
  plans: [],
  features: [],
  planFeatures: [],
  consentVersions: [],
};

const DEFAULT_OVERRIDE_FORM = {
  featureKey: ACCESS_FEATURES.TRANSLATOR_ACCESS,
  enabled: 'true',
  expiresAt: '',
  reason: '',
};

const DEFAULT_CONSENT_FORM = {
  version: '',
  title: 'Điều khoản nội dung 18+',
  body: '',
  active: true,
};

const DEFAULT_FEATURE_FORM = {
  key: '',
  name: '',
  description: '',
  category: 'general',
  active: true,
};

function formatDateTime(value) {
  if (!value) return 'Không có';
  const time = new Date(value);
  if (Number.isNaN(time.getTime())) return String(value);
  return time.toLocaleString('vi-VN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatDate(value) {
  if (!value) return 'Không hết hạn';
  const time = new Date(value);
  if (Number.isNaN(time.getTime())) return 'Không rõ';
  return time.toLocaleDateString('vi-VN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}

function toIsoOrNull(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function getPlanKey(plan = {}) {
  return plan?.plans?.key || plan?.plan_key || plan?.key || '';
}

function toSortableTime(value) {
  const time = new Date(value || 0).getTime();
  return Number.isFinite(time) ? time : 0;
}

const PLAN_PRIORITY = {
  lifetime: 300,
  vip: 200,
  free: 100,
};

function getCurrentPlan(user) {
  const plans = Array.isArray(user?.plans) ? user.plans : [];
  return plans
    .filter((plan) => plan.status === PLAN_STATUSES.ACTIVE)
    .sort((a, b) => {
      const priorityDiff = (PLAN_PRIORITY[getPlanKey(b)] || 0) - (PLAN_PRIORITY[getPlanKey(a)] || 0);
      if (priorityDiff !== 0) return priorityDiff;
      return toSortableTime(b.starts_at || b.created_at) - toSortableTime(a.starts_at || a.created_at);
    })[0] || plans[0] || null;
}

function summarizeJson(value) {
  if (!value || (typeof value === 'object' && Object.keys(value).length === 0)) return 'Không có';
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function findPlanFeature(planFeatures, planKey, featureKey) {
  return (Array.isArray(planFeatures) ? planFeatures : []).find((item) => (
    (item?.plans?.key || item?.plan_key) === planKey
    && item?.feature_key === featureKey
  )) || null;
}

function countEnabledPlanFeatures(planFeatures, planKey) {
  return (Array.isArray(planFeatures) ? planFeatures : [])
    .filter((item) => (item?.plans?.key || item?.plan_key) === planKey)
    .filter((item) => item.enabled)
    .length;
}

function getPlanExpiryLabel(plan) {
  if (!plan) return 'Chưa có';
  if (!plan.expires_at && !plan.expiresAt) return 'Không hết hạn';
  return formatDate(plan.expires_at || plan.expiresAt);
}

function getProviderLabel(provider) {
  const value = String(provider || '').trim();
  if (!value) return 'Không rõ';
  const labels = {
    ag_proxy: 'Gemini Proxy AG',
    ai_studio_relay: 'AI Studio Relay',
    custom_proxy: 'Proxy tùy chỉnh',
  };
  return labels[value] || value;
}

function FeatureTechnicalDetails({ feature }) {
  return (
    <details className="admin-access-technical-details">
      <summary>Chi tiết kỹ thuật</summary>
      <dl>
        <div><dt>Mã kỹ thuật</dt><dd>{feature.key || feature.feature_key || 'Không rõ'}</dd></div>
        <div><dt>Nhóm nội bộ</dt><dd>{getFeatureCategoryLabel(feature.category)}</dd></div>
      </dl>
    </details>
  );
}

function AdminStat({ label, value, note }) {
  return (
    <div className="admin-access-stat">
      <span>{label}</span>
      <strong>{value}</strong>
      {note ? <small>{note}</small> : null}
    </div>
  );
}

function EmptyState({ title, children }) {
  return (
    <div className="admin-access-empty">
      <strong>{title}</strong>
      {children ? <p>{children}</p> : null}
    </div>
  );
}

function SectionHeading({ title, note, actions = null }) {
  return (
    <div className="admin-access-section-heading">
      <div>
        <h2>{title}</h2>
        {note ? <p>{note}</p> : null}
      </div>
      {actions ? <div className="admin-access-section-heading__actions">{actions}</div> : null}
    </div>
  );
}

function ConfirmModal({ action, onCancel, onConfirm, busy }) {
  if (!action) return null;
  return (
    <div className="admin-access-modal-backdrop" role="presentation" onMouseDown={onCancel}>
      <section
        className="admin-access-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="admin-access-confirm-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h3 id="admin-access-confirm-title">{action.title}</h3>
        <p>{action.body}</p>
        {action.note ? <p className="admin-access-modal__note">{action.note}</p> : null}
        <div className="admin-access-modal__actions">
          <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={busy}>
            Hủy
          </button>
          <button type="button" className="btn btn-primary" onClick={onConfirm} disabled={busy}>
            {busy ? 'Đang lưu...' : action.confirmLabel || 'Xác nhận'}
          </button>
        </div>
      </section>
    </div>
  );
}

export default function AdminAccess() {
  const { isAdmin, loading: accessLoading } = useUserAccess();
  const [searchParams] = useSearchParams();
  const activeTabCandidate = searchParams.get('tab') || 'overview';
  const normalizedActiveTab = activeTabCandidate === 'features' ? 'advanced' : activeTabCandidate;
  const activeTab = TABS.includes(normalizedActiveTab) ? normalizedActiveTab : 'overview';
  const [search, setSearch] = useState('');
  const [users, setUsers] = useState([]);
  const [catalog, setCatalog] = useState(DEFAULT_CATALOG);
  const [audit, setAudit] = useState([]);
  const [usage, setUsage] = useState([]);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [selectedAccess, setSelectedAccess] = useState(null);
  const [planForm, setPlanForm] = useState(createDefaultPlanForm);
  const [overrideForm, setOverrideForm] = useState(DEFAULT_OVERRIDE_FORM);
  const [consentForm, setConsentForm] = useState(DEFAULT_CONSENT_FORM);
  const [featureForm, setFeatureForm] = useState(DEFAULT_FEATURE_FORM);
  const [editingFeatureKey, setEditingFeatureKey] = useState('');
  const [usageFilters, setUsageFilters] = useState({ featureKey: '', provider: '' });
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmAction, setConfirmAction] = useState(null);

  const selectedUser = useMemo(
    () => users.find((user) => user.user_id === selectedUserId) || null,
    [selectedUserId, users],
  );
  const selectedCurrentPlan = useMemo(
    () => getCurrentPlan(selectedUser),
    [selectedUser],
  );

  const activeConsent = useMemo(
    () => catalog.consentVersions.find((item) => item.key === 'adult_terms' && item.active),
    [catalog.consentVersions],
  );

  const selectedPlanFeatureCount = useMemo(
    () => countEnabledPlanFeatures(catalog.planFeatures, planForm.planKey),
    [catalog.planFeatures, planForm.planKey],
  );
  const selectedPlanFeatureSummary = catalog.planFeatures.length
    ? `Gói ${getPlanDisplayName(planForm.planKey)} tự mở ${selectedPlanFeatureCount} tính năng đang bật trong mục Tính năng trong gói.`
    : 'Đang tải danh sách tính năng của gói. Khi dữ liệu tải xong, gói VIP sẽ tự áp dụng các tính năng đang bật.';

  const stats = useMemo(() => {
    const activeVip = users.filter((user) => ['vip', 'lifetime'].includes(getPlanKey(getCurrentPlan(user)))).length;
    const banned = users.filter((user) => user.status === USER_STATUSES.BANNED).length;
    const enabledPlanFeatures = catalog.planFeatures.filter((item) => item.enabled).length;
    return {
      totalUsers: users.length,
      activeVip,
      banned,
      featureCount: catalog.features.length,
      enabledPlanFeatures,
    };
  }, [catalog.features.length, catalog.planFeatures, users]);

  const loadUserDetails = useCallback(async (userId) => {
    if (!userId) {
      setSelectedAccess(null);
      setUsage([]);
      return;
    }
    const [accessPayload, usagePayload] = await Promise.all([
      getAdminUserAccess(userId),
      getAdminUsage({ userId }),
    ]);
    setSelectedAccess(accessPayload.access || null);
    setUsage(usagePayload.usage || []);
  }, []);

  const loadAdminData = useCallback(async ({ keepSelected = false } = {}) => {
    setError('');
    setNotice('');
    const [usersPayload, catalogPayload, auditPayload, usagePayload] = await Promise.all([
      listAdminUsers(search),
      getAdminCatalog(),
      getAdminAudit(),
      getAdminUsage(),
    ]);

    const nextUsers = usersPayload.users || [];
    setUsers(nextUsers);
    setCatalog({
      plans: catalogPayload.plans || [],
      features: catalogPayload.features || [],
      planFeatures: catalogPayload.planFeatures || [],
      consentVersions: catalogPayload.consentVersions || [],
    });
    setAudit(auditPayload.audit || []);
    setUsage(usagePayload.usage || []);

    const nextSelectedId = keepSelected && selectedUserId
      ? selectedUserId
      : nextUsers[0]?.user_id || '';
    setSelectedUserId(nextSelectedId);
    if (nextSelectedId) await loadUserDetails(nextSelectedId);
  }, [loadUserDetails, search, selectedUserId]);

  useEffect(() => {
    if (!isAdmin) return;
    setBusy(true);
    loadAdminData()
      .catch((err) => setError(err?.message || 'Không tải được dữ liệu quản trị.'))
      .finally(() => setBusy(false));
  }, [isAdmin]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!catalog.features.length) return;
    setOverrideForm((prev) => ({
      ...prev,
      featureKey: catalog.features.some((feature) => feature.key === prev.featureKey)
        ? prev.featureKey
        : catalog.features[0].key,
    }));
  }, [catalog.features]);

  async function runAdminAction(action) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await action();
      setNotice('Đã lưu thay đổi.');
      await loadAdminData({ keepSelected: true });
    } catch (err) {
      setError(err?.message || 'Không lưu được thay đổi.');
    } finally {
      setBusy(false);
      setConfirmAction(null);
    }
  }

  function openConfirm(title, body, action, options = {}) {
    setConfirmAction({ title, body, action, ...options });
  }

  function submitSyncAuthUsers() {
    openConfirm(
      'Đồng bộ người dùng Supabase Auth',
      'Tạo profile còn thiếu cho các tài khoản đã từng đăng nhập Cloud Sync. Sync chỉ cập nhật email và profile còn thiếu, không ghi đè role, trạng thái, consent, gói hoặc override.',
      async () => {
        const payload = await syncAdminAuthUsers();
        setNotice(`Đã đồng bộ ${payload.created || 0} user mới, ${payload.existing || 0} user đã có sẵn.`);
        return payload;
      },
      { confirmLabel: 'Đồng bộ user' },
    );
  }

  function handleSearchSubmit(event) {
    event.preventDefault();
    setBusy(true);
    loadAdminData()
      .catch((err) => setError(err?.message || 'Không tìm được người dùng.'))
      .finally(() => setBusy(false));
  }

  function handleSelectUser(userId) {
    setSelectedUserId(userId);
    setBusy(true);
    loadUserDetails(userId)
      .catch((err) => setError(err?.message || 'Không đọc được quyền người dùng.'))
      .finally(() => setBusy(false));
  }

  function submitPlan(event) {
    event.preventDefault();
    if (!selectedUser) return;
    openConfirm(
      'Xác nhận cấp gói',
      `Áp dụng gói ${getPlanDisplayName(planForm.planKey)} ở trạng thái ${getPlanStatusLabel(planForm.status)} cho ${selectedUser.email || selectedUser.user_id}. Gói này tự mở ${selectedPlanFeatureCount} tính năng đang bật.`,
      () => setAdminUserPlan(selectedUser.user_id, {
        operation: 'set',
        planKey: planForm.planKey,
        status: planForm.status,
        startsAt: toIsoOrNull(planForm.startsAt),
        expiresAt: toIsoOrNull(planForm.expiresAt),
      }),
      { confirmLabel: 'Cấp gói' },
    );
  }

  function submitQuickPlan(planKey, days = null) {
    if (!selectedUser) return;
    const expiresAt = days ? new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString() : null;
    const featureCount = countEnabledPlanFeatures(catalog.planFeatures, planKey);
    openConfirm(
      `Cấp ${getPlanDisplayName(planKey)}`,
      `Cấp ${getPlanDisplayName(planKey)} cho ${selectedUser.email || selectedUser.user_id}. Gói này tự mở ${featureCount} tính năng đang bật.`,
      () => setAdminUserPlan(selectedUser.user_id, {
        operation: 'set',
        planKey,
        status: PLAN_STATUSES.ACTIVE,
        startsAt: null,
        expiresAt,
      }),
      { confirmLabel: days ? `Cấp ${days} ngày` : 'Cấp trọn đời' },
    );
  }

  function submitCancelPlan(operation) {
    if (!selectedUser) return;
    const isCurrent = operation === 'cancel_current';
    openConfirm(
      isCurrent ? 'Hủy gói hiện tại' : 'Hủy gói đã đặt lịch',
      `${isCurrent ? 'Hủy gói đang hiệu lực hiện tại' : 'Hủy gói đã đặt lịch'} của ${selectedUser.email || selectedUser.user_id}?`,
      () => setAdminUserPlan(selectedUser.user_id, { operation }),
      { confirmLabel: isCurrent ? 'Hủy gói hiện tại' : 'Hủy gói đã đặt lịch' },
    );
  }

  function submitOverride(event) {
    event.preventDefault();
    if (!selectedUser) return;
    const enabled = overrideForm.enabled === 'true';
    const featureName = getFeatureDisplayName(overrideForm.featureKey);
    const userLabel = selectedUser.email || selectedUser.user_id;
    openConfirm(
      enabled ? 'Cấp quyền ngoại lệ cho tài khoản' : 'Chặn quyền ngoại lệ cho tài khoản',
      `Bạn đang tạo ngoại lệ cho riêng ${userLabel}: ${enabled ? 'cấp' : 'chặn'} tính năng ${featureName}.`,
      () => setAdminUserFeatureOverride(selectedUser.user_id, {
        featureKey: overrideForm.featureKey,
        enabled,
        expiresAt: toIsoOrNull(overrideForm.expiresAt),
        reason: overrideForm.reason,
      }),
      {
        note: 'Nếu mục tiêu là cấp VIP, hãy hủy hộp thoại này và dùng các nút cấp VIP ở trên. Quyền chỉnh riêng chỉ dùng khi không muốn cấp cả gói VIP.',
        confirmLabel: enabled ? 'Lưu quyền chỉnh riêng' : 'Chặn quyền chỉnh riêng',
      },
    );
  }

  function submitConsent(event) {
    event.preventDefault();
    openConfirm(
      'Cập nhật điều khoản 18+',
      `Tạo hoặc cập nhật phiên bản ${consentForm.version}. Nếu được bật, người dùng sẽ phải đồng ý đúng phiên bản này.`,
      () => upsertAdminConsentVersion({
        key: 'adult_terms',
        version: consentForm.version,
        title: consentForm.title,
        body: consentForm.body,
        active: consentForm.active,
      }),
      { confirmLabel: 'Lưu điều khoản' },
    );
  }

  function toggleUserStatus() {
    if (!selectedUser) return;
    const nextStatus = selectedUser.status === USER_STATUSES.BANNED
      ? USER_STATUSES.ACTIVE
      : USER_STATUSES.BANNED;
    openConfirm(
      nextStatus === USER_STATUSES.BANNED ? 'Khóa người dùng' : 'Mở khóa người dùng',
      `${nextStatus === USER_STATUSES.BANNED ? 'Khóa' : 'Mở khóa'} ${selectedUser.email || selectedUser.user_id}?`,
      () => setAdminUserStatus(selectedUser.user_id, { status: nextStatus }),
      { confirmLabel: nextStatus === USER_STATUSES.BANNED ? 'Khóa người dùng' : 'Mở khóa' },
    );
  }

  function togglePlanFeature(featureKey, enabled, planKey = 'vip') {
    openConfirm(
      enabled ? 'Thêm tính năng vào gói' : 'Gỡ tính năng khỏi gói',
      `${enabled ? 'Bật' : 'Tắt'} ${getFeatureDisplayName(featureKey)} trong gói ${getPlanDisplayName(planKey)}?`,
      () => setAdminPlanFeature(featureKey, { planKey, enabled }),
      { confirmLabel: enabled ? 'Thêm vào gói' : 'Gỡ khỏi gói' },
    );
  }

  function resetFeatureForm() {
    setEditingFeatureKey('');
    setFeatureForm(DEFAULT_FEATURE_FORM);
  }

  function editFeature(feature) {
    setEditingFeatureKey(feature.key);
    setFeatureForm({
      key: feature.key || '',
      name: feature.name || '',
      description: feature.description || '',
      category: feature.category || 'general',
      active: feature.active !== false,
    });
  }

  function submitFeature(event) {
    event.preventDefault();
    const payload = {
      key: featureForm.key,
      name: featureForm.name,
      description: featureForm.description,
      category: featureForm.category,
      active: featureForm.active,
    };
    const featureName = featureForm.name || featureForm.key;
    openConfirm(
      editingFeatureKey ? 'Cập nhật tính năng' : 'Tạo tính năng mới',
      editingFeatureKey
        ? `Cập nhật tên, mô tả, nhóm hoặc trạng thái tạm tắt của ${featureName}. Mã kỹ thuật không được sửa.`
        : `Tạo tính năng ${featureName}. Chỉ dùng khi đội kỹ thuật đã thêm tính năng vào hệ thống.`,
      () => (
        editingFeatureKey
          ? updateAdminFeature(editingFeatureKey, payload)
          : createAdminFeature(payload)
      ),
      { confirmLabel: editingFeatureKey ? 'Cập nhật' : 'Tạo tính năng' },
    );
  }

  async function applyUsageFilters(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const payload = await getAdminUsage({
        userId: selectedUserId,
        featureKey: usageFilters.featureKey,
        provider: usageFilters.provider,
      });
      setUsage(payload.usage || []);
    } catch (err) {
      setError(err?.message || 'Không tải được lượt sử dụng.');
    } finally {
      setBusy(false);
    }
  }

  if (accessLoading) {
    return <div className="admin-access-page"><EmptyState title="Đang kiểm tra quyền quản trị..." /></div>;
  }

  if (!isAdmin) {
    return (
      <div className="admin-access-page">
        <EmptyState title="Không có quyền quản trị">
          Bạn cần quyền admin hoặc owner để mở khu vực này.
        </EmptyState>
      </div>
    );
  }

  return (
    <div className="admin-access-page">
      <header className="admin-access-header">
        <div>
          <h1>Trung tâm quản lý VIP & quyền truy cập</h1>
          <p>Tập trung các việc vận hành hằng ngày: tìm người dùng, cấp VIP, quản lý tính năng trong gói, điều khoản 18+ và nhật ký quản trị.</p>
        </div>
        <div className="admin-access-header__actions">
          <button type="button" className="btn btn-secondary" onClick={submitSyncAuthUsers} disabled={busy}>
            <RefreshCw size={16} />
            Đồng bộ user Auth
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => loadAdminData({ keepSelected: true })} disabled={busy}>
            <RefreshCw size={16} />
            Làm mới
          </button>
        </div>
      </header>

      {notice ? <div className="admin-access-alert is-success">{notice}</div> : null}
      {error ? <div className="admin-access-alert is-error">{error}</div> : null}

      {activeTab === 'overview' ? (
        <section className="admin-access-section">
          <SectionHeading
            title="Tổng quan vận hành"
            note="Các số liệu này chỉ phản ánh dữ liệu đang tải trong màn hình admin, không thay thế kiểm tra quyền ở backend."
          />
          <div className="admin-access-stat-grid">
            <AdminStat label="Người dùng" value={stats.totalUsers} note="Tối đa 100 người dùng mới nhất" />
            <AdminStat label="VIP/Trọn đời" value={stats.activeVip} note="Theo gói đang hiệu lực hiện tại" />
            <AdminStat label="Đang bị khóa" value={stats.banned} note="Bị chặn trước mọi tính năng" />
            <AdminStat label="Tính năng trong gói" value={stats.featureCount} note={`${stats.enabledPlanFeatures} liên kết đang bật`} />
          </div>
          <div className="admin-access-grid two">
            <section className="admin-access-panel">
              <h2>Tình hình vận hành</h2>
              <dl className="admin-access-kv">
                <div><dt>Điều khoản 18+ đang dùng</dt><dd>{activeConsent?.version || 'Chưa có'}</dd></div>
                <div><dt>Tính năng đang quản lý</dt><dd>{catalog.features.length}</dd></div>
                <div><dt>Nhật ký gần nhất</dt><dd>{audit[0]?.action ? getAuditActionLabel(audit[0].action) : 'Chưa có'}</dd></div>
                <div><dt>Lượt dùng gần nhất</dt><dd>{usage[0]?.feature_key ? getFeatureDisplayName(usage[0].feature_key) : 'Chưa có'}</dd></div>
              </dl>
            </section>
            <section className="admin-access-panel">
              <h2>Nguyên tắc an toàn</h2>
              <ul className="admin-access-checklist">
                <li><CheckCircle2 size={16} /> Mặc định không mở quyền nếu chưa có gói hoặc ngoại lệ hợp lệ.</li>
                <li><CheckCircle2 size={16} /> Admin không tự động là VIP.</li>
                <li><CheckCircle2 size={16} /> Các nguồn AI nâng cao vẫn phải qua kiểm tra quyền.</li>
                <li><CheckCircle2 size={16} /> 18+ cần đủ tuổi và đúng phiên bản điều khoản.</li>
              </ul>
            </section>
          </div>
        </section>
      ) : null}

      {activeTab === 'users' ? (
        <section className="admin-access-section admin-access-grid users">
          <div className="admin-access-panel">
            <SectionHeading
              title="Người dùng"
              note="Tìm tài khoản, chọn một dòng rồi xử lý nhanh ở panel bên phải."
            />
            <form className="admin-access-search" onSubmit={handleSearchSubmit}>
              <Search size={16} />
              <input
                className="input"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Nhập email hoặc tên người dùng"
              />
              <button type="submit" className="btn btn-secondary" disabled={busy}>Tìm</button>
            </form>
            <div className="admin-access-table-wrap admin-access-table-wrap--users">
              <table className="admin-access-table admin-access-table--users">
                <thead>
                  <tr>
                    <th>Email</th>
                    <th>Gói hiện tại</th>
                    <th>Hết hạn</th>
                    <th>Trạng thái</th>
                    <th>Cập nhật lần cuối</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((user) => {
                    const currentPlan = getCurrentPlan(user);
                    return (
                      <tr
                        key={user.user_id}
                        className={selectedUserId === user.user_id ? 'is-selected' : ''}
                        onClick={() => handleSelectUser(user.user_id)}
                      >
                        <td>
                          <strong>{user.email || 'Chưa có email'}</strong>
                          <span>{user.display_name || user.user_id}</span>
                        </td>
                        <td><span className="admin-access-pill">{currentPlan ? getPlanDisplayName(currentPlan) : 'Miễn phí'}</span></td>
                        <td className="admin-access-nowrap">{getPlanExpiryLabel(currentPlan)}</td>
                        <td><span className={`admin-access-status ${user.status === USER_STATUSES.BANNED ? 'is-off' : 'is-on'}`}>{getUserStatusLabel(user.status)}</span></td>
                        <td>{formatDate(user.updated_at)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <aside className="admin-access-panel admin-access-detail">
            {selectedUser ? (
              <>
                <div className="admin-access-detail__header">
                  <div>
                    <h2>{selectedUser.email || selectedUser.user_id}</h2>
                    <p>{getSystemRoleLabel(selectedUser.system_role)} · {getUserStatusLabel(selectedUser.status)}</p>
                  </div>
                  <button type="button" className="btn btn-secondary" onClick={toggleUserStatus} disabled={busy}>
                    <Ban size={16} />
                    {selectedUser.status === USER_STATUSES.BANNED ? 'Mở khóa tài khoản' : 'Khóa tài khoản'}
                  </button>
                </div>

                <div className="admin-access-user-summary">
                  <div>
                    <span>Gói hiện tại</span>
                    <strong>{selectedCurrentPlan ? getPlanDisplayName(selectedCurrentPlan) : 'Miễn phí'}</strong>
                  </div>
                  <div>
                    <span>Hết hạn</span>
                    <strong>{getPlanExpiryLabel(selectedCurrentPlan)}</strong>
                  </div>
                  <div>
                    <span>Cập nhật lần cuối</span>
                    <strong>{formatDate(selectedUser.updated_at)}</strong>
                  </div>
                </div>

                <div className="admin-access-detail__block">
                  <h3>Quyền hiện tại</h3>
                  {selectedAccess ? (
                    <div className="admin-access-feature-list">
                      {Object.entries(selectedAccess.features || {}).map(([featureKey, decision]) => (
                        <div key={featureKey} className={decision.allowed ? 'is-allowed' : 'is-denied'}>
                          <span>
                            {getFeatureDisplayName(featureKey)}
                          </span>
                          <strong>
                            {getAccessDecisionLabel(decision)}
                            <small>{getAccessSourceLabel(decision.source)}</small>
                          </strong>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <EmptyState title="Chưa chọn user" />
                  )}
                </div>

                <div className="admin-access-quick-grants">
                  <div>
                    <h3>Cấp VIP nhanh</h3>
                    <p>Luồng chính cho vận hành hằng ngày. Gói VIP tự mở các tính năng đang bật trong danh sách tính năng của gói.</p>
                  </div>
                  <div className="admin-access-actions">
                    <button type="button" className="btn btn-primary" onClick={() => submitQuickPlan('vip', 30)} disabled={busy}>
                      <Crown size={15} />
                      Cấp VIP 30 ngày
                    </button>
                    <button type="button" className="btn btn-secondary" onClick={() => submitQuickPlan('vip', 90)} disabled={busy}>
                      Cấp VIP 90 ngày
                    </button>
                    <button type="button" className="btn btn-secondary" onClick={() => submitQuickPlan('lifetime', null)} disabled={busy}>
                      Cấp trọn đời
                    </button>
                    <button type="button" className="btn btn-danger" onClick={() => submitCancelPlan('cancel_current')} disabled={busy}>
                      Hủy gói hiện tại
                    </button>
                  </div>
                </div>

                <details className="admin-access-advanced">
                  <summary>
                    <Settings size={16} />
                    Tùy chọn nâng cao
                  </summary>

                  <form className="admin-access-form" onSubmit={submitPlan}>
                    <h3>Cấp hoặc đặt lịch gói</h3>
                    <p className="admin-access-form-note">
                      {selectedPlanFeatureSummary}
                    </p>
                    <label>
                      Gói
                      <select className="select" value={planForm.planKey} onChange={(event) => setPlanForm((prev) => ({ ...prev, planKey: event.target.value }))}>
                        {catalog.plans.map((plan) => <option key={plan.key} value={plan.key}>{getPlanDisplayName(plan)}</option>)}
                      </select>
                    </label>
                    <label>
                      Trạng thái
                      <select className="select" value={planForm.status} onChange={(event) => setPlanForm((prev) => ({ ...prev, status: event.target.value }))}>
                        {[PLAN_STATUSES.ACTIVE, PLAN_STATUSES.SCHEDULED].map((status) => <option key={status} value={status}>{getPlanStatusLabel(status)}</option>)}
                      </select>
                    </label>
                    <label>
                      Bắt đầu
                      <input className="input" type="datetime-local" value={planForm.startsAt} onChange={(event) => setPlanForm((prev) => ({ ...prev, startsAt: event.target.value }))} />
                      <small className="admin-access-field-hint">Để trống nếu muốn hiệu lực ngay.</small>
                    </label>
                    <label>
                      Hết hạn
                      <input className="input" type="datetime-local" value={planForm.expiresAt} onChange={(event) => setPlanForm((prev) => ({ ...prev, expiresAt: event.target.value }))} />
                      <small className="admin-access-field-hint">Mặc định là 30 ngày từ lúc mở trang.</small>
                    </label>
                    <div className="admin-access-actions">
                      <button type="submit" className="btn btn-primary" disabled={busy}>Lưu gói</button>
                      <button type="button" className="btn btn-secondary" onClick={() => submitCancelPlan('cancel_scheduled')} disabled={busy}>
                        Hủy gói đã đặt lịch
                      </button>
                    </div>
                  </form>

                  <form className="admin-access-form admin-access-form--exception" onSubmit={submitOverride}>
                    <h3>Quyền chỉnh riêng</h3>
                    <p className="admin-access-form-note">
                      Chỉ dùng khi cần cấp thêm hoặc chặn riêng một tính năng cho tài khoản này. Đây không phải bước cấp VIP.
                    </p>
                    <label>
                      Tính năng
                      <select className="select" value={overrideForm.featureKey} onChange={(event) => setOverrideForm((prev) => ({ ...prev, featureKey: event.target.value }))}>
                        {catalog.features.map((feature) => <option key={feature.key} value={feature.key}>{getFeatureDisplayName(feature)}</option>)}
                      </select>
                    </label>
                    <label>
                      Quyết định
                      <select className="select" value={overrideForm.enabled} onChange={(event) => setOverrideForm((prev) => ({ ...prev, enabled: event.target.value }))}>
                        <option value="true">Cấp riêng tính năng này</option>
                        <option value="false">Chặn riêng tính năng này</option>
                      </select>
                    </label>
                    <label>
                      Hết hạn quyền chỉnh riêng
                      <input className="input" type="datetime-local" value={overrideForm.expiresAt} onChange={(event) => setOverrideForm((prev) => ({ ...prev, expiresAt: event.target.value }))} />
                      <small className="admin-access-field-hint">Để trống nếu quyền chỉnh riêng không tự hết hạn.</small>
                    </label>
                    <label>
                      Lý do
                      <input className="input" value={overrideForm.reason} onChange={(event) => setOverrideForm((prev) => ({ ...prev, reason: event.target.value }))} placeholder="Ví dụ: cấp thử riêng hoặc chặn do vi phạm" />
                    </label>
                    <button type="submit" className="btn btn-secondary" disabled={busy}>Lưu quyền chỉnh riêng</button>
                  </form>
                </details>
              </>
            ) : (
              <EmptyState title="Chưa có người dùng" />
            )}
          </aside>
        </section>
      ) : null}

      {activeTab === 'plans' ? (
        <section className="admin-access-section">
          <SectionHeading
            title="Gói VIP"
            note="Admin cấp gói cho người dùng ở tab Người dùng. Tab này chỉ giúp rà soát mỗi gói đang mở bao nhiêu tính năng."
          />
          <div className="admin-access-plan-list">
            {catalog.plans.map((plan) => {
              const enabledCount = countEnabledPlanFeatures(catalog.planFeatures, plan.key);
              return (
                <section className="admin-access-plan-item" key={plan.key}>
                  <div>
                    <span>{plan.active === false ? 'Đang tắt' : 'Đang bật'}</span>
                    <h3>{getPlanDisplayName(plan)}</h3>
                    <p>{plan.description || 'Chưa có mô tả.'}</p>
                  </div>
                  <strong>{enabledCount} tính năng</strong>
                </section>
              );
            })}
          </div>
        </section>
      ) : null}

      {activeTab === 'plan-features' ? (
        <section className="admin-access-section">
          <SectionHeading
            title="Tính năng trong gói"
            note="Bật hoặc tắt quyền theo từng gói. Đây là nguồn map gói → tính năng; quyền thực tế vẫn được backend resolve lại khi người dùng gọi API."
          />
          <div className="admin-access-table-wrap admin-access-table-wrap--matrix">
            <table className="admin-access-table admin-access-feature-matrix">
              <thead>
                <tr>
                  <th>Tính năng</th>
                  {catalog.plans.map((plan) => (
                    <th key={plan.key}>{getPlanDisplayName(plan)}</th>
                  ))}
                  <th>Chi tiết</th>
                </tr>
              </thead>
              <tbody>
                {catalog.features.map((feature) => (
                  <tr key={feature.key}>
                    <td>
                      <strong>{getFeatureDisplayName(feature)}</strong>
                      <span>{getFeatureCategoryLabel(feature.category)}</span>
                    </td>
                    {catalog.plans.map((plan) => {
                      const planFeature = findPlanFeature(catalog.planFeatures, plan.key, feature.key);
                      const enabled = Boolean(planFeature?.enabled);
                      return (
                        <td key={`${plan.key}:${feature.key}`}>
                          <button
                            type="button"
                            className={`admin-access-switch admin-access-switch--compact ${enabled ? 'is-on' : 'is-off'}`}
                            onClick={() => togglePlanFeature(feature.key, !enabled, plan.key)}
                            disabled={busy}
                            aria-pressed={enabled}
                          >
                            <ToggleRight size={16} />
                            {enabled ? 'Bật' : 'Tắt'}
                          </button>
                        </td>
                      );
                    })}
                    <td>
                      <span>{feature.description || 'Chưa có mô tả.'}</span>
                      <FeatureTechnicalDetails feature={feature} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {activeTab === 'advanced' ? (
        <section className="admin-access-section admin-access-grid two">
          <div className="admin-access-panel admin-access-panel--warning">
            <h2>Nâng cao</h2>
            <p className="admin-access-panel-note">
              Khu vực kỹ thuật. Chỉ dùng khi đội kỹ thuật đã thêm mã tính năng vào code; nếu chỉ muốn cấp VIP, hãy quay lại tab Người dùng.
            </p>
          </div>

          <div className="admin-access-panel">
            <div className="admin-access-panel-heading">
              <div>
                <h2>Danh sách tính năng</h2>
                <p className="admin-access-panel-note">Chọn một tính năng để sửa thông tin hiển thị. Tạo mới chỉ dùng khi đội kỹ thuật đã thêm mã tính năng vào code.</p>
              </div>
              <button type="button" className="btn btn-secondary btn-sm" onClick={resetFeatureForm} disabled={busy}>
                <Plus size={13} />
                Tạo tính năng mới
              </button>
            </div>
            <div className="admin-access-table-wrap compact">
              <table className="admin-access-table">
                <thead>
                  <tr>
                    <th>Tính năng</th>
                    <th>Nhóm</th>
                    <th>Trạng thái</th>
                    <th>Hành động</th>
                  </tr>
                </thead>
                <tbody>
                  {catalog.features.map((feature) => {
                    const isActive = feature.active !== false;
                   return (
                     <tr key={feature.key} className={editingFeatureKey === feature.key ? 'is-selected' : ''}>
                        <td>
                          <strong>{getFeatureDisplayName(feature)}</strong>
                          <span>{feature.description || 'Chưa có mô tả.'}</span>
                          <FeatureTechnicalDetails feature={feature} />
                        </td>
                        <td>{getFeatureCategoryLabel(feature.category)}</td>
                        <td>
                          <span className={`admin-access-status ${isActive ? 'is-on' : 'is-off'}`}>
                            {isActive ? 'Đang bật' : 'Tạm tắt'}
                          </span>
                        </td>
                        <td>
                          <button type="button" className="btn btn-secondary btn-sm" onClick={() => editFeature(feature)} disabled={busy}>
                            <Edit3 size={13} />
                            Sửa thông tin
                          </button>
                        </td>
                     </tr>
                   );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className={`admin-access-panel admin-access-feature-editor ${editingFeatureKey ? 'is-editing' : 'is-creating'}`}>
            <h2>{editingFeatureKey ? 'Sửa thông tin tính năng' : 'Tạo tính năng mới'}</h2>
            {editingFeatureKey ? (
              <p className="admin-access-panel-note">
                <strong>Đang sửa tính năng:</strong> {getFeatureDisplayName(featureForm)}. Chỉ sửa tên, mô tả, nhóm và trạng thái bật/tắt. Mã kỹ thuật đang khóa để tránh lệch với code.
              </p>
            ) : (
              <p className="admin-access-panel-note">
                Chỉ tạo tính năng mới khi đội kỹ thuật đã thêm mã tính năng vào hệ thống. Nếu chỉ muốn bật tính năng cho gói VIP, hãy dùng tab Tính năng trong gói.
              </p>
            )}
            <form className="admin-access-form" onSubmit={submitFeature}>
              <label>
                {editingFeatureKey ? 'Mã kỹ thuật đang khóa' : 'Mã kỹ thuật của tính năng'}
                <input
                  className="input"
                  value={featureForm.key}
                  onChange={(event) => setFeatureForm((prev) => ({ ...prev, key: event.target.value }))}
                  placeholder="export.pdf"
                  disabled={Boolean(editingFeatureKey)}
                  required
                />
                <small className="admin-access-field-hint">
                  {editingFeatureKey
                    ? 'Mã này gắn với code guard nên không sửa trong màn hình vận hành.'
                    : 'Ví dụ: translator.access, ai_chat.access. Không sửa mã kỹ thuật sau khi tạo.'}
                </small>
              </label>
              <label>
                Tên tiếng Việt
                <input
                  className="input"
                  value={featureForm.name}
                  onChange={(event) => setFeatureForm((prev) => ({ ...prev, name: event.target.value }))}
                  placeholder="Xuất PDF"
                  required
                />
              </label>
              <label className="admin-access-form__wide">
                Mô tả
                <input
                  className="input"
                  value={featureForm.description}
                  onChange={(event) => setFeatureForm((prev) => ({ ...prev, description: event.target.value }))}
                  placeholder="Mô tả ngắn để admin hiểu tính năng này mở gì."
                />
              </label>
              <label>
                Nhóm
                <input
                  className="input"
                  value={featureForm.category}
                  onChange={(event) => setFeatureForm((prev) => ({ ...prev, category: event.target.value }))}
                  placeholder="translator, ai, content..."
                />
              </label>
              <label className="admin-access-checkbox">
                <input
                  type="checkbox"
                  checked={featureForm.active}
                  onChange={(event) => setFeatureForm((prev) => ({ ...prev, active: event.target.checked }))}
                />
                Đang bật. Bỏ chọn = tạm tắt. Khi tắt, người dùng sẽ không mở được tính năng này.
              </label>
              <div className="admin-access-actions">
                <button type="submit" className="btn btn-primary" disabled={busy}>
                  {editingFeatureKey ? <Edit3 size={14} /> : <Plus size={14} />}
                  {editingFeatureKey ? 'Cập nhật tính năng' : 'Tạo tính năng'}
                </button>
                {editingFeatureKey ? (
                  <button type="button" className="btn btn-secondary" onClick={resetFeatureForm} disabled={busy}>
                    Hủy sửa
                  </button>
                ) : null}
              </div>
            </form>
          </div>
        </section>
      ) : null}

      {activeTab === 'adult' ? (
        <section className="admin-access-section admin-access-grid two">
          <div className="admin-access-panel">
            <h2>Điều khoản 18+</h2>
            <form className="admin-access-form" onSubmit={submitConsent}>
              <label>
                Phiên bản
                <input className="input" value={consentForm.version} onChange={(event) => setConsentForm((prev) => ({ ...prev, version: event.target.value }))} placeholder="2026-05" required />
              </label>
              <label>
                Tiêu đề
                <input className="input" value={consentForm.title} onChange={(event) => setConsentForm((prev) => ({ ...prev, title: event.target.value }))} required />
              </label>
              <label className="admin-access-form__wide">
                Nội dung
                <textarea className="textarea" value={consentForm.body} onChange={(event) => setConsentForm((prev) => ({ ...prev, body: event.target.value }))} rows={6} />
              </label>
              <label className="admin-access-checkbox">
                <input type="checkbox" checked={consentForm.active} onChange={(event) => setConsentForm((prev) => ({ ...prev, active: event.target.checked }))} />
                Đặt làm phiên bản đang dùng
              </label>
              <button type="submit" className="btn btn-primary" disabled={busy}>Lưu điều khoản</button>
            </form>
          </div>
          <div className="admin-access-panel">
            <h2>Phiên bản hiện có</h2>
            <div className="admin-access-version-list">
              {catalog.consentVersions.map((item) => (
                <button
                  type="button"
                  key={`${item.key}:${item.version}`}
                  className={`admin-access-version ${item.active ? 'is-active' : ''}`}
                  onClick={() => setConsentForm({
                    version: item.version || '',
                    title: item.title || '',
                    body: item.body || '',
                    active: item.active !== false,
                  })}
                >
                  <strong>{item.version}</strong>
                  <span>{item.title}</span>
                  <small>{item.active ? 'Đang dùng' : formatDateTime(item.effective_at)}</small>
                </button>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      {activeTab === 'audit' ? (
        <section className="admin-access-section">
          <SectionHeading
            title="Nhật ký"
            note="Tách lượt dùng sản phẩm và thao tác quản trị để dễ rà soát khi có sự cố quyền."
          />
          <form className="admin-access-toolbar admin-access-toolbar--filters" onSubmit={applyUsageFilters}>
            <label>
              Tính năng sử dụng
              <select className="select" value={usageFilters.featureKey} onChange={(event) => setUsageFilters((prev) => ({ ...prev, featureKey: event.target.value }))}>
                <option value="">Tất cả tính năng</option>
                {catalog.features.map((feature) => <option key={feature.key} value={feature.key}>{getFeatureDisplayName(feature)}</option>)}
              </select>
            </label>
            <label>
              Nguồn AI
              <select className="select" value={usageFilters.provider} onChange={(event) => setUsageFilters((prev) => ({ ...prev, provider: event.target.value }))}>
                <option value="">Tất cả nguồn AI</option>
                <option value="ag_proxy">Gemini Proxy AG</option>
                <option value="ai_studio_relay">AI Studio Relay</option>
                <option value="custom_proxy">Proxy tùy chỉnh</option>
              </select>
            </label>
            <button type="submit" className="btn btn-secondary" disabled={busy}>Áp dụng bộ lọc</button>
          </form>

          <div className="admin-access-grid two">
            <div className="admin-access-panel">
              <h2>Lượt dùng gần đây</h2>
              <div className="admin-access-table-wrap compact">
                <table className="admin-access-table admin-access-table--compact">
                  <thead>
                    <tr>
                      <th>Thời gian</th>
                      <th>Tính năng</th>
                      <th>Nguồn AI</th>
                      <th>Trạng thái</th>
                    </tr>
                  </thead>
                  <tbody>
                    {usage.map((item) => (
                      <tr key={item.id}>
                        <td>{formatDateTime(item.created_at)}</td>
                        <td>{item.feature_key ? getFeatureDisplayName(item.feature_key) : 'Không rõ'}</td>
                        <td>{getProviderLabel(item.provider)}</td>
                        <td>{item.status === 'ok' || !item.status ? 'Thành công' : item.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="admin-access-panel">
              <h2>Nhật ký quản trị</h2>
              <div className="admin-access-table-wrap compact">
                <table className="admin-access-table admin-access-table--compact">
                  <thead>
                    <tr>
                      <th>Thời gian</th>
                      <th>Thao tác</th>
                      <th>Đối tượng</th>
                    </tr>
                  </thead>
                  <tbody>
                    {audit.map((item) => (
                      <tr key={item.id} title={`Trước: ${summarizeJson(item.before_json)}\nSau: ${summarizeJson(item.after_json)}`}>
                        <td>{formatDateTime(item.created_at)}</td>
                        <td>{getAuditActionLabel(item.action)}</td>
                        <td>{item.target_feature_key ? getFeatureDisplayName(item.target_feature_key) : item.target_user_id || 'Hệ thống'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </section>
      ) : null}

      <ConfirmModal
        action={confirmAction}
        busy={busy}
        onCancel={() => setConfirmAction(null)}
        onConfirm={() => confirmAction?.action && runAdminAction(confirmAction.action)}
      />
    </div>
  );
}
