import React from 'react';
import { Check, Flag, Loader2, Plus, RotateCcw, Sparkles, TrendingUp, Wand2, X } from 'lucide-react';
import ArcNavigator from '../../../components/common/ArcNavigator';
import EditableMacroMilestoneCard from '../components/EditableMacroMilestoneCard';
import SavedMacroArcCard from '../components/SavedMacroArcCard';

const MACRO_AI_PRESETS = [
  { id: 'slow', label: 'Chậm', text: 'Nhịp truyện chậm, ưu tiên xây dựng và buildup.' },
  { id: 'twist', label: 'Bẻ lái mạnh', text: 'Có bẻ lái mạnh ở một vài cột mốc lớn, nhưng vẫn hợp lý.' },
  { id: 'romance', label: 'Tình cảm phụ', text: 'Có một tuyến tình cảm phụ, nhưng không lấn át tuyến chính.' },
  { id: 'mystery', label: 'Ít lộ bí mật', text: 'Ít lộ bí mật, chỉ mở dần từng phần và giữ lại bất ngờ lớn cho sau này.' },
  { id: 'target_length', label: 'Bám độ dài dự kiến', text: 'Phân bố cột mốc bám sát độ dài dự kiến, không đẩy nhanh quá sớm.' },
];

const StoryBibleMacroArcSection = React.memo(function StoryBibleMacroArcSection({
  currentProjectId,
  chapters,
  targetLength,
  isOpen,
  onToggle,
  macroArcs,
  aiIdeaInput,
  setAiIdeaInput,
  aiMilestoneCount,
  setAiMilestoneCount,
  aiMilestoneRequirements,
  setAiMilestoneRequirements,
  showAiSuggest,
  setShowAiSuggest,
  aiMilestoneRevisionPrompt,
  setAiMilestoneRevisionPrompt,
  editableMilestoneSuggestions,
  selectedMilestoneIdxs,
  setSelectedMilestoneIdxs,
  selectedMilestonePresets,
  suggestedMilestoneCount,
  isSuggestingMilestones,
  isRevisingMilestones,
  analyzingMacroContractKeys,
  getEditableMilestoneAnalyzeKey,
  getSavedMacroArcAnalyzeKey,
  handleGenerateMilestones,
  handleSaveMilestones,
  handleUpdateEditableMilestone,
  handleAnalyzeEditableMilestone,
  handleAnalyzeSavedMacroArc,
  handleRemoveEditableMilestone,
  handleToggleEditableMilestoneSelection,
  handleAddEditableMilestone,
  handleReviseMilestones,
  toggleMilestonePreset,
  resetAiSuggestPanel,
  handleAddMacroArc,
  handleUpdateMacroArc,
  handleDeleteMacroArc,
  allCharacterNames,
}) {
  return (
    <div className="bible-section">
      <div className="bible-section-header" onClick={() => onToggle('grandStrategy')} style={{ cursor: 'pointer' }}>
        <h3 className="bible-section-title">
          <RotateCcw size={14} style={{ transform: isOpen ? 'rotate(0)' : 'rotate(-90deg)', transition: '0.2s' }} />
          <TrendingUp size={18} /> Đại cục ({macroArcs.length} cột mốc)
        </h3>
        <div style={{ display: 'flex', gap: 'var(--space-2)' }} onClick={(event) => event.stopPropagation()}>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowAiSuggest((prev) => !prev)} title="Gợi ý cột mốc bằng AI">
            <Wand2 size={14} /> Gợi ý AI
          </button>
          <button type="button" className="btn btn-primary btn-sm" onClick={handleAddMacroArc}>
            <Plus size={14} /> Thêm cột mốc
          </button>
        </div>
      </div>

      {isOpen && (
        <div className="bible-edit-card">
          <p className="bible-subtitle" style={{ marginBottom: 'var(--space-3)' }}>
            Định nghĩa 5-8 cột mốc lớn của toàn bộ truyện. AI đọc và tôn trọng tuyệt đối:
            {' '}nhân vật không được vượt qua cột mốc hiện tại.
          </p>

          {showAiSuggest && (
            <div style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-accent)', borderRadius: 'var(--radius-md)', padding: 'var(--space-3)', marginBottom: 'var(--space-3)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: 'var(--space-2)', fontSize: '13px', fontWeight: 600 }}>
                <Wand2 size={14} style={{ color: 'var(--color-accent)' }} />
                Gợi ý đại cục bằng AI
              </div>
              <textarea className="textarea" rows={2} value={aiIdeaInput} onChange={(event) => setAiIdeaInput(event.target.value)} placeholder="Mô tả ngắn về truyện (để trống = AI tự đọc từ Tóm tắt truyện + Đích đến)..." style={{ marginBottom: 'var(--space-2)' }} />
              <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'flex-end', marginBottom: 'var(--space-2)', flexWrap: 'wrap' }}>
                <div className="form-group" style={{ marginBottom: 0, width: '180px' }}>
                  <label className="form-label">Số lượng cột mốc muốn tạo</label>
                  <input type="number" min="1" max="20" className="input" value={aiMilestoneCount} onChange={(event) => setAiMilestoneCount(Math.max(1, parseInt(event.target.value, 10) || 1))} />
                  <div className="form-hint" style={{ marginTop: '6px' }}>Đề xuất theo độ dài dự kiến: {suggestedMilestoneCount} cột mốc</div>
                </div>
                <button type="button" className="btn btn-ghost btn-sm" style={{ marginBottom: '6px' }} onClick={() => setAiMilestoneCount(suggestedMilestoneCount)}>Dùng đề xuất</button>
                <div className="form-group" style={{ marginBottom: 0, flex: 1, minWidth: '240px' }}>
                  <label className="form-label">Yêu cầu riêng</label>
                  <textarea className="textarea" rows={2} value={aiMilestoneRequirements} onChange={(event) => setAiMilestoneRequirements(event.target.value)} placeholder="VD: mở đầu chậm, có một tuyến tình cảm phụ, giữ bí mật lớn đến sau..." />
                </div>
              </div>
              <div style={{ display: 'flex', gap: 'var(--space-2)', marginBottom: 'var(--space-1)', flexWrap: 'wrap' }}>
                {MACRO_AI_PRESETS.map((preset) => {
                  const active = selectedMilestonePresets.has(preset.id);
                  return (
                    <button key={preset.id} type="button" className={`btn btn-sm ${active ? 'btn-primary' : 'btn-ghost'}`} onClick={() => toggleMilestonePreset(preset.id)} aria-pressed={active}>
                      {preset.label}
                    </button>
                  );
                })}
              </div>
              {selectedMilestonePresets.size > 0 && <div className="form-hint" style={{ marginBottom: 'var(--space-2)' }}>Đang bật {selectedMilestonePresets.size} tùy chọn để kết hợp cùng yêu cầu riêng.</div>}
              <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', flexWrap: 'wrap' }}>
                <button className="btn btn-primary btn-sm" onClick={() => handleGenerateMilestones(MACRO_AI_PRESETS)} disabled={isSuggestingMilestones}>
                  {isSuggestingMilestones ? <><Loader2 size={14} className="spin" /> Đang gợi ý...</> : <><Sparkles size={14} /> Gợi ý</>}
                </button>
                <button className="btn btn-ghost btn-sm" onClick={resetAiSuggestPanel}><X size={14} /> Hủy</button>
              </div>

              {editableMilestoneSuggestions.length > 0 && (
                <div style={{ marginTop: 'var(--space-3)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-2)' }}>
                    <span style={{ fontSize: '12px', color: 'var(--color-text-muted)' }}>AI đã tạo {editableMilestoneSuggestions.length} cột mốc — có thể sửa tay hoặc nhờ AI chỉnh lại batch này:</span>
                    <button
                      type="button"
                      className="btn btn-ghost btn-xs"
                      style={{ fontSize: '11px' }}
                      onClick={() => {
                        if (selectedMilestoneIdxs.size === editableMilestoneSuggestions.length) {
                          setSelectedMilestoneIdxs(new Set());
                        } else {
                          setSelectedMilestoneIdxs(new Set(editableMilestoneSuggestions.map((_, index) => index)));
                        }
                      }}
                    >
                      {selectedMilestoneIdxs.size === editableMilestoneSuggestions.length ? 'Bỏ chọn tất cả' : 'Chọn tất cả'}
                    </button>
                  </div>
                  <div className="form-group" style={{ marginBottom: 'var(--space-2)' }}>
                    <label className="form-label">AI chỉnh lại đại cục theo ý tôi</label>
                    <textarea className="textarea" rows={2} value={aiMilestoneRevisionPrompt} onChange={(event) => setAiMilestoneRevisionPrompt(event.target.value)} placeholder="VD: kéo dài buildup đầu truyện, chia rõ midpoint, giữ bí mật lớn tới 60%, tăng trả giá ở cột mốc 3..." />
                  </div>
                  {editableMilestoneSuggestions.map((milestone, index) => (
                    <EditableMacroMilestoneCard
                      key={`editable-card-${index}`}
                      milestone={milestone}
                      index={index}
                      isSelected={selectedMilestoneIdxs.has(index)}
                      isAnalyzing={Boolean(analyzingMacroContractKeys[getEditableMilestoneAnalyzeKey(index)])}
                      allCharacterNames={allCharacterNames}
                      onToggle={handleToggleEditableMilestoneSelection}
                      onUpdate={handleUpdateEditableMilestone}
                      onRemove={handleRemoveEditableMilestone}
                      onAnalyze={handleAnalyzeEditableMilestone}
                    />
                  ))}
                  <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-2)' }}>
                    <button className="btn btn-ghost btn-sm" onClick={handleAddEditableMilestone}><Plus size={14} /> Thêm mốc</button>
                    <button className="btn btn-primary btn-sm" onClick={handleSaveMilestones} disabled={selectedMilestoneIdxs.size === 0}>
                      <Check size={14} /> Lưu {selectedMilestoneIdxs.size > 0 ? `(${selectedMilestoneIdxs.size})` : ''}
                    </button>
                    <button className="btn btn-secondary btn-sm" onClick={() => handleReviseMilestones(MACRO_AI_PRESETS)} disabled={isRevisingMilestones || editableMilestoneSuggestions.length === 0}>
                      {isRevisingMilestones ? <><Loader2 size={14} className="spin" /> AI đang chỉnh...</> : <><Sparkles size={14} /> AI chỉnh lại</>}
                    </button>
                    <button className="btn btn-ghost btn-sm" onClick={() => handleGenerateMilestones(MACRO_AI_PRESETS)} disabled={isSuggestingMilestones}><RotateCcw size={14} /> Tạo batch mới</button>
                    <button className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto' }} onClick={resetAiSuggestPanel}><X size={14} /> Hủy</button>
                  </div>
                </div>
              )}
            </div>
          )}

          {macroArcs.length > 0 && (
            <div style={{ marginBottom: 'var(--space-4)' }}>
              <ArcNavigator projectId={currentProjectId} currentChapter={chapters.length > 0 ? chapters.length - 1 : 0} totalChapters={targetLength || 800} />
            </div>
          )}

          {macroArcs.length === 0 && (
            <div className="empty-state" style={{ padding: 'var(--space-4)', minHeight: 'unset' }}>
              <Flag size={32} style={{ opacity: 0.4 }} />
              <p style={{ fontSize: '13px' }}>Chưa có cột mốc nào. Nhấn “Thêm cột mốc” để bắt đầu xây đại cục.</p>
            </div>
          )}

          {macroArcs.map((macroArc, index) => (
            <SavedMacroArcCard
              key={`saved-card-${macroArc.id}`}
              macroArc={macroArc}
              index={index}
              isAnalyzing={Boolean(analyzingMacroContractKeys[getSavedMacroArcAnalyzeKey(macroArc.id)])}
              allCharacterNames={allCharacterNames}
              onUpdate={handleUpdateMacroArc}
              onDelete={handleDeleteMacroArc}
              onAnalyze={handleAnalyzeSavedMacroArc}
            />
          ))}

          {macroArcs.length > 0 && (
            <div style={{ padding: 'var(--space-2)', background: 'var(--color-surface-2)', borderRadius: 'var(--radius-sm)', fontSize: '12px', color: 'var(--color-text-muted)' }}>
              AI sẽ đọc đại cục này trước khi viết mỗi chương. Thay đổi được lưu tự động.
            </div>
          )}
        </div>
      )}
    </div>
  );
});

export default StoryBibleMacroArcSection;
