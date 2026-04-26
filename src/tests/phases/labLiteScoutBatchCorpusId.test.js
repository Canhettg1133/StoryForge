import { afterEach, describe, expect, it, vi } from 'vitest';

describe('Lab Lite scout batch corpus scope', () => {
  afterEach(() => {
    vi.doUnmock('../../services/ai/client.js');
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('stamps normalized batch results with explicit corpusId when chapter payload omits it', async () => {
    const send = vi.fn(({ onComplete }) => {
      onComplete(JSON.stringify({
        results: [
          {
            chapterIndex: 1,
            priority: 'high',
            recommendation: 'deep_load',
            detectedSignals: ['reveal'],
            reason: 'Có reveal quan trọng.',
            confidence: 0.8,
          },
          {
            chapterIndex: 2,
            priority: 'low',
            recommendation: 'skip',
            detectedSignals: [],
            reason: 'Chưa cần nạp sâu.',
            confidence: 0.4,
          },
        ],
      }));
    });

    vi.doMock('../../services/ai/client.js', () => ({
      default: {
        setRouter: vi.fn(),
        send,
        abort: vi.fn(),
      },
    }));

    const { runChapterScoutBatch } = await import('../../services/labLite/chapterScout.js');
    const results = await runChapterScoutBatch({
      corpusId: 'corpus_batch_scope',
      totalChapters: 2,
      goal: 'story_bible',
      chapters: [
        {
          id: 'chapter_1',
          index: 1,
          title: 'Chương 1',
          content: 'Nội dung chương một.\n\nĐoạn giữa có reveal.\n\nKết thúc.',
          wordCount: 12,
          estimatedTokens: 32,
        },
        {
          id: 'chapter_2',
          index: 2,
          title: 'Chương 2',
          content: 'Nội dung chương hai.\n\nĐoạn giữa bình thường.\n\nKết thúc.',
          wordCount: 12,
          estimatedTokens: 32,
        },
      ],
    });

    expect(results).toHaveLength(2);
    expect(results.map((item) => item.corpusId)).toEqual(['corpus_batch_scope', 'corpus_batch_scope']);
    expect(results.map((item) => item.chapterIndex)).toEqual([1, 2]);
    expect(send).toHaveBeenCalledTimes(1);
  });
});
