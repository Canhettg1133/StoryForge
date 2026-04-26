import { describe, expect, it } from 'vitest';
import { normalizeArcResults } from '../../services/labLite/arcMapper.js';
import { parseChaptersFromText, splitChapterAtLine } from '../../services/labLite/chapterParser.js';
import { normalizeScoutResult } from '../../services/labLite/chapterScout.js';
import { countLabLiteWords, estimateTokens, summarizeTextStats } from '../../services/labLite/tokenEstimator.js';

describe('Lab Lite Phase 1-3 services', () => {
  it('splits Vietnamese and English chapter headings with front matter diagnostics', () => {
    const text = [
      'Nguon: demo archive',
      'Tac gia: Somebody',
      '',
      'Chuong 1: Mo dau',
      '',
      'Noi dung chuong mot co nhan vat moi va mot bien co nho.',
      '',
      'Chapter 2: The Turn',
      '',
      'The second chapter changes the relationship and opens the next hook.',
    ].join('\n');

    const parsed = parseChaptersFromText(text, { corpusId: 'corpus_test' });

    expect(parsed.chapters).toHaveLength(2);
    expect(parsed.chapters[0]).toEqual(expect.objectContaining({
      corpusId: 'corpus_test',
      index: 1,
      title: expect.stringContaining('Chuong 1'),
      wordCount: expect.any(Number),
      estimatedTokens: expect.any(Number),
    }));
    expect(parsed.frontMatter?.content).toContain('Tac gia');
    expect(parsed.diagnostics.acceptedBoundaries).toHaveLength(2);
  });

  it('does not double split duplicate headings separated by decorative lines', () => {
    const text = [
      '=====',
      'Chuong 01: Arrival',
      '=====',
      '',
      'Chuong 01: Arrival',
      '',
      'This is the real body of chapter one with enough words to count as content.',
      '',
      '=====',
      'Chuong 02: Exit',
      '=====',
      '',
      'Chuong 02: Exit',
      '',
      'This is the real body of chapter two with enough words to count as content.',
    ].join('\n');

    const parsed = parseChaptersFromText(text);

    expect(parsed.chapters).toHaveLength(2);
    expect(parsed.chapters[0].content).toContain('real body of chapter one');
    expect(parsed.chapters[1].content).toContain('real body of chapter two');
  });

  it('manual split preserves order and recomputes stats', () => {
    const chapters = [{
      id: 'c1',
      corpusId: 'corpus_test',
      index: 1,
      title: 'Chapter 1',
      content: ['First half line one.', 'First half line two.', 'Second half line one.', 'Second half line two.'].join('\n'),
    }];

    const split = splitChapterAtLine(chapters, 'c1', 2, 'Chapter 2');

    expect(split).toHaveLength(2);
    expect(split[0].index).toBe(1);
    expect(split[1].index).toBe(2);
    expect(split[0].content).toContain('First half');
    expect(split[1].content).toContain('Second half');
    expect(split[0].wordCount).toBeGreaterThan(0);
    expect(split[1].estimatedTokens).toBeGreaterThan(0);
  });

  it('estimates stable positive tokens for English, Vietnamese, and CJK text', () => {
    expect(countLabLiteWords('one two three')).toBe(3);
    expect(estimateTokens('toi muon viet tiep cau chuyen nay')).toBeGreaterThan(0);
    expect(estimateTokens('修仙世界的秘密慢慢揭开')).toBeGreaterThan(0);
    expect(summarizeTextStats('alpha beta').wordCount).toBe(2);
  });

  it('normalizes scout JSON and maps adult signals in safe mode', () => {
    const normalized = normalizeScoutResult({
      chapterIndex: 7,
      priority: 'critical',
      recommendation: 'deep_load',
      detectedSignals: ['adult_sensitive', 'reveal', 'unknown_signal'],
      reason: 'A major reveal changes the relationship state.',
      confidence: 1.4,
    }, {
      corpusId: 'corpus_test',
      goal: 'fanfic',
      allowAdultSignals: false,
    });

    expect(normalized.priority).toBe('critical');
    expect(normalized.recommendation).toBe('deep_load');
    expect(normalized.detectedSignals).toEqual(['sensitive_or_relationship_heavy', 'reveal']);
    expect(normalized.confidence).toBe(1);
  });

  it('rejects invalid scout enums to conservative defaults', () => {
    const normalized = normalizeScoutResult({
      chapterIndex: 2,
      priority: 'urgent',
      recommendation: 'load_everything',
      detectedSignals: ['worldbuilding'],
      reason: '',
      confidence: -1,
    }, {
      corpusId: 'corpus_test',
      goal: 'story_bible',
      allowAdultSignals: true,
    });

    expect(normalized.priority).toBe('low');
    expect(normalized.recommendation).toBe('skip');
    expect(normalized.detectedSignals).toEqual(['worldbuilding']);
    expect(normalized.confidence).toBe(0);
  });

  it('validates, sorts, and clips arc mapper results', () => {
    const arcs = normalizeArcResults({
      arcs: [
        {
          id: 'late',
          title: 'Late Arc',
          chapterStart: 12,
          chapterEnd: 99,
          summary: 'Late summary',
          importance: 'critical',
          whyLoad: 'Ending hook',
          recommendedDeepChapters: [12, 30, 120],
        },
        {
          id: 'early',
          title: 'Early Arc',
          chapterStart: 1,
          chapterEnd: 5,
          summary: 'Early summary',
          importance: 'medium',
          whyLoad: 'Setup',
          recommendedDeepChapters: [1, 4],
        },
      ],
    }, {
      corpusId: 'corpus_test',
      chapterCount: 30,
    });

    expect(arcs.map((arc) => arc.id)).toEqual(['early', 'late']);
    expect(arcs[1].chapterEnd).toBe(30);
    expect(arcs[1].recommendedDeepChapters).toEqual([12, 30]);
  });
});
