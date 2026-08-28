import { create } from 'zustand';

let activeHandle = null;

export function getManuscriptReviewTargetKey(source = {}) {
  return `${source.project_id ?? source.projectId ?? ''}:${source.scene_id ?? source.sceneId ?? ''}:${source.scope || 'scene'}`;
}

function updateCurrentRun(set, runId, update) {
  set((state) => {
    if (state.run?.id !== runId) return state;
    return { run: { ...state.run, ...update(state.run) } };
  });
}

const useManuscriptReviewRunStore = create((set) => ({
  run: null,

  start(input) {
    if (activeHandle) {
      throw new Error('Một lượt phân tích khác đang chạy nền. Hãy đợi hoàn tất hoặc hủy lượt đó.');
    }

    const { execute, onProgress, ...reviewInput } = input;
    if (typeof execute !== 'function') throw new Error('Chưa nạp được bộ điều phối phân tích.');

    const id = crypto.randomUUID();
    const progress = Object.fromEntries(reviewInput.modes.map((mode) => [mode, { status: 'queued' }]));
    set({
      run: {
        id,
        targetKey: getManuscriptReviewTargetKey(reviewInput.snapshot),
        projectId: reviewInput.snapshot.project_id,
        chapterId: reviewInput.snapshot.chapter_id,
        sceneId: reviewInput.snapshot.scene_id,
        scope: reviewInput.snapshot.scope,
        status: 'running',
        progress,
        reports: [],
        error: '',
        startedAt: Date.now(),
      },
    });

    const handle = execute({
      ...reviewInput,
      onProgress: (event) => {
        updateCurrentRun(set, id, (run) => ({
          progress: { ...run.progress, [event.mode]: event },
          reports: event.report
            ? [...run.reports.filter((report) => report.mode !== event.mode), event.report]
            : run.reports,
        }));
        onProgress?.(event);
      },
    });
    activeHandle = { id, handle };

    handle.done.then((outcome) => {
      updateCurrentRun(set, id, (run) => ({
        status: outcome.cancelled ? 'cancelled' : 'complete',
        progress: outcome.cancelled
          ? Object.fromEntries(Object.entries(run.progress).map(([mode, value]) => [
            mode,
            ['queued', 'running'].includes(value.status) ? { status: 'cancelled' } : value,
          ]))
          : run.progress,
      }));
    }).catch((error) => {
      updateCurrentRun(set, id, (run) => ({
        status: 'error',
        error: error?.message || 'Không thể hoàn tất phân tích.',
        progress: Object.fromEntries(Object.entries(run.progress).map(([mode, value]) => [
          mode,
          ['queued', 'running'].includes(value.status) ? { status: 'error' } : value,
        ])),
      }));
    }).finally(() => {
      if (activeHandle?.id === id) activeHandle = null;
    });

    return handle;
  },

  cancel() {
    activeHandle?.handle.cancel();
  },
}));

export function resetManuscriptReviewRunStoreForTests() {
  const handle = activeHandle?.handle;
  activeHandle = null;
  useManuscriptReviewRunStore.setState({ run: null });
  handle?.cancel();
}

export default useManuscriptReviewRunStore;
