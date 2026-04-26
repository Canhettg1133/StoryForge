import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import useLabLiteStore from '../../stores/labLiteStore.js';
import { PROJECT_CONTENT_MODES } from '../../features/projectContentMode/projectContentMode.js';

describe('Lab Lite full UX preset runner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useLabLiteStore.setState(useLabLiteStore.getInitialState(), true);
  });

  it('runs fast preset as Scout only and never materializes Story Bible', async () => {
    const calls = [];
    useLabLiteStore.setState({
      currentCorpusId: 'corpus_preset',
      chapters: [{ index: 1, corpusId: 'corpus_preset' }],
      runScout: vi.fn(async () => {
        calls.push('scout');
        return [];
      }),
      runArcMapper: vi.fn(async () => {
        calls.push('arc');
        return [];
      }),
      runDeepAnalysis: vi.fn(async () => {
        calls.push('deep');
        return null;
      }),
      buildCanonPack: vi.fn(async () => {
        calls.push('canon');
        return null;
      }),
      applyMaterialization: vi.fn(async () => {
        calls.push('materialize');
        return null;
      }),
    });

    await useLabLiteStore.getState().runAnalysisPreset({
      mode: 'fast',
      goal: 'story_bible',
      contentMode: PROJECT_CONTENT_MODES.SAFE,
      concurrency: 2,
    });

    expect(calls).toEqual(['scout']);
    expect(useLabLiteStore.getState().presetRunState.status).toBe('complete');
  });

  it('runs complete preset through Scout, Arc, Deep, and Canon Pack without materializing', async () => {
    const calls = [];
    useLabLiteStore.setState({
      currentCorpusId: 'corpus_preset',
      chapters: [{ index: 1, corpusId: 'corpus_preset' }, { index: 2, corpusId: 'corpus_preset' }],
      scoutResults: [
        { corpusId: 'corpus_preset', chapterIndex: 1, recommendation: 'deep_load', priority: 'high' },
      ],
      arcs: [
        { id: 'arc_1', recommendedDeepChapters: [1], importance: 'high' },
      ],
      setDeepChapterSelection: vi.fn((chapterIndexes) => {
        calls.push(`select:${chapterIndexes.join(',')}`);
      }),
      runScout: vi.fn(async () => {
        calls.push('scout');
        return [];
      }),
      runArcMapper: vi.fn(async () => {
        calls.push('arc');
        return [];
      }),
      runDeepAnalysis: vi.fn(async () => {
        calls.push('deep');
        return null;
      }),
      buildCanonPack: vi.fn(async () => {
        calls.push('canon');
        return null;
      }),
      applyMaterialization: vi.fn(async () => {
        calls.push('materialize');
        return null;
      }),
    });

    await useLabLiteStore.getState().runAnalysisPreset({
      mode: 'complete',
      goal: 'story_bible',
      contentMode: PROJECT_CONTENT_MODES.SAFE,
      concurrency: 2,
    });

    expect(calls).toEqual(['scout', 'arc', 'select:1', 'deep', 'canon']);
    expect(calls).not.toContain('materialize');
  });
});
