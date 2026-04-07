/**
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest';
import { persistIncidentFirstArtifacts } from '../../services/analysis/incidentFirstPersistence.js';
import {
  applyCoverageRecall,
  buildCoverageAudit,
  buildCraftProfile,
  buildKnowledgeFallback,
  buildRelationshipLayer,
  mergeEntityMentions,
  runIncidentOnly1MJob,
} from '../../services/analysis/jobs/incidentOnly1MJob.js';
import { buildReviewQueue } from '../../services/analysis/pipeline/reviewQueueBuilder.js';
import { buildAnalysisArtifactV3 } from '../../services/analysis/v3/artifactBuilder.js';
import { buildSlimArtifactEnvelope, buildSlimFinalResult } from '../../services/analysis/v3/payloadModes.js';
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
  pgGetAnalysisArtifactByAnalysis,
  pgGetStoryGraphByAnalysis,
  pgListAnalysisBeatsByAnalysis,
  pgListAnalysisWindowsByAnalysis,
} from '../../services/storage/postgres/read.js';
import {
  pgCreateAnalysis,
  pgInsertCorpusGraph,
  pgPersistStoryGraph,
} from '../../services/storage/postgres/write.js';

const hasDatabaseUrl = Boolean(String(process.env.DATABASE_URL || '').trim());
const postgresIt = hasDatabaseUrl ? it : it.skip;

describe('Phase 6D - Analysis V3 Compat', () => {
  it('normalizes public run mode aliases', () => {
    expect(normalizePublicRunMode('fast')).toBe('fast_preview');
    expect(normalizePublicRunMode('incident_only_1m')).toBe('full_corpus_1m');
    expect(normalizePublicRunMode('legacy')).toBe('legacy');
  });

  it('validates Pass A/B/C contracts with 1-based chapters', () => {
    const passA = validatePassAOutput({
      world_seed: {
        world_name: 'The gioi thu nghiem',
        world_rules: ['Khong ai duoc roi khoi nha tro'],
      },
      style_seed: {
        pov: 'third_limited',
        tone: ['u am'],
      },
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
    expect(passA.value.world_seed.world_name).toContain('The gioi');
    expect(passA.value.style_seed.pov).toBe('third_limited');

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
      mentions: {
        characters: [{ name: 'Lam Tham', roleHint: 'protagonist', eventIds: ['evt-1'] }],
        objects: [{ name: 'Chia khoa', ownerHint: 'Lam Tham', eventIds: ['evt-1'] }],
        terms: [{ name: 'Quy tac nha tro', category: 'concept', eventIds: ['evt-1'] }],
        relationships: [{ source: 'Lam Tham', target: 'Dao Dao', type: 'allies', eventIds: ['evt-1'] }],
      },
      style_evidence: {
        observations: [
          {
            chapter: 1,
            eventId: 'evt-1',
            signalType: 'tone',
            observation: 'Khong khi u am va bi an',
            evidence: 'sample',
          },
        ],
      },
    }, 12);
    expect(passB.valid).toBe(true);
    expect(passB.value.events[0].chapter).toBe(1);
    expect(passB.value.locations[0].id).toBe('loc_v2_nha_tro_so_18');
    expect(passB.value.mentions.characters[0].name).toBe('Lam Tham');
    expect(passB.value.style_evidence.observations[0].signalType).toBe('tone');

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

  it('builds craft and coverage data from seeds and local evidence without extra AI passes', () => {
    const mentions = mergeEntityMentions(
      {
        characters: [{ name: 'Lam Tham', roleHint: 'protagonist', eventIds: ['evt-1'], chapters: [1], evidence: ['xuat hien'] }],
        objects: [{ name: 'Chia khoa van nang', ownerHint: 'Lam Tham', eventIds: ['evt-1'], chapters: [1], evidence: ['su dung chia khoa'] }],
        terms: [{ name: 'Quy tac nha tro', category: 'concept', eventIds: ['evt-1'], chapters: [1], evidence: ['doc quy tac'] }],
        relationships: [{ source: 'Lam Tham', target: 'Dao Dao', type: 'allies', eventIds: ['evt-2'], chapters: [2], evidence: ['ho tro nhau'] }],
      },
      {
        characters: [{ name: 'Dao Dao', roleHint: 'supporting', eventIds: ['evt-2'], chapters: [2], evidence: ['xuat hien'] }],
        objects: [{ name: 'Chia khoa van nang', ownerHint: 'Lam Tham', eventIds: ['evt-3'], chapters: [3], evidence: ['tiep tuc duoc dung'] }],
        terms: [],
        relationships: [],
      },
    );

    const fallbackKnowledge = buildKnowledgeFallback({
      worldSeed: {
        world_name: 'Lau tro so 18',
        world_type: 'horror',
        world_rules: ['Phai tuan thu quy tac'],
        primary_locations: ['Nha tro so 18'],
      },
      mentions,
      locations: [{ name: 'Nha tro so 18', description: 'Khong gian chinh', timeline: [] }],
      events: [
        { id: 'evt-1', chapter: 1, description: 'Lam Tham doc quy tac', characters: ['Lam Tham'], emotionalIntensity: 6 },
        { id: 'evt-2', chapter: 2, description: 'Lam Tham hop tac voi Dao Dao', characters: ['Lam Tham', 'Dao Dao'], emotionalIntensity: 8 },
      ],
    });

    const relationships = buildRelationshipLayer(mentions.relationships);
    const craft = buildCraftProfile({
      styleSeed: {
        pov: 'third_limited',
        tone: ['u am', 'cang thang'],
        dialogue_density: 'medium',
        action_density: 'high',
      },
      styleEvidence: {
        observations: [
          { chapter: 1, signalType: 'tone', observation: 'Khong khi u am', evidence: 'sample' },
          { chapter: 2, signalType: 'dialogue_density', observation: 'Doi thoai tang dan', evidence: 'sample' },
        ],
      },
      events: [
        { id: 'evt-1', chapter: 1, description: 'A', emotionalIntensity: 6 },
        { id: 'evt-2', chapter: 2, description: 'B', emotionalIntensity: 8 },
      ],
    });

    const audit = buildCoverageAudit({
      knowledge: fallbackKnowledge,
      mentions,
      locations: [{ name: 'Nha tro so 18', evidence: ['sample'], timeline: [] }],
      events: [
        { id: 'evt-1', chapter: 1, description: 'A', characters: ['Lam Tham'] },
        { id: 'evt-2', chapter: 2, description: 'B', characters: ['Lam Tham', 'Dao Dao'] },
      ],
      relationships,
    });

    expect(craft.style.pov).toBe('third_limited');
    expect(craft.style.styleSignals.length).toBeGreaterThan(0);
    expect(fallbackKnowledge.world_profile.world_name).toBe('Lau tro so 18');
    expect(relationships[0].type).toBe('allies');
    expect(audit.returnedCount.objects).toBe(1);
    expect(audit.complete).toBe(true);
  });

  it('does not smear first mention evidence across many timeline entries in fallback knowledge', () => {
    const fallbackKnowledge = buildKnowledgeFallback({
      worldSeed: {
        world_name: 'Lau tro so 18',
        primary_locations: ['Nha tro so 18'],
      },
      mentions: {
        characters: [
          {
            name: 'Lam Tham',
            roleHint: 'protagonist',
            eventIds: ['evt-1', 'evt-2'],
            chapters: [1],
            evidence: ['Ta goi Lam Tham.'],
          },
        ],
        objects: [
          {
            name: 'Den pin',
            ownerHint: 'Lam Tham',
            eventIds: ['evt-1', 'evt-2'],
            chapters: [1],
            evidence: ['Moi thay den pin.'],
          },
        ],
        terms: [],
        relationships: [],
      },
      locations: [],
      events: [
        { id: 'evt-1', chapter: 1, description: 'Lam Tham xuat hien', characters: ['Lam Tham'] },
        { id: 'evt-2', chapter: 2, description: 'Lam Tham mo cua phong', characters: ['Lam Tham'] },
      ],
    });

    expect(fallbackKnowledge.characters[0].timeline[0]).toEqual({
      eventId: 'evt-1',
      chapter: 1,
      summary: 'Ta goi Lam Tham.',
    });
    expect(fallbackKnowledge.characters[0].timeline[1]).toEqual({
      eventId: 'evt-2',
      chapter: 2,
      summary: 'Lam Tham mo cua phong',
    });
    expect(fallbackKnowledge.characters[0].timeline.filter((item) => item.summary === 'Ta goi Lam Tham.')).toHaveLength(1);
    expect(fallbackKnowledge.objects[0].timeline).toEqual([
      { eventId: 'evt-1', chapter: 1, summary: 'Moi thay den pin.' },
      { eventId: 'evt-2', chapter: 2, summary: 'Lam Tham mo cua phong' },
    ]);
  });

  it('marks coverage incomplete and recalls omitted candidates into canonical knowledge', () => {
    const knowledge = {
      world_profile: { world_name: 'Demo' },
      characters: [{ name: 'Lam Tham' }],
      locations: [],
      objects: [],
      terms: [],
    };
    const mentions = {
      characters: [{ name: 'Lam Tham', eventIds: ['evt-1'], chapters: [1], evidence: ['sample'] }],
      objects: [{ name: 'Chia khoa', ownerHint: 'Lam Tham', eventIds: ['evt-1'], chapters: [1], evidence: ['sample'] }],
      terms: [{ name: 'Quy tac nha tro', category: 'concept', eventIds: ['evt-1'], chapters: [1], evidence: ['sample'] }],
      relationships: [{ source: 'Lam Tham', target: 'Dao Dao', type: 'allies', eventIds: ['evt-2'], chapters: [2], evidence: ['sample'] }],
    };

    const audit = buildCoverageAudit({
      knowledge,
      mentions,
      locations: [],
      events: [{ id: 'evt-1', chapter: 1, description: 'A', characters: ['Lam Tham'] }],
      relationships: [],
    });

    expect(audit.complete).toBe(false);
    expect(audit.omittedCandidates.objects[0].name).toBe('Chia khoa');

    const recalled = applyCoverageRecall({
      knowledge,
      coverageAudit: audit,
      relationships: [],
    });

    expect(recalled.recallApplied).toBe(true);
    expect(recalled.knowledge.objects[0].name).toBe('Chia khoa');
    expect(recalled.knowledge.terms[0].name).toBe('Quy tac nha tro');
    expect(recalled.relationships[0].type).toBe('allies');
  });

  it('clamps coverage ratios to 1 when canonicalized counts exceed observed counts', () => {
    const audit = buildCoverageAudit({
      knowledge: {
        world_profile: { world_name: 'Demo' },
        characters: [{ name: 'Lam Tham' }],
        locations: [],
        objects: [{ name: 'Chia khoa' }, { name: 'Den pin' }],
        terms: [],
      },
      mentions: {
        characters: [{ name: 'Lam Tham', eventIds: ['evt-1'], chapters: [1], evidence: ['sample'] }],
        objects: [{ name: 'Chia khoa', ownerHint: 'Lam Tham', eventIds: ['evt-1'], chapters: [1], evidence: ['sample'] }],
        terms: [],
        relationships: [],
      },
      locations: [],
      events: [{ id: 'evt-1', chapter: 1, description: 'A', characters: ['Lam Tham'] }],
      relationships: [],
    });

    expect(audit.returnedCount.objects).toBe(2);
    expect(audit.observedCount.objects).toBe(1);
    expect(audit.coverage.objects).toBe(1);
    expect(audit.rawCoverage.objects).toBe(2);
    expect(audit.overReturned.objects).toBe(true);
    expect(audit.overReturnedCount.objects).toBe(1);
    expect(audit.complete).toBe(false);
  });

  it('builds slim payloads without embedded event payloads and sanitizes canonical timelines', () => {
    const slim = buildSlimFinalResult({
      artifact_version: 'v3',
      meta: {
        runMode: 'full_corpus_1m',
      },
      incidents: [
        {
          id: 'inc-1',
          title: 'Mo dau',
          chapterStart: 1,
          chapterEnd: 6,
          confidence: 0.8,
        },
      ],
      incident_beats: [
        {
          id: 'beat:evt-1',
          sourceEventId: 'evt-1',
          incidentId: 'inc-1',
          sequence: 1,
          chapterNumber: 1,
          beatType: 'major',
          summary: 'Lam Tham bi mac ket.',
          characters: ['Lam Tham'],
          tags: ['hook'],
          sourceEvent: {
            id: 'evt-1',
            description: 'Nguon',
          },
          payload: {
            id: 'evt-1',
            description: 'Nguon',
          },
        },
        {
          id: 'beat:evt-2',
          sourceEventId: 'evt-2',
          incidentId: 'inc-1',
          sequence: 2,
          chapterNumber: 3,
          beatType: 'major',
          summary: 'Lam Tham doc quy tac.',
        },
      ],
      canonical_entities: {
        characters: [
          {
            id: 'character:lam tham',
            entityKind: 'character',
            name: 'Lam Tham',
            role: 'protagonist',
            appearance: 'Nam sinh tre.',
            personality: 'Than trong va binh tinh.',
            personality_tags: ['than trong', 'ly tri'],
            flaws: 'Hoi da nghi.',
            goals: 'Song sot.',
            secrets: 'Dang giau mot ky uc.',
            timeline: [
              { eventId: 'evt-1', chapter: 1, summary: 'xuat hien' },
              { eventId: 'evt-gap', chapter: 0, summary: '' },
              { eventId: 'evt-gap-2', chapter: null, summary: 'khong hop le' },
            ],
            payload: {
              role: 'protagonist',
            },
          },
        ],
        locations: [],
        objects: [],
        terms: [],
        worldProfile: {
          world_name: 'Demo',
        },
      },
      craft: {
        style: {
          pov: 'third_limited',
        },
      },
      coverage_audit: {
        observedCount: { characters: 1, locations: 1, objects: 1, terms: 0, relationships: 0 },
        returnedCount: { characters: 1, locations: 2, objects: 2, terms: 0, relationships: 0 },
        coverage: { characters: 1, locations: 1, objects: 1, terms: 1, relationships: 1 },
        complete: true,
      },
      story_graph: {
        nodes: [
          {
            id: 'evt-1',
            type: 'event',
            label: 'Lam Tham bi mac ket',
            incidentId: 'inc-1',
            chapterNumber: 1,
            payload: { large: true },
          },
        ],
        edges: [
          {
            id: 'edge-1',
            type: 'incident_contains_event',
            from: 'inc-1',
            to: 'evt-1',
            label: 'contains',
            graphKind: 'incident',
            payload: { large: true },
          },
        ],
        summary: {
          nodeCount: 1,
        },
      },
    });

    expect(slim.incident_beats[0].sourceEvent).toBeUndefined();
    expect(slim.incident_beats[0].payload).toBeUndefined();
    expect(Object.keys(slim.incident_beats[0])).toEqual([
      'id',
      'incidentId',
      'sequence',
      'chapterNumber',
      'beatType',
      'summary',
      'causalLinks',
      'evidenceRefs',
      'confidence',
      'sourceEventId',
      'characters',
      'objects',
      'terms',
      'tags',
      'locationName',
      'locationId',
    ]);
    expect(slim.canonical_entities.characters[0].payload).toBeUndefined();
    expect(slim.canonical_entities.characters[0].timeline).toEqual([
      { eventId: 'evt-1', chapter: 1, summary: 'xuat hien' },
    ]);
    expect(slim.canonical_entities.characters[0].role).toBe('protagonist');
    expect(slim.canonical_entities.characters[0].appearance).toBe('Nam sinh tre.');
    expect(slim.canonical_entities.characters[0].personality).toBe('Than trong va binh tinh.');
    expect(slim.canonical_entities.characters[0].personalityTags).toEqual(['than trong', 'ly tri']);
    expect(slim.canonical_entities.characters[0].flaws).toBe('Hoi da nghi.');
    expect(slim.canonical_entities.characters[0].goals).toBe('Song sot.');
    expect(slim.canonical_entities.characters[0].secrets).toBe('Dang giau mot ky uc.');
    expect(slim.story_graph.nodes[0]).toEqual({
      id: 'evt-1',
      type: 'event',
      label: 'Lam Tham bi mac ket',
      incidentId: 'inc-1',
      chapterNumber: 1,
      graphKind: '',
    });
    expect(slim.story_graph.edges[0]).toEqual({
      id: 'edge-1',
      type: 'incident_contains_event',
      from: 'inc-1',
      to: 'evt-1',
      label: 'contains',
      incidentId: null,
      graphKind: 'incident',
    });
    expect(slim.meta.beatChapterCoverage.presentChapters).toEqual([1, 3]);
    expect(slim.meta.beatChapterCoverage.missingChapters).toEqual([2, 4, 5, 6]);
    expect(slim.meta.beatChapterCoverage.hasGap).toBe(true);
    expect(slim.meta.beatChapterCoverage.diagnosticCode).toBe('chapterCoverageGap');
    expect(slim.coverage_audit.overReturned.locations).toBe(true);
    expect(slim.coverage_audit.overReturnedCount.objects).toBe(1);
    expect(slim.coverage_audit.complete).toBe(false);
  });

  it('promotes rich character profile fields into canonical entities', () => {
    const artifact = buildAnalysisArtifactV3({
      corpusId: 'corpus-1',
      analysisId: 'analysis-1',
      chunks: [],
      finalResult: {
        incidents: [
          { id: 'inc-1', title: 'Mo dau', chapterStart: 1, chapterEnd: 1, confidence: 0.8 },
        ],
        incident_beats: [
          {
            id: 'beat:evt-1',
            sourceEventId: 'evt-1',
            incidentId: 'inc-1',
            sequence: 1,
            chapterNumber: 1,
            beatType: 'major',
            summary: 'Lam Tham xuat hien.',
            characters: ['Lam Tham'],
          },
        ],
        characters: {
          profiles: [
            {
              id: 'character:lam-tham',
              name: 'Lam Tham',
              role: 'protagonist',
              appearance: 'Nam thanh nien gay, mat met moi.',
              personality: 'Can trong, quan sat gioi.',
              personality_tags: ['can trong', 'ly tri'],
              flaws: 'Da nghi qua muc.',
              goals: 'Thoat khoi khong gian bi an.',
              secrets: 'Giau noi so ve cong viec truoc day.',
              timeline: [
                { eventId: 'evt-1', chapter: 1, summary: 'Lam Tham xuat hien.' },
              ],
            },
          ],
        },
      },
    });

    expect(artifact.canonical_entities.characters).toHaveLength(1);
    expect(artifact.canonical_entities.characters[0]).toMatchObject({
      id: 'character:lam-tham',
      name: 'Lam Tham',
      role: 'protagonist',
      appearance: 'Nam thanh nien gay, mat met moi.',
      personality: 'Can trong, quan sat gioi.',
      personalityTags: ['can trong', 'ly tri'],
      flaws: 'Da nghi qua muc.',
      goals: 'Thoat khoi khong gian bi an.',
      secrets: 'Giau noi so ve cong viec truoc day.',
    });
  });

  it('builds slim artifact envelopes without debug-only branches', () => {
    const artifact = buildSlimArtifactEnvelope({
      artifact_version: 'v3',
      meta: {
        runMode: 'full_corpus_1m',
      },
      incidents: [
        { id: 'inc-1', title: 'Mo dau', chapterStart: 1, chapterEnd: 2 },
      ],
      incident_beats: [
        {
          id: 'beat:evt-1',
          sourceEventId: 'evt-1',
          incidentId: 'inc-1',
          sequence: 1,
          chapterNumber: 1,
          beatType: 'major',
          summary: 'Beat demo',
          payload: { noisy: true },
        },
      ],
      canonical_entities: {
        characters: [{ id: 'character:lam tham', name: 'Lam Tham', payload: { noisy: true }, timeline: [] }],
        locations: [],
        objects: [],
        terms: [],
        worldProfile: {},
      },
      craft: { style: { pov: 'third_limited' } },
      coverage_audit: {
        observedCount: { characters: 1, locations: 0, objects: 0, terms: 0, relationships: 0 },
        returnedCount: { characters: 1, locations: 0, objects: 0, terms: 0, relationships: 0 },
        coverage: { characters: 1, locations: 1, objects: 1, terms: 1, relationships: 1 },
      },
      story_graph: {
        nodes: [{ id: 'inc-1', type: 'incident', label: 'Mo dau' }],
        edges: [],
      },
      graph_summary: { nodeCount: 1 },
      analysis_windows: [{ id: 'window-1' }],
      review_queue: [{ id: 'rq-1' }],
      graph_projections: { incident: { nodes: [], edges: [] } },
    });

    expect(artifact.analysis_windows).toBeUndefined();
    expect(artifact.review_queue).toBeUndefined();
    expect(artifact.graph_projections).toBeUndefined();
    expect(artifact.incident_beats[0].payload).toBeUndefined();
    expect(artifact.canonical_entities.characters[0].payload).toBeUndefined();
    expect(artifact.story_graph.nodes).toHaveLength(1);
  });

  it('incident_only_1m returns V3 artifact with windows, beats and graph projections when AI is unavailable', async () => {
    const result = await runIncidentOnly1MJob({
      corpusId: 'corpus-v2-test',
      analysisId: 'analysis-v3-test',
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
    expect(result.finalResult.artifact_version).toBe('v3');
    expect(result.finalResult.analysis_run_manifest.runMode).toBe('full_corpus_1m');
    expect(Array.isArray(result.finalResult.story_graph.nodes)).toBe(true);
    expect(Array.isArray(result.finalResult.reviewQueue)).toBe(true);
    expect(Array.isArray(result.finalResult.analysis_windows)).toBe(true);
    expect(Array.isArray(result.finalResult.incident_beats)).toBe(true);
    expect(result.finalResult.graph_projections).toBeTruthy();
    expect(result.finalResult.degraded_run_report.hasDegradedPasses).toBe(true);
  });

  it('builds canonical corpus windows and carry packets for V3 artifact', () => {
    const artifact = buildAnalysisArtifactV3({
      corpusId: 'corpus-1',
      analysisId: 'analysis-1',
      chunks: [
        { id: 'chunk-1', chapterId: 'chapter-1', chapterIndex: 0, chunkIndex: 0, text: 'Chuong 1' },
        { id: 'chunk-2', chapterId: 'chapter-2', chapterIndex: 1, chunkIndex: 0, text: 'Chuong 2' },
        { id: 'chunk-3', chapterId: 'chapter-3', chapterIndex: 2, chunkIndex: 0, text: 'Chuong 3' },
        { id: 'chunk-4', chapterId: 'chapter-4', chapterIndex: 3, chunkIndex: 0, text: 'Chuong 4' },
      ],
      finalResult: {
        meta: {
          windowSize: 3,
          windowOverlap: 1,
        },
        incidents: [
          {
            id: 'inc-1',
            title: 'Bien co nha tro',
            chapterStart: 1,
            chapterEnd: 4,
            confidence: 0.9,
            description: 'Incident dai',
          },
        ],
        events: [
          {
            id: 'evt-1',
            description: 'Beat 1',
            chapter: 1,
            incidentId: 'inc-1',
            confidence: 0.8,
          },
        ],
        pass_status: {
          pass_a: { status: 'completed' },
        },
      },
    });

    expect(artifact.canonical_corpus.chapterCount).toBe(4);
    expect(artifact.analysis_windows.length).toBeGreaterThan(0);
    expect(artifact.carry_packets.length).toBeGreaterThan(0);
    expect(artifact.incident_map.canonical_incident_map[0].lineage.supporting_window_ids.length).toBeGreaterThan(0);
  });

  it('builds V3 canonical characters from structural fallback when knowledge is missing', () => {
    const artifact = buildAnalysisArtifactV3({
      corpusId: 'corpus-structural-fallback',
      analysisId: 'analysis-structural-fallback',
      chunks: [
        { id: 'chunk-1', chapterId: 'chapter-1', chapterIndex: 0, chunkIndex: 0, text: 'Lam Tham xuat hien.' },
      ],
      finalResult: {
        artifact_version: 'v3',
        structural: {
          characters: [
            { name: 'Lam Tham' },
            { name: 'Dao Dao' },
          ],
        },
        incidents: [
          {
            id: 'inc-1',
            title: 'Mo dau',
            chapterStart: 1,
            chapterEnd: 1,
            confidence: 0.8,
          },
        ],
        events: {
          majorEvents: [
            {
              id: 'evt-1',
              description: 'Lam Tham gap Dao Dao.',
              chapter: 1,
              incidentId: 'inc-1',
              characters: ['Lam Tham', 'Dao Dao'],
            },
          ],
        },
      },
    });

    expect(artifact.canonical_entities.characters.map((item) => item.name)).toEqual([
      'Lam Tham',
      'Dao Dao',
    ]);
  });

  it('dedupes canonical entity ids before persisting V3 artifacts', () => {
    const artifact = buildAnalysisArtifactV3({
      corpusId: 'corpus-dedupe',
      analysisId: 'analysis-dedupe',
      chunks: [
        { id: 'chunk-1', chapterId: 'chapter-1', chapterIndex: 0, chunkIndex: 0, text: 'Noi dung chuong 1' },
      ],
      finalResult: {
        artifact_version: 'v3',
        incidents: [
          {
            id: 'inc-1',
            title: 'Mo dau',
            chapterStart: 1,
            chapterEnd: 1,
            confidence: 0.8,
          },
        ],
        incident_beats: [
          {
            id: 'beat:evt-1',
            sourceEventId: 'evt-1',
            incidentId: 'inc-1',
            sequence: 1,
            chapterNumber: 1,
            beatType: 'major',
            summary: 'Beat demo',
          },
        ],
        canonical_entities: {
          characters: [],
          locations: [],
          objects: [
            {
              id: 'object_o_khoa_chu_nguc',
              name: 'Ổ khóa chữ "Ngục"',
              description: 'Ban mo ta day du hon',
              confidence: 0.9,
              timeline: [{ eventId: 'evt-1', chapter: 1, summary: 'xuat hien' }],
            },
            {
              id: 'object_o_khoa_chu_nguc',
              name: 'Ổ khóa chữ Ngục',
              description: '',
              confidence: 0.72,
              timeline: [{ eventId: 'evt-1', chapter: 1, summary: 'xuat hien' }],
            },
          ],
          terms: [],
          worldProfile: {},
        },
      },
    });

    expect(artifact.canonical_entities.objects).toHaveLength(1);
    expect(artifact.canonical_entities.objects[0].id).toBe('object_o_khoa_chu_nguc');
    expect(artifact.canonical_entities.objects[0].description).toBe('Ban mo ta day du hon');
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

  it('builds review queue items with related incident and window scope links', () => {
    const queue = buildReviewQueue(
      [
        {
          id: 'inc-1',
          title: 'Incident 1',
          confidence: 0.2,
          evidence: [],
          rerunScope: {
            windowIds: ['window-1', 'window-2'],
          },
          entityRefs: {
            locations: ['loc-1'],
          },
        },
      ],
      [
        {
          id: 'evt-1',
          description: 'Event 1',
          confidence: 0.2,
          evidence: [],
          incidentId: 'inc-1',
        },
      ],
      [
        {
          id: 'loc-1',
          name: 'Nha tro so 18',
          confidence: 0.2,
          evidence: [],
          timeline: [{ eventId: 'evt-1', chapter: 1, summary: 'sample' }],
        },
      ],
      [],
      {
        corpusId: 'corpus-1',
        analysisId: 'analysis-1',
      },
    );

    const incidentItem = queue.find((item) => item.itemType === 'incident');
    const eventItem = queue.find((item) => item.itemType === 'event');
    const locationItem = queue.find((item) => item.itemType === 'location');

    expect(incidentItem.relatedIncidentIds).toEqual(['inc-1']);
    expect(incidentItem.relatedWindowIds).toEqual(['window-1', 'window-2']);
    expect(eventItem.relatedIncidentIds).toEqual(['inc-1']);
    expect(eventItem.relatedWindowIds).toEqual(['window-1', 'window-2']);
    expect(locationItem.relatedIncidentIds).toEqual(['inc-1']);
    expect(locationItem.relatedWindowIds).toEqual(['window-1', 'window-2']);
    expect(locationItem.rerunScope).toBe('world_canonicalizer');
  });

  postgresIt('persistIncidentFirstArtifacts materializes V3 artifact and compat projections without rerunning pipeline', async () => {
    await bootstrapPostgres();
    await queryPostgres('DELETE FROM analysis_entity_mentions WHERE analysis_id = $1', ['analysis-1']);
    await queryPostgres('DELETE FROM analysis_beats WHERE analysis_id = $1', ['analysis-1']);
    await queryPostgres('DELETE FROM analysis_entities WHERE analysis_id = $1', ['analysis-1']);
    await queryPostgres('DELETE FROM analysis_incidents WHERE analysis_id = $1', ['analysis-1']);
    await queryPostgres('DELETE FROM analysis_review_queue WHERE analysis_id = $1', ['analysis-1']);
    await queryPostgres('DELETE FROM analysis_windows WHERE analysis_id = $1', ['analysis-1']);
    await queryPostgres('DELETE FROM analysis_run_artifacts WHERE analysis_id = $1', ['analysis-1']);
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
        artifact_version: 'v3',
        canonical_corpus: {
          chapters: [{ chapterNumber: 1, chapterId: 'chapter-1', title: 'Chapter 1', text: 'Noi dung chapter 1' }],
          storageChunks: [{ chunkId: 'chunk-1', chapterId: 'chapter-1', chapterNumber: 1, text: 'Noi dung chunk 1' }],
          evidenceSpans: [{ spanId: 'span-1', chunkId: 'chunk-1', chapterNumber: 1, snippet: 'Noi dung chunk 1' }],
          chapterCount: 1,
        },
        analysis_windows: [
          {
            id: 'window:1',
            windowId: 'window_01',
            windowOrder: 1,
            chapterStart: 1,
            chapterEnd: 1,
            chapterNumbers: [1],
            status: 'completed',
          },
        ],
        incidents: [
          {
            id: 'inc-1',
            title: 'Incident A',
            chapterStart: 1,
            chapterEnd: 1,
            confidence: 0.8,
            detailedSummary: 'Incident chi tiet',
            primaryEvidenceRefs: ['Bang chung 1'],
          },
        ],
        incident_beats: [
          {
            id: 'beat-1',
            sourceEventId: 'evt-1',
            incidentId: 'inc-1',
            sequence: 1,
            chapterNumber: 1,
            beatType: 'major',
            summary: 'Bien co lon xay ra',
            confidence: 0.81,
            evidenceRefs: ['Bang chung 1'],
          },
        ],
        canonical_entities: {
          locations: [
            {
              id: 'loc-1',
              name: 'Nha tro so 18',
              chapterStart: 1,
              chapterEnd: 1,
            },
          ],
        },
        review_queue: [
          {
            id: 'rq-1',
            itemType: 'incident',
            itemId: 'inc-1',
            priority: 'P1',
            priorityScore: 0.5,
            rerunScope: 'incident',
            relatedIncidentIds: ['inc-1'],
          },
        ],
      },
    });

    expect(persisted.persisted).toBe(true);
    expect(persisted.sourceOfTruth).toBe('analysis_run_artifacts');
    expect(persisted.counts.incidents).toBe(1);
    expect(persisted.counts.reviewQueue).toBe(1);
    expect(persisted.counts.windows).toBe(1);
    expect(persisted.counts.beats).toBe(1);

    const artifact = await pgGetAnalysisArtifactByAnalysis('analysis-1');
    const windows = await pgListAnalysisWindowsByAnalysis('analysis-1');
    const beats = await pgListAnalysisBeatsByAnalysis('analysis-1');

    expect(artifact?.artifactVersion).toBe('v3');
    expect(windows).toHaveLength(1);
    expect(beats).toHaveLength(1);

    await queryPostgres('DELETE FROM analysis_entity_mentions WHERE analysis_id = $1', ['analysis-1']);
    await queryPostgres('DELETE FROM analysis_beats WHERE analysis_id = $1', ['analysis-1']);
    await queryPostgres('DELETE FROM analysis_entities WHERE analysis_id = $1', ['analysis-1']);
    await queryPostgres('DELETE FROM analysis_incidents WHERE analysis_id = $1', ['analysis-1']);
    await queryPostgres('DELETE FROM analysis_review_queue WHERE analysis_id = $1', ['analysis-1']);
    await queryPostgres('DELETE FROM analysis_windows WHERE analysis_id = $1', ['analysis-1']);
    await queryPostgres('DELETE FROM analysis_run_artifacts WHERE analysis_id = $1', ['analysis-1']);
    await queryPostgres('DELETE FROM review_queue WHERE analysis_id = $1', ['analysis-1']);
    await queryPostgres('DELETE FROM consistency_risks WHERE analysis_id = $1', ['analysis-1']);
    await queryPostgres('DELETE FROM analysis_events WHERE analysis_id = $1', ['analysis-1']);
    await queryPostgres('DELETE FROM analysis_locations WHERE analysis_id = $1', ['analysis-1']);
    await queryPostgres('DELETE FROM incidents WHERE analysis_id = $1', ['analysis-1']);
    await queryPostgres('DELETE FROM chunk_results WHERE analysis_id = $1', ['analysis-1']);
    await queryPostgres('DELETE FROM corpus_analyses WHERE id = $1', ['analysis-1']);
    await queryPostgres('DELETE FROM corpuses WHERE id = $1', ['corpus-1']);
  });

  postgresIt('persists story graphs for multiple analyses without colliding node primary keys', async () => {
    await bootstrapPostgres();
    await queryPostgres('DELETE FROM analysis_pass_reports WHERE analysis_id IN ($1, $2)', ['analysis-graph-1', 'analysis-graph-2']);
    await queryPostgres('DELETE FROM analysis_graph_edges WHERE analysis_id IN ($1, $2)', ['analysis-graph-1', 'analysis-graph-2']);
    await queryPostgres('DELETE FROM analysis_graph_nodes WHERE analysis_id IN ($1, $2)', ['analysis-graph-1', 'analysis-graph-2']);
    await queryPostgres('DELETE FROM corpus_analyses WHERE id IN ($1, $2)', ['analysis-graph-1', 'analysis-graph-2']);
    await queryPostgres('DELETE FROM corpuses WHERE id = $1', ['corpus-graph']);

    const now = Date.now();
    await pgInsertCorpusGraph(
      {
        id: 'corpus-graph',
        title: 'Corpus graph',
        author: 'Tester',
        sourceFile: 'graph.txt',
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
        wordCount: 20,
        chapterCount: 1,
        status: 'uploaded',
        createdAt: now,
        updatedAt: now,
      },
      [
        {
          id: 'chapter-graph-1',
          corpusId: 'corpus-graph',
          index: 1,
          title: 'Chapter 1',
          content: 'Noi dung chapter graph',
          wordCount: 20,
        },
      ],
      [
        {
          id: 'chunk-graph-1',
          chapterId: 'chapter-graph-1',
          corpusId: 'corpus-graph',
          index: 1,
          text: 'Noi dung chunk graph',
          wordCount: 20,
          startPosition: 0,
          startWord: 'Noi',
          endWord: 'graph',
        },
      ],
    );

    await pgCreateAnalysis({
      id: 'analysis-graph-1',
      corpusId: 'corpus-graph',
      status: 'completed',
      progress: 1,
      currentPhase: 'completed',
      totalChunks: 1,
      processedChunks: 1,
    });
    await pgCreateAnalysis({
      id: 'analysis-graph-2',
      corpusId: 'corpus-graph',
      status: 'completed',
      progress: 1,
      currentPhase: 'completed',
      totalChunks: 1,
      processedChunks: 1,
    });

    const sharedGraph = {
      nodes: [
        {
          id: 'incident:shared',
          type: 'incident',
          label: 'Incident shared',
          chapterNumber: 1,
          graphKind: 'incident',
        },
      ],
      edges: [
        {
          id: 'edge:shared',
          type: 'incident_causes_incident',
          from: 'incident:shared',
          to: 'incident:shared',
          graphKind: 'incident',
        },
      ],
    };

    await pgPersistStoryGraph({
      analysisId: 'analysis-graph-1',
      corpusId: 'corpus-graph',
      graph: sharedGraph,
      passStatus: {},
    });
    await pgPersistStoryGraph({
      analysisId: 'analysis-graph-2',
      corpusId: 'corpus-graph',
      graph: sharedGraph,
      passStatus: {},
    });

    const graphOne = await pgGetStoryGraphByAnalysis('analysis-graph-1');
    const graphTwo = await pgGetStoryGraphByAnalysis('analysis-graph-2');

    expect(graphOne?.nodes[0]?.id).toBe('incident:shared');
    expect(graphTwo?.nodes[0]?.id).toBe('incident:shared');
    expect(graphOne?.nodes[0]?.storageId).toBe('analysis-graph-1:incident:shared');
    expect(graphTwo?.nodes[0]?.storageId).toBe('analysis-graph-2:incident:shared');
    expect(graphOne?.edges[0]?.id).toBe('edge:shared');
    expect(graphTwo?.edges[0]?.id).toBe('edge:shared');

    await queryPostgres('DELETE FROM analysis_pass_reports WHERE analysis_id IN ($1, $2)', ['analysis-graph-1', 'analysis-graph-2']);
    await queryPostgres('DELETE FROM analysis_graph_edges WHERE analysis_id IN ($1, $2)', ['analysis-graph-1', 'analysis-graph-2']);
    await queryPostgres('DELETE FROM analysis_graph_nodes WHERE analysis_id IN ($1, $2)', ['analysis-graph-1', 'analysis-graph-2']);
    await queryPostgres('DELETE FROM corpus_analyses WHERE id IN ($1, $2)', ['analysis-graph-1', 'analysis-graph-2']);
    await queryPostgres('DELETE FROM corpuses WHERE id = $1', ['corpus-graph']);
  });
});
