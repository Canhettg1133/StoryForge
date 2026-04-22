import React from 'react';
import { Plus, Trash2, X } from 'lucide-react';
import {
  createStableChapterAnchorId,
  normalizeChapterAnchorInput,
} from '../../../services/ai/macroArcContract';
import {
  canonicalizeChapterAnchorCharacter,
  isKnownChapterAnchorCharacter,
  mergeChapterAnchorCharacters,
  normalizeChapterAnchorCharacterKey,
  parseChapterAnchorFocusCharacters,
  splitChapterAnchorFocusInput,
  splitChapterAnchorRequirementLines,
} from './chapterAnchorUtils';

function getRawAnchorRequirementText(anchor = {}) {
  const rawValue = anchor.requirementText
    ?? anchor.requirement_text
    ?? anchor.text
    ?? anchor.requirement;
  return rawValue == null ? null : String(rawValue);
}

function normalizeAnchorDraft(anchor = {}, index = 0, allCharacters = []) {
  const normalized = normalizeChapterAnchorInput(anchor, { index, allCharacters }) || {
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

  const rawRequirementText = getRawAnchorRequirementText(anchor);
  if (rawRequirementText == null) return normalized;

  return {
    ...normalized,
    requirementText: rawRequirementText,
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

function buildKnownCharacterOptions(allCharacters = [], selectedValues = []) {
  const selectedKeys = new Set((selectedValues || []).map((item) => normalizeChapterAnchorCharacterKey(item)));
  const seen = new Set();

  return (Array.isArray(allCharacters) ? allCharacters : [])
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .filter((item) => {
      const key = normalizeChapterAnchorCharacterKey(item);
      if (!key || selectedKeys.has(key) || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

const FocusCharacterCombobox = React.memo(function FocusCharacterCombobox({
  selectedValues = [],
  allCharacters = [],
  onChange,
}) {
  const [query, setQuery] = React.useState('');
  const [isOpen, setIsOpen] = React.useState(false);
  const [highlightedIndex, setHighlightedIndex] = React.useState(-1);
  const blurTimeoutRef = React.useRef(null);
  const listboxId = React.useId();

  const availableOptions = React.useMemo(
    () => buildKnownCharacterOptions(allCharacters, selectedValues),
    [allCharacters, selectedValues],
  );

  const filteredOptions = React.useMemo(() => {
    const normalizedQuery = normalizeChapterAnchorCharacterKey(query);
    const ranked = availableOptions
      .filter((item) => {
        if (!normalizedQuery) return true;
        return normalizeChapterAnchorCharacterKey(item).includes(normalizedQuery);
      })
      .sort((left, right) => {
        if (!normalizedQuery) return left.localeCompare(right, 'vi');
        const leftKey = normalizeChapterAnchorCharacterKey(left);
        const rightKey = normalizeChapterAnchorCharacterKey(right);
        const leftStartsWith = leftKey.startsWith(normalizedQuery);
        const rightStartsWith = rightKey.startsWith(normalizedQuery);
        if (leftStartsWith !== rightStartsWith) return leftStartsWith ? -1 : 1;
        return left.localeCompare(right, 'vi');
      });
    return ranked.slice(0, 8);
  }, [availableOptions, query]);

  const customValues = React.useMemo(
    () => selectedValues.filter((item) => !isKnownChapterAnchorCharacter(item, allCharacters)),
    [allCharacters, selectedValues],
  );

  React.useEffect(() => {
    setHighlightedIndex(filteredOptions.length > 0 ? 0 : -1);
  }, [filteredOptions]);

  React.useEffect(() => () => {
    if (blurTimeoutRef.current) {
      clearTimeout(blurTimeoutRef.current);
    }
  }, []);

  const commitValues = React.useCallback((values) => {
    const nextValues = mergeChapterAnchorCharacters(selectedValues, values, allCharacters);
    onChange?.(nextValues);
  }, [allCharacters, onChange, selectedValues]);

  const handleSelectOption = React.useCallback((value) => {
    commitValues([value]);
    setQuery('');
    setIsOpen(false);
  }, [commitValues]);

  const handleCommitCustomQuery = React.useCallback(() => {
    const nextValues = parseChapterAnchorFocusCharacters(query);
    if (nextValues.length === 0) {
      setIsOpen(false);
      return;
    }
    commitValues(nextValues);
    setQuery('');
    setIsOpen(false);
  }, [commitValues, query]);

  const handleInputChange = React.useCallback((event) => {
    const nextValue = event.target.value;
    const { committedValues, remainder } = splitChapterAnchorFocusInput(nextValue);
    if (committedValues.length > 0) {
      commitValues(committedValues);
    }
    setQuery(remainder);
    setIsOpen(true);
  }, [commitValues]);

  const handleKeyDown = React.useCallback((event) => {
    if (event.isComposing || event.nativeEvent?.isComposing) {
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setIsOpen(true);
      setHighlightedIndex((current) => {
        if (filteredOptions.length === 0) return -1;
        if (current < 0) return 0;
        return Math.min(filteredOptions.length - 1, current + 1);
      });
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setIsOpen(true);
      setHighlightedIndex((current) => {
        if (filteredOptions.length === 0) return -1;
        if (current < 0) return filteredOptions.length - 1;
        return Math.max(0, current - 1);
      });
      return;
    }

    if (event.key === ',') {
      if (!query.trim()) return;
      event.preventDefault();
      handleCommitCustomQuery();
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      if (isOpen && highlightedIndex >= 0 && filteredOptions[highlightedIndex]) {
        handleSelectOption(filteredOptions[highlightedIndex]);
        return;
      }
      handleCommitCustomQuery();
      return;
    }

    if (event.key === 'Escape') {
      setIsOpen(false);
      return;
    }

    if (event.key === 'Backspace' && !query && selectedValues.length > 0) {
      event.preventDefault();
      onChange?.(selectedValues.slice(0, -1));
    }
  }, [
    filteredOptions,
    handleCommitCustomQuery,
    handleSelectOption,
    highlightedIndex,
    isOpen,
    onChange,
    query,
    selectedValues,
  ]);

  return (
    <div className="form-group" style={{ marginBottom: 0 }}>
      <label className="form-label" style={{ marginBottom: '6px' }}>Nhân vật trọng tâm</label>

      {selectedValues.length > 0 && (
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '6px',
            marginBottom: '8px',
          }}
        >
          {selectedValues.map((value) => {
            const isCustom = !isKnownChapterAnchorCharacter(value, allCharacters);
            return (
              <span
                key={normalizeChapterAnchorCharacterKey(value)}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '6px 8px',
                  borderRadius: '999px',
                  border: `1px solid ${isCustom ? 'var(--color-warning)' : 'var(--color-border)'}`,
                  background: isCustom ? 'color-mix(in srgb, var(--color-warning) 10%, var(--color-bg-primary))' : 'var(--color-bg-primary)',
                  color: 'var(--color-text-primary)',
                  fontSize: '12px',
                }}
              >
                <span>{value}</span>
                {isCustom && (
                  <span
                    style={{
                      padding: '2px 6px',
                      borderRadius: '999px',
                      background: 'color-mix(in srgb, var(--color-warning) 18%, transparent)',
                      color: 'var(--color-warning)',
                      fontSize: '10px',
                      fontWeight: 700,
                      textTransform: 'uppercase',
                      letterSpacing: '0.04em',
                    }}
                  >
                    Ngoài danh sách
                  </span>
                )}
                <button
                  type="button"
                  className="btn btn-ghost btn-icon btn-sm"
                  onClick={() => onChange?.(
                    selectedValues.filter((item) => normalizeChapterAnchorCharacterKey(item) !== normalizeChapterAnchorCharacterKey(value)),
                  )}
                  aria-label={`Xóa ${value}`}
                  style={{ minWidth: 'auto', width: '20px', height: '20px', padding: 0 }}
                >
                  <X size={12} />
                </button>
              </span>
            );
          })}
        </div>
      )}

      <div style={{ position: 'relative' }}>
        <input
          role="combobox"
          aria-label="Nhân vật trọng tâm"
          aria-expanded={isOpen}
          aria-controls={listboxId}
          aria-activedescendant={highlightedIndex >= 0 ? `${listboxId}-option-${highlightedIndex}` : undefined}
          className="input"
          value={query}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onFocus={() => {
            if (blurTimeoutRef.current) clearTimeout(blurTimeoutRef.current);
            setIsOpen(true);
          }}
          onBlur={() => {
            blurTimeoutRef.current = setTimeout(() => {
              setIsOpen(false);
            }, 120);
          }}
          onPaste={(event) => {
            const pastedText = event.clipboardData?.getData('text') || '';
            if (!/[,\n]/.test(pastedText)) return;
            event.preventDefault();
            const parsedValues = parseChapterAnchorFocusCharacters(pastedText);
            if (parsedValues.length > 0) {
              commitValues(parsedValues);
            }
            setQuery('');
            setIsOpen(false);
          }}
          placeholder="Tìm hoặc thêm nhân vật, tách bằng dấu phẩy hoặc xuống dòng"
          autoComplete="off"
        />

        {isOpen && (filteredOptions.length > 0 || query.trim()) && (
          <div
            id={listboxId}
            role="listbox"
            style={{
              position: 'absolute',
              top: 'calc(100% + 6px)',
              left: 0,
              right: 0,
              zIndex: 5,
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-sm)',
              background: 'var(--color-bg-primary)',
              boxShadow: 'var(--shadow-md)',
              padding: '6px',
              display: 'flex',
              flexDirection: 'column',
              gap: '4px',
            }}
          >
            {filteredOptions.map((item, index) => (
              <button
                key={item}
                id={`${listboxId}-option-${index}`}
                type="button"
                role="option"
                aria-selected={highlightedIndex === index}
                onMouseDown={(event) => {
                  event.preventDefault();
                  handleSelectOption(item);
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '8px',
                  padding: '8px 10px',
                  borderRadius: '8px',
                  border: 'none',
                  background: highlightedIndex === index ? 'var(--color-surface-2)' : 'transparent',
                  color: 'var(--color-text-primary)',
                  cursor: 'pointer',
                  textAlign: 'left',
                }}
              >
                <span>{item}</span>
                <span style={{ fontSize: '11px', color: 'var(--color-text-muted)' }}>Character Hub</span>
              </button>
            ))}

            {filteredOptions.length === 0 && query.trim() && (
              <div
                style={{
                  padding: '8px 10px',
                  borderRadius: '8px',
                  background: 'var(--color-surface-2)',
                  color: 'var(--color-text-secondary)',
                  fontSize: '12px',
                }}
              >
                Nhấn Enter để thêm “{canonicalizeChapterAnchorCharacter(query, allCharacters)}”.
              </div>
            )}
          </div>
        )}
      </div>

      <div className="form-hint" style={{ marginTop: '6px' }}>
        Enter sẽ chọn mục đang highlight; nếu không có mục phù hợp, hệ thống thêm nguyên cụm đang gõ thành chip.
      </div>

      {customValues.length > 0 && (
        <div className="form-hint" style={{ marginTop: '6px', color: 'var(--color-warning)' }}>
          Có tên ngoài Character Hub: {customValues.join(', ')}.
        </div>
      )}
    </div>
  );
});

const ChapterAnchorEditor = React.memo(function ChapterAnchorEditor({
  title = 'Yêu cầu bắt buộc theo chương',
  hint = '',
  anchors = [],
  onChange,
  scopeStart = 0,
  scopeEnd = 0,
  allCharacters = [],
}) {
  const normalizedAnchors = React.useMemo(
    () => (Array.isArray(anchors) ? anchors.map((item, index) => normalizeAnchorDraft(item, index, allCharacters)) : []),
    [allCharacters, anchors],
  );

  const updateAnchors = React.useCallback((updater) => {
    const nextAnchors = typeof updater === 'function' ? updater(normalizedAnchors) : updater;
    onChange?.(nextAnchors.map((item, index) => normalizeAnchorDraft(item, index, allCharacters)));
  }, [allCharacters, normalizedAnchors, onChange]);

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
      }, previous.length, allCharacters),
    ]));
  }, [allCharacters, scopeStart, updateAnchors]);

  const updateAnchor = React.useCallback((index, field, value) => {
    updateAnchors((previous) => previous.map((item, itemIndex) => {
      if (itemIndex !== index) return item;
      if (field === 'focusCharacters') {
        return {
          ...item,
          focusCharacters: mergeChapterAnchorCharacters([], Array.isArray(value) ? value : [value], allCharacters),
        };
      }
      return { ...item, [field]: value };
    }));
  }, [allCharacters, updateAnchors]);

  const removeAnchor = React.useCallback((index) => {
    updateAnchors((previous) => previous.filter((_, itemIndex) => itemIndex !== index));
  }, [updateAnchors]);

  const splitAnchorIntoMultiple = React.useCallback((index) => {
    updateAnchors((previous) => {
      const currentAnchor = previous[index];
      const lines = splitChapterAnchorRequirementLines(currentAnchor?.requirementText || '');
      if (lines.length < 2) return previous;

      const splitAnchors = lines.map((line, lineIndex) => ({
        ...currentAnchor,
        id: lineIndex === 0 ? currentAnchor.id : createStableChapterAnchorId(),
        requirementText: line,
      }));

      return [
        ...previous.slice(0, index),
        ...splitAnchors,
        ...previous.slice(index + 1),
      ];
    });
  }, [updateAnchors]);

  return (
    <div
      className="form-group"
      style={{ marginBottom: 'var(--space-2)' }}
      onClick={(event) => event.stopPropagation()}
    >
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
        const splitLines = splitChapterAnchorRequirementLines(anchor.requirementText || '');
        const canSplitRequirement = splitLines.length >= 2;

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

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', marginBottom: '6px', flexWrap: 'wrap' }}>
              <label className="form-label" style={{ marginBottom: 0 }}>Điều bắt buộc</label>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => splitAnchorIntoMultiple(index)}
                disabled={!canSplitRequirement}
              >
                Tách thành nhiều yêu cầu
              </button>
            </div>

            <textarea
              className="textarea"
              rows={2}
              value={anchor.requirementText}
              onChange={(event) => updateAnchor(index, 'requirementText', event.target.value)}
              placeholder="Điều bắt buộc phải xảy ra ở chương này"
              aria-label="Điều bắt buộc"
              style={{ marginBottom: '8px' }}
            />

            <div className="form-hint" style={{ marginTop: '-2px', marginBottom: '8px' }}>
              Mỗi dòng là một ý riêng. Nút “Tách thành nhiều yêu cầu” sẽ biến từng dòng không rỗng thành một anchor mới.
            </div>

            <FocusCharacterCombobox
              selectedValues={anchor.focusCharacters || []}
              allCharacters={allCharacters}
              onChange={(nextValues) => updateAnchor(index, 'focusCharacters', nextValues)}
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
