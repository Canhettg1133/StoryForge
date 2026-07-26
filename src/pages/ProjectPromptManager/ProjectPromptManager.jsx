import React, { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  AlertCircle,
  CheckCircle2,
  Copy,
  Eye,
  FileStack,
  Loader2,
  Power,
  RefreshCw,
  Save,
  Sparkles,
  Trash2,
} from 'lucide-react';
import '../Settings/Settings.css';
import './ProjectPromptManager.css';
import useProjectStore from '../../stores/projectStore';
import {
  TASK_INSTRUCTIONS,
  DEFAULT_NSFW_RULES,
  DEFAULT_NSFW_INTIMATE_PROMPT,
  composeTaskInstruction,
  getTaskInstructionProtection,
  stripProtectedTaskInstruction,
} from '../../services/ai/promptBuilder';
import { PROJECT_PROMPT_GROUPS } from '../../services/ai/promptManagerMeta';
import {
  computeProjectStyleRuntimeSourceHash,
  getProjectStyleRuntimeState,
  hasRequiredProjectStyleRuntimeSections,
  PROJECT_STYLE_RUNTIME_SECTIONS,
} from '../../services/ai/projectStyleRuntime';
import { generateProjectStyleRuntimeBlock } from '../../services/ai/projectStyleRuntimeGenerator';
import { buildWritingDebugPayload } from '../../services/ai/writingRequestDebugger.js';
import { TASK_TYPES } from '../../services/ai/router';
import { toVietnameseErrorMessage } from '../../utils/errorMessages.js';
import { GENRE_TEMPLATES } from '../../utils/genreTemplates';
import ProjectContentModeControl from '../../features/projectContentMode/ProjectContentModeControl.jsx';
import useProjectContentMode from '../../features/projectContentMode/useProjectContentMode.js';
import AutoResizeTextarea from '../../components/common/AutoResizeTextarea.jsx';
import { useConfirmDialog } from '../../components/common/ConfirmDialogProvider.jsx';

const SHOW_FINAL_PROMPT_PREVIEW = false;

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

  if (item.key === 'ai_guidelines') {
    return '';
  }

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

  return stripProtectedTaskInstruction(item.key, TASK_INSTRUCTIONS[item.key] || '');
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
    if (typeof sourceValue === 'string') return sourceValue;
    return '';
  }

  if (typeof sourceValue === 'string') return stripProtectedTaskInstruction(item.key, sourceValue);
  return '';
}

function cleanPromptTemplates(definitions, draft) {
  const cleaned = {};

  definitions.forEach((definition) => {
    definition.items.forEach((item) => {
      if (item.persistAs === 'projectField') {
        return;
      }

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
        cleaned[item.key] = stripProtectedTaskInstruction(item.key, normalized);
      }
    });
  });

  return cleaned;
}

function getProjectPromptSignature(draft) {
  const promptTemplates = cleanPromptTemplates(PROJECT_PROMPT_GROUPS, draft || {});
  const aiGuidelines = String(draft?.ai_guidelines || '').trim();

  return JSON.stringify({
    prompt_templates: promptTemplates,
    ai_guidelines: aiGuidelines,
  });
}

function formatRuntimeDate(timestamp) {
  const value = Number(timestamp || 0);
  if (!value) return 'Chưa có';
  return new Intl.DateTimeFormat('vi-VN', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value));
}

function getRuntimeStatus(runtimeState, hasPreview) {
  if (hasPreview) {
    return {
      key: 'preview',
      label: 'Có bản xem trước',
      tone: 'preview',
      description: 'Block mới đã được AI rút lõi, cần bấm lưu để có hiệu lực.',
    };
  }

  if (!runtimeState?.block) {
    return {
      key: 'empty',
      label: 'Chưa tạo',
      tone: 'idle',
      description: 'Runtime đang dùng logic cũ và gửi các prompt rời như trước.',
    };
  }

  if (!runtimeState.enabled) {
    return {
      key: 'disabled',
      label: 'Đang tắt',
      tone: 'idle',
      description: 'Block đã lưu nhưng đang tắt, runtime quay về logic cũ.',
    };
  }

  if (!runtimeState.validBlock) {
    return {
      key: 'invalid',
      label: 'Block lỗi',
      tone: 'danger',
      description: 'Block thiếu 6 mục bắt buộc nên không được inject.',
    };
  }

  if (runtimeState.stale) {
    return {
      key: 'stale',
      label: 'Đã lỗi thời',
      tone: 'warning',
      description: 'Prompt nguồn đã đổi sau lần rút lõi, runtime tạm dùng logic cũ để không bỏ sót sửa đổi mới.',
    };
  }

  if (runtimeState.active) {
    return {
      key: 'active',
      label: 'Đang dùng',
      tone: 'success',
      description: 'Block đang được chèn sớm vào system prompt cho các luồng viết của truyện.',
    };
  }

  return {
    key: 'ready',
    label: 'Sẵn sàng',
    tone: 'success',
    description: 'Block hợp lệ và sẽ có hiệu lực trong các task viết được hỗ trợ.',
  };
}

