import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Check,
  Power,
  RefreshCw,
  RotateCcw,
  Save,
  ShieldCheck,
  Undo2,
  Upload,
} from 'lucide-react';
import { Badge, ErrorState } from '../../components/ui/AdminPrimitives.jsx';
import { canDiscardSecurePromptDraft } from './dirtyNavigation.js';

const MAX_CONTENT_CHARS = 60000;

function formatDate(value) {
  if (!value) return 'Chưa cập nhật';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Chưa cập nhật';
  return new Intl.DateTimeFormat('vi-VN', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date);
}

function emptyState() {
  return {
    enabled: false,
    draftContent: '',
    draftRevision: 0,
    publishedRevision: 0,
    draftVersionId: null,
    publishedVersionId: null,
    updatedAt: null,
    versions: [],
    historyNextBeforeRevision: null,
  };
}

function securePromptErrorMessage(error, fallback) {
  if (error?.code === 'SECURE_PROMPT_ENCRYPTION_UNAVAILABLE') {
    return 'Khóa mã hóa Tối Thượng đang thiếu hoặc không hợp lệ. Hãy cấu hình secret trước khi tiếp tục.';
  }
  return error?.message || fallback;
}

export default function SupremePromptSettingsPanel({
  adminApi,
  reloadSignal = 0,
  onDirtyChange = () => {},
}) {
  const [loaded, setLoaded] = useState(() => emptyState());
  const [draftContent, setDraftContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const textareaRef = useRef(null);
  const publishButtonRef = useRef(null);
  const disableButtonRef = useRef(null);
  const historySectionRef = useRef(null);

  const dirty = draftContent !== loaded.draftContent;
  const overLimit = draftContent.length > MAX_CONTENT_CHARS;
  const canSave = dirty && Boolean(draftContent.trim()) && !overLimit && !saving;

  const loadData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const payload = await adminApi.securePrompts();
      const next = {
        ...emptyState(),
        ...payload,
        draftContent: String(payload.draftContent || ''),
        versions: Array.isArray(payload.versions) ? payload.versions : [],
      };
      setLoaded(next);
      setDraftContent(next.draftContent);
    } catch (loadError) {
      setError(securePromptErrorMessage(
        loadError,
        'Không tải được prompt Chat Tối Thượng.',
      ));
    } finally {
      setLoading(false);
    }
  }, [adminApi]);

  useEffect(() => {
    loadData();
  }, [loadData, reloadSignal]);

  useEffect(() => {
    if (!dirty) return undefined;
    const warnBeforeLeave = (event) => {
      event.preventDefault();
      event.returnValue = '';
    };
    globalThis.addEventListener('beforeunload', warnBeforeLeave);
    return () => globalThis.removeEventListener('beforeunload', warnBeforeLeave);
  }, [dirty]);

  useEffect(() => {
    onDirtyChange(dirty);
    return () => onDirtyChange(false);
  }, [dirty, onDirtyChange]);

  const runAction = async (
    action,
    successMessage,
    focusTarget = () => textareaRef.current,
  ) => {
    setSaving(true);
    setError('');
    setNotice('');
    try {
      await action();
      setNotice(successMessage);
      await loadData();
      globalThis.setTimeout(() => focusTarget()?.focus?.(), 0);
    } catch (actionError) {
      if (actionError?.status === 409 || /conflict|revision/iu.test(actionError?.code || '')) {
        setError('Revision conflict: prompt đã đổi ở tab khác. Hãy tải lại rồi thực hiện lại thao tác.');
      } else {
        setError(securePromptErrorMessage(
          actionError,
          'Không thể cập nhật prompt Chat Tối Thượng.',
        ));
      }
    } finally {
      setSaving(false);
    }
  };

  const loadMoreHistory = async () => {
    if (!loaded.historyNextBeforeRevision || historyLoading) return;
    setHistoryLoading(true);
    setError('');
    try {
      const payload = await adminApi.securePrompts({
        historyBeforeRevision: loaded.historyNextBeforeRevision,
        metadataOnly: true,
      });
      const incoming = Array.isArray(payload.versions) ? payload.versions : [];
      setLoaded((current) => {
        const byId = new Map(current.versions.map((version) => [version.id, version]));
        incoming.forEach((version) => byId.set(version.id, version));
        return {
          ...current,
          versions: [...byId.values()],
          historyNextBeforeRevision: payload.historyNextBeforeRevision || null,
        };
      });
    } catch (historyError) {
      setError(securePromptErrorMessage(
        historyError,
        'Không tải được các revision cũ hơn.',
      ));
    } finally {
      setHistoryLoading(false);
    }
  };

  const reloadFromServer = () => {
    if (!canDiscardSecurePromptDraft({ dirty })) return;
    loadData();
  };

  const saveDraft = () => runAction(
    () => adminApi.saveSecurePromptDraft({
      content: draftContent,
      expectedDraftRevision: loaded.draftRevision,
    }),
    'Đã lưu bản nháp. Bản nháp chưa ảnh hưởng người dùng.',
  );

  const publish = () => {
    if (!loaded.draftVersionId) return;
    if (!globalThis.confirm('Xuất bản revision nháp hiện tại cho Chat Tối Thượng?')) return;
    runAction(
      () => adminApi.publishSecurePrompt({
        versionId: loaded.draftVersionId,
        expectedPublishedRevision: loaded.publishedRevision,
      }),
      'Xuất bản thành công. Runtime Chat Tối Thượng đang sử dụng revision mới.',
      () => publishButtonRef.current,
    );
  };

  const rollback = (version, focusTarget) => {
    if (!globalThis.confirm(`Khôi phục revision ${version.revision}?`)) return;
    runAction(
      () => adminApi.rollbackSecurePrompt({
        versionId: version.id,
        expectedPublishedRevision: loaded.publishedRevision,
      }),
      `Rollback thành công về revision ${version.revision}.`,
      () => historySectionRef.current || focusTarget,
    );
  };

  const disable = () => {
    if (!globalThis.confirm('Tắt runtime Chat Tối Thượng? Người dùng sẽ không được fallback sang chat tự do.')) return;
    runAction(
      () => adminApi.disableSecurePrompt(),
      'Runtime Chat Tối Thượng đã tắt.',
      () => disableButtonRef.current,
    );
  };

  const statusTone = loaded.enabled ? 'success' : 'warning';
  const sortedVersions = useMemo(
    () => [...loaded.versions].sort((left, right) => Number(right.revision) - Number(left.revision)),
    [loaded.versions],
  );

  if (loading) {
    return (
      <div className="panel supreme-prompt-loading" aria-live="polite" aria-busy="true">
        <div className="supreme-prompt-loading__skeleton" aria-hidden="true">
          <span className="supreme-prompt-loading__line supreme-prompt-loading__line--short" />
          <span className="supreme-prompt-loading__line" />
          <span className="supreme-prompt-loading__line" />
        </div>
        <span>Đang tải kho prompt bảo mật…</span>
      </div>
    );
  }

  return (
    <div className="supreme-prompt-workspace">
      <div className="prompt-settings-alert" role="note">
        <ShieldCheck size={18} />
        <span>
          Prompt chỉ hiển thị cho owner. Không đặt API key hoặc mật khẩu trong prompt.
          Bản nháp chưa ảnh hưởng người dùng.
        </span>
      </div>

      {error ? <ErrorState message={error} onRetry={reloadFromServer} /> : null}
      <div className="supreme-prompt-status" aria-label="Trạng thái Chat Tối Thượng">
        <Badge tone={statusTone}>{loaded.enabled ? 'Runtime đang bật' : 'Runtime bị tắt'}</Badge>
        <span>Draft revision: {loaded.draftRevision || 'Chưa có'}</span>
        <span>Published revision: {loaded.publishedRevision || 'Chưa có'}</span>
        <span>Cập nhật: {formatDate(loaded.updatedAt)}</span>
      </div>

      <section className="panel prompt-settings-editor" aria-label="Editor prompt Chat Tối Thượng">
        <header className="prompt-settings-panel-header">
          <div>
            <h2>Chat Tối Thượng</h2>
            <p>{draftContent.length.toLocaleString('vi-VN')} / {MAX_CONTENT_CHARS.toLocaleString('vi-VN')} ký tự</p>
          </div>
          {dirty ? <Badge tone="warning">Draft chưa lưu</Badge> : <Badge tone="neutral">Đã đồng bộ</Badge>}
        </header>

        <div className="prompt-editor-toolbar">
          <button type="button" className="button button--primary" onClick={saveDraft} disabled={!canSave}>
            <Save size={16} />
            {saving ? 'Đang lưu' : 'Lưu bản nháp'}
          </button>
          <button
            ref={publishButtonRef}
            type="button"
            className="button button--ghost"
            onClick={publish}
            disabled={
              saving
              || dirty
              || !loaded.draftVersionId
              || loaded.draftVersionId === loaded.publishedVersionId
            }
          >
            <Upload size={16} />
            Xuất bản
          </button>
          <button
            type="button"
            className="button button--ghost"
            onClick={() => setDraftContent(loaded.draftContent)}
            disabled={saving || !dirty}
          >
            <Undo2 size={16} />
            Hoàn tác thay đổi chưa lưu
          </button>
          <button
            ref={disableButtonRef}
            type="button"
            className="button button--danger"
            onClick={disable}
            disabled={saving || !loaded.enabled}
          >
            <Power size={16} />
            Tắt Tối Thượng
          </button>
          <button type="button" className="button button--ghost" onClick={reloadFromServer} disabled={saving}>
            <RefreshCw size={16} />
            Tải lại
          </button>
        </div>

        {overLimit ? (
          <div className="prompt-settings-alert prompt-settings-alert--danger" role="alert">
            <AlertTriangle size={18} />
            <span>Nội dung vượt giới hạn 60000 ký tự.</span>
          </div>
        ) : null}

        <label className="prompt-editor-field" htmlFor="supreme-prompt-content">
          <span>Nội dung prompt bảo mật</span>
          <textarea
            id="supreme-prompt-content"
            ref={textareaRef}
            value={draftContent}
            onChange={(event) => setDraftContent(event.target.value)}
            spellCheck={false}
            disabled={saving}
            placeholder="Nhập system prompt dành riêng cho Chat Tối Thượng…"
          />
        </label>

        <div className="supreme-prompt-live-status" aria-live="polite">
          {notice ? <><Check size={16} /><span>{notice}</span></> : null}
        </div>
      </section>

      <section
        ref={historySectionRef}
        className="panel supreme-prompt-history"
        aria-label="Lịch sử revision"
        tabIndex={-1}
      >
        <header className="prompt-settings-panel-header">
          <div>
            <h2>Lịch sử revision</h2>
            <p>Chỉ hiển thị metadata; nội dung revision cũ không được tải hàng loạt.</p>
          </div>
        </header>
        {sortedVersions.length === 0 ? (
          <p className="supreme-prompt-history__empty">Chưa có draft.</p>
        ) : (
          <div className="supreme-prompt-history__table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Revision</th>
                  <th>Độ dài</th>
                  <th>Ngày tạo</th>
                  <th>Trạng thái</th>
                  <th>Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {sortedVersions.map((version) => (
                  <tr key={version.id}>
                    <td>{version.revision}</td>
                    <td>{Number(version.contentLength || 0).toLocaleString('vi-VN')}</td>
                    <td>{formatDate(version.createdAt)}</td>
                    <td>
                      {version.id === loaded.publishedVersionId ? <Badge tone="success">Đang chạy</Badge> : 'Lịch sử'}
                    </td>
                    <td>
                      <button
                        type="button"
                        className="button button--ghost"
                        onClick={(event) => rollback(version, event.currentTarget)}
                        disabled={saving || version.id === loaded.publishedVersionId}
                      >
                        <RotateCcw size={15} />
                        Khôi phục revision này
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {loaded.historyNextBeforeRevision ? (
          <div className="supreme-prompt-history__actions">
            <button
              type="button"
              className="button button--ghost"
              onClick={loadMoreHistory}
              disabled={historyLoading}
            >
              <RefreshCw size={15} />
              {historyLoading ? 'Đang tải revision' : 'Tải thêm revision'}
            </button>
          </div>
        ) : null}
      </section>
    </div>
  );
}
