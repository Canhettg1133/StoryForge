import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { KeyRound, RefreshCw, Shield, ShieldCheck } from 'lucide-react';
import { createAdminApiClient } from './adminApi.js';
import { getSupabaseClient, isSupabaseConfigured } from './supabase.js';
import StoryMirrorPage from './features/storyMirror/StoryMirrorPage.jsx';
import {
  EMPTY_DATA,
  EMPTY_USAGE_PAGE_CURSORS,
  EMPTY_USAGE_PAGINATION,
  EMPTY_VIP_RANKING,
  DEFAULT_USAGE_FILTERS,
  DEFAULT_USAGE_PAGE_SIZE,
  DEFAULT_VIP_RANKING_FILTERS,
} from './constants/adminDefaults.js';
import { NAV_GROUPS } from './constants/navigation.js';
import { ConfirmDialog, ErrorState } from './components/ui/AdminPrimitives.jsx';
import AdminShell from './layout/AdminShell.jsx';
import {
  AdvancedPanel,
  AnnouncementPanel,
  AuditPanel,
  ConsentPanel,
  FeaturesPanel,
  OverviewPanel,
  UsagePanel,
  UsersPanel,
  VipPanel,
  VipRankingPanel,
} from './views/AdminViews.jsx';

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

export default function App() {
  const [session, setSession] = useState(null);
  const [authLoading, setAuthLoading] = useState(isSupabaseConfigured());
  const [authError, setAuthError] = useState('');
  const [actor, setActor] = useState(null);
  const [data, setData] = useState(EMPTY_DATA);
  const [usagePagination, setUsagePagination] = useState(EMPTY_USAGE_PAGINATION);
  const [usagePageCursors, setUsagePageCursors] = useState(EMPTY_USAGE_PAGE_CURSORS);
  const [usageFilters, setUsageFilters] = useState(DEFAULT_USAGE_FILTERS);
  const [usageLoading, setUsageLoading] = useState(false);
  const [usageError, setUsageError] = useState('');
  const [vipRanking, setVipRanking] = useState(EMPTY_VIP_RANKING);
  const [vipRankingLoading, setVipRankingLoading] = useState(false);
  const [vipRankingError, setVipRankingError] = useState('');
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
      setLoadError(error.message || 'Không tải được phiên quản trị.');
      setActor(null);
    } finally {
      setLoading(false);
    }
  }, [adminApi]);

  const loadAdminData = useCallback(async (view = activeView) => {
    setLoading(true);
    setLoadError('');
    try {
      const viewToLoad = typeof view === 'string' ? view : activeView;
      if (viewToLoad === 'overview') {
        const overview = await adminApi.overview();
        setData((current) => ({
          ...current,
          users: overview.users?.items || [],
          audit: overview.audit?.items || [],
          usage: [],
        }));
        setUsagePagination(EMPTY_USAGE_PAGINATION);
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
    const normalizedFilters = {
      q: String(q || '').trim(),
      provider: provider || 'all',
      status: status || 'all',
    };
    setUsageFilters(normalizedFilters);
    const nextCursor = page <= 1 || resetCursor
      ? ''
      : (cursor ?? usagePageCursors[page] ?? '');
    try {
      const usage = await adminApi.usage({
        page,
        pageSize,
        ...normalizedFilters,
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
    if (activeView === 'vip-ranking') loadVipRanking(DEFAULT_VIP_RANKING_FILTERS);
  }, [activeView, actor, loadVipRanking, session]);

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
    setUsageFilters(DEFAULT_USAGE_FILTERS);
    setUsageError('');
    setVipRanking(EMPTY_VIP_RANKING);
    setVipRankingLoading(false);
    setVipRankingError('');
  };

  const openMutationConfirm = (config) => {
    setPendingConfirm(config);
  };
  openMutationConfirm.api = adminApi;

  const refreshActiveView = useCallback(async () => {
    if (activeView === 'overview') {
      await loadAdminData('overview');
      return;
    }

    if (activeView === 'vip-ranking') {
      await loadVipRanking({ ...(vipRanking.filters || DEFAULT_VIP_RANKING_FILTERS), force: true });
      return;
    }

    if (activeView === 'usage') {
      await loadUsagePage({
        page: 1,
        pageSize: usagePagination.pageSize || DEFAULT_USAGE_PAGE_SIZE,
        knownTotal: usagePagination.total,
        ...usageFilters,
        resetCursor: true,
      });
      return;
    }

    await loadAdminData(activeView);
  }, [
    activeView,
    loadAdminData,
    loadUsagePage,
    loadVipRanking,
    usageFilters,
    usagePagination.pageSize,
    usagePagination.total,
    vipRanking.filters,
  ]);

  const confirmMutation = async () => {
    if (!pendingConfirm) return;
    const action = pendingConfirm.action;
    setPendingConfirm(null);
    setLoading(true);
    setLoadError('');
    try {
      await action();
      await refreshActiveView();
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
  const reloadLoading = loading
    || (activeView === 'vip-ranking' && vipRankingLoading)
    || (activeView === 'usage' && usageLoading);

  return (
    <AdminShell actor={actor} activeView={activeView} navGroups={NAV_GROUPS} onSelectView={setActiveView} onLogout={logout} onRefresh={refreshActiveView} refreshLoading={reloadLoading}>
      <main className="admin-main">
        <header className="topbar">
          <div>
            <span>Admin riêng</span>
            <strong>StoryForge quản trị</strong>
          </div>
          <button type="button" className="button button--ghost" onClick={refreshActiveView} disabled={reloadLoading}>
            <RefreshCw size={15} />
            {reloadLoading ? 'Đang tải' : 'Tải lại'}
          </button>
        </header>
        {loadError ? <ErrorState message={loadError} onRetry={refreshActiveView} /> : null}
        {panel}
      </main>
      <ConfirmDialog pending={pendingConfirm} onCancel={() => setPendingConfirm(null)} onConfirm={confirmMutation} />
    </AdminShell>
  );
}
