import React from 'react';
import { Plus, Trash2 } from 'lucide-react';
import {
  createStableChapterAnchorId,
  normalizeChapterAnchorInput,
} from '../../../services/ai/macroArcContract';

function normalizeAnchorDraft(anchor = {}, index = 0) {
  return normalizeChapterAnchorInput(anchor, { index }) || {
    id: createStableChapterAnchorId(),
    targetChapter: 0,
    strictness: 'hard',
    requirementText: '',
    focusCharacters: [],
    objectiveRefs: [],
    successSignals: [],
    forbidBefore: true,
    notes: '',
  };
}

function getAnchorRangeWarning(anchor, scopeStart = 0, scopeEnd = 0) {
  if (!anchor?.targetChapter || !scopeStart || !scopeEnd || scopeEnd < scopeStart) return '';
  if (anchor.strictness !== 'hard') return '';
  if (anchor.targetChapter < scopeStart || anchor.targetChapter > scopeEnd) {
    return `Yêu cầu bắt buộc nằm ngoài phạm vi chương ${scopeStart}-${scopeEnd}.`;
  }
  return '';
}

const ChapterAnchorEditor = React.memo(function ChapterAnchorEditor({
  title = 'Yêu cầu bắt buộc theo chương',
  hint = '',
  anchors = [],
  onChange,
  scopeStart = 0,
  scopeEnd = 0,
}) {
  const normalizedAnchors = Array.isArray(anchors)
    ? anchors.map((item, index) => normalizeAnchorDraft(item, index))
    : [];

  const updateAnchors = React.useCallback((updater) => {
    const nextAnchors = typeof updater === 'function' ? updater(normalizedAnchors) : updater;
    onChange?.(nextAnchors.map((item, index) => normalizeAnchorDraft(item, index)));
  }, [normalizedAnchors, onChange]);

  const addAnchor = React.useCallback(() => {
    updateAnchors((previous) => ([
      ...previous,
      normalizeAnchorDraft({
        id: createStableChapterAnchorId(),
        targetChapter: scopeStart || 0,
        strictness: 'hard',
        requirementText: '',
        focusCharacters: [],
        forbidBefore: true,
      }, previous.length),
    ]));
  }, [scopeStart, updateAnchors]);

  const updateAnchor = React.useCallback((index, field, value) => {
    updateAnchors((previous) => previous.map((item, itemIndex) => {
      if (itemIndex !== index) return item;
      if (field === 'focusCharacters') {
        return {
          ...item,
          focusCharacters: String(value || '')
            .split(',')
            .map((part) => part.trim())
            .filter(Boolean),
        };
      }
      return { ...item, [field]: value };
    }));
  }, [updateAnchors]);

  const removeAnchor = React.useCallback((index) => {
    updateAnchors((previous) => previous.filter((_, itemIndex) => itemIndex !== index));
  }, [updateAnchors]);

  return (
    <div className="form-group" style={{ marginBottom: 'var(--space-2)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
        <div>
          <label className="form-label" style={{ marginBottom: 0 }}>{title}</label>
          {hint && <div className="form-hint" style={{ marginTop: '4px' }}>{hint}</div>}
        </div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={addAnchor}>
          <Plus size={14} /> Thêm yêu cầu
        </button>
      </div>

      {normalizedAnchors.length === 0 && (
        <div className="form-hint" style={{ marginTop: 0 }}>
          Chưa có yêu cầu bắt buộc theo chương nào.
        </div>
      )}

      {normalizedAnchors.map((anchor, index) => {
        const rangeWarning = getAnchorRangeWarning(anchor, scopeStart, scopeEnd);
        return (
          <div
            key={anchor.id || `anchor-${index}`}
            style={{
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-sm)',
              padding: 'var(--space-2)',
              marginBottom: 'var(--space-2)',
              background: 'var(--color-surface-2)',
            }}
          >
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '8px', flexWrap: 'wrap' }}>
              <input
                type="text"
                inputMode="numeric"
                className="input"
                style={{ width: '110px' }}
                value={anchor.targetChapter || ''}
                onChange={(event) => updateAnchor(index, 'targetChapter', Number(event.target.value) || 0)}
                placeholder="Chương"
              />
              <select
                className="select"
                style={{ width: '110px' }}
                value={anchor.strictness}
                onChange={(event) => updateAnchor(index, 'strictness', event.target.value)}
              >
                <option value="hard">Bắt buộc</option>
                <option value="soft">Gợi ý</option>
              </select>
              <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'var(--color-text-muted)' }}>
                <input
                  type="checkbox"
                  checked={anchor.forbidBefore !== false}
                  onChange={(event) => updateAnchor(index, 'forbidBefore', event.target.checked)}
                />
                Cấm đặt sớm
              </label>
              <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={() => removeAnchor(index)} title="Xóa yêu cầu">
                <Trash2 size={14} />
              </button>
            </div>

            <textarea
              className="textarea"
              rows={2}
              value={anchor.requirementText}
              onChange={(event) => updateAnchor(index, 'requirementText', event.target.value)}
              placeholder="Điều bắt buộc phải xảy ra ở chương này"
              style={{ marginBottom: '8px' }}
            />

            <input
              className="input"
              value={anchor.focusCharacters.join(', ')}
              onChange={(event) => updateAnchor(index, 'focusCharacters', event.target.value)}
              placeholder="Nhân vật trọng tâm (tùy chọn, ngăn cách bằng dấu phẩy)"
            />

            {rangeWarning && (
              <div className="form-hint" style={{ marginTop: '8px', color: 'var(--color-warning)' }}>
                {rangeWarning}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
});

export default ChapterAnchorEditor;
