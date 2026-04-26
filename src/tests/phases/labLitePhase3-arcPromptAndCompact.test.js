import { describe, expect, it } from 'vitest';
import { compactScoutResultsForArcMapper } from '../../services/labLite/arcMapper.js';
import { buildArcMapperPrompt } from '../../services/labLite/prompts/arcMapperPrompt.js';

describe('Lab Lite Phase 3 - arc mapper prompt and compact input', () => {
  it('compacts only complete scout results and sorts by chapter index', () => {
    const compact = compactScoutResultsForArcMapper([
      { chapterIndex: 5, status: 'error', reason: 'fail' },
      {
        chapterIndex: 3,
        status: 'complete',
        priority: 'high',
        recommendation: 'deep_load',
        detectedSignals: ['reveal'],
        reason: 'A'.repeat(500),
        confidence: 0.8,
      },
      {
        chapterIndex: 1,
        status: 'complete',
        priority: 'medium',
        recommendation: 'light_load',
        detectedSignals: ['worldbuilding'],
        reason: 'Setup.',
        confidence: 0.6,
      },
    ]);

    expect(compact.map((item) => item.chapterIndex)).toEqual([1, 3]);
    expect(compact[1].reason.length).toBe(360);
  });

  it('does not include full chapter text in compact scout results', () => {
    const compact = compactScoutResultsForArcMapper([{
      chapterIndex: 1,
      status: 'complete',
      priority: 'critical',
      recommendation: 'deep_load',
      detectedSignals: ['reveal'],
      reason: 'Important reveal.',
      content: 'FULL CHAPTER SHOULD NOT BE SENT',
      confidence: 0.9,
    }]);

    expect(compact[0]).not.toHaveProperty('content');
  });

  it('builds strict JSON arc mapper messages from compact input', () => {
    const messages = buildArcMapperPrompt({
      chapterCount: 300,
      windowLabel: '1-200',
      scoutResults: [{
        chapterIndex: 1,
        priority: 'high',
        recommendation: 'deep_load',
        detectedSignals: ['reveal'],
        reason: 'Opening reveal.',
        confidence: 0.8,
      }],
    });

    expect(messages).toHaveLength(2);
    expect(messages[0].content).toContain('Chỉ trả JSON hợp lệ');
    expect(messages[0].content).toContain('Chỉ dùng metadata Scout');
    expect(messages[1].content).toContain('"windowLabel": "1-200"');
    expect(messages[1].content).toContain('"chapterCount": 300');
    expect(messages[1].content).toContain('recommendedDeepChapters');
  });
});
