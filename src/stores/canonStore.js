import { create } from 'zustand';
import db from '../services/db/database';
import { buildRetrievalPacket, getChapterCanonState } from '../services/canon/queries';
import {
  canonicalizeChapter as canonicalizeChapterEngine,
  repairChapterRevision as repairChapterRevisionEngine,
  saveRepairDraftRevision as saveRepairDraftRevisionEngine,
} from '../services/canon/workflow';
import {
  invalidateFromChapter as invalidateCanonFromChapter,
  rebuildCanonFromChapter as rebuildCanonFromChapterEngine,
} from '../services/canon/projection';
import { toVietnameseErrorMessage } from '../utils/errorMessages';
import { beginBulkCanonRun, endBulkCanonRun } from '../services/canon/runLock.js';

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

async function refreshCanonConsumers(projectId) {
  const [{ default: useCodexStore }, { default: useSuggestionStore }] = await Promise.all([
    import('./codexStore'),
    import('./suggestionStore'),
  ]);
  await Promise.allSettled([
    useCodexStore.getState().loadCodex(projectId),
    useSuggestionStore.getState().loadSuggestions(projectId),
  ]);
}

async function syncProjectChapterStatus(chapterId, status) {
  const { default: useProjectStore } = await import('./projectStore');
  useProjectStore.setState((state) => ({
    chapters: state.chapters.map((chapter) => (
      chapter.id === chapterId ? { ...chapter, status } : chapter
    )),
  }));
}

async function setChapterStatus(chapterId, status) {
  await db.chapters.update(chapterId, { status });
  await syncProjectChapterStatus(chapterId, status);
}

async function markChapterDraftAndInvalidate(projectId, chapterId) {
  await setChapterStatus(chapterId, 'draft');
  return invalidateCanonFromChapter(projectId, chapterId);
}

let repairRequestSequence = 0;

