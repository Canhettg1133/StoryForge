import { describe, expect, it } from 'vitest';
import {
  buildChapterScoutBatchPrompt,
  buildChapterScoutPrompt,
  LAB_LITE_SCOUT_GOALS,
} from '../../services/labLite/prompts/chapterScoutPrompt.js';

describe('Lab Lite Phase 2 - scout prompt contract', () => {
  const sample = {
    title: 'Chapter 5: Reveal',
    chapterIndex: 5,
    totalChapters: 20,
    wordCount: 1200,
    estimatedTokens: 1500,
    opening: 'Opening sample.',
    middle: ['Middle sample.'],
    ending: 'Ending sample.',
  };

  it('returns system and user messages for strict JSON scout output', () => {
    const messages = buildChapterScoutPrompt({ chapterSample: sample, goal: LAB_LITE_SCOUT_GOALS.FANFIC });

    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe('system');
    expect(messages[0].content).toContain('Chỉ trả JSON hợp lệ');
    expect(messages[1].role).toBe('user');
    expect(messages[1].content).toContain('"goal": "fanfic"');
    expect(messages[1].content).toContain('"chapterIndex": 5');
  });

  it('requires Vietnamese-with-diacritics reasons for scout output', () => {
    const messages = buildChapterScoutPrompt({ chapterSample: sample });

    expect(messages[0].content).toContain('Trường reason phải viết bằng tiếng Việt có dấu');
    expect(messages[1].content).toContain('Lý do ngắn bằng tiếng Việt có dấu');
  });

  it('instructs safe mode to avoid adult_sensitive signal', () => {
    const messages = buildChapterScoutPrompt({ chapterSample: sample, allowAdultSignals: false });

    expect(messages[1].content).toContain('Không dùng adult_sensitive');
    expect(messages[1].content).toContain('sensitive_or_relationship_heavy');
  });

  it('allows adult_sensitive only when content mode permits it', () => {
    const messages = buildChapterScoutPrompt({ chapterSample: sample, allowAdultSignals: true });

    expect(messages[1].content).toContain('Được dùng adult_sensitive');
  });

  it('states that fixed keywords should not drive scout decisions', () => {
    const messages = buildChapterScoutPrompt({ chapterSample: sample });

    expect(messages[0].content).toContain('Không dựa vào keyword cứng');
  });

  it('builds a Vietnamese batch Scout prompt for multiple chapter samples', () => {
    const messages = buildChapterScoutBatchPrompt({
      chapterSamples: [sample, { ...sample, chapterIndex: 6, title: 'Chương 6' }],
      goal: LAB_LITE_SCOUT_GOALS.FANFIC,
    });

    expect(messages).toHaveLength(2);
    expect(messages[0].content).toContain('quét nhiều chương');
    expect(messages[0].content).toContain('một kết quả cho mỗi chapterIndex');
    expect(messages[1].content).toContain('"chapterSamples"');
    expect(messages[1].content).toContain('"results"');
  });
});
