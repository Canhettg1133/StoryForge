import React, { useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Loader2,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react';
import useProjectStore from '../../stores/projectStore';
import useCodexStore from '../../stores/codexStore';
import useCanonStore from '../../stores/canonStore';
import CanonRepairDialog from '../canon/CanonRepairDialog';
import { getCanonReportTitle } from '../../services/canon/reportLabels';
import { toVietnameseErrorMessage } from '../../utils/errorMessages';
import useModalAccessibility from '../../hooks/useModalAccessibility.js';
import './ContinuityBar.css';

function getOutcomeClass(outcome) {
  if (!outcome) return '';
  if (outcome.ok) return 'continuity-bar-feedback--success';
  if (outcome.kind === 'blocked') return 'continuity-bar-feedback--warning';
  return 'continuity-bar-feedback--error';
}

function getReportKey(report) {
  return report?.id || `${report?.rule_code || 'report'}-${report?.message || ''}-${report?.evidence || ''}`;
}

function isSceneCastReport(report) {
  return [
    'OUT_OF_SCENE_CHARACTER_DIALOGUE',
    'OUT_OF_SCENE_CHARACTER_ACTION',
  ].includes(report?.rule_code);
}

export default function ContinuityBar({ isMobileLayout = false }) {
  const {
    chapters,
    scenes,
    activeChapterId,
    activeSceneId,
    currentProject,
    completingChapterId,
    chapterCompletionById,
    runChapterCompletion,
    updateScene,
  } = useProjectStore();
  const { chapterMetas, loadCodex } = useCodexStore();
  const {
    chapterCanon,
    loadChapterCanon,
    canonicalizeChapter,
    canonicalizing,
    rebuilding,
    repairPreview,
    repairChapterRevision,
    saveRepairDraftRevision,
    savingRepairDraft,
    lastActionOutcome,
    clearRepairText,
    clearActionOutcome,
  } = useCanonStore();
  const [expanded, setExpanded] = useState(false);
  const [issuesOpen, setIssuesOpen] = useState(false);
  const [ignoredReportKeys, setIgnoredReportKeys] = useState(() => new Set());
  const [completionNotice, setCompletionNotice] = useState('');
  const [completionNoticeType, setCompletionNoticeType] = useState('error');
  const issuesDialogRef = useModalAccessibility({
    open: issuesOpen,
    onClose: () => setIssuesOpen(false),
  });

  useEffect(() => {
    if (isMobileLayout) {
      setExpanded(false);
    }
  }, [isMobileLayout, activeChapterId, activeSceneId]);

  useEffect(() => {
    clearActionOutcome();
    clearRepairText();
    setIssuesOpen(false);
    setCompletionNotice('');
    setCompletionNoticeType('error');
    setIgnoredReportKeys(new Set());
  }, [activeChapterId, activeSceneId, clearActionOutcome, clearRepairText]);

  useEffect(() => {
    if (currentProject?.id) loadCodex(currentProject.id);
  }, [currentProject?.id, loadCodex]);

  useEffect(() => {
    if (currentProject?.id && activeChapterId) {
      loadChapterCanon(currentProject.id, activeChapterId, activeSceneId || null);
    }
  }, [currentProject?.id, activeChapterId, activeSceneId, loadChapterCanon]);

  const currentChapterIndex = useMemo(() => (
    chapters.findIndex((chapter) => chapter.id === activeChapterId)
  ), [chapters, activeChapterId]);

  const prevChapterInfo = useMemo(() => {
    if (currentChapterIndex <= 0) return null;

    const prevChapter = chapters[currentChapterIndex - 1];
    if (!prevChapter) return null;

    const meta = chapterMetas.find((item) => item.chapter_id === prevChapter.id);
    const summary = meta?.summary || prevChapter.summary || null;
    if (!summary) return null;

    return {
      title: prevChapter.title || `Chapter ${currentChapterIndex}`,
      summary,
    };
  }, [currentChapterIndex, chapters, chapterMetas]);

  const currentChapterInfo = useMemo(() => {
    const chapter = chapters.find((item) => item.id === activeChapterId);
    if (!chapter) return null;
    return {
      title: chapter.title || `Chương ${currentChapterIndex + 1}`,
      number: currentChapterIndex >= 0 ? currentChapterIndex + 1 : null,
    };
  }, [chapters, activeChapterId, currentChapterIndex]);
  const activeChapter = useMemo(
    () => chapters.find((item) => item.id === activeChapterId) || null,
    [chapters, activeChapterId],
  );
  const completionState = activeChapterId ? (chapterCompletionById[activeChapterId] || {}) : {};
  const isCompletingChapter = !!activeChapterId && (completionState.running || completingChapterId === activeChapterId);
  const chapterDone = activeChapter?.status === 'done';

  const canonStatusLabel = useMemo(() => {
    const status = chapterCanon?.status || 'draft';
    if (chapterCanon?.isStale) return 'Cần phân tích lại';
    if (status === 'canonical') return 'Đã phân tích';
    if (status === 'blocked') return 'Bị chặn';
    if (status === 'invalidated') return 'Vô hiệu';
    if (status === 'has_warnings') return 'Đã phân tích';
    return 'Chưa phân tích';
  }, [chapterCanon?.isStale, chapterCanon?.status]);

  const canonStatusKey = chapterCanon?.isStale ? 'stale' : (chapterCanon?.status || 'draft');
  const canonStatusClass = `continuity-bar-status continuity-bar-status--${canonStatusKey}`;
  const canonIsFreshAnalyzed = !!chapterCanon?.isFresh
    && ['canonical', 'has_warnings'].includes(chapterCanon?.status)
    && (chapterCanon?.errorCount || 0) === 0;
  const canonActionLabel = chapterCanon?.status && chapterCanon.status !== 'draft'
    ? 'Phân tích lại'
    : (chapterCanon?.isStale ? 'Phân tích lại' : (isMobileLayout ? 'Phân tích' : 'Phân tích sự thật'));
  const canonActionClass = canonIsFreshAnalyzed
    ? 'continuity-bar-btn--success'
    : chapterCanon?.isStale
      ? 'continuity-bar-btn--warning'
      : chapterCanon?.status === 'blocked'
        ? 'continuity-bar-btn--danger'
        : '';
  const canonStatusOk = canonIsFreshAnalyzed || (chapterCanon?.status === 'canonical' && !chapterCanon?.isStale);
  const rawReports = chapterCanon?.reports || [];
  const reports = useMemo(
    () => rawReports.filter((report) => !ignoredReportKeys.has(getReportKey(report))),
    [rawReports, ignoredReportKeys],
  );
  const activeRevisionId = chapterCanon?.revision?.id || chapterCanon?.commit?.current_revision_id || null;
  const scopedRepairPreview = repairPreview?.chapterId === activeChapterId ? repairPreview : null;
  const hasCanonIssues = reports.length > 0;
  const canonIssueLabel = (chapterCanon?.errorCount || 0) > 0
    ? `${chapterCanon.errorCount} lỗi canon`
    : (chapterCanon?.warningCount || 0) > 0
      ? `${chapterCanon.warningCount} cảnh báo`
      : `${reports.length} thông báo`;
  const mobileCanonStatusLabel = (chapterCanon?.errorCount || 0) > 0
    ? `${chapterCanon.errorCount} lỗi canon`
    : (chapterCanon?.warningCount || 0) > 0
      ? `${chapterCanon.warningCount} cảnh báo`
      : canonStatusLabel;
  const completionLabel = isCompletingChapter
    ? 'Đang hoàn thành'
    : (chapterDone ? 'Đã hoàn thành' : 'Hoàn thành chương');
  const desktopCompletionClass = chapterDone
    ? 'continuity-bar-status--completed'
    : 'continuity-bar-status--completion';
  const mobileCompletionClass = chapterDone
    ? 'continuity-bar-btn--success'
    : 'continuity-bar-btn--completion';
  const canCompleteChapter = !!activeChapterId && !canonicalizing && !rebuilding && !isCompletingChapter && !chapterDone;

  const openIssuesDialog = (event) => {
    event.stopPropagation();
    if (hasCanonIssues) {
      setIssuesOpen(true);
    }
  };

  const handleCanonicalize = async (event) => {
    event.stopPropagation();
    if (!currentProject?.id || !activeChapterId) return;
    await canonicalizeChapter(currentProject.id, activeChapterId);
  };

  const handleCompleteChapter = async (event) => {
    event.stopPropagation();
    if (!activeChapterId || chapterDone) return;
    setCompletionNotice('');
    try {
      const result = await runChapterCompletion(activeChapterId, { mode: 'manual' });
      if (!result) return;
      if (currentProject?.id) {
        await Promise.all([
          loadChapterCanon(currentProject.id, activeChapterId, activeSceneId || null),
          loadCodex(currentProject.id),
        ]);
      }
      if (result.kind === 'empty') {
        setCompletionNoticeType('error');
        setCompletionNotice('Chương chưa có nội dung để hoàn thành.');
        return;
      }
      setCompletionNoticeType(result.ok ? 'success' : 'error');
      setCompletionNotice(result.message || (result.ok ? 'Đã hoàn thành chương.' : 'Không thể hoàn thành chương.'));
    } catch (error) {
      console.error('[ContinuityBar] Chapter completion failed:', error);
      setCompletionNoticeType('error');
      setCompletionNotice(toVietnameseErrorMessage(error, 'Không thể hoàn thành chương.'));
    }
  };

  const handleRepair = async (reportId = null) => {
    if (!currentProject?.id || !activeChapterId || !activeRevisionId) return;
    try {
      await repairChapterRevision({
        projectId: currentProject.id,
        chapterId: activeChapterId,
        revisionId: activeRevisionId,
        reportId,
      });
    } catch {
      // Store already carries the actionable error state for the dialog/banner.
    }
  };

  const handleAddReportCharacterToScene = async (report) => {
    const characterId = Array.isArray(report?.related_entity_ids) ? report.related_entity_ids[0] : null;
    if (!activeSceneId || !characterId) return;
    const activeScene = scenes.find((scene) => scene.id === activeSceneId);
    if (!activeScene) return;
    let charactersPresent = [];
    try {
      charactersPresent = JSON.parse(activeScene.characters_present || '[]');
    } catch {
      charactersPresent = [];
    }
    if (!charactersPresent.some((id) => String(id) === String(characterId))) {
      await updateScene(activeSceneId, {
        characters_present: JSON.stringify([...charactersPresent, characterId]),
      });
    }
    setIgnoredReportKeys((current) => new Set([...current, getReportKey(report)]));
  };

  const handleIgnoreReport = (report) => {
    setIgnoredReportKeys((current) => new Set([...current, getReportKey(report)]));
  };

  const handleSaveDraft = async () => {
    if (!currentProject?.id || !activeChapterId || !activeRevisionId || !scopedRepairPreview?.text) return;
    try {
      await saveRepairDraftRevision({
        projectId: currentProject.id,
        chapterId: activeChapterId,
        revisionId: activeRevisionId,
        reportId: scopedRepairPreview.reportId || null,
        chapterText: scopedRepairPreview.text,
      });
      setIssuesOpen(false);
    } catch {
      // Surface handled via store outcome.
    }
  };

  const handleCopyRepair = async () => {
    if (!scopedRepairPreview?.text) return;
    try {
      await navigator.clipboard.writeText(scopedRepairPreview.text);
    } catch (error) {
      console.warn('[ContinuityBar] Failed to copy repair preview:', error);
    }
  };

  if (!prevChapterInfo && !chapterCanon && !activeChapterId) return null;

  return (
    <>
      <div className={`continuity-bar ${expanded ? 'continuity-bar--expanded' : ''} ${isMobileLayout ? 'continuity-bar--mobile' : ''} ${isMobileLayout && !prevChapterInfo ? 'continuity-bar--mobile-compact' : ''}`}>
        <div className="continuity-bar-header" onClick={() => setExpanded((value) => !value)}>
          {(!isMobileLayout || prevChapterInfo) && (
            <div className="continuity-bar-left">
              {!isMobileLayout && (
                <div className="continuity-bar-current" role="group" aria-label="Chương hiện tại">
                  <span
                    className="continuity-bar-title"
                    title={currentChapterInfo?.title || 'Chương hiện tại'}
                  >
                    {currentChapterInfo?.title || 'Chương hiện tại'}
                  </span>
                  {activeChapterId && (chapterDone ? (
                    <span className={`continuity-bar-status ${desktopCompletionClass}`} title="Chương đã hoàn thành">
                      <CheckCircle2 size={12} />
                      {completionLabel}
                    </span>
                  ) : (
                    <button
                      type="button"
                      className={`continuity-bar-status continuity-bar-status--button ${desktopCompletionClass}`}
                      onClick={handleCompleteChapter}
                      disabled={!canCompleteChapter}
                      title="Hoàn thành chương và chạy phân tích sự thật"
                    >
                      {isCompletingChapter ? <Loader2 size={12} className="spin" /> : <Sparkles size={12} />}
                      {completionLabel}
                    </button>
                  ))}
                  {hasCanonIssues ? (
                    <button
                      type="button"
                      className={`${canonStatusClass} continuity-bar-status--button`}
                      onClick={openIssuesDialog}
                      title="Mở chi tiết lỗi canon"
                    >
                      {canonStatusOk ? <ShieldCheck size={12} /> : <ShieldAlert size={12} />}
                      {canonStatusLabel}
                    </button>
                  ) : (
                    <span className={canonStatusClass}>
                      {canonStatusOk ? <ShieldCheck size={12} /> : <ShieldAlert size={12} />}
                      {canonStatusLabel}
                    </span>
                  )}
                  {hasCanonIssues && (
                    <button
                      type="button"
                      className={`continuity-bar-issue-trigger ${(chapterCanon?.errorCount || 0) > 0 ? 'continuity-bar-issue-trigger--error' : ''}`}
                      onClick={openIssuesDialog}
                      title="Mở chi tiết lỗi canon"
                    >
                      {canonIssueLabel}
                    </button>
                  )}
                </div>
              )}
            {prevChapterInfo && (
              <div className="continuity-bar-previous">
                <Clock size={13} />
                <span className="continuity-bar-label">{isMobileLayout ? 'Chương trước:' : 'Tóm tắt chương trước:'}</span>
                <span className="continuity-bar-title continuity-bar-title--previous">{prevChapterInfo.title}</span>
              </div>
            )}
            </div>
          )}

          <div className="continuity-bar-actions" onClick={(event) => event.stopPropagation()}>
            {isMobileLayout && (
              <button
                type="button"
                className={`continuity-bar-btn ${mobileCompletionClass}`}
                onClick={handleCompleteChapter}
                disabled={!canCompleteChapter}
              >
                {isCompletingChapter ? <Loader2 size={12} className="spin" /> : (chapterDone ? <CheckCircle2 size={12} /> : <Sparkles size={12} />)}
                {completionLabel}
              </button>
            )}
            {isMobileLayout && (
              hasCanonIssues ? (
                <button
                  type="button"
                  className={`${canonStatusClass} continuity-bar-status continuity-bar-status--button continuity-bar-status--mobile-pill`}
                  onClick={openIssuesDialog}
                  title="Mở chi tiết lỗi canon"
                >
                  {(chapterCanon?.errorCount || 0) > 0 ? <ShieldAlert size={12} /> : <ShieldCheck size={12} />}
                  {mobileCanonStatusLabel}
                </button>
              ) : (
                <span className={`${canonStatusClass} continuity-bar-status continuity-bar-status--mobile-pill`}>
                  {canonStatusOk ? <ShieldCheck size={12} /> : <ShieldAlert size={12} />}
                  {mobileCanonStatusLabel}
                </span>
              )
            )}
            {isMobileLayout && (
              <button type="button" className={`continuity-bar-btn continuity-bar-btn--canon ${canonActionClass}`} onClick={handleCanonicalize} disabled={canonicalizing || rebuilding || !activeChapterId}>
                {canonicalizing ? <Loader2 size={12} className="spin" /> : <ShieldCheck size={12} />}
                {canonActionLabel}
              </button>
            )}
            {!isMobileLayout && <button type="button" className={`continuity-bar-btn continuity-bar-btn--canon ${canonActionClass}`} onClick={handleCanonicalize} disabled={canonicalizing || rebuilding || !activeChapterId}>
              {canonicalizing ? <Loader2 size={12} className="spin" /> : <ShieldCheck size={12} />}
              {canonActionLabel}
            </button>}
          </div>

          {(!isMobileLayout || prevChapterInfo) && (expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />)}
        </div>

        {completionNotice ? (
          <div className={`continuity-bar-feedback continuity-bar-feedback--${completionNoticeType}`} role="alert">
            {completionNotice}
          </div>
        ) : null}

        {expanded && (
          <div className="continuity-bar-body">
            {lastActionOutcome?.message && (
              <div className={`continuity-bar-feedback ${getOutcomeClass(lastActionOutcome)}`}>
                {lastActionOutcome.message}
              </div>
            )}
            {prevChapterInfo && (
              <div className="continuity-bar-summary-block">
                <div className="continuity-bar-summary-heading">
                  Tóm tắt để nối tiếp từ {prevChapterInfo.title}
                </div>
                <p className="continuity-bar-summary">{prevChapterInfo.summary}</p>
              </div>
            )}
          </div>
        )}
      </div>

      {issuesOpen && (
        <div className="modal-overlay" onClick={() => setIssuesOpen(false)}>
          <div
            ref={issuesDialogRef}
            className="modal continuity-issues-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="Kiểm tra canon"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="continuity-issues-dialog__header">
              <div>
                <div className="continuity-issues-dialog__eyebrow">
                  <ShieldAlert size={14} />
                  Kiểm tra canon
                </div>
                <h3>Lỗi và cảnh báo của {currentChapterInfo?.title || 'chương hiện tại'}</h3>
              </div>
              <button
                type="button"
                className="btn btn-ghost btn-icon btn-sm"
                onClick={() => setIssuesOpen(false)}
                aria-label="Đóng lỗi canon"
              >
                <X size={16} />
              </button>
            </div>

            <div className="continuity-issues-dialog__body">
              {lastActionOutcome?.message && (
                <div className={`continuity-bar-feedback ${getOutcomeClass(lastActionOutcome)}`}>
                  {lastActionOutcome.message}
                </div>
              )}

              {reports.length > 0 ? (
                <div className="continuity-issues-list">
                  {reports.map((report) => (
                    <div key={report.id || `${report.rule_code}-${report.message}`} className={`continuity-issue continuity-issue--${report.severity || 'info'}`}>
              <div className="continuity-issue__rule">{getCanonReportTitle(report)}</div>
                      <div className="continuity-issue__message">{report.message}</div>
                      {report.evidence && <div className="continuity-issue__evidence">{report.evidence}</div>}
                      {isSceneCastReport(report) && (
                        <div className="continuity-issue__actions">
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            onClick={() => handleAddReportCharacterToScene(report)}
                            disabled={!activeSceneId || !report.related_entity_ids?.length}
                          >
                            Thêm vào cảnh
                          </button>
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            onClick={() => handleRepair(report.id || null)}
                            disabled={!activeRevisionId || scopedRepairPreview?.loading}
                          >
                            Yêu cầu AI sửa
                          </button>
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            onClick={() => handleIgnoreReport(report)}
                          >
                            Bỏ qua
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="continuity-issues-empty">
                  Không còn lỗi canon cho chương này.
                </div>
              )}
            </div>

            <div className="modal-actions continuity-issues-dialog__actions">
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => handleRepair(null)}
                disabled={!activeRevisionId || reports.length === 0 || scopedRepairPreview?.loading}
              >
                {scopedRepairPreview?.loading ? <Loader2 size={16} className="spin" /> : <Sparkles size={16} />}
                Gợi ý sửa tất cả lỗi canon
              </button>
            </div>
          </div>
        </div>
      )}

      <CanonRepairDialog
        open={Boolean(scopedRepairPreview)}
        preview={scopedRepairPreview}
        saving={savingRepairDraft}
        outcome={lastActionOutcome}
        onClose={clearRepairText}
        onRetry={() => handleRepair(scopedRepairPreview?.reportId || null)}
        onCopy={handleCopyRepair}
        onSaveDraft={handleSaveDraft}
      />
    </>
  );
}
