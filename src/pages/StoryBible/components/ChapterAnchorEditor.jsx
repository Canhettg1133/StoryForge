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
    return `Hard anchor nam ngoai pham vi ${scopeStart}-${scopeEnd}.`;
  }
  return '';
}

const ChapterAnchorEditor = React.memo(function ChapterAnchorEditor({
  title = 'Yeu cau bat buoc theo chuong',
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
          <Plus size={14} /> Them anchor
        </button>
      </div>

      {normalizedAnchors.length === 0 && (
        <div className="form-hint" style={{ marginTop: 0 }}>
          Chua co chapter anchor nao.
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
                placeholder="Chuong"
              />
              <select
                className="select"
                style={{ width: '110px' }}
                value={anchor.strictness}
                onChange={(event) => updateAnchor(index, 'strictness', event.target.value)}
              >
                <option value="hard">Hard</option>
                <option value="soft">Soft</option>
              </select>
              <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'var(--color-text-muted)' }}>
                <input
                  type="checkbox"
                  checked={anchor.forbidBefore !== false}
                  onChange={(event) => updateAnchor(index, 'forbidBefore', event.target.checked)}
                />
                Cam dat som
              </label>
              <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={() => removeAnchor(index)} title="Xoa anchor">
                <Trash2 size={14} />
              </button>
            </div>

            <textarea
              className="textarea"
              rows={2}
              value={anchor.requirementText}
              onChange={(event) => updateAnchor(index, 'requirementText', event.target.value)}
              placeholder="Dieu bat buoc phai xay ra o chuong nay"
              style={{ marginBottom: '8px' }}
            />

            <input
              className="input"
              value={anchor.focusCharacters.join(', ')}
              onChange={(event) => updateAnchor(index, 'focusCharacters', event.target.value)}
              placeholder="Focus characters (tuy chon, ngan cach bang dau phay)"
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
