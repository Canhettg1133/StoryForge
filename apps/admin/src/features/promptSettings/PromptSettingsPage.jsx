import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Check,
  Clipboard,
  Power,
  RefreshCw,
  RotateCcw,
  Save,
  Undo2,
} from 'lucide-react';
import {
  PROMPT_SETTING_MAX_CONTENT_CHARS,
  TRANSLATOR_PROMPT_KEYS,
  TRANSLATOR_PROMPT_LABELS,
} from '@storyforge/access';
import { Badge, ErrorState } from '../../components/ui/AdminPrimitives.jsx';
import './promptSettings.css';

function emptyPromptItems() {
  return TRANSLATOR_PROMPT_KEYS.map((key) => ({
    domain: 'translator',
    key,
    label: TRANSLATOR_PROMPT_LABELS[key] || key,
    content: '',
    enabled: false,
    revision: 0,
    updatedAt: null,
  }));
}

function normalizeItems(items = []) {
  const byKey = new Map((Array.isArray(items) ? items : []).map((item) => [item.key, {
    domain: item.domain || 'translator',
    key: item.key,
    label: item.label || TRANSLATOR_PROMPT_LABELS[item.key] || item.key,
    content: String(item.content || ''),
    enabled: item.enabled === true,
    revision: Number(item.revision || 0),
    updatedAt: item.updatedAt || item.updated_at || null,
  }]));
  return emptyPromptItems().map((item) => byKey.get(item.key) || item);
}

function formatNumber(value) {
  return new Intl.NumberFormat('vi-VN').format(Number(value || 0));
}

function formatDate(value) {
  if (!value) return 'Chưa lưu';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Chưa lưu';
  return new Intl.DateTimeFormat('vi-VN', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date);
}

function hasOverrideContent(item = {}) {
  return Boolean(String(item.content || '').trim());
}

function getPromptStatusLabel(item = {}) {
  if (item.enabled) return 'Override đang bật';
  if (hasOverrideContent(item)) return 'Override đang tắt';
  return 'Bản deploy';
}

function getPromptStatusTone(item = {}) {
  if (item.enabled) return 'success';
  if (hasOverrideContent(item)) return 'warning';
  return 'neutral';
}

function getPromptItemLengthLabel(item = {}) {
  if (item.enabled && !hasOverrideContent(item)) return 'Override trống';
  if (!hasOverrideContent(item)) return 'Dùng prompt deploy';
  return `${formatNumber(String(item.content || '').length)} ký tự override`;
}

function PromptTemplateList({
  items,
  selectedKey,
  onSelect,
}) {
  return (
    <aside className="panel prompt-settings-list" aria-label="Danh sách mẫu prompt">
      <header className="prompt-settings-panel-header">
        <div>
          <h2>Mẫu dịch truyện</h2>
          <p>{formatNumber(items.length)} template trong allowlist</p>
        </div>
      </header>
      <div className="prompt-template-list">
        {items.map((item) => (
          <button
            type="button"
            key={item.key}
            className={`prompt-template-item ${selectedKey === item.key ? 'is-active' : ''}`}
            onClick={() => onSelect(item.key)}
          >
            <span className="prompt-template-item__title">{item.label}</span>
            <span className="prompt-template-item__meta">
              <Badge tone={getPromptStatusTone(item)}>{getPromptStatusLabel(item)}</Badge>
              <span>Rev {item.revision}</span>
              <span>{getPromptItemLengthLabel(item)}</span>
            </span>
          </button>
        ))}
      </div>
    </aside>
  );
}