function ProjectStyleRuntimeCard({
  runtimeState,
  runtimeStatus,
  draftSourceHash,
  displayBlock,
  runtimePreview,
  runtimeMessage,
  editableBlock,
  isGeneratingRuntime,
  isSaving,
  onGenerate,
  onEditableBlockChange,
  onSaveBlock,
  onToggleEnabled,
  onDelete,
}) {
  const hasPreview = !!runtimePreview?.project_style_runtime_block;
  const hasSavedBlock = !!runtimeState?.block;
  const normalizedEditableBlock = String(editableBlock || '').trim();
  const normalizedDisplayBlock = String(displayBlock || '').trim();
  const hasEditableBlock = normalizedEditableBlock.length > 0;
  const blockChanged = normalizedEditableBlock !== normalizedDisplayBlock;
  const editableBlockValid = !hasEditableBlock || hasRequiredProjectStyleRuntimeSections(normalizedEditableBlock);
  const displayMeta = runtimePreview?.meta || runtimeState?.meta || {};
  const previewSourceChanged = Boolean(
    hasPreview
    && runtimePreview?.meta?.source_hash
    && runtimePreview.meta.source_hash !== draftSourceHash,
  );
  const canSaveBlock = hasEditableBlock
    && editableBlockValid
    && !previewSourceChanged
    && !isSaving
    && (hasPreview || blockChanged);
  const canToggle = hasSavedBlock && runtimeState.validBlock && !isSaving;
  const canDelete = hasSavedBlock && !isSaving;

  return (
    <section className="settings-section card animate-slide-up project-style-runtime-card">
      <div className="project-style-runtime-card__header">
        <div className="settings-section-header">
          <Sparkles size={20} />
          <div>
            <h2>System Prompt Runtime của truyện</h2>
            <p>
              Rút lõi prompt của truyện thành block <strong>[PROJECT STYLE - BẮT BUỘC]</strong> để AI bám văn phong sớm hơn, không sửa global system prompt.
            </p>
          </div>
        </div>
        <span className={`project-style-runtime-status is-${runtimeStatus.tone}`}>
          {runtimeStatus.label}
        </span>
      </div>

      <div className="project-style-runtime-summary">
        <div>
          <strong>Trạng thái</strong>
          <p>{runtimeStatus.description}</p>
        </div>
        <div>
          <strong>Source hash</strong>
          <code>{displayMeta.source_hash || 'Chưa có'}</code>
        </div>
        <div>
          <strong>Tạo lúc</strong>
          <span>{formatRuntimeDate(displayMeta.generated_at)}</span>
        </div>
      </div>

      <div className="project-style-runtime-rules">
        {PROJECT_STYLE_RUNTIME_SECTIONS.map((section) => (
          <span key={section.number}>{section.number}. {section.label}</span>
        ))}
      </div>

      {previewSourceChanged && (
        <div className="project-style-runtime-note is-warning">
          <AlertCircle size={14} />
          Prompt nguồn đã đổi sau khi tạo preview. Hãy rút lõi lại trước khi lưu block.
        </div>
      )}

      {hasEditableBlock && !editableBlockValid && (
        <div className="project-style-runtime-note is-error">
          <AlertCircle size={14} />
          Block cần đủ 6 mục: Luật cốt lõi, Giọng kể / POV, Nhịp chương, Scene grammar, Cần tránh, QA tự kiểm ngầm.
        </div>
      )}

      <div className="project-style-runtime-actions">
        <button type="button" className="btn btn-primary" onClick={onGenerate} disabled={isGeneratingRuntime || isSaving}>
          {isGeneratingRuntime ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
          Rút lõi vào System Prompt
        </button>
        <button type="button" className="btn btn-secondary" onClick={onSaveBlock} disabled={!canSaveBlock}>
          <Save size={14} />
          Lưu block
        </button>
        <button type="button" className="btn btn-ghost" onClick={onToggleEnabled} disabled={!canToggle}>
          <Power size={14} />
          {runtimeState?.enabled ? 'Tắt block' : 'Bật block'}
        </button>
        <button type="button" className="btn btn-ghost" onClick={onDelete} disabled={!canDelete}>
          <Trash2 size={14} />
          Xóa block
        </button>
      </div>

      {runtimeMessage && (
        <div className={`project-style-runtime-note is-${runtimeMessage.type}`}>
          {runtimeMessage.type === 'error' ? <AlertCircle size={14} /> : <CheckCircle2 size={14} />}
          {runtimeMessage.text}
        </div>
      )}

      <details className="project-style-runtime-preview" open={Boolean(displayBlock || editableBlock)}>
        <summary>
          <Eye size={14} />
          Chỉnh sửa block runtime
        </summary>
        <div className="project-style-runtime-editor">
          <AutoResizeTextarea
            className="textarea project-style-runtime-editor__textarea"
            rows={14}
            value={editableBlock}
            onChange={(event) => onEditableBlockChange(event.target.value)}
            placeholder="Chưa có block runtime. Bạn có thể rút lõi bằng AI hoặc dán block đủ 6 mục vào đây rồi bấm Lưu block."
          />
          {!hasEditableBlock && (
            <p className="project-style-runtime-editor__empty">Chưa có block để chỉnh sửa.</p>
          )}
        </div>
      </details>
    </section>
  );
}

function FinalPromptPreviewCard({
  promptInput,
  promptPayload,
  promptError,
  isBuildingPrompt,
  onPromptInputChange,
  onBuildPrompt,
}) {
  const systemPrompt = promptPayload?.systemPrompt || '';
  const userPrompt = promptPayload?.userContent || '';
  const summary = promptPayload?.summary || {};
  const warnings = promptPayload?.warnings || [];

  return (
    <section className="settings-section card animate-slide-up final-prompt-preview-card">
      <div className="final-prompt-preview__header">
        <div className="settings-section-header">
          <Eye size={20} />
          <div>
            <h2>Prompt cuối cùng khi viết chính</h2>
            <p>
              Dựng request <strong>FREE_PROMPT</strong> giống lệnh viết tự do. Chỉ xem nội dung messages, không gửi AI.
            </p>
          </div>
        </div>
        <button type="button" className="btn btn-primary" onClick={onBuildPrompt} disabled={isBuildingPrompt}>
          {isBuildingPrompt ? <Loader2 size={14} className="animate-spin" /> : <Eye size={14} />}
          Dựng prompt
        </button>
      </div>

      <div className="final-prompt-preview__input-block">
        <label className="form-label" htmlFor="final-free-prompt-input">
          Lệnh viết tự do để thử
        </label>
        <AutoResizeTextarea
          id="final-free-prompt-input"
          className="textarea final-prompt-preview__input"
          rows={4}
          value={promptInput}
          onChange={(event) => onPromptInputChange(event.target.value)}
          placeholder="Nhập lệnh viết chính bạn muốn kiểm tra..."
        />
      </div>

      {promptError && (
        <div className="project-style-runtime-note is-error">
          <AlertCircle size={14} />
          {promptError}
        </div>
      )}

      {warnings.length > 0 && (
        <div className="project-style-runtime-note is-warning">
          <AlertCircle size={14} />
          {warnings.join(' ')}
        </div>
      )}

      {promptPayload && (
        <div className="final-prompt-preview__stats">
          <span>{summary.messageCount || 0} messages</span>
          <span>{Number(summary.systemChars || systemPrompt.length).toLocaleString('vi-VN')} ký tự system</span>
          <span>{Number(summary.userChars || userPrompt.length).toLocaleString('vi-VN')} ký tự prompt thường</span>
          <span>{summary.hasProjectStyleRuntime ? 'Có runtime block' : 'Không có runtime block'}</span>
        </div>
      )}

      <div className="final-prompt-preview__outputs">
        <section className="final-prompt-preview__panel">
          <div className="final-prompt-preview__panel-header">
            <strong>System prompt cuối cùng</strong>
            <span>messages[0] role system</span>
          </div>
          <AutoResizeTextarea
            className="textarea final-prompt-preview__textarea is-readonly"
            rows={14}
            value={systemPrompt}
            readOnly
            placeholder="Bấm Dựng prompt để xem system prompt cuối cùng."
          />
        </section>

        <section className="final-prompt-preview__panel">
          <div className="final-prompt-preview__panel-header">
            <strong>Prompt thường cuối cùng</strong>
            <span>messages[1] role user</span>
          </div>
          <AutoResizeTextarea
            className="textarea final-prompt-preview__textarea is-readonly"
            rows={14}
            value={userPrompt}
            readOnly
            placeholder="Bấm Dựng prompt để xem prompt thường cuối cùng."
          />
        </section>
      </div>
    </section>
  );
}

function getPromptScopeNote(itemKey) {
  if (itemKey === TASK_TYPES.CONTINUITY_CHECK) {
    return {
      label: 'Phạm vi kiểm tra',
      text: 'Audit rộng continuity: canon, timeline, current_status, quan hệ, vật phẩm, world rules và logic nhân vật.',
    };
  }

  if (itemKey === TASK_TYPES.CHECK_CONFLICT) {
    return {
      label: 'Phạm vi kiểm tra',
      text: 'Chỉ tập trung vào mâu thuẫn canon rõ ràng, tránh biến thành kiểm tra rộng mọi lỗi nhỏ.',
    };
  }

  return null;
}

function PromptInfoGrid({ item }) {
  const scopeNote = getPromptScopeNote(item.key);

  return (
    <div className="prompt-card__info-grid">
      <div className="prompt-card__info-box">
        <strong>Dùng để làm gì</strong>
        <p>{item.purpose}</p>
      </div>
      {item.whenToEdit && (
        <div className="prompt-card__info-box">
          <strong>Khi nào sửa</strong>
          <p>{item.whenToEdit}</p>
        </div>
      )}
      {scopeNote && (
        <div className="prompt-card__info-box is-scope">
          <strong>{scopeNote.label}</strong>
          <p>{scopeNote.text}</p>
        </div>
      )}
    </div>
  );
}

const PromptEditorCard = memo(function PromptEditorCard({
  item,
  genreKey,
  coreDraft,
  overrideDraft,
  coreEditable,
  onCoreChange,
  onOverrideChange,
  onResetCore,
  onApplyCore,
  onClearOverride,
  onToggleCoreEditable,
}) {
  const protection = getTaskInstructionProtection(item.key);
  const hasOverride = item.type === 'list'
    ? parseListText(overrideDraft).length > 0
    : String(overrideDraft || '').trim().length > 0;

  const effectiveLabel = hasOverride ? 'Override của truyện đang có hiệu lực' : 'Core Defaults đang có hiệu lực';
  const coreHelp = item.key === 'ai_guidelines'
    ? 'Đây là chỉ dẫn nền riêng của truyện này. Mặc định để trống và chỉ cần điền khi bạn muốn thêm định hướng mềm cho AI.'
    : item.key === 'nsfw_system_prompt'
    ? 'Đây là prompt gốc của khối NSFW. Nếu không có override, hệ thống dùng prompt gốc này.'
    : item.key === 'nsfw_rules'
      ? 'Đây là vùng soạn rule bổ sung để tham chiếu. Rule bổ sung không thay thế prompt gốc NSFW.'
      : 'Bản mẫu gốc để tham chiếu và chỉnh thử tại chỗ. Không lưu riêng vào project.';
  const overrideHelp = item.key === 'ai_guidelines'
    ? 'Nếu nhập ở đây, chỉ dẫn này sẽ được lưu trực tiếp vào trường ai_guidelines của project hiện tại.'
    : item.key === 'nsfw_system_prompt'
    ? 'Nếu nhập ở đây, bạn đang thay thế prompt gốc NSFW của project này.'
    : item.key === 'nsfw_rules'
      ? 'Nếu nhập ở đây, rule sẽ được nối vào sau prompt gốc NSFW của project này.'
      : 'Phần ghi đè thật sự của riêng truyện này. Đây là phần sẽ được lưu vào project.';
  const overridePlaceholder = item.key === 'ai_guidelines'
    ? 'Ví dụ: ưu tiên bi kịch chậm, tránh giảng giải đạo lý, đẩy nặng cảm giác mất mát.'
    : item.key === 'nsfw_rules'
    ? 'Để trống = không thêm rule bổ sung. Nếu có nội dung, hệ thống sẽ nối vào sau prompt gốc NSFW.'
    : item.type === 'list'
      ? 'Mỗi dòng là một mục. Để trống = dùng Core Defaults.'
      : 'Để trống = dùng Core Defaults.';

  return (
    <article className="prompt-card">
      <div className="prompt-card__header">
        <div>
          <h3>{item.label}</h3>
          <p>{item.expectedOutput}</p>
        </div>
        <span className={`prompt-card__badge ${hasOverride ? 'is-override' : 'is-default'}`}>
          {hasOverride ? 'Override' : 'Mặc định'}
        </span>
      </div>

      <div className={`prompt-card__effective ${hasOverride ? 'is-override' : 'is-default'}`}>
        <strong>Prompt đang có hiệu lực</strong>
        <span>{effectiveLabel}</span>
      </div>

      <PromptInfoGrid item={item} />

      <div className="prompt-card__columns">
        <section className="prompt-editor-block">
          <div className="prompt-editor-block__header">
            <div>
              <div className="prompt-editor-block__title-row">
                <strong>Core Defaults</strong>
                <span className="prompt-editor-block__badge is-reference">Bản gốc để tham chiếu</span>
              </div>
              <p>{coreHelp}</p>
            </div>
            <div className="prompt-editor-block__actions">
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => onToggleCoreEditable(item)}>
                {coreEditable ? 'Tắt chỉnh thử' : 'Bật chỉnh thử'}
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => onResetCore(item)}>
                <RefreshCw size={13} /> Khôi phục mặc định
              </button>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => onApplyCore(item)}>
                <Copy size={13} /> Sao chép xuống Override
              </button>
            </div>
          </div>

          <AutoResizeTextarea
            className={`textarea prompt-editor-block__textarea ${coreEditable ? '' : 'is-readonly'}`}
            rows={item.type === 'list' ? 8 : 12}
            value={coreDraft}
            onChange={(event) => onCoreChange(item, event.target.value)}
            readOnly={!coreEditable}
          />

          {protection && (
            <div className="prompt-editor-block__locked">
              <div className="prompt-editor-block__locked-header">
                <strong>{protection.label}</strong>
                <span>Khóa</span>
              </div>
              <p>{protection.description}</p>
              <pre className="prompt-editor-block__locked-body">{protection.lockedPrompt}</pre>
            </div>
          )}
        </section>

        <section className="prompt-editor-block">
          <div className="prompt-editor-block__header">
            <div>
              <div className="prompt-editor-block__title-row">
                <strong>Project Override</strong>
                <span className={`prompt-editor-block__badge ${hasOverride ? 'is-live' : 'is-idle'}`}>
                  {hasOverride ? 'Đang có hiệu lực' : 'Để trống = dùng mặc định'}
                </span>
              </div>
              <p>{overrideHelp}</p>
            </div>
            <div className="prompt-editor-block__actions">
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => onClearOverride(item)} disabled={!hasOverride}>
                <Trash2 size={13} /> Xóa Override
              </button>
            </div>
          </div>

          <AutoResizeTextarea
            className="textarea prompt-editor-block__textarea"
            rows={item.type === 'list' ? 8 : 12}
            value={overrideDraft}
            onChange={(event) => onOverrideChange(item, event.target.value)}
            placeholder={overridePlaceholder}
          />

          {protection && (
            <details className="prompt-editor-block__preview">
              <summary>Xem prompt cuối cùng</summary>
              <pre className="prompt-editor-block__locked-body">
                {composeTaskInstruction(item.key, overrideDraft || coreDraft)}
              </pre>
            </details>
          )}
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
});

