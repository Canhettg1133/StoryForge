/**
 * AnnotationEditor - Add/edit notes on events
 */

import { useState } from 'react';

const TEMPLATES = [
  { label: 'Ý tưởng cho arc...', value: 'Ý tưởng cho ' },
  { label: 'Nguồn cảm hứng từ...', value: 'Nguồn cảm hứng từ ' },
  { label: 'Tránh vì...', value: 'Tránh vì ' },
  { label: 'Tương tự với...', value: 'Tương tự với ' },
];

const SEVERITY_LABELS = {
  crucial: 'Cốt lõi',
  major: 'Quan trọng',
  moderate: 'Trung bình',
  minor: 'Nhẹ',
};

export default function AnnotationEditor({ event, onSave, onCancel }) {
  const existing = event.annotation || {};
  const canonLabel = event.canonOrFanon?.type === 'fanon' ? 'Phi chính sử' : 'Chính sử';

  const [annotation, setAnnotation] = useState({
    note: existing.note || '',
    customTags: existing.customTags || [],
    starred: existing.starred || false,
    linkedProjectIds: existing.linkedProjectIds || [],
  });

  const [tagInput, setTagInput] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave({
        ...annotation,
        eventId: event.id,
        updatedAt: Date.now(),
      });
    } finally {
      setSaving(false);
    }
  };

  const addTag = (tag) => {
    const trimmed = tag.trim().toLowerCase().replace(/\s+/g, '_');
    if (trimmed && !annotation.customTags.includes(trimmed)) {
      setAnnotation((prev) => ({
        ...prev,
        customTags: [...prev.customTags, trimmed],
      }));
    }
    setTagInput('');
  };

  const removeTag = (tag) => {
    setAnnotation((prev) => ({
      ...prev,
      customTags: prev.customTags.filter((t) => t !== tag),
    }));
  };

  const handleTagKeyDown = (e) => {
    if (e.key === 'Enter' && tagInput.trim()) {
      e.preventDefault();
      addTag(tagInput);
    }
  };

  const handleTemplateClick = (value) => {
    setAnnotation((prev) => ({
      ...prev,
      note: prev.note + value,
    }));
  };

  return (
    <div className="annotation-editor-backdrop" onClick={onCancel}>
      <div className="annotation-editor" onClick={(e) => e.stopPropagation()}>
        <div className="annotation-editor-header">
          <h3>Ghi chú sự kiện</h3>
          <button className="close-btn" onClick={onCancel}>×</button>
        </div>

        {/* Event preview */}
        <div className="annotation-event-preview">
          <span className={`badge severity-${event.severity}`}>{SEVERITY_LABELS[event.severity] || event.severity}</span>
          <p>{event.description}</p>
          <span className="preview-meta">
            Ch.{event.chapter} · {canonLabel}
          </span>
        </div>

        {/* Quick templates */}
        <div className="annotation-templates">
          <span className="templates-label">Mẫu nhanh:</span>
          <div className="template-buttons">
            {TEMPLATES.map((t) => (
              <button
                key={t.label}
                className="template-btn"
                onClick={() => handleTemplateClick(t.value)}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Note */}
        <div className="annotation-note-section">
          <label>Ghi chú</label>
          <textarea
            value={annotation.note}
            onChange={(e) =>
              setAnnotation((prev) => ({ ...prev, note: e.target.value }))
            }
            placeholder="Thêm ghi chú của bạn cho sự kiện này..."
            rows={5}
          />
        </div>

        {/* Custom tags */}
        <div className="annotation-tags-section">
          <label>Tag tùy chỉnh</label>
          <div className="tag-input-row">
            <input
              type="text"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={handleTagKeyDown}
              placeholder="Nhập tag và nhấn Enter..."
            />
          </div>
          <div className="tag-list">
            {annotation.customTags.map((tag) => (
              <span key={tag} className="annotation-tag">
                {tag}
                <button onClick={() => removeTag(tag)}>×</button>
              </span>
            ))}
          </div>
        </div>

        {/* Star toggle */}
        <div className="annotation-star-section">
          <label className="star-toggle">
            <input
              type="checkbox"
              checked={annotation.starred}
              onChange={(e) =>
                setAnnotation((prev) => ({ ...prev, starred: e.target.checked }))
              }
            />
            ⭐ Đánh dấu sao sự kiện này
          </label>
        </div>

        {/* Actions */}
        <div className="annotation-actions">
          <button className="btn-cancel" onClick={onCancel}>
            Hủy
          </button>
          <button className="btn-save" onClick={handleSave} disabled={saving}>
            {saving ? 'Đang lưu...' : 'Lưu ghi chú'}
          </button>
        </div>
      </div>
    </div>
  );
}
