import { useCallback, useEffect, useMemo } from 'react';
import useAnalysisStore from '../../../../stores/analysisStore';

const EMPTY_IDS = [];

export default function useCorpusAnalysis(corpusId) {
  const analysisIds = useAnalysisStore((state) => {
    if (!corpusId) {
      return EMPTY_IDS;
    }
    return state.analysisIdsByCorpus[corpusId] || EMPTY_IDS;
  });
  const analysesMap = useAnalysisStore((state) => state.analyses);

  const loadAnalyses = useAnalysisStore((state) => state.loadAnalyses);
  const startAnalysis = useAnalysisStore((state) => state.startAnalysis);
  const cancelAnalysis = useAnalysisStore((state) => state.cancelAnalysis);
  const clearCorpusErrors = useAnalysisStore((state) => state.clearCorpusErrors);
  const loadingByCorpus = useAnalysisStore((state) => state.loadingByCorpus);
  const errorsByCorpus = useAnalysisStore((state) => state.errorsByCorpus);

  const analyses = useMemo(
    () => analysisIds
      .map((id) => analysesMap[id])
      .filter(Boolean)
      .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0)),
    [analysisIds, analysesMap],
  );

  useEffect(() => {
    if (!corpusId) {
      return;
    }

    loadAnalyses(corpusId).catch(() => {});
  }, [corpusId, loadAnalyses]);

  const activeAnalysis = useMemo(
    () => analyses.find((item) => item.status === 'processing' || item.status === 'pending') || null,
    [analyses],
  );

  const beginAnalysis = useCallback(
    async (config = {}) => {
      if (!corpusId) {
        return null;
      }

      clearCorpusErrors(corpusId);
      return startAnalysis(corpusId, config);
    },
    [clearCorpusErrors, corpusId, startAnalysis],
  );

  const stopAnalysis = useCallback(
    async (analysisId) => {
      if (!analysisId) {
        return null;
      }

      return cancelAnalysis(analysisId);
    },
    [cancelAnalysis],
  );

  const refresh = useCallback(
    async () => {
      if (!corpusId) {
        return null;
      }

      return loadAnalyses(corpusId);
    },
    [corpusId, loadAnalyses],
  );

  return {
    analyses,
    activeAnalysis,
    loading: Boolean(loadingByCorpus[corpusId]),
    error: errorsByCorpus[corpusId] || null,
    startAnalysis: beginAnalysis,
    cancelAnalysis: stopAnalysis,
    refresh,
  };
}


