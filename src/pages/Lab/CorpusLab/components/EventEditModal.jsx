/**
 * EventEditModal - Edit event details
 */

import { useState } from 'react';

const SEVERITY_OPTIONS = ['crucial', 'major', 'moderate', 'minor'];
const POSITION_OPTIONS = ['start', 'middle', 'end'];
const CANON_FANON_OPTIONS = ['canon', 'fanon'];
const RARITY_OPTIONS = ['rare', 'common_but_good', 'common'];

const POSITION_LABELS = {
  start: 'Đầu',
  middle: 'Giữa',
  end: 'Cuối',
};

const SEVERITY_LABELS = {
  crucial: 'Cốt lõi',
  major: 'Quan trọng',
  moderate: 'Trung bình',
  minor: 'Nhẹ',
};

export default function EventEditModal({ event, onSave, onClose }) {
  const [form, setForm] = useState({
    description: event.description || '',
    severity: event.severity || 'major',
    chapter: event.chapter || 1,
    position: event.position || 'middle',
    canonOrFanon: event.canonOrFanon?.type || 'canon',
    rarity: event.rarity?.score || 'common',
    tags: [...(event.tags || [])],
    characters: [...(event.characters || [])],
    ships: [...(event.ships || [])],
    emotionalIntensity: event.emotionalIntensity || 5,
    insertability: event.insertability || 5,
  });

  const [tagInput, setTagInput] = useState('');
  const [charInput, setCharInput] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave({
        ...event,
        ...form,
        rarity: { score: form.rarity, label: form.rarity },
        canonOrFanon: { type: form.canonOrFanon },
      });
    } finally {
      setSaving(false);
    }
  };

  const addTag = () => {
    const trimmed = tagInput.trim().toLowerCase().replace(/\s+/g, '_');
    if (trimmed && !form.tags.includes(trimmed)) {
      setForm((f) => ({ ...f, tags: [...f.tags, trimmed] }));
    }
    setTagInput('');
  };

  const removeTag = (tag) => {
    setForm((f) => ({ ...f, tags: f.tags.filter((t) => t !== tag) }));
  };

  const addChar = () => {
    const trimmed = charInput.trim();
    if (trimmed && !form.characters.includes(trimmed)) {
      setForm((f) => ({ ...f, characters: [...f.characters, trimmed] }));
    }
    setCharInput('');
  };

  const removeChar = (char) => {
    setForm((f) => ({ ...f, characters: f.characters.filter((c) => c !== char) }));
  };

  return (
    <div className="event-edit-backdrop" onClick={onClose}>
      <div className="event-edit-modal" onClick={(e) => e.stopPropagation()}>
        <div className="event-edit-header">
          <h3>Chỉnh sửa sự kiện</h3>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>

        <div className="event-edit-body">
          {/* Description */}
          <label className="form-group">
            <span>Mô tả</span>
            <textarea
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              rows={3}
            />
          </label>

          {/* Chapter & Position */}
          <div className="form-row">
            <label className="form-group">
              <span>Chương</span>
              <input
                type="number"
                min="1"
                value={form.chapter}
                onChange={(e) => setForm((f) => ({ ...f, chapter: parseInt(e.target.value, 10) || 1 }))}
              />
            </label>
            <label className="form-group">
              <span>Vị trí</span>
              <select
                value={form.position}
                onChange={(e) => setForm((f) => ({ ...f, position: e.target.value }))}
              >
                {POSITION_OPTIONS.map((p) => (
                  <option key={p} value={p}>{POSITION_LABELS[p] || capitalize(p)}</option>
                ))}
              </select>
            </label>
          </div>

          {/* Severity */}
          <label className="form-group">
            <span>Mức độ quan trọng</span>
            <div className="radio-group">
              {SEVERITY_OPTIONS.map((s) => (
                <label key={s} className={`radio-option ${form.severity === s ? 'selected' : ''}`}>
                  <input
                    type="radio"
                    name="severity"
                    value={s}
                    checked={form.severity === s}
                    onChange={() => setForm((f) => ({ ...f, severity: s }))}
                  />
                  {SEVERITY_LABELS[s] || capitalize(s)}
                </label>
              ))}
            </div>
          </label>

          {/* Chính sử/Phi chính sử */}
          <label className="form-group">
            <span>Chính sử / Phi chính sử</span>
            <div className="radio-group">
              {CANON_FANON_OPTIONS.map((cf) => (
                <label key={cf} className={`radio-option ${form.canonOrFanon === cf ? 'selected' : ''}`}>
                  <input
                    type="radio"
                    name="canonFanon"
                    value={cf}
                    checked={form.canonOrFanon === cf}
                    onChange={() => setForm((f) => ({ ...f, canonOrFanon: cf }))}
                  />
                  {cf === 'canon' ? '🔵 Chính sử' : '🟣 Phi chính sử'}
                </label>
              ))}
            </div>
          </label>

          {/* Rarity */}
          <label className="form-group">
            <span>Độ hiếm</span>
            <select
              value={form.rarity}
              onChange={(e) => setForm((f) => ({ ...f, rarity: e.target.value }))}
            >
              {RARITY_OPTIONS.map((r) => (
                <option key={r} value={r}>
                  {r === 'rare' ? '⭐ Hiếm' : r === 'common_but_good' ? '✨ Thường nhưng tốt' : 'Thường'}
                </option>
              ))}
            </select>
          </label>

          {/* Tags */}
          <label className="form-group">
            <span>Tag</span>
            <div className="tag-input-row">
              <input
                type="text"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addTag())}
                placeholder="Thêm tag..."
              />
              <button type="button" onClick={addTag}>Thêm</button>
            </div>
            <div className="tag-list">
              {form.tags.map((tag) => (
                <span key={tag} className="edit-tag">
                  {tag}
                  <button onClick={() => removeTag(tag)}>×</button>
                </span>
              ))}
            </div>
          </label>

          {/* Characters */}
          <label className="form-group">
            <span>Nhân vật</span>
            <div className="tag-input-row">
              <input
                type="text"
                value={charInput}
                onChange={(e) => setCharInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addChar())}
                placeholder="Thêm nhân vật..."
              />
              <button type="button" onClick={addChar}>Thêm</button>
            </div>
            <div className="tag-list">
              {form.characters.map((char) => (
                <span key={char} className="edit-tag char-tag">
                  {char}
                  <button onClick={() => removeChar(char)}>×</button>
                </span>
              ))}
            </div>
          </label>

          {/* Sliders */}
          <div className="form-row">
            <label className="form-group">
              <span>
                Cường độ cảm xúc: <strong>{form.emotionalIntensity}/10</strong>
              </span>
              <input
                type="range"
                min="1"
                max="10"
                value={form.emotionalIntensity}
                onChange={(e) => setForm((f) => ({ ...f, emotionalIntensity: parseInt(e.target.value, 10) }))}
              />
            </label>
            <label className="form-group">
              <span>
                Mức phù hợp để chèn: <strong>{form.insertability}/10</strong>
              </span>
              <input
                type="range"
                min="1"
                max="10"
                value={form.insertability}
                onChange={(e) => setForm((f) => ({ ...f, insertability: parseInt(e.target.value, 10) }))}
              />
            </label>
          </div>
        </div>

        <div className="event-edit-actions">
          <button className="btn-cancel" onClick={onClose}>Hủy</button>
          <button className="btn-save" onClick={handleSave} disabled={saving}>
            {saving ? 'Đang lưu...' : 'Lưu'}
          </button>
        </div>
      </div>
    </div>
  );
}

function capitalize(str) {
  return str ? str.charAt(0).toUpperCase() + str.slice(1) : '';
}
