import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle,
  Download,
  Eye,
  HardDrive,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  TestTube,
  Trash2,
} from 'lucide-react';
import './storyMirror.css';

function formatBytes(value = 0) {
  const bytes = Number(value || 0);
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size.toFixed(size >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function formatDate(value) {
  if (!value) return 'Chưa có';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('vi-VN', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date);
}

function Badge({ tone = 'neutral', children }) {
  return <span className={`admin-badge admin-badge--${tone}`}>{children}</span>;
}

function MirrorMetric({ label, value, icon: Icon, tone = 'info' }) {
  return (
    <div className={`metric metric--${tone}`}>
      <Icon size={20} />
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function downloadJson(filename, payload) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function requestRawAccessReason(actionLabel) {
  const reason = window.prompt(`${actionLabel}\nNhap ly do/ticket de ghi audit:`);
  return String(reason || '').trim();
}

function normalizeSettings(settings = {}) {
  return {
    enabled: settings.enabled === true,
    testOnly: settings.testOnly !== false,
    testUserIds: Array.isArray(settings.testUserIds) ? settings.testUserIds : [],
    perUserQuotaBytes: Number(settings.perUserQuotaBytes || 104857600),
    retentionDays: Number(settings.retentionDays || 90),
    updatedAt: settings.updatedAt || null,
  };
}

export default function StoryMirrorPage({ adminApi }) {
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [health, setHealth] = useState(null);
  const [settings, setSettings] = useState(() => normalizeSettings());
  const [testUserText, setTestUserText] = useState('');
  const [users, setUsers] = useState([]);
  const [projects, setProjects] = useState([]);
  const [scenes, setScenes] = useState([]);
  const [audit, setAudit] = useState([]);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [selectedScene, setSelectedScene] = useState(null);
  const [query, setQuery] = useState('');

  const loadData = useCallback(async () => {
    setLoading(true);
    setError('');
    setSelectedScene(null);
    try {
      const [healthPayload, usersPayload, projectsPayload, auditPayload] = await Promise.all([
        adminApi.storyMirrorHealth(),
        adminApi.storyMirrorUsers(),
        adminApi.storyMirrorProjects(),
        adminApi.storyMirrorAudit(),
      ]);
      const nextSettings = normalizeSettings(healthPayload.settings);
      setHealth(healthPayload);
      setSettings(nextSettings);
      setTestUserText(nextSettings.testUserIds.join('\n'));
      setUsers(usersPayload.items || []);
      setProjects(projectsPayload.items || []);
      setAudit(auditPayload.items || []);
    } catch (err) {
      setError(err.message || 'Không tải được Kho truyện.');
    } finally {
      setLoading(false);
    }
  }, [adminApi]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const filteredUsers = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return users;
    return users.filter((user) => [
      user.email,
      user.displayName,
      user.userId,
      user.label,
    ].some((value) => String(value || '').toLowerCase().includes(needle)));
  }, [query, users]);

  const visibleProjects = useMemo(() => {
    return projects.filter((project) => !selectedUserId || project.user_id === selectedUserId);
  }, [projects, selectedUserId]);

  const totalStorage = users.reduce((sum, user) => sum + Number(user.storageUsedBytes || 0), 0);
  const failedCount = users.reduce((sum, user) => sum + Number(user.failedSyncCount || 0), 0);

  const saveSettings = async () => {
    setActionLoading('settings');
    setError('');
    setNotice('');
    try {
      const testUserIds = testUserText
        .split(/\s+/u)
        .map((item) => item.trim())
        .filter(Boolean);
      const payload = await adminApi.updateStoryMirrorSettings({
        ...settings,
        testUserIds,
      });
      const nextSettings = normalizeSettings(payload.settings);
      setSettings(nextSettings);
      setTestUserText(nextSettings.testUserIds.join('\n'));
      setNotice('Đã lưu cấu hình đồng bộ truyện.');
    } catch (err) {
      setError(err.message || 'Không lưu được cấu hình Kho truyện.');
    } finally {
      setActionLoading('');
    }
  };

  const runSmokeTest = async () => {
    setActionLoading('smoke');
    setError('');
    setNotice('');
    try {
      const payload = await adminApi.storyMirrorSmokeTest();
      setNotice(payload.ok ? 'R2 ghi/đọc/xóa thử thành công.' : 'R2 smoke test chưa thành công.');
    } catch (err) {
      setError(err.message || 'Không chạy được smoke test R2.');
    } finally {
      setActionLoading('');
    }
  };

  const loadProjectScenes = async (projectId) => {
    setSelectedProjectId(projectId);
    setSelectedScene(null);
    setScenes([]);
    setActionLoading(`scenes:${projectId}`);
    setError('');
    try {
      const payload = await adminApi.storyMirrorProjectScenes(projectId);
      setScenes(payload.items || []);
    } catch (err) {
      setError(err.message || 'Không tải được danh sách cảnh.');
    } finally {
      setActionLoading('');
    }
  };

  const loadScene = async (sceneId) => {
    const reason = requestRawAccessReason('Xem noi dung raw cua canh');
    if (!reason) return;
    setActionLoading(`scene:${sceneId}`);
    setError('');
    try {
      const payload = await adminApi.storyMirrorScene(sceneId, reason);
      setSelectedScene(payload);
    } catch (err) {
      setError(err.message || 'Không tải được nội dung cảnh.');
    } finally {
      setActionLoading('');
    }
  };

  const exportProject = async (project) => {
    const reason = requestRawAccessReason('Xuat raw content cua truyen');
    if (!reason) return;
    setActionLoading(`export:${project.id}`);
    setError('');
    try {
      const payload = await adminApi.exportStoryMirrorProject(project.id, reason);
      downloadJson(`storyforge-${project.client_project_id || project.id}.json`, payload);
      setNotice('Đã xuất truyện từ R2.');
    } catch (err) {
      setError(err.message || 'Không xuất được truyện.');
    } finally {
      setActionLoading('');
    }
  };

  const deleteProject = async (project) => {
    if (!window.confirm(`Xóa bản mirror của "${project.title || project.id}" khỏi R2 và metadata?`)) return;
    setActionLoading(`delete:${project.id}`);
    setError('');
    try {
      await adminApi.deleteStoryMirrorProject(project.id);
      setNotice('Đã xóa bản mirror của truyện.');
      await loadData();
      setScenes([]);
      setSelectedScene(null);
      setSelectedProjectId('');
    } catch (err) {
      setError(err.message || 'Không xóa được bản mirror.');
    } finally {
      setActionLoading('');
    }
  };

  const selectUser = (userId) => {
    const nextUserId = selectedUserId === userId ? '' : userId;
    setSelectedUserId(nextUserId);
    setSelectedProjectId('');
    setScenes([]);
    setSelectedScene(null);
  };

  return (
    <section className="content-grid story-mirror-page">
      <div className="section-header story-mirror-header">
        <div>
          <h1>Kho truyện</h1>
          <p>Quản lý bản mirror latest-only trên Cloudflare R2. Nội dung chỉ được tải khi bấm xem từng cảnh.</p>
        </div>
        <div className="section-header__actions">
          <button type="button" className="button button--ghost" onClick={loadData} disabled={loading}>
            <RefreshCw size={15} />
            {loading ? 'Đang tải' : 'Tải lại'}
          </button>
          <button type="button" className="button button--primary" onClick={runSmokeTest} disabled={actionLoading === 'smoke'}>
            <TestTube size={15} />
            {actionLoading === 'smoke' ? 'Đang test' : 'Chạy thử R2'}
          </button>
        </div>
      </div>

      {error ? <div className="story-mirror-alert story-mirror-alert--danger"><AlertTriangle size={16} />{error}</div> : null}
      {notice ? <div className="story-mirror-alert story-mirror-alert--success"><CheckCircle size={16} />{notice}</div> : null}

      <div className="metric-grid">
        <MirrorMetric label="Dung lượng đã dùng" value={formatBytes(totalStorage)} icon={HardDrive} tone="info" />
        <MirrorMetric label="Người dùng có truyện" value={users.length} icon={ShieldCheck} tone="success" />
        <MirrorMetric label="Truyện đã mirror" value={projects.length} icon={Download} tone="info" />
        <MirrorMetric label="Lỗi đồng bộ" value={failedCount} icon={AlertTriangle} tone={failedCount > 0 ? 'danger' : 'success'} />
      </div>

      <section className="panel story-mirror-settings">
        <div className="panel-header">
          <div>
            <h2>Cấu hình đồng bộ</h2>
            <span>R2: {health?.r2Configured ? 'Đã cấu hình' : 'Chưa cấu hình'} · Cập nhật {formatDate(settings.updatedAt)}</span>
          </div>
          <Badge tone={settings.enabled ? 'success' : 'warning'}>{settings.enabled ? 'Đang bật' : 'Đang tắt'}</Badge>
        </div>
        <div className="story-mirror-settings-grid">
          <label className="story-mirror-toggle">
            <input
              type="checkbox"
              checked={settings.enabled}
              onChange={(event) => setSettings((current) => ({ ...current, enabled: event.target.checked }))}
            />
            <span>Bật đồng bộ truyện</span>
          </label>
          <label className="story-mirror-toggle">
            <input
              type="checkbox"
              checked={settings.testOnly}
              onChange={(event) => setSettings((current) => ({ ...current, testOnly: event.target.checked }))}
            />
            <span>Chỉ tài khoản test</span>
          </label>
          <label>
            <span>Quota mỗi user</span>
            <input
              value={settings.perUserQuotaBytes}
              onChange={(event) => setSettings((current) => ({ ...current, perUserQuotaBytes: Number(event.target.value) || 0 }))}
              inputMode="numeric"
            />
          </label>
          <label>
            <span>Giữ event lỗi/nghiệp vụ</span>
            <input
              value={settings.retentionDays}
              onChange={(event) => setSettings((current) => ({ ...current, retentionDays: Number(event.target.value) || 1 }))}
              inputMode="numeric"
            />
          </label>
          <label className="story-mirror-test-users">
            <span>Tài khoản test (UUID, mỗi dòng)</span>
            <textarea value={testUserText} onChange={(event) => setTestUserText(event.target.value)} rows={3} />
          </label>
        </div>
        <div className="story-mirror-settings-actions">
          <button type="button" className="button button--primary" onClick={saveSettings} disabled={actionLoading === 'settings'}>
            <Settings size={15} />
            {actionLoading === 'settings' ? 'Đang lưu' : 'Lưu cấu hình'}
          </button>
        </div>
      </section>

      <div className="story-mirror-workspace">
        <section className="panel panel--table">
          <div className="table-toolbar table-toolbar--split">
            <div className="search-box">
              <Search size={15} />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm user, email, UUID" />
            </div>
            <Badge tone="neutral">{filteredUsers.length} user</Badge>
          </div>
          <table className="data-table">
            <thead>
              <tr>
                <th>User</th>
                <th>Truyện</th>
                <th>Dung lượng</th>
                <th>Lần đồng bộ cuối</th>
              </tr>
            </thead>
            <tbody>
              {filteredUsers.map((user) => (
                <tr
                  key={user.userId}
                  className={selectedUserId === user.userId ? 'story-mirror-row-active' : ''}
                  onClick={() => selectUser(user.userId)}
                >
                  <td><strong>{user.label}</strong><span>{user.userId}</span></td>
                  <td>{user.projectCount}</td>
                  <td>{formatBytes(user.storageUsedBytes)}</td>
                  <td>{formatDate(user.lastSyncedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="panel panel--table">
          <div className="panel-header story-mirror-panel-pad">
            <div>
              <h2>Truyện đã lưu</h2>
              <span>{visibleProjects.length} truyện trong bộ lọc hiện tại</span>
            </div>
          </div>
          <table className="data-table">
            <thead>
              <tr>
                <th>Truyện</th>
                <th>Dung lượng</th>
                <th>Đồng bộ</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {visibleProjects.map((project) => (
                <tr key={project.id} className={selectedProjectId === project.id ? 'story-mirror-row-active' : ''}>
                  <td>
                    <strong>{project.title || 'Chưa đặt tên'}</strong>
                    <span>{project.user?.label || project.user_id}</span>
                  </td>
                  <td>{formatBytes(project.storage_used_bytes)}</td>
                  <td>{formatDate(project.updated_at)}</td>
                  <td className="story-mirror-actions">
                    <button type="button" className="button button--ghost" onClick={() => loadProjectScenes(project.id)}>
                      <Eye size={14} /> Cảnh
                    </button>
                    <button type="button" className="button button--ghost" onClick={() => exportProject(project)} disabled={actionLoading === `export:${project.id}`}>
                      <Download size={14} /> Xuất
                    </button>
                    <button type="button" className="button button--danger" onClick={() => deleteProject(project)} disabled={actionLoading === `delete:${project.id}`}>
                      <Trash2 size={14} /> Xóa
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>

      <div className="story-mirror-detail-grid">
        <section className="panel panel--table">
          <div className="panel-header story-mirror-panel-pad">
            <div>
              <h2>Cảnh trong truyện</h2>
              <span>{selectedProjectId ? `${scenes.length} cảnh` : 'Chọn một truyện để xem cảnh'}</span>
            </div>
          </div>
          <table className="data-table">
            <thead>
              <tr>
                <th>Cảnh</th>
                <th>Hash</th>
                <th>Dung lượng</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {scenes.map((scene) => (
                <tr key={scene.id}>
                  <td><strong>{scene.title || 'Cảnh không tên'}</strong><span>{formatDate(scene.client_updated_at)}</span></td>
                  <td><code>{scene.content_hash}</code></td>
                  <td>{formatBytes(scene.size_bytes)}</td>
                  <td>
                    <button type="button" className="button button--ghost" onClick={() => loadScene(scene.id)} disabled={actionLoading === `scene:${scene.id}`}>
                      <Eye size={14} /> Xem
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <aside className="panel story-mirror-raw">
          <div className="panel-header">
            <div>
              <h2>Nội dung cảnh</h2>
              <span>{selectedScene?.scene?.title || 'Chỉ tải khi bấm Xem'}</span>
            </div>
          </div>
          {selectedScene ? (
            <pre>{selectedScene.content || 'Cảnh chưa có nội dung.'}</pre>
          ) : (
            <div className="empty-state">
              <span>Chọn một cảnh để đọc bản latest từ R2.</span>
            </div>
          )}
        </aside>
      </div>

      <section className="panel panel--table">
        <div className="panel-header story-mirror-panel-pad">
          <div>
            <h2>Nhật ký Kho truyện</h2>
            <span>{audit.length} thao tác gần nhất</span>
          </div>
        </div>
        <table className="data-table">
          <thead>
            <tr>
              <th>Thời gian</th>
              <th>Hành động</th>
              <th>Project</th>
              <th>Scene</th>
            </tr>
          </thead>
          <tbody>
            {audit.map((item) => (
              <tr key={item.id}>
                <td>{formatDate(item.created_at)}</td>
                <td>{item.action}</td>
                <td>{item.project_id || '-'}</td>
                <td>{item.scene_id || '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </section>
  );
}
