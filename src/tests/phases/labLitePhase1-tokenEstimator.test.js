import { describe, expect, it } from 'vitest';
import { countLabLiteWords, estimateTokens, summarizeTextStats } from '../../services/labLite/tokenEstimator.js';

describe('Lab Lite Phase 1 - token estimator', () => {
  it('returns zero for blank text', () => {
    expect(countLabLiteWords('   \n\t')).toBe(0);
    expect(estimateTokens('   \n\t')).toBe(0);
  });

  it('counts words with apostrophes, underscores, and numbers', () => {
    expect(countLabLiteWords("hero's sword level_2 chapter-3")).toBe(4);
  });

  it('keeps estimates monotonic as text grows', () => {
    const small = estimateTokens('alpha beta gamma');
    const large = estimateTokens('alpha beta gamma '.repeat(80));

    expect(large).toBeGreaterThan(small);
  });

  it('estimates CJK-heavy text even without spaces', () => {
    expect(estimateTokens('修仙世界秘密揭开主角获得新力量')).toBeGreaterThan(8);
  });

  it('summarizes chars, words, and estimated tokens together', () => {
    const stats = summarizeTextStats('alpha beta gamma');

    expect(stats).toEqual({
      charCount: 16,
      wordCount: 3,
      estimatedTokens: expect.any(Number),
    });
    expect(stats.estimatedTokens).toBeGreaterThan(0);
  });
});
