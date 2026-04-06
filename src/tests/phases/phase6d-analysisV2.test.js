/**
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest';
import { persistIncidentFirstArtifacts } from '../../services/analysis/incidentFirstPersistence.js';
import { runIncidentOnly1MJob } from '../../services/analysis/jobs/incidentOnly1MJob.js';
import { buildReviewQueue } from '../../services/analysis/pipeline/reviewQueueBuilder.js';
import {
  normalizePublicRunMode,
  validatePassAOutput,
  validatePassBOutput,
  validatePassCOutput,
} from '../../services/analysis/v2/contracts.js';
import { buildStoryGraph } from '../../services/analysis/v2/storyGraph.js';
import { bootstrapPostgres } from '../../services/storage/postgres/bootstrap.js';
import { queryPostgres } from '../../services/storage/postgres/client.js';
import {
  pgCreateAnalysis,
  pgInsertCorpusGraph,
} from '../../services/storage/postgres/write.js';

const hasDatabaseUrl = Boolean(String(process.env.DATABASE_URL || '').trim());
const postgresIt = hasDatabaseUrl ? it : it.skip;

describe('Phase 6D - Analysis V2', () => {
  it('normalizes public run mode aliases', () => {
    expect(normalizePublicRunMode('fast')).toBe('fast_preview');
    expect(normalizePublicRunMode('incident_only_1m')).toBe('full_corpus_1m');
    expect(normalizePublicRunMode('legacy')).toBe('legacy');
  });

  it('validates Pass A/B/C contracts with 1-based chapters', () => {
    const passA = validatePassAOutput({
      incidents: [
        {
          id: 'inc-1',
          title: 'Mo dau nha tro',
          type: 'major_plot_point',
          chapterStart: 1,
          chapterEnd: 2,
          confidence: 0.91,
          evidence: ['sample'],
        },
      ],
    }, 12);
    expect(passA.valid).toBe(true);
    expect(passA.value.incidents[0].chapterStart).toBe(1);

    const passB = validatePassBOutput({
      incident: {
        description: 'Incident sample',
      },
      events: [
        {
          id: 'evt-1',
          description: 'Nhan vat bi dich chuyen vao nha tro',
          chapter: 1,
          severity: 'major',
        },
      ],
      locations: [
        {
          name: 'Nha tro so 18',
        },
      ],
    }, 12);
    expect(passB.valid).toBe(true);
    expect(passB.value.events[0].chapter).toBe(1);
    expect(passB.value.locations[0].id).toBe('loc_v2_nha_tro_so_18');

    const passC = validatePassCOutput({
      world_profile: {
        world_name: 'The gioi thu nghiem',
      },
      characters: [{ name: 'Lam Tham' }],
      locations: [{ name: 'Nha tro so 18' }],
      objects: [{ name: 'Chia khoa' }],
      terms: [{ name: 'Khong gian di biet' }],
    });
    expect(passC.valid).toBe(true);
    expect(passC.value.world_profile.world_name).toContain('The gioi');
  });

  it('incident_only_1m returns V2 artifact with manifest, degraded report and story graph when AI is unavailable', async () => {
    const result = await runIncidentOnly1MJob({
      corpusId: 'corpus-v2-test',
      chunks: [
        {
          id: 'chunk-1',
          chapterId: 'chapter-1',
          chapterIndex: 0,
          chunkIndex: 0,
          text: 'Lam Tham bi keo vao Nha tro so 18 trong mot dem suong mu.',
        },
      ],
      options: {
        runMode: 'full_corpus_1m',
        provider: 'gemini_proxy',
        model: '',
      },
    });

    expect(result.success).toBe(true);
    expect(result.finalResult.artifact_version).toBe('v2');
    expect(result.finalResult.analysis_run_manifest.runMode).toBe('full_corpus_1m');
    expect(Array.isArray(result.finalResult.story_graph.nodes)).toBe(true);
    expect(Array.isArray(result.finalResult.reviewQueue)).toBe(true);
    expect(result.finalResult.degraded_run_report.hasDegradedPasses).toBe(true);
  });

  it('builds richer story graph relations and review signals', () => {
    const graph = buildStoryGraph({
      incidents: [
        {
          id: 'inc-1',
          title: 'Mo dau',
          chapterStart: 1,
          relatedLocations: ['Nha tro so 18'],
          confidence: 0.82,
        },
      ],
      events: [
        {
          id: 'evt-1',
          description: 'Lam Tham dung chia khoa van nang mo phong 0104.',
          chapter: 1,
          incidentId: 'inc-1',
          characters: ['Lam Tham', 'Dao Dao'],
          locationLink: { locationName: 'Nha tro so 18', confidence: 0.8 },
          confidence: 0.8,
        },
        {
          id: 'evt-2',
          description: 'Lam Tham va Dao Dao lao vao truong hoc bo hoang.',
          chapter: 1,
          incidentId: 'inc-1',
          characters: ['Lam Tham', 'Dao Dao'],
          confidence: 0.77,
        },
      ],
      knowledge: {
        characters: [{ name: 'Lam Tham' }, { name: 'Dao Dao' }],
        locations: [{ name: 'Nha tro so 18' }],
        objects: [{ name: 'Chia khoa van nang' }],
      },
    });

    expect(graph.edges.some((edge) => edge.type === 'incident_occurs_at_location')).toBe(true);
    expect(graph.edges.some((edge) => edge.type === 'object_used_in_event')).toBe(true);
    expect(graph.edges.some((edge) => edge.type === 'character_related_to_character')).toBe(true);
    expect(graph.summary.edgeTypes.character_related_to_character).toBeGreaterThan(0);

    const queue = buildReviewQueue(
      [{ id: 'inc-2', title: 'Co lap', confidence: 0.1, evidence: [] }],
      [],
      [],
      [],
      {
        corpusId: 'corpus-1',
        analysisId: 'analysis-1',
        graph: {
          nodes: [{ id: 'inc-2', type: 'incident', label: 'Co lap' }],
          edges: [],
        },
      },
    );

    expect(queue[0].reason.some((item) => item.includes('co lap trong story graph'))).toBe(true);
  });

  postgresIt('persistIncidentFirstArtifacts materializes existing artifact without rerunning pipeline', async () => {
    await bootstrapPostgres();
    await queryPostgres('DELETE FROM review_queue WHERE analysis_id = $1', ['analysis-1']);
    await queryPostgres('DELETE FROM consistency_risks WHERE analysis_id = $1', ['analysis-1']);
    await queryPostgres('DELETE FROM analysis_events WHERE analysis_id = $1', ['analysis-1']);
    await queryPostgres('DELETE FROM analysis_locations WHERE analysis_id = $1', ['analysis-1']);
    await queryPostgres('DELETE FROM incidents WHERE analysis_id = $1', ['analysis-1']);
    await queryPostgres('DELETE FROM chunk_results WHERE analysis_id = $1', ['analysis-1']);
    await queryPostgres('DELETE FROM corpus_analyses WHERE id = $1', ['analysis-1']);
    await queryPostgres('DELETE FROM corpuses WHERE id = $1', ['corpus-1']);

    await pgInsertCorpusGraph(
      {
        id: 'corpus-1',
        title: 'Corpus 1',
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
        lastRechunkedAt: Date.now(),
        wordCount: 120,
        chapterCount: 1,
        status: 'uploaded',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
      [
        {
          id: 'chapter-1',
          corpusId: 'corpus-1',
          index: 1,
          title: 'Chapter 1',
          content: 'Noi dung chapter 1',
          wordCount: 120,
          startLine: null,
          endLine: null,
          startPage: null,
          endPage: null,
        },
      ],
      [
        {
          id: 'chunk-1',
          chapterId: 'chapter-1',
          corpusId: 'corpus-1',
          index: 1,
          text: 'Noi dung chunk 1',
          wordCount: 120,
          startPosition: 0,
          startWord: 'Noi',
          endWord: '1',
        },
      ],
    );
    await pgCreateAnalysis({
      id: 'analysis-1',
      corpusId: 'corpus-1',
      status: 'completed',
      level0Status: 'completed',
      level1Status: 'completed',
      level2Status: 'completed',
      progress: 1,
      currentPhase: 'completed',
      totalChunks: 1,
      processedChunks: 1,
      provider: 'gemini_proxy',
      model: 'demo',
      temperature: 0.2,
      chunkSize: 750,
      chunkOverlap: 0,
    });

    const persisted = await persistIncidentFirstArtifacts({
      corpusId: 'corpus-1',
      analysisId: 'analysis-1',
      result: {
        incidents: [
          {
            id: 'inc-1',
            title: 'Incident A',
            chapterStart: 1,
            chapterEnd: 1,
            confidence: 0.8,
            eventIds: ['evt-1'],
          },
        ],
        events: {
          majorEvents: [
            {
              id: 'evt-1',
              description: 'Bien co lon xay ra',
              chapter: 1,
              confidence: 0.81,
            },
          ],
        },
        locations: [
          {
            id: 'loc-1',
            name: 'Nha tro so 18',
            chapterStart: 1,
            chapterEnd: 1,
          },
        ],
        reviewQueue: [
          {
            id: 'rq-1',
            itemType: 'incident',
            itemId: 'inc-1',
            priority: 'P1',
            priorityScore: 0.5,
          },
        ],
      },
    });

    expect(persisted.persisted).toBe(true);
    expect(persisted.sourceOfTruth).toBe('analysis_run_artifact');
    expect(persisted.counts.incidents).toBe(1);
    expect(persisted.counts.reviewQueue).toBe(1);

    await queryPostgres('DELETE FROM review_queue WHERE analysis_id = $1', ['analysis-1']);
    await queryPostgres('DELETE FROM consistency_risks WHERE analysis_id = $1', ['analysis-1']);
    await queryPostgres('DELETE FROM analysis_events WHERE analysis_id = $1', ['analysis-1']);
    await queryPostgres('DELETE FROM analysis_locations WHERE analysis_id = $1', ['analysis-1']);
    await queryPostgres('DELETE FROM incidents WHERE analysis_id = $1', ['analysis-1']);
    await queryPostgres('DELETE FROM chunk_results WHERE analysis_id = $1', ['analysis-1']);
    await queryPostgres('DELETE FROM corpus_analyses WHERE id = $1', ['analysis-1']);
    await queryPostgres('DELETE FROM corpuses WHERE id = $1', ['corpus-1']);
  });
});
