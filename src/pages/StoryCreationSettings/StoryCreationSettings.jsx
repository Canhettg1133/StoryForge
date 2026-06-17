import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  BookMarked,
  Sparkles,
  Shield,
  MessageSquare,
  Save,
  RotateCcw,
  Info,
  CheckCircle2,
} from 'lucide-react';
import '../Settings/Settings.css';
import './StoryCreationSettings.css';
import {
  STORY_CREATION_PROMPT_GROUPS,
  DEFAULT_STORY_CREATION_SETTINGS,
  composeStoryCreationSystemPrompt,
  getStoryCreationSettings,
  getStoryCreationSystemPromptProtection,
  saveStoryCreationSettings,
  resetStoryCreationSettings,
  resetStoryCreationGroup,
} from '../../services/ai/storyCreationSettings';
import { navigateBackOr } from '../../utils/navigation.js';
import { GLOBAL_PROMPT_META } from '../../services/ai/promptManagerMeta';
import AutoResizeTextarea from '../../components/common/AutoResizeTextarea.jsx';

function VariableChips({ variables }) {
  return (
    <div className="story-creation-vars">
      {variables.map((variable) => (
        <code key={variable} className="story-creation-var-chip">
          {'{{' + variable + '}}'}
        </code>
      ))}
    </div>
  );
}

const STORY_CREATION_FLOW_META = {
  writingSystemIdentity: {
    tone: 'runtime',
    label: 'Prompt gốc runtime',
    description: 'Đang được engine viết truyện đọc như lớp system identity nền khi không có override khác.',
  },
  storyBibleSeed: {
    tone: 'active',
    label: 'AI Wizard mới',
    description: 'Đang có hiệu lực ở bước tạo nền truyện. Đây là nơi siết cách chọn entity nền tảng, tránh gom thuật ngữ mẫu hoặc lặp công thức mở đầu của thể loại.',
  },
  chapterOutlinePass: {
    tone: 'active',
    label: 'AI Wizard mới',
    description: 'Đang có hiệu lực ở bước tạo dàn ý. Entity mới bắt buộc phải đi vào proposed_entities để bạn duyệt.',
  },
  projectWizard: {
    tone: 'legacy',
    label: 'Luồng cũ / không dùng trực tiếp bởi AI Wizard mới',
    description: 'Giữ lại để tương thích và tra cứu. AI Wizard hiện tại dùng Story Bible Seed và Chapter Outline Pass thay cho prompt này.',
  },
  outlineGeneration: {
    tone: 'board',
    label: 'Outline Board',
    description: 'Đang dùng trong Bảng dàn ý khi tạo hoặc bổ sung outline cho project đã tồn tại.',
  },
  threadSuggestion: {
    tone: 'board',
    label: 'Outline Board',
    description: 'Đang dùng khi gợi ý thêm tuyến truyện từ synopsis, outline và thread hiện có.',
  },
};

function getStoryCreationFlowMeta(groupKey) {
  return STORY_CREATION_FLOW_META[groupKey] || {
    tone: 'idle',
    label: 'Prompt tổng quát',
    description: 'Prompt này được lưu ở Global Prompts và app sẽ ghép vào đúng luồng gọi AI tương ứng.',
  };
}

