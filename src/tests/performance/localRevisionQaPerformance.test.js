import { describe, expect, it } from 'vitest';
import { analyzeLocalManuscript } from '../../services/revisionQa/localAnalysis.js';

const TEN_WORD_SENTENCE = 'Lan bước qua hiên, nhìn mưa rơi rồi khép cửa. ';

async function measureWordBudget(wordCount) {
  const text = TEN_WORD_SENTENCE.repeat(wordCount / 10);
  const startedAt = performance.now();
  const result = await analyzeLocalManuscript({
    sources: [{ projectId: 1, chapterId: 1, sceneId: 1, text, sourceText: text, offsetBase: 0 }],
    scope: 'scene',
    profile: 'overview',
    phraseConfig: { blacklist: [], whitelist: [] },
  });
  return { elapsed: performance.now() - startedAt, result };
}

describe('local Revision QA performance budget', () => {
  it('analyzes 10,000 and 50,000 Vietnamese word-like units within the warmed Worker budgets', async () => {
    await measureWordBudget(1_000);

    const tenThousand = await measureWordBudget(10_000);
    expect(tenThousand.result.metrics.words).toBe(10_000);
    expect(tenThousand.elapsed).toBeLessThanOrEqual(1_000);

    const fiftyThousand = await measureWordBudget(50_000);
    expect(fiftyThousand.result.metrics.words).toBe(50_000);
    expect(fiftyThousand.elapsed).toBeLessThanOrEqual(3_000);
  }, 10_000);
});