export default function ProjectPromptManager() {
  const confirmAction = useConfirmDialog();
  const { projectId } = useParams();
  const {
    currentProject,
    chapters = [],
    scenes = [],
    activeChapterId,
    activeSceneId,
    loadProject,
    updateProjectSettings,
  } = useProjectStore();
  const { contentMode, setContentMode } = useProjectContentMode();

  const [overrideDraft, setOverrideDraft] = useState({});
  const [coreDrafts, setCoreDrafts] = useState({});
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState(null);
  const [activeGroupKey, setActiveGroupKey] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [editableCoreKeys, setEditableCoreKeys] = useState({});
  const [runtimePreview, setRuntimePreview] = useState(null);
  const [runtimeMessage, setRuntimeMessage] = useState(null);
  const [runtimeBlockDraft, setRuntimeBlockDraft] = useState('');
  const [isGeneratingRuntime, setIsGeneratingRuntime] = useState(false);
  const [finalPromptInput, setFinalPromptInput] = useState('Viết tiếp cảnh này theo đúng canon và văn phong của truyện.');
  const [finalPromptPayload, setFinalPromptPayload] = useState(null);
  const [finalPromptError, setFinalPromptError] = useState('');
  const [isBuildingFinalPrompt, setIsBuildingFinalPrompt] = useState(false);
  const isHydratingRef = useRef(true);
  const lastSavedSignatureRef = useRef('');
  const pendingSavedSignatureRef = useRef('');
  const lastHydratedProjectKeyRef = useRef('');

  useEffect(() => {
    if (!projectId) return;
    if (!currentProject || String(currentProject.id) !== String(projectId)) {
      loadProject(Number(projectId)).catch(() => {});
    }
  }, [currentProject, loadProject, projectId]);

  const genreKey = currentProject?.genre_primary || 'fantasy';

  useEffect(() => {
    if (!currentProject) return;

    const projectContextKey = `${currentProject.id || ''}:${genreKey}`;
    const parsedTemplates = parsePromptTemplates(currentProject.prompt_templates);
    PROJECT_PROMPT_GROUPS.forEach((group) => {
      group.items.forEach((item) => {
        if (typeof parsedTemplates[item.key] === 'string') {
          parsedTemplates[item.key] = stripProtectedTaskInstruction(item.key, parsedTemplates[item.key]);
        }
      });
    });
    if (typeof currentProject.ai_guidelines === 'string') {
      parsedTemplates.ai_guidelines = currentProject.ai_guidelines;
    }
    const savedSignature = getProjectPromptSignature(parsedTemplates);
    const isSameProjectContext = lastHydratedProjectKeyRef.current === projectContextKey;
    const isKnownSavedState = savedSignature === lastSavedSignatureRef.current
      || savedSignature === pendingSavedSignatureRef.current;
    if (isSameProjectContext && isKnownSavedState) {
      return;
    }

    setOverrideDraft(parsedTemplates);
    lastSavedSignatureRef.current = savedSignature;
    pendingSavedSignatureRef.current = '';
    lastHydratedProjectKeyRef.current = projectContextKey;

    const nextCoreDrafts = {};
    PROJECT_PROMPT_GROUPS.forEach((group) => {
      group.items.forEach((item) => {
        nextCoreDrafts[item.key] = buildDefaultValue(item, genreKey);
      });
    });
    setCoreDrafts(nextCoreDrafts);
    setEditableCoreKeys({});
    setSaveMessage(null);
    isHydratingRef.current = true;
    window.setTimeout(() => {
      isHydratingRef.current = false;
    }, 0);
  }, [currentProject, genreKey]);

  const runtimeWritingStyle = currentProject?.writing_style || '';
  const runtimeDraftSource = useMemo(() => {
    const promptTemplates = cleanPromptTemplates(PROJECT_PROMPT_GROUPS, overrideDraft);
    const aiGuidelines = String(overrideDraft.ai_guidelines || '').trim();
    const sourceHash = computeProjectStyleRuntimeSourceHash({
      aiGuidelines,
      promptTemplates,
      genre: genreKey,
      writingStyle: runtimeWritingStyle,
    });

    return {
      promptTemplates,
      aiGuidelines,
      sourceHash,
    };
  }, [overrideDraft, genreKey, runtimeWritingStyle]);

  const savedRuntimeState = useMemo(() => {
    if (!currentProject) {
      return getProjectStyleRuntimeState({ taskType: TASK_TYPES.FREE_PROMPT });
    }

    return getProjectStyleRuntimeState({
      taskType: TASK_TYPES.FREE_PROMPT,
      aiGuidelines: currentProject.ai_guidelines || '',
      promptTemplates: parsePromptTemplates(currentProject.prompt_templates),
      genre: currentProject.genre_primary || genreKey,
      writingStyle: runtimeWritingStyle,
      projectStyleRuntimeBlock: currentProject.project_style_runtime_block || '',
      projectStyleRuntimeEnabled: currentProject.project_style_runtime_enabled,
      projectStyleRuntimeMeta: currentProject.project_style_runtime_meta,
    });
  }, [currentProject, genreKey, runtimeWritingStyle]);

  const promptDraftDirty = getProjectPromptSignature(overrideDraft) !== lastSavedSignatureRef.current;
  const runtimeStatus = useMemo(
    () => getRuntimeStatus(savedRuntimeState, !!runtimePreview?.project_style_runtime_block),
    [savedRuntimeState, runtimePreview],
  );
  const runtimeDisplayBlock = runtimePreview?.project_style_runtime_block || savedRuntimeState.block || '';
  const deferredRuntimeDisplayBlock = useDeferredValue(runtimeDisplayBlock);

  useEffect(() => {
    setRuntimeBlockDraft(runtimeDisplayBlock);
  }, [runtimeDisplayBlock]);

  const filteredGroups = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase();

    return PROJECT_PROMPT_GROUPS
      .filter((group) => activeGroupKey === 'all' || group.key === activeGroupKey)
      .map((group) => {
        if (!normalizedSearch) return group;

        const filteredItems = group.items.filter((item) => {
          const haystack = [
            item.label,
            item.key,
            item.purpose,
          ]
            .filter(Boolean)
            .join(' ')
            .toLowerCase();

          return haystack.includes(normalizedSearch);
        });

        return {
          ...group,
          items: filteredItems,
        };
      })
      .filter((group) => group.items.length > 0);
  }, [activeGroupKey, searchTerm]);

  const handleGroupShortcut = useCallback((groupKey) => {
    setActiveGroupKey(groupKey);

    window.requestAnimationFrame(() => {
      const targetId = groupKey === 'all' ? 'prompt-manager-top' : `prompt-group-${groupKey}`;
      const target = document.getElementById(targetId);
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  }, []);

  const handleCoreChange = useCallback((item, value) => {
    setCoreDrafts((prev) => ({
      ...prev,
      [item.key]: value,
    }));
  }, []);

  const handleOverrideChange = useCallback((item, value) => {
    setOverrideDraft((prev) => ({
      ...prev,
      [item.key]: value,
    }));
    setSaveMessage(null);
  }, []);

  const handleResetCore = useCallback((item) => {
    setCoreDrafts((prev) => ({
      ...prev,
      [item.key]: buildDefaultValue(item, genreKey),
    }));
  }, [genreKey]);

  const handleApplyCore = useCallback((item) => {
    const coreValue = coreDrafts[item.key] || '';
    setOverrideDraft((prev) => ({
      ...prev,
      [item.key]: coreValue,
    }));
    setSaveMessage(null);
  }, [coreDrafts]);

  const handleClearOverride = useCallback((item) => {
    setOverrideDraft((prev) => {
      const next = { ...prev };
      delete next[item.key];
      return next;
    });
    setSaveMessage(null);
  }, []);

  const persistOverrideDraft = async (mode = 'manual') => {
    if (!currentProject) return;

    const isAutoSave = mode === 'auto';
    const cleaned = cleanPromptTemplates(PROJECT_PROMPT_GROUPS, overrideDraft);
    const aiGuidelines = String(overrideDraft.ai_guidelines || '').trim();
    const savedDraft = {
      ...cleaned,
      ai_guidelines: aiGuidelines,
    };
    const savedSignature = getProjectPromptSignature(savedDraft);
    pendingSavedSignatureRef.current = savedSignature;
    if (!isAutoSave) {
      setIsSaving(true);
    }
    try {
      await updateProjectSettings({
        prompt_templates: JSON.stringify(cleaned),
        ai_guidelines: aiGuidelines,
      });
      lastSavedSignatureRef.current = savedSignature;
      pendingSavedSignatureRef.current = '';
      if (!isAutoSave) {
        setSaveMessage({
          type: 'success',
          text: 'Đã lưu Prompt truyện.',
        });
      }
    } catch (error) {
      pendingSavedSignatureRef.current = '';
      setSaveMessage({
        type: 'error',
        text: toVietnameseErrorMessage(error, 'Không thể lưu Prompt truyện.'),
      });
    } finally {
      if (!isAutoSave) {
        setIsSaving(false);
      }
    }
  };

  const handleSave = async () => {
    await persistOverrideDraft('manual');
  };

  const handleGenerateRuntimeBlock = async () => {
    if (!currentProject || isGeneratingRuntime) return;

    setIsGeneratingRuntime(true);
    setRuntimeMessage(null);
    try {
      const result = await generateProjectStyleRuntimeBlock({
        projectTitle: currentProject.title || '',
        genre: genreKey,
        aiGuidelines: runtimeDraftSource.aiGuidelines,
        promptTemplates: runtimeDraftSource.promptTemplates,
        writingStyle: runtimeWritingStyle,
      });

      if (!hasRequiredProjectStyleRuntimeSections(result.project_style_runtime_block)) {
        throw new Error('Block AI trả về thiếu 6 mục bắt buộc.');
      }

      setRuntimePreview(result);
      setRuntimeBlockDraft(result.project_style_runtime_block || '');
      setRuntimeMessage({
        type: 'success',
        text: 'Đã tạo bản xem trước. Kiểm tra nội dung rồi bấm Lưu block để áp dụng cho truyện này.',
      });
    } catch (error) {
      setRuntimeMessage({
        type: 'error',
        text: toVietnameseErrorMessage(error, 'Không thể rút lõi Project Style Runtime.'),
      });
    } finally {
      setIsGeneratingRuntime(false);
    }
  };

  const handleSaveRuntimeBlock = async () => {
    if (!currentProject || isSaving) return;

    const blockToSave = String(runtimeBlockDraft || '').trim();
    if (!blockToSave) {
      setRuntimeMessage({
        type: 'error',
        text: 'Chưa có block runtime để lưu.',
      });
      return;
    }

    if (!hasRequiredProjectStyleRuntimeSections(blockToSave)) {
      setRuntimeMessage({
        type: 'error',
        text: 'Block cần đủ 6 mục bắt buộc trước khi lưu.',
      });
      return;
    }

    if (runtimePreview?.meta?.source_hash && runtimePreview.meta.source_hash !== runtimeDraftSource.sourceHash) {
      setRuntimeMessage({
        type: 'error',
        text: 'Prompt nguồn đã đổi sau khi tạo preview. Hãy rút lõi lại trước khi lưu.',
      });
      return;
    }

    const savedDraft = {
      ...runtimeDraftSource.promptTemplates,
      ai_guidelines: runtimeDraftSource.aiGuidelines,
    };
    const savedSignature = getProjectPromptSignature(savedDraft);
    pendingSavedSignatureRef.current = savedSignature;
    setIsSaving(true);
    setRuntimeMessage(null);
    try {
      await updateProjectSettings({
        prompt_templates: JSON.stringify(runtimeDraftSource.promptTemplates),
        ai_guidelines: runtimeDraftSource.aiGuidelines,
        project_style_runtime_block: blockToSave,
        project_style_runtime_enabled: true,
        project_style_runtime_meta: {
          ...(savedRuntimeState.meta || {}),
          ...(runtimePreview?.meta || {}),
          source_hash: runtimeDraftSource.sourceHash,
          generated_at: runtimePreview?.meta?.generated_at || savedRuntimeState.meta?.generated_at || Date.now(),
          manual_edited_at: Date.now(),
        },
      });

      setOverrideDraft(savedDraft);
      lastSavedSignatureRef.current = savedSignature;
      pendingSavedSignatureRef.current = '';
      setRuntimePreview(null);
      setRuntimeBlockDraft(blockToSave);
      setRuntimeMessage({
        type: 'success',
        text: 'Đã lưu Project Style Runtime. Block sẽ được dùng ngay cho các luồng viết của truyện.',
      });
    } catch (error) {
      pendingSavedSignatureRef.current = '';
      setRuntimeMessage({
        type: 'error',
        text: toVietnameseErrorMessage(error, 'Không thể lưu Project Style Runtime.'),
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleToggleRuntimeEnabled = async () => {
    if (!currentProject || !savedRuntimeState.block || isSaving) return;
    setRuntimeMessage(null);
    setIsSaving(true);
    try {
      await updateProjectSettings({
        project_style_runtime_enabled: !savedRuntimeState.enabled,
      });
      setRuntimeMessage({
        type: 'success',
        text: savedRuntimeState.enabled
          ? 'Đã tắt Project Style Runtime. Runtime quay về logic prompt cũ.'
          : 'Đã bật Project Style Runtime.',
      });
    } catch (error) {
      setRuntimeMessage({
        type: 'error',
        text: toVietnameseErrorMessage(error, 'Không thể đổi trạng thái Project Style Runtime.'),
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteRuntimeBlock = async () => {
    if (!currentProject || !savedRuntimeState.block || isSaving) return;
    const confirmed = await confirmAction({
      title: 'Xóa Project Style Runtime?',
      message: 'Prompt gốc và Project Override vẫn được giữ nguyên.',
      confirmLabel: 'Xóa Runtime',
      danger: true,
    });
    if (!confirmed) return;

    setRuntimeMessage(null);
    setIsSaving(true);
    try {
      await updateProjectSettings({
        project_style_runtime_block: '',
        project_style_runtime_enabled: false,
        project_style_runtime_meta: null,
      });
      setRuntimePreview(null);
      setRuntimeBlockDraft('');
      setRuntimeMessage({
        type: 'success',
        text: 'Đã xóa Project Style Runtime. Truyện sẽ dùng logic prompt cũ.',
      });
    } catch (error) {
      setRuntimeMessage({
        type: 'error',
        text: toVietnameseErrorMessage(error, 'Không thể xóa Project Style Runtime.'),
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleBuildFinalPrompt = async () => {
    if (!currentProject || isBuildingFinalPrompt) return;

    const resolvedChapter = chapters.find((chapter) => String(chapter?.id) === String(activeChapterId))
      || chapters[0]
      || null;
    const resolvedScene = scenes.find((scene) => (
      String(scene?.id) === String(activeSceneId)
      && (!resolvedChapter || String(scene?.chapter_id) === String(resolvedChapter.id))
    ))
      || scenes.find((scene) => resolvedChapter && String(scene?.chapter_id) === String(resolvedChapter.id))
      || scenes[0]
      || null;

    setIsBuildingFinalPrompt(true);
    setFinalPromptError('');
    try {
      const payload = await buildWritingDebugPayload({
        taskId: 'free_prompt',
        project: currentProject,
        chapters,
        scenes,
        chapterId: resolvedChapter?.id || null,
        sceneId: resolvedScene?.id || null,
        userPrompt: finalPromptInput,
      });
      setFinalPromptPayload(payload);
    } catch (error) {
      setFinalPromptError(toVietnameseErrorMessage(error, 'Không thể dựng prompt cuối cùng.'));
    } finally {
      setIsBuildingFinalPrompt(false);
    }
  };

  useEffect(() => {
    if (!currentProject || isHydratingRef.current) return undefined;
    if (!promptDraftDirty) return undefined;

    const timer = window.setTimeout(() => {
      persistOverrideDraft('auto');
    }, 900);

    return () => window.clearTimeout(timer);
  }, [overrideDraft, currentProject, promptDraftDirty]);

  const handleToggleCoreEditable = useCallback((item) => {
    setEditableCoreKeys((prev) => ({
      ...prev,
      [item.key]: !prev[item.key],
    }));
  }, []);

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
    <div className="settings-page prompt-manager-page" id="prompt-manager-top">
      <section className="settings-section card animate-slide-up prompt-manager-content-mode-card">
        <ProjectContentModeControl
          surface="prompt"
          mode={contentMode}
          onChange={setContentMode}
        />
      </section>

      <section className="settings-section card animate-slide-up prompt-manager-toolbar-card">
        <div className="prompt-toolbar">
          <div className="prompt-toolbar__search">
            <label className="form-label" htmlFor="project-prompt-search">Tìm prompt</label>
            <input
              id="project-prompt-search"
              className="input"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Tìm theo tên prompt hoặc mục đích sử dụng..."
            />
          </div>

          <div className="prompt-toolbar__groups">
            <span className="prompt-toolbar__label">Đi tới nhóm</span>
            <div className="prompt-toolbar__chips">
              <button
                type="button"
                className={`prompt-toolbar__chip ${activeGroupKey === 'all' ? 'is-active' : ''}`}
                onClick={() => handleGroupShortcut('all')}
              >
                Tất cả
              </button>
              {PROJECT_PROMPT_GROUPS.map((group) => (
                <button
                  key={group.key}
                  type="button"
                  className={`prompt-toolbar__chip ${activeGroupKey === group.key ? 'is-active' : ''}`}
                  onClick={() => handleGroupShortcut(group.key)}
                >
                  {group.title}
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

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
          <div className="prompt-manager-intro__box">
            <strong>Runtime block</strong>
            <p>Rút lõi văn phong thành block riêng của truyện, có thể chỉnh tay rồi lưu lại.</p>
          </div>
        </div>

        <div
          className={`prompt-manager-status ${
            saveMessage
              ? saveMessage.type === 'success'
                ? 'is-success'
                : saveMessage.type === 'pending'
                  ? 'is-pending'
                  : 'is-error'
              : 'is-empty'
          }`}
          aria-live="polite"
          aria-hidden={saveMessage ? undefined : true}
        >
          {saveMessage && (
            <>
              {saveMessage.type === 'success'
                ? <CheckCircle2 size={14} />
                : saveMessage.type === 'pending'
                  ? <RefreshCw size={14} className="animate-spin" />
                  : <AlertCircle size={14} />}
              {saveMessage.text}
            </>
          )}
        </div>
      </section>

      <ProjectStyleRuntimeCard
        runtimeState={savedRuntimeState}
        runtimeStatus={runtimeStatus}
        draftSourceHash={runtimeDraftSource.sourceHash}
        displayBlock={deferredRuntimeDisplayBlock}
        runtimePreview={runtimePreview}
        runtimeMessage={runtimeMessage}
        editableBlock={runtimeBlockDraft}
        isGeneratingRuntime={isGeneratingRuntime}
        isSaving={isSaving}
        onGenerate={handleGenerateRuntimeBlock}
        onEditableBlockChange={setRuntimeBlockDraft}
        onSaveBlock={handleSaveRuntimeBlock}
        onToggleEnabled={handleToggleRuntimeEnabled}
        onDelete={handleDeleteRuntimeBlock}
      />

      {SHOW_FINAL_PROMPT_PREVIEW && (
        <FinalPromptPreviewCard
          promptInput={finalPromptInput}
          promptPayload={finalPromptPayload}
          promptError={finalPromptError}
          isBuildingPrompt={isBuildingFinalPrompt}
          onPromptInputChange={setFinalPromptInput}
          onBuildPrompt={handleBuildFinalPrompt}
        />
      )}

      <div className="settings-sections">
        {filteredGroups.map((group, groupIndex) => (
          <section
            key={group.key}
            id={`prompt-group-${group.key}`}
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
                  coreEditable={!!editableCoreKeys[item.key]}
                  onCoreChange={handleCoreChange}
                  onOverrideChange={handleOverrideChange}
                  onResetCore={handleResetCore}
                  onApplyCore={handleApplyCore}
                  onClearOverride={handleClearOverride}
                  onToggleCoreEditable={handleToggleCoreEditable}
                />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
