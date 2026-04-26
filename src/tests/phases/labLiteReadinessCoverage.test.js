import { describe, expect, it } from 'vitest';
import { createEmptyCanonPack } from '../../services/labLite/canonPackSchema.js';
import { evaluateCanonPackReadiness } from '../../services/labLite/canonPackReadiness.js';

describe('Lab Lite readiness coverage integration', () => {
  it('summarizes real scout, synthetic scout, digest, deep, failed, and missing coverage', () => {
    const pack = createEmptyCanonPack({ title: 'Coverage Pack' });
    pack.chapterCanon = [{ chapterIndex: 1, summary: 'Chương đã có digest.' }];

    const readiness = evaluateCanonPackReadiness(pack, { chapterCount: 5 }, {
      deepAnalysisItems: [{ status: 'complete' }],
      chapterCoverage: [
        { chapterIndex: 1, scoutDone: true, digestDone: true, deepDone: true, status: 'complete' },
        { chapterIndex: 2, scoutSynthetic: true, status: 'synthetic_fallback' },
        { chapterIndex: 3, scoutDone: true, status: 'complete' },
        { chapterIndex: 4, status: 'error', failedReason: 'Bad JSON' },
      ],
    });

    expect(readiness.coverage).toEqual(expect.objectContaining({
      chapterCount: 5,
      chapterCanonCount: 1,
      completedDeepCount: 1,
      scoutDone: 2,
      scoutSynthetic: 1,
      digestDone: 1,
      deepDone: 1,
      failed: 1,
      missing: 2,
    }));
  });

  it('does not count synthetic scout fallback as real scout coverage', () => {
    const readiness = evaluateCanonPackReadiness(createEmptyCanonPack({ title: 'Synthetic' }), { chapterCount: 3 }, {
      chapterCoverage: [
        { chapterIndex: 1, scoutSynthetic: true, status: 'synthetic_fallback' },
        { chapterIndex: 2, scoutSynthetic: true, status: 'synthetic_fallback' },
      ],
    });

    expect(readiness.coverage.scoutDone).toBe(0);
    expect(readiness.coverage.scoutSynthetic).toBe(2);
    expect(readiness.coverage.missing).toBe(1);
  });

  it('tracks digest and deep coverage independently', () => {
    const readiness = evaluateCanonPackReadiness(createEmptyCanonPack({ title: 'Digest Deep' }), { chapterCount: 4 }, {
      chapterCoverage: [
        { chapterIndex: 1, digestDone: true },
        { chapterIndex: 2, deepDone: true },
        { chapterIndex: 3, digestDone: true, deepDone: true },
      ],
    });

    expect(readiness.coverage.digestDone).toBe(2);
    expect(readiness.coverage.deepDone).toBe(2);
  });

  it('handles partial coverage for a 2000 chapter corpus without inflating completion', () => {
    const readiness = evaluateCanonPackReadiness(createEmptyCanonPack({ title: 'Large' }), { chapterCount: 2000 }, {
      chapterCoverage: [
        { chapterIndex: 1, scoutDone: true },
        { chapterIndex: 2, scoutDone: true },
        { chapterIndex: 3, scoutSynthetic: true },
        { chapterIndex: 4, status: 'error' },
      ],
    });

    expect(readiness.coverage.scoutDone).toBe(2);
    expect(readiness.coverage.scoutSynthetic).toBe(1);
    expect(readiness.coverage.failed).toBe(1);
    expect(readiness.coverage.missing).toBe(1997);
  });

  it('keeps backward compatibility when coverage is omitted', () => {
    const readiness = evaluateCanonPackReadiness(createEmptyCanonPack({ title: 'No Coverage' }), { chapterCount: 10 }, {
      deepAnalysisItems: [],
    });

    expect(readiness.coverage).toEqual(expect.objectContaining({
      chapterCount: 10,
      scoutDone: 0,
      scoutSynthetic: 0,
      digestDone: 0,
      deepDone: 0,
      failed: 0,
      missing: 10,
    }));
  });
});
