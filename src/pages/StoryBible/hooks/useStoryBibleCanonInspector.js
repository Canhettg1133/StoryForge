import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  getChapterRevisionDetail,
  getChapterRevisionHistory,
  getProjectCanonOverview,
} from '../../../services/canon/queries';
import { buildCharacterStateSummary } from '../../../services/canon/state';

export default function useStoryBibleCanonInspector({ currentProjectId, characterNameMap }) {
  const [canonOverview, setCanonOverview] = useState(null);
  const [canonOverviewLoading, setCanonOverviewLoading] = useState(false);
  const [selectedCanonChapterId, setSelectedCanonChapterId] = useState(null);
  const [chapterRevisionHistory, setChapterRevisionHistory] = useState(null);
  const [selectedCanonRevisionId, setSelectedCanonRevisionId] = useState(null);
  const [selectedRevisionDetail, setSelectedRevisionDetail] = useState(null);
  const [canonDetailLoading, setCanonDetailLoading] = useState(false);
  const [selectedEvidenceId, setSelectedEvidenceId] = useState(null);

  const loadCanonOverview = useCallback(async () => {
    if (!currentProjectId) {
      setCanonOverview(null);
      return;
    }
    setCanonOverviewLoading(true);
    try {
      const overview = await getProjectCanonOverview(currentProjectId);
      setCanonOverview(overview);
    } finally {
      setCanonOverviewLoading(false);
    }
  }, [currentProjectId]);

  const loadChapterRevisionInspector = useCallback(async (chapterId, preferredRevisionId = null) => {
    if (!currentProjectId || !chapterId) {
      setChapterRevisionHistory(null);
      setSelectedRevisionDetail(null);
      return;
    }
    setCanonDetailLoading(true);
    try {
      const history = await getChapterRevisionHistory(currentProjectId, chapterId);
      setChapterRevisionHistory(history);
      const fallbackRevisionId = preferredRevisionId
        || history?.commit?.current_revision_id
        || history?.revisions?.[0]?.id
        || null;
      setSelectedCanonChapterId(chapterId);
      setSelectedCanonRevisionId(fallbackRevisionId);
      if (fallbackRevisionId) {
        const detail = await getChapterRevisionDetail(currentProjectId, fallbackRevisionId);
        setSelectedRevisionDetail(detail);
        setSelectedEvidenceId(detail?.evidence?.[0]?.id || null);
      } else {
        setSelectedRevisionDetail(null);
        setSelectedEvidenceId(null);
      }
    } finally {
      setCanonDetailLoading(false);
    }
  }, [currentProjectId]);

  const handleRevisionChange = useCallback(async (revisionId) => {
    setSelectedCanonRevisionId(revisionId);
    setCanonDetailLoading(true);
    try {
      const detail = revisionId ? await getChapterRevisionDetail(currentProjectId, revisionId) : null;
      setSelectedRevisionDetail(detail);
      setSelectedEvidenceId(detail?.evidence?.[0]?.id || null);
    } finally {
      setCanonDetailLoading(false);
    }
  }, [currentProjectId]);

  useEffect(() => {
    loadCanonOverview();
  }, [loadCanonOverview]);

  useEffect(() => {
    if (!canonOverview?.chapterCommits?.length) {
      setSelectedCanonChapterId(null);
      setChapterRevisionHistory(null);
      setSelectedCanonRevisionId(null);
      setSelectedRevisionDetail(null);
      setSelectedEvidenceId(null);
      return;
    }

    const targetChapterId = selectedCanonChapterId || canonOverview.chapterCommits[0]?.chapter_id;
    if (targetChapterId) {
      loadChapterRevisionInspector(targetChapterId, selectedCanonRevisionId);
    }
  }, [canonOverview?.chapterCommits, loadChapterRevisionInspector, selectedCanonChapterId, selectedCanonRevisionId]);

  const canonEntityCards = useMemo(() => (
    (canonOverview?.entityStates || []).map((state) => ({
      ...state,
      displayName: characterNameMap.get(state.entity_id) || `Character ${state.entity_id}`,
      summaryText: buildCharacterStateSummary(state),
    }))
  ), [canonOverview?.entityStates, characterNameMap]);

  const selectedEvidence = useMemo(() => (
    (selectedRevisionDetail?.evidence || []).find((item) => item.id === selectedEvidenceId)
      || selectedRevisionDetail?.evidence?.[0]
      || null
  ), [selectedEvidenceId, selectedRevisionDetail?.evidence]);

  return {
    canonOverview,
    canonOverviewLoading,
    selectedCanonChapterId,
    chapterRevisionHistory,
    selectedCanonRevisionId,
    selectedRevisionDetail,
    canonDetailLoading,
    selectedEvidenceId,
    selectedEvidence,
    canonEntityCards,
    loadCanonOverview,
    loadChapterRevisionInspector,
    handleRevisionChange,
    setSelectedEvidenceId,
  };
}
