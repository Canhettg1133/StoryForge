import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
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
  const navigate = useNavigate();
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
    showSavedMessage('Da luu cai dat tao truyen.');
  };

  const handleResetAll = () => {
    const reset = resetStoryCreationSettings();
    setDraft(reset);
    lastSavedSignatureRef.current = JSON.stringify(reset);
    showSavedMessage('Da khoi phuc toan bo prompt mac dinh.');
  };

  const handleResetGroup = (groupKey) => {
    const reset = resetStoryCreationGroup(groupKey);
    setDraft(reset);
    lastSavedSignatureRef.current = JSON.stringify(reset);
    showSavedMessage('Da khoi phuc nhom prompt nay ve mac dinh.');
  };

  useEffect(() => {
    window.setTimeout(() => {
      isHydratingRef.current = false;
    }, 0);
  }, []);

  useEffect(() => {
    if (isHydratingRef.current) return undefined;
    if (JSON.stringify(draft) === lastSavedSignatureRef.current) return undefined;

    setSavedMessage('Dang tu luu...');
    const timer = window.setTimeout(() => {
      saveStoryCreationSettings(draft);
      lastSavedSignatureRef.current = JSON.stringify(draft);
      showSavedMessage('Da tu luu Global Prompts.');
    }, 900);

    return () => window.clearTimeout(timer);
  }, [draft]);

  const handleBack = () => {
    if (window.history.length > 1) {
      navigate(-1);
      return;
    }

    navigate('/');
  };

  return (
    <div className="settings-page" id="global-prompt-manager-top">
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
          <span className="story-creation-shortcuts__label">Di toi nhom prompt</span>
          <div className="story-creation-shortcuts__chips">
            <button
              type="button"
              className={`story-creation-shortcuts__chip ${activeGroupKey === 'all' ? 'is-active' : ''}`}
              onClick={() => setActiveGroupKey('all')}
            >
              Tat ca
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
        <h1 className="settings-title">Quan ly Prompt</h1>
        <p className="settings-subtitle">
          Day la khu vuc quan ly <strong>Global Prompts</strong> cho toan bo app, khong gan rieng voi mot truyen.
        </p>
      </header>

      <div className="settings-sections">
        <section className="settings-section card animate-slide-up story-creation-hero">
          <div className="settings-section-header">
            <Sparkles size={20} />
            <div>
              <h2>Phan biet Global Prompt va Prompt truyen</h2>
              <p>
                Trang nay danh cho cac prompt tong cua du an nhu khoi tao truyen, dung outline ban dau va goi y tuyen truyen.
                Cac prompt rieng cua tung project nam o trang <strong>Prompt truyen</strong>.
              </p>
            </div>
          </div>

          <div className="story-creation-guides">
            <div className="story-creation-guide">
              <Shield size={16} />
              <div>
                <strong>System prompt</strong>
                <p>Dung de khoa vai tro AI, luat nen va quy tac xu ly cho tung nhom tinh nang.</p>
              </div>
            </div>
            <div className="story-creation-guide">
              <MessageSquare size={16} />
              <div>
                <strong>Prompt dau vao</strong>
                <p>Dung de dieu chinh du lieu va cau lenh duoc bom vao moi lan goi AI.</p>
              </div>
            </div>
            <div className="story-creation-guide story-creation-guide--note">
              <Info size={16} />
              <div>
                <strong>Luu y su dung</strong>
                <p>Neu mot luong bat buoc AI tra JSON, schema se duoc khoa. Ban chi sua instruction, app tu ghep lai contract an toan.</p>
              </div>
            </div>
          </div>

          <div className="story-creation-toolbar">
            <button className="btn btn-primary" onClick={handleSave}>
              <Save size={14} /> Luu cai dat
            </button>
            <button className="btn btn-ghost" onClick={handleResetAll}>
              <RotateCcw size={14} /> Khoi phuc mac dinh
            </button>
            {savedMessage && (
              <span className="story-creation-save-note">
                {savedMessage.includes('Dang')
                  ? <Save size={14} />
                  : <CheckCircle2 size={14} />}
                {savedMessage}
              </span>
            )}
          </div>
        </section>

        {visibleGroups.map((group, index) => {
          const protection = getStoryCreationSystemPromptProtection(group.key);

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
                  <h2>{GLOBAL_PROMPT_META[group.key]?.title || group.label}</h2>
                  <p>{GLOBAL_PROMPT_META[group.key]?.summary || group.description}</p>
                </div>
              </div>

              <div className="story-creation-info-grid">
                <div className="story-creation-info-box">
                  <strong>Muc tieu su dung</strong>
                  <p>{GLOBAL_PROMPT_META[group.key]?.purpose}</p>
                </div>
              </div>

              <div className="story-creation-meta">
                <div>
                  <div className="story-creation-meta-label">Bien dung duoc</div>
                  <VariableChips variables={group.variables} />
                </div>
                <button className="btn btn-ghost btn-sm" onClick={() => handleResetGroup(group.key)}>
                  <RotateCcw size={13} /> Reset nhom nay
                </button>
              </div>

              <div className="form-group">
                <label className="form-label">System prompt</label>
                <div className="story-creation-field-help">
                  {group.systemHelp}
                  <br />
                  <strong>Dung de lam gi:</strong> khoa vai tro va luat nen cua AI cho nhom tac vu nay.
                  {protection && (
                    <>
                      <br />
                      <strong>Luu y:</strong> Block JSON contract ben duoi la read-only. App tu ghep lai no luc goi AI.
                    </>
                  )}
                </div>
                <textarea
                  className="textarea story-creation-textarea"
                  rows={16}
                  value={draft[group.key]?.systemPrompt || ''}
                  onChange={(e) => setField(group.key, 'systemPrompt', e.target.value)}
                />

                {protection && (
                  <div className="story-creation-locked-block">
                    <div className="story-creation-locked-block__header">
                      <strong>{protection.label}</strong>
                      <span>Read-only</span>
                    </div>
                    <p>{protection.description}</p>
                    <pre className="prompt-default-preview__body">
                      {protection.lockedPrompt}
                    </pre>
                  </div>
                )}

                <details className="story-creation-default">
                  <summary>Xem phan editable mac dinh</summary>
                  <pre className="prompt-default-preview__body">
                    {previewDefaults[group.key].systemPrompt}
                  </pre>
                </details>
                <details className="story-creation-default">
                  <summary>Xem system prompt cuoi cung</summary>
                  <pre className="prompt-default-preview__body">
                    {composeStoryCreationSystemPrompt(group.key, draft[group.key]?.systemPrompt || '')}
                  </pre>
                </details>
              </div>

              {group.showUserPrompt !== false && (
                <div className="form-group">
                  <label className="form-label">Prompt dau vao</label>
                  <div className="story-creation-field-help">
                    {group.userHelp}
                    <br />
                    <strong>Dung de lam gi:</strong> dieu chinh du lieu va cau lenh duoc bom vao tung lan goi AI.
                  </div>
                  <textarea
                    className="textarea story-creation-textarea"
                    rows={10}
                    value={draft[group.key]?.userPromptTemplate || ''}
                    onChange={(e) => setField(group.key, 'userPromptTemplate', e.target.value)}
                  />
                  <details className="story-creation-default">
                    <summary>Xem ban mac dinh</summary>
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
