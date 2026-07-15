import React, { useEffect, useMemo, useRef, useState } from 'react';
import { saveAs } from 'file-saver';
import {
  AlertTriangle,
  ArchiveRestore,
  CheckCircle2,
  Download,
  FileArchive,
  KeyRound,
  Loader2,
  LockKeyhole,
  Upload,
  X,
} from 'lucide-react';
import db from '../../services/db/database.js';
import {
  createStoryBundle,
  importStoryBundle,
  inspectStoryBundle,
  isStoryBundleCryptoAvailable,
} from '../../services/storyBundle/storyBundle.js';
import {
  importProjectSnapshot,
  validateProjectSnapshot,
} from '../../services/db/projectSnapshot.js';
import { sanitizeSnapshotHtml } from '../../services/storyBundle/htmlSanitizer.js';
import { parseBoundedJson, STORY_BUNDLE_LIMITS } from '../../services/storyBundle/storyBundleSafety.js';
import './StoryBundleModal.css';

const PHASE_LABELS = Object.freeze({
  collect: 'Thu thập dữ liệu',
  package: 'Đóng gói section',
  compress: 'Nén file',
  encrypt: 'Mã hóa',
  blob: 'Tạo file tải xuống',
  complete: 'Hoàn tất',
});

async function estimateProject(projectId) {
  const [chapters, scenes, threads, attachments, assets] = await Promise.all([
    db.chapters.where('project_id').equals(projectId).count(),
    db.scenes.where('project_id').equals(projectId).count(),
    db.ai_chat_threads.where('project_id').equals(projectId).count(),
    db.ai_chat_attachments.where('project_id').equals(projectId).count(),
    db.project_assets.where('project_id').equals(projectId).toArray(),
  ]);
  const estimatedBytes = assets.reduce((sum, asset) => (
    sum + Math.ceil(String(asset.data_url || '').length * 0.75)
    + Math.ceil(String(asset.thumbnail_data_url || '').length * 0.75)
  ), 0);
  return { chapters, scenes, threads, attachments, assets: assets.length, estimatedBytes };
}