export default function StoryCreationSettings() {
  const navigate = useNavigate();
  const location = useLocation();
  const { projectId } = useParams();
  const [draft, setDraft] = useState(() => getStoryCreationSettings());
  const [savedMessage, setSavedMessage] = useState('');
  const [activeGroupKey, setActiveGroupKey] = useState('all');
  const isHydratingRef = useRef(true);
  const lastSavedSignatureRef = useRef(JSON.stringify(getStoryCreationSettings()));
  const scopedProjectId = Number.isFinite(Number(projectId)) ? Number(projectId) : null;

  const previewDefaults = useMemo(() => DEFAULT_STORY_CREATION_SETTINGS, []);
  const visibleGroups = useMemo(
    () => STORY_CREATION_PROMPT_GROUPS.filter((group) => activeGroupKey === 'all' || group.key === activeGroupKey),
    [activeGroupKey],
  );

  const setField = (groupKey, field, value) => {
    setDraft((prev) => ({
      ...prev,
      [groupKey]: {
        ...prev[groupKey],
        [field]: value,
      },
    }));
    setSavedMessage('');
  };

  const showSavedMessage = (message) => {
    setSavedMessage(message);
    window.setTimeout(() => setSavedMessage(''), 2500);
  };

  const handleSave = () => {
    const saved = saveStoryCreationSettings(draft);
    setDraft(saved);
    lastSavedSignatureRef.current = JSON.stringify(saved);
    showSavedMessage('Đã lưu cài đặt tạo truyện.');
  };

  const handleResetAll = () => {
    const reset = resetStoryCreationSettings();
    setDraft(reset);
    lastSavedSignatureRef.current = JSON.stringify(reset);
    showSavedMessage('Đã khôi phục toàn bộ prompt mặc định.');
  };

  const handleResetGroup = (groupKey) => {
    const reset = resetStoryCreationGroup(groupKey);
    setDraft(reset);
    lastSavedSignatureRef.current = JSON.stringify(reset);
    showSavedMessage('Đã khôi phục nhóm prompt này về mặc định.');
  };

  useEffect(() => {
    window.setTimeout(() => {
      isHydratingRef.current = false;
    }, 0);
  }, []);

  useEffect(() => {
    if (isHydratingRef.current) return undefined;
    if (JSON.stringify(draft) === lastSavedSignatureRef.current) return undefined;

    setSavedMessage('Đang tự lưu...');
    const timer = window.setTimeout(() => {
      saveStoryCreationSettings(draft);
      lastSavedSignatureRef.current = JSON.stringify(draft);
      showSavedMessage('Đã tự lưu Global Prompts.');
    }, 900);

    return () => window.clearTimeout(timer);
  }, [draft]);

  const handleBack = () => {
    navigateBackOr(navigate, '/', { location });
  };

  return (
    <div className="settings-page story-creation-page" id="global-prompt-manager-top">
      {!scopedProjectId && (
        <div className="story-creation-page-actions">
          <button type="button" className="btn btn-ghost btn-sm" onClick={handleBack}>
            <ArrowLeft size={14} /> Quay lại
          </button>
        </div>
      )}

      {scopedProjectId && (
        <section className="settings-section card animate-slide-up story-creation-switcher">
          <div className="story-creation-switcher__copy">
            <strong>Đang ở trong dự án</strong>
            <span>Bạn có thể chuyển nhanh giữa Prompt tổng quát và Prompt truyện mà không rời khỏi project.</span>
          </div>
          <div className="story-creation-switcher__actions">
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => navigate(`/project/${scopedProjectId}/prompts`)}>
              <BookMarked size={14} /> Mở Prompt truyện
            </button>
          </div>
        </section>
      )}

      <section className="settings-section card animate-slide-up story-creation-toolbar-card">
        <div className="story-creation-shortcuts">
          <span className="story-creation-shortcuts__label">Đi tới nhóm prompt</span>
          <div className="story-creation-shortcuts__chips">
            <button
              type="button"
              className={`story-creation-shortcuts__chip ${activeGroupKey === 'all' ? 'is-active' : ''}`}
              onClick={() => setActiveGroupKey('all')}
            >
              Tất cả
            </button>
            {STORY_CREATION_PROMPT_GROUPS.map((group) => (
              <button
                key={group.key}
                type="button"
                className={`story-creation-shortcuts__chip ${activeGroupKey === group.key ? 'is-active' : ''}`}
                onClick={() => {
                  setActiveGroupKey(group.key);
                  window.requestAnimationFrame(() => {
                    const target = document.getElementById(`global-prompt-${group.key}`);
                    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  });
                }}
              >
                {GLOBAL_PROMPT_META[group.key]?.title || group.label}
              </button>
            ))}
          </div>
        </div>
      </section>

      <header className="settings-header animate-fade-in">
        <h1 className="settings-title">Prompt tổng quát</h1>
        <p className="settings-subtitle">
          Đây là khu vực quản lý <strong>Global Prompts</strong> cho toàn bộ app, không gắn riêng với một truyện.
        </p>
      </header>

      <div className="settings-sections">
        <section className="settings-section card animate-slide-up story-creation-hero">
          <div className="settings-section-header">
            <Sparkles size={20} />
            <div>
              <h2>Phân biệt Global Prompt và Prompt truyện</h2>
              <p>
                Trang này dành cho các prompt tổng của dự án như khởi tạo truyện, dựng outline ban đầu và gợi ý tuyến truyện.
                Các prompt riêng của từng project nằm ở trang <strong>Prompt truyện</strong>.
              </p>
            </div>
          </div>

          <div className="story-creation-guides">
            <div className="story-creation-guide">
              <Shield size={16} />
              <div>
                <strong>System prompt</strong>
                <p>Dùng để khóa vai trò AI, luật nền và quy tắc xử lý cho từng nhóm tính năng.</p>
              </div>
            </div>
            <div className="story-creation-guide">
              <MessageSquare size={16} />
              <div>
                <strong>Prompt đầu vào</strong>
                <p>Dùng để điều chỉnh dữ liệu và câu lệnh được bơm vào mỗi lần gọi AI.</p>
              </div>
            </div>
            <div className="story-creation-guide story-creation-guide--note">
              <Info size={16} />
              <div>
                <strong>Lưu ý sử dụng</strong>
                <p>Nếu một luồng bắt buộc AI trả JSON, schema sẽ được khóa. Bạn chỉ sửa instruction, app tự ghép lại contract an toàn.</p>
              </div>
            </div>
          </div>

          <div className="story-creation-toolbar">
            <button className="btn btn-primary" onClick={handleSave}>
              <Save size={14} /> Lưu cài đặt
            </button>
            <button className="btn btn-ghost" onClick={handleResetAll}>
              <RotateCcw size={14} /> Khôi phục mặc định
            </button>
            {savedMessage && (
              <span className="story-creation-save-note">
                {savedMessage.includes('Đang')
                  ? <Save size={14} />
                  : <CheckCircle2 size={14} />}
                {savedMessage}
              </span>
            )}
          </div>
        </section>

        {visibleGroups.map((group, index) => {
          const protection = getStoryCreationSystemPromptProtection(group.key);
          const flowMeta = getStoryCreationFlowMeta(group.key);

          return (
            <section
              key={group.key}
              id={`global-prompt-${group.key}`}
              className="settings-section card animate-slide-up"
              style={{ animationDelay: `${80 + index * 60}ms` }}
            >
              <div className="settings-section-header">
                <Sparkles size={20} />
                <div>
                  <div className="story-creation-title-row">
                    <h2>{GLOBAL_PROMPT_META[group.key]?.title || group.label}</h2>
                    <span className={`story-creation-status-badge is-${flowMeta.tone}`}>
                      {flowMeta.label}
                    </span>
                  </div>
                  <p>{GLOBAL_PROMPT_META[group.key]?.summary || group.description}</p>
                </div>
              </div>

              <div className="story-creation-info-grid">
                <div className="story-creation-info-box">
                  <strong>Prompt đang có hiệu lực</strong>
                  <p>{flowMeta.description}</p>
                </div>
                <div className="story-creation-info-box">
                  <strong>Mục tiêu sử dụng</strong>
                  <p>{GLOBAL_PROMPT_META[group.key]?.purpose}</p>
                </div>
                {GLOBAL_PROMPT_META[group.key]?.whenToEdit && (
                  <div className="story-creation-info-box">
                    <strong>Khi nào sửa</strong>
                    <p>{GLOBAL_PROMPT_META[group.key].whenToEdit}</p>
                  </div>
                )}
              </div>

              <div className="story-creation-meta">
                <div>
                  <div className="story-creation-meta-label">Biến dùng được</div>
                  <VariableChips variables={group.variables} />
                </div>
                <button className="btn btn-ghost btn-sm" onClick={() => handleResetGroup(group.key)}>
                  <RotateCcw size={13} /> Reset nhóm này
                </button>
              </div>

              <div className="form-group">
                <label className="form-label">Phần có thể sửa - System prompt</label>
                <div className="story-creation-field-help">
                  {group.systemHelp}
                  <br />
                  <strong>Dùng để làm gì:</strong> khóa vai trò và luật nền của AI cho nhóm tác vụ này.
                  {protection && (
                    <>
                      <br />
                      <strong>JSON contract khóa:</strong> block bên dưới là read-only. App tự ghép lại nó lúc gọi AI.
                    </>
                  )}
                </div>
                <AutoResizeTextarea
                  className="textarea story-creation-textarea"
                  rows={16}
                  value={draft[group.key]?.systemPrompt || ''}
                  onChange={(e) => setField(group.key, 'systemPrompt', e.target.value)}
                />

                {protection && (
                  <div className="story-creation-locked-block">
                    <div className="story-creation-locked-block__header">
                      <strong>{protection.label}</strong>
                      <span>Khóa</span>
                    </div>
                    <p>{protection.description}</p>
                    <pre className="prompt-default-preview__body">
                      {protection.lockedPrompt}
                    </pre>
                  </div>
                )}

                <details className="story-creation-default">
                  <summary>Xem phần editable mặc định</summary>
                  <pre className="prompt-default-preview__body">
                    {previewDefaults[group.key].systemPrompt}
                  </pre>
                </details>
                <details className="story-creation-default">
                  <summary>Xem prompt đang có hiệu lực</summary>
                  <pre className="prompt-default-preview__body">
                    {composeStoryCreationSystemPrompt(group.key, draft[group.key]?.systemPrompt || '')}
                  </pre>
                </details>
              </div>

              {group.showUserPrompt !== false && (
                <div className="form-group">
                  <label className="form-label">Phần có thể sửa - Prompt đầu vào</label>
                  <div className="story-creation-field-help">
                    {group.userHelp}
                    <br />
                    <strong>Dùng để làm gì:</strong> điều chỉnh dữ liệu và câu lệnh được bơm vào từng lần gọi AI.
                  </div>
                  <AutoResizeTextarea
                    className="textarea story-creation-textarea"
                    rows={10}
                    value={draft[group.key]?.userPromptTemplate || ''}
                    onChange={(e) => setField(group.key, 'userPromptTemplate', e.target.value)}
                  />
                  <details className="story-creation-default">
                    <summary>Xem bản mặc định</summary>
                    <pre className="prompt-default-preview__body">
                      {previewDefaults[group.key].userPromptTemplate}
                    </pre>
                  </details>
                </div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
