import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { corpusApi } from '../services/api/corpusApi';

const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled']);
const ACTIVE_STATUSES = new Set(['pending', 'processing']);

function normalizeAnalysis(existing = null, payload = {}) {
  const merged = {
    ...(existing || {}),
    ...(payload || {}),
    id: payload?.id || existing?.id,
    corpusId: payload?.corpusId || existing?.corpusId,
  };

  if (!merged.status) {
    merged.status = 'pending';
  }

  if (payload?.phase && !payload?.currentPhase) {
    merged.currentPhase = payload.phase;
  }

  if (payload?.message && !payload?.progressMessage) {
    merged.progressMessage = payload.message;
  }

  return merged;
}

function addAnalysisToCorpusIndex(indexMap = {}, corpusId, analysisId) {
  if (!corpusId || !analysisId) {
    return indexMap;
  }

  const current = Array.isArray(indexMap[corpusId]) ? indexMap[corpusId] : [];
  if (current.includes(analysisId)) {
    return indexMap;
  }

  return {
    ...indexMap,
    [corpusId]: [analysisId, ...current],
  };
}

function removeStream(state, analysisId) {
  const nextStreams = { ...state.streams };
  const nextTimers = { ...state.reconnectTimers };

  if (nextStreams[analysisId]) {
    nextStreams[analysisId].close();
    delete nextStreams[analysisId];
  }

  if (nextTimers[analysisId]) {
    clearTimeout(nextTimers[analysisId]);
    delete nextTimers[analysisId];
  }

  return {
    streams: nextStreams,
    reconnectTimers: nextTimers,
  };
}

