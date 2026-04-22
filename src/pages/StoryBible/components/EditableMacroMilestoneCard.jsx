import React from 'react';
import { Trash2 } from 'lucide-react';
import ChapterAnchorEditor from './ChapterAnchorEditor';
import MacroArcContractPanel from './MacroArcContractPanel';

const EditableMacroMilestoneCard = React.memo(function EditableMacroMilestoneCard({
  milestone,
  index,
  isSelected,
  isAnalyzing,
  allCharacterNames,
  onToggle,
  onUpdate,
  onRemove,
  onAnalyze,
}) {
  const handleSelectAll = React.useCallback((event) => {
    const input = event.currentTarget;
    const selectInput = () => {
      if (document.activeElement === input) input.select();
    };
    if (typeof window !== 'undefined' && window.requestAnimationFrame) {
      window.requestAnimationFrame(selectInput);
    } else {
      setTimeout(selectInput, 0);
    }
  }, []);

  return (
    <div
      onClick={() => onToggle(index)}
      style={{
        display: 'flex',
        gap: 'var(--space-2)',
        alignItems: 'flex-start',
        padding: 'var(--space-2)',
        background: isSelected
          ? 'var(--color-accent-subtle, rgba(124,58,237,0.12))'
          : 'var(--color-surface-3, rgba(255,255,255,0.04))',
        border: isSelected
          ? '1px solid var(--color-accent)'
          : '1px solid transparent',
        borderRadius: 'var(--radius-sm)',
        marginBottom: 'var(--space-1)',
        fontSize: '12px',
        cursor: 'pointer',
        transition: 'all 0.15s',
      }}
    >
      <input
        type="checkbox"
        checked={isSelected}
        onChange={() => {}}
        style={{ marginTop: '2px', flexShrink: 0, accentColor: 'var(--color-accent)' }}
      />
      <div style={{ flex: 1 }}>
        <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', marginBottom: 'var(--space-2)' }}>
          <strong style={{ minWidth: '28px' }}>{index + 1}.</strong>
          <input
            className="input"
            value={milestone.title || ''}
            onClick={(event) => event.stopPropagation()}
            onChange={(event) => onUpdate(index, 'title', event.target.value)}
            placeholder="Tên cột mốc"
            style={{ flex: 1 }}
          />
          <button
            className="btn btn-ghost btn-icon btn-sm"
            onClick={(event) => {
              event.stopPropagation();
              onRemove(index);
            }}
            title="Xóa khỏi batch AI"
          >
            <Trash2 size={14} />
          </button>
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-2)', marginBottom: 'var(--space-2)', alignItems: 'center' }}>
          <span style={{ fontSize: '12px', color: 'var(--color-text-muted)' }}>Chương</span>
          <input
            type="text"
            inputMode="numeric"
            className="input"
            value={milestone.chapter_from || ''}
            onClick={(event) => event.stopPropagation()}
            onFocus={handleSelectAll}
            onChange={(event) => onUpdate(index, 'chapter_from', Number(event.target.value) || 0)}
            style={{ width: '88px' }}
          />
          <span style={{ fontSize: '12px', color: 'var(--color-text-muted)' }}>→</span>
          <input
            type="text"
            inputMode="numeric"
            className="input"
            value={milestone.chapter_to || ''}
            onClick={(event) => event.stopPropagation()}
            onFocus={handleSelectAll}
            onChange={(event) => onUpdate(index, 'chapter_to', Number(event.target.value) || 0)}
            style={{ width: '88px' }}
          />
        </div>
        <textarea
          className="textarea"
          rows={2}
          value={milestone.description || ''}
          onClick={(event) => event.stopPropagation()}
          onChange={(event) => onUpdate(index, 'description', event.target.value)}
          placeholder="Mô tả cột mốc"
          style={{ marginBottom: 'var(--space-2)' }}
        />
        <input
          className="input"
          value={milestone.emotional_peak || ''}
          onClick={(event) => event.stopPropagation()}
          onChange={(event) => onUpdate(index, 'emotional_peak', event.target.value)}
          placeholder="Cảm xúc đích của độc giả"
        />
        <ChapterAnchorEditor
          title="Chapter anchors"
          hint="Yeu cau bat buoc dung chapter cho milestone AI nay."
          anchors={milestone.chapter_anchors || []}
          onChange={(nextAnchors) => onUpdate(index, 'chapter_anchors', nextAnchors)}
          scopeStart={milestone.chapter_from}
          scopeEnd={milestone.chapter_to}
        />
        <MacroArcContractPanel
          macroArc={milestone}
          allCharacters={allCharacterNames}
          onAnalyze={() => onAnalyze(index, milestone)}
          isAnalyzing={isAnalyzing}
        />
      </div>
    </div>
  );
});

export default EditableMacroMilestoneCard;
