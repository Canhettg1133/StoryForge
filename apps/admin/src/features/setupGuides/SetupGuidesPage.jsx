import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  BookOpen,
  ExternalLink,
  Plus,
  RotateCcw,
  Save,
  Trash2,
} from 'lucide-react';
import {
  ADMIN_PERMISSIONS,
  DEFAULT_SETUP_GUIDES,
  SETUP_GUIDES_MAX_ITEMS,
  hasPermission,
  validateSetupGuideConfig,
} from '@storyforge/access';
import { EmptyState, ErrorState } from '../../components/ui/AdminPrimitives.jsx';
import './setupGuides.css';

function cloneItems(items = []) {
  return items.map((item) => ({ ...item }));
}

function makeGuideId(items) {
  const generated = globalThis.crypto?.randomUUID?.() || `guide-${Date.now().toString(36)}`;
  if (!items.some((item) => item.id === generated)) return generated;
  return `guide-${Date.now().toString(36)}-${items.length}`;
}

function normalizeAdminConfig(value) {
  const source = value && typeof value === 'object' ? value : DEFAULT_SETUP_GUIDES;
  return {
    key: 'setup_guides',
    revision: Number(source.revision || 1),
    items: cloneItems(Array.isArray(source.items) ? source.items : DEFAULT_SETUP_GUIDES.items),
  };
}

function PreviewIcon({ icon }) {
  const Icon = icon === 'external' ? ExternalLink : BookOpen;
  return <Icon size={14} aria-hidden="true" />;
}

