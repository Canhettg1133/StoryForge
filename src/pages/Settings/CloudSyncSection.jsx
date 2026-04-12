import React, { useEffect, useMemo, useState } from 'react';
import { Cloud, Database, Download, RefreshCw, Trash2, Upload } from 'lucide-react';
import { PRODUCT_SURFACE } from '../../config/productSurface';
import useProjectStore from '../../stores/projectStore';
import {
  deleteCloudSnapshot,
  getCloudSyncConfig,
  listCloudSnapshots,
  restoreCloudSnapshot,
  saveCloudSyncConfig,
  syncProjectToCloud,
} from '../../services/cloud/cloudSyncClient';

function formatTimestamp(value) {
  if (!value) return 'chua sync';
  try {
    return new Date(value).toLocaleString('vi-VN');
  } catch {
    return 'chua sync';
  }
}

export default function CloudSyncSection() {
  const { projects, loadProjects } = useProjectStore();
  const [config, setConfig] = useState(() => getCloudSyncConfig());
  const [cloudItems, setCloudItems] = useState([]);
  const [loadingCloud, setLoadingCloud] = useState(false);
  const [savingProjectId, setSavingProjectId] = useState(null);
  const [restoringSlug, setRestoringSlug] = useState('');
  const [deletingSlug, setDeletingSlug] = useState('');
  const [message, setMessage] = useState(null);

  const isConfigured = Boolean(config.workspaceSlug && config.accessKey);
  const sortedProjects = useMemo(
    () => [...projects].sort((left, right) => Number(right.updated_at || 0) - Number(left.updated_at || 0)),
    [projects],
  );

  const showMessage = (type, text) => {
    setMessage({ type, text });
  };

  const refreshCloud = async (nextConfig = config) => {
    if (!nextConfig.workspaceSlug || !nextConfig.accessKey) {
      setCloudItems([]);
      return;
    }

    setLoadingCloud(true);
    try {
      const items = await listCloudSnapshots(nextConfig);
      setCloudItems(items);
    } catch (error) {
      showMessage('error', error.message);
    } finally {
      setLoadingCloud(false);
    }
  };

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  useEffect(() => {
    if (!PRODUCT_SURFACE.enableCloudSync) return;
    if (!config.workspaceSlug || !config.accessKey) return;
    refreshCloud(config).catch(() => {});
  }, []);

  if (!PRODUCT_SURFACE.enableCloudSync) {
    return null;
  }

  const handleSaveConfig = async () => {
    const normalized = saveCloudSyncConfig(config);
    setConfig(normalized);
    showMessage('success', 'Da luu cau hinh Cloud Sync.');
    await refreshCloud(normalized);
  };

  const handleSyncProject = async (project) => {
    setSavingProjectId(project.id);
    try {
      await syncProjectToCloud(project, config);
      await loadProjects();
      await refreshCloud(config);
      showMessage('success', `Da backup "${project.title}" len cloud.`);
    } catch (error) {
      showMessage('error', error.message);
    } finally {
      setSavingProjectId(null);
    }
  };

  const handleRestore = async (projectSlug) => {
    setRestoringSlug(projectSlug);
    try {
      const result = await restoreCloudSnapshot(projectSlug, config);
      await loadProjects();
      await refreshCloud(config);
      showMessage('success', `Da restore snapshot thanh project moi (#${result.newProjectId}).`);
    } catch (error) {
      showMessage('error', error.message);
    } finally {
      setRestoringSlug('');
    }
  };

  const handleDelete = async (projectSlug) => {
    if (!window.confirm('Xoa snapshot cloud nay? Ban local se khong bi anh huong.')) {
      return;
    }

    setDeletingSlug(projectSlug);
    try {
      await deleteCloudSnapshot(projectSlug, config);
      await refreshCloud(config);
      showMessage('success', `Da xoa snapshot ${projectSlug} tren cloud.`);
    } catch (error) {
      showMessage('error', error.message);
    } finally {
      setDeletingSlug('');
    }
  };

  return (
    <section className="settings-section card animate-slide-up" style={{ animationDelay: '300ms' }}>
      <div className="settings-section-header">
        <Cloud size={20} />
        <div>
          <h2>Cloud Sync</h2>
          <p>
            Backup/restore du an qua Vercel Function + Postgres. App van local-first; restore se tao project moi trong may.
          </p>
        </div>
      </div>

      {message && (
        <div className={`settings-test-result ${message.type === 'success' ? 'success' : 'error'}`}>
          {message.text}
        </div>
      )}

      <div className="form-group">
        <label className="form-label">Workspace slug</label>
        <div className="settings-input-row">
          <input
            className="input"
            value={config.workspaceSlug}
            onChange={(event) => setConfig((prev) => ({ ...prev, workspaceSlug: event.target.value }))}
            placeholder="vd: canhe-storyforge"
          />
        </div>
        <span className="settings-hint">Tat ca snapshot trong cung workspace se duoc nhom lai voi nhau.</span>
      </div>

      <div className="form-group">
        <label className="form-label">Access key</label>
        <div className="settings-input-row">
          <input
            className="input"
            type="password"
            value={config.accessKey}
            onChange={(event) => setConfig((prev) => ({ ...prev, accessKey: event.target.value }))}
            placeholder="dat mot khoa rieng cho workspace nay"
          />
        </div>
        <span className="settings-hint">Khong co auth day du. Khoa nay la lop bao ve toi thieu cho cloud backup.</span>
      </div>

      <div className="form-group">
        <label className="form-label">Cloud API</label>
        <div className="settings-input-row">
          <input
            className="input"
            value={config.apiBaseUrl}
            onChange={(event) => setConfig((prev) => ({ ...prev, apiBaseUrl: event.target.value }))}
            placeholder="/api/cloud"
          />
          <button className="btn btn-secondary" onClick={handleSaveConfig}>
            Luu
          </button>
          <button
            className="btn btn-ghost btn-icon"
            onClick={() => refreshCloud(config)}
            disabled={!isConfigured || loadingCloud}
            title="Tai lai danh sach cloud"
          >
            {loadingCloud ? <RefreshCw size={16} className="animate-spin" /> : <Database size={16} />}
          </button>
        </div>
        <span className="settings-hint">Local dev voi Vite se can Vercel deployment hoac `vercel dev` neu dung duong dan `/api/cloud`.</span>
      </div>

      <div className="cloud-sync-grid">
        <div className="cloud-sync-panel">
          <div className="cloud-sync-panel__header">
            <strong>Local projects</strong>
            <span>{sortedProjects.length}</span>
          </div>
          {sortedProjects.length === 0 ? (
            <p className="settings-hint">Chua co project local nao de backup.</p>
          ) : (
            <div className="cloud-sync-list">
              {sortedProjects.map((project) => (
                <div key={project.id} className="cloud-sync-item">
                  <div className="cloud-sync-item__body">
                    <strong>{project.title}</strong>
                    <small>
                      slug: {project.cloud_project_slug || '(se tao luc backup)'} | sync: {formatTimestamp(project.cloud_last_synced_at)}
                    </small>
                  </div>
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => handleSyncProject(project)}
                    disabled={!isConfigured || savingProjectId === project.id}
                  >
                    {savingProjectId === project.id ? <RefreshCw size={14} className="animate-spin" /> : <Upload size={14} />}
                    Backup
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="cloud-sync-panel">
          <div className="cloud-sync-panel__header">
            <strong>Cloud snapshots</strong>
            <span>{cloudItems.length}</span>
          </div>
          {cloudItems.length === 0 ? (
            <p className="settings-hint">Chua co snapshot cloud nao trong workspace nay.</p>
          ) : (
            <div className="cloud-sync-list">
              {cloudItems.map((item) => (
                <div key={item.projectSlug} className="cloud-sync-item">
                  <div className="cloud-sync-item__body">
                    <strong>{item.projectTitle}</strong>
                    <small>
                      slug: {item.projectSlug} | cap nhat: {formatTimestamp(item.updatedAt)} | {item.sizeBytes} bytes
                    </small>
                  </div>
                  <div className="cloud-sync-item__actions">
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={() => handleRestore(item.projectSlug)}
                      disabled={!isConfigured || restoringSlug === item.projectSlug}
                    >
                      {restoringSlug === item.projectSlug ? <RefreshCw size={14} className="animate-spin" /> : <Download size={14} />}
                      Restore
                    </button>
                    <button
                      className="btn btn-ghost btn-icon btn-sm"
                      onClick={() => handleDelete(item.projectSlug)}
                      disabled={!isConfigured || deletingSlug === item.projectSlug}
                      title="Xoa snapshot cloud"
                    >
                      {deletingSlug === item.projectSlug ? <RefreshCw size={14} className="animate-spin" /> : <Trash2 size={14} />}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
