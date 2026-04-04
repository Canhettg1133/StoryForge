import { describe, expect, it } from 'vitest';
import { groundAnalysisEvents } from '../../services/analysis/eventGrounding.js';

describe('Event Grounding', () => {
  it('maps events to chapter/chunk and provides confidence + evidence', () => {
    const result = {
      events: {
        majorEvents: [
          {
            description: 'Lam Tham thao tung quy tac gioi tinh va so luong de lat nguoc gia thuyet.',
            severity: 'major',
          },
        ],
      },
    };

    const chunks = [
      {
        id: 'chunk-1',
        chapterId: 'ch-1',
        chapterIndex: 1,
        chunkIndex: 1,
        text: 'Mo dau gioi thieu boi canh va gia thuyet tra lai mat cua nhan vat.',
      },
      {
        id: 'chunk-2',
        chapterId: 'ch-5',
        chapterIndex: 5,
        chunkIndex: 9,
        text: 'Cu lat nguoc quan trong: quy tac thuc su la dinh muc so luong va gioi tinh. Lam Tham da thao tung bien so nay.',
      },
    ];

    const grounded = groundAnalysisEvents(result, chunks, {
      qualityThreshold: 60,
      chapterConfidenceThreshold: 0.45,
    });

    const event = grounded.result.events.majorEvents[0];

    expect(event.chapter).toBe(5);
    expect(event.chapterConfidence).toBeGreaterThan(0.4);
    expect(event.grounding.chunkId).toBe('chunk-2');
    expect(event.grounding.evidenceSnippet.length).toBeGreaterThan(20);
    expect(['auto_accepted', 'needs_review']).toContain(event.reviewStatus);
  });

  it('marks low-information events as needs_review', () => {
    const result = {
      events: {
        minorEvents: [{ description: 'Bien co bat ngo.' }],
      },
    };

    const chunks = [
      {
        id: 'chunk-a',
        chapterId: 'ch-a',
        chapterIndex: 3,
        chunkIndex: 2,
        text: 'Doan van ban chung chung, it thong tin cu the.',
      },
    ];

    const grounded = groundAnalysisEvents(result, chunks, {
      qualityThreshold: 70,
      chapterConfidenceThreshold: 0.6,
    });

    const event = grounded.result.events.minorEvents[0];

    expect(event.reviewStatus).toBe('needs_review');
    expect(event.needsReview).toBe(true);
  });
});
