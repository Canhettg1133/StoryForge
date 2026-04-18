import React, { useEffect, useMemo, useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  Clock,
  Loader2,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import useProjectStore from '../../stores/projectStore';
import useCodexStore from '../../stores/codexStore';
import useCanonStore from '../../stores/canonStore';
import CanonRepairDialog from '../canon/CanonRepairDialog';
import './ContinuityBar.css';

function getOutcomeClass(outcome) {
  if (!outcome) return '';
  if (outcome.ok) return 'continuity-bar-feedback--success';
  if (outcome.kind === 'blocked') return 'continuity-bar-feedback--warning';
  return 'continuity-bar-feedback--error';
}

export default function ContinuityBar({ isMobileLayout = false }) {
  const { chapters, activeChapterId, activeSceneId, currentProject } = useProjectStore();
  const { chapterMetas, loadCodex } = useCodexStore();
  const {
    chapterCanon,
    loadChapterCanon,
    canonicalizeChapter,
    rebuildCanonFromChapter,
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

  useEffect(() => {
    if (isMobileLayout) {
      setExpanded(false);
    }
  }, [isMobileLayout, activeChapterId, activeSceneId]);

  useEffect(() => {
    clearActionOutcome();
    clearRepairText();
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
      title: chapter.title || `Chuong ${currentChapterIndex + 1}`,
      number: currentChapterIndex >= 0 ? currentChapterIndex + 1 : null,
    };
  }, [chapters, activeChapterId, currentChapterIndex]);

  const canonStatusLabel = useMemo(() => {
    const status = chapterCanon?.status || 'draft';
    if (status === 'canonical') return 'Da phan tich';
    if (status === 'blocked') return 'Bi chan';
    if (status === 'invalidated') return 'Vo hieu';
    if (status === 'has_warnings') return 'Da phan tich';
    return 'Chua phan tich';
  }, [chapterCanon?.status]);

  const canonStatusClass = `continuity-bar-status continuity-bar-status--${chapterCanon?.status || 'draft'}`;
  const reports = chapterCanon?.reports || [];
  const activeRevisionId = chapterCanon?.revision?.id || chapterCanon?.commit?.current_revision_id || null;
  const scopedRepairPreview = repairPreview?.chapterId === activeChapterId ? repairPreview : null;

  const handleCanonicalize = async (event) => {
    event.stopPropagation();
    if (!currentProject?.id || !activeChapterId) return;
    await canonicalizeChapter(currentProject.id, activeChapterId);
  };

  const handleRebuild = async (event) => {
    event.stopPropagation();
    if (!currentProject?.id || !activeChapterId) return;
    await rebuildCanonFromChapter(currentProject.id, activeChapterId);
  };

  const handleRepair = async (reportId) => {
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
      <div className={`continuity-bar ${expanded ? 'continuity-bar--expanded' : ''} ${isMobileLayout ? 'continuity-bar--mobile' : ''}`}>
        <div className="continuity-bar-header" onClick={() => setExpanded((value) => !value)}>
          <div className="continuity-bar-left">
            <div className="continuity-bar-current">
              {chapterCanon?.status === 'canonical' ? <ShieldCheck size={13} /> : <ShieldAlert size={13} />}
              <span className="continuity-bar-label">Chuong hien tai:</span>
              <span className="continuity-bar-title">{currentChapterInfo?.title || 'Chuong hien tai'}</span>
              <span className={canonStatusClass}>
                {chapterCanon?.status === 'canonical' ? <ShieldCheck size={12} /> : <ShieldAlert size={12} />}
                {canonStatusLabel}
              </span>
            </div>
            {prevChapterInfo && (
              <div className="continuity-bar-previous">
                <Clock size={13} />
                <span className="continuity-bar-label">Tom tat chuong truoc:</span>
                <span className="continuity-bar-title continuity-bar-title--previous">{prevChapterInfo.title}</span>
              </div>
            )}
            {(chapterCanon?.warningCount || 0) > 0 && (
              <span className="continuity-bar-count">{chapterCanon.warningCount} canh bao</span>
            )}
            {(chapterCanon?.errorCount || 0) > 0 && (
              <span className="continuity-bar-count continuity-bar-count--error">{chapterCanon.errorCount} loi</span>
            )}
          </div>

          <div className="continuity-bar-actions" onClick={(event) => event.stopPropagation()}>
            <button type="button" className="continuity-bar-btn" onClick={handleCanonicalize} disabled={canonicalizing || rebuilding || !activeChapterId}>
              {canonicalizing ? <Loader2 size={12} className="spin" /> : <ShieldCheck size={12} />}
              Phan tich su that
            </button>
            <button type="button" className="continuity-bar-btn continuity-bar-btn--ghost" onClick={handleRebuild} disabled={canonicalizing || rebuilding || !activeChapterId}>
              {rebuilding ? <Loader2 size={12} className="spin" /> : <RotateCcw size={12} />}
              Rebuild
            </button>
          </div>

          {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        </div>

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
                  Tom tat de noi tiep tu {prevChapterInfo.title}
                </div>
                <p className="continuity-bar-summary">{prevChapterInfo.summary}</p>
              </div>
            )}
            {reports.length > 0 && (
              <div className="continuity-bar-reports">
                {reports.slice(0, 4).map((report) => (
                  <div key={report.id || `${report.rule_code}-${report.message}`} className={`continuity-bar-report continuity-bar-report--${report.severity}`}>
                    <div className="continuity-bar-report__content">
                      <div>
                        <strong>{report.rule_code || report.severity}</strong>: {report.message}
                      </div>
                      <button
                        type="button"
                        className="continuity-bar-btn continuity-bar-btn--ghost"
                        onClick={() => handleRepair(report.id)}
                        disabled={!activeRevisionId || scopedRepairPreview?.loading}
                      >
                        {scopedRepairPreview?.loading && scopedRepairPreview?.reportId === report.id ? <Loader2 size={12} className="spin" /> : <Sparkles size={12} />}
                        Goi y sua
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <CanonRepairDialog
        open={Boolean(scopedRepairPreview)}
        preview={scopedRepairPreview}
        saving={savingRepairDraft}
        onClose={clearRepairText}
        onCopy={handleCopyRepair}
        onSaveDraft={handleSaveDraft}
      />
    </>
  );
}
