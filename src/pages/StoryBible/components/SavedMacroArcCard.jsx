import React from 'react';
import { Trash2 } from 'lucide-react';
import MacroArcContractPanel from './MacroArcContractPanel';

const SavedMacroArcCard = React.memo(function SavedMacroArcCard({
  macroArc,
  index,
  isAnalyzing,
  allCharacterNames,
  onUpdate,
  onDelete,
  onAnalyze,
}) {
  return (
    <div className="bible-edit-card" style={{ marginBottom: 'var(--space-3)', border: '1px solid var(--color-border)' }}>
      <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', marginBottom: 'var(--space-2)' }}>
        <span
          style={{
            flexShrink: 0,
            width: '24px',
            height: '24px',
            borderRadius: '50%',
            background: 'var(--color-accent)',
            color: '#fff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '11px',
            fontWeight: 700,
          }}
        >
          {index + 1}
        </span>
        <input
          className="input"
          style={{ flex: 1, fontWeight: 600 }}
          value={macroArc.title}
          onChange={(event) => onUpdate(macroArc.id, 'title', event.target.value)}
          placeholder="Tên cột mốc (VD: Kẻ Dị Biệt)"
        />
        <button
          className="btn btn-ghost btn-icon btn-sm"
          onClick={() => onDelete(macroArc.id)}
          title="Xóa cột mốc"
        >
          <Trash2 size={14} />
        </button>
      </div>

      <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', marginBottom: 'var(--space-2)' }}>
        <span style={{ fontSize: '12px', color: 'var(--color-text-muted)', flexShrink: 0 }}>Chương</span>
        <input
          type="number"
          className="input"
          style={{ width: '80px' }}
          value={macroArc.chapter_from || ''}
          onChange={(event) => onUpdate(macroArc.id, 'chapter_from', Number(event.target.value))}
          placeholder="Từ"
        />
        <span style={{ fontSize: '12px', color: 'var(--color-text-muted)' }}>→</span>
        <input
          type="number"
          className="input"
          style={{ width: '80px' }}
          value={macroArc.chapter_to || ''}
          onChange={(event) => onUpdate(macroArc.id, 'chapter_to', Number(event.target.value))}
          placeholder="Đến"
        />
        {macroArc.chapter_from > 0 && macroArc.chapter_to > 0 && (
          <span style={{ fontSize: '11px', color: 'var(--color-text-muted)' }}>
            ({macroArc.chapter_to - macroArc.chapter_from + 1} chương)
          </span>
        )}
      </div>

      <div className="form-group" style={{ marginBottom: 'var(--space-2)' }}>
        <label className="form-label">Mô tả sự kiện chính</label>
        <textarea
          className="textarea"
          rows={2}
          value={macroArc.description || ''}
          onChange={(event) => onUpdate(macroArc.id, 'description', event.target.value)}
          placeholder="Những gì xảy ra ở cột mốc này..."
        />
      </div>

      <div className="form-group" style={{ marginBottom: 0 }}>
        <label className="form-label">Cảm xúc độc giả khi kết thúc cột mốc</label>
        <input
          className="input"
          value={macroArc.emotional_peak || ''}
          onChange={(event) => onUpdate(macroArc.id, 'emotional_peak', event.target.value)}
          placeholder="VD: Hứng khởi, tò mò - người này sẽ đi đến đâu?"
        />
      </div>
      <MacroArcContractPanel
        macroArc={macroArc}
        allCharacters={allCharacterNames}
        onAnalyze={() => onAnalyze(macroArc)}
        isAnalyzing={isAnalyzing}
      />
    </div>
  );
});

export default SavedMacroArcCard;
