import { describe, expect, it } from 'vitest';
import {
  buildCanonReviewContext,
  normalizeCanonReviewResult,
} from '../../services/labLite/canonReview.js';
import { buildCanonReviewPrompt } from '../../services/labLite/prompts/canonReviewPrompt.js';
import { TASK_TYPES } from '../../services/ai/router.js';

const canonPack = {
  id: 'pack_review',
  title: 'Original Canon Pack',
  globalCanon: { summary: 'Lan is alive. Kha is missing after chapter 20.' },
  characterCanon: [
    { name: 'Lan', status: 'alive', voice: 'calm, clipped' },
    { name: 'Kha', status: 'missing', voice: 'indirect' },
  ],
  relationshipCanon: [
    { characterA: 'Lan', characterB: 'Kha', relation: 'allies', change: 'Trust is fragile.' },
  ],
  chapterCanon: [
    { chapterIndex: 20, summary: 'Kha disappears at the old shrine.' },
  ],
  styleCanon: { tone: 'restrained', pacing: 'slow reveal', observations: ['Short dialogue.'] },
  canonRestrictions: ['Kha must not return before the shrine seal is opened.'],
  creativeGaps: ['Lan can investigate the missing shrine records.'],
};

describe('Lab Lite Phase 9 - AI Canon Review', () => {
  it('builds scoped review context by mode without returning the full Canon Pack', () => {
    const quick = buildCanonReviewContext({
      mode: 'quick',
      canonPack,
      project: { project_mode: 'fanfic', canon_adherence_level: 'strict' },
      newText: 'Lan hears Kha speaking beside the sealed shrine.',
      charCap: 2400,
    });
    const deep = buildCanonReviewContext({
      mode: 'deep',
      canonPack,
      project: { project_mode: 'fanfic', canon_adherence_level: 'strict' },
      newText: 'Lan hears Kha speaking beside the sealed shrine.',
      sourceChapters: [
        { index: 20, title: 'Old Shrine', content: 'Kha vanishes. The seal remains closed. Lan cannot find him.' },
      ],
      charCap: 4000,
    });

    expect(quick.mode).toBe('quick');
    expect(quick.packTitle).toBe('Original Canon Pack');
    expect(quick.canonRestrictions).toContain('Kha must not return before the shrine seal is opened.');
    expect(JSON.stringify(quick).length).toBeLessThanOrEqual(2400);
    expect(quick).not.toHaveProperty('sourceExcerpts');
    expect(deep.sourceExcerpts[0].content).toContain('Kha vanishes');
    expect(deep).not.toHaveProperty('fullRawCorpusText');
  });

  it('creates a strict JSON prompt for CANON_REVIEW and avoids guarantee language', () => {
    const messages = buildCanonReviewPrompt({
      mode: 'standard',
      reviewContext: buildCanonReviewContext({ mode: 'standard', canonPack, newText: 'Lan waits.' }),
      newText: 'Lan says Kha returned yesterday.',
      currentChapterText: 'Lan waits beside the old shrine.',
    });

    expect(TASK_TYPES.CANON_REVIEW).toBe('canon_review');
    expect(messages).toHaveLength(2);
    expect(messages[0].content).toContain('AI Canon Review của StoryForge Lab Lite');
    expect(messages[0].content).toContain('gợi ý phát hiện khả năng lệch canon');
    expect(messages[1].content).toContain('"verdict"');
    expect(`${messages[0].content}\n${messages[1].content}`.toLowerCase()).not.toContain('guarantee');
  });

  it('normalizes invalid review output conservatively and clamps issue fields', () => {
    const result = normalizeCanonReviewResult({
      verdict: 'impossible',
      issues: [
        {
          type: 'bad_type',
          severity: 'extreme',
          quote: 'Q'.repeat(2000),
          canonReference: 'Kha is missing.',
          explanation: 'Conflict.',
          suggestedFix: 'Remove Kha from the scene.',
        },
        null,
      ],
      confidence: 3,
    }, {
      mode: 'standard',
      canonPackId: 'pack_review',
      projectId: 9,
      chapterId: 10,
      sceneId: 11,
    });

    expect(result.verdict).toBe('needs_user_confirmation');
    expect(result.confidence).toBe(1);
    expect(result.mode).toBe('standard');
    expect(result.canonPackId).toBe('pack_review');
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toEqual(expect.objectContaining({
      type: 'state',
      severity: 'medium',
      canonReference: 'Kha is missing.',
      suggestedFix: 'Remove Kha from the scene.',
    }));
    expect(result.issues[0].quote.length).toBeLessThanOrEqual(360);
  });

  it('downgrades non-clean verdicts to no obvious issue when AI returns no usable issues', () => {
    const result = normalizeCanonReviewResult({
      verdict: 'possible_drift',
      issues: [],
      confidence: 0.7,
    }, {
      mode: 'standard',
      canonPackId: 'pack_review',
    });

    expect(result.verdict).toBe('no_obvious_issue');
    expect(result.issues).toEqual([]);
    expect(result.confidence).toBe(0.7);
  });

  it('falls back to no obvious issue for unusable AI output', () => {
    const result = normalizeCanonReviewResult('not-json', {
      mode: 'quick',
      canonPackId: 'pack_review',
    });

    expect(result.verdict).toBe('no_obvious_issue');
    expect(result.issues).toEqual([]);
    expect(result.confidence).toBe(0);
  });
});
