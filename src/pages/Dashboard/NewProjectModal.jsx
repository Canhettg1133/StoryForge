import React, { useState, useMemo } from 'react';
import useProjectStore from '../../stores/projectStore';
import {
  GENRES, TONES, POV_MODES, STORY_STRUCTURES,
  PRONOUN_STYLE_PRESETS, GENRE_TO_PRONOUN_STYLE,
} from '../../utils/constants';
import { X, Sparkles, PenTool, Eye, BookOpen, MessageSquare } from 'lucide-react';
import ProjectWizard from './ProjectWizard';

export default function NewProjectModal({ onClose, onCreated }) {
  const { createProject } = useProjectStore();
  const [mode, setMode] = useState(null); // null = choose, 'manual' = form, 'ai' = wizard
  const [form, setForm] = useState({
    title: '',
    genre_primary: 'fantasy',
    tone: '',
    audience: '',
    description: '',
    // New fields
    pov_mode: 'third_limited',
    pronoun_style: '',
    synopsis: '',
    story_structure: '',
  });
  const [creating, setCreating] = useState(false);

  const handleChange = (field, value) => {
    setForm(prev => {
      const next = { ...prev, [field]: value };
      // Auto-update pronoun style when genre changes
      if (field === 'genre_primary') {
        next.pronoun_style = GENRE_TO_PRONOUN_STYLE[value] || 'hien_dai';
      }
      return next;
    });
  };

  // Get pronoun preset info for display
  const pronounPreset = useMemo(() =>
    PRONOUN_STYLE_PRESETS.find(p => p.value === (form.pronoun_style || GENRE_TO_PRONOUN_STYLE[form.genre_primary] || 'hien_dai'))
  , [form.pronoun_style, form.genre_primary]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.title.trim()) return;
    setCreating(true);
    try {
      const id = await createProject({
        ...form,
        pronoun_style: form.pronoun_style || GENRE_TO_PRONOUN_STYLE[form.genre_primary] || 'hien_dai',
      });
      onCreated(id);
    } catch (err) {
      console.error('Failed to create project:', err);
      setCreating(false);
    }
  };

  // AI Wizard mode
  if (mode === 'ai') {
    return <ProjectWizard onClose={onClose} onCreated={onCreated} />;
  }

  // Choose mode
  if (mode === null) {
    return (
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal animate-scale-up" onClick={(e) => e.stopPropagation()}>
          <div className="modal-header">
            <h2 className="modal-title">
              <Sparkles size={20} style={{ color: 'var(--color-accent)' }} />
              {' '}Tạo truyện mới
            </h2>
            <button className="btn btn-ghost btn-icon btn-sm" onClick={onClose}>
              <X size={18} />
            </button>
          </div>

          <div style={{ padding: 'var(--space-5)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            <p style={{ color: 'var(--color-text-secondary)', fontSize: '14px', margin: 0 }}>Chọn cách tạo dự án:</p>

            <button
              className="wizard-choice-btn wizard-choice-btn--ai"
              onClick={() => setMode('ai')}
            >
              <div className="wizard-choice-icon"><Sparkles size={24} /></div>
              <div className="wizard-choice-text">
                <strong>✨ Tạo bằng AI</strong>
                <span>Nhập ý tưởng → AI sinh nhân vật, thế giới, outline chương</span>
              </div>
            </button>

            <button
              className="wizard-choice-btn"
              onClick={() => setMode('manual')}
            >
              <div className="wizard-choice-icon"><PenTool size={24} /></div>
              <div className="wizard-choice-text">
                <strong>📝 Tạo thủ công</strong>
                <span>Thiết lập chi tiết và bắt đầu viết ngay</span>
              </div>
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Manual mode (expanded form)
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal--lg animate-scale-up" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '620px' }}>
        <div className="modal-header">
          <h2 className="modal-title">
            <PenTool size={20} style={{ color: 'var(--color-accent)' }} />
            {' '}Tạo truyện thủ công
          </h2>
          <button className="btn btn-ghost btn-icon btn-sm" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', padding: '0 var(--space-5) var(--space-5)', maxHeight: '70vh', overflowY: 'auto' }}>

          {/* Row 1: Title */}
          <div className="form-group">
            <label className="form-label">Tên truyện *</label>
            <input
              className="input"
              placeholder="Ví dụ: Nguyệt Kinh Truyền Kỳ"
              value={form.title}
              onChange={(e) => handleChange('title', e.target.value)}
              autoFocus
            />
          </div>

          {/* Row 2: Genre + Tone */}
          <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
            <div className="form-group" style={{ flex: 1 }}>
              <label className="form-label">Thể loại chính</label>
              <select
                className="select"
                value={form.genre_primary}
                onChange={(e) => handleChange('genre_primary', e.target.value)}
              >
                {GENRES.map(g => (
                  <option key={g.value} value={g.value}>{g.emoji} {g.label}</option>
                ))}
              </select>
            </div>
            <div className="form-group" style={{ flex: 1 }}>
              <label className="form-label">Tone / Phong cách</label>
              <select
                className="select"
                value={form.tone}
                onChange={(e) => handleChange('tone', e.target.value)}
              >
                <option value="">Chọn tone...</option>
                {TONES.map(t => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Row 3: POV + Xưng hô */}
          <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
            <div className="form-group" style={{ flex: 1 }}>
              <label className="form-label"><Eye size={13} /> Góc nhìn</label>
              <select
                className="select"
                value={form.pov_mode}
                onChange={(e) => handleChange('pov_mode', e.target.value)}
              >
                {POV_MODES.map(p => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </select>
              <span className="form-hint">{POV_MODES.find(p => p.value === form.pov_mode)?.desc}</span>
            </div>
            <div className="form-group" style={{ flex: 1 }}>
              <label className="form-label"><MessageSquare size={13} /> Hệ thống Xưng hô</label>
              <select
                className="select"
                value={form.pronoun_style || GENRE_TO_PRONOUN_STYLE[form.genre_primary] || 'hien_dai'}
                onChange={(e) => handleChange('pronoun_style', e.target.value)}
              >
                {PRONOUN_STYLE_PRESETS.map(p => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </select>
              {pronounPreset && pronounPreset.value !== 'custom' && (
                <span className="form-hint">
                  Xưng: "{pronounPreset.default_self}" — Gọi: "{pronounPreset.default_other}"
                </span>
              )}
            </div>
          </div>

          {/* Row 4: Story Structure */}
          <div className="form-group">
            <label className="form-label"><BookOpen size={13} /> Cấu trúc truyện</label>
            <select
              className="select"
              value={form.story_structure}
              onChange={(e) => handleChange('story_structure', e.target.value)}
            >
              {STORY_STRUCTURES.map(s => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
            {form.story_structure && (
              <span className="form-hint">
                {STORY_STRUCTURES.find(s => s.value === form.story_structure)?.desc}
              </span>
            )}
          </div>

          {/* Row 5: Synopsis */}
          <div className="form-group">
            <label className="form-label">📖 Cốt truyện chính (Synopsis)</label>
            <textarea
              className="textarea"
              placeholder="Tóm tắt mạch truyện chính... (không bắt buộc — AI dùng để duy trì mạch truyện)"
              value={form.synopsis}
              onChange={(e) => handleChange('synopsis', e.target.value)}
              rows={3}
            />
            <span className="form-hint">AI cần nội dung này để duy trì mạch truyện nhất quán</span>
          </div>

          {/* Row 6: Description */}
          <div className="form-group">
            <label className="form-label">Mô tả ngắn</label>
            <textarea
              className="textarea"
              placeholder="Premise, ý tưởng, hoặc tóm tắt ngắn..."
              value={form.description}
              onChange={(e) => handleChange('description', e.target.value)}
              rows={2}
            />
          </div>

          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={() => setMode(null)}>← Quay lại</button>
            <button type="submit" className="btn btn-primary" disabled={!form.title.trim() || creating}>
              <PenTool size={16} />
              {creating ? 'Đang tạo...' : 'Tạo dự án'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
