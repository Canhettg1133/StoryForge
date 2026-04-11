/**
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest';
import { parseAnalysisResults } from '../../services/viewer/analysisParser.js';

describe('analysisParser regressions', () => {
  it('dedupes mirrored knowledge characters and filters bad knowledge locations', () => {
    const sharedTimeline = [
      {
        chapter: 1,
        summary: 'Lam Tham den nha tro so 18.',
      },
    ];

    const raw = {
      knowledge: {
        characters: [
          { name: 'Lam Tham', role: 'protagonist' },
          { name: 'Tan Ky Vu', role: 'antagonist' },
          { name: 'Dao Dao', role: 'supporting' },
        ],
        locations: [
          { name: 'Dao Dao', timeline: sharedTimeline },
          { name: 'Dao Dao thay the', timeline: sharedTimeline },
          {
            name: 'So 18 Nha Tro',
            description: 'Toa nha bi suong mu bao phu.',
            timeline: sharedTimeline,
            mentionCount: 3,
          },
        ],
      },
      characters: {
        profiles: [
          { name: 'Lam Tham', role: 'protagonist' },
          { name: 'Tan Ky Vu', role: 'antagonist' },
          { name: 'Dao Dao', role: 'supporting' },
        ],
      },
      worldbuilding: {
        locations: [
          {
            name: 'So 18 Nha Tro',
            description: 'Toa nha bi suong mu bao phu.',
            timeline: sharedTimeline,
            mentionCount: 4,
          },
        ],
      },
    };

    const parsed = parseAnalysisResults(raw);

    expect(parsed.characterProfiles.map((item) => item.name)).toEqual([
      'Lam Tham',
      'Tan Ky Vu',
      'Dao Dao',
    ]);

    expect(parsed.locations.map((item) => item.name)).toEqual([
      'So 18 Nha Tro',
    ]);
    expect(parsed.locations[0].timeline).toEqual([
      {
        eventId: null,
        chapter: 1,
        summary: 'Lam Tham den nha tro so 18.',
      },
    ]);
  });

  it('dedupes mirrored objects and terms from canonical knowledge', () => {
    const raw = {
      knowledge: {
        objects: [
          { name: 'Chia khoa van nang', owner: 'Lam Tham' },
          { name: 'Cong tac nhat ky', owner: 'Nguoi tro ly truoc' },
        ],
        terms: [
          { name: 'Thanh ly gian phong', category: 'concept' },
          { name: 'O khoa chu Nguc', category: 'concept' },
        ],
      },
      objects: [
        { name: 'Chia khoa van nang', owner: 'Lam Tham' },
        { name: 'Cong tac nhat ky', owner: 'Nguoi tro ly truoc' },
      ],
      worldbuilding: {
        objects: [
          { name: 'Chia khoa van nang', owner: 'Lam Tham' },
        ],
        terms: [
          { name: 'Thanh ly gian phong', category: 'concept' },
        ],
      },
      terms: [
        { name: 'Thanh ly gian phong', category: 'concept' },
        { name: 'O khoa chu Nguc', category: 'concept' },
      ],
    };

    const parsed = parseAnalysisResults(raw);
    expect(parsed.objects.map((item) => item.name)).toEqual([
      'Chia khoa van nang',
      'Cong tac nhat ky',
    ]);
    expect(parsed.terms.map((item) => item.name)).toEqual([
      'Thanh ly gian phong',
      'O khoa chu Nguc',
    ]);
  });

  it('dedupes canonical knowledge locations before rendering', () => {
    const raw = {
      knowledge: {
        locations: [
          { id: 'loc_v2_1', name: 'San sau lau day hoc', description: 'Noi xay ra doi dau.' },
          { id: 'loc_v2_1', name: 'San sau lau day hoc', description: 'Noi xay ra doi dau.' },
          { id: 'loc_v2_2', name: 'Hanh lang lau 1', description: 'Noi Lam Tham nhan ra quy tac.' },
        ],
      },
    };

    const parsed = parseAnalysisResults(raw);
    expect(parsed.locations.map((item) => item.name)).toEqual([
      'San sau lau day hoc',
      'Hanh lang lau 1',
    ]);
  });

  it('infers fallback objects and terms from events when pass C knowledge is missing', () => {
    const raw = {
      events: {
        majorEvents: [
          {
            id: 'evt-1',
            description: 'Lam Tham dung Chia khoa van nang mo phong 0104.',
            chapter: 1,
            tags: ['mo khoa'],
          },
          {
            id: 'evt-2',
            description: 'Ly Phang hoang so lam tat Nen, pha vo quy tac 3 nam 1 nu.',
            chapter: 2,
            evidenceSnippet: 'Quy tac 3 nam 1 nu la cot loi cua tro choi.',
          },
        ],
      },
      incidents: [
        {
          id: 'inc-1',
          title: 'Nguoi thu nam',
          chapterStart: 2,
          description: 'Lam Tham nhan ra minh la nguoi thu nam.',
        },
      ],
    };

    const parsed = parseAnalysisResults(raw);
    expect(parsed.objects.map((item) => item.name)).toContain('Chia khoa van nang');
    expect(parsed.objects.map((item) => item.name)).toContain('Nen');
    expect(parsed.terms.map((item) => item.name)).toContain('Quy tac 3 nam 1 nu');
    expect(parsed.terms.map((item) => item.name)).toContain('Nguoi thu nam');
  });
});
