/**
 * StoryForge — Continuity Bar (Phase 3 Enhancement)
 * 
 * "Previously on..." bar shown at the top of the editor.
 * Shows the summary of the previous chapter so the writer knows context.
 */

import React, { useState, useEffect, useMemo } from 'react';
import useProjectStore from '../../stores/projectStore';
import useCodexStore from '../../stores/codexStore';
import { Clock, ChevronDown, ChevronUp, BookOpen } from 'lucide-react';
import './ContinuityBar.css';

export default function ContinuityBar() {
  const { chapters, activeChapterId, currentProject } = useProjectStore();
  const { chapterMetas, loadCodex } = useCodexStore();
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (currentProject) loadCodex(currentProject.id);
  }, [currentProject?.id]);

  // Find current chapter index
  const currentChapterIndex = useMemo(() => {
    return chapters.findIndex(c => c.id === activeChapterId);
  }, [chapters, activeChapterId]);

  // Get previous chapter summary (with fallback)
  const prevChapterInfo = useMemo(() => {
    if (currentChapterIndex <= 0) return null;

    const prevChapter = chapters[currentChapterIndex - 1];
    if (!prevChapter) return null;

    // Try chapterMeta first (AI-generated summary from "Hoàn thành chương")
    const meta = chapterMetas.find(m => m.chapter_id === prevChapter.id);
    // Fallback to chapter.summary (from Outline Board or AI Wizard)
    const summary = meta?.summary || prevChapter.summary || null;
    if (!summary) return null;

    return {
      title: prevChapter.title || `Chương ${currentChapterIndex}`,
      summary,
      isAISummary: !!meta?.summary, // true if from AI, false if from outline
    };
  }, [currentChapterIndex, chapters, chapterMetas]);

  // Also get current chapter info
  const currentChapterTitle = useMemo(() => {
    const ch = chapters.find(c => c.id === activeChapterId);
    return ch?.title || '';
  }, [chapters, activeChapterId]);

  if (!prevChapterInfo) return null;

  return (
    <div className={`continuity-bar ${expanded ? 'continuity-bar--expanded' : ''}`}>
      <div className="continuity-bar-header" onClick={() => setExpanded(!expanded)}>
        <div className="continuity-bar-left">
          <Clock size={13} />
          <span className="continuity-bar-label">Chương trước:</span>
          <span className="continuity-bar-title">{prevChapterInfo.title}</span>
        </div>
        {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
      </div>

      {expanded && (
        <div className="continuity-bar-body">
          <p className="continuity-bar-summary">{prevChapterInfo.summary}</p>
        </div>
      )}
    </div>
  );
}