const useCanonStore = create((set, get) => ({
  chapterCanon: null,
  retrievalPacket: null,
  loading: false,
  canonicalizing: false,
  rebuilding: false,
  bulkCanonicalizing: false,
  bulkProgress: null,
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
    if (get().bulkCanonicalizing) {
      return {
        ok: false,
        kind: 'busy',
        message: 'Hệ thống đang rà lại toàn bộ chương. Hãy chờ tác vụ hiện tại hoàn tất.',
        reports: [],
        revisionId: null,
      };
    }
    set({ canonicalizing: true, lastActionOutcome: null });
    try {
      const result = await canonicalizeChapterEngine(projectId, chapterId);
      await Promise.allSettled([
        get().loadChapterCanon(projectId, chapterId),
        refreshCanonConsumers(projectId),
      ]);
      if (result?.ok !== true) {
        const invalidatedChapterIds = await markChapterDraftAndInvalidate(projectId, chapterId);
        const outcome = {
          ok: false,
          kind: 'blocked',
          message: result?.extractionStatus === 'failed' || !result
            ? 'AI không trích xuất được canon hợp lệ. Chương chưa được đánh dấu đã phân tích.'
            : buildBlockedCanonMessage(result?.reports || []),
          reports: result?.reports || [],
          revisionId: result?.revisionId || null,
          extractionStatus: result?.extractionStatus || 'failed',
          extractedCount: result?.extractedCount || 0,
          committedCount: 0,
          filteredCount: result?.filteredCount || 0,
          invalidatedChapterCount: Math.max(
            Number(result?.invalidatedChapterCount || 0),
            invalidatedChapterIds.length,
          ),
        };
        set({ canonicalizing: false, lastActionOutcome: outcome });
        return outcome;
      }
      const outcome = {
        ok: true,
        kind: 'success',
        message: [
          buildSuccessCanonMessage(result?.reports || []),
          Number(result?.committedCount || 0) > 0
            ? `Đã áp dụng ${result.committedCount} thay đổi canon.`
            : 'Không phát hiện thay đổi canon mới.',
          Number(result?.filteredCount || 0) > 0
            ? `${result.filteredCount} thay đổi bị lọc.`
            : '',
          Number(result?.invalidatedChapterCount || 0) > 0
            ? `${result.invalidatedChapterCount} chương phía sau cần phân tích lại.`
            : '',
        ].filter(Boolean).join('\n'),
        reports: result?.reports || [],
        revisionId: result?.revisionId || null,
        extractionStatus: result?.extractionStatus || 'succeeded',
        extractedCount: result?.extractedCount || 0,
        committedCount: result?.committedCount || 0,
        filteredCount: result?.filteredCount || 0,
        invalidatedChapterCount: result?.invalidatedChapterCount || 0,
      };
      set({ canonicalizing: false, lastActionOutcome: outcome });
      return outcome;
    } catch (error) {
      try {
        await markChapterDraftAndInvalidate(projectId, chapterId);
      } catch (statusError) {
        console.error('[CanonStore] Failed to clear chapter completion after canon error:', statusError);
      }
      const outcome = normalizeCanonFailure(error);
      set({ canonicalizing: false, lastActionOutcome: outcome });
      return outcome;
    }
  },

  reanalyzeCompletedChapters: async (projectId) => {
    if (!projectId) return null;
    if (get().bulkCanonicalizing || get().canonicalizing) {
      return {
        ok: false,
        kind: 'busy',
        message: 'Đang có một tác vụ phân tích canon khác chạy.',
      };
    }

    const bulkRunToken = beginBulkCanonRun();
    if (!bulkRunToken) {
      return {
        ok: false,
        kind: 'busy',
        message: 'Đang có một tác vụ rà lại canon khác chạy.',
      };
    }
    const previousProgress = get().bulkProgress;
    set({ bulkCanonicalizing: true, lastActionOutcome: null });
    try {
      const [chapters, commits] = await Promise.all([
        db.chapters.where('project_id').equals(projectId).sortBy('order_index'),
        db.chapter_commits.where('project_id').equals(projectId).toArray(),
      ]);
      const commitByChapterId = new Map(commits.map((commit) => [commit.chapter_id, commit]));
      const isAuditTarget = (chapter) => {
        const commitStatus = commitByChapterId.get(chapter.id)?.status;
        return chapter.status === 'done' || ['blocked', 'invalidated'].includes(commitStatus);
      };
      let targets = chapters.filter(isAuditTarget);
      const resumeChapterId = previousProgress?.status === 'failed'
        ? previousProgress.chapterId
        : null;
      if (resumeChapterId) {
        const resumeIndex = chapters.findIndex((chapter) => chapter.id === resumeChapterId);
        if (resumeIndex >= 0) {
          targets = chapters
            .slice(resumeIndex)
            .filter((chapter) => chapter.id === resumeChapterId || isAuditTarget(chapter));
        }
      }

      if (targets.length === 0) {
        const outcome = {
          ok: true,
          kind: 'success',
          message: 'Không có chương đã hoàn thành nào cần rà lại.',
        };
        set({
          bulkCanonicalizing: false,
          bulkProgress: { status: 'completed', current: 0, total: 0 },
          lastActionOutcome: outcome,
        });
        return outcome;
      }

      let committedCount = 0;
      for (let index = 0; index < targets.length; index += 1) {
        const chapter = targets[index];
        set({
          bulkProgress: {
            status: 'running',
            current: index + 1,
            total: targets.length,
            chapterId: chapter.id,
            chapterTitle: chapter.title || `Chương ${chapter.order_index + 1}`,
            error: '',
          },
        });

        let result;
        try {
          result = await canonicalizeChapterEngine(projectId, chapter.id, {
            force: true,
            bulkRunToken,
          });
        } catch (error) {
          result = {
            ok: false,
            extractionStatus: 'failed',
            reports: [],
            runtimeError: toVietnameseErrorMessage(error, 'Không thể phân tích canon.'),
          };
        }

        if (result?.ok !== true) {
          await markChapterDraftAndInvalidate(projectId, chapter.id);
          const message = result?.runtimeError
            || (result?.extractionStatus === 'failed' || !result
              ? `Dừng tại ${chapter.title || `chương ${chapter.order_index + 1}`}: AI không trích xuất được canon hợp lệ.`
              : `Dừng tại ${chapter.title || `chương ${chapter.order_index + 1}`}: có lỗi canon chặn.`);
          const outcome = {
            ok: false,
            kind: 'blocked',
            message,
            chapterId: chapter.id,
            reports: result?.reports || [],
          };
          set({
            bulkCanonicalizing: false,
            bulkProgress: {
              status: 'failed',
              current: index + 1,
              total: targets.length,
              chapterId: chapter.id,
              chapterTitle: chapter.title || `Chương ${chapter.order_index + 1}`,
              error: message,
            },
            lastActionOutcome: outcome,
          });
          await refreshCanonConsumers(projectId);
          return outcome;
        }

        committedCount += Number(result?.committedCount || 0);
        await setChapterStatus(chapter.id, 'done');
      }

      await refreshCanonConsumers(projectId);
      const outcome = {
        ok: true,
        kind: 'success',
        message: `Đã rà lại ${targets.length} chương và áp dụng ${committedCount} thay đổi canon.`,
        committedCount,
      };
      set({
        bulkCanonicalizing: false,
        bulkProgress: {
          status: 'completed',
          current: targets.length,
          total: targets.length,
          committedCount,
        },
        lastActionOutcome: outcome,
      });
      return outcome;
    } catch (error) {
      const outcome = normalizeCanonFailure(error);
      const activeProgress = get().bulkProgress;
      set({
        bulkCanonicalizing: false,
        bulkProgress: {
          status: 'failed',
          current: activeProgress?.current || 0,
          total: activeProgress?.total || 0,
          chapterId: activeProgress?.chapterId || null,
          chapterTitle: activeProgress?.chapterTitle || '',
          error: outcome.message,
        },
        lastActionOutcome: outcome,
      });
      return outcome;
    } finally {
      endBulkCanonRun(bulkRunToken);
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
    const requestId = ++repairRequestSequence;
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
      if (requestId !== repairRequestSequence) return null;
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
      if (requestId !== repairRequestSequence) throw error;
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
    set({ savingRepairDraft: true, lastActionOutcome: null });
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
      const revisionLabel = saved?.revision_number ? ` r${saved.revision_number}` : '';
      const savedMessage = `Đã lưu bản sửa thành bản nháp${revisionLabel} trong lịch sử canon. Nội dung chương trong trình soạn thảo chưa thay đổi.`;
      const message = remainingErrors > 0
        ? `${savedMessage} Lần kiểm tra bản nháp vẫn còn ${remainingErrors} lỗi canon${remainingWarnings > 0 ? ` và ${remainingWarnings} cảnh báo` : ''}.`
        : remainingWarnings > 0
          ? `${savedMessage} Lần kiểm tra bản nháp không còn lỗi canon, còn ${remainingWarnings} cảnh báo cần xem lại.`
          : `${savedMessage} Lần kiểm tra bản nháp không còn lỗi canon.`;
      set((state) => ({
        savingRepairDraft: false,
        repairPreview: state.repairPreview
          ? {
            ...state.repairPreview,
            savedRevisionId: saved?.id || null,
            savedRevisionNumber: saved?.revision_number || null,
          }
          : state.repairPreview,
        lastActionOutcome: {
          ok: remainingErrors === 0,
          kind: remainingErrors > 0 ? 'blocked' : 'success',
          message,
          reports: remainingReports,
          revisionId: saved?.id || null,
          revisionNumber: saved?.revision_number || null,
        },
      }));
      return saved;
    } catch (error) {
      const outcome = normalizeCanonFailure(error);
      set({ savingRepairDraft: false, lastActionOutcome: outcome });
      throw error;
    }
  },

  clearRepairText: () => {
    repairRequestSequence += 1;
    set({ repairPreview: null });
  },
  clearActionOutcome: () => set({ lastActionOutcome: null }),
}));

export default useCanonStore;
