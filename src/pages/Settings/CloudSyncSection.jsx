import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  AlertTriangle,
  Cloud,
  Database,
  Download,
  LogIn,
  LogOut,
  RefreshCw,
  Trash2,
  Upload,
  UserRound,
} from 'lucide-react';
import { PRODUCT_SURFACE } from '../../config/productSurface';
import { toVietnameseErrorMessage } from '../../utils/errorMessages.js';
import db from '../../services/db/database.js';
import {
  DEFAULT_STORY_CREATION_SETTINGS,
  STORY_CREATION_PROMPT_GROUPS,
  getStoryCreationSettings,
  getStoryCreationSettingsMeta,
} from '../../services/ai/storyCreationSettings.js';
import useProjectStore from '../../stores/projectStore';
import {
  backupChatThread,
  backupProject,
  backupPromptBundle,
  deleteChatBackup,
  deleteProjectBackup,
  deletePromptBackup,
  exportCloudBackups,
  getSession,
  getCloudSyncPreferences,
  importCloudBackups,
  isCloudAuthConfigured,
  listChatBackups,
  listProjectBackups,
  listPromptBackups,
  runAutoSyncCycle,
  restoreChatBackup,
  restoreProjectBackup,
  restorePromptBackup,
  saveCloudSyncPreferences,
  scanCloudSyncState,
  signInWithGoogle,
  signOut,
  subscribe,
  subscribeCloudSyncStatus,
} from '../../services/cloud/cloudSyncService.js';

function formatTimestamp(value) {
  if (!value) return 'chua dong bo';
  try {
    return new Date(value).toLocaleString('vi-VN');
  } catch {
    return 'chua dong bo';
  }
}

function formatBytes(bytes) {
  const normalized = Number(bytes || 0);
  if (!normalized) return '0 B';
  if (normalized < 1024) return `${normalized} B`;
  if (normalized < 1024 * 1024) return `${(normalized / 1024).toFixed(1)} KB`;
  return `${(normalized / (1024 * 1024)).toFixed(2)} MB`;
}

function summarizePromptBundle() {
  const current = getStoryCreationSettings();
  const customizedGroupCount = STORY_CREATION_PROMPT_GROUPS.filter((group) => {
    const currentGroup = current[group.key] || {};
    const defaultGroup = DEFAULT_STORY_CREATION_SETTINGS[group.key] || {};
    return JSON.stringify(currentGroup) !== JSON.stringify(defaultGroup);
  }).length;

  return {
    groupCount: STORY_CREATION_PROMPT_GROUPS.length,
    customizedGroupCount,
  };
}

function isOwnedByDifferentUser(ownerUserId, currentUserId) {
  const owner = String(ownerUserId || '').trim();
  const current = String(currentUserId || '').trim();
  return Boolean(owner && current && owner !== current);
}

const EMPTY_RESTORE_STATE = {
  open: false,
  item: null,
  mode: 'duplicate',
  targetProjectId: '',
};

export default function CloudSyncSection() {
  const navigate = useNavigate();
  const location = useLocation();
  const { projectId } = useParams();
  const scopedProjectId = Number.isFinite(Number(projectId)) ? Number(projectId) : null;
  const targetPath = scopedProjectId ? `/project/${scopedProjectId}/cloud-sync` : '/cloud-sync';
  const openCloudSyncPage = () => {
    navigate(targetPath, {
      state: { returnTo: `${location.pathname}${location.search}${location.hash}` },
    });
  };

  if (!PRODUCT_SURFACE.enableCloudSync) {
    return null;
  }

  return (
    <section className="settings-section card animate-slide-up cloud-sync-teaser" id="cloud-sync" style={{ animationDelay: '300ms' }}>
      <div className="settings-section-header">
        <Cloud size={20} />
        <div>
          <h2>Cloud Sync</h2>
          <p>
            Mo trang rieng de dang nhap Google, sao luu du an, khoi phuc chat, quan ly prompt va theo doi trang thai dong bo tren ca PC lan dien thoai.
          </p>
        </div>
      </div>

      <div className="cloud-sync-teaser__body">
        <div className="cloud-sync-teaser__copy">
          <strong>Trang doc lap, toi uu cho ca desktop va mobile</strong>
          <p>
            Toan bo thao tac sao luu, khoi phuc, tu dong bo, xung dot du lieu va xuat/nhap snapshot da duoc chuyen sang mot man hinh rieng de de dung hon.
          </p>
        </div>

        <div className="cloud-sync-teaser__actions">
          <button
            type="button"
            className="btn btn-primary"
            onClick={openCloudSyncPage}
          >
            <Cloud size={14} /> Mo Cloud Sync
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={openCloudSyncPage}
          >
            <Database size={14} /> Xem trang sao luu
          </button>
        </div>
      </div>
    </section>
  );
}

