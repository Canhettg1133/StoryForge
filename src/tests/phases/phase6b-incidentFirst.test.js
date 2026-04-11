/**
 * @vitest-environment node
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { runCoherenceJob } from '../../services/analysis/jobs/coherenceJob.js';
import { runIncidentAnalysisJob } from '../../services/analysis/jobs/incidentAnalysisJob.js';
import { groundAnalysisEvents as groundEnhanced } from '../../services/analysis/grounding/enhancedGrounding.js';
import { groundAnalysisEvents as groundLegacy } from '../../services/analysis/eventGrounding.js';
import { getRunMode } from '../../services/analysis/pipeline/modes.js';
import { bootstrapPostgres } from '../../services/storage/postgres/bootstrap.js';
import { queryPostgres } from '../../services/storage/postgres/client.js';
import {
  pgCreateAnalysis,
  pgInsertCorpusGraph,
  pgReplaceIncidentFirstArtifacts,
} from '../../services/storage/postgres/write.js';

const hasDatabaseUrl = Boolean(String(process.env.DATABASE_URL || '').trim());
const postgresIt = hasDatabaseUrl ? it : it.skip;

function buildSamplePayload() {
  return {
    chapters: [
      {
        chapterIndex: 1,
        title: 'Chapter 1',
        text: 'Nhan vat gap bien co lon tai truong trung hoc Hoang Cuong.',
      },
      {
        chapterIndex: 2,
        title: 'Chapter 2',
        text: 'Cuoc dieu tra tiep tuc tai truong trung hoc Hoang Cuong va xuat hien mot manh moi.',
      },
    ],
    incidents: [
      {
        id: 'inc-1',
        title: 'Bien co tai truong',
        type: 'major_plot_point',
        startChapter: 1,
        endChapter: 2,
        confidence: 0.82,
        evidence: ['sample'],
      },
    ],
    events: [
      {
        id: 'evt-1',
        title: 'Phat hien dau moi',
        description: 'Nhan vat tim thay dau moi trong truong.',
        chapterIndex: 2,
        severity: 0.8,
        incidentId: 'inc-1',
        evidence: ['sample'],
      },
    ],
    locations: [
      {
        id: 'loc-1',
        name: 'Truong trung hoc Hoang Cuong',
        evidence: ['sample'],
        eventIds: ['evt-1'],
        incidentIds: ['inc-1'],
      },
    ],
    consistencyRisks: [],
  };
}

describe('Phase 6B - Incident-First Unit/Integration/E2E', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('unit: grounding module split keeps compatibility', () => {
    const result = {
      events: {
        majorEvents: [
          { description: 'Nhan vat dieu tra tai truong trung hoc Hoang Cuong.' },
        ],
      },
    };

    const chunks = [
      {
        id: 'chunk-1',
        chapterId: 'ch-1',
        chapterIndex: 1,
        chunkIndex: 1,
        text: 'Nhan vat dieu tra vu an tai truong trung hoc Hoang Cuong.',
      },
    ];

    const enhanced = groundEnhanced(result, chunks);
    const legacy = groundLegacy(result, chunks);

    expect(enhanced.stats.total).toBe(legacy.stats.total);
    expect(enhanced.result.events.majorEvents[0].grounding.chunkId)
      .toBe(legacy.result.events.majorEvents[0].grounding.chunkId);
  });

  it('integration: incident analysis job returns review queue in heuristic mode', async () => {
    const payload = buildSamplePayload();

    const result = await runIncidentAnalysisJob({
      corpusId: 'corpus-test-1',
      payload,
      options: {
        mode: 'balanced',
        ai: { enabled: false },
      },
    });

    expect(result.success).toBe(true);
    expect(Array.isArray(result.incidents)).toBe(true);
    expect(Array.isArray(result.events)).toBe(true);
    expect(Array.isArray(result.reviewQueue)).toBe(true);
    expect(result.aiApplied).toBe(false);
  });

  it('integration: pipeline supports fast/balanced/deep modes', async () => {
    const payload = buildSamplePayload();
    const modes = ['fast', 'balanced', 'deep'];

    for (const mode of modes) {
      const result = await runIncidentAnalysisJob({
        corpusId: `corpus-mode-${mode}`,
        payload,
        options: {
          mode,
          ai: { enabled: false },
        },
      });

      expect(result.success).toBe(true);
      expect(result.mode).toBe(getRunMode(mode).id);
    }
  });

  it('integration: coherence job produces normalized incident payload', async () => {
    const payload = buildSamplePayload();
    const coherence = await runCoherenceJob({
      incidents: payload.incidents,
      events: payload.events,
      locations: payload.locations,
      options: {
        mode: 'balanced',
        ai: { enabled: false },
      },
    });

    expect(Array.isArray(coherence.incidents)).toBe(true);
    expect(Array.isArray(coherence.events)).toBe(true);
    expect(Array.isArray(coherence.locations)).toBe(true);
    expect(coherence.aiAdvice).toBeNull();
  });

  postgresIt('e2e: api flow for incidents -> review queue -> resolve item', async () => {
    vi.resetModules();

    const { createJobServer } = await import('../../services/jobs/server.js');
    await bootstrapPostgres();

    const corpusId = 'corpus-e2e-1';
    const analysisId = 'analysis-e2e-1';
    const reviewItemId = 'rq-e2e-1';
    const now = Date.now();

    await queryPostgres('DELETE FROM project_analysis_snapshots WHERE analysis_id = $1', [analysisId]);
    await queryPostgres('DELETE FROM review_queue WHERE analysis_id = $1', [analysisId]);
    await queryPostgres('DELETE FROM consistency_risks WHERE analysis_id = $1', [analysisId]);
    await queryPostgres('DELETE FROM analysis_events WHERE analysis_id = $1', [analysisId]);
    await queryPostgres('DELETE FROM analysis_locations WHERE analysis_id = $1', [analysisId]);
    await queryPostgres('DELETE FROM incidents WHERE analysis_id = $1', [analysisId]);
    await queryPostgres('DELETE FROM chunk_results WHERE analysis_id = $1', [analysisId]);
    await queryPostgres('DELETE FROM corpus_analyses WHERE id = $1', [analysisId]);
    await queryPostgres('DELETE FROM corpuses WHERE id = $1', [corpusId]);

    await pgInsertCorpusGraph(
      {
        id: corpusId,
        title: 'Corpus E2E',
        author: 'Tester',
        sourceFile: 'demo.txt',
        fileType: 'txt',
        fandom: 'test',
        fandomConfidence: 1,
        isCanonFanfic: 'unknown',
        rating: 'T',
        language: 'vi',
        chunkSize: 750,
        chunkSizeUsed: 750,
        chunkCount: 1,
        lastRechunkedAt: now,
        wordCount: 200,
        chapterCount: 1,
        status: 'uploaded',
        createdAt: now,
        updatedAt: now,
      },
      [
        {
          id: 'ch-e2e-1',
          corpusId,
          index: 1,
          title: 'Chapter 1',
          content: 'Noi dung chuong 1',
          wordCount: 200,
          startLine: null,
          endLine: null,
          startPage: null,
          endPage: null,
        },
      ],
      [
        {
          id: 'chunk-e2e-1',
          chapterId: 'ch-e2e-1',
          corpusId,
          index: 1,
          text: 'Noi dung chunk 1',
          wordCount: 200,
          startPosition: 0,
          startWord: 'Noi',
          endWord: '1',
        },
      ],
    );

    await pgCreateAnalysis({
      id: analysisId,
      corpusId,
      status: 'completed',
      level0Status: 'completed',
      level1Status: 'completed',
      level2Status: 'completed',
      progress: 1,
      currentPhase: 'completed',
      totalChunks: 1,
      processedChunks: 1,
      provider: 'gemini_proxy',
      model: 'gemini-2.5-flash',
      temperature: 0.2,
      chunkSize: 750,
      chunkOverlap: 0,
      partsGenerated: 1,
      errorMessage: null,
      createdAt: now,
      startedAt: now,
      completedAt: now,
    });

    await pgReplaceIncidentFirstArtifacts({
      corpusId,
      analysisId,
      incidents: [
        {
          id: 'inc-e2e-1',
          title: 'Incident E2E',
          type: 'subplot',
          description: 'Incident demo',
          chapterStartIndex: 1,
          chapterEndIndex: 1,
          confidence: 0.78,
          evidence: ['sample'],
          containedEvents: ['evt-e2e-1'],
          relatedLocations: ['loc-e2e-1'],
          reviewStatus: 'needs_review',
        },
      ],
      events: [
        {
          id: 'evt-e2e-1',
          title: 'Event E2E',
          description: 'Event demo',
          severity: 0.7,
          chapterIndex: 1,
          incidentId: 'inc-e2e-1',
          confidence: 0.7,
          evidence: ['sample'],
          reviewStatus: 'needs_review',
          needsReview: true,
        },
      ],
      locations: [
        {
          id: 'loc-e2e-1',
          name: 'Location E2E',
          incidentIds: ['inc-e2e-1'],
          eventIds: ['evt-e2e-1'],
          confidence: 0.7,
          evidence: ['sample'],
          reviewStatus: 'needs_review',
        },
      ],
      consistencyRisks: [],
      reviewQueue: [
        {
          id: reviewItemId,
          itemType: 'incident',
          itemId: 'inc-e2e-1',
          priority: 'P1',
          priorityScore: 0.61,
          scoreBreakdown: {
            impact: 0.2,
            confidenceDeficit: 0.2,
            consistencyRisk: 0,
            boundaryAmbiguity: 0.1,
            missingEvidence: 0.11,
          },
          reason: ['Needs review'],
          suggestions: ['Edit boundary'],
          status: 'pending',
        },
      ],
    });

    const port = 39000 + Math.floor(Math.random() * 1000);
    const server = createJobServer({ port });
    await server.start();

    try {
      const incidentsRes = await fetch(`http://127.0.0.1:${port}/api/corpus/${corpusId}/incidents?analysisId=${analysisId}`);
      expect(incidentsRes.ok).toBe(true);
      const incidentsPayload = await incidentsRes.json();
      expect(incidentsPayload.total).toBe(1);

      const queueRes = await fetch(`http://127.0.0.1:${port}/api/corpus/${corpusId}/review-queue?analysisId=${analysisId}`);
      expect(queueRes.ok).toBe(true);
      const queuePayload = await queueRes.json();
      expect(queuePayload.items.length).toBeGreaterThan(0);

      const patchRes = await fetch(`http://127.0.0.1:${port}/api/corpus/${corpusId}/review-queue/${reviewItemId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'resolved',
          resolution: 'Accepted as-is',
        }),
      });
      expect(patchRes.ok).toBe(true);
      const patchPayload = await patchRes.json();
      expect(patchPayload.item.status).toBe('resolved');
      expect(String(patchPayload.item.resolution || '')).toContain('Accepted');
    } finally {
      await server.stop();
      await queryPostgres('DELETE FROM review_queue WHERE analysis_id = $1', [analysisId]);
      await queryPostgres('DELETE FROM consistency_risks WHERE analysis_id = $1', [analysisId]);
      await queryPostgres('DELETE FROM analysis_events WHERE analysis_id = $1', [analysisId]);
      await queryPostgres('DELETE FROM analysis_locations WHERE analysis_id = $1', [analysisId]);
      await queryPostgres('DELETE FROM incidents WHERE analysis_id = $1', [analysisId]);
      await queryPostgres('DELETE FROM chunk_results WHERE analysis_id = $1', [analysisId]);
      await queryPostgres('DELETE FROM corpus_analyses WHERE id = $1', [analysisId]);
      await queryPostgres('DELETE FROM corpuses WHERE id = $1', [corpusId]);
    }
  });
});
