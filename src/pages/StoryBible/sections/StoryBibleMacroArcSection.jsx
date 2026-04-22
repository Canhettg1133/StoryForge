import React from 'react';
import { Check, Flag, Loader2, Plus, RotateCcw, Sparkles, TrendingUp, Wand2, X } from 'lucide-react';
import ArcNavigator from '../../../components/common/ArcNavigator';
import ChapterAnchorEditor from '../components/ChapterAnchorEditor';
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
  aiChapterAnchors,
  setAiChapterAnchors,
  aiChapterAnchorIssues,
  aiMilestoneChapterPlans,
  handleUpdateMilestoneChapterPlan,
  resetMilestoneChapterPlans,
  planningScopeStart,
  setPlanningScopeStart,
  planningScopeEnd,
  setPlanningScopeEnd,
  planningScopeSpan,
  planningScopeTargetLength,
  planningScopeHasExplicitTargetLength,
  planningScopeDefaultsToWholeStory,
  planningScopeWarnings,
  uncoveredScopeChapters,
  autoMilestoneCount,
  hasBlockingMilestonePlanIssue,
  useDefaultPlanningScope,
  useWholeStoryPlanningScope,
  showAiSuggest,
  setShowAiSuggest,
  aiMilestoneRevisionPrompt,
  setAiMilestoneRevisionPrompt,
  editableMilestoneSuggestions,
  selectedMilestoneIdxs,
  setSelectedMilestoneIdxs,
  selectedMilestonePresets,
  suggestedMilestoneCount,
  hasBlockingAiChapterAnchorIssue,
  hasBlockingSelectedEditableAnchorIssue,
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
  const chaptersCount = chapters.length;
  const nextChapterNumber = Math.max(1, chaptersCount + 1);
  const [milestoneCountDraft, setMilestoneCountDraft] = React.useState(String(aiMilestoneCount));
  const [planningScopeDraft, setPlanningScopeDraft] = React.useState({
    start: String(planningScopeStart),
    end: String(planningScopeEnd),
  });

  React.useEffect(() => {
    setMilestoneCountDraft(String(aiMilestoneCount));
  }, [aiMilestoneCount]);

  React.useEffect(() => {
    setPlanningScopeDraft({
      start: String(planningScopeStart),
      end: String(planningScopeEnd),
    });
  }, [planningScopeEnd, planningScopeStart]);

  const selectFieldValue = React.useCallback((event) => {
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

  const commitMilestoneCountDraft = React.useCallback(() => {
    const rawValue = milestoneCountDraft.trim();
    if (!rawValue) {
      setMilestoneCountDraft(String(aiMilestoneCount));
      return;
    }
    const parsed = parseInt(rawValue, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setMilestoneCountDraft(String(aiMilestoneCount));
      return;
    }
    const nextValue = Math.max(1, Math.min(20, parsed));
    setAiMilestoneCount(nextValue);
    setMilestoneCountDraft(String(nextValue));
  }, [aiMilestoneCount, milestoneCountDraft, setAiMilestoneCount]);

  const commitPlanningScopeField = React.useCallback((field) => {
    const rawValue = planningScopeDraft[field].trim();
    if (!rawValue) {
      setPlanningScopeDraft({
        start: String(planningScopeStart),
        end: String(planningScopeEnd),
      });
      return;
    }
    const parsed = parseInt(rawValue, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setPlanningScopeDraft({
        start: String(planningScopeStart),
        end: String(planningScopeEnd),
      });
      return;
    }
    if (field === 'start') setPlanningScopeStart(parsed);
    else setPlanningScopeEnd(parsed);
  }, [planningScopeDraft, planningScopeEnd, planningScopeStart, setPlanningScopeEnd, setPlanningScopeStart]);

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
            Định nghĩa các cột mốc lớn của truyện. AI sẽ đọc đại cục này trước khi planner hoặc validator sinh dàn ý chương.
          </p>

          {showAiSuggest && (
            <div style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-accent)', borderRadius: 'var(--radius-md)', padding: 'var(--space-3)', marginBottom: 'var(--space-3)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: 'var(--space-2)', fontSize: '13px', fontWeight: 600 }}>
                <Wand2 size={14} style={{ color: 'var(--color-accent)' }} />
                Gợi ý đại cục bằng AI
              </div>

              <textarea
                className="textarea"
                rows={2}
                value={aiIdeaInput}
                onChange={(event) => setAiIdeaInput(event.target.value)}
                placeholder="Mô tả ngắn về truyện hoặc đoạn truyện bạn muốn hoạch định..."
                style={{ marginBottom: 'var(--space-2)' }}
              />

              <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'flex-end', marginBottom: 'var(--space-2)', flexWrap: 'wrap' }}>
                <div className="form-group" style={{ marginBottom: 0, width: '180px' }}>
                  <label className="form-label">Số lượng cột mốc muốn tạo</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    className="input"
                    value={milestoneCountDraft}
                    onChange={(event) => setMilestoneCountDraft(event.target.value)}
                    onBlur={commitMilestoneCountDraft}
                    onFocus={selectFieldValue}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        commitMilestoneCountDraft();
                      }
                    }}
                  />
                  <div className="form-hint" style={{ marginTop: '6px' }}>Đề xuất theo độ dài dự kiến: {suggestedMilestoneCount} cột mốc</div>
                </div>
                <button type="button" className="btn btn-ghost btn-sm" style={{ marginBottom: '6px' }} onClick={() => setAiMilestoneCount(suggestedMilestoneCount)}>Dùng đề xuất</button>
                <div className="form-group" style={{ marginBottom: 0, flex: 1, minWidth: '240px' }}>
                  <label className="form-label">Yêu cầu riêng</label>
                  <textarea className="textarea" rows={2} value={aiMilestoneRequirements} onChange={(event) => setAiMilestoneRequirements(event.target.value)} placeholder="VD: mở đầu chậm, giữ bí mật lớn tới cuối đoạn này, chưa cho payoff sớm..." />
                </div>
              </div>

              <ChapterAnchorEditor
                title="Yeu cau bat buoc theo chuong"
                hint="Structured anchor dung cho cac yeu cau phai dat o dung chapter trong batch nay."
                anchors={aiChapterAnchors}
                onChange={setAiChapterAnchors}
                scopeStart={planningScopeStart}
                scopeEnd={planningScopeEnd}
              />
              {aiChapterAnchorIssues.length > 0 && (
                <div className="bible-planning-scope__warnings" style={{ marginBottom: 'var(--space-2)' }}>
                  {aiChapterAnchorIssues.map((issue, index) => (
                    <div
                      key={`${issue.code}-${issue.anchorId || index}`}
                      className={`bible-planning-scope__warning bible-planning-scope__warning--${issue.severity === 'error' ? 'warning' : 'info'}`}
                    >
                      {issue.message}
                    </div>
                  ))}
                </div>
              )}

              <div className="bible-planning-scope">
                <div className="bible-planning-scope__header">
                  <div>
                    <strong>Phạm vi lập đại cục</strong>
                    <span className="form-hint">
                      Tách riêng độ dài toàn truyện với đoạn truyện bạn muốn AI hoạch định lần này.
                    </span>
                  </div>
                  <div className="bible-planning-scope__chips">
                    <span className="bible-planning-scope__chip">
                      {planningScopeHasExplicitTargetLength
                        ? `Toàn truyện dự kiến: ${planningScopeTargetLength} chương`
                        : `Độ dài tạm dùng: ${planningScopeTargetLength} chương`}
                    </span>
                    <span className="bible-planning-scope__chip">Đã có: {chaptersCount} chương</span>
                    <span className="bible-planning-scope__chip">Đợt này: {planningScopeSpan} chương</span>
                  </div>
                </div>

                <div className="bible-planning-scope__grid">
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label">Từ chương</label>
                    <input
                      type="text"
                      inputMode="numeric"
                      min="1"
                      max={planningScopeHasExplicitTargetLength ? planningScopeTargetLength : undefined}
                      className="input"
                      value={planningScopeDraft.start}
                      onChange={(event) => setPlanningScopeDraft((prev) => ({ ...prev, start: event.target.value }))}
                      onBlur={() => commitPlanningScopeField('start')}
                      onFocus={selectFieldValue}
                    />
                  </div>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label">Đến chương</label>
                    <input
                      type="text"
                      inputMode="numeric"
                      min={planningScopeStart}
                      max={planningScopeHasExplicitTargetLength ? planningScopeTargetLength : undefined}
                      className="input"
                      value={planningScopeDraft.end}
                      onChange={(event) => setPlanningScopeDraft((prev) => ({ ...prev, end: event.target.value }))}
                      onBlur={() => commitPlanningScopeField('end')}
                      onFocus={selectFieldValue}
                    />
                  </div>
                </div>

                <div className="bible-planning-scope__actions">
                  <button type="button" className="btn btn-ghost btn-sm" onClick={useDefaultPlanningScope}>
                    Dùng đoạn kế tiếp mặc định
                  </button>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={useWholeStoryPlanningScope}>
                    Bao phủ toàn bộ truyện
                  </button>
                </div>

                <div className="bible-planning-scope__summary">
                  AI sẽ chỉ lập đại cục cho chương {planningScopeStart}-{planningScopeEnd}.{' '}
                  {planningScopeDefaultsToWholeStory
                    ? 'Phạm vi hiện tại đang phủ toàn bộ độ dài truyện dự kiến.'
                    : `Phạm vi này tách khỏi độ dài toàn truyện, nên AI không được mặc định kéo ngược về chương 1 khi chương kế tiếp hiện là ${nextChapterNumber}.`}
                </div>

                {autoMilestoneCount > 0 && (
                  <div className="form-hint" style={{ marginTop: '-4px' }}>
                    Còn {autoMilestoneCount} cột mốc để AI tự chia trong {uncoveredScopeChapters} chương trống.
                  </div>
                )}

                {planningScopeWarnings.length > 0 && (
                  <div className="bible-planning-scope__warnings">
                    {planningScopeWarnings.map((warning) => (
                      <div
                        key={warning.code}
                        className={`bible-planning-scope__warning bible-planning-scope__warning--${warning.level}`}
                      >
                        {warning.message}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="bible-milestone-plan-panel">
                <div className="bible-milestone-plan-panel__header">
                  <div>
                    <strong>Phạm vi riêng từng cột mốc</strong>
                    <span className="form-hint">
                      Tùy chọn. Để trống một cột mốc thì AI tự chia trong phạm vi còn lại. Nhập đủ từ-đến nếu bạn muốn khóa riêng cột mốc đó.
                    </span>
                  </div>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={resetMilestoneChapterPlans}>
                    Để AI tự chia tất cả
                  </button>
                </div>

                <div className="bible-milestone-plan-list">
                  {aiMilestoneChapterPlans.map((plan, index) => (
                    <div key={`milestone-plan-${index}`} className="bible-milestone-plan-row">
                      <div className="bible-milestone-plan-row__label">
                        <strong>Cột mốc {index + 1}</strong>
                        <span>{plan.chapter_from || plan.chapter_to ? 'Đang khóa tay' : 'Tự động phân bổ'}</span>
                      </div>
                      <div className="bible-milestone-plan-row__inputs">
                        <input
                          type="text"
                          inputMode="numeric"
                          className="input"
                          placeholder="Từ"
                          value={plan.chapter_from || (index === 0 ? String(planningScopeStart) : '')}
                          onChange={(event) => handleUpdateMilestoneChapterPlan(index, 'chapter_from', event.target.value)}
                          onFocus={selectFieldValue}
                        />
                        <input
                          type="text"
                          inputMode="numeric"
                          className="input"
                          placeholder="Đến"
                          value={plan.chapter_to}
                          onChange={(event) => handleUpdateMilestoneChapterPlan(index, 'chapter_to', event.target.value)}
                          onFocus={selectFieldValue}
                        />
                      </div>
                    </div>
                  ))}
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
                <button className="btn btn-primary btn-sm" onClick={() => handleGenerateMilestones(MACRO_AI_PRESETS)} disabled={isSuggestingMilestones || hasBlockingMilestonePlanIssue || hasBlockingAiChapterAnchorIssue}>
                  {isSuggestingMilestones ? <><Loader2 size={14} className="spin" /> Đang gợi ý...</> : <><Sparkles size={14} /> Gợi ý</>}
                </button>
                <button className="btn btn-ghost btn-sm" onClick={resetAiSuggestPanel}><X size={14} /> Hủy</button>
              </div>

              {(hasBlockingMilestonePlanIssue || hasBlockingAiChapterAnchorIssue) && (
                <div className="bible-planning-scope__warning bible-planning-scope__warning--warning">
                  Có lỗi logic trong phạm vi riêng từng cột mốc. Sửa các cảnh báo bên trên trước khi nhờ AI tạo batch.
                </div>
              )}

              {!hasBlockingMilestonePlanIssue && !hasBlockingAiChapterAnchorIssue && editableMilestoneSuggestions.length > 0 && (
                <div style={{ marginTop: 'var(--space-3)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-2)' }}>
                    <span style={{ fontSize: '12px', color: 'var(--color-text-muted)' }}>AI đã tạo {editableMilestoneSuggestions.length} cột mốc. Bạn có thể sửa tay hoặc yêu cầu AI chỉnh lại đúng batch này.</span>
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
                    <textarea className="textarea" rows={2} value={aiMilestoneRevisionPrompt} onChange={(event) => setAiMilestoneRevisionPrompt(event.target.value)} placeholder="VD: kéo dài buildup đoạn đầu, giữ twist ở gần cuối phạm vi, tăng trả giá ở cột mốc 3..." />
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
                  <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-2)', flexWrap: 'wrap' }}>
                    <button className="btn btn-ghost btn-sm" onClick={handleAddEditableMilestone}><Plus size={14} /> Thêm mốc</button>
                    <button className="btn btn-primary btn-sm" onClick={handleSaveMilestones} disabled={selectedMilestoneIdxs.size === 0 || hasBlockingSelectedEditableAnchorIssue}>
                      <Check size={14} /> Lưu {selectedMilestoneIdxs.size > 0 ? `(${selectedMilestoneIdxs.size})` : ''}
                    </button>
                    <button className="btn btn-secondary btn-sm" onClick={() => handleReviseMilestones(MACRO_AI_PRESETS)} disabled={isRevisingMilestones || editableMilestoneSuggestions.length === 0 || hasBlockingMilestonePlanIssue || hasBlockingAiChapterAnchorIssue}>
                      {isRevisingMilestones ? <><Loader2 size={14} className="spin" /> AI đang chỉnh...</> : <><Sparkles size={14} /> AI chỉnh lại</>}
                    </button>
                    <button className="btn btn-ghost btn-sm" onClick={() => handleGenerateMilestones(MACRO_AI_PRESETS)} disabled={isSuggestingMilestones || hasBlockingMilestonePlanIssue || hasBlockingAiChapterAnchorIssue}><RotateCcw size={14} /> Tạo batch mới</button>
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
              AI sẽ đọc đại cục này trước khi viết hoặc kiểm tra planner. Mọi thay đổi được lưu tự động.
            </div>
          )}
        </div>
      )}
    </div>
  );
});

export default StoryBibleMacroArcSection;
