import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let projectState;
let codexState;
let canonState;

const getProjectCanonOverview = vi.fn();
const getChapterRevisionHistory = vi.fn();
const getChapterRevisionDetail = vi.fn();

vi.mock('../../stores/projectStore', () => ({
  default: () => projectState,
}));

vi.mock('../../stores/codexStore', () => ({
  default: () => codexState,
}));

vi.mock('../../stores/canonStore', () => ({
  default: () => canonState,
}));

vi.mock('../../services/canon/queries', () => ({
  getProjectCanonOverview: (...args) => getProjectCanonOverview(...args),
  getChapterRevisionHistory: (...args) => getChapterRevisionHistory(...args),
  getChapterRevisionDetail: (...args) => getChapterRevisionDetail(...args),
}));

const { default: CanonTruth } = await import('../../pages/CanonTruth/CanonTruth.jsx');

const overview = {
  stats: {},
  chapterCommits: [{
    id: 201,
    chapter_id: 11,
    chapter_title: 'Chương 1',
    status: 'blocked',
    current_revision: { revision_number: 1 },
  }],
  recentPurgeArchives: [],
  entityStates: [],
  threadStates: [],
  itemStates: [],
  relationshipStates: [],
  recentEvents: [],
  recentReports: [],
  recentEvidence: [],
  recentRevisions: [],
  plotThreads: [],
  criticalConstraints: {
    activeWarnings: [],
    deadCharacters: [],
    blockedItems: [],
    sensitiveRelationships: [],
  },
};

function revisionDetail(revisionId) {
  return {
    chapter: { id: 11, title: 'Chương 1' },
    commit: { current_revision_id: revisionId },
    revision: {
      id: revisionId,
      revision_number: revisionId === 102 ? 2 : 1,
      status: revisionId === 102 ? 'draft' : 'blocked',
      chapter_text: revisionId === 102 ? 'Nội dung AI đã sửa' : 'Nội dung cũ',
    },
    reports: [{
      id: 401,
      severity: 'error',
      rule_code: 'TEST_REPORT',
      message: 'Mâu thuẫn canon',
    }],
    events: [],
    evidence: [],
    snapshotData: null,
  };
}

describe('phase10 canon truth repair draft selection', () => {
  let container;
  let root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    projectState = {
      currentProject: { id: 1, title: 'Truyện test' },
      chapters: [{ id: 11, title: 'Chương 1' }],
    };
    codexState = {
      characters: [],
      canonFacts: [],
      loadCodex: vi.fn(),
      createCanonFact: vi.fn(),
      updateCanonFact: vi.fn(),
      deleteCanonFact: vi.fn(),
    };
    canonState = {
      repairPreview: {
        projectId: 1,
        chapterId: 11,
        revisionId: 101,
        reportId: 401,
        text: 'Nội dung AI đã sửa',
        reports: [],
        loading: false,
        error: '',
        savedRevisionId: null,
      },
      repairChapterRevision: vi.fn(),
      saveRepairDraftRevision: vi.fn().mockResolvedValue({ id: 102, revision_number: 2 }),
      savingRepairDraft: false,
      rebuildCanonFromChapter: vi.fn(),
      rebuilding: false,
      lastActionOutcome: null,
      clearRepairText: vi.fn(),
      clearActionOutcome: vi.fn(),
    };

    getProjectCanonOverview.mockResolvedValue(overview);
    getChapterRevisionHistory.mockResolvedValue({
      chapter: { id: 11, title: 'Chương 1' },
      commit: { current_revision_id: 101 },
      revisions: [
        revisionDetail(102).revision,
        revisionDetail(101).revision,
      ],
    });
    getChapterRevisionDetail.mockImplementation(async (_projectId, revisionId) => revisionDetail(revisionId));
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.clearAllMocks();
  });

  it('does not erase save feedback when selecting the newly created draft revision', async () => {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={['/project/1/su-that']}>
          <CanonTruth />
        </MemoryRouter>,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    const baselineOutcomeClears = canonState.clearActionOutcome.mock.calls.length;
    const baselinePreviewClears = canonState.clearRepairText.mock.calls.length;
    const saveButton = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent.includes('Lưu thành bản nháp'));

    expect(saveButton).toBeTruthy();

    await act(async () => {
      saveButton.click();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(canonState.saveRepairDraftRevision).toHaveBeenCalled();
    expect(canonState.clearActionOutcome).toHaveBeenCalledTimes(baselineOutcomeClears);
    expect(canonState.clearRepairText).toHaveBeenCalledTimes(baselinePreviewClears);
  });
});
