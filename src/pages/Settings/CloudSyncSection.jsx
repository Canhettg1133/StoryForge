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
  if (!value) return 'chÆ°a Ä‘á»“ng bá»™';
  try {
    return new Date(value).toLocaleString('vi-VN');
  } catch {
    return 'chÆ°a Ä‘á»“ng bá»™';
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
            Má»Ÿ trang riĂªng Ä‘á»ƒ Ä‘Äƒng nháº­p Google, sao lÆ°u dá»± Ă¡n, khĂ´i phá»¥c chat, quáº£n lĂ½ prompt vĂ  theo dĂµi tráº¡ng thĂ¡i Ä‘á»“ng bá»™ trĂªn cáº£ PC láº«n Ä‘iá»‡n thoáº¡i.
          </p>
        </div>
      </div>

      <div className="cloud-sync-teaser__body">
        <div className="cloud-sync-teaser__copy">
          <strong>Trang Ä‘á»™c láº­p, tá»‘i Æ°u cho cáº£ desktop vĂ  mobile</strong>
          <p>
            ToĂ n bá»™ thao tĂ¡c sao lÆ°u, khĂ´i phá»¥c, tá»± Ä‘á»“ng bá»™, xung Ä‘á»™t dá»¯ liá»‡u vĂ  xuáº¥t/nháº­p snapshot Ä‘Ă£ Ä‘Æ°á»£c chuyá»ƒn sang má»™t mĂ n hĂ¬nh riĂªng Ä‘á»ƒ dá»… dĂ¹ng hÆ¡n.
          </p>
        </div>

        <div className="cloud-sync-teaser__actions">
          <button
            type="button"
            className="btn btn-primary"
            onClick={openCloudSyncPage}
          >
            <Cloud size={14} /> Má»Ÿ Cloud Sync
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={openCloudSyncPage}
          >
            <Database size={14} /> Xem trang sao lÆ°u
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
      showMessage('success', 'ÄĂ£ Ä‘Äƒng xuáº¥t Cloud Sync.');
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
            ? `ÄĂ£ báº­t auto sync vĂ  Ä‘áº©y ${result.uploadedCount} snapshot lĂªn cloud.`
            : 'ÄĂ£ báº­t auto sync. KhĂ´ng cĂ³ thay Ä‘á»•i nĂ o cáº§n Ä‘áº©y lĂªn cloud.',
        );
      } catch (error) {
        showMessage('error', toVietnameseErrorMessage(error, 'Không thể xử lý Cloud Sync.'));
      }
      return;
    }

    showMessage('success', nextPrefs.autoSyncEnabled ? 'ÄĂ£ báº­t auto sync.' : 'ÄĂ£ táº¯t auto sync.');
  };

  const handleRunSyncNow = async () => {
    try {
      const result = await runAutoSyncCycle({ reason: 'manual-run', force: true });
      await refreshCloud();
      showMessage(
        'success',
        result.uploadedCount > 0
          ? `ÄĂ£ sync ${result.uploadedCount} snapshot lĂªn cloud.`
          : result.conflicts?.length
            ? `KhĂ´ng auto sync vĂ¬ cĂ³ ${result.conflicts.length} conflict cáº§n xá»­ lĂ½.`
            : 'KhĂ´ng cĂ³ thay Ä‘á»•i nĂ o cáº§n sync.',
      );
    } catch (error) {
      showMessage('error', toVietnameseErrorMessage(error, 'Không thể xử lý Cloud Sync.'));
    }
  };

  const handleExportCloud = async (format) => {
    setExportingFormat(format);
    try {
      const result = await exportCloudBackups(format);
      showMessage('success', `ÄĂ£ xuáº¥t ${result.count} snapshot cloud ra file ${result.format}.`);
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
          ? `ÄĂ£ import ${result.importedCount} snapshot, bá» qua ${result.skippedCount} snapshot cloud má»›i hÆ¡n.`
          : `ÄĂ£ import ${result.importedCount} snapshot cloud.`,
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
      showMessage('success', `ÄĂ£ backup "${project.title}" lĂªn cloud.`);
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
      showMessage('success', `ÄĂ£ backup chat "${thread.title}" lĂªn cloud.`);
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
      showMessage('success', 'ÄĂ£ backup Global prompt bundle lĂªn cloud.');
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
          ? `ÄĂ£ ghi Ä‘Ă¨ project local báº±ng snapshot "${restoreState.item.itemTitle}".`
          : `ÄĂ£ khĂ´i phá»¥c snapshot "${restoreState.item.itemTitle}" thĂ nh project má»›i (#${result.newProjectId}).`,
      );
      setRestoreState(EMPTY_RESTORE_STATE);
    } catch (error) {
      showMessage('error', toVietnameseErrorMessage(error, 'Không thể xử lý Cloud Sync.'));
    } finally {
      setRestoringKey('');
    }
  };

  const handleChatRestore = async (item) => {
    if (!window.confirm(`KhĂ´i phá»¥c chat "${item.itemTitle}" thĂ nh thread local má»›i?`)) {
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
          ? `ÄĂ£ khĂ´i phá»¥c chat "${item.itemTitle}" vĂ o project #${result.projectId}.`
          : `ÄĂ£ khĂ´i phá»¥c chat "${item.itemTitle}" vĂ o khu chat tá»± do.`,
      );
    } catch (error) {
      showMessage('error', toVietnameseErrorMessage(error, 'Không thể xử lý Cloud Sync.'));
    } finally {
      setRestoringKey('');
    }
  };

  const handlePromptRestore = async (item) => {
    if (!window.confirm('KhĂ´i phá»¥c prompt cloud sáº½ ghi Ä‘Ă¨ toĂ n bá»™ Global prompt hiá»‡n táº¡i. Tiáº¿p tá»¥c?')) {
      return;
    }

    const actionKey = `prompt:${item.itemSlug}`;
    setRestoringKey(actionKey);
    try {
      await restorePromptBackup(item.itemSlug);
      refreshPromptSummary();
      await refreshCloud();
      showMessage('success', 'ÄĂ£ khĂ´i phá»¥c Global prompt bundle tá»« cloud.');
    } catch (error) {
      showMessage('error', toVietnameseErrorMessage(error, 'Không thể xử lý Cloud Sync.'));
    } finally {
      setRestoringKey('');
    }
  };

  const handleDelete = async (scope, itemSlug) => {
    if (!window.confirm('XĂ³a snapshot cloud nĂ y? Báº£n local sáº½ khĂ´ng bá»‹ áº£nh hÆ°á»Ÿng.')) {
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
      showMessage('success', `ÄĂ£ xĂ³a snapshot ${itemSlug} trĂªn cloud.`);
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
            <Upload size={14} /> LÆ°u local Ä‘á»ƒ cloud
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => openRestoreModal(item.cloudItem)}>
            <Download size={14} /> KhĂ´i phá»¥c cloud
          </button>
        </>
      );
    }

    if (item.scope === 'chat') {
      return (
        <>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => handleChatBackup(item.data)}>
            <Upload size={14} /> LÆ°u local Ä‘á»ƒ cloud
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => handleChatRestore(item.cloudItem)}>
            <Download size={14} /> KhĂ´i phá»¥c cloud
          </button>
        </>
      );
    }

    return (
      <>
        <button type="button" className="btn btn-secondary btn-sm" onClick={handlePromptBackup}>
          <Upload size={14} /> LÆ°u local Ä‘á»ƒ cloud
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => handlePromptRestore(item.cloudItem)}>
          <Download size={14} /> KhĂ´i phá»¥c cloud
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
              ÄÄƒng nháº­p Google Ä‘á»ƒ sao lÆ°u vĂ  khĂ´i phá»¥c dá»± Ă¡n, chat vĂ  prompt trĂªn Supabase. á»¨ng dá»¥ng váº«n local-first; cloud chá»‰ lĂ  nÆ¡i lÆ°u vĂ  Ä‘á»“ng bá»™ dá»¯ liá»‡u.
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
            <strong>Cloud Sync chÆ°a Ä‘Æ°á»£c cáº¥u hĂ¬nh</strong>
              <p>Cáº§n thĂªm `VITE_SUPABASE_URL` vĂ  `VITE_SUPABASE_ANON_KEY` vĂ o biáº¿n mĂ´i trÆ°á»ng trÆ°á»›c khi Ä‘Äƒng nháº­p.</p>
            </div>
          </div>
        </div>
      ) : (
        <div className="cloud-sync-auth-card">
          <div className="cloud-sync-auth-card__copy">
            <UserRound size={16} />
            <div>
              <strong>{isSignedIn ? 'Äang káº¿t ná»‘i cloud' : 'ChÆ°a Ä‘Äƒng nháº­p cloud'}</strong>
              <p>
                {authLoading
                  ? 'Äang kiá»ƒm tra phiĂªn Ä‘Äƒng nháº­p...'
                  : isSignedIn
                    ? `${session.user.email || session.user.user_metadata?.email || 'TĂ i khoáº£n Google Ä‘Ă£ káº¿t ná»‘i'}`
                    : 'ÄÄƒng nháº­p Google Ä‘á»ƒ sao lÆ°u vĂ  khĂ´i phá»¥c dá»¯ liá»‡u local.'}
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
                  title="Táº£i láº¡i danh sĂ¡ch snapshot"
                >
                  {loadingCloud ? <RefreshCw size={16} className="animate-spin" /> : <Database size={16} />}
                </button>
                <button type="button" className="btn btn-secondary" onClick={handleSignOut}>
                  <LogOut size={14} /> ÄÄƒng xuáº¥t
                </button>
              </>
            ) : (
              <button type="button" className="btn btn-primary" onClick={handleSignIn} disabled={authLoading}>
                {authLoading ? <RefreshCw size={14} className="animate-spin" /> : <LogIn size={14} />}
                ÄÄƒng nháº­p Google
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
          <strong>{autoSyncPrefs.autoSyncEnabled ? 'Tá»± Ä‘á»“ng bá»™ Ä‘ang báº­t' : 'Tá»± Ä‘á»“ng bá»™ Ä‘ang táº¯t'}</strong>
          <p>
            Chá» táº£i lĂªn: {syncStatus.pendingUploads.length} | Xung Ä‘á»™t: {syncStatus.conflicts.length} | Láº§n cháº¡y cuá»‘i: {formatTimestamp(syncStatus.lastRunAt)}
          </p>
          {syncStatus.accountMismatch ? (
            <p>TĂ i khoáº£n Google hiá»‡n táº¡i khĂ¡c vá»›i tĂ i khoáº£n Ä‘Ă£ báº­t tá»± Ä‘á»“ng bá»™ trÆ°á»›c Ä‘Ă³. HĂ£y báº­t láº¡i tá»± Ä‘á»“ng bá»™ náº¿u muá»‘n Ä‘á»•i tĂ i khoáº£n.</p>
          ) : null}
        </div>
        <div className="cloud-sync-ops__actions">
          <button
            type="button"
            className={`btn ${autoSyncPrefs.autoSyncEnabled ? 'btn-secondary' : 'btn-primary'}`}
            onClick={handleToggleAutoSync}
            disabled={!isSignedIn}
          >
            {autoSyncPrefs.autoSyncEnabled ? 'Táº¯t tá»± Ä‘á»“ng bá»™' : 'Báº­t tá»± Ä‘á»“ng bá»™'}
          </button>
          <button type="button" className="btn btn-secondary" onClick={handleRunSyncNow} disabled={!isSignedIn || loadingCloud}>
            <RefreshCw size={14} /> Cháº¡y Ä‘á»“ng bá»™ ngay
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => handleExportCloud('zip')} disabled={!isSignedIn || exportingFormat === 'zip' || importingCloud}>
            {exportingFormat === 'zip' ? <RefreshCw size={14} className="animate-spin" /> : <Download size={14} />}
            Xuáº¥t .zip
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => handleExportCloud('json')} disabled={!isSignedIn || exportingFormat === 'json' || importingCloud}>
            {exportingFormat === 'json' ? <RefreshCw size={14} className="animate-spin" /> : <Download size={14} />}
            Xuáº¥t .json
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => importInputRef.current?.click()} disabled={!isSignedIn || importingCloud}>
            {importingCloud ? <RefreshCw size={14} className="animate-spin" /> : <Upload size={14} />}
            Nháº­p tá»« cloud
          </button>
        </div>
      </div>

      {syncStatus.conflicts.length > 0 ? (
        <div className="cloud-sync-conflicts">
          <div className="cloud-sync-conflicts__header">
            <strong>Xung Ä‘á»™t cáº§n xá»­ lĂ½ thá»§ cĂ´ng</strong>
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
            <p className="settings-hint">ChÆ°a cĂ³ project local nĂ o Ä‘á»ƒ sao lÆ°u.</p>
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
                        slug: {project.cloud_project_slug || '(sáº½ táº¡o lĂºc backup)'} | sync: {formatTimestamp(project.cloud_last_synced_at)}
                      </small>
                      {ownedByOtherUser ? (
                        <small>Dá»¯ liá»‡u nĂ y Ä‘ang gáº¯n vá»›i má»™t tĂ i khoáº£n cloud khĂ¡c. HĂ£y khĂ´i phá»¥c hoáº·c nháº­p Ä‘Ăºng tĂ i khoáº£n trÆ°á»›c khi sao lÆ°u.</small>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => handleProjectBackup(project)}
                      disabled={!isSignedIn || savingKey === actionKey || ownedByOtherUser}
                    >
                      {savingKey === actionKey ? <RefreshCw size={14} className="animate-spin" /> : <Upload size={14} />}
                      LÆ°u lĂªn cloud
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="cloud-sync-panel">
          <div className="cloud-sync-panel__header">
            <strong>Snapshot project trĂªn cloud</strong>
            <span>{projectItems.length}</span>
          </div>
          {!isSignedIn ? (
            <p className="settings-hint">ÄÄƒng nháº­p Google Ä‘á»ƒ xem snapshot trĂªn cloud.</p>
          ) : projectItems.length === 0 ? (
            <p className="settings-hint">TĂ i khoáº£n nĂ y chÆ°a cĂ³ snapshot project nĂ o.</p>
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
                        slug: {item.itemSlug} | cáº­p nháº­t: {formatTimestamp(item.updatedAt)} | {formatBytes(item.sizeBytes)}
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
                        KhĂ´i phá»¥c
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-icon btn-sm"
                        onClick={() => handleDelete('project', item.itemSlug)}
                        disabled={!isSignedIn || deletingKey === deleteActionKey}
                        title="XĂ³a snapshot cloud"
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
            <strong>Äoáº¡n chat local</strong>
            <span>{localChatThreads.length}</span>
          </div>
          {localChatThreads.length === 0 ? (
            <p className="settings-hint">ChÆ°a cĂ³ Ä‘oáº¡n chat local nĂ o Ä‘á»ƒ sao lÆ°u.</p>
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
                        {thread.projectTitle} | {thread.messageCount} tin nháº¯n | cáº­p nháº­t: {formatTimestamp(thread.updated_at)}
                      </small>
                      {ownedByOtherUser ? (
                        <small>Äoáº¡n chat nĂ y Ä‘ang gáº¯n vá»›i má»™t tĂ i khoáº£n cloud khĂ¡c.</small>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => handleChatBackup(thread)}
                      disabled={!isSignedIn || savingKey === actionKey || ownedByOtherUser}
                    >
                      {savingKey === actionKey ? <RefreshCw size={14} className="animate-spin" /> : <Upload size={14} />}
                      LÆ°u lĂªn cloud
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="cloud-sync-panel">
          <div className="cloud-sync-panel__header">
            <strong>Snapshot chat trĂªn cloud</strong>
            <span>{chatItems.length}</span>
          </div>
          {!isSignedIn ? (
            <p className="settings-hint">ÄÄƒng nháº­p Google Ä‘á»ƒ xem snapshot chat.</p>
          ) : chatItems.length === 0 ? (
            <p className="settings-hint">TĂ i khoáº£n nĂ y chÆ°a cĂ³ snapshot chat nĂ o.</p>
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
                        {(item.metadata?.projectId || 0) > 0 ? `project #${item.metadata.projectId}` : 'chat tá»± do'} | {item.metadata?.messageCount || 0} tin nháº¯n | {formatBytes(item.sizeBytes)}
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
                        KhĂ´i phá»¥c
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-icon btn-sm"
                        onClick={() => handleDelete('chat', item.itemSlug)}
                        disabled={!isSignedIn || deletingKey === deleteActionKey}
                        title="XĂ³a snapshot cloud"
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
            <strong>Bá»™ prompt local</strong>
            <span>1</span>
          </div>
          <div className="cloud-sync-list">
            <div className="cloud-sync-item">
              <div className="cloud-sync-item__body">
                <strong>Global prompt bundle</strong>
                <small>
                  {promptSummary.customizedGroupCount}/{promptSummary.groupCount} nhĂ³m Ä‘ang cĂ³ tĂ¹y chá»‰nh local
                </small>
                {promptOwnedByOtherUser ? (
                  <small>Bá»™ prompt local nĂ y Ä‘ang gáº¯n vá»›i má»™t tĂ i khoáº£n cloud khĂ¡c.</small>
                ) : null}
              </div>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={handlePromptBackup}
                disabled={!isSignedIn || savingKey === 'prompt' || promptOwnedByOtherUser}
              >
                {savingKey === 'prompt' ? <RefreshCw size={14} className="animate-spin" /> : <Upload size={14} />}
                LÆ°u lĂªn cloud
              </button>
            </div>
          </div>
        </div>

        <div className="cloud-sync-panel">
          <div className="cloud-sync-panel__header">
            <strong>Snapshot prompt trĂªn cloud</strong>
            <span>{promptItems.length}</span>
          </div>
          {!isSignedIn ? (
            <p className="settings-hint">ÄÄƒng nháº­p Google Ä‘á»ƒ xem snapshot prompt.</p>
          ) : promptItems.length === 0 ? (
            <p className="settings-hint">TĂ i khoáº£n nĂ y chÆ°a cĂ³ snapshot prompt nĂ o.</p>
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
                        cáº­p nháº­t: {formatTimestamp(item.updatedAt)} | {formatBytes(item.sizeBytes)}
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
                        KhĂ´i phá»¥c
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-icon btn-sm"
                        onClick={() => handleDelete('prompt', item.itemSlug)}
                        disabled={!isSignedIn || deletingKey === deleteActionKey}
                        title="XĂ³a snapshot cloud"
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
                <div className="cloud-restore-modal__eyebrow">KhĂ´i phá»¥c cloud snapshot</div>
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
                    <p>KhĂ´i phá»¥c snapshot thĂ nh má»™t báº£n local má»›i, khĂ´ng Ä‘á»¥ng vĂ o dá»¯ liá»‡u hiá»‡n cĂ³.</p>
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
                    <p>XĂ³a má»™t project local Ä‘Æ°á»£c chá»n rá»“i import snapshot nĂ y vĂ o thay tháº¿.</p>
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
                  <span className="settings-hint">Project Ä‘Æ°á»£c chá»n sáº½ bá»‹ xĂ³a khá»i mĂ¡y trÆ°á»›c khi import snapshot.</span>
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
                {restoreState.mode === 'replace' ? 'Ghi Ä‘Ă¨ vĂ  khĂ´i phá»¥c' : 'KhĂ´i phá»¥c thĂ nh project má»›i'}
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