export default function PromptSettingsPage({ adminApi, reloadSignal = 0 }) {
  const [domain] = useState('translator');
  const [items, setItems] = useState(() => emptyPromptItems());
  const [selectedKey, setSelectedKey] = useState('sacHiep');
  const [draftContent, setDraftContent] = useState('');
  const [draftEnabled, setDraftEnabled] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const textareaRef = useRef(null);

  const selected = useMemo(() => (
    items.find((item) => item.key === selectedKey) || items[0] || emptyPromptItems()[0]
  ), [items, selectedKey]);

  const isDirty = selected
    ? draftContent !== selected.content || draftEnabled !== selected.enabled
    : false;
  const overLimit = draftContent.length > PROMPT_SETTING_MAX_CONTENT_CHARS;
  const enableWithoutContent = draftEnabled && !draftContent.trim();
  const draftStatus = useMemo(() => ({
    content: draftContent,
    enabled: draftEnabled,
  }), [draftContent, draftEnabled]);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError('');
    setNotice('');
    try {
      const payload = await adminApi.promptSettings({ domain });
      const nextItems = normalizeItems(payload.items);
      setItems(nextItems);
      setSelectedKey((currentKey) => (
        nextItems.some((item) => item.key === currentKey)
          ? currentKey
          : nextItems[0]?.key || 'sacHiep'
      ));
    } catch (err) {
      setError(err.message || 'Không tải được prompt mẫu dịch truyện.');
    } finally {
      setLoading(false);
    }
  }, [adminApi, domain]);

  useEffect(() => {
    loadData();
  }, [loadData, reloadSignal]);

  useEffect(() => {
    if (!selected) return;
    setDraftContent(selected.content);
    setDraftEnabled(selected.enabled);
  }, [selected]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.max(420, textarea.scrollHeight)}px`;
  }, [draftContent, selectedKey]);

  const mergeSavedItem = (item) => {
    const normalized = normalizeItems([item]).find((entry) => entry.key === item.key) || item;
    setItems((current) => current.map((entry) => (entry.key === normalized.key ? normalized : entry)));
    setDraftContent(normalized.content);
    setDraftEnabled(normalized.enabled);
  };

  const savePrompt = async (override = {}) => {
    const nextContent = Object.prototype.hasOwnProperty.call(override, 'content')
      ? override.content
      : draftContent;
    const nextEnabled = Object.prototype.hasOwnProperty.call(override, 'enabled')
      ? override.enabled
      : draftEnabled;
    if (!selected || overLimit || (nextEnabled && !String(nextContent || '').trim())) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const payload = await adminApi.updatePromptSetting(domain, selected.key, {
        content: nextContent,
        enabled: nextEnabled,
        expectedRevision: selected.revision,
      });
      mergeSavedItem(payload.item);
      setNotice(nextEnabled
        ? 'Đã lưu và bật override prompt mẫu.'
        : 'Đã lưu bản nháp, override đang tắt nên runtime dùng bản deploy.');
    } catch (err) {
      setError(err.message || 'Không lưu được prompt mẫu dịch truyện.');
    } finally {
      setSaving(false);
    }
  };

  const restoreLoaded = () => {
    if (!selected) return;
    setDraftContent(selected.content);
    setDraftEnabled(selected.enabled);
    setNotice('Đã hoàn tác về bản đang tải trong admin.');
  };

  const restoreDeployed = () => {
    savePrompt({ content: draftContent, enabled: false });
  };

  const copyPrompt = async () => {
    setError('');
    setNotice('');
    try {
      await navigator.clipboard.writeText(draftContent);
      setNotice('Đã copy prompt vào clipboard.');
    } catch {
      setError('Không copy được prompt trên trình duyệt hiện tại.');
    }
  };

  return (
    <section className="content-grid prompt-settings-page">
      <div className="section-header prompt-settings-header">
        <div>
          <h1>Prompt mẫu dịch truyện</h1>
          <p>Chỉnh prompt mặc định của các mẫu ở trang dịch truyện. Khi tắt override, runtime dùng bản deploy; quyền đọc và sửa chỉ dành cho owner.</p>
        </div>
        <div className="section-header__actions prompt-domain-selector" aria-label="Chọn domain prompt">
          <button type="button" className="button button--primary">
            Dịch truyện
          </button>
          <button type="button" className="button button--ghost" disabled title="Sắp hỗ trợ prompt viết truyện">
            Viết truyện · Sắp hỗ trợ
          </button>
        </div>
      </div>

      <div className="prompt-settings-alert" role="note">
        <AlertTriangle size={18} />
        <span>Prompt này không phải bí mật trong kiến trúc runtime browser hiện tại.</span>
      </div>

      {error ? <ErrorState message={error} onRetry={loadData} /> : null}
      {notice ? (
        <div className="prompt-settings-notice" role="status">
          <Check size={18} />
          <span>{notice}</span>
        </div>
      ) : null}

      <div className="prompt-settings-workspace">
        <PromptTemplateList items={items} selectedKey={selectedKey} onSelect={setSelectedKey} />

        <section className="panel prompt-settings-editor" aria-label="Editor prompt mẫu dịch truyện">
          <header className="prompt-settings-panel-header">
            <div>
              <span className="prompt-settings-kicker">Template</span>
              <h2>{selected?.label || selectedKey}</h2>
              <p>
                Revision {selected?.revision || 0} · {getPromptItemLengthLabel(draftStatus)} · Giới hạn {formatNumber(PROMPT_SETTING_MAX_CONTENT_CHARS)} ký tự · Cập nhật {formatDate(selected?.updatedAt)}
              </p>
            </div>
            <Badge tone={getPromptStatusTone(draftStatus)}>{getPromptStatusLabel(draftStatus)}</Badge>
          </header>

          <div className="prompt-editor-toolbar" aria-label="Công cụ prompt">
            <button
              type="button"
              className="button button--primary"
              onClick={() => savePrompt()}
              disabled={loading || saving || !isDirty || overLimit || enableWithoutContent}
              title="Lưu bản nháp prompt mẫu"
            >
              <Save size={16} />
              {saving ? 'Đang lưu' : 'Lưu bản nháp'}
            </button>
            <button
              type="button"
              className="button button--ghost"
              onClick={() => setDraftEnabled((value) => !value)}
              disabled={saving}
              title={draftEnabled ? 'Tắt override prompt' : 'Bật override prompt'}
            >
              <Power size={16} />
              {draftEnabled ? 'Tắt override' : 'Bật override'}
            </button>
            <button
              type="button"
              className="button button--ghost"
              onClick={loadData}
              disabled={loading || saving}
              title="Tải lại prompt từ Admin API"
            >
              <RefreshCw size={16} />
              Tải lại
            </button>
            <button
              type="button"
              className="button button--ghost"
              onClick={copyPrompt}
              disabled={!draftContent}
              title="Copy prompt"
            >
              <Clipboard size={16} />
              Copy
            </button>
            <button
              type="button"
              className="button button--ghost"
              onClick={restoreLoaded}
              disabled={!isDirty || saving}
              title="Hoàn tác về bản đang tải trong admin"
            >
              <Undo2 size={16} />
              Hoàn tác
            </button>
            <button
              type="button"
              className="button button--ghost"
              onClick={restoreDeployed}
              disabled={saving || !selected || selected.revision < 0}
              title="Tắt override để runtime dùng prompt hard-code đang deploy"
            >
              <RotateCcw size={16} />
              Khôi phục bản deploy
            </button>
          </div>

          {overLimit ? (
            <div className="prompt-settings-alert prompt-settings-alert--danger" role="alert">
              <AlertTriangle size={18} />
              <span>Prompt vượt quá giới hạn {formatNumber(PROMPT_SETTING_MAX_CONTENT_CHARS)} ký tự.</span>
            </div>
          ) : null}
          {enableWithoutContent ? (
            <div className="prompt-settings-alert prompt-settings-alert--danger" role="alert">
              <AlertTriangle size={18} />
              <span>Cần nhập nội dung prompt trước khi bật override.</span>
            </div>
          ) : null}

          <label className="prompt-editor-field">
            <span>Nội dung prompt override</span>
            <textarea
              ref={textareaRef}
              value={draftContent}
              onChange={(event) => setDraftContent(event.target.value)}
              spellCheck={false}
              placeholder="Nhập prompt override cho template này. Nếu để trống và tắt override, trang dịch sẽ dùng prompt bản deploy."
            />
          </label>
        </section>
      </div>
    </section>
  );
}