export default function SetupGuidesPage({
  adminApi,
  actor,
  reloadSignal = 0,
  onDirtyChange = () => {},
}) {
  const [saved, setSaved] = useState(() => normalizeAdminConfig(DEFAULT_SETUP_GUIDES));
  const [items, setItems] = useState(() => cloneItems(DEFAULT_SETUP_GUIDES.items));
  const [loading, setLoading] = useState(true);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const canWrite = hasPermission(actor, ADMIN_PERMISSIONS.CATALOG_WRITE);
  const dirty = useMemo(() => JSON.stringify(items) !== JSON.stringify(saved.items), [items, saved.items]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    setNotice('');
    try {
      const payload = await adminApi.setupGuides();
      const next = normalizeAdminConfig(payload.setupGuides);
      setSaved(next);
      setItems(cloneItems(next.items));
      setHasLoaded(true);
    } catch (loadError) {
      setError(loadError.message || 'Không tải được danh sách nút hướng dẫn.');
    } finally {
      setLoading(false);
    }
  }, [adminApi]);

  useEffect(() => {
    load();
  }, [load, reloadSignal]);

  useEffect(() => {
    onDirtyChange(dirty);
    return () => onDirtyChange(false);
  }, [dirty, onDirtyChange]);

  useEffect(() => {
    const warnBeforeLeave = (event) => {
      if (!dirty) return;
      event.preventDefault();
      event.returnValue = '';
    };
    globalThis.addEventListener('beforeunload', warnBeforeLeave);
    return () => globalThis.removeEventListener('beforeunload', warnBeforeLeave);
  }, [dirty]);

  const updateItem = (id, patch) => {
    setItems((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)));
    setNotice('');
  };

  const moveItem = (index, offset) => {
    setItems((current) => {
      const target = index + offset;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
    setNotice('');
  };

  const addItem = () => {
    setItems((current) => {
      if (current.length >= SETUP_GUIDES_MAX_ITEMS) return current;
      return [...current, {
        id: makeGuideId(current),
        label: 'Hướng dẫn mới',
        url: '/guide',
        enabled: true,
        icon: 'book',
      }];
    });
    setNotice('');
  };

  const save = async () => {
    if (!canWrite || !dirty || saving) return;
    setError('');
    setNotice('');
    let validated;
    try {
      validated = validateSetupGuideConfig({ expectedRevision: saved.revision, items });
    } catch (validationError) {
      setError(validationError.message || 'Danh sách nút hướng dẫn không hợp lệ.');
      return;
    }

    setSaving(true);
    try {
      const payload = await adminApi.updateSetupGuides({
        expectedRevision: validated.revision,
        items: validated.items,
      });
      const next = normalizeAdminConfig(payload.setupGuides);
      setSaved(next);
      setItems(cloneItems(next.items));
      setNotice(`Đã lưu revision ${next.revision}. Frontend có thể cần tối đa 5 phút để làm mới cache.`);
    } catch (saveError) {
      setError(saveError.message || 'Không lưu được danh sách nút hướng dẫn.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <section className="panel setup-guides-loading" aria-busy="true">Đang tải danh sách nút hướng dẫn…</section>;
  }

  if (!hasLoaded && error) {
    return (
      <section className="content-grid setup-guides-page">
        <ErrorState message={error} onRetry={load} />
      </section>
    );
  }

  return (
    <section className="content-grid setup-guides-page">
      <header className="section-header">
        <div>
          <h1>Nút hướng dẫn</h1>
          <p>Quản lý các nút hiển thị trong phần lấy API key ở Cài đặt. Mọi thay đổi được lưu cùng một lần.</p>
        </div>
        <div className="section-header__actions">
          <button
            type="button"
            className="button button--ghost"
            disabled={!dirty || saving}
            onClick={() => {
              setItems(cloneItems(saved.items));
              setError('');
              setNotice('Đã hoàn tác các thay đổi chưa lưu.');
            }}
          >
            <RotateCcw size={15} />
            Hoàn tác
          </button>
          <button type="button" className="button button--primary" disabled={!canWrite || !dirty || saving} onClick={save}>
            <Save size={15} />
            {saving ? 'Đang lưu' : 'Lưu thay đổi'}
          </button>
        </div>
      </header>

      {error ? <ErrorState message={error} onRetry={error.includes('tải') ? load : undefined} /> : null}
      {notice ? <div className="setup-guides-notice" role="status">{notice}</div> : null}
      {!canWrite ? <div className="setup-guides-readonly">Tài khoản hiện tại chỉ có quyền xem cấu hình.</div> : null}

      <section className="panel setup-guides-editor" aria-label="Danh sách nút hướng dẫn">
        <div className="setup-guides-editor__header">
          <div>
            <h2>Danh sách nút</h2>
            <p>{items.length}/{SETUP_GUIDES_MAX_ITEMS} nút · Revision {saved.revision}</p>
          </div>
          <button
            type="button"
            className="button button--ghost"
            disabled={!canWrite || items.length >= SETUP_GUIDES_MAX_ITEMS}
            onClick={addItem}
          >
            <Plus size={15} />
            Thêm nút
          </button>
        </div>

        {items.length === 0 ? (
          <EmptyState title="Chưa có nút hướng dẫn" text="Thêm nút mới rồi lưu để hiển thị trong Cài đặt." />
        ) : (
          <div className="setup-guide-list">
            {items.map((item, index) => (
              <article className="setup-guide-item" key={item.id}>
                <div className="setup-guide-item__order" aria-label={`Vị trí ${index + 1}`}>
                  <span>{index + 1}</span>
                  <button type="button" className="icon-button" disabled={!canWrite || index === 0} onClick={() => moveItem(index, -1)} aria-label={`Đưa ${item.label} lên`}>
                    <ArrowUp size={15} />
                  </button>
                  <button type="button" className="icon-button" disabled={!canWrite || index === items.length - 1} onClick={() => moveItem(index, 1)} aria-label={`Đưa ${item.label} xuống`}>
                    <ArrowDown size={15} />
                  </button>
                </div>

                <div className="setup-guide-item__fields">
                  <label>
                    <span>Nhãn nút</span>
                    <input maxLength={64} value={item.label} disabled={!canWrite} onChange={(event) => updateItem(item.id, { label: event.target.value })} />
                  </label>
                  <label>
                    <span>Đường dẫn nội bộ hoặc HTTPS</span>
                    <input maxLength={2048} value={item.url} disabled={!canWrite} spellCheck="false" onChange={(event) => updateItem(item.id, { url: event.target.value })} />
                  </label>
                  <label>
                    <span>Icon</span>
                    <select value={item.icon} disabled={!canWrite} onChange={(event) => updateItem(item.id, { icon: event.target.value })}>
                      <option value="book">Sách hướng dẫn</option>
                      <option value="external">Liên kết ngoài</option>
                    </select>
                  </label>
                  <label className="setup-guide-toggle">
                    <input type="checkbox" checked={item.enabled} disabled={!canWrite} onChange={(event) => updateItem(item.id, { enabled: event.target.checked })} />
                    <span>Hiển thị nút này</span>
                  </label>
                </div>

                <button type="button" className="icon-button icon-button--danger" disabled={!canWrite} onClick={() => setItems((current) => current.filter((entry) => entry.id !== item.id))} aria-label={`Xóa ${item.label}`}>
                  <Trash2 size={16} />
                </button>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="panel setup-guides-preview" aria-label="Xem trước nút hướng dẫn">
        <header>
          <h2>Xem trước</h2>
          <p>Thứ tự và kiểu nút đang chờ lưu. Link bị tắt trong preview để tránh rời Admin ngoài ý muốn.</p>
        </header>
        <div className="setup-guides-preview__buttons">
          {items.filter((item) => item.enabled).map((item, index) => (
            <span key={item.id} className={`button ${index === 0 ? 'button--primary' : 'button--ghost'}`} title={item.url}>
              <PreviewIcon icon={item.icon} />
              {item.label || 'Nút chưa có nhãn'}
            </span>
          ))}
          {items.every((item) => !item.enabled) ? <span>Không có nút nào đang bật.</span> : null}
        </div>
      </section>
    </section>
  );
}


