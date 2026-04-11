import { create } from 'zustand';
import {
  buildRetrievalPacket,
  canonicalizeChapter as canonicalizeChapterEngine,
  getChapterCanonState,
  rebuildCanonFromChapter as rebuildCanonFromChapterEngine,
  repairChapterRevision as repairChapterRevisionEngine,
} from '../services/canon/engine';

const useCanonStore = create((set, get) => ({
  chapterCanon: null,
  retrievalPacket: null,
  loading: false,
  canonicalizing: false,
  rebuilding: false,
  repairText: '',

  loadChapterCanon: async (projectId, chapterId, sceneId = null) => {
    if (!projectId || !chapterId) {
      set({ chapterCanon: null, retrievalPacket: null });
      return null;
    }

    set({ loading: true });
    try {
      const [chapterCanon, retrievalPacket] = await Promise.all([
        getChapterCanonState(projectId, chapterId),
        buildRetrievalPacket({ projectId, chapterId, sceneId }),
      ]);
      set({ chapterCanon, retrievalPacket, loading: false });
      return { chapterCanon, retrievalPacket };
    } catch (error) {
      console.error('[CanonStore] loadChapterCanon failed:', error);
      set({ loading: false });
      throw error;
    }
  },

  canonicalizeChapter: async (projectId, chapterId) => {
    set({ canonicalizing: true });
    try {
      const result = await canonicalizeChapterEngine(projectId, chapterId);
      await get().loadChapterCanon(projectId, chapterId);
      set({ canonicalizing: false });
      return result;
    } catch (error) {
      set({ canonicalizing: false });
      throw error;
    }
  },

  rebuildCanonFromChapter: async (projectId, chapterId) => {
    set({ rebuilding: true });
    try {
      const result = await rebuildCanonFromChapterEngine(projectId, chapterId);
      await get().loadChapterCanon(projectId, chapterId);
      set({ rebuilding: false });
      return result;
    } catch (error) {
      set({ rebuilding: false });
      throw error;
    }
  },

  repairChapterRevision: async ({ projectId, chapterId, revisionId }) => {
    const text = await repairChapterRevisionEngine({ projectId, chapterId, revisionId });
    set({ repairText: text || '' });
    return text;
  },

  clearRepairText: () => set({ repairText: '' }),
}));

export default useCanonStore;
