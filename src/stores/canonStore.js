import { create } from 'zustand';
import {
  buildRetrievalPacket,
  canonicalizeChapter as canonicalizeChapterEngine,
  getChapterCanonState,
  rebuildCanonFromChapter as rebuildCanonFromChapterEngine,
  repairChapterRevision as repairChapterRevisionEngine,
  saveRepairDraftRevision as saveRepairDraftRevisionEngine,
} from '../services/canon/engine';

function normalizeCanonFailure(error) {
  const message = error?.message || 'Khong the xu ly yeu cau canon.';
  if (error?.code === 'API_UNREACHABLE') {
    return {
      ok: false,
      kind: 'api_unavailable',
      message,
      reports: [],
      revisionId: null,
    };
  }
  return {
    ok: false,
    kind: 'runtime',
    message,
    reports: [],
    revisionId: null,
  };
}

const useCanonStore = create((set, get) => ({
  chapterCanon: null,
  retrievalPacket: null,
  loading: false,
  canonicalizing: false,
  rebuilding: false,
  repairPreview: null,
  savingRepairDraft: false,
  lastActionOutcome: null,

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
    set({ canonicalizing: true, lastActionOutcome: null });
    try {
      const result = await canonicalizeChapterEngine(projectId, chapterId);
      await get().loadChapterCanon(projectId, chapterId);
      if (result?.ok === false) {
        const outcome = {
          ok: false,
          kind: 'blocked',
          message: 'Phan tich su that phat hien mau thuan can sua truoc khi chot canon.',
          reports: result.reports || [],
          revisionId: result.revisionId || null,
        };
        set({ canonicalizing: false, lastActionOutcome: outcome });
        return outcome;
      }
      const outcome = {
        ok: true,
        kind: 'success',
        message: 'Da phan tich su that thanh cong.',
        reports: result?.reports || [],
        revisionId: result?.revisionId || null,
      };
      set({ canonicalizing: false, lastActionOutcome: outcome });
      return outcome;
    } catch (error) {
      const outcome = normalizeCanonFailure(error);
      set({ canonicalizing: false, lastActionOutcome: outcome });
      return outcome;
    }
  },

  rebuildCanonFromChapter: async (projectId, chapterId) => {
    set({ rebuilding: true, lastActionOutcome: null });
    try {
      const result = await rebuildCanonFromChapterEngine(projectId, chapterId);
      await get().loadChapterCanon(projectId, chapterId);
      const outcome = {
        ok: true,
        kind: 'success',
        message: 'Da rebuild canon thanh cong.',
        reports: [],
        revisionId: null,
        result,
      };
      set({ rebuilding: false, lastActionOutcome: outcome });
      return outcome;
    } catch (error) {
      const outcome = normalizeCanonFailure(error);
      set({ rebuilding: false, lastActionOutcome: outcome });
      return outcome;
    }
  },

  repairChapterRevision: async ({ projectId, chapterId, revisionId, reportId = null }) => {
    set({
      repairPreview: {
        projectId,
        chapterId,
        revisionId,
        reportId,
        text: '',
        report: null,
        loading: true,
        error: '',
        savedRevisionId: null,
      },
      lastActionOutcome: null,
    });
    try {
      const result = await repairChapterRevisionEngine({ projectId, chapterId, revisionId, reportId });
      const preview = {
        projectId,
        chapterId,
        revisionId,
        reportId,
        text: result?.text || '',
        report: result?.report || null,
        loading: false,
        error: '',
        savedRevisionId: null,
      };
      set({ repairPreview: preview });
      return preview;
    } catch (error) {
      const preview = {
        projectId,
        chapterId,
        revisionId,
        reportId,
        text: '',
        report: null,
        loading: false,
        error: error?.message || 'Khong the tao goi y sua.',
        savedRevisionId: null,
      };
      set({ repairPreview: preview });
      throw error;
    }
  },

  saveRepairDraftRevision: async ({ projectId, chapterId, revisionId, reportId = null, chapterText }) => {
    set({ savingRepairDraft: true });
    try {
      const saved = await saveRepairDraftRevisionEngine({
        projectId,
        chapterId,
        revisionId,
        reportId,
        chapterText,
      });
      set((state) => ({
        savingRepairDraft: false,
        repairPreview: state.repairPreview
          ? { ...state.repairPreview, savedRevisionId: saved?.id || null }
          : state.repairPreview,
        lastActionOutcome: {
          ok: true,
          kind: 'success',
          message: 'Da luu goi y sua thanh ban draft moi.',
          reports: [],
          revisionId: saved?.id || null,
        },
      }));
      return saved;
    } catch (error) {
      const outcome = normalizeCanonFailure(error);
      set({ savingRepairDraft: false, lastActionOutcome: outcome });
      throw error;
    }
  },

  clearRepairText: () => set({ repairPreview: null }),
  clearActionOutcome: () => set({ lastActionOutcome: null }),
}));

export default useCanonStore;
