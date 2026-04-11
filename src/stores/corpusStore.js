import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { corpusApi } from '../services/api/corpusApi';

function toCorpusMap(corpuses = []) {
  const map = {};
  for (const corpus of corpuses) {
    if (!corpus?.id) {
      continue;
    }
    map[corpus.id] = corpus;
  }
  return map;
}

function mergeCorpus(state, corpus) {
  if (!corpus?.id) {
    return state;
  }

  const existing = state.corpuses[corpus.id] || {};
  const merged = {
    ...existing,
    ...corpus,
  };

  const nextOrder = state.corpusOrder.includes(corpus.id)
    ? state.corpusOrder
    : [corpus.id, ...state.corpusOrder];

  return {
    corpuses: {
      ...state.corpuses,
      [corpus.id]: merged,
    },
    corpusOrder: nextOrder,
  };
}

export const useCorpusStore = create(
  persist(
    (set, get) => ({
      corpuses: {},
      corpusOrder: [],
      totalCorpuses: 0,
      currentCorpus: null,
      currentChapter: null,

      uploadState: 'idle',
      uploadProgress: 0,
      uploadError: null,
      listLoading: false,
      detailLoading: false,

      filters: {
        fandom: '',
        status: '',
        search: '',
      },

      chunkSize: 750,

      setCurrentCorpus: (corpusId) => set({ currentCorpus: corpusId }),

      setCurrentChapter: (chapterId) => set({ currentChapter: chapterId }),

      setChunkSize: (chunkSize) => {
        const parsed = Number(chunkSize);
        if (![500, 750, 1500].includes(parsed)) {
          return;
        }
        set({ chunkSize: parsed });
      },

      setFilters: (updates = {}) => set((state) => ({
        filters: {
          ...state.filters,
          ...updates,
        },
      })),

      resetUpload: () => set({
        uploadState: 'idle',
        uploadProgress: 0,
        uploadError: null,
      }),

      listCorpuses: async (overrideFilters = null) => {
        const activeFilters = {
          ...(overrideFilters || get().filters),
        };

        set({ listLoading: true });
        try {
          const data = await corpusApi.list(activeFilters);
          const corpusMap = toCorpusMap(data?.corpuses || []);
          const order = (data?.corpuses || []).map((item) => item.id).filter(Boolean);

          set((state) => ({
            corpuses: {
              ...state.corpuses,
              ...corpusMap,
            },
            corpusOrder: order,
            totalCorpuses: Number(data?.total || 0),
            listLoading: false,
          }));

          return data;
        } catch (error) {
          set({ listLoading: false });
          throw error;
        }
      },

      getCorpus: async (corpusId) => {
        if (!corpusId) {
          return null;
        }

        set({ detailLoading: true });
        try {
          const corpus = await corpusApi.getById(corpusId);
          set((state) => ({
            ...mergeCorpus(state, corpus),
            currentCorpus: corpusId,
            detailLoading: false,
          }));
          return corpus;
        } catch (error) {
          set({ detailLoading: false });
          throw error;
        }
      },

      getChapter: async (corpusId, chapterId) => {
        if (!corpusId || !chapterId) {
          return null;
        }

        const chapter = await corpusApi.getChapter(corpusId, chapterId);

        set((state) => {
          const existing = state.corpuses[corpusId] || null;
          if (!existing) {
            return {
              currentCorpus: corpusId,
              currentChapter: chapterId,
            };
          }

          const chapters = Array.isArray(existing.chapters)
            ? existing.chapters.map((item) => (item.id === chapterId ? { ...item, ...chapter } : item))
            : [chapter];

          return {
            corpuses: {
              ...state.corpuses,
              [corpusId]: {
                ...existing,
                chapters,
              },
            },
            currentCorpus: corpusId,
            currentChapter: chapterId,
          };
        });

        return chapter;
      },

      uploadCorpus: async (file, metadata = {}) => {
        if (!file) {
          const error = new Error('Vui lòng chọn file trước khi upload.');
          set({ uploadState: 'error', uploadError: error.message });
          throw error;
        }

        const chunkSize = metadata.chunkSize || get().chunkSize || 750;

        set({
          uploadState: 'uploading',
          uploadProgress: 10,
          uploadError: null,
        });

        const formData = new FormData();
        formData.append('file', file);
        formData.append('metadata', JSON.stringify(metadata));
        formData.append('chunkSize', String(chunkSize));

        try {
          set({ uploadProgress: 40, uploadState: 'processing' });
          const result = await corpusApi.create(formData);
          set((state) => ({
            ...mergeCorpus(state, result),
            currentCorpus: result.id,
            currentChapter: result?.chapters?.[0]?.id || null,
            uploadState: 'idle',
            uploadProgress: 100,
            uploadError: null,
          }));

          return result;
        } catch (error) {
          set({
            uploadState: 'error',
            uploadError: error.message,
            uploadProgress: 0,
          });
          throw error;
        }
      },

      updateMetadata: async (corpusId, updates) => {
        const response = await corpusApi.update(corpusId, updates);
        const corpus = response?.corpus;

        if (corpus) {
          set((state) => mergeCorpus(state, corpus));
        }

        return response;
      },

      deleteCorpus: async (corpusId) => {
        await corpusApi.remove(corpusId);

        set((state) => {
          const nextMap = { ...state.corpuses };
          delete nextMap[corpusId];

          return {
            corpuses: nextMap,
            corpusOrder: state.corpusOrder.filter((id) => id !== corpusId),
            currentCorpus: state.currentCorpus === corpusId ? null : state.currentCorpus,
            currentChapter: state.currentCorpus === corpusId ? null : state.currentChapter,
            totalCorpuses: Math.max(0, state.totalCorpuses - 1),
          };
        });
      },
    }),
    {
      name: 'corpus-storage',
      partialize: (state) => ({
        filters: state.filters,
        chunkSize: state.chunkSize,
      }),
    },
  ),
);

export default useCorpusStore;
