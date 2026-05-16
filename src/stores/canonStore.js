import { create } from 'zustand';
import { buildRetrievalPacket, getChapterCanonState } from '../services/canon/queries';
import {
  canonicalizeChapter as canonicalizeChapterEngine,
  repairChapterRevision as repairChapterRevisionEngine,
  saveRepairDraftRevision as saveRepairDraftRevisionEngine,
} from '../services/canon/workflow';
import { rebuildCanonFromChapter as rebuildCanonFromChapterEngine } from '../services/canon/projection';
import { toVietnameseErrorMessage } from '../utils/errorMessages';

function normalizeCanonFailure(error) {
  const message = toVietnameseErrorMessage(
    error,
    'Không thể xử lý canon. Hãy thử lại, đổi model/API key hoặc kiểm tra cấu hình trong Settings.',
  );
  if (error?.code === 'API_UNREACHABLE') {
    return {
      ok: false,
      kind: 'api_unavailable',
      message: `Phân tích sự thật chưa hoàn tất.\nKết quả: lỗi runtime.\nChi tiết: ${message}`,
      reports: [],
      revisionId: null,
    };
  }
  return {
    ok: false,
    kind: 'runtime',
    message: `Phân tích sự thật chưa hoàn tất.\nKết quả: lỗi runtime.\nChi tiết: ${message}`,
    reports: [],
    revisionId: null,
  };
}

function summarizeCanonReports(reports = []) {
  const errorCount = reports.filter((report) => report?.severity === 'error').length;
  const warningCount = reports.filter((report) => report?.severity === 'warning').length;
  return { errorCount, warningCount };
}

function buildBlockedCanonMessage(reports = []) {
  const { errorCount, warningCount } = summarizeCanonReports(reports);
  const lines = [
    'Đã phân tích sự thật xong.',
    'Kết quả: bị chặn.',
    `Phát hiện ${errorCount} lỗi canon${warningCount > 0 ? ` và ${warningCount} cảnh báo` : ''}.`,
  ];
  return lines.join('\n');
}

function buildSuccessCanonMessage(reports = []) {
  const { warningCount } = summarizeCanonReports(reports);
  const lines = [
    'Đã phân tích sự thật xong.',
    `Kết quả: ${warningCount > 0 ? 'hợp lệ, có cảnh báo.' : 'hợp lệ.'}`,
  ];
  if (warningCount > 0) {
    lines.push(`Có ${warningCount} cảnh báo canon cần xem lại.`);
  }
  return lines.join('\n');
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
          message: buildBlockedCanonMessage(result.reports || []),
          reports: result.reports || [],
          revisionId: result.revisionId || null,
        };
        set({ canonicalizing: false, lastActionOutcome: outcome });
        return outcome;
      }
      const outcome = {
        ok: true,
        kind: 'success',
        message: buildSuccessCanonMessage(result?.reports || []),
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

  rebuildCanonFromChapter: async (projectId, chapterId, options = {}) => {
    set({ rebuilding: true, lastActionOutcome: null });
    try {
      const result = await rebuildCanonFromChapterEngine(projectId, chapterId, options);
      await get().loadChapterCanon(projectId, chapterId);
      const outcome = {
        ok: true,
        kind: 'success',
        message: 'Đã rebuild canon thành công.',
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
        reports: [],
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
        reports: result?.reports || [],
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
        reports: [],
        loading: false,
        error: toVietnameseErrorMessage(error, 'Không thể tạo gợi ý sửa.'),
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
      await get().loadChapterCanon(projectId, chapterId);
      const remainingReports = saved?.validation?.reports || [];
      const remainingErrors = remainingReports.filter((report) => report?.severity === 'error').length;
      const remainingWarnings = remainingReports.filter((report) => report?.severity === 'warning').length;
      const message = remainingErrors > 0
        ? `Đã lưu bản sửa thành draft mới, nhưng vẫn còn ${remainingErrors} lỗi canon${remainingWarnings > 0 ? ` và ${remainingWarnings} cảnh báo` : ''}.`
        : remainingWarnings > 0
          ? `Đã lưu bản sửa thành draft mới. Không còn lỗi canon, còn ${remainingWarnings} cảnh báo cần xem lại.`
          : 'Đã lưu bản sửa thành draft mới. Không còn lỗi canon.';
      set((state) => ({
        savingRepairDraft: false,
        repairPreview: state.repairPreview
          ? { ...state.repairPreview, savedRevisionId: saved?.id || null }
          : state.repairPreview,
        lastActionOutcome: {
          ok: remainingErrors === 0,
          kind: remainingErrors > 0 ? 'blocked' : 'success',
          message,
          reports: remainingReports,
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