export function CloudSyncWorkspace({ standalone = false, compact = false }) {
  const navigate = useNavigate();
  const { projectId } = useParams();
  const scopedProjectId = Number.isFinite(Number(projectId)) ? Number(projectId) : null;
  const {
    currentProject,
    projects,
    loadProject,
    loadProjects,
  } = useProjectStore();

  const [session, setSession] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [projectItems, setProjectItems] = useState([]);
  const [chatItems, setChatItems] = useState([]);
  const [promptItems, setPromptItems] = useState([]);
  const [localChatThreads, setLocalChatThreads] = useState([]);
  const [promptSummary, setPromptSummary] = useState(() => summarizePromptBundle());
  const [loadingCloud, setLoadingCloud] = useState(false);
  const [savingKey, setSavingKey] = useState('');
  const [restoringKey, setRestoringKey] = useState('');
  const [deletingKey, setDeletingKey] = useState('');
  const [exportingFormat, setExportingFormat] = useState('');
  const [importingCloud, setImportingCloud] = useState(false);
  const [autoSyncPrefs, setAutoSyncPrefs] = useState(() => getCloudSyncPreferences());
  const [syncStatus, setSyncStatus] = useState({
    pendingUploads: [],
    conflicts: [],
    lastRunAt: 0,
    autoSyncEnabled: getCloudSyncPreferences().autoSyncEnabled,
    uploadedCount: 0,
    accountMismatch: false,
  });
  const [restoreState, setRestoreState] = useState(EMPTY_RESTORE_STATE);
  const [message, setMessage] = useState(null);
  const importInputRef = useRef(null);

  const isConfigured = isCloudAuthConfigured();
  const isSignedIn = Boolean(session?.user?.id);
  const currentUserId = String(session?.user?.id || '').trim();
  const sortedProjects = useMemo(
    () => [...projects].sort((left, right) => Number(right.updated_at || 0) - Number(left.updated_at || 0)),
    [projects],
  );

  const showMessage = (type, text) => {
    setMessage({ type, text });
  };

  const refreshSyncStatus = async () => {
    if (!isConfigured || !isSignedIn) {
      setSyncStatus({
        pendingUploads: [],
        conflicts: [],
        lastRunAt: getCloudSyncPreferences().lastRunAt,
        autoSyncEnabled: getCloudSyncPreferences().autoSyncEnabled,
        uploadedCount: 0,
        accountMismatch: false,
      });
      return;
    }

    try {
      const nextStatus = await scanCloudSyncState();
      const prefs = getCloudSyncPreferences();
      setAutoSyncPrefs(prefs);
      setSyncStatus({
        ...nextStatus,
        autoSyncEnabled: prefs.autoSyncEnabled,
      });
    } catch (error) {
      showMessage('error', toVietnameseErrorMessage(error, 'Không thể xử lý Cloud Sync.'));
    }
  };

  const refreshLocalChatThreads = async () => {
    const [threads, messages] = await Promise.all([
      db.ai_chat_threads.toArray(),
      db.ai_chat_messages.toArray(),
    ]);

    const projectTitleMap = new Map(projects.map((project) => [Number(project.id), project.title]));
    const messageCountMap = messages.reduce((acc, item) => {
      const key = Number(item.thread_id);
      acc.set(key, (acc.get(key) || 0) + 1);
      return acc;
    }, new Map());

    const nextThreads = [...threads]
      .sort((left, right) => Number(right.updated_at || 0) - Number(left.updated_at || 0))
      .map((thread) => ({
        ...thread,
        messageCount: messageCountMap.get(Number(thread.id)) || 0,
        projectTitle: Number(thread.project_id) > 0
          ? projectTitleMap.get(Number(thread.project_id)) || `Project #${thread.project_id}`
          : 'Chat tu do',
      }));

    setLocalChatThreads(nextThreads);
  };

  const refreshPromptSummary = () => {
    setPromptSummary(summarizePromptBundle());
  };

  const refreshCloud = async (nextSession = session) => {
    if (!isConfigured || !nextSession?.user?.id) {
      setProjectItems([]);
      setChatItems([]);
      setPromptItems([]);
      return;
    }

    setLoadingCloud(true);
    try {
      const [nextProjects, nextChats, nextPrompts] = await Promise.all([
        listProjectBackups(),
        listChatBackups(),
        listPromptBackups(),
      ]);
      setProjectItems(nextProjects);
      setChatItems(nextChats);
      setPromptItems(nextPrompts);
      await refreshSyncStatus();
    } catch (error) {
      showMessage('error', toVietnameseErrorMessage(error, 'Không thể xử lý Cloud Sync.'));
    } finally {
      setLoadingCloud(false);
    }
  };

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  useEffect(() => {
    refreshLocalChatThreads().catch((error) => {
      showMessage('error', toVietnameseErrorMessage(error, 'Không thể xử lý Cloud Sync.'));
    });
    refreshPromptSummary();
  }, [projects]);

  useEffect(() => {
    refreshSyncStatus().catch(() => {});
  }, [isSignedIn, projectItems.length, chatItems.length, promptItems.length, localChatThreads.length, promptSummary.customizedGroupCount]);

  useEffect(() => {
    if (!PRODUCT_SURFACE.enableCloudSync) return undefined;

    let cancelled = false;

    async function hydrateSession() {
      if (!isConfigured) {
        if (!cancelled) {
          setSession(null);
          setAuthLoading(false);
        }
        return;
      }

      try {
        const nextSession = await getSession();
        if (!cancelled) {
          setSession(nextSession);
          setAuthLoading(false);
          if (nextSession?.user?.id) {
            refreshCloud(nextSession).catch(() => {});
          }
        }
      } catch (error) {
        if (!cancelled) {
          setSession(null);
          setAuthLoading(false);
          showMessage('error', toVietnameseErrorMessage(error, 'Không thể xử lý Cloud Sync.'));
        }
      }
    }

    hydrateSession().catch(() => {});
    const unsubscribe = subscribe((nextSession) => {
      if (cancelled) return;
      setSession(nextSession);
      setAuthLoading(false);
      if (nextSession?.user?.id) {
        refreshCloud(nextSession).catch(() => {});
      } else {
        setProjectItems([]);
        setChatItems([]);
        setPromptItems([]);
        setSyncStatus({
          pendingUploads: [],
          conflicts: [],
          lastRunAt: getCloudSyncPreferences().lastRunAt,
          autoSyncEnabled: getCloudSyncPreferences().autoSyncEnabled,
          uploadedCount: 0,
          accountMismatch: false,
        });
      }
    });

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [isConfigured]);

  useEffect(() => {
    const unsubscribe = subscribeCloudSyncStatus((detail) => {
      if (!detail) return;
      setAutoSyncPrefs(getCloudSyncPreferences());
      setSyncStatus((prev) => ({
        ...prev,
        ...detail,
      }));
      refreshCloud().catch(() => {});
      refreshLocalChatThreads().catch(() => {});
      refreshPromptSummary();
    });

    return () => unsubscribe?.();
  }, []);

  if (!PRODUCT_SURFACE.enableCloudSync) {
    return null;
  }

  const handleSignIn = async () => {
    try {
      await signInWithGoogle();
    } catch (error) {
      showMessage('error', toVietnameseErrorMessage(error, 'Không thể xử lý Cloud Sync.'));
    }
  };

  const handleSignOut = async () => {
    try {
      await signOut();
      setProjectItems([]);
      setChatItems([]);
      setPromptItems([]);
      showMessage('success', 'Da dang xuat Cloud Sync.');
    } catch (error) {
      showMessage('error', toVietnameseErrorMessage(error, 'Không thể xử lý Cloud Sync.'));
    }
  };

  const handleToggleAutoSync = async () => {
    const nextPrefs = saveCloudSyncPreferences({
      autoSyncEnabled: !autoSyncPrefs.autoSyncEnabled,
      activeUserId: currentUserId,
    });
    setAutoSyncPrefs(nextPrefs);
    setSyncStatus((prev) => ({
      ...prev,
      autoSyncEnabled: nextPrefs.autoSyncEnabled,
    }));

    if (nextPrefs.autoSyncEnabled && isSignedIn) {
      try {
        const result = await runAutoSyncCycle({ reason: 'manual-enable' });
        await refreshCloud();
        showMessage(
          'success',
          result.uploadedCount > 0
            ? `Da bat auto sync va day ${result.uploadedCount} snapshot len cloud.`
            : 'Da bat auto sync. Khong co thay doi nao can day len cloud.',
        );
      } catch (error) {
        showMessage('error', toVietnameseErrorMessage(error, 'Không thể xử lý Cloud Sync.'));
      }
      return;
    }

    showMessage('success', nextPrefs.autoSyncEnabled ? 'Da bat auto sync.' : 'Da tat auto sync.');
  };

  const handleRunSyncNow = async () => {
    try {
      const result = await runAutoSyncCycle({ reason: 'manual-run', force: true });
      await refreshCloud();
      showMessage(
        'success',
        result.uploadedCount > 0
          ? `Da sync ${result.uploadedCount} snapshot len cloud.`
          : result.conflicts?.length
            ? `Khong auto sync vi co ${result.conflicts.length} conflict can xu ly.`
            : 'Khong co thay doi nao can sync.',
      );
    } catch (error) {
      showMessage('error', toVietnameseErrorMessage(error, 'Không thể xử lý Cloud Sync.'));
    }
  };

  const handleExportCloud = async (format) => {
    setExportingFormat(format);
    try {
      const result = await exportCloudBackups(format);
      showMessage('success', `Da xuat ${result.count} snapshot cloud ra file ${result.format}.`);
    } catch (error) {
      showMessage('error', toVietnameseErrorMessage(error, 'Không thể xử lý Cloud Sync.'));
    } finally {
      setExportingFormat('');
    }
  };

  const handleImportCloudFile = async (event) => {
    const file = event.target.files?.[0] || null;
    if (!file) return;

    setImportingCloud(true);
    try {
      const result = await importCloudBackups(file);
      await refreshCloud();
      showMessage(
        'success',
        result.skippedCount > 0
          ? `Da import ${result.importedCount} snapshot, bo qua ${result.skippedCount} snapshot cloud moi hon.`
          : `Da import ${result.importedCount} snapshot cloud.`,
      );
    } catch (error) {
      showMessage('error', toVietnameseErrorMessage(error, 'Không thể xử lý Cloud Sync.'));
    } finally {
      setImportingCloud(false);
      if (event.target) {
        event.target.value = '';
      }
    }
  };

  const handleProjectBackup = async (project) => {
    const actionKey = `project:${project.id}`;
    setSavingKey(actionKey);
    try {
      await backupProject(project);
      await loadProjects();
      await refreshCloud();
      showMessage('success', `Da backup "${project.title}" len cloud.`);
    } catch (error) {
      showMessage('error', toVietnameseErrorMessage(error, 'Không thể xử lý Cloud Sync.'));
    } finally {
      setSavingKey('');
    }
  };

  const handleChatBackup = async (thread) => {
    const actionKey = `chat:${thread.id}`;
    setSavingKey(actionKey);
    try {
      await backupChatThread(thread);
      await refreshCloud();
      showMessage('success', `Da backup chat "${thread.title}" len cloud.`);
    } catch (error) {
      showMessage('error', toVietnameseErrorMessage(error, 'Không thể xử lý Cloud Sync.'));
    } finally {
      setSavingKey('');
    }
  };

  const handlePromptBackup = async () => {
    setSavingKey('prompt');
    try {
      await backupPromptBundle();
      await refreshCloud();
      showMessage('success', 'Da backup Global prompt bundle len cloud.');
    } catch (error) {
      showMessage('error', toVietnameseErrorMessage(error, 'Không thể xử lý Cloud Sync.'));
    } finally {
      setSavingKey('');
    }
  };

  const openRestoreModal = (item) => {
    setRestoreState({
      open: true,
      item,
      mode: 'duplicate',
      targetProjectId: scopedProjectId ? String(scopedProjectId) : '',
    });
  };

  const closeRestoreModal = () => {
    if (restoringKey) return;
    setRestoreState(EMPTY_RESTORE_STATE);
  };

  const handleProjectRestore = async () => {
    if (!restoreState.item?.itemSlug) return;
    if (restoreState.mode === 'replace' && !restoreState.targetProjectId) {
      showMessage('error', 'Hay chon project local de ghi de.');
      return;
    }

    const actionKey = `project:${restoreState.item.itemSlug}`;
    setRestoringKey(actionKey);
    try {
      const result = await restoreProjectBackup(restoreState.item.itemSlug, {
        mode: restoreState.mode,
        targetProjectId: restoreState.mode === 'replace'
          ? Number(restoreState.targetProjectId)
          : null,
      });

      await loadProjects();
      await refreshCloud();

      if (restoreState.mode === 'replace' && currentProject?.id === Number(restoreState.targetProjectId)) {
        await loadProject(result.newProjectId);
      }

      if (restoreState.mode === 'replace' && scopedProjectId === Number(restoreState.targetProjectId)) {
        navigate(`/project/${result.newProjectId}/settings`, { replace: true });
      }

      showMessage(
        'success',
        restoreState.mode === 'replace'
          ? `Da ghi de project local bang snapshot "${restoreState.item.itemTitle}".`
          : `Da khoi phuc snapshot "${restoreState.item.itemTitle}" thanh project moi (#${result.newProjectId}).`,
      );
      setRestoreState(EMPTY_RESTORE_STATE);
    } catch (error) {
      showMessage('error', toVietnameseErrorMessage(error, 'Không thể xử lý Cloud Sync.'));
    } finally {
      setRestoringKey('');
    }
  };

  const handleChatRestore = async (item) => {
    if (!window.confirm(`Khoi phuc chat "${item.itemTitle}" thanh thread local moi?`)) {
      return;
    }

    const actionKey = `chat:${item.itemSlug}`;
    setRestoringKey(actionKey);
    try {
      const result = await restoreChatBackup(item.itemSlug);
      await refreshLocalChatThreads();
      await refreshCloud();
      showMessage(
        'success',
        result.projectId > 0
          ? `Da khoi phuc chat "${item.itemTitle}" vao project #${result.projectId}.`
          : `Da khoi phuc chat "${item.itemTitle}" vao khu chat tu do.`,
      );
    } catch (error) {
      showMessage('error', toVietnameseErrorMessage(error, 'Không thể xử lý Cloud Sync.'));
    } finally {
      setRestoringKey('');
    }
  };

  const handlePromptRestore = async (item) => {
    if (!window.confirm('Khoi phuc prompt cloud se ghi de toan bo Global prompt hien tai. Tiep tuc?')) {
      return;
    }

    const actionKey = `prompt:${item.itemSlug}`;
    setRestoringKey(actionKey);
    try {
      await restorePromptBackup(item.itemSlug);
      refreshPromptSummary();
      await refreshCloud();
      showMessage('success', 'Da khoi phuc Global prompt bundle tu cloud.');
    } catch (error) {
      showMessage('error', toVietnameseErrorMessage(error, 'Không thể xử lý Cloud Sync.'));
    } finally {
      setRestoringKey('');
    }
  };

  const handleDelete = async (scope, itemSlug) => {
    if (!window.confirm('Xoa snapshot cloud nay? Ban local se khong bi anh huong.')) {
      return;
    }

    const actionKey = `${scope}:${itemSlug}`;
    setDeletingKey(actionKey);
    try {
      if (scope === 'project') {
        await deleteProjectBackup(itemSlug);
      } else if (scope === 'chat') {
        await deleteChatBackup(itemSlug);
      } else {
        await deletePromptBackup(itemSlug);
      }
      await refreshCloud();
      showMessage('success', `Da xoa snapshot ${itemSlug} tren cloud.`);
    } catch (error) {
      showMessage('error', toVietnameseErrorMessage(error, 'Không thể xử lý Cloud Sync.'));
    } finally {
      setDeletingKey('');
    }
  };

  const renderConflictActions = (item) => {
    if (item.scope === 'project') {
      return (
        <>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => handleProjectBackup(item.data)}>
            <Upload size={14} /> Luu local de cloud
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => openRestoreModal(item.cloudItem)}>
            <Download size={14} /> Khoi phuc cloud
          </button>
        </>
      );
    }

    if (item.scope === 'chat') {
      return (
        <>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => handleChatBackup(item.data)}>
            <Upload size={14} /> Luu local de cloud
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => handleChatRestore(item.cloudItem)}>
            <Download size={14} /> Khoi phuc cloud
          </button>
        </>
      );
    }

    return (
      <>
        <button type="button" className="btn btn-secondary btn-sm" onClick={handlePromptBackup}>
          <Upload size={14} /> Luu local de cloud
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => handlePromptRestore(item.cloudItem)}>
          <Download size={14} /> Khoi phuc cloud
        </button>
      </>
    );
  };

  const promptMeta = getStoryCreationSettingsMeta();
  const promptOwnedByOtherUser = isOwnedByDifferentUser(promptMeta?.ownerUserId, currentUserId);

  const workspaceContent = (
    <>
      {!standalone ? (
        <div className="settings-section-header">
          <Cloud size={20} />
          <div>
            <h2>Cloud Sync</h2>
            <p>
              Dang nhap Google de sao luu va khoi phuc du an, chat va prompt tren Supabase. Ung dung van local-first; cloud chi la noi luu va dong bo du lieu.
            </p>
          </div>
        </div>
      ) : null}

      {message && (
        <div className={`settings-test-result ${message.type === 'success' ? 'success' : 'error'}`}>
          {message.text}
        </div>
      )}

      {!isConfigured ? (
        <div className="cloud-sync-auth-card cloud-sync-auth-card--warning">
          <div className="cloud-sync-auth-card__copy">
            <AlertTriangle size={16} />
            <div>
            <strong>Cloud Sync chua duoc cau hinh</strong>
              <p>Can them `VITE_SUPABASE_URL` va `VITE_SUPABASE_ANON_KEY` vao bien moi truong truoc khi dang nhap.</p>
            </div>
          </div>
        </div>
      ) : (
        <div className="cloud-sync-auth-card">
          <div className="cloud-sync-auth-card__copy">
            <UserRound size={16} />
            <div>
              <strong>{isSignedIn ? 'Dang ket noi cloud' : 'Chua dang nhap cloud'}</strong>
              <p>
                {authLoading
                  ? 'Dang kiem tra phien dang nhap...'
                  : isSignedIn
                    ? `${session.user.email || session.user.user_metadata?.email || 'Tai khoan Google da ket noi'}`
                    : 'Dang nhap Google de sao luu va khoi phuc du lieu local.'}
              </p>
            </div>
          </div>

          <div className="cloud-sync-auth-card__actions">
            {isSignedIn ? (
              <>
                <button
                  type="button"
                  className="btn btn-ghost btn-icon"
                  onClick={() => refreshCloud()}
                  disabled={loadingCloud}
                  title="Tai lai danh sach snapshot"
                >
                  {loadingCloud ? <RefreshCw size={16} className="animate-spin" /> : <Database size={16} />}
                </button>
                <button type="button" className="btn btn-secondary" onClick={handleSignOut}>
                  <LogOut size={14} /> Dang xuat
                </button>
              </>
            ) : (
              <button type="button" className="btn btn-primary" onClick={handleSignIn} disabled={authLoading}>
                {authLoading ? <RefreshCw size={14} className="animate-spin" /> : <LogIn size={14} />}
                Dang nhap Google
              </button>
            )}
          </div>
        </div>
      )}

      <input
        ref={importInputRef}
        type="file"
        accept=".json,.zip,application/json,application/zip"
        style={{ display: 'none' }}
        onChange={handleImportCloudFile}
      />

      <div className="cloud-sync-ops">
        <div className="cloud-sync-ops__summary">
          <strong>{autoSyncPrefs.autoSyncEnabled ? 'Tu dong bo dang bat' : 'Tu dong bo dang tat'}</strong>
          <p>
            Cho tai len: {syncStatus.pendingUploads.length} | Xung dot: {syncStatus.conflicts.length} | Lan chay cuoi: {formatTimestamp(syncStatus.lastRunAt)}
          </p>
          {syncStatus.accountMismatch ? (
            <p>Tai khoan Google hien tai khac voi tai khoan da bat tu dong bo truoc do. Hay bat lai tu dong bo neu muon doi tai khoan.</p>
          ) : null}
        </div>
        <div className="cloud-sync-ops__actions">
          <button
            type="button"
            className={`btn ${autoSyncPrefs.autoSyncEnabled ? 'btn-secondary' : 'btn-primary'}`}
            onClick={handleToggleAutoSync}
            disabled={!isSignedIn}
          >
            {autoSyncPrefs.autoSyncEnabled ? 'Tat tu dong bo' : 'Bat tu dong bo'}
          </button>
          <button type="button" className="btn btn-secondary" onClick={handleRunSyncNow} disabled={!isSignedIn || loadingCloud}>
            <RefreshCw size={14} /> Chay dong bo ngay
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => handleExportCloud('zip')} disabled={!isSignedIn || exportingFormat === 'zip' || importingCloud}>
            {exportingFormat === 'zip' ? <RefreshCw size={14} className="animate-spin" /> : <Download size={14} />}
            Xuat .zip
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => handleExportCloud('json')} disabled={!isSignedIn || exportingFormat === 'json' || importingCloud}>
            {exportingFormat === 'json' ? <RefreshCw size={14} className="animate-spin" /> : <Download size={14} />}
            Xuat .json
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => importInputRef.current?.click()} disabled={!isSignedIn || importingCloud}>
            {importingCloud ? <RefreshCw size={14} className="animate-spin" /> : <Upload size={14} />}
            Nhap tu cloud
          </button>
        </div>
      </div>

      {syncStatus.conflicts.length > 0 ? (
        <div className="cloud-sync-conflicts">
          <div className="cloud-sync-conflicts__header">
            <strong>Xung dot can xu ly thu cong</strong>
            <span>{syncStatus.conflicts.length}</span>
          </div>
          <div className="cloud-sync-list">
            {syncStatus.conflicts.map((item) => (
              <div key={`${item.scope}:${item.itemSlug}`} className="cloud-sync-item cloud-sync-item--conflict">
                <div className="cloud-sync-item__body">
                  <strong>{item.itemTitle}</strong>
                  <small>
                    {item.scope} | local: {formatTimestamp(item.localUpdatedAt)} | cloud: {formatTimestamp(item.cloudUpdatedAt)}
                  </small>
                </div>
                <div className="cloud-sync-item__actions">
                  {renderConflictActions(item)}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="cloud-sync-grid">
        <div className="cloud-sync-panel">
          <div className="cloud-sync-panel__header">
            <strong>Project local</strong>
            <span>{sortedProjects.length}</span>
          </div>
          {sortedProjects.length === 0 ? (
            <p className="settings-hint">Chua co project local nao de sao luu.</p>
          ) : (
            <div className="cloud-sync-list">
              {sortedProjects.map((project) => {
                const actionKey = `project:${project.id}`;
                const ownedByOtherUser = isOwnedByDifferentUser(project?.cloud_owner_user_id, currentUserId);
                return (
                  <div key={project.id} className="cloud-sync-item">
                    <div className="cloud-sync-item__body">
                      <strong>{project.title}</strong>
                      <small>
                        slug: {project.cloud_project_slug || '(se tao luc backup)'} | sync: {formatTimestamp(project.cloud_last_synced_at)}
                      </small>
                      {ownedByOtherUser ? (
                        <small>Du lieu nay dang gan voi mot tai khoan cloud khac. Hay khoi phuc hoac nhap dung tai khoan truoc khi sao luu.</small>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => handleProjectBackup(project)}
                      disabled={!isSignedIn || savingKey === actionKey || ownedByOtherUser}
                    >
                      {savingKey === actionKey ? <RefreshCw size={14} className="animate-spin" /> : <Upload size={14} />}
                      Luu len cloud
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="cloud-sync-panel">
          <div className="cloud-sync-panel__header">
            <strong>Snapshot project tren cloud</strong>
            <span>{projectItems.length}</span>
          </div>
          {!isSignedIn ? (
            <p className="settings-hint">Dang nhap Google de xem snapshot tren cloud.</p>
          ) : projectItems.length === 0 ? (
            <p className="settings-hint">Tai khoan nay chua co snapshot project nao.</p>
          ) : (
            <div className="cloud-sync-list">
              {projectItems.map((item) => {
                const restoreActionKey = `project:${item.itemSlug}`;
                const deleteActionKey = `project:${item.itemSlug}`;
                return (
                  <div key={item.itemSlug} className="cloud-sync-item">
                    <div className="cloud-sync-item__body">
                      <strong>{item.itemTitle}</strong>
                      <small>
                        slug: {item.itemSlug} | cap nhat: {formatTimestamp(item.updatedAt)} | {formatBytes(item.sizeBytes)}
                      </small>
                    </div>
                    <div className="cloud-sync-item__actions">
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => openRestoreModal(item)}
                        disabled={!isSignedIn || restoringKey === restoreActionKey}
                      >
                        {restoringKey === restoreActionKey ? <RefreshCw size={14} className="animate-spin" /> : <Download size={14} />}
                        Khoi phuc
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-icon btn-sm"
                        onClick={() => handleDelete('project', item.itemSlug)}
                        disabled={!isSignedIn || deletingKey === deleteActionKey}
                        title="Xoa snapshot cloud"
                      >
                        {deletingKey === deleteActionKey ? <RefreshCw size={14} className="animate-spin" /> : <Trash2 size={14} />}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <div className="cloud-sync-grid">
        <div className="cloud-sync-panel">
          <div className="cloud-sync-panel__header">
            <strong>Doan chat local</strong>
            <span>{localChatThreads.length}</span>
          </div>
          {localChatThreads.length === 0 ? (
            <p className="settings-hint">Chua co doan chat local nao de sao luu.</p>
          ) : (
            <div className="cloud-sync-list">
              {localChatThreads.map((thread) => {
                const actionKey = `chat:${thread.id}`;
                const ownedByOtherUser = isOwnedByDifferentUser(thread?.cloud_owner_user_id, currentUserId);
                return (
                  <div key={thread.id} className="cloud-sync-item">
                    <div className="cloud-sync-item__body">
                      <strong>{thread.title}</strong>
                      <small>
                        {thread.projectTitle} | {thread.messageCount} tin nhan | cap nhat: {formatTimestamp(thread.updated_at)}
                      </small>
                      {ownedByOtherUser ? (
                        <small>Doan chat nay dang gan voi mot tai khoan cloud khac.</small>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => handleChatBackup(thread)}
                      disabled={!isSignedIn || savingKey === actionKey || ownedByOtherUser}
                    >
                      {savingKey === actionKey ? <RefreshCw size={14} className="animate-spin" /> : <Upload size={14} />}
                      Luu len cloud
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="cloud-sync-panel">
          <div className="cloud-sync-panel__header">
            <strong>Snapshot chat tren cloud</strong>
            <span>{chatItems.length}</span>
          </div>
          {!isSignedIn ? (
            <p className="settings-hint">Dang nhap Google de xem snapshot chat.</p>
          ) : chatItems.length === 0 ? (
            <p className="settings-hint">Tai khoan nay chua co snapshot chat nao.</p>
          ) : (
            <div className="cloud-sync-list">
              {chatItems.map((item) => {
                const restoreActionKey = `chat:${item.itemSlug}`;
                const deleteActionKey = `chat:${item.itemSlug}`;
                return (
                  <div key={item.itemSlug} className="cloud-sync-item">
                    <div className="cloud-sync-item__body">
                      <strong>{item.itemTitle}</strong>
                      <small>
                        {(item.metadata?.projectId || 0) > 0 ? `project #${item.metadata.projectId}` : 'chat tu do'} | {item.metadata?.messageCount || 0} tin nhan | {formatBytes(item.sizeBytes)}
                      </small>
                    </div>
                    <div className="cloud-sync-item__actions">
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => handleChatRestore(item)}
                        disabled={!isSignedIn || restoringKey === restoreActionKey}
                      >
                        {restoringKey === restoreActionKey ? <RefreshCw size={14} className="animate-spin" /> : <Download size={14} />}
                        Khoi phuc
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-icon btn-sm"
                        onClick={() => handleDelete('chat', item.itemSlug)}
                        disabled={!isSignedIn || deletingKey === deleteActionKey}
                        title="Xoa snapshot cloud"
                      >
                        {deletingKey === deleteActionKey ? <RefreshCw size={14} className="animate-spin" /> : <Trash2 size={14} />}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <div className="cloud-sync-grid">
        <div className="cloud-sync-panel">
          <div className="cloud-sync-panel__header">
            <strong>Bo prompt local</strong>
            <span>1</span>
          </div>
          <div className="cloud-sync-list">
            <div className="cloud-sync-item">
              <div className="cloud-sync-item__body">
                <strong>Global prompt bundle</strong>
                <small>
                  {promptSummary.customizedGroupCount}/{promptSummary.groupCount} nhom dang co tuy chinh local
                </small>
                {promptOwnedByOtherUser ? (
                  <small>Bo prompt local nay dang gan voi mot tai khoan cloud khac.</small>
                ) : null}
              </div>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={handlePromptBackup}
                disabled={!isSignedIn || savingKey === 'prompt' || promptOwnedByOtherUser}
              >
                {savingKey === 'prompt' ? <RefreshCw size={14} className="animate-spin" /> : <Upload size={14} />}
                Luu len cloud
              </button>
            </div>
          </div>
        </div>

        <div className="cloud-sync-panel">
          <div className="cloud-sync-panel__header">
            <strong>Snapshot prompt tren cloud</strong>
            <span>{promptItems.length}</span>
          </div>
          {!isSignedIn ? (
            <p className="settings-hint">Dang nhap Google de xem snapshot prompt.</p>
          ) : promptItems.length === 0 ? (
            <p className="settings-hint">Tai khoan nay chua co snapshot prompt nao.</p>
          ) : (
            <div className="cloud-sync-list">
              {promptItems.map((item) => {
                const restoreActionKey = `prompt:${item.itemSlug}`;
                const deleteActionKey = `prompt:${item.itemSlug}`;
                return (
                  <div key={item.itemSlug} className="cloud-sync-item">
                    <div className="cloud-sync-item__body">
                      <strong>{item.itemTitle}</strong>
                      <small>
                        cap nhat: {formatTimestamp(item.updatedAt)} | {formatBytes(item.sizeBytes)}
                      </small>
                    </div>
                    <div className="cloud-sync-item__actions">
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => handlePromptRestore(item)}
                        disabled={!isSignedIn || restoringKey === restoreActionKey}
                      >
                        {restoringKey === restoreActionKey ? <RefreshCw size={14} className="animate-spin" /> : <Download size={14} />}
                        Khoi phuc
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-icon btn-sm"
                        onClick={() => handleDelete('prompt', item.itemSlug)}
                        disabled={!isSignedIn || deletingKey === deleteActionKey}
                        title="Xoa snapshot cloud"
                      >
                        {deletingKey === deleteActionKey ? <RefreshCw size={14} className="animate-spin" /> : <Trash2 size={14} />}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {restoreState.open && restoreState.item ? (
        <div className="modal-overlay" onClick={closeRestoreModal}>
          <div className="modal cloud-restore-modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div>
                <div className="cloud-restore-modal__eyebrow">Khoi phuc cloud snapshot</div>
                <h3 className="modal-title">{restoreState.item.itemTitle}</h3>
              </div>
            </div>

            <div className="cloud-restore-modal__body">
              <div className="cloud-restore-mode-grid">
                <label className={`cloud-restore-mode ${restoreState.mode === 'duplicate' ? 'is-active' : ''}`}>
                  <input
                    type="radio"
                    name="cloud-restore-mode"
                    checked={restoreState.mode === 'duplicate'}
                    onChange={() => setRestoreState((prev) => ({ ...prev, mode: 'duplicate' }))}
                  />
                  <div>
                    <strong>Tao project moi</strong>
                    <p>Khoi phuc snapshot thanh mot ban local moi, khong dung vao du lieu hien co.</p>
                  </div>
                </label>

                <label className={`cloud-restore-mode ${restoreState.mode === 'replace' ? 'is-active' : ''}`}>
                  <input
                    type="radio"
                    name="cloud-restore-mode"
                    checked={restoreState.mode === 'replace'}
                    onChange={() => setRestoreState((prev) => ({ ...prev, mode: 'replace' }))}
                  />
                  <div>
                    <strong>Ghi de project local</strong>
                    <p>Xoa mot project local duoc chon roi import snapshot nay vao thay the.</p>
                  </div>
                </label>
              </div>

              {restoreState.mode === 'replace' ? (
                <div className="form-group">
                  <label className="form-label" htmlFor="cloud-restore-target">Project local bi ghi de</label>
                  <select
                    id="cloud-restore-target"
                    className="select"
                    value={restoreState.targetProjectId}
                    onChange={(event) => setRestoreState((prev) => ({ ...prev, targetProjectId: event.target.value }))}
                  >
                    <option value="">Chon project local</option>
                    {sortedProjects.map((project) => (
                      <option key={project.id} value={project.id}>{project.title}</option>
                    ))}
                  </select>
                  <span className="settings-hint">Project duoc chon se bi xoa khoi may truoc khi import snapshot.</span>
                </div>
              ) : null}
            </div>

            <div className="modal-actions">
              <button type="button" className="btn btn-ghost" onClick={closeRestoreModal} disabled={Boolean(restoringKey)}>
                Huy
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleProjectRestore}
                disabled={Boolean(restoringKey) || (restoreState.mode === 'replace' && !restoreState.targetProjectId)}
              >
                {restoringKey ? <RefreshCw size={14} className="animate-spin" /> : <Download size={14} />}
                {restoreState.mode === 'replace' ? 'Ghi de va khoi phuc' : 'Khoi phuc thanh project moi'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );

  if (standalone) {
    return (
      <div className={`cloud-sync-workspace ${compact ? 'cloud-sync-workspace--compact' : ''}`}>
        {workspaceContent}
      </div>
    );
  }

  return (
    <section className="settings-section card animate-slide-up" id="cloud-sync" style={{ animationDelay: '300ms' }}>
      {workspaceContent}
    </section>
  );
}
