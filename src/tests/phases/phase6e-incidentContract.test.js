/**
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest';
import { normalizeIncident } from '../../services/analysis/models/incident.js';
import { parseAnalysisResults } from '../../services/viewer/analysisParser.js';

describe('Phase 6E - Incident Contract', () => {
  it('normalizes parser-shaped incident payloads into the canonical contract', () => {
    const normalized = normalizeIncident({
      id: 'inc-parser-1',
      title: 'Nguoi thu nam',
      type: 'major_plot_point',
      chapterStart: 2,
      chapterEnd: 4,
      eventIds: ['evt-1', 'evt-2'],
      evidenceSnippet: 'Lam Tham nhan ra minh la nguoi thu nam.',
      preconditions: ['Bi keo vao nha tro'],
      turning_points: ['Nhan ra quy tac'],
      consequences: ['Mat long tin'],
      anchorEventId: 'evt-2',
      location: { id: 'loc-1', name: 'Nha tro so 18', confidence: 0.8, isMajor: true },
    });

    expect(normalized.chapterStart).toBe(2);
    expect(normalized.chapterEnd).toBe(4);
    expect(normalized.containedEvents).toEqual(['evt-1', 'evt-2']);
    expect(normalized.eventIds).toEqual(['evt-1', 'evt-2']);
    expect(normalized.evidence).toEqual(['Lam Tham nhan ra minh la nguoi thu nam.']);
    expect(normalized.turningPoints).toEqual(['Nhan ra quy tac']);
    expect(normalized.relatedLocations).toEqual(['loc-1']);
    expect(normalized.location?.name).toBe('Nha tro so 18');
  });

  it('normalizes DB-shaped incident payloads into the canonical contract', () => {
    const normalized = normalizeIncident({
      id: 'inc-db-1',
      title: 'Bien co tai truong',
      type: 'subplot',
      chapterStartIndex: 3,
      chapterEndIndex: 5,
      chapterStartNumber: 3,
      chapterEndNumber: 5,
      containedEvents: ['evt-3'],
      evidence: ['sample'],
      relatedLocations: ['loc-db-1'],
      reviewStatus: 'auto_accepted',
      priority: 'P1',
      provenance: { sourcePass: 'materialized_result' },
    });

    expect(normalized.chapterStart).toBe(3);
    expect(normalized.chapterEnd).toBe(5);
    expect(normalized.chapterRange).toEqual([3, 5]);
    expect(normalized.containedEvents).toEqual(['evt-3']);
    expect(normalized.relatedLocations).toEqual(['loc-db-1']);
    expect(normalized.reviewStatus).toBe('auto_accepted');
    expect(normalized.priority).toBe('P1');
  });

  it('normalizes artifact-shaped incident payloads into the canonical contract', () => {
    const normalized = normalizeIncident({
      id: 'inc-artifact-1',
      title: 'Incident A',
      chapterStart: 1,
      chapterEnd: 1,
      confidence: 0.8,
      detailedSummary: 'Incident chi tiet',
      primaryEvidenceRefs: ['Bang chung 1'],
      consequences: ['He qua 1'],
    });

    expect(normalized.description).toBe('Incident chi tiet');
    expect(normalized.detailedSummary).toBe('Incident chi tiet');
    expect(normalized.evidenceRefs).toEqual(['Bang chung 1']);
    expect(normalized.consequences).toEqual(['He qua 1']);
  });

  it('normalizes fallback incident payloads into the canonical contract', () => {
    const normalized = normalizeIncident({
      id: 'inc-fallback-1',
      title: 'Su kien mo dau',
      type: 'major',
      chapterStart: 1,
      chapterEnd: 1,
      confidence: 0.92,
      eventIds: ['evt-open'],
      location: { id: 'loc-open', name: 'Khong ro dia diem', isMajor: true },
      tags: ['opening', 'mystery'],
      provenance: { source: 'fallback' },
    });

    expect(normalized.type).toBe('major_plot_point');
    expect(normalized.containedEvents).toEqual(['evt-open']);
    expect(normalized.location?.id).toBe('loc-open');
    expect(normalized.tags).toEqual(['opening', 'mystery']);
    expect(normalized.provenance).toEqual({ source: 'fallback' });
  });

  it('parses raw analysis incidents through the shared incident contract', () => {
    const parsed = parseAnalysisResults({
      incidents: [
        {
          id: 'inc-parse-1',
          title: 'Nguoi thu nam',
          chapterStart: 2,
          chapterEnd: 3,
          eventIds: ['evt-1'],
          evidenceSnippet: 'Bang chung parser',
          detailedSummary: 'Mo ta incident',
        },
      ],
    });

    expect(parsed.incidents).toHaveLength(1);
    expect(parsed.incidents[0].chapterStart).toBe(2);
    expect(parsed.incidents[0].chapterEnd).toBe(3);
    expect(parsed.incidents[0].containedEvents).toEqual(['evt-1']);
    expect(parsed.incidents[0].description).toBe('Mo ta incident');
    expect(parsed.incidents[0].evidence).toEqual(['Bang chung parser']);
  });
});
