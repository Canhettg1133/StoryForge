import React, { useMemo, useState } from 'react';
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

  const previewDefaults = useMemo(() => DEFAULT_STORY_CREATION_SETTINGS, []);

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
    showSavedMessage('Đã lưu cài đặt tạo truyện.');
  };

  const handleResetAll = () => {
    const reset = resetStoryCreationSettings();
    setDraft(reset);
    showSavedMessage('Đã khôi phục toàn bộ prompt mặc định.');
  };

  const handleResetGroup = (groupKey) => {
    const reset = resetStoryCreationGroup(groupKey);
    setDraft(reset);
    showSavedMessage('Đã khôi phục nhóm prompt này về mặc định.');
  };

  return (
    <div className="settings-page">
      <header className="settings-header animate-fade-in">
        <h1 className="settings-title">Cài đặt khi tạo truyện</h1>
        <p className="settings-subtitle">
          Chỉnh các prompt dùng cho AI Wizard, tạo outline ban đầu và gợi ý tuyến truyện.
        </p>
      </header>

      <div className="settings-sections">
        <section className="settings-section card animate-slide-up story-creation-hero">
          <div className="settings-section-header">
            <Sparkles size={20} />
            <div>
              <h2>Khi nào nên sửa gì?</h2>
              <p>
                Nếu muốn AI nghe lời hơn, ưu tiên sửa <strong>System prompt</strong>. Nếu chỉ muốn thêm ngữ cảnh đầu vào
                hoặc đổi cách ra lệnh cho từng lần tạo, sửa <strong>Prompt thường</strong>.
              </p>
            </div>
          </div>

          <div className="story-creation-guides">
            <div className="story-creation-guide">
              <Shield size={16} />
              <div>
                <strong>System prompt</strong>
                <p>Dùng để khóa vai trò, luật cứng, format JSON, tiêu chí phân loại và mức độ tuân thủ.</p>
              </div>
            </div>
            <div className="story-creation-guide">
              <MessageSquare size={16} />
              <div>
                <strong>Prompt thường</strong>
                <p>Dùng để thay đổi thông tin đầu vào như thể loại, idea, synopsis, hướng phát triển hay câu lệnh cụ thể.</p>
              </div>
            </div>
            <div className="story-creation-guide story-creation-guide--note">
              <Info size={16} />
              <div>
                <strong>Lưu ý</strong>
                <p>Phần tạo truyện giờ đã có system prompt riêng và có thể chỉnh ở đây. Muốn ép AI mạnh hơn thì sửa system prompt trước.</p>
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
                <CheckCircle2 size={14} /> {savedMessage}
              </span>
            )}
          </div>
        </section>

        {STORY_CREATION_PROMPT_GROUPS.map((group, index) => (
          <section
            key={group.key}
            className="settings-section card animate-slide-up"
            style={{ animationDelay: `${80 + index * 60}ms` }}
          >
            <div className="settings-section-header">
              <Sparkles size={20} />
              <div>
                <h2>{group.label}</h2>
                <p>{group.description}</p>
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
              <div className="story-creation-field-help">{group.systemHelp}</div>
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

            <div className="form-group">
              <label className="form-label">Prompt thường</label>
              <div className="story-creation-field-help">{group.userHelp}</div>
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
          </section>
        ))}
      </div>
    </div>
  );
}
