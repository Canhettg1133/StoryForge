import React, { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  AlertCircle,
  CheckCircle2,
  Copy,
  FileStack,
  RefreshCw,
  Save,
  Sparkles,
  Trash2,
} from 'lucide-react';
import '../Settings/Settings.css';
import './ProjectPromptManager.css';
import useProjectStore from '../../stores/projectStore';
import { TASK_INSTRUCTIONS, DEFAULT_NSFW_RULES, DEFAULT_NSFW_INTIMATE_PROMPT } from '../../services/ai/promptBuilder';
import { PROJECT_PROMPT_GROUPS } from '../../services/ai/promptManagerMeta';
import { GENRE_TEMPLATES } from '../../utils/genreTemplates';

function parsePromptTemplates(rawValue) {
  if (!rawValue) return {};

  try {
    const parsed = typeof rawValue === 'string' ? JSON.parse(rawValue) : rawValue;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function stringifyList(value) {
  if (!Array.isArray(value)) return '';
  return value.join('\n');
}

function parseListText(value) {
  return String(value || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function buildDefaultValue(item, genreKey) {
  const template = GENRE_TEMPLATES[genreKey] || {};

  if (item.key === 'constitution') {
    return stringifyList(template.constitution || []);
  }

  if (item.key === 'style_dna') {
    return stringifyList(template.style_dna || []);
  }

  if (item.key === 'anti_ai_blacklist') {
    return stringifyList(template.anti_ai_blacklist || []);
  }

  if (item.key === 'nsfw_system_prompt') {
    return DEFAULT_NSFW_RULES;
  }

  if (item.key === 'nsfw_rules') {
    return '';
  }

  if (item.key === 'nsfw_intimate_prompt') {
    return DEFAULT_NSFW_INTIMATE_PROMPT;
  }

  return TASK_INSTRUCTIONS[item.key] || '';
}

function toCoreEditorValue(item, sourceValue, genreKey) {
  if (item.type === 'list') {
    if (Array.isArray(sourceValue)) return stringifyList(sourceValue);
    return buildDefaultValue(item, genreKey);
  }

  if (typeof sourceValue === 'string') return sourceValue;
  return buildDefaultValue(item, genreKey);
}

function toOverrideEditorValue(item, sourceValue) {
  if (item.type === 'list') {
    if (Array.isArray(sourceValue)) return stringifyList(sourceValue);
    return '';
  }

  if (typeof sourceValue === 'string') return sourceValue;
  return '';
}

function cleanPromptTemplates(definitions, draft) {
  const cleaned = {};

  definitions.forEach((definition) => {
    definition.items.forEach((item) => {
      const rawValue = draft[item.key];

      if (item.type === 'list') {
        const parsedList = Array.isArray(rawValue) ? rawValue : parseListText(rawValue);
        if (parsedList.length > 0) {
          cleaned[item.key] = parsedList;
        }
        return;
      }

      const normalized = String(rawValue || '').trim();
      if (normalized) {
        cleaned[item.key] = normalized;
      }
    });
  });

  return cleaned;
}

function PromptInfoGrid({ item }) {
  return (
    <div className="prompt-card__info-grid">
      <div className="prompt-card__info-box">
        <strong>Dùng để làm gì</strong>
        <p>{item.purpose}</p>
      </div>
    </div>
  );
}

function PromptEditorCard({
  item,
  genreKey,
  coreDraft,
  overrideDraft,
  onCoreChange,
  onOverrideChange,
  onResetCore,
  onApplyCore,
  onClearOverride,
}) {
  const hasOverride = item.type === 'list'
    ? parseListText(overrideDraft).length > 0
    : String(overrideDraft || '').trim().length > 0;

  const effectiveLabel = hasOverride ? 'Đang dùng Override của truyện' : 'Đang dùng prompt mặc định';
  const coreHelp = item.key === 'nsfw_system_prompt'
    ? 'Đây là prompt gốc của khối NSFW. Nếu không có override, hệ thống dùng prompt gốc này.'
    : item.key === 'nsfw_rules'
      ? 'Đây là vùng soạn rule bổ sung để tham chiếu. Rule bổ sung không thay thế prompt gốc NSFW.'
      : 'Bản mẫu gốc để tham chiếu và chỉnh thử tại chỗ. Không lưu riêng vào project.';
  const overrideHelp = item.key === 'nsfw_system_prompt'
    ? 'Nếu nhập ở đây, bạn đang thay thế prompt gốc NSFW của project này.'
    : item.key === 'nsfw_rules'
      ? 'Nếu nhập ở đây, rule sẽ được nối vào sau prompt gốc NSFW của project này.'
      : 'Phần ghi đè thật sự của riêng truyện này. Đây là phần sẽ được lưu vào project.';
  const overridePlaceholder = item.key === 'nsfw_rules'
    ? 'Để trống = không thêm rule bổ sung. Nếu có nội dung, hệ thống sẽ nối vào sau prompt gốc NSFW.'
    : item.type === 'list'
      ? 'Mỗi dòng là một mục. Để trống = dùng Core Defaults.'
      : 'Để trống = dùng Core Defaults.';

  return (
    <article className="prompt-card">
      <div className="prompt-card__header">
        <div>
          <h3>{item.label}</h3>
          <p>{effectiveLabel}</p>
        </div>
        <span className={`prompt-card__badge ${hasOverride ? 'is-override' : 'is-default'}`}>
          {hasOverride ? 'Override' : 'Mặc định'}
        </span>
      </div>

      <PromptInfoGrid item={item} />

      <div className="prompt-card__columns">
        <section className="prompt-editor-block">
          <div className="prompt-editor-block__header">
            <div>
              <strong>Core Defaults</strong>
              <p>{coreHelp}</p>
            </div>
            <div className="prompt-editor-block__actions">
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => onResetCore(item)}>
                <RefreshCw size={13} /> Khôi phục mặc định
              </button>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => onApplyCore(item)}>
                <Copy size={13} /> Sao chép xuống Override
              </button>
            </div>
          </div>

          <textarea
            className="textarea prompt-editor-block__textarea"
            rows={item.type === 'list' ? 8 : 12}
            value={coreDraft}
            onChange={(event) => onCoreChange(item, event.target.value)}
          />
        </section>

        <section className="prompt-editor-block">
          <div className="prompt-editor-block__header">
            <div>
              <strong>Project Override</strong>
              <p>{overrideHelp}</p>
            </div>
            <div className="prompt-editor-block__actions">
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => onClearOverride(item)} disabled={!hasOverride}>
                <Trash2 size={13} /> Xóa Override
              </button>
            </div>
          </div>

          <textarea
            className="textarea prompt-editor-block__textarea"
            rows={item.type === 'list' ? 8 : 12}
            value={overrideDraft}
            onChange={(event) => onOverrideChange(item, event.target.value)}
            placeholder={overridePlaceholder}
          />
        </section>
      </div>

      <div className="prompt-card__footer">
        <div className="prompt-card__footer-item">
          <strong>Key dùng trong hệ thống</strong>
          <code>{item.key}</code>
        </div>
        <div className="prompt-card__footer-item">
          <strong>Thể loại đang lấy mặc định</strong>
          <span>{GENRE_TEMPLATES[genreKey]?.label || genreKey || 'Chưa xác định'}</span>
        </div>
      </div>
    </article>
  );
}

export default function ProjectPromptManager() {
  const { projectId } = useParams();
  const {
    currentProject,
    loadProject,
    updateProjectSettings,
  } = useProjectStore();

  const [overrideDraft, setOverrideDraft] = useState({});
  const [coreDrafts, setCoreDrafts] = useState({});
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState(null);

  useEffect(() => {
    if (!projectId) return;
    if (!currentProject || String(currentProject.id) !== String(projectId)) {
      loadProject(Number(projectId)).catch(() => {});
    }
  }, [currentProject, loadProject, projectId]);

  const genreKey = currentProject?.genre_primary || 'fantasy';

  useEffect(() => {
    if (!currentProject) return;

    const parsedTemplates = parsePromptTemplates(currentProject.prompt_templates);
    setOverrideDraft(parsedTemplates);

    const nextCoreDrafts = {};
    PROJECT_PROMPT_GROUPS.forEach((group) => {
      group.items.forEach((item) => {
        nextCoreDrafts[item.key] = buildDefaultValue(item, genreKey);
      });
    });
    setCoreDrafts(nextCoreDrafts);
    setSaveMessage(null);
  }, [currentProject, genreKey]);

  const handleCoreChange = (item, value) => {
    setCoreDrafts((prev) => ({
      ...prev,
      [item.key]: value,
    }));
  };

  const handleOverrideChange = (item, value) => {
    setOverrideDraft((prev) => ({
      ...prev,
      [item.key]: item.type === 'list' ? parseListText(value) : value,
    }));
    setSaveMessage(null);
  };

  const handleResetCore = (item) => {
    setCoreDrafts((prev) => ({
      ...prev,
      [item.key]: buildDefaultValue(item, genreKey),
    }));
  };

  const handleApplyCore = (item) => {
    const coreValue = coreDrafts[item.key] || '';
    setOverrideDraft((prev) => ({
      ...prev,
      [item.key]: item.type === 'list' ? parseListText(coreValue) : coreValue,
    }));
    setSaveMessage(null);
  };

  const handleClearOverride = (item) => {
    setOverrideDraft((prev) => {
      const next = { ...prev };
      delete next[item.key];
      return next;
    });
    setSaveMessage(null);
  };

  const handleSave = async () => {
    if (!currentProject) return;

    const cleaned = cleanPromptTemplates(PROJECT_PROMPT_GROUPS, overrideDraft);
    setIsSaving(true);
    try {
      await updateProjectSettings({
        prompt_templates: JSON.stringify(cleaned),
      });
      setOverrideDraft(cleaned);
      setSaveMessage({
        type: 'success',
        text: 'Đã lưu Prompt truyện.',
      });
    } catch (error) {
      setSaveMessage({
        type: 'error',
        text: error?.message || 'Không thể lưu Prompt truyện.',
      });
    } finally {
      setIsSaving(false);
    }
  };

  if (!currentProject) {
    return (
      <div className="settings-page">
        <div className="prompt-manager-empty card">
          <AlertCircle size={18} />
          <div>
            <strong>Chưa nạp được dự án</strong>
            <p>Hãy mở một truyện trước khi chỉnh Prompt truyện.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="settings-page prompt-manager-page">
      <header className="settings-header animate-fade-in">
        <div className="prompt-manager-page__heading">
          <div>
            <h1 className="settings-title">Prompt truyện</h1>
            <p className="settings-subtitle">
              Quản lý toàn bộ prompt gắn với truyện <strong>{currentProject.title}</strong>. Chỉ phần Override mới được lưu vào project.
            </p>
          </div>
          <div className="prompt-manager-page__toolbar">
            <button className="btn btn-primary" onClick={handleSave} disabled={isSaving}>
              {isSaving ? <RefreshCw size={14} className="animate-spin" /> : <Save size={14} />}
              Lưu Prompt truyện
            </button>
          </div>
        </div>
      </header>

      <section className="settings-section card animate-slide-up prompt-manager-intro">
        <div className="settings-section-header">
          <FileStack size={20} />
          <div>
            <h2>Cách dùng trang này</h2>
            <p>
              <strong>Core Defaults</strong> là prompt gốc để tham chiếu và chỉnh thử. <strong>Project Override</strong> là phần ghi đè thật sự của riêng truyện này.
            </p>
          </div>
        </div>

        <div className="prompt-manager-intro__grid">
          <div className="prompt-manager-intro__box">
            <strong>Dùng để làm gì</strong>
            <p>Giúp bạn gom toàn bộ prompt liên quan đến viết truyện, canon và ghi nhớ về đúng một nơi quản lý.</p>
          </div>
        </div>

        {saveMessage && (
          <div className={`prompt-manager-status ${saveMessage.type === 'success' ? 'is-success' : 'is-error'}`}>
            {saveMessage.type === 'success' ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}
            {saveMessage.text}
          </div>
        )}
      </section>

      <div className="settings-sections">
        {PROJECT_PROMPT_GROUPS.map((group, groupIndex) => (
          <section
            key={group.key}
            className="settings-section card animate-slide-up"
            style={{ animationDelay: `${groupIndex * 40}ms` }}
          >
            <div className="settings-section-header">
              <Sparkles size={20} />
              <div>
                <h2>{group.title}</h2>
                <p>{group.summary}</p>
              </div>
            </div>

            <div className="prompt-group-list">
              {group.items.map((item) => (
                <PromptEditorCard
                  key={item.key}
                  item={item}
                  genreKey={genreKey}
                  coreDraft={toCoreEditorValue(item, coreDrafts[item.key], genreKey)}
                  overrideDraft={toOverrideEditorValue(item, overrideDraft[item.key])}
                  onCoreChange={handleCoreChange}
                  onOverrideChange={handleOverrideChange}
                  onResetCore={handleResetCore}
                  onApplyCore={handleApplyCore}
                  onClearOverride={handleClearOverride}
                />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