export const useAnalysisStore = create(
  persist(
    (set, get) => ({
      analyses: {},
      analysisIdsByCorpus: {},
      streams: {},
      reconnectTimers: {},
      loadingByCorpus: {},
      errorsByCorpus: {},

      getAnalysis: (analysisId) => get().analyses[analysisId] || null,

      getAnalysesForCorpus: (corpusId) => {
        const ids = get().analysisIdsByCorpus[corpusId] || [];
        return ids
          .map((id) => get().analyses[id])
          .filter(Boolean)
          .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
      },

      loadAnalyses: async (corpusId) => {
        if (!corpusId) {
          return { analyses: [], total: 0 };
        }

        set((state) => ({
          loadingByCorpus: {
            ...state.loadingByCorpus,
            [corpusId]: true,
          },
          errorsByCorpus: {
            ...state.errorsByCorpus,
            [corpusId]: null,
          },
        }));

        try {
          const response = await corpusApi.listAnalyses(corpusId);
          const incoming = Array.isArray(response?.analyses) ? response.analyses : [];

          set((state) => {
            const nextAnalyses = { ...state.analyses };
            let nextIndex = { ...state.analysisIdsByCorpus };

            for (const analysis of incoming) {
              if (!analysis?.id) {
                continue;
              }

              nextAnalyses[analysis.id] = normalizeAnalysis(nextAnalyses[analysis.id], analysis);
              nextIndex = addAnalysisToCorpusIndex(nextIndex, corpusId, analysis.id);
            }

            return {
              analyses: nextAnalyses,
              analysisIdsByCorpus: nextIndex,
              loadingByCorpus: {
                ...state.loadingByCorpus,
                [corpusId]: false,
              },
            };
          });

          for (const analysis of incoming) {
            if (!analysis?.id) {
              continue;
            }

            if (ACTIVE_STATUSES.has(analysis.status)) {
              get().subscribeToAnalysis(corpusId, analysis.id);
            }
          }

          return response;
        } catch (error) {
          set((state) => ({
            loadingByCorpus: {
              ...state.loadingByCorpus,
              [corpusId]: false,
            },
            errorsByCorpus: {
              ...state.errorsByCorpus,
              [corpusId]: error?.message || 'Failed to load analyses.',
            },
          }));
          throw error;
        }
      },

      startAnalysis: async (corpusId, config = {}) => {
        if (!corpusId) {
          throw new Error('corpusId is required.');
        }

        const analysis = await corpusApi.startAnalysis(corpusId, config);

        if (!analysis?.id) {
          const invalid = new Error(
            'Phản hồi phân tích không hợp lệ (thiếu id). Kiểm tra jobs server và phiên bản API.',
          );
          invalid.code = 'INVALID_ANALYSIS_RESPONSE';
          throw invalid;
        }

        set((state) => ({
          analyses: {
            ...state.analyses,
            [analysis.id]: normalizeAnalysis(state.analyses[analysis.id], analysis),
          },
          analysisIdsByCorpus: addAnalysisToCorpusIndex(
            state.analysisIdsByCorpus,
            corpusId,
            analysis.id,
          ),
          errorsByCorpus: {
            ...state.errorsByCorpus,
            [corpusId]: null,
          },
        }));

        get().subscribeToAnalysis(corpusId, analysis.id);
        return analysis;
      },

      subscribeToAnalysis: (corpusId, analysisId) => {
        if (!corpusId || !analysisId) {
          return;
        }

        const activeStream = get().streams[analysisId];
        if (activeStream) {
          return;
        }

        const reconnectTimer = get().reconnectTimers[analysisId];
        if (reconnectTimer) {
          clearTimeout(reconnectTimer);
          set((state) => ({
            reconnectTimers: {
              ...state.reconnectTimers,
              [analysisId]: null,
            },
          }));
        }

        const eventSource = corpusApi.subscribeAnalysis(corpusId, analysisId);

        const register = (eventName) => {
          eventSource.addEventListener(eventName, (event) => {
            try {
              const data = JSON.parse(event.data);
              get().handleAnalysisEvent(corpusId, analysisId, {
                ...data,
                eventType: eventName,
              });
            } catch {
              // ignore invalid event payload
            }
          });
        };

        register('snapshot');
        register('progress');
        register('completed');
        register('error');
        register('cancelled');

        eventSource.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            get().handleAnalysisEvent(corpusId, analysisId, data);
          } catch {
            // ignore heartbeat/non-json messages
          }
        };

        eventSource.onerror = () => {
          eventSource.close();

          set((state) => {
            const nextStreams = { ...state.streams };
            delete nextStreams[analysisId];
            return {
              streams: nextStreams,
            };
          });

          const current = get().analyses[analysisId];
          if (!current || TERMINAL_STATUSES.has(current.status)) {
            return;
          }

          const timer = setTimeout(
            () => get().subscribeToAnalysis(corpusId, analysisId),
            5000,
          );

          set((state) => ({
            reconnectTimers: {
              ...state.reconnectTimers,
              [analysisId]: timer,
            },
          }));
        };

        set((state) => ({
          streams: {
            ...state.streams,
            [analysisId]: eventSource,
          },
        }));
      },

      unsubscribeFromAnalysis: (analysisId) => {
        set((state) => removeStream(state, analysisId));
      },

      handleAnalysisEvent: async (corpusId, analysisId, payload = {}) => {
        let next = null;

        set((state) => {
          const existing = state.analyses[analysisId] || { id: analysisId, corpusId };
          next = normalizeAnalysis(existing, payload);

          return {
            analyses: {
              ...state.analyses,
              [analysisId]: next,
            },
            analysisIdsByCorpus: addAnalysisToCorpusIndex(
              state.analysisIdsByCorpus,
              next.corpusId || corpusId,
              analysisId,
            ),
          };
        });

        const eventType = payload?.eventType || payload?.type;
        if (eventType === 'completed') {
          try {
            const detail = await corpusApi.getAnalysis(corpusId, analysisId);
            set((state) => ({
              analyses: {
                ...state.analyses,
                [analysisId]: normalizeAnalysis(state.analyses[analysisId], detail),
              },
            }));
          } catch {
            // best effort refresh
          }
        }

        if (TERMINAL_STATUSES.has(next?.status) || ['completed', 'cancelled'].includes(eventType)) {
          get().unsubscribeFromAnalysis(analysisId);
        }

        if (eventType === 'error' && payload?.retrying === false) {
          get().unsubscribeFromAnalysis(analysisId);
        }
      },

      cancelAnalysis: async (analysisId) => {
        if (!analysisId) {
          return null;
        }

        const cancelled = await corpusApi.cancelAnalysis(analysisId);

        set((state) => ({
          analyses: {
            ...state.analyses,
            [analysisId]: normalizeAnalysis(state.analyses[analysisId], cancelled),
          },
        }));

        get().unsubscribeFromAnalysis(analysisId);
        return cancelled;
      },

      clearCorpusErrors: (corpusId) => {
        if (!corpusId) {
          return;
        }

        set((state) => ({
          errorsByCorpus: {
            ...state.errorsByCorpus,
            [corpusId]: null,
          },
        }));
      },
    }),
    {
      name: 'sf-analysis-store',
      partialize: (state) => {
        const analyses = {};
        const analysisIdsByCorpus = {};

        for (const [analysisId, analysis] of Object.entries(state.analyses || {})) {
          if (!analysis || !TERMINAL_STATUSES.has(analysis.status)) {
            continue;
          }

          analyses[analysisId] = analysis;

          if (!analysis.corpusId) {
            continue;
          }

          if (!analysisIdsByCorpus[analysis.corpusId]) {
            analysisIdsByCorpus[analysis.corpusId] = [];
          }

          analysisIdsByCorpus[analysis.corpusId].push(analysisId);
        }

        return {
          analyses,
          analysisIdsByCorpus,
        };
      },
    },
  ),
);

export default useAnalysisStore;