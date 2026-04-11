import { bootstrapPostgres } from './bootstrap.js';
import {
  ensurePostgresBootstrapped,
  hasPostgresDatabase,
  queryPostgres,
  withPostgresTransaction,
} from './client.js';

const warnedKeys = new Set();

function warnOnce(key, error) {
  if (warnedKeys.has(key)) {
    return;
  }
  warnedKeys.add(key);
  console.warn(`[postgres-mirror] ${key} failed: ${error?.message || error}`);
}

function isJsonString(value) {
  if (typeof value !== 'string') {
    return false;
  }
  const trimmed = value.trim();
  return trimmed.startsWith('{') || trimmed.startsWith('[');
}

function parseJsonish(value) {
  if (value == null) {
    return null;
  }
  if (typeof value === 'object') {
    return value;
  }
  if (!isJsonString(value)) {
    return null;
  }
  try {
    return JSON.parse(value);
  } catch {
    return null;
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

function schedule(label, task) {
  if (!hasPostgresDatabase()) {
    return;
  }

  Promise.resolve()
    .then(() => ensurePostgresBootstrapped(bootstrapPostgres))
    .then(() => task())
    .catch((error) => warnOnce(label, error));
}

export function mirrorCorpusGraph({ corpus, chapters = [], chunks = [] } = {}) {
  schedule('mirrorCorpusGraph', async () => {
    await withPostgresTransaction(async (client) => {
      await client.query(`
        INSERT INTO corpuses (
          id, title, author, source_file, file_type, fandom, fandom_confidence,
          is_canon_fanfic, rating, language, chunk_size, chunk_size_used, chunk_count,
          last_rechunked_at, word_count, chapter_count, status, created_at, updated_at
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19
        )
        ON CONFLICT (id) DO UPDATE SET
          title = EXCLUDED.title,
          author = EXCLUDED.author,
          source_file = EXCLUDED.source_file,
          file_type = EXCLUDED.file_type,
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
          chunk.text,
          chunk.wordCount ?? 0,
          chunk.startPosition ?? null,
          chunk.startWord ?? null,
          chunk.endWord ?? null,
        ]);
      }
    });
  });
}

export function mirrorCorpusRecord(corpus) {
  if (!corpus?.id) {
    return;
  }

  schedule('mirrorCorpusRecord', async () => {
    await queryPostgres(`
      INSERT INTO corpuses (
        id, title, author, source_file, file_type, fandom, fandom_confidence,
        is_canon_fanfic, rating, language, chunk_size, chunk_size_used, chunk_count,
        last_rechunked_at, word_count, chapter_count, status, created_at, updated_at
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19
      )
      ON CONFLICT (id) DO UPDATE SET
        title = EXCLUDED.title,
        author = EXCLUDED.author,
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
  });
}

export function mirrorCorpusDelete(corpusId) {
  schedule('mirrorCorpusDelete', async () => {
    await queryPostgres('DELETE FROM corpuses WHERE id = $1', [corpusId]);
  });
}

export function mirrorAnalysisRecord(analysis) {
  if (!analysis?.id) {
    return;
  }

  schedule('mirrorAnalysisRecord', async () => {
    await queryPostgres(`
      INSERT INTO corpus_analyses (
        id, corpus_id, chunk_size, chunk_overlap, provider, model, temperature,
        status, level_0_status, level_1_status, level_2_status,
        result_l1, result_l2, result_l3, result_l4, result_l5, result_l6, final_result,
        analysis_run_manifest, pass_status, degraded_run_report, graph_summary, artifact_version,
        total_chunks, processed_chunks, progress, current_phase, parts_generated,
        error_message, created_at, started_at, completed_at
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,
        $19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32
      )
      ON CONFLICT (id) DO UPDATE SET
        chunk_size = EXCLUDED.chunk_size,
        chunk_overlap = EXCLUDED.chunk_overlap,
        provider = EXCLUDED.provider,
        model = EXCLUDED.model,
        temperature = EXCLUDED.temperature,
        status = EXCLUDED.status,
        level_0_status = EXCLUDED.level_0_status,
        level_1_status = EXCLUDED.level_1_status,
        level_2_status = EXCLUDED.level_2_status,
        result_l1 = EXCLUDED.result_l1,
        result_l2 = EXCLUDED.result_l2,
        result_l3 = EXCLUDED.result_l3,
        result_l4 = EXCLUDED.result_l4,
        result_l5 = EXCLUDED.result_l5,
        result_l6 = EXCLUDED.result_l6,
        final_result = EXCLUDED.final_result,
        analysis_run_manifest = EXCLUDED.analysis_run_manifest,
        pass_status = EXCLUDED.pass_status,
        degraded_run_report = EXCLUDED.degraded_run_report,
        graph_summary = EXCLUDED.graph_summary,
        artifact_version = EXCLUDED.artifact_version,
        total_chunks = EXCLUDED.total_chunks,
        processed_chunks = EXCLUDED.processed_chunks,
        progress = EXCLUDED.progress,
        current_phase = EXCLUDED.current_phase,
        parts_generated = EXCLUDED.parts_generated,
        error_message = EXCLUDED.error_message,
        started_at = EXCLUDED.started_at,
        completed_at = EXCLUDED.completed_at
    `, [
      analysis.id,
      analysis.corpusId,
      analysis.chunkSize ?? null,
      analysis.chunkOverlap ?? null,
      analysis.provider ?? null,
      analysis.model ?? null,
      analysis.temperature ?? null,
      analysis.status ?? null,
      analysis.level0Status ?? null,
      analysis.level1Status ?? null,
      analysis.level2Status ?? null,
      analysis.resultL1 ?? null,
      analysis.resultL2 ?? null,
      analysis.resultL3 ?? null,
      analysis.resultL4 ?? null,
      analysis.resultL5 ?? null,
      analysis.resultL6 ?? null,
      analysis.finalResult ?? null,
      parseJsonish(analysis.analysisRunManifest),
      parseJsonish(analysis.passStatus),
      parseJsonish(analysis.degradedRunReport),
      parseJsonish(analysis.graphSummary),
      analysis.artifactVersion ?? 'legacy',
      analysis.totalChunks ?? 0,
      analysis.processedChunks ?? 0,
      analysis.progress ?? 0,
      analysis.currentPhase ?? null,
      analysis.partsGenerated ?? 0,
      analysis.errorMessage ?? null,
      analysis.createdAt ?? Date.now(),
      analysis.startedAt ?? null,
      analysis.completedAt ?? null,
    ]);
  });
}

export function mirrorChunkResult(row) {
  if (!row?.id) {
    return;
  }

  schedule('mirrorChunkResult', async () => {
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
      row.id,
      row.analysisId,
      row.chunkIndex ?? 0,
      row.chapterId ?? null,
      row.processingTimeMs ?? null,
      row.inputTokens ?? null,
      row.outputTokens ?? null,
      row.result ?? null,
      row.error ?? null,
      row.startedAt ?? null,
      row.completedAt ?? null,
      row.createdAt ?? Date.now(),
    ]);
  });
}

export function mirrorIncidentFirstArtifacts({
  analysisId,
  corpusId,
  incidents = [],
  events = [],
  locations = [],
  consistencyRisks = [],
  reviewQueue = [],
} = {}) {
  if (!analysisId || !corpusId) {
    return;
  }

  schedule('mirrorIncidentFirstArtifacts', async () => {
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
          item.id, item.corpusId, item.analysisId, item.title, item.type, item.description ?? null,
          item.startChapterId ?? null, item.startChunkId ?? null, item.endChapterId ?? null, item.endChunkId ?? null,
          item.chapterStartIndex ?? null, item.chapterEndIndex ?? null, item.chunkStartIndex ?? null, item.chunkEndIndex ?? null,
          item.chapterStartNumber ?? null, item.chapterEndNumber ?? null, item.startAnchor ?? null, item.activeSpan ?? null,
          item.climaxAnchor ?? null, item.endAnchor ?? null, item.boundaryNote ?? null, Boolean(item.uncertainStart),
          Boolean(item.uncertainEnd), item.confidence ?? 0, item.evidence ? JSON.stringify(item.evidence) : null,
          item.containedEvents ? JSON.stringify(item.containedEvents) : null,
          item.subIncidentIds ? JSON.stringify(item.subIncidentIds) : null,
          item.relatedIncidents ? JSON.stringify(item.relatedIncidents) : null,
          item.relatedLocations ? JSON.stringify(item.relatedLocations) : null,
          item.causalPredecessors ? JSON.stringify(item.causalPredecessors) : null,
          item.causalSuccessors ? JSON.stringify(item.causalSuccessors) : null,
          item.majorScore ?? 0, item.impactScore ?? 0, item.status ?? null, item.reviewStatus ?? null,
          item.priority ?? null, item.provenance ?? null, item.createdAt ?? Date.now(), item.analyzedAt ?? null, item.reviewedAt ?? null,
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
          item.id, item.corpusId, item.analysisId, item.title, item.description ?? null, item.severity ?? 0,
          item.tags ? JSON.stringify(item.tags) : null, item.chapterId ?? null, item.chapterIndex ?? null,
          item.chapterNumber ?? null, item.chunkId ?? null, item.chunkIndex ?? null, item.incidentId ?? null,
          item.linkRole ?? 'primary', item.secondaryIncidentIds ? JSON.stringify(item.secondaryIncidentIds) : null,
          item.locationLink ? JSON.stringify(item.locationLink) : null, item.causalLinks ? JSON.stringify(item.causalLinks) : null,
          item.confidence ?? 0, item.evidence ? JSON.stringify(item.evidence) : null, item.qualityProxy ?? 0,
          item.reviewStatus ?? null, Boolean(item.needsReview), item.annotation ?? null, item.provenance ?? null,
          item.createdAt ?? Date.now(), item.groundedAt ?? null, item.reviewedAt ?? null,
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
          item.id, item.corpusId, item.analysisId, item.name, item.normalized ?? null,
          item.aliases ? JSON.stringify(item.aliases) : null, item.mentionCount ?? 0,
          item.chapterStart ?? null, item.chapterEnd ?? null, item.chapterStartNumber ?? null, item.chapterEndNumber ?? null,
          item.chapterSpread ? JSON.stringify(item.chapterSpread) : null, item.importance ?? 0, Boolean(item.isMajor),
          item.tokens ? JSON.stringify(item.tokens) : null, item.evidence ? JSON.stringify(item.evidence) : null,
          item.incidentIds ? JSON.stringify(item.incidentIds) : null, item.eventIds ? JSON.stringify(item.eventIds) : null,
          item.confidence ?? 0, item.evidenceStrength ?? 0, item.reviewStatus ?? null, item.provenance ?? null,
          item.createdAt ?? Date.now(), item.reviewedAt ?? null,
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
          item.id, item.corpusId, item.analysisId, item.type, item.severity, item.description ?? null,
          item.details ? JSON.stringify(item.details) : null, item.involvedIncidents ? JSON.stringify(item.involvedIncidents) : null,
          item.involvedEvents ? JSON.stringify(item.involvedEvents) : null, item.involvedLocations ? JSON.stringify(item.involvedLocations) : null,
          item.evidence ? JSON.stringify(item.evidence) : null, item.chapterStart ?? null, item.chapterEnd ?? null,
          Boolean(item.resolved), item.resolution ?? null, item.resolvedAt ?? null, item.detectedAt ?? Date.now(),
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
          item.id, item.corpusId, item.analysisId, item.itemType, item.itemId, item.priority,
          item.priorityScore ?? 0, item.scoreBreakdown ? JSON.stringify(item.scoreBreakdown) : null,
          item.reason ?? null, item.suggestions ? JSON.stringify(item.suggestions) : null, item.status ?? 'pending',
          item.reviewedBy ?? null, item.reviewedAt ?? null, item.resolution ?? null, item.createdAt ?? Date.now(),
        ]);
      }
    });
  });
}

