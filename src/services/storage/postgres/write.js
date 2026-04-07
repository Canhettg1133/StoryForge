import { randomUUID } from 'node:crypto';
import { bootstrapPostgres } from './bootstrap.js';
import {
  queryPostgres,
  withPostgresTransaction,
} from './client.js';
import {
  pgCountQueuedAndRunningJobs,
  pgGetAnalysisById,
  pgGetCorpusById,
  pgGetExecutionSessionById,
  pgGetExecutionStageOutput,
  pgGetIncidentById,
  pgGetJobById,
  pgGetReviewQueueItemById,
  pgListRunnablePendingJobs,
} from './read.js';

function parseJsonish(value, fallback = null) {
  if (value == null) return fallback;
  if (typeof value === 'object') return value;
  if (typeof value !== 'string') return fallback;

  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function toJsonText(value, fallback = null) {
  if (value == null) return fallback;
  if (typeof value === 'string') return value;

  try {
    return JSON.stringify(value);
  } catch {
    return fallback;
  }
}

function toJsonbParam(value, fallback = null) {
  if (value == null) {
    return fallback == null ? null : JSON.stringify(fallback);
  }

  if (typeof value === 'string') {
    try {
      JSON.parse(value);
      return value;
    } catch {
      return JSON.stringify(value);
    }
  }

  try {
    return JSON.stringify(value);
  } catch {
    return fallback == null ? null : JSON.stringify(fallback);
  }
}

function buildGraphStorageId(analysisId, graphItemId) {
  const normalizedAnalysisId = String(analysisId || '').trim();
  const normalizedGraphItemId = String(graphItemId || '').trim();
  if (!normalizedAnalysisId || !normalizedGraphItemId) {
    return normalizedGraphItemId || normalizedAnalysisId;
  }
  return `${normalizedAnalysisId}:${normalizedGraphItemId}`;
}

function buildUpdateParts(updates = {}, mapping = {}) {
  const setClauses = [];
  const values = [];

  for (const [inputKey, rawConfig] of Object.entries(mapping)) {
    if (!Object.prototype.hasOwnProperty.call(updates, inputKey) || updates[inputKey] === undefined) {
      continue;
    }

    const config = typeof rawConfig === 'string'
      ? { column: rawConfig, transform: (value) => value }
      : rawConfig;
    setClauses.push(`${config.column} = $${values.length + 1}`);
    values.push(config.transform ? config.transform(updates[inputKey]) : updates[inputKey]);
  }

  return {
    setClauses,
    values,
  };
}

const CORPUS_UPDATE_FIELDS = {
  title: 'title',
  author: 'author',
  frontMatter: {
    column: 'front_matter',
    transform: (value) => toJsonbParam(value, null),
  },
  parseDiagnostics: {
    column: 'parse_diagnostics',
    transform: (value) => toJsonbParam(value, null),
  },
  fandom: 'fandom',
  isCanonFanfic: 'is_canon_fanfic',
  rating: 'rating',
  language: 'language',
  status: 'status',
  chunkSize: 'chunk_size',
  chunkSizeUsed: 'chunk_size_used',
  chunkCount: 'chunk_count',
  lastRechunkedAt: 'last_rechunked_at',
};

const ANALYSIS_UPDATE_FIELDS = {
  status: 'status',
  chunkSize: 'chunk_size',
  chunkOverlap: 'chunk_overlap',
  provider: 'provider',
  model: 'model',
  temperature: 'temperature',
  level0Status: 'level_0_status',
  level1Status: 'level_1_status',
  level2Status: 'level_2_status',
  resultL1: 'result_l1',
  resultL2: 'result_l2',
  resultL3: 'result_l3',
  resultL4: 'result_l4',
  resultL5: 'result_l5',
  resultL6: 'result_l6',
  finalResult: 'final_result',
  analysisRunManifest: {
    column: 'analysis_run_manifest',
    transform: (value) => toJsonbParam(value, null),
  },
  passStatus: {
    column: 'pass_status',
    transform: (value) => toJsonbParam(value, null),
  },
  degradedRunReport: {
    column: 'degraded_run_report',
    transform: (value) => toJsonbParam(value, null),
  },
  graphSummary: {
    column: 'graph_summary',
    transform: (value) => toJsonbParam(value, null),
  },
  artifactVersion: 'artifact_version',
  artifactRevision: 'artifact_revision',
  totalChunks: 'total_chunks',
  processedChunks: 'processed_chunks',
  progress: 'progress',
  currentPhase: 'current_phase',
  partsGenerated: 'parts_generated',
  errorMessage: 'error_message',
  startedAt: 'started_at',
  completedAt: 'completed_at',
};

const JOB_UPDATE_FIELDS = {
  status: 'status',
  progress: 'progress',
  progressMessage: 'progress_message',
  inputData: {
    column: 'input_data',
    transform: (value) => toJsonText(value),
  },
  outputData: {
    column: 'output_data',
    transform: (value) => toJsonText(value),
  },
  errorMessage: 'error_message',
  errorStack: 'error_stack',
  startedAt: 'started_at',
  completedAt: 'completed_at',
  priority: 'priority',
  workerId: 'worker_id',
};

export async function pgInsertCorpusGraph(corpus, chapters = [], chunks = []) {
  await bootstrapPostgres();

  await withPostgresTransaction(async (client) => {
    await client.query(`
      INSERT INTO corpuses (
        id, title, author, source_file, file_type, front_matter, parse_diagnostics, fandom, fandom_confidence,
        is_canon_fanfic, rating, language, chunk_size, chunk_size_used, chunk_count,
        last_rechunked_at, word_count, chapter_count, status, created_at, updated_at
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21
      )
      ON CONFLICT (id) DO UPDATE SET
        title = EXCLUDED.title,
        author = EXCLUDED.author,
        source_file = EXCLUDED.source_file,
        file_type = EXCLUDED.file_type,
        front_matter = EXCLUDED.front_matter,
        parse_diagnostics = EXCLUDED.parse_diagnostics,
        fandom = EXCLUDED.fandom,
        fandom_confidence = EXCLUDED.fandom_confidence,
        is_canon_fanfic = EXCLUDED.is_canon_fanfic,
        rating = EXCLUDED.rating,
        language = EXCLUDED.language,
        chunk_size = EXCLUDED.chunk_size,
        chunk_size_used = EXCLUDED.chunk_size_used,
        chunk_count = EXCLUDED.chunk_count,
        last_rechunked_at = EXCLUDED.last_rechunked_at,
        word_count = EXCLUDED.word_count,
        chapter_count = EXCLUDED.chapter_count,
        status = EXCLUDED.status,
        updated_at = EXCLUDED.updated_at
    `, [
      corpus.id,
      corpus.title,
      corpus.author ?? null,
      corpus.sourceFile ?? null,
      corpus.fileType ?? null,
      toJsonbParam(corpus.frontMatter, null),
      toJsonbParam(corpus.parseDiagnostics, null),
      corpus.fandom ?? null,
      corpus.fandomConfidence ?? null,
      corpus.isCanonFanfic ?? null,
      corpus.rating ?? null,
      corpus.language ?? 'vi',
      corpus.chunkSize ?? null,
      corpus.chunkSizeUsed ?? null,
      corpus.chunkCount ?? 0,
      corpus.lastRechunkedAt ?? null,
      corpus.wordCount ?? 0,
      corpus.chapterCount ?? 0,
      corpus.status ?? 'uploaded',
      corpus.createdAt ?? Date.now(),
      corpus.updatedAt ?? Date.now(),
    ]);

    await client.query('DELETE FROM chunks WHERE corpus_id = $1', [corpus.id]);
    await client.query('DELETE FROM chapters WHERE corpus_id = $1', [corpus.id]);

    for (const chapter of chapters) {
      await client.query(`
        INSERT INTO chapters (
          id, corpus_id, chapter_index, title, content, word_count,
          start_line, end_line, start_page, end_page
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      `, [
        chapter.id,
        chapter.corpusId,
        chapter.index,
        chapter.title ?? null,
        chapter.content ?? '',
        chapter.wordCount ?? 0,
        chapter.startLine ?? null,
        chapter.endLine ?? null,
        chapter.startPage ?? null,
        chapter.endPage ?? null,
      ]);
    }

    for (const chunk of chunks) {
      await client.query(`
        INSERT INTO chunks (
          id, chapter_id, corpus_id, chunk_index, text, word_count,
          start_position, start_word, end_word
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      `, [
        chunk.id,
        chunk.chapterId,
        chunk.corpusId,
        chunk.index,
        chunk.text ?? '',
        chunk.wordCount ?? 0,
        chunk.startPosition ?? null,
        chunk.startWord ?? null,
        chunk.endWord ?? null,
      ]);
    }
  });

  return pgGetCorpusById(corpus.id, { includeChapterContent: false });
}

export async function pgReplaceCorpusChunks(corpusId, chunks = []) {
  await bootstrapPostgres();

  await withPostgresTransaction(async (client) => {
    await client.query('DELETE FROM chunks WHERE corpus_id = $1', [corpusId]);

    for (const chunk of chunks) {
      await client.query(`
        INSERT INTO chunks (
          id, chapter_id, corpus_id, chunk_index, text, word_count,
          start_position, start_word, end_word
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      `, [
        chunk.id,
        chunk.chapterId,
        corpusId,
        chunk.index,
        chunk.text ?? '',
        chunk.wordCount ?? 0,
        chunk.startPosition ?? null,
        chunk.startWord ?? null,
        chunk.endWord ?? null,
      ]);
    }
  });

  return chunks.length;
}

export async function pgUpdateCorpusById(corpusId, updates = {}) {
  await bootstrapPostgres();

  const { setClauses, values } = buildUpdateParts(updates, CORPUS_UPDATE_FIELDS);
  if (!setClauses.length) {
    return pgGetCorpusById(corpusId, { includeChapterContent: false });
  }

  values.push(Date.now());
  values.push(corpusId);
  const result = await queryPostgres(`
    UPDATE corpuses
    SET ${setClauses.join(', ')}, updated_at = $${values.length - 1}
    WHERE id = $${values.length}
  `, values);

  if (result.rowCount === 0) {
    return null;
  }

  return pgGetCorpusById(corpusId, { includeChapterContent: false });
}

export async function pgDeleteCorpusById(corpusId) {
  await bootstrapPostgres();
  const result = await queryPostgres('DELETE FROM corpuses WHERE id = $1', [corpusId]);
  return result.rowCount > 0;
}

export async function pgCreateAnalysis(payload = {}) {
  await bootstrapPostgres();

  const now = Date.now();
  await queryPostgres(`
    INSERT INTO corpus_analyses (
      id, corpus_id, chunk_size, chunk_overlap, provider, model, temperature,
      status, level_0_status, level_1_status, level_2_status,
      analysis_run_manifest, pass_status, degraded_run_report, graph_summary, artifact_version,
      total_chunks, processed_chunks, progress, current_phase, parts_generated,
      error_message, created_at, started_at, completed_at
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,
      $12,$13,$14,$15,$16,$17,$18,$19,$20,$21,
      $22,$23,$24,$25
    )
  `, [
    payload.id,
    payload.corpusId,
    payload.chunkSize ?? 500000,
    payload.chunkOverlap ?? 0,
    payload.provider ?? 'gemini_proxy',
    payload.model ?? null,
    payload.temperature ?? 0.2,
    payload.status ?? 'pending',
    payload.level0Status ?? 'pending',
    payload.level1Status ?? 'pending',
    payload.level2Status ?? 'pending',
    toJsonbParam(payload.analysisRunManifest, null),
    toJsonbParam(payload.passStatus, null),
    toJsonbParam(payload.degradedRunReport, null),
    toJsonbParam(payload.graphSummary, null),
    payload.artifactVersion ?? 'legacy',
    payload.totalChunks ?? 1,
    payload.processedChunks ?? 0,
    payload.progress ?? 0,
    payload.currentPhase ?? 'queued',
    payload.partsGenerated ?? 0,
    payload.errorMessage ?? null,
    payload.createdAt ?? now,
    payload.startedAt ?? null,
    payload.completedAt ?? null,
  ]);

  return pgGetAnalysisById(payload.id);
}

export async function pgUpdateAnalysis(analysisId, updates = {}) {
  await bootstrapPostgres();

  const { setClauses, values } = buildUpdateParts(updates, ANALYSIS_UPDATE_FIELDS);
  if (!setClauses.length) {
    return pgGetAnalysisById(analysisId);
  }

  values.push(analysisId);
  const result = await queryPostgres(`
    UPDATE corpus_analyses
    SET ${setClauses.join(', ')}
    WHERE id = $${values.length}
  `, values);

  if (result.rowCount === 0) {
    return null;
  }

  return pgGetAnalysisById(analysisId);
}

export async function pgInsertChunkResult(payload = {}) {
  await bootstrapPostgres();

  await queryPostgres(`
    INSERT INTO chunk_results (
      id, analysis_id, chunk_index, chapter_id, processing_time_ms,
      input_tokens, output_tokens, result, error, started_at, completed_at, created_at
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12
    )
    ON CONFLICT (id) DO UPDATE SET
      analysis_id = EXCLUDED.analysis_id,
      chunk_index = EXCLUDED.chunk_index,
      chapter_id = EXCLUDED.chapter_id,
      processing_time_ms = EXCLUDED.processing_time_ms,
      input_tokens = EXCLUDED.input_tokens,
      output_tokens = EXCLUDED.output_tokens,
      result = EXCLUDED.result,
      error = EXCLUDED.error,
      started_at = EXCLUDED.started_at,
      completed_at = EXCLUDED.completed_at
  `, [
    payload.id,
    payload.analysisId,
    payload.chunkIndex ?? 0,
    payload.chapterId ?? null,
    payload.processingTimeMs ?? null,
    payload.inputTokens ?? null,
    payload.outputTokens ?? null,
    payload.result ?? null,
    payload.error ?? null,
    payload.startedAt ?? null,
    payload.completedAt ?? null,
    payload.createdAt ?? Date.now(),
  ]);
}

export async function pgReplaceIncidentFirstArtifacts({
  analysisId,
  corpusId,
  incidents = [],
  events = [],
  locations = [],
  consistencyRisks = [],
  reviewQueue = [],
} = {}) {
  await bootstrapPostgres();

  await withPostgresTransaction(async (client) => {
    await client.query('DELETE FROM review_queue WHERE analysis_id = $1', [analysisId]);
    await client.query('DELETE FROM consistency_risks WHERE analysis_id = $1', [analysisId]);
    await client.query('DELETE FROM analysis_events WHERE analysis_id = $1', [analysisId]);
    await client.query('DELETE FROM analysis_locations WHERE analysis_id = $1', [analysisId]);
    await client.query('DELETE FROM incidents WHERE analysis_id = $1', [analysisId]);

    for (const item of incidents) {
      await client.query(`
        INSERT INTO incidents (
          id, corpus_id, analysis_id, title, type, description, start_chapter_id, start_chunk_id,
          end_chapter_id, end_chunk_id, chapter_start_index, chapter_end_index, chunk_start_index,
          chunk_end_index, chapter_start_number, chapter_end_number, start_anchor, active_span,
          climax_anchor, end_anchor, boundary_note, uncertain_start, uncertain_end, confidence, evidence,
          contained_events, sub_incident_ids, related_incidents, related_locations, causal_predecessors,
          causal_successors, major_score, impact_score, status, review_status, priority, provenance,
          created_at, analyzed_at, reviewed_at
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,
          $25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,$39,$40
        )
      `, [
        item.id,
        item.corpusId || corpusId,
        item.analysisId || analysisId,
        item.title,
        item.type,
        item.description ?? null,
        item.startChapterId ?? null,
        item.startChunkId ?? null,
        item.endChapterId ?? null,
        item.endChunkId ?? null,
        item.chapterStartIndex ?? null,
        item.chapterEndIndex ?? null,
        item.chunkStartIndex ?? null,
        item.chunkEndIndex ?? null,
        item.chapterStartNumber ?? item.chapterStart ?? null,
        item.chapterEndNumber ?? item.chapterEnd ?? null,
        toJsonText(item.startAnchor),
        item.activeSpan ?? null,
        toJsonText(item.climaxAnchor),
        toJsonText(item.endAnchor),
        item.boundaryNote ?? null,
        Boolean(item.uncertainStart),
        Boolean(item.uncertainEnd),
        item.confidence ?? 0,
        toJsonText(item.evidence),
        toJsonText(item.containedEvents),
        toJsonText(item.subIncidentIds),
        toJsonText(item.relatedIncidents),
        toJsonText(item.relatedLocations),
        toJsonText(item.causalPredecessors),
        toJsonText(item.causalSuccessors),
        item.majorScore ?? 0,
        item.impactScore ?? 0,
        item.status ?? null,
        item.reviewStatus ?? null,
        item.priority ?? null,
        parseJsonish(item.provenance, null),
        item.createdAt ?? Date.now(),
        item.analyzedAt ?? null,
        item.reviewedAt ?? null,
      ]);
    }

    for (const item of events) {
      await client.query(`
        INSERT INTO analysis_events (
          id, corpus_id, analysis_id, title, description, severity, tags, chapter_id, chapter_index,
          chapter_number, chunk_id, chunk_index, incident_id, link_role, secondary_incident_ids,
          location_link, causal_links, confidence, evidence, quality_proxy, review_status, needs_review,
          annotation, provenance, created_at, grounded_at, reviewed_at
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27
        )
      `, [
        item.id,
        item.corpusId || corpusId,
        item.analysisId || analysisId,
        item.title,
        item.description ?? null,
        item.severity ?? 0,
        toJsonText(item.tags),
        item.chapterId ?? null,
        item.chapterIndex ?? null,
        item.chapterNumber ?? item.chapter ?? null,
        item.chunkId ?? null,
        item.chunkIndex ?? null,
        item.incidentId ?? null,
        item.linkRole ?? 'primary',
        toJsonText(item.secondaryIncidentIds),
        toJsonText(item.locationLink),
        toJsonText(item.causalLinks),
        item.confidence ?? 0,
        toJsonText(item.evidence),
        item.qualityProxy ?? 0,
        item.reviewStatus ?? null,
        Boolean(item.needsReview),
        item.annotation ?? null,
        parseJsonish(item.provenance, null),
        item.createdAt ?? Date.now(),
        item.groundedAt ?? null,
        item.reviewedAt ?? null,
      ]);
    }

    for (const item of locations) {
      await client.query(`
        INSERT INTO analysis_locations (
          id, corpus_id, analysis_id, name, normalized, aliases, mention_count, chapter_start, chapter_end,
          chapter_start_number, chapter_end_number, chapter_spread, importance, is_major, tokens, evidence,
          incident_ids, event_ids, confidence, evidence_strength, review_status, provenance, created_at, reviewed_at
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24
        )
      `, [
        item.id,
        item.corpusId || corpusId,
        item.analysisId || analysisId,
        item.name,
        item.normalized ?? null,
        toJsonText(item.aliases),
        item.mentionCount ?? 0,
        item.chapterStart ?? null,
        item.chapterEnd ?? null,
        item.chapterStartNumber ?? item.chapterStart ?? null,
        item.chapterEndNumber ?? item.chapterEnd ?? null,
        toJsonText(item.chapterSpread),
        item.importance ?? 0,
        Boolean(item.isMajor),
        toJsonText(item.tokens),
        toJsonText(item.evidence),
        toJsonText(item.incidentIds),
        toJsonText(item.eventIds),
        item.confidence ?? 0,
        item.evidenceStrength ?? 0,
        item.reviewStatus ?? null,
        parseJsonish(item.provenance, null),
        item.createdAt ?? Date.now(),
        item.reviewedAt ?? null,
      ]);
    }

    for (const item of consistencyRisks) {
      await client.query(`
        INSERT INTO consistency_risks (
          id, corpus_id, analysis_id, type, severity, description, details, involved_incidents,
          involved_events, involved_locations, evidence, chapter_start, chapter_end, resolved,
          resolution, resolved_at, detected_at
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17
        )
      `, [
        item.id,
        item.corpusId || corpusId,
        item.analysisId || analysisId,
        item.type,
        item.severity,
        item.description ?? null,
        toJsonText(item.details),
        toJsonText(item.involvedIncidents),
        toJsonText(item.involvedEvents),
        toJsonText(item.involvedLocations),
        toJsonText(item.evidence),
        item.chapterStart ?? null,
        item.chapterEnd ?? null,
        Boolean(item.resolved),
        item.resolution ?? null,
        item.resolvedAt ?? null,
        item.detectedAt ?? Date.now(),
      ]);
    }

    for (const item of reviewQueue) {
      await client.query(`
        INSERT INTO review_queue (
          id, corpus_id, analysis_id, item_type, item_id, priority, priority_score,
          score_breakdown, reason, suggestions, status, reviewed_by, reviewed_at, resolution, created_at
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15
        )
      `, [
        item.id,
        item.corpusId || corpusId,
        item.analysisId || analysisId,
        item.itemType,
        item.itemId,
        item.priority,
        item.priorityScore ?? 0,
        toJsonText(item.scoreBreakdown),
        toJsonText(item.reason),
        toJsonText(item.suggestions),
        item.status ?? 'pending',
        item.reviewedBy ?? null,
        item.reviewedAt ?? null,
        item.resolution ?? null,
        item.createdAt ?? Date.now(),
      ]);
    }
  });
}

export async function pgPersistAnalysisArtifactV3({
  analysisId,
  corpusId,
  artifact = {},
  windows = [],
  incidents = [],
  beats = [],
  entities = [],
  entityMentions = [],
  reviewQueue = [],
} = {}) {
  if (!analysisId || !corpusId) {
    return;
  }

  await bootstrapPostgres();
  const now = Date.now();

  await withPostgresTransaction(async (client) => {
    await client.query(`
      INSERT INTO analysis_run_artifacts (
        analysis_id, corpus_id, artifact_version, canonical_corpus, analysis_windows,
        window_results, carry_packets, incident_map, incidents, incident_beats,
        entity_mentions, canonical_entities, graph_projections, review_queue,
        pass_status, rerun_manifest, degraded_run_report, payload, created_at, updated_at
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20
      )
      ON CONFLICT (analysis_id) DO UPDATE SET
        corpus_id = EXCLUDED.corpus_id,
        artifact_version = EXCLUDED.artifact_version,
        canonical_corpus = EXCLUDED.canonical_corpus,
        analysis_windows = EXCLUDED.analysis_windows,
        window_results = EXCLUDED.window_results,
        carry_packets = EXCLUDED.carry_packets,
        incident_map = EXCLUDED.incident_map,
        incidents = EXCLUDED.incidents,
        incident_beats = EXCLUDED.incident_beats,
        entity_mentions = EXCLUDED.entity_mentions,
        canonical_entities = EXCLUDED.canonical_entities,
        graph_projections = EXCLUDED.graph_projections,
        review_queue = EXCLUDED.review_queue,
        pass_status = EXCLUDED.pass_status,
        rerun_manifest = EXCLUDED.rerun_manifest,
        degraded_run_report = EXCLUDED.degraded_run_report,
        payload = EXCLUDED.payload,
        updated_at = EXCLUDED.updated_at
    `, [
      analysisId,
      corpusId,
      artifact.artifact_version || 'v3',
      toJsonbParam(artifact.canonical_corpus, {}),
      toJsonbParam(artifact.analysis_windows, []),
      toJsonbParam(artifact.window_results, []),
      toJsonbParam(artifact.carry_packets, []),
      toJsonbParam(artifact.incident_map, {}),
      toJsonbParam(artifact.incidents, []),
      toJsonbParam(artifact.incident_beats, []),
      toJsonbParam(artifact.entity_mentions, []),
      toJsonbParam(artifact.canonical_entities, {}),
      toJsonbParam(artifact.graph_projections, {}),
      toJsonbParam(artifact.review_queue, []),
      toJsonbParam(artifact.pass_status, {}),
      toJsonbParam(artifact.rerun_manifest, {}),
      toJsonbParam(artifact.degraded_run_report, {}),
      toJsonbParam(artifact, {}),
      now,
      now,
    ]);

    await client.query('DELETE FROM analysis_windows WHERE analysis_id = $1', [analysisId]);
    await client.query('DELETE FROM analysis_entity_mentions WHERE analysis_id = $1', [analysisId]);
    await client.query('DELETE FROM analysis_beats WHERE analysis_id = $1', [analysisId]);
    await client.query('DELETE FROM analysis_entities WHERE analysis_id = $1', [analysisId]);
    await client.query('DELETE FROM analysis_incidents WHERE analysis_id = $1', [analysisId]);
    await client.query('DELETE FROM analysis_review_queue WHERE analysis_id = $1', [analysisId]);

    for (const item of windows) {
      await client.query(`
        INSERT INTO analysis_windows (
          id, corpus_id, analysis_id, window_id, window_order, chapter_start, chapter_end,
          overlap_from_previous, chapter_numbers, carry_in, carry_out, open_boundaries,
          incidents, status, retries, degraded_reason, prompt_version, schema_version,
          created_at, updated_at
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20
        )
      `, [
        item.id || `${analysisId}:${item.windowId}`,
        corpusId,
        analysisId,
        item.windowId,
        item.windowOrder ?? 0,
        item.chapterStart ?? null,
        item.chapterEnd ?? null,
        item.overlapFromPrevious ?? 0,
        toJsonbParam(item.chapterNumbers, []),
        toJsonbParam(item.carryIn, null),
        toJsonbParam(item.carryOut, null),
        toJsonbParam(item.openBoundaries, []),
        toJsonbParam(item.incidents, []),
        item.status || 'pending',
        item.retries ?? 0,
        item.degradedReason ?? null,
        item.promptVersion ?? null,
        item.schemaVersion || 'v3',
        item.createdAt ?? now,
        item.updatedAt ?? now,
      ]);
    }

    for (const item of incidents) {
      await client.query(`
        INSERT INTO analysis_incidents (
          id, corpus_id, analysis_id, title, type, chapter_start, chapter_end,
          chapter_start_number, chapter_end_number, confidence, summary, detailed_summary,
          climax, outcome, consequences, primary_evidence_refs, entity_refs, review_status,
          degraded_flags, lineage, rerun_scope, payload, created_at, updated_at
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24
        )
      `, [
        item.id,
        corpusId,
        analysisId,
        item.title || 'Untitled incident',
        item.type || 'subplot',
        item.chapterStart ?? null,
        item.chapterEnd ?? null,
        item.chapterStartNumber ?? item.chapterStart ?? null,
        item.chapterEndNumber ?? item.chapterEnd ?? null,
        item.confidence ?? 0,
        item.summary ?? item.description ?? null,
        item.detailedSummary ?? item.detailed_summary ?? item.description ?? null,
        item.climax ?? null,
        item.outcome ?? null,
        toJsonbParam(item.consequences, []),
        toJsonbParam(item.primaryEvidenceRefs || item.primary_evidence_refs, []),
        toJsonbParam(item.entityRefs || item.entity_refs, {}),
        item.reviewStatus || 'needs_review',
        toJsonbParam(item.degradedFlags || item.degraded_flags, []),
        toJsonbParam(item.lineage, {}),
        toJsonbParam(item.rerunScope || item.rerun_scope, {}),
        toJsonbParam(item, {}),
        item.createdAt ?? now,
        item.updatedAt ?? now,
      ]);
    }

    for (const item of beats) {
      await client.query(`
        INSERT INTO analysis_beats (
          id, corpus_id, analysis_id, incident_id, sequence, chapter_number, beat_type,
          summary, causal_links, evidence_refs, confidence, payload, created_at, updated_at
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14
        )
      `, [
        item.id,
        corpusId,
        analysisId,
        item.incidentId ?? null,
        item.sequence ?? 0,
        item.chapterNumber ?? item.chapter ?? null,
        item.beatType || item.beat_type || 'beat',
        item.summary || '',
        toJsonbParam(item.causalLinks || item.causal_links, {}),
        toJsonbParam(item.evidenceRefs || item.evidence_refs, []),
        item.confidence ?? 0,
        toJsonbParam(item, {}),
        item.createdAt ?? now,
        item.updatedAt ?? now,
      ]);
    }

    for (const item of entities) {
      await client.query(`
        INSERT INTO analysis_entities (
          id, corpus_id, analysis_id, entity_kind, name, normalized_name, aliases,
          summary, description, confidence, review_status, payload, created_at, updated_at
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14
        )
      `, [
        item.id,
        corpusId,
        analysisId,
        item.entityKind || item.entity_kind || 'entity',
        item.name || 'Unknown',
        item.normalizedName || item.normalized_name || null,
        toJsonbParam(item.aliases, []),
        item.summary ?? null,
        item.description ?? null,
        item.confidence ?? 0,
        item.reviewStatus || 'needs_review',
        toJsonbParam(item, {}),
        item.createdAt ?? now,
        item.updatedAt ?? now,
      ]);
    }

    for (const item of entityMentions) {
      await client.query(`
        INSERT INTO analysis_entity_mentions (
          id, corpus_id, analysis_id, entity_id, beat_id, entity_kind, surface_form,
          canonical_entity_id, chapter_number, evidence_ref, payload, created_at
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12
        )
      `, [
        item.id,
        corpusId,
        analysisId,
        item.entityId ?? null,
        item.beatId ?? null,
        item.entityKind || item.entity_kind || 'entity',
        item.surfaceForm || item.surface_form || '',
        item.canonicalEntityId || item.canonical_entity_id || null,
        item.chapterNumber ?? null,
        item.evidenceRef || item.evidence_ref || null,
        toJsonbParam(item, {}),
        item.createdAt ?? now,
      ]);
    }

    for (const item of reviewQueue) {
      await client.query(`
        INSERT INTO analysis_review_queue (
          id, corpus_id, analysis_id, item_type, item_id, priority, priority_score,
          source_phase, rerun_scope, related_window_ids, related_incident_ids,
          suggested_action, score_breakdown, reason, suggestions, status,
          resolution, payload, created_at, updated_at
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20
        )
      `, [
        item.id,
        corpusId,
        analysisId,
        item.itemType || item.item_type || 'incident',
        item.itemId || item.item_id || '',
        item.priority || 'P2',
        item.priorityScore ?? item.priority_score ?? 0,
        item.sourcePhase || item.source_phase || null,
        item.rerunScope || item.rerun_scope || null,
        toJsonbParam(item.relatedWindowIds || item.related_window_ids, []),
        toJsonbParam(item.relatedIncidentIds || item.related_incident_ids, []),
        item.suggestedAction || item.suggested_action || null,
        toJsonbParam(item.scoreBreakdown || item.score_breakdown, {}),
        toJsonbParam(item.reason, []),
        toJsonbParam(item.suggestions, []),
        item.status || 'pending',
        item.resolution ?? null,
        toJsonbParam(item, {}),
        item.createdAt ?? now,
        item.updatedAt ?? now,
      ]);
    }
  });
}

export async function pgUpsertIncident(payload = {}) {
  await bootstrapPostgres();
  const id = payload.id || randomUUID();

  await queryPostgres(`
    INSERT INTO incidents (
      id, corpus_id, analysis_id, title, type, description,
      start_chapter_id, start_chunk_id, end_chapter_id, end_chunk_id,
      chapter_start_index, chapter_end_index, chunk_start_index, chunk_end_index,
      chapter_start_number, chapter_end_number, start_anchor, active_span, climax_anchor, end_anchor,
      boundary_note, uncertain_start, uncertain_end, confidence, evidence,
      contained_events, sub_incident_ids, related_incidents, related_locations,
      causal_predecessors, causal_successors, major_score, impact_score,
      status, review_status, priority, provenance, created_at, analyzed_at, reviewed_at
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
      $11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
      $21,$22,$23,$24,$25,$26,$27,$28,$29,$30,
      $31,$32,$33,$34,$35,$36,$37,$38,$39,$40
    )
    ON CONFLICT (id) DO UPDATE SET
      corpus_id = EXCLUDED.corpus_id,
      analysis_id = EXCLUDED.analysis_id,
      title = EXCLUDED.title,
      type = EXCLUDED.type,
      description = EXCLUDED.description,
      start_chapter_id = EXCLUDED.start_chapter_id,
      start_chunk_id = EXCLUDED.start_chunk_id,
      end_chapter_id = EXCLUDED.end_chapter_id,
      end_chunk_id = EXCLUDED.end_chunk_id,
      chapter_start_index = EXCLUDED.chapter_start_index,
      chapter_end_index = EXCLUDED.chapter_end_index,
      chunk_start_index = EXCLUDED.chunk_start_index,
      chunk_end_index = EXCLUDED.chunk_end_index,
      chapter_start_number = EXCLUDED.chapter_start_number,
      chapter_end_number = EXCLUDED.chapter_end_number,
      start_anchor = EXCLUDED.start_anchor,
      active_span = EXCLUDED.active_span,
      climax_anchor = EXCLUDED.climax_anchor,
      end_anchor = EXCLUDED.end_anchor,
      boundary_note = EXCLUDED.boundary_note,
      uncertain_start = EXCLUDED.uncertain_start,
      uncertain_end = EXCLUDED.uncertain_end,
      confidence = EXCLUDED.confidence,
      evidence = EXCLUDED.evidence,
      contained_events = EXCLUDED.contained_events,
      sub_incident_ids = EXCLUDED.sub_incident_ids,
      related_incidents = EXCLUDED.related_incidents,
      related_locations = EXCLUDED.related_locations,
      causal_predecessors = EXCLUDED.causal_predecessors,
      causal_successors = EXCLUDED.causal_successors,
      major_score = EXCLUDED.major_score,
      impact_score = EXCLUDED.impact_score,
      status = EXCLUDED.status,
      review_status = EXCLUDED.review_status,
      priority = EXCLUDED.priority,
      provenance = EXCLUDED.provenance,
      analyzed_at = EXCLUDED.analyzed_at,
      reviewed_at = EXCLUDED.reviewed_at
  `, [
    id,
    payload.corpusId,
    payload.analysisId,
    payload.title || 'Untitled incident',
    payload.type || 'subplot',
    payload.description ?? null,
    payload.startChapterId ?? null,
    payload.startChunkId ?? null,
    payload.endChapterId ?? null,
    payload.endChunkId ?? null,
    payload.chapterStartIndex ?? payload.chapterRange?.[0] ?? null,
    payload.chapterEndIndex ?? payload.chapterRange?.[1] ?? null,
    payload.chunkStartIndex ?? payload.chunkRange?.[0] ?? null,
    payload.chunkEndIndex ?? payload.chunkRange?.[1] ?? null,
    payload.chapterStartNumber ?? payload.chapterStartIndex ?? payload.chapterRange?.[0] ?? null,
    payload.chapterEndNumber ?? payload.chapterEndIndex ?? payload.chapterRange?.[1] ?? null,
    toJsonText(payload.startAnchor),
    payload.activeSpan ?? 0,
    toJsonText(payload.climaxAnchor),
    toJsonText(payload.endAnchor),
    payload.boundaryNote ?? null,
    Boolean(payload.uncertainStart),
    Boolean(payload.uncertainEnd),
    payload.confidence ?? 0,
    toJsonText(payload.evidence ?? []),
    toJsonText(payload.containedEvents ?? payload.eventIds ?? []),
    toJsonText(payload.subIncidentIds ?? []),
    toJsonText(payload.relatedIncidents ?? []),
    toJsonText(payload.relatedLocations ?? []),
    toJsonText(payload.causalPredecessors ?? []),
    toJsonText(payload.causalSuccessors ?? []),
    payload.majorScore ?? 0,
    payload.impactScore ?? 0,
    payload.status ?? 'pending',
    payload.reviewStatus ?? 'needs_review',
    payload.priority ?? null,
    parseJsonish(payload.provenance, null),
    payload.createdAt ?? Date.now(),
    payload.analyzedAt ?? null,
    payload.reviewedAt ?? null,
  ]);

  return pgGetIncidentById(id);
}

export async function pgUpsertReviewQueueItem(payload = {}) {
  await bootstrapPostgres();
  const id = payload.id || randomUUID();

  await queryPostgres(`
    INSERT INTO review_queue (
      id, corpus_id, analysis_id, item_type, item_id, priority, priority_score,
      score_breakdown, reason, suggestions, status, reviewed_by, reviewed_at, resolution, created_at
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15
    )
    ON CONFLICT (id) DO UPDATE SET
      corpus_id = EXCLUDED.corpus_id,
      analysis_id = EXCLUDED.analysis_id,
      item_type = EXCLUDED.item_type,
      item_id = EXCLUDED.item_id,
      priority = EXCLUDED.priority,
      priority_score = EXCLUDED.priority_score,
      score_breakdown = EXCLUDED.score_breakdown,
      reason = EXCLUDED.reason,
      suggestions = EXCLUDED.suggestions,
      status = EXCLUDED.status,
      reviewed_by = EXCLUDED.reviewed_by,
      reviewed_at = EXCLUDED.reviewed_at,
      resolution = EXCLUDED.resolution
  `, [
    id,
    payload.corpusId,
    payload.analysisId,
    payload.itemType || 'event',
    payload.itemId || '',
    payload.priority || 'P2',
    payload.priorityScore ?? 0,
    toJsonText(payload.scoreBreakdown ?? {}),
    toJsonText(payload.reason ?? []),
    toJsonText(payload.suggestions ?? []),
    payload.status ?? 'pending',
    payload.reviewedBy ?? null,
    payload.reviewedAt ?? null,
    payload.resolution ?? null,
    payload.createdAt ?? Date.now(),
  ]);

  return pgGetReviewQueueItemById(id);
}

export async function pgPersistStoryGraph({
  analysisId,
  corpusId,
  graph,
  passStatus,
} = {}) {
  if (!analysisId || !corpusId || !graph) {
    return;
  }

  await bootstrapPostgres();
  const normalizedGraph = normalizeGraphInput(graph);
  const nodes = normalizedGraph.nodes;
  const edges = normalizedGraph.edges;
  const passEntries = Object.values(passStatus || {});

  await withPostgresTransaction(async (client) => {
    await client.query('DELETE FROM analysis_pass_reports WHERE analysis_id = $1', [analysisId]);
    await client.query('DELETE FROM analysis_graph_edges WHERE analysis_id = $1', [analysisId]);
    await client.query('DELETE FROM analysis_graph_nodes WHERE analysis_id = $1', [analysisId]);

    for (const node of nodes) {
      await client.query(`
        INSERT INTO analysis_graph_nodes (
          id, corpus_id, analysis_id, node_type, label, confidence, chapter_number, graph_kind, payload, created_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      `, [
        buildGraphStorageId(analysisId, node.id),
        corpusId,
        analysisId,
        node.type || 'unknown',
        node.label || node.id,
        node.confidence ?? 0,
        node.chapterNumber ?? node.chapter ?? null,
        node.graphKind || node.graph_kind || 'incident',
        toJsonbParam(node, {}),
        Date.now(),
      ]);
    }

    for (const edge of edges) {
      await client.query(`
        INSERT INTO analysis_graph_edges (
          id, corpus_id, analysis_id, edge_type, from_node_id, to_node_id, confidence,
          source_pass, review_status, graph_kind, payload, created_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      `, [
        buildGraphStorageId(analysisId, edge.id),
        corpusId,
        analysisId,
        edge.type || 'unknown',
        edge.from,
        edge.to,
        edge.confidence ?? 0,
        edge.sourcePass ?? edge.provenance?.sourcePass ?? null,
        edge.reviewStatus ?? edge.provenance?.reviewStatus ?? null,
        edge.graphKind || edge.graph_kind || 'incident',
        toJsonbParam(edge, {}),
        Date.now(),
      ]);
    }

    for (const pass of passEntries) {
      await client.query(`
        INSERT INTO analysis_pass_reports (
          id, corpus_id, analysis_id, pass_id, status, payload, created_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7)
      `, [
        `${analysisId}:${pass.id}`,
        corpusId,
        analysisId,
        pass.id,
        pass.status || 'unknown',
        toJsonbParam(pass, {}),
        Date.now(),
      ]);
    }
  });
}

function normalizeGraphInput(graph) {
  if (!graph || typeof graph !== 'object') {
    return { nodes: [], edges: [] };
  }

  if (Array.isArray(graph.nodes) || Array.isArray(graph.edges)) {
    return {
      nodes: Array.isArray(graph.nodes) ? graph.nodes : [],
      edges: Array.isArray(graph.edges) ? graph.edges : [],
    };
  }

  const nodes = [];
  const edges = [];
  const nodeSeen = new Set();
  const edgeSeen = new Set();

  for (const [graphKind, projection] of Object.entries(graph)) {
    for (const node of Array.isArray(projection?.nodes) ? projection.nodes : []) {
      if (!node?.id) continue;
      if (nodeSeen.has(node.id)) continue;
      nodeSeen.add(node.id);
      nodes.push({
        ...node,
        graphKind: node.graphKind || node.graph_kind || graphKind,
      });
    }

    for (const edge of Array.isArray(projection?.edges) ? projection.edges : []) {
      if (!edge?.id) continue;
      if (edgeSeen.has(edge.id)) continue;
      edgeSeen.add(edge.id);
      edges.push({
        ...edge,
        graphKind: edge.graphKind || edge.graph_kind || graphKind,
      });
    }
  }

  return { nodes, edges };
}

export async function pgResetRunningJobs() {
  await bootstrapPostgres();

  await queryPostgres(`
    UPDATE jobs
    SET status = $1,
        worker_id = NULL,
        progress_message = $2,
        updated_at = $3
    WHERE status = $4
  `, [
    'pending',
    'Recovered after server restart',
    Date.now(),
    'running',
  ]);
}

export async function pgFailStaleProcessingAnalyses() {
  await bootstrapPostgres();

  await queryPostgres(`
    UPDATE corpus_analyses
    SET status = $1,
        current_phase = $2,
        error_message = $3,
        completed_at = $4
    WHERE status = $5
  `, [
    'failed',
    'failed',
    'Analysis interrupted by server restart',
    Date.now(),
    'processing',
  ]);
}

export async function pgCreateJobRecord({
  type,
  inputData,
  dependsOn = [],
  priority = 0,
} = {}) {
  await bootstrapPostgres();

  const jobId = randomUUID();
  const now = Date.now();

  await withPostgresTransaction(async (client) => {
    await client.query(`
      INSERT INTO jobs (
        id, type, status, progress, progress_message, input_data, output_data,
        error_message, error_stack, created_at, updated_at, started_at,
        completed_at, priority, worker_id
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15
      )
    `, [
      jobId,
      type,
      'pending',
      0,
      null,
      toJsonText(inputData),
      null,
      null,
      null,
      now,
      now,
      null,
      null,
      Number(priority) || 0,
      null,
    ]);

    for (const dependencyId of Array.isArray(dependsOn) ? dependsOn : []) {
      await client.query(`
        INSERT INTO job_dependencies (id, job_id, depends_on_job_id)
        VALUES ($1,$2,$3)
      `, [randomUUID(), jobId, dependencyId]);
    }
  });

  return pgGetJobById(jobId);
}

export async function pgUpdateJobRecord(jobId, updates = {}) {
  await bootstrapPostgres();

  const { setClauses, values } = buildUpdateParts(updates, JOB_UPDATE_FIELDS);
  if (!setClauses.length) {
    return pgGetJobById(jobId);
  }

  values.push(Date.now());
  values.push(jobId);
  const result = await queryPostgres(`
    UPDATE jobs
    SET ${setClauses.join(', ')}, updated_at = $${values.length - 1}
    WHERE id = $${values.length}
  `, values);

  if (result.rowCount === 0) {
    return null;
  }

  return pgGetJobById(jobId);
}

export async function pgUpsertJobStep({
  jobId,
  stepName,
  status = 'pending',
  progress = 0,
  message = null,
} = {}) {
  await bootstrapPostgres();
  const stepId = `${jobId}:${stepName}`;

  await queryPostgres(`
    INSERT INTO job_steps (id, job_id, step_name, status, progress, message)
    VALUES ($1,$2,$3,$4,$5,$6)
    ON CONFLICT (id) DO UPDATE SET
      status = EXCLUDED.status,
      progress = EXCLUDED.progress,
      message = EXCLUDED.message
  `, [
    stepId,
    jobId,
    stepName,
    status,
    Math.max(0, Math.min(100, Math.round(Number(progress) || 0))),
    message,
  ]);
}

export async function pgAssignJobToWorker(jobId, workerId) {
  await bootstrapPostgres();
  const now = Date.now();

  const result = await queryPostgres(`
    UPDATE jobs
    SET status = $1,
        worker_id = $2,
        started_at = COALESCE(started_at, $3),
        updated_at = $3
    WHERE id = $4
      AND status = $5
  `, ['running', workerId, now, jobId, 'pending']);

  if (result.rowCount === 0) {
    return null;
  }

  return pgGetJobById(jobId);
}

export async function pgAcquireExecutionSession({
  sessionId = randomUUID(),
  corpusId,
  analysisId,
  lockToken = randomUUID(),
  scopePhase,
  requestedScope = {},
  plannedJobs = [],
  leaseMs = 30 * 60 * 1000,
} = {}) {
  await bootstrapPostgres();
  const now = Date.now();

  await withPostgresTransaction(async (client) => {
    const analysisResult = await client.query(
      'SELECT id, corpus_id, artifact_revision FROM corpus_analyses WHERE id = $1 FOR UPDATE',
      [analysisId],
    );
    const analysisRow = analysisResult.rows?.[0];
    if (!analysisRow) {
      const error = new Error('Analysis not found for execution session.');
      error.code = 'INVALID_INPUT';
      throw error;
    }

    const activeResult = await client.query(`
      SELECT *
      FROM analysis_execution_sessions
      WHERE analysis_id = $1
        AND status IN ('pending', 'running')
        AND lease_expires_at > $2
      ORDER BY created_at DESC
      LIMIT 1
    `, [analysisId, now]);

    if (activeResult.rows?.[0]) {
      const active = activeResult.rows[0];
      const error = new Error('Analysis already has an active rerun session.');
      error.code = 'ANALYSIS_LOCKED';
      error.details = {
        sessionId: active.id,
        status: active.status,
        currentJobId: active.current_job_id,
        leaseExpiresAt: Number(active.lease_expires_at || 0),
      };
      throw error;
    }

    await client.query(`
      INSERT INTO analysis_execution_sessions (
        id, corpus_id, analysis_id, lock_token, status, scope_phase, requested_scope,
        planned_jobs, baseline_artifact_revision, target_artifact_revision, current_stage_key,
        current_job_id, root_job_id, final_job_id, error_message, last_heartbeat_at,
        lease_expires_at, created_at, updated_at, completed_at, released_at
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21
      )
    `, [
      sessionId,
      corpusId || analysisRow.corpus_id,
      analysisId,
      lockToken,
      'pending',
      scopePhase || 'incident',
      toJsonbParam(requestedScope, {}),
      toJsonbParam(plannedJobs, []),
      Number(analysisRow.artifact_revision || 0),
      Number(analysisRow.artifact_revision || 0) + 1,
      null,
      null,
      null,
      null,
      null,
      now,
      now + Math.max(60_000, Number(leaseMs) || 30 * 60 * 1000),
      now,
      now,
      null,
      null,
    ]);
  });

  return pgGetExecutionSessionById(sessionId);
}

export async function pgUpdateExecutionSession(sessionId, updates = {}) {
  await bootstrapPostgres();
  const mapping = {
    status: 'status',
    scopePhase: 'scope_phase',
    requestedScope: {
      column: 'requested_scope',
      transform: (value) => toJsonbParam(value, {}),
    },
    plannedJobs: {
      column: 'planned_jobs',
      transform: (value) => toJsonbParam(value, []),
    },
    baselineArtifactRevision: 'baseline_artifact_revision',
    targetArtifactRevision: 'target_artifact_revision',
    currentStageKey: 'current_stage_key',
    currentJobId: 'current_job_id',
    rootJobId: 'root_job_id',
    finalJobId: 'final_job_id',
    errorMessage: 'error_message',
    lastHeartbeatAt: 'last_heartbeat_at',
    leaseExpiresAt: 'lease_expires_at',
    completedAt: 'completed_at',
    releasedAt: 'released_at',
  };
  const { setClauses, values } = buildUpdateParts(updates, mapping);
  if (!setClauses.length) {
    return pgGetExecutionSessionById(sessionId);
  }

  values.push(Date.now());
  values.push(sessionId);
  await queryPostgres(`
    UPDATE analysis_execution_sessions
    SET ${setClauses.join(', ')}, updated_at = $${values.length - 1}
    WHERE id = $${values.length}
  `, values);

  return pgGetExecutionSessionById(sessionId);
}

export async function pgTouchExecutionSession(sessionId, updates = {}) {
  const now = Date.now();
  const leaseMs = Math.max(60_000, Number(updates.leaseMs) || 30 * 60 * 1000);
  return pgUpdateExecutionSession(sessionId, {
    ...updates,
    lastHeartbeatAt: now,
    leaseExpiresAt: updates.leaseExpiresAt || (now + leaseMs),
  });
}

export async function pgUpsertExecutionStageOutput({
  sessionId,
  corpusId,
  analysisId,
  stageKey,
  jobId = null,
  status = 'completed',
  payload = {},
} = {}) {
  await bootstrapPostgres();
  const now = Date.now();
  const id = `${sessionId}:${stageKey}`;

  await queryPostgres(`
    INSERT INTO analysis_execution_stage_outputs (
      id, session_id, corpus_id, analysis_id, stage_key, job_id, status, payload, created_at, updated_at
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10
    )
    ON CONFLICT (session_id, stage_key) DO UPDATE SET
      job_id = EXCLUDED.job_id,
      status = EXCLUDED.status,
      payload = EXCLUDED.payload,
      updated_at = EXCLUDED.updated_at
  `, [
    id,
    sessionId,
    corpusId,
    analysisId,
    stageKey,
    jobId,
    status,
    toJsonbParam(payload, {}),
    now,
    now,
  ]);

  return pgGetExecutionStageOutput(sessionId, stageKey);
}

export async function pgRecoverExecutionSessions() {
  await bootstrapPostgres();
  const now = Date.now();
  await queryPostgres(`
    UPDATE analysis_execution_sessions
    SET status = 'failed',
        error_message = COALESCE(error_message, 'Execution session expired'),
        released_at = $1,
        updated_at = $1
    WHERE status IN ('pending', 'running')
      AND lease_expires_at <= $1
  `, [now]);

  await queryPostgres(`
    UPDATE analysis_execution_sessions
    SET status = CASE
      WHEN status = 'running' THEN 'pending'
      ELSE status
    END,
        current_job_id = NULL,
        last_heartbeat_at = $1,
        lease_expires_at = CASE
          WHEN status IN ('pending', 'running') THEN $2
          ELSE lease_expires_at
        END,
        updated_at = $1
    WHERE status IN ('pending', 'running')
  `, [now, now + (30 * 60 * 1000)]);
}

export async function pgCountActiveJobs() {
  await bootstrapPostgres();
  return pgCountQueuedAndRunningJobs();
}

export async function pgLoadRunnablePendingJobs(limit = 100) {
  await bootstrapPostgres();
  return pgListRunnablePendingJobs(limit);
}