function formatBytes(bytes) {
  const value = Number(bytes || 0);
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MiB`;
}

function countManifestRecords(manifest) {
  return Object.values(manifest?.counts || {}).reduce((total, section) => (
    total + Object.values(section || {}).reduce((sum, count) => sum + Number(count || 0), 0)
  ), 0);
}

function isIOSFileSavePlatform() {
  if (typeof navigator === 'undefined') return false;
  const userAgent = String(navigator.userAgent || '');
  return /iPad|iPhone|iPod/iu.test(userAgent)
    || (navigator.platform === 'MacIntel' && Number(navigator.maxTouchPoints || 0) > 1);
}

export default function StoryBundleModal({
  mode = 'import',
  project = null,
  projects = [],
  onClose,
  onImported,
}) {
  const inputRef = useRef(null);
  const [includeChats, setIncludeChats] = useState(true);
  const [includeFullLab, setIncludeFullLab] = useState(false);
  const [protectWithPassword, setProtectWithPassword] = useState(false);
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [estimate, setEstimate] = useState(null);
  const [progress, setProgress] = useState({ phase: '', progress: 0 });
  const [working, setWorking] = useState(false);
  const [preparedBundle, setPreparedBundle] = useState(null);
  const [error, setError] = useState('');
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [legacySnapshot, setLegacySnapshot] = useState(null);
  const [needsPassword, setNeedsPassword] = useState(false);
  const [importMode, setImportMode] = useState('duplicate');
  const [targetProjectId, setTargetProjectId] = useState('');
  const [confirmTitle, setConfirmTitle] = useState('');

  const selectedTarget = useMemo(
    () => projects.find((item) => Number(item.id) === Number(targetProjectId)) || null,
    [projects, targetProjectId],
  );
  const cryptoAvailable = isStoryBundleCryptoAvailable();

  useEffect(() => {
    if (mode !== 'export' || !project?.id) return undefined;
    let cancelled = false;
    estimateProject(Number(project.id))
      .then((value) => {
        if (!cancelled) setEstimate(value);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [mode, project?.id]);

  useEffect(() => {
    setPreparedBundle(null);
  }, [project?.id, includeChats, includeFullLab, protectWithPassword, password, passwordConfirm]);

  const closeIfIdle = () => {
    if (!working) onClose?.();
  };

  const handleExport = async () => {
    if (!project?.id) return;
    if (preparedBundle) {
      setError('');
      try {
        saveAs(preparedBundle.blob, preparedBundle.fileName);
        onClose?.();
      } catch (cause) {
        setError(cause?.message || 'Không thể lưu file StoryForge.');
      }
      return;
    }
    if (protectWithPassword && password.length < 12) {
      setError('Mật khẩu phải có ít nhất 12 ký tự.');
      return;
    }
    if (protectWithPassword && password !== passwordConfirm) {
      setError('Mật khẩu xác nhận chưa khớp.');
      return;
    }
    setWorking(true);
    setError('');
    try {
      const result = await createStoryBundle(project.id, {
        includeChats,
        includeFullLab,
        password: protectWithPassword ? password : '',
        onProgress: setProgress,
      });
      if (isIOSFileSavePlatform()) {
        setPreparedBundle(result);
        return;
      }
      saveAs(result.blob, result.fileName);
      onClose?.();
    } catch (cause) {
      setError(cause?.message || 'Không thể tạo file StoryForge.');
    } finally {
      setWorking(false);
    }
  };

  const inspectSelectedFile = async (nextFile, suppliedPassword = password) => {
    if (!nextFile) return;
    setWorking(true);
    setError('');
    setPreview(null);
    setLegacySnapshot(null);
    try {
      if (String(nextFile.name || '').toLowerCase().endsWith('.json')) {
        if (Number(nextFile.size || 0) > STORY_BUNDLE_LIMITS.jsonSectionBytes) {
          throw new Error('Project backup JSON vượt giới hạn 64 MiB.');
        }
        const parsed = parseBoundedJson(await nextFile.text());
        if (parsed?._cloud_export_scope === 'all_snapshots' || Array.isArray(parsed?.snapshots)) {
          throw new Error('Đây là kho snapshot Cloud. Hãy nhập file này trong trang Cloud Sync.');
        }
        const snapshot = sanitizeSnapshotHtml(validateProjectSnapshot(parsed));
        setLegacySnapshot(snapshot);
        setPreview({
          legacy: true,
          title: snapshot.project?.title || 'Project StoryForge',
          createdAt: snapshot._exported_at || null,
          projectSchemaVersion: snapshot._storyforge_version,
          warnings: snapshot._warnings || [],
        });
        setNeedsPassword(false);
        return;
      }
      const inspected = await inspectStoryBundle(nextFile, { password: suppliedPassword });
      setPreview({
        ...inspected.manifest,
        title: inspected.snapshot.project?.title || 'Project StoryForge',
        warnings: inspected.warnings,
        encrypted: inspected.encrypted,
      });
      setNeedsPassword(false);
    } catch (cause) {
      if (cause?.code === 'STORY_BUNDLE_DECRYPT_FAILED' && !suppliedPassword) {
        setNeedsPassword(true);
      } else {
        setError(cause?.message || 'Không thể kiểm tra file StoryForge.');
      }
    } finally {
      setWorking(false);
    }
  };

  const chooseFile = (nextFile) => {
    if (!nextFile) return;
    setFile(nextFile);
    setPassword('');
    setNeedsPassword(false);
    setConfirmTitle('');
    inspectSelectedFile(nextFile, '').catch(() => {});
  };

  const handleImport = async () => {
    if (!file || !preview) return;
    if (importMode === 'replace') {
      if (!selectedTarget || confirmTitle !== selectedTarget.title) {
        setError('Gõ đúng tên project đích trước khi ghi đè.');
        return;
      }
    }
    setWorking(true);
    setError('');
    try {
      const common = {
        replaceProjectId: importMode === 'replace' ? selectedTarget.id : null,
        titleMode: importMode === 'replace' ? 'original' : 'imported',
        source: 'file',
        preserveTargetChats: importMode === 'replace' && Boolean(legacySnapshot),
      };
      const result = legacySnapshot
        ? await importProjectSnapshot(legacySnapshot, common)
        : await importStoryBundle(file, {
          password,
          mode: importMode,
          targetProjectId: common.replaceProjectId,
        });
      onImported?.(result.projectId, result);
    } catch (cause) {
      setError(cause?.message || 'Không thể nhập file StoryForge.');
    } finally {
      setWorking(false);
    }
  };

  const handleDrop = (event) => {
    event.preventDefault();
    chooseFile(event.dataTransfer.files?.[0] || null);
  };

  return (
    <div className="modal-overlay story-bundle-overlay" onClick={closeIfIdle}>
      <section className="modal story-bundle-modal" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
        <header className="story-bundle-modal__header">
          <div className="story-bundle-modal__mark"><FileArchive size={20} /></div>
          <div>
            <div className="story-bundle-modal__eyebrow">Sao lưu ngoại tuyến</div>
            <h2>{mode === 'export' ? 'Sao lưu truyện (.storyforge)' : 'Nhập file StoryForge'}</h2>
          </div>
          <button type="button" className="btn btn-ghost btn-icon" onClick={closeIfIdle} disabled={working} aria-label="Đóng">
            <X size={18} />
          </button>
        </header>

        <div className="story-bundle-modal__body">
          {mode === 'export' ? (
            <>
              <div className="story-bundle-project-card">
                <strong>{project?.title}</strong>
                <span>
                  {estimate
                    ? `${estimate.chapters} chương · ${estimate.scenes} cảnh · ${estimate.threads} chat · ${estimate.attachments} attachment · khoảng ${formatBytes(estimate.estimatedBytes)}`
                    : 'Đang kiểm tra dữ liệu local...'}
                </span>
              </div>

              <div className="story-bundle-option-list">
                <label className="story-bundle-option">
                  <input type="checkbox" checked={includeChats} onChange={(event) => setIncludeChats(event.target.checked)} disabled={working} />
                  <span><strong>Kèm Project Chat và attachment</strong><small>Mặc định bật để file có thể khôi phục trọn vẹn truyện.</small></span>
                </label>
                <label className="story-bundle-option">
                  <input type="checkbox" checked={includeFullLab} onChange={(event) => setIncludeFullLab(event.target.checked)} disabled={working} />
                  <span><strong>Kèm workspace Lab Lite</strong><small>Có thể tăng đáng kể dung lượng và thời gian xử lý trên mobile.</small></span>
                </label>
                <label className="story-bundle-option">
                  <input
                    type="checkbox"
                    checked={protectWithPassword}
                    onChange={(event) => setProtectWithPassword(event.target.checked)}
                    disabled={working || !cryptoAvailable}
                  />
                  <span><strong>Bảo vệ bằng mật khẩu</strong><small>AES-256-GCM; mật khẩu không được lưu hoặc gửi qua mạng.</small></span>
                </label>
              </div>

              {protectWithPassword ? (
                <div className="story-bundle-password-grid">
                  <label><span>Mật khẩu (ít nhất 12 ký tự)</span><input className="input" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" /></label>
                  <label><span>Nhập lại mật khẩu</span><input className="input" type="password" value={passwordConfirm} onChange={(event) => setPasswordConfirm(event.target.value)} autoComplete="new-password" /></label>
                </div>
              ) : null}
              {!cryptoAvailable ? <p className="story-bundle-note"><AlertTriangle size={14} /> Web Crypto không khả dụng; vẫn có thể xuất file thường.</p> : null}
              {preparedBundle ? <p className="story-bundle-note"><CheckCircle2 size={14} /> File đã tạo xong. Nhấn Lưu file .storyforge để mở trình lưu trên iPhone.</p> : null}
            </>
          ) : (
            <>
              <button
                type="button"
                className="story-bundle-dropzone"
                onClick={() => inputRef.current?.click()}
                onDragOver={(event) => event.preventDefault()}
                onDrop={handleDrop}
                disabled={working}
              >
                <Upload size={24} />
                <strong>{file ? file.name : 'Kéo thả hoặc chọn file .storyforge'}</strong>
                <span>Hỗ trợ Story Bundle và project backup JSON phiên bản cũ.</span>
              </button>
              <input ref={inputRef} hidden type="file" onChange={(event) => chooseFile(event.target.files?.[0])} />

              {needsPassword ? (
                <div className="story-bundle-unlock">
                  <KeyRound size={18} />
                  <label><span>File được bảo vệ bằng mật khẩu</span><input className="input" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" /></label>
                  <button type="button" className="btn btn-secondary" onClick={() => inspectSelectedFile(file, password)} disabled={working || password.length < 1}>Mở preview</button>
                </div>
              ) : null}

              {preview ? (
                <div className="story-bundle-preview">
                  <div className="story-bundle-preview__status"><CheckCircle2 size={17} /><strong>Checksum và cấu trúc hợp lệ</strong></div>
                  <h3>{preview.title}</h3>
                  <p>
                    Schema {preview.projectSchemaVersion}
                    {preview.createdAt ? ` · tạo ${new Date(preview.createdAt).toLocaleString('vi-VN')}` : ''}
                    {preview.entries ? ` · ${countManifestRecords(preview)} record` : ' · backup JSON cũ'}
                  </p>
                  <p className="story-bundle-safety-copy">Không dữ liệu nào bị thay đổi trước khi kiểm tra file hoàn tất.</p>
                  {(preview.warnings || []).length > 0 ? <div className="story-bundle-warning"><AlertTriangle size={15} /> File có {preview.warnings.length} cảnh báo cần lưu ý.</div> : null}
                </div>
              ) : null}

              {preview ? (
                <div className="story-bundle-import-modes">
                  <label className={importMode === 'duplicate' ? 'is-active' : ''}>
                    <input type="radio" name="story-bundle-import-mode" checked={importMode === 'duplicate'} onChange={() => setImportMode('duplicate')} />
                    <span><strong>Tạo project mới</strong><small>Mặc định an toàn; không đụng dữ liệu đang có.</small></span>
                  </label>
                  <details>
                    <summary>Tùy chọn nâng cao</summary>
                    <label className={importMode === 'replace' ? 'is-active' : ''}>
                      <input type="radio" name="story-bundle-import-mode" checked={importMode === 'replace'} onChange={() => setImportMode('replace')} />
                      <span><strong>Ghi đè project local</strong><small>Chỉ commit sau khi file đã được kiểm tra và import plan hoàn tất.</small></span>
                    </label>
                    {importMode === 'replace' ? (
                      <div className="story-bundle-replace-confirm">
                        <label><span>Project đích</span><select className="select" value={targetProjectId} onChange={(event) => { setTargetProjectId(event.target.value); setConfirmTitle(''); }}><option value="">Chọn project</option>{projects.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
                        <label><span>Gõ đúng tên project</span><input className="input" value={confirmTitle} onChange={(event) => setConfirmTitle(event.target.value)} placeholder={selectedTarget?.title || ''} /></label>
                      </div>
                    ) : null}
                  </details>
                </div>
              ) : null}
            </>
          )}

          {working && progress.phase ? (
            <div className="story-bundle-progress">
              <div><Loader2 size={15} className="animate-spin" /><span>{PHASE_LABELS[progress.phase] || progress.phase}</span><strong>{Math.round(progress.progress * 100)}%</strong></div>
              <progress max="1" value={progress.progress} />
            </div>
          ) : null}
          {error ? <div className="story-bundle-error"><AlertTriangle size={16} /> {error}</div> : null}
        </div>

        <footer className="story-bundle-modal__actions">
          <button type="button" className="btn btn-ghost" onClick={closeIfIdle} disabled={working}>Hủy</button>
          {mode === 'export' ? (
            <button type="button" className="btn btn-primary" onClick={handleExport} disabled={working}>
              {working ? <Loader2 size={16} className="animate-spin" /> : protectWithPassword ? <LockKeyhole size={16} /> : <Download size={16} />}
              {working ? 'Đang tạo file...' : preparedBundle ? 'Lưu file .storyforge' : 'Tải file .storyforge'}
            </button>
          ) : (
            <button type="button" className="btn btn-primary" onClick={handleImport} disabled={working || !preview}>
              {working ? <Loader2 size={16} className="animate-spin" /> : <ArchiveRestore size={16} />}
              {working ? 'Đang khôi phục...' : importMode === 'replace' ? 'Xác nhận ghi đè' : 'Nhập thành project mới'}
            </button>
          )}
        </footer>
      </section>
    </div>
  );
}
