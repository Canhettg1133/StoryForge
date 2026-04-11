import { describe, expect, it } from 'vitest';
import {
  extractLocationEntities,
  linkEventLocations,
  buildIncidentClusters,
  enrichWithIncidentIntelligence,
} from '../../services/analysis/incidentIntelligence.js';

describe('Incident Intelligence', () => {
  it('extracts location entities from chunk text', () => {
    const chunks = [
      {
        id: 'chunk-1',
        chapterId: 'ch-1',
        chapterIndex: 1,
        chunkIndex: 1,
        text: 'Nhan vat gap quy dau tien tai truong trung hoc Hoang Cuong.',
      },
      {
        id: 'chunk-2',
        chapterId: 'ch-4',
        chapterIndex: 4,
        chunkIndex: 2,
        text: 'Vu linh di tiep theo xay ra o thon Hoang Cuong, noi dan lang bien mat.',
      },
    ];

    const extracted = extractLocationEntities(chunks);

    expect(extracted.locations.length).toBeGreaterThan(0);
    expect(extracted.stats.totalLocations).toBe(extracted.locations.length);
  });

  it('links events to locations and builds incident clusters', () => {
    const chunks = [
      {
        id: 'chunk-1',
        chapterId: 'ch-1',
        chapterIndex: 1,
        chunkIndex: 1,
        text: 'Nhan vat gap quy dau tien tai truong trung hoc Hoang Cuong.',
      },
      {
        id: 'chunk-2',
        chapterId: 'ch-2',
        chapterIndex: 2,
        chunkIndex: 2,
        text: 'Tai truong trung hoc Hoang Cuong, nhan vat chinh dieu tra vu an linh di.',
      },
    ];

    const baseResult = {
      events: {
        majorEvents: [
          {
            id: 'evt-major-1',
            description: 'Nhan vat chinh dieu tra su kien linh di tai truong trung hoc Hoang Cuong.',
            chapter: 2,
            severity: 'major',
          },
        ],
        minorEvents: [
          {
            id: 'evt-minor-1',
            description: 'Thu thap manh moi o hanh lang truong.',
            chapter: 2,
            severity: 'minor',
          },
        ],
      },
    };

    const extracted = extractLocationEntities(chunks);
    const linked = linkEventLocations(baseResult, chunks, extracted.locations);

    const major = linked.result.events.majorEvents[0];
    expect(major.locationLink?.locationName).toBeTruthy();
    expect(Number(major.locationLink?.confidence || 0)).toBeGreaterThan(0);

    const clustered = buildIncidentClusters(linked.result);
    expect(clustered.result.incidents.length).toBeGreaterThan(0);
    expect(clustered.result.incidents[0].eventIds).toContain('evt-major-1');

    const enriched = enrichWithIncidentIntelligence(baseResult, chunks);
    expect(enriched.stats.locations.totalLocations).toBeGreaterThan(0);
    expect(enriched.stats.incidents.incidentCount).toBeGreaterThan(0);
  });
});
