import React, { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, Clock, Loader2, RotateCcw, ShieldAlert, ShieldCheck } from 'lucide-react';
import useProjectStore from '../../stores/projectStore';
import useCodexStore from '../../stores/codexStore';
import useCanonStore from '../../stores/canonStore';
import './ContinuityBar.css';

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
  } = useCanonStore();
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (isMobileLayout) {
      setExpanded(false);
    }
  }, [isMobileLayout, activeChapterId, activeSceneId]);

  useEffect(() => {
    if (currentProject?.id) loadCodex(currentProject.id);
  }, [currentProject?.id]);

  useEffect(() => {
    if (currentProject?.id && activeChapterId) {
      loadChapterCanon(currentProject.id, activeChapterId, activeSceneId || null);
    }
  }, [currentProject?.id, activeChapterId, activeSceneId]);

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

  const currentChapterTitle = useMemo(() => {
    const chapter = chapters.find((item) => item.id === activeChapterId);
    return chapter?.title || '';
  }, [chapters, activeChapterId]);

  const canonStatusLabel = useMemo(() => {
    const status = chapterCanon?.status || 'draft';
    if (status === 'canonical') return 'Chinh thuc';
    if (status === 'blocked') return 'Bi chan';
    if (status === 'invalidated') return 'Vo hieu';
    if (status === 'has_warnings') return 'Co canh bao';
    return 'Chua phan tich';
  }, [chapterCanon?.status]);

  const canonStatusClass = `continuity-bar-status continuity-bar-status--${chapterCanon?.status || 'draft'}`;
  const reports = chapterCanon?.reports || [];

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

  if (!prevChapterInfo && !chapterCanon && !activeChapterId) return null;

  return (
    <div className={`continuity-bar ${expanded ? 'continuity-bar--expanded' : ''} ${isMobileLayout ? 'continuity-bar--mobile' : ''}`}>
      <div className="continuity-bar-header" onClick={() => setExpanded((value) => !value)}>
        <div className="continuity-bar-left">
          <Clock size={13} />
          {prevChapterInfo ? (
            <>
              <span className="continuity-bar-label">Chuong truoc:</span>
              <span className="continuity-bar-title">{prevChapterInfo.title}</span>
            </>
          ) : (
            <>
              <span className="continuity-bar-label">Su that:</span>
              <span className="continuity-bar-title">{currentChapterTitle || 'Chuong hien tai'}</span>
            </>
          )}
          <span className={canonStatusClass}>
            {chapterCanon?.status === 'canonical' ? <ShieldCheck size={12} /> : <ShieldAlert size={12} />}
            {canonStatusLabel}
          </span>
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
          {prevChapterInfo && <p className="continuity-bar-summary">{prevChapterInfo.summary}</p>}
          {reports.length > 0 && (
            <div className="continuity-bar-reports">
              {reports.slice(0, 4).map((report) => (
                <div key={report.id || `${report.rule_code}-${report.message}`} className={`continuity-bar-report continuity-bar-report--${report.severity}`}>
                  <strong>{report.rule_code || report.severity}</strong>: {report.message}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
