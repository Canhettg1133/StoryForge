import React, { useEffect, useRef, useMemo, useState } from 'react';
import {
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
  getStoryCreationSettings,
  saveStoryCreationSettings,
  resetStoryCreationSettings,
  resetStoryCreationGroup,
} from '../../services/ai/storyCreationSettings';
import { GLOBAL_PROMPT_META } from '../../services/ai/promptManagerMeta';

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

export default function StoryCreationSettings() {
  const [draft, setDraft] = useState(() => getStoryCreationSettings());
  const [savedMessage, setSavedMessage] = useState('');
  const [activeGroupKey, setActiveGroupKey] = useState('all');
  const isHydratingRef = useRef(true);
  const lastSavedSignatureRef = useRef(JSON.stringify(getStoryCreationSettings()));

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

  return (
    <div className="settings-page" id="global-prompt-manager-top">
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
        <h1 className="settings-title">Quản lý Prompt</h1>
        <p className="settings-subtitle">
          Đây là khu vực quản lý <strong>Global Prompts</strong> — các prompt dùng chung cho toàn bộ app, không gắn với riêng một truyện nào.
        </p>
      </header>

      <div className="settings-sections">
        <section className="settings-section card animate-slide-up story-creation-hero">
          <div className="settings-section-header">
            <Sparkles size={20} />
            <div>
              <h2>Phân biệt Global Prompt và Prompt truyện</h2>
              <p>
                Trang này chỉ dành cho các prompt tổng của dự án như khởi tạo truyện, dựng outline ban đầu và gợi ý tuyến truyện.
                Các prompt gắn với một truyện cụ thể sẽ nằm ở trang <strong>Prompt truyện</strong> trong từng project.
              </p>
            </div>
          </div>

          <div className="story-creation-guides">
            <div className="story-creation-guide">
              <Shield size={16} />
              <div>
                <strong>System prompt</strong>
                <p>Dùng để khóa vai trò của AI, luật cứng, format JSON, tiêu chí phân loại và cách AI phải tuân thủ trong từng tính năng.</p>
              </div>
            </div>
            <div className="story-creation-guide">
              <MessageSquare size={16} />
              <div>
                <strong>Prompt đầu vào</strong>
                <p>Dùng để thay đổi dữ liệu truyền vào cho từng lần gọi AI như thể loại, idea, synopsis, hướng phát triển hoặc câu lệnh cụ thể.</p>
              </div>
            </div>
            <div className="story-creation-guide story-creation-guide--note">
              <Info size={16} />
              <div>
                <strong>Lưu ý sử dụng</strong>
                <p>Muốn AI nghe lời hơn, sửa <strong>System prompt</strong> trước. Muốn đổi dữ liệu vào hoặc cách yêu cầu, sửa phần <strong>Prompt đầu vào</strong>.</p>
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

        {visibleGroups.map((group, index) => (
          <section
            key={group.key}
            id={`global-prompt-${group.key}`}
            className="settings-section card animate-slide-up"
            style={{ animationDelay: `${80 + index * 60}ms` }}
          >
            <div className="settings-section-header">
              <Sparkles size={20} />
              <div>
                <h2>{GLOBAL_PROMPT_META[group.key]?.title || group.label}</h2>
                <p>{GLOBAL_PROMPT_META[group.key]?.summary || group.description}</p>
              </div>
            </div>

            <div className="story-creation-info-grid">
              <div className="story-creation-info-box">
                <strong>Mục tiêu sử dụng</strong>
                <p>{GLOBAL_PROMPT_META[group.key]?.purpose}</p>
              </div>
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
              <label className="form-label">System prompt</label>
              <div className="story-creation-field-help">
                {group.systemHelp}
                <br />
                <strong>Dùng để làm gì:</strong> khóa vai trò và luật nền của AI cho nhóm tác vụ này.
              </div>
              <textarea
                className="textarea story-creation-textarea"
                rows={16}
                value={draft[group.key]?.systemPrompt || ''}
                onChange={(e) => setField(group.key, 'systemPrompt', e.target.value)}
              />
              <details className="story-creation-default">
                <summary>Xem bản mặc định</summary>
                <pre className="prompt-default-preview__body">
                  {previewDefaults[group.key].systemPrompt}
                </pre>
              </details>
            </div>

            {group.showUserPrompt !== false && (
              <div className="form-group">
                <label className="form-label">Prompt đầu vào</label>
                <div className="story-creation-field-help">
                  {group.userHelp}
                  <br />
                  <strong>Dùng để làm gì:</strong> điều chỉnh dữ liệu và câu lệnh được bơm vào từng lần gọi AI.
                </div>
                <textarea
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
        ))}
      </div>
    </div>
  );
}
