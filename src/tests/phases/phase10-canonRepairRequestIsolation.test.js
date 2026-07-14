import { beforeEach, describe, expect, it, vi } from 'vitest';

const repairChapterRevisionEngine = vi.fn();

vi.mock('../../services/canon/queries', () => ({
  buildRetrievalPacket: vi.fn(),
  getChapterCanonState: vi.fn(),
}));

vi.mock('../../services/canon/workflow', () => ({
  canonicalizeChapter: vi.fn(),
  repairChapterRevision: (...args) => repairChapterRevisionEngine(...args),
  saveRepairDraftRevision: vi.fn(),
}));

vi.mock('../../services/canon/projection', () => ({
  rebuildCanonFromChapter: vi.fn(),
}));

const { default: useCanonStore } = await import('../../stores/canonStore.js');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

function repairArgs(reportId = 401) {
  return {
    projectId: 1,
    chapterId: 11,
    revisionId: 101,
    reportId,
  };
}

describe('phase10 canon repair request isolation', () => {
  beforeEach(() => {
    repairChapterRevisionEngine.mockReset();
    useCanonStore.setState({
      repairPreview: null,
      savingRepairDraft: false,
      lastActionOutcome: null,
    });
  });

  it('does not reopen a cancelled repair after the user closes it', async () => {
    const request = deferred();
    repairChapterRevisionEngine.mockReturnValueOnce(request.promise);

    const pending = useCanonStore.getState().repairChapterRevision(repairArgs());
    useCanonStore.getState().clearRepairText();
    request.reject(Object.assign(new Error('Yêu cầu AI đã bị hủy.'), { code: 'REQUEST_ABORTED' }));

    await expect(pending).rejects.toMatchObject({ code: 'REQUEST_ABORTED' });
    expect(useCanonStore.getState().repairPreview).toBeNull();
  });

  it('does not let an older cancelled request overwrite a successful retry', async () => {
    const firstRequest = deferred();
    const retryRequest = deferred();
    repairChapterRevisionEngine
      .mockReturnValueOnce(firstRequest.promise)
      .mockReturnValueOnce(retryRequest.promise);

    const firstPending = useCanonStore.getState().repairChapterRevision(repairArgs(401));
    const retryPending = useCanonStore.getState().repairChapterRevision(repairArgs(401));

    retryRequest.resolve({
      text: 'Bản sửa từ lần thử lại',
      report: null,
      reports: [],
    });
    await retryPending;

    firstRequest.reject(Object.assign(new Error('Yêu cầu AI đã bị hủy.'), { code: 'REQUEST_ABORTED' }));
    await expect(firstPending).rejects.toMatchObject({ code: 'REQUEST_ABORTED' });

    expect(useCanonStore.getState().repairPreview).toMatchObject({
      text: 'Bản sửa từ lần thử lại',
      loading: false,
      error: '',
    });
  });
});