export function mirrorStoryGraph({
  analysisId,
  corpusId,
  graph,
  passStatus,
} = {}) {
  if (!analysisId || !corpusId || !graph) {
    return;
  }

  schedule('mirrorStoryGraph', async () => {
    const nodes = Array.isArray(graph.nodes) ? graph.nodes : [];
    const edges = Array.isArray(graph.edges) ? graph.edges : [];
    const passEntries = Object.values(passStatus || {});

    await withPostgresTransaction(async (client) => {
      await client.query('DELETE FROM analysis_pass_reports WHERE analysis_id = $1', [analysisId]);
      await client.query('DELETE FROM analysis_graph_edges WHERE analysis_id = $1', [analysisId]);
      await client.query('DELETE FROM analysis_graph_nodes WHERE analysis_id = $1', [analysisId]);

      for (const node of nodes) {
        await client.query(`
          INSERT INTO analysis_graph_nodes (
            id, corpus_id, analysis_id, node_type, label, confidence, chapter_number, payload, created_at
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
        `, [
          buildGraphStorageId(analysisId, node.id),
          corpusId,
          analysisId,
          node.type || 'unknown',
          node.label || node.id,
          node.confidence ?? 0,
          node.chapterNumber ?? node.chapter ?? null,
          node,
          Date.now(),
        ]);
      }

      for (const edge of edges) {
        await client.query(`
          INSERT INTO analysis_graph_edges (
            id, corpus_id, analysis_id, edge_type, from_node_id, to_node_id, confidence,
            source_pass, review_status, payload, created_at
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
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
          edge,
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
          pass,
          Date.now(),
        ]);
      }
    });
  });
}

export function mirrorJobRecord(job) {
  if (!job?.id) {
    return;
  }

  schedule('mirrorJobRecord', async () => {
    await queryPostgres(`
      INSERT INTO jobs (
        id, type, status, progress, progress_message, input_data, output_data, error_message,
        error_stack, created_at, updated_at, started_at, completed_at, priority, worker_id
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15
      )
      ON CONFLICT (id) DO UPDATE SET
        type = EXCLUDED.type,
        status = EXCLUDED.status,
        progress = EXCLUDED.progress,
        progress_message = EXCLUDED.progress_message,
        input_data = EXCLUDED.input_data,
        output_data = EXCLUDED.output_data,
        error_message = EXCLUDED.error_message,
        error_stack = EXCLUDED.error_stack,
        updated_at = EXCLUDED.updated_at,
        started_at = EXCLUDED.started_at,
        completed_at = EXCLUDED.completed_at,
        priority = EXCLUDED.priority,
        worker_id = EXCLUDED.worker_id
    `, [
      job.id,
      job.type,
      job.status,
      job.progress ?? 0,
      job.progressMessage ?? null,
      job.inputData ? JSON.stringify(job.inputData) : null,
      job.outputData ? JSON.stringify(job.outputData) : null,
      job.errorMessage ?? null,
      job.errorStack ?? null,
      job.createdAt ?? Date.now(),
      job.updatedAt ?? Date.now(),
      job.startedAt ?? null,
      job.completedAt ?? null,
      job.priority ?? 0,
      job.workerId ?? null,
    ]);
  });
}

export function mirrorJobStep(step) {
  if (!step?.id) {
    return;
  }

  schedule('mirrorJobStep', async () => {
    await queryPostgres(`
      INSERT INTO job_steps (id, job_id, step_name, status, progress, message)
      VALUES ($1,$2,$3,$4,$5,$6)
      ON CONFLICT (id) DO UPDATE SET
        status = EXCLUDED.status,
        progress = EXCLUDED.progress,
        message = EXCLUDED.message
    `, [
      step.id,
      step.jobId,
      step.stepName,
      step.status ?? 'pending',
      step.progress ?? 0,
      step.message ?? null,
    ]);
  });
}

export function mirrorJobDependencies(jobId, dependsOn = []) {
  if (!jobId || !Array.isArray(dependsOn)) {
    return;
  }

  schedule('mirrorJobDependencies', async () => {
    await withPostgresTransaction(async (client) => {
      await client.query('DELETE FROM job_dependencies WHERE job_id = $1', [jobId]);
      for (const dependencyId of dependsOn) {
        await client.query(`
          INSERT INTO job_dependencies (id, job_id, depends_on_job_id)
          VALUES ($1,$2,$3)
        `, [`${jobId}:${dependencyId}`, jobId, dependencyId]);
      }
    });
  });
}
