/**
 * StoryForge - Scene Detail Panel
 *
 * A right-side drawer panel for editing the active scene's metadata:
 * goal, conflict, emotional arc, pacing, must_happen, must_not_happen,
 * and characters_present.
 */

import React, { useEffect, useState } from 'react';
import {
  Heart,
  Plus,
  Save,
  Shield,
  Target,
  Trash2,
  Users,
  X,
  Zap,
} from 'lucide-react';
import './SceneDetailPanel.css';

const PACING_OPTIONS = [
  { value: '', label: '- Chưa chọn -' },
  { value: 'slow', label: 'Slow - Chậm, mô tả' },
  { value: 'medium', label: 'Medium - Cân bằng' },
  { value: 'fast', label: 'Fast - Nhanh, đầy hành động' },
];

export default function SceneDetailPanel({
  scene,
  characters = [],
  onSave,
  onClose,
}) {
  const [form, setForm] = useState({
    goal: '',
    conflict: '',
    emotional_start: '',
    emotional_end: '',
    pacing: '',
    must_happen: [],
    must_not_happen: [],
    characters_present: [],
    must_happen_input: '',
    must_not_happen_input: '',
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!scene) return;

    let mustHappen = [];
    let mustNotHappen = [];
    let charsPresent = [];

    try { mustHappen = JSON.parse(scene.must_happen || '[]'); } catch {}
    try { mustNotHappen = JSON.parse(scene.must_not_happen || '[]'); } catch {}
    try { charsPresent = JSON.parse(scene.characters_present || '[]'); } catch {}

    setForm({
      goal: scene.goal || '',
      conflict: scene.conflict || '',
      emotional_start: scene.emotional_start || '',
      emotional_end: scene.emotional_end || '',
      pacing: scene.pacing || '',
      must_happen: Array.isArray(mustHappen) ? mustHappen : [],
      must_not_happen: Array.isArray(mustNotHappen) ? mustNotHappen : [],
      characters_present: Array.isArray(charsPresent) ? charsPresent : [],
      must_happen_input: '',
      must_not_happen_input: '',
    });
  }, [scene?.id]);

  const selectedCharacterCount = form.characters_present.length;
  const constraintCount = form.must_happen.length + form.must_not_happen.length;

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave({
        goal: form.goal,
        conflict: form.conflict,
        emotional_start: form.emotional_start,
        emotional_end: form.emotional_end,
        pacing: form.pacing,
        must_happen: JSON.stringify(form.must_happen),
        must_not_happen: JSON.stringify(form.must_not_happen),
        characters_present: JSON.stringify(form.characters_present),
      });
    } finally {
      setSaving(false);
    }
  };

  const addMustHappen = () => {
    const value = form.must_happen_input.trim();
    if (!value) return;
    setForm((current) => ({
      ...current,
      must_happen: [...current.must_happen, value],
      must_happen_input: '',
    }));
  };

  const removeMustHappen = (index) => {
    setForm((current) => ({
      ...current,
      must_happen: current.must_happen.filter((_, itemIndex) => itemIndex !== index),
    }));
  };

  const addMustNotHappen = () => {
    const value = form.must_not_happen_input.trim();
    if (!value) return;
    setForm((current) => ({
      ...current,
      must_not_happen: [...current.must_not_happen, value],
      must_not_happen_input: '',
    }));
  };

  const removeMustNotHappen = (index) => {
    setForm((current) => ({
      ...current,
      must_not_happen: current.must_not_happen.filter((_, itemIndex) => itemIndex !== index),
    }));
  };

  const toggleCharacter = (characterId) => {
    setForm((current) => ({
      ...current,
      characters_present: current.characters_present.includes(characterId)
        ? current.characters_present.filter((id) => id !== characterId)
        : [...current.characters_present, characterId],
    }));
  };

  return (
    <>
      <div className="scene-detail-backdrop" onClick={onClose} />

      <aside className="scene-detail-panel" aria-label="Chi tiết cảnh">
        <div className="scene-detail-header">
          <div className="scene-detail-header-copy">
            <div className="scene-detail-kicker">Scene metadata</div>
            <div className="scene-detail-title">
              <Target size={15} />
              <span>Chi tiết cảnh</span>
            </div>
            {scene?.title ? (
              <div className="scene-detail-scene-name">{scene.title}</div>
            ) : null}
            <div className="scene-detail-summary">
              <span className="scene-detail-pill">
                <Users size={12} />
                {selectedCharacterCount} nhân vật
              </span>
              <span className="scene-detail-pill scene-detail-pill--accent">
                <Shield size={12} />
                {constraintCount} ràng buộc
              </span>
            </div>
          </div>

          <div className="scene-detail-actions">
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={handleSave}
              disabled={saving}
            >
              <Save size={13} />
              {saving ? 'Đang lưu...' : 'Lưu'}
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm btn-icon"
              onClick={onClose}
              aria-label="Đóng panel"
            >
              <X size={15} />
            </button>
          </div>
        </div>

        <div className="scene-detail-body">
          <section className="scene-detail-section">
            <div className="scene-detail-section-head">
              <div>
                <div className="scene-detail-section-title">Mạch cảnh</div>
                <p className="scene-detail-section-note">
                  Ghi mục tiêu và lực cản chính của cảnh này.
                </p>
              </div>
            </div>

            <div className="scene-detail-field">
              <label className="scene-detail-label">
                <Target size={13} />
                Mục tiêu cảnh
              </label>
              <textarea
                className="scene-detail-textarea"
                rows={3}
                placeholder="Cảnh này cần đạt điều gì? Ví dụ: nhân vật tìm ra manh mối hoặc bị buộc đổi kế hoạch."
                value={form.goal}
                onChange={(event) => setForm((current) => ({ ...current, goal: event.target.value }))}
              />
            </div>

            <div className="scene-detail-field">
              <label className="scene-detail-label">
                <Shield size={13} />
                Xung đột
              </label>
              <textarea
                className="scene-detail-textarea"
                rows={3}
                placeholder="Điều gì đang cản trở cảnh? Ví dụ: truy đuổi, áp lực thời gian, mâu thuẫn nội tâm."
                value={form.conflict}
                onChange={(event) => setForm((current) => ({ ...current, conflict: event.target.value }))}
              />
            </div>
          </section>

          <section className="scene-detail-section">
            <div className="scene-detail-section-head">
              <div>
                <div className="scene-detail-section-title">Cung cảm xúc</div>
                <p className="scene-detail-section-note">
                  Theo dõi trạng thái cảm xúc trước và sau khi cảnh kết thúc.
                </p>
              </div>
            </div>

            <div className="scene-detail-field-row">
              <div className="scene-detail-field">
                <label className="scene-detail-label">
                  <Heart size={13} />
                  Cảm xúc bắt đầu
                </label>
                <textarea
                  className="scene-detail-textarea"
                  rows={3}
                  placeholder="Nhân vật bước vào cảnh với tâm thế như thế nào?"
                  value={form.emotional_start}
                  onChange={(event) => setForm((current) => ({ ...current, emotional_start: event.target.value }))}
                />
              </div>

              <div className="scene-detail-field">
                <label className="scene-detail-label">
                  <Heart size={13} />
                  Cảm xúc kết thúc
                </label>
                <textarea
                  className="scene-detail-textarea"
                  rows={3}
                  placeholder="Khi cảnh khép lại, cảm xúc thay đổi ra sao?"
                  value={form.emotional_end}
                  onChange={(event) => setForm((current) => ({ ...current, emotional_end: event.target.value }))}
                />
              </div>
            </div>
          </section>

          <section className="scene-detail-section">
            <div className="scene-detail-section-head">
              <div>
                <div className="scene-detail-section-title">Nhịp và nhân vật</div>
                <p className="scene-detail-section-note">
                  Chọn tốc độ kể chuyện và danh sách nhân vật xuất hiện trong cảnh.
                </p>
              </div>
            </div>

            <div className="scene-detail-field">
              <label className="scene-detail-label">
                <Zap size={13} />
                Nhịp độ
              </label>
              <select
                className="scene-detail-select"
                value={form.pacing}
                onChange={(event) => setForm((current) => ({ ...current, pacing: event.target.value }))}
              >
                {PACING_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </div>

            {characters.length > 0 ? (
              <div className="scene-detail-field">
                <label className="scene-detail-label">
                  <Users size={13} />
                  Nhân vật có mặt
                </label>
                <div className="scene-detail-char-list">
                  {characters.map((character) => {
                    const isActive = form.characters_present.includes(character.id);
                    return (
                      <label
                        key={character.id}
                        className={`scene-detail-char-item ${isActive ? 'scene-detail-char-item--active' : ''}`}
                      >
                        <input
                          type="checkbox"
                          checked={isActive}
                          onChange={() => toggleCharacter(character.id)}
                        />
                        <span className="scene-detail-char-name">{character.name}</span>
                        {character.role ? (
                          <span className="scene-detail-char-role">{character.role}</span>
                        ) : null}
                      </label>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </section>

          <section className="scene-detail-section">
            <div className="scene-detail-section-head">
              <div>
                <div className="scene-detail-section-title">Ràng buộc cảnh</div>
                <p className="scene-detail-section-note">
                  Định nghĩa những điểm bắt buộc để continuity và AI không đi lệch.
                </p>
              </div>
            </div>

            <div className="scene-detail-field">
              <label className="scene-detail-label">
                <Plus size={13} />
                Phải xảy ra
              </label>
              <div className="scene-detail-tag-list">
                {form.must_happen.map((item, index) => (
                  <div key={`${item}-${index}`} className="scene-detail-tag scene-detail-tag--danger">
                    <span>{item}</span>
                    <button
                      type="button"
                      className="scene-detail-tag-remove"
                      onClick={() => removeMustHappen(index)}
                    >
                      <X size={10} />
                    </button>
                  </div>
                ))}
              </div>
              <div className="scene-detail-tag-input">
                <input
                  type="text"
                  placeholder="Ví dụ: nhân vật phải lộ sơ hở hoặc tìm ra một bằng chứng."
                  value={form.must_happen_input}
                  onChange={(event) => setForm((current) => ({ ...current, must_happen_input: event.target.value }))}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      addMustHappen();
                    }
                  }}
                />
                <button type="button" className="btn btn-ghost btn-sm" onClick={addMustHappen}>
                  <Plus size={12} />
                  Thêm
                </button>
              </div>
            </div>

            <div className="scene-detail-field">
              <label className="scene-detail-label">
                <Trash2 size={13} />
                Không được xảy ra
              </label>
              <div className="scene-detail-tag-list">
                {form.must_not_happen.map((item, index) => (
                  <div key={`${item}-${index}`} className="scene-detail-tag scene-detail-tag--warn">
                    <span>{item}</span>
                    <button
                      type="button"
                      className="scene-detail-tag-remove"
                      onClick={() => removeMustNotHappen(index)}
                    >
                      <X size={10} />
                    </button>
                  </div>
                ))}
              </div>
              <div className="scene-detail-tag-input">
                <input
                  type="text"
                  placeholder="Ví dụ: chưa được tiết lộ hung thủ hoặc nhân vật chính không thể rời khỏi thành phố."
                  value={form.must_not_happen_input}
                  onChange={(event) => setForm((current) => ({ ...current, must_not_happen_input: event.target.value }))}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      addMustNotHappen();
                    }
                  }}
                />
                <button type="button" className="btn btn-ghost btn-sm" onClick={addMustNotHappen}>
                  <Plus size={12} />
                  Thêm
                </button>
              </div>
            </div>
          </section>
        </div>
      </aside>
    </>
  );
}
