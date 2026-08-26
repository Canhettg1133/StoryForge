import { describe, expect, it } from 'vitest';
import {
  analyzeLocalManuscript,
  segmentSentences,
  segmentWords,
} from '../../services/revisionQa/localAnalysis.js';
import {
  LOCAL_REVISION_QA_CORPUS,
  getLocalRevisionQaFixture,
} from '../fixtures/localRevisionQaCorpus.js';

function sourceFor(fixture, index = 0) {
  return {
    projectId: 1,
    chapterId: 11,
    sceneId: 101 + index,
    text: fixture.text,
    sourceText: fixture.text,
    offsetBase: 0,
  };
}

async function analyzeFixture(id, options = {}) {
  const fixture = getLocalRevisionQaFixture(id);
  return analyzeLocalManuscript({
    sources: [sourceFor(fixture)],
    scope: 'scene',
    profile: options.profile || 'overview',
    runId: `run-${id}`,
    phraseConfig: options.phraseConfig || { blacklist: [], whitelist: [] },
  });
}

describe('local Revision QA engine', () => {
  it('keeps the 20-paragraph corpus balanced without using style metadata as input', () => {
    expect(LOCAL_REVISION_QA_CORPUS).toHaveLength(20);
    expect(LOCAL_REVISION_QA_CORPUS.filter((item) => item.styleBucket === 'synthetic_human_like')).toHaveLength(10);
    expect(LOCAL_REVISION_QA_CORPUS.filter((item) => item.styleBucket === 'synthetic_ai_like')).toHaveLength(10);
    expect(sourceFor(LOCAL_REVISION_QA_CORPUS[0])).not.toHaveProperty('styleBucket');
  });

  it('segments Vietnamese words and sentences with stable UTF-16 indices', () => {
    const text = 'Vy đặt nhẫn 💍. Cô đi.';
    const words = segmentWords(text);
    const sentences = segmentSentences(text);

    expect(words.map((item) => item.segment)).toEqual(['Vy', 'đặt', 'nhẫn', 'Cô', 'đi']);
    expect(text.slice(words[3].index, words[3].end)).toBe('Cô');
    expect(sentences.map((item) => item.text)).toEqual(['Vy đặt nhẫn 💍.', 'Cô đi.']);
  });

  it('keeps Unicode fallback word units aligned with Intl.Segmenter for the fixed corpus', () => {
    for (const fixture of LOCAL_REVISION_QA_CORPUS) {
      expect(
        segmentWords(fixture.text, { forceFallback: true }).map((item) => item.segment),
        fixture.id,
      ).toEqual(segmentWords(fixture.text).map((item) => item.segment));
    }
  });

  it('does not emit high or medium findings for the clean human-like controls', async () => {
    const cleanIds = ['H01', 'H02', 'H03', 'H04', 'H06', 'H07', 'H08', 'H09'];
    for (const id of cleanIds) {
      const result = await analyzeFixture(id);
      expect(result.findings.filter((item) => item.severity !== 'low'), id).toEqual([]);
    }
  });

  it('emits no unexpected high or medium findings across all 20 fixed paragraphs', async () => {
    const expected = {
      A11: ['CLICHE_MATCH', 'CLICHE_MATCH'],
      A14: ['LONG_SENTENCE'],
      A15: ['MECHANICAL_SHORT_RUN'],
      A17: ['UNBALANCED_QUOTES'],
      A18: ['SPACE_BEFORE_PUNCTUATION', 'SPACE_BEFORE_PUNCTUATION', 'SPACE_BEFORE_PUNCTUATION'],
    };

    for (const fixture of LOCAL_REVISION_QA_CORPUS) {
      const result = await analyzeFixture(fixture.id, {
        phraseConfig: {
          blacklist: [
            'không khí đặc quánh lại',
            'mọi người đều há hốc mồm kinh ngạc',
            'mặt hồ phẳng như gương',
          ],
          whitelist: fixture.id === 'H10' ? ['mặt hồ phẳng như gương'] : [],
        },
      });
      const actual = result.findings
        .filter((finding) => finding.severity === 'high' || finding.severity === 'medium')
        .map((finding) => finding.rule_id)
        .sort();
      expect(actual, fixture.id).toEqual([...(expected[fixture.id] || [])].sort());
    }
  });

  it('treats deliberate repeated openings as an observable low-severity signal', async () => {
    const result = await analyzeFixture('H05');
    expect(result.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ rule_id: 'REPEATED_OPENING', severity: 'low' }),
    ]));
  });

  it('matches project phrases accent-insensitively and honors the whitelist', async () => {
    const flagged = await analyzeFixture('A11', {
      phraseConfig: {
        blacklist: ['không khí đặc quánh lại', 'mọi người đều há hốc mồm kinh ngạc'],
        whitelist: [],
      },
    });
    expect(flagged.findings.filter((item) => item.rule_id === 'CLICHE_MATCH')).toHaveLength(2);

    const allowed = await analyzeFixture('H10', {
      phraseConfig: {
        blacklist: ['mặt hồ phẳng như gương'],
        whitelist: ['mặt hồ phẳng như gương'],
      },
    });
    expect(allowed.findings.some((item) => item.rule_id === 'CLICHE_MATCH')).toBe(false);
  });

  it.each([
    ['A12', 'REPEATED_TERM_WINDOW'],
    ['A13', 'REPEATED_NGRAM'],
    ['A13', 'REPEATED_OPENING'],
    ['A15', 'MECHANICAL_SHORT_RUN'],
    ['A16', 'DENSE_DIALOGUE'],
    ['A17', 'UNBALANCED_QUOTES'],
    ['A19', 'PUNCTUATION_BURST'],
  ])('detects %s with rule %s', async (id, ruleId) => {
    const result = await analyzeFixture(id);
    expect(result.findings.some((item) => item.rule_id === ruleId)).toBe(true);
  });

  it('classifies the 82-word sentence as high severity while leaving the 41-word sentence below threshold', async () => {
    const longResult = await analyzeFixture('A14');
    const boundaryResult = await analyzeFixture('H04');

    expect(longResult.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ rule_id: 'LONG_SENTENCE', severity: 'high', confidence: 0.9 }),
    ]));
    expect(boundaryResult.findings.some((item) => item.rule_id === 'LONG_SENTENCE')).toBe(false);
  });

  it('only offers editable mechanical replacements for safe formatting rules', async () => {
    const result = await analyzeFixture('A18');
    const fixes = result.findings.filter((item) => item.replacement);

    expect(fixes.length).toBeGreaterThanOrEqual(3);
    expect(fixes.every((item) => item.category === 'format')).toBe(true);
    expect(fixes.every((item) => item.replacement.kind === 'mechanical')).toBe(true);
    expect(result.findings.filter((item) => item.category !== 'format').every((item) => item.replacement === null)).toBe(true);
  });

  it('returns two independent fixes for duplicate-looking evidence', async () => {
    const result = await analyzeFixture('A20');
    const fixes = result.findings.filter((item) => item.rule_id === 'MULTIPLE_SPACES');

    expect(fixes).toHaveLength(2);
    expect(fixes[0].anchor.prefix).not.toBe(fixes[1].anchor.prefix);
    expect(fixes[0].anchor.from).toBeLessThan(fixes[1].anchor.from);
  });

  it('filters rules by profile instead of claiming semantic story pacing', async () => {
    const result = await analyzeFixture('A18', { profile: 'pacing' });
    expect(result.findings.every((item) => item.category === 'pacing' || item.category === 'style')).toBe(true);
    expect(result.findings.some((item) => item.category === 'format')).toBe(false);
  });
});
