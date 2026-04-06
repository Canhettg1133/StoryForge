import {
  queryPostgres,
} from './client.js';

function toNumber(value, fallback = null) {
  if (value == null) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

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

function mapCorpus(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    author: row.author,
    sourceFile: row.source_file,
    fileType: row.file_type,
    frontMatter: parseJsonish(row.front_matter, null),
    parseDiagnostics: parseJsonish(row.parse_diagnostics, null),
    fandom: row.fandom,
    fandomConfidence: toNumber(row.fandom_confidence),
    isCanonFanfic: row.is_canon_fanfic,
    rating: row.rating,
    language: row.language,
    chunkSize: toNumber(row.chunk_size),
    chunkSizeUsed: toNumber(row.chunk_size_used),
    chunkCount: toNumber(row.chunk_count, 0),
    lastRechunkedAt: toNumber(row.last_rechunked_at),
    wordCount: toNumber(row.word_count, 0),
    chapterCount: toNumber(row.chapter_count, 0),
    status: row.status,
    createdAt: toNumber(row.created_at),
    updatedAt: toNumber(row.updated_at),
  };
}

function mapChapter(row, includeContent = false) {
  if (!row) return null;
  const chapter = {
    id: row.id,
    corpusId: row.corpus_id,
    index: toNumber(row.chapter_index, 0),
    title: row.title,
    wordCount: toNumber(row.word_count, 0),
    startLine: toNumber(row.start_line),
    endLine: toNumber(row.end_line),
    startPage: toNumber(row.start_page),
    endPage: toNumber(row.end_page),
  };
  if (includeContent) {
    chapter.content = row.content || '';
  }
  return chapter;
}

function mapChunk(row) {
  if (!row) return null;
  return {
    id: row.id,
    chapterId: row.chapter_id,
    corpusId: row.corpus_id,
    index: toNumber(row.chunk_index, 0),
    text: row.text || '',
    wordCount: toNumber(row.word_count, 0),
    startPosition: toNumber(row.start_position),
    startWord: row.start_word,
    endWord: row.end_word,
  };
}

function mapAnalysis(row) {
  if (!row) return null;
  return {
    id: row.id,
    corpusId: row.corpus_id,
    chunkSize: toNumber(row.chunk_size),
    chunkOverlap: toNumber(row.chunk_overlap),
    provider: row.provider,
    model: row.model,
    temperature: toNumber(row.temperature),
    status: row.status,
    level0Status: row.level_0_status,
    level1Status: row.level_1_status,
    level2Status: row.level_2_status,
    resultL1: row.result_l1,
    resultL2: row.result_l2,
    resultL3: row.result_l3,
    resultL4: row.result_l4,
    resultL5: row.result_l5,
    resultL6: row.result_l6,
    finalResult: row.final_result,
    analysisRunManifest: parseJsonish(row.analysis_run_manifest, row.analysis_run_manifest),
    passStatus: parseJsonish(row.pass_status, row.pass_status),
    degradedRunReport: parseJsonish(row.degraded_run_report, row.degraded_run_report),
    graphSummary: parseJsonish(row.graph_summary, row.graph_summary),
    artifactVersion: row.artifact_version || 'legacy',
    totalChunks: toNumber(row.total_chunks, 0),
    processedChunks: toNumber(row.processed_chunks, 0),
    progress: toNumber(row.progress, 0),
    currentPhase: row.current_phase,
    partsGenerated: toNumber(row.parts_generated, 0),
    errorMessage: row.error_message,
    createdAt: toNumber(row.created_at),
    startedAt: toNumber(row.started_at),
    completedAt: toNumber(row.completed_at),
  };
}

function mapChunkResult(row) {
  if (!row) return null;
  return {
    id: row.id,
    analysisId: row.analysis_id,
    chunkIndex: toNumber(row.chunk_index, 0),
    chapterId: row.chapter_id,
    processingTimeMs: toNumber(row.processing_time_ms),
    inputTokens: toNumber(row.input_tokens),
    outputTokens: toNumber(row.output_tokens),
    result: row.result,
    error: row.error,
    startedAt: toNumber(row.started_at),
    completedAt: toNumber(row.completed_at),
    createdAt: toNumber(row.created_at),
  };
}

function mapIncident(row) {
  if (!row) return null;
  return {
    id: row.id,
    corpusId: row.corpus_id,
    analysisId: row.analysis_id,
    title: row.title,
    type: row.type,
    description: row.description,
    startChapterId: row.start_chapter_id,
    startChunkId: row.start_chunk_id,
    endChapterId: row.end_chapter_id,
    endChunkId: row.end_chunk_id,
    chapterStartIndex: toNumber(row.chapter_start_index),
    chapterEndIndex: toNumber(row.chapter_end_index),
    chunkStartIndex: toNumber(row.chunk_start_index),
    chunkEndIndex: toNumber(row.chunk_end_index),
    chapterStartNumber: toNumber(row.chapter_start_number),
    chapterEndNumber: toNumber(row.chapter_end_number),
    chapterStart: toNumber(row.chapter_start_number, toNumber(row.chapter_start_index)),
    chapterEnd: toNumber(row.chapter_end_number, toNumber(row.chapter_end_index)),
    startAnchor: parseJsonish(row.start_anchor, null),
    activeSpan: toNumber(row.active_span, 0),
    climaxAnchor: parseJsonish(row.climax_anchor, null),
    endAnchor: parseJsonish(row.end_anchor, null),
    boundaryNote: row.boundary_note,
    uncertainStart: Boolean(row.uncertain_start),
    uncertainEnd: Boolean(row.uncertain_end),
    confidence: toNumber(row.confidence, 0),
    evidence: parseJsonish(row.evidence, []),
    containedEvents: parseJsonish(row.contained_events, []),
    subIncidentIds: parseJsonish(row.sub_incident_ids, []),
    relatedIncidents: parseJsonish(row.related_incidents, []),
    relatedLocations: parseJsonish(row.related_locations, []),
    causalPredecessors: parseJsonish(row.causal_predecessors, []),
    causalSuccessors: parseJsonish(row.causal_successors, []),
    majorScore: toNumber(row.major_score, 0),
    impactScore: toNumber(row.impact_score, 0),
    status: row.status,
    reviewStatus: row.review_status,
    priority: row.priority,
    provenance: parseJsonish(row.provenance, null),
    createdAt: toNumber(row.created_at),
    analyzedAt: toNumber(row.analyzed_at),
    reviewedAt: toNumber(row.reviewed_at),
  };
}

function mapAnalysisEvent(row) {
  if (!row) return null;
  return {
    id: row.id,
    corpusId: row.corpus_id,
    analysisId: row.analysis_id,
    title: row.title,
    description: row.description,
    severity: toNumber(row.severity, 0),
    tags: parseJsonish(row.tags, []),
    chapterId: row.chapter_id,
    chapterIndex: toNumber(row.chapter_index),
    chapterNumber: toNumber(row.chapter_number),
    chapter: toNumber(row.chapter_number, toNumber(row.chapter_index)),
    chunkId: row.chunk_id,
    chunkIndex: toNumber(row.chunk_index),
    incidentId: row.incident_id,
    linkRole: row.link_role,
    secondaryIncidentIds: parseJsonish(row.secondary_incident_ids, []),
    locationLink: parseJsonish(row.location_link, null),
    causalLinks: parseJsonish(row.causal_links, { causes: [], causedBy: [] }),
    confidence: toNumber(row.confidence, 0),
    evidence: parseJsonish(row.evidence, []),
    qualityProxy: toNumber(row.quality_proxy, 0),
    reviewStatus: row.review_status,
    needsReview: Boolean(row.needs_review),
    annotation: row.annotation,
    provenance: parseJsonish(row.provenance, null),
    createdAt: toNumber(row.created_at),
    groundedAt: toNumber(row.grounded_at),
    reviewedAt: toNumber(row.reviewed_at),
  };
}

function mapAnalysisLocation(row) {
  if (!row) return null;
  return {
    id: row.id,
    corpusId: row.corpus_id,
    analysisId: row.analysis_id,
    name: row.name,
    normalized: row.normalized,
    aliases: parseJsonish(row.aliases, []),
    mentionCount: toNumber(row.mention_count, 0),
    chapterStart: toNumber(row.chapter_start_number, toNumber(row.chapter_start)),
    chapterEnd: toNumber(row.chapter_end_number, toNumber(row.chapter_end)),
    chapterSpread: parseJsonish(row.chapter_spread, [null, null]),
    importance: toNumber(row.importance, 0),
    isMajor: Boolean(row.is_major),
    tokens: parseJsonish(row.tokens, []),
    evidence: parseJsonish(row.evidence, []),
    incidentIds: parseJsonish(row.incident_ids, []),
    eventIds: parseJsonish(row.event_ids, []),
    confidence: toNumber(row.confidence, 0),
    evidenceStrength: toNumber(row.evidence_strength, 0),
    reviewStatus: row.review_status,
    provenance: parseJsonish(row.provenance, null),
    createdAt: toNumber(row.created_at),
    reviewedAt: toNumber(row.reviewed_at),
  };
}

function mapConsistencyRisk(row) {
  if (!row) return null;
  return {
    id: row.id,
    corpusId: row.corpus_id,
    analysisId: row.analysis_id,
    type: row.type,
    severity: row.severity,
    description: row.description,
    details: parseJsonish(row.details, {}),
    involvedIncidents: parseJsonish(row.involved_incidents, []),
    involvedEvents: parseJsonish(row.involved_events, []),
    involvedLocations: parseJsonish(row.involved_locations, []),
    evidence: parseJsonish(row.evidence, []),
    chapterStart: toNumber(row.chapter_start),
    chapterEnd: toNumber(row.chapter_end),
    resolved: Boolean(row.resolved),
    resolution: row.resolution,
    resolvedAt: toNumber(row.resolved_at),
    detectedAt: toNumber(row.detected_at),
  };
}

function mapReviewQueueItem(row) {
  if (!row) return null;
  return {
    id: row.id,
    corpusId: row.corpus_id,
    analysisId: row.analysis_id,
    itemType: row.item_type,
    itemId: row.item_id,
    priority: row.priority,
    priorityScore: toNumber(row.priority_score, 0),
    scoreBreakdown: parseJsonish(row.score_breakdown, {}),
    reason: parseJsonish(row.reason, []),
    suggestions: parseJsonish(row.suggestions, []),
    status: row.status,
    reviewedBy: row.reviewed_by,
    reviewedAt: toNumber(row.reviewed_at),
    resolution: row.resolution,
    createdAt: toNumber(row.created_at),
  };
}

function mapJobRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    type: row.type,
    status: row.status,
    progress: toNumber(row.progress, 0),
    progressMessage: row.progress_message,
    inputData: parseJsonish(row.input_data, null),
    outputData: parseJsonish(row.output_data, null),
    errorMessage: row.error_message,
    errorStack: row.error_stack,
    createdAt: toNumber(row.created_at),
    updatedAt: toNumber(row.updated_at),
    startedAt: toNumber(row.started_at),
    completedAt: toNumber(row.completed_at),
    priority: toNumber(row.priority, 0),
    workerId: row.worker_id,
  };
}

function mapStepRow(row) {
  return {
    id: row.id,
    name: row.step_name,
    status: row.status,
    progress: toNumber(row.progress, 0),
    message: row.message,
  };
}

function mapGraphNode(row) {
  const payload = parseJsonish(row.payload, {});
  return {
    ...payload,
    id: row.id,
    type: payload.type || row.node_type,
    label: payload.label || row.label,
    confidence: payload.confidence ?? toNumber(row.confidence, 0),
    chapterNumber: payload.chapterNumber ?? toNumber(row.chapter_number),
  };
}

function mapGraphEdge(row) {
  const payload = parseJsonish(row.payload, {});
  return {
    ...payload,
    id: row.id,
    type: payload.type || row.edge_type,
    from: payload.from || row.from_node_id,
    to: payload.to || row.to_node_id,
    confidence: payload.confidence ?? toNumber(row.confidence, 0),
    sourcePass: payload.sourcePass || row.source_pass,
    reviewStatus: payload.reviewStatus || row.review_status,
  };
}

function mapProjectSnapshot(row) {
  if (!row) return null;
  return {
    id: row.id,
    project_id: row.project_id,
    corpus_id: row.corpus_id,
    analysis_id: row.analysis_id,
    status: row.status,
    layers: parseJsonish(row.layers, []),
    result_json: parseJsonish(row.result_json, null),
    summary: parseJsonish(row.summary, {}),
    artifact_version: row.artifact_version || 'v2',
    created_at: toNumber(row.created_at),
    updated_at: toNumber(row.updated_at),
  };
}

async function safeQuery(text, params = []) {
  return queryPostgres(text, params);
}

export async function pgGetCorpusById(corpusId, options = {}) {
  const includeChapterContent = options.includeChapterContent === true;
  const corpusResult = await safeQuery('SELECT * FROM corpuses WHERE id = $1 LIMIT 1', [corpusId]);
  const corpusRow = corpusResult?.rows?.[0];
  if (!corpusRow) return null;

  const chapterColumns = includeChapterContent
    ? '*'
    : 'id, corpus_id, chapter_index, title, word_count, start_line, end_line, start_page, end_page';
  const chapterResult = await safeQuery(
    `SELECT ${chapterColumns} FROM chapters WHERE corpus_id = $1 ORDER BY chapter_index ASC`,
    [corpusId],
  );

  return {
    ...mapCorpus(corpusRow),
    chapters: (chapterResult?.rows || []).map((row) => mapChapter(row, includeChapterContent)),
  };
}

export async function pgListCorpuses({ fandom, status, search, limit = 20, offset = 0 } = {}) {
  const where = [];
  const params = [];

  if (fandom) {
    params.push(fandom);
    where.push(`fandom = $${params.length}`);
  }
  if (status) {
    params.push(status);
    where.push(`status = $${params.length}`);
  }
  if (search) {
    params.push(`%${search}%`);
    where.push(`(title ILIKE $${params.length} OR author ILIKE $${params.length} OR source_file ILIKE $${params.length})`);
  }

  const safeLimit = Math.max(1, Math.min(100, Number(limit) || 20));
  const safeOffset = Math.max(0, Number(offset) || 0);
  params.push(safeLimit);
  params.push(safeOffset);

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const result = await safeQuery(
    `SELECT * FROM corpuses ${whereSql} ORDER BY created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  const countParams = params.slice(0, params.length - 2);
  const countResult = await safeQuery(
    `SELECT COUNT(*) AS total FROM corpuses ${where.length ? `WHERE ${where.join(' AND ')}` : ''}`,
    countParams,
  );

  return {
    corpuses: (result?.rows || []).map(mapCorpus),
    total: toNumber(countResult?.rows?.[0]?.total, 0),
    limit: safeLimit,
    offset: safeOffset,
  };
}

export async function pgGetChapterById(corpusId, chapterId) {
  const chapterResult = await safeQuery(
    'SELECT * FROM chapters WHERE id = $1 AND corpus_id = $2 LIMIT 1',
    [chapterId, corpusId],
  );
  const chapterRow = chapterResult?.rows?.[0];
  if (!chapterRow) return null;

  const chunkResult = await safeQuery(
    'SELECT * FROM chunks WHERE chapter_id = $1 AND corpus_id = $2 ORDER BY chunk_index ASC',
    [chapterId, corpusId],
  );

  return {
    ...mapChapter(chapterRow, true),
    chunks: (chunkResult?.rows || []).map(mapChunk),
  };
}

export async function pgGetAnalysisById(analysisId) {
  const result = await safeQuery('SELECT * FROM corpus_analyses WHERE id = $1 LIMIT 1', [analysisId]);
  return mapAnalysis(result?.rows?.[0]);
}

export async function pgListAnalysesByCorpus(corpusId, { limit = 20, offset = 0 } = {}) {
  const safeLimit = Math.max(1, Math.min(100, Number(limit) || 20));
  const safeOffset = Math.max(0, Number(offset) || 0);
  const rows = await safeQuery(
    'SELECT * FROM corpus_analyses WHERE corpus_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3',
    [corpusId, safeLimit, safeOffset],
  );
  const total = await safeQuery(
    'SELECT COUNT(*) AS total FROM corpus_analyses WHERE corpus_id = $1',
    [corpusId],
  );
  return {
    analyses: (rows?.rows || []).map(mapAnalysis),
    total: toNumber(total?.rows?.[0]?.total, 0),
    limit: safeLimit,
    offset: safeOffset,
  };
}

export async function pgListChunkResultsByAnalysis(analysisId) {
  const result = await safeQuery(
    'SELECT * FROM chunk_results WHERE analysis_id = $1 ORDER BY chunk_index ASC',
    [analysisId],
  );
  return (result?.rows || []).map(mapChunkResult);
}

export async function pgListCorpusChunksForAnalysis(corpusId) {
  const result = await safeQuery(`
    SELECT
      chunks.id,
      chunks.chapter_id,
      chunks.chunk_index,
      chunks.text,
      chunks.word_count,
      chunks.start_position,
      chapters.chapter_index
    FROM chunks
    INNER JOIN chapters ON chapters.id = chunks.chapter_id
    WHERE chunks.corpus_id = $1
    ORDER BY
      CASE WHEN chunks.start_position IS NULL THEN 1 ELSE 0 END ASC,
      chunks.start_position ASC,
      chapters.chapter_index ASC,
      chunks.chunk_index ASC
  `, [corpusId]);

  return (result?.rows || []).map((row) => ({
    id: row.id,
    chapterId: row.chapter_id,
    chapterIndex: toNumber(row.chapter_index, 0),
    chunkIndex: toNumber(row.chunk_index, 0),
    text: row.text || '',
    wordCount: toNumber(row.word_count, 0),
    startPosition: toNumber(row.start_position),
  }));
}

export async function pgGetLatestAnalysisIdForCorpus(corpusId, options = {}) {
  const includeNonTerminal = options.includeNonTerminal === true;
  const result = includeNonTerminal
    ? await safeQuery(
      'SELECT id FROM corpus_analyses WHERE corpus_id = $1 ORDER BY created_at DESC LIMIT 1',
      [corpusId],
    )
    : await safeQuery(`
      SELECT id
      FROM corpus_analyses
      WHERE corpus_id = $1
        AND status IN ('completed', 'processing', 'pending')
      ORDER BY
        CASE status
          WHEN 'completed' THEN 0
          WHEN 'processing' THEN 1
          WHEN 'pending' THEN 2
          ELSE 3
        END ASC,
        created_at DESC
      LIMIT 1
    `, [corpusId]);

  return result?.rows?.[0]?.id || null;
}

export async function pgListIncidentsByAnalysis(analysisId) {
  const result = await safeQuery(
    'SELECT * FROM incidents WHERE analysis_id = $1 ORDER BY COALESCE(chapter_start_number, chapter_start_index, 999999) ASC, confidence DESC',
    [analysisId],
  );
  return (result?.rows || []).map(mapIncident);
}

export async function pgGetIncidentById(incidentId) {
  const result = await safeQuery('SELECT * FROM incidents WHERE id = $1 LIMIT 1', [incidentId]);
  return mapIncident(result?.rows?.[0]);
}

export async function pgListAnalysisEventsByIncident(incidentId) {
  const result = await safeQuery(
    'SELECT * FROM analysis_events WHERE incident_id = $1 ORDER BY COALESCE(chapter_number, chapter_index, 999999) ASC, confidence DESC',
    [incidentId],
  );
  return (result?.rows || []).map(mapAnalysisEvent);
}

export async function pgListAnalysisLocationsByAnalysis(analysisId) {
  const result = await safeQuery(
    'SELECT * FROM analysis_locations WHERE analysis_id = $1 ORDER BY importance DESC, mention_count DESC',
    [analysisId],
  );
  return (result?.rows || []).map(mapAnalysisLocation);
}

export async function pgListConsistencyRisksByAnalysis(analysisId, options = {}) {
  const resolvedFilter = options.resolved;
  const hasResolvedFilter = resolvedFilter === true || resolvedFilter === false;
  const result = hasResolvedFilter
    ? await safeQuery(
      'SELECT * FROM consistency_risks WHERE analysis_id = $1 AND resolved = $2 ORDER BY detected_at DESC',
      [analysisId, resolvedFilter],
    )
    : await safeQuery(
      'SELECT * FROM consistency_risks WHERE analysis_id = $1 ORDER BY detected_at DESC',
      [analysisId],
    );
  return (result?.rows || []).map(mapConsistencyRisk);
}

export async function pgListReviewQueueByAnalysis(analysisId, options = {}) {
  const status = String(options.status || '').trim();
  const priority = String(options.priority || '').trim();
  const limit = Math.max(1, Math.min(500, Number(options.limit) || 200));
  const offset = Math.max(0, Number(options.offset) || 0);
  const params = [analysisId];
  const where = ['analysis_id = $1'];

  if (status) {
    params.push(status);
    where.push(`status = $${params.length}`);
  }
  if (['P0', 'P1', 'P2'].includes(priority)) {
    params.push(priority);
    where.push(`priority = $${params.length}`);
  }
  params.push(limit);
  params.push(offset);

  const result = await safeQuery(`
    SELECT *
    FROM review_queue
    WHERE ${where.join(' AND ')}
    ORDER BY
      CASE priority WHEN 'P0' THEN 0 WHEN 'P1' THEN 1 ELSE 2 END ASC,
      priority_score DESC,
      created_at DESC
    LIMIT $${params.length - 1} OFFSET $${params.length}
  `, params);
  return (result?.rows || []).map(mapReviewQueueItem);
}

export async function pgGetReviewQueueStatsByAnalysis(analysisId) {
  const result = await safeQuery(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN priority = 'P0' THEN 1 ELSE 0 END) AS p0,
      SUM(CASE WHEN priority = 'P1' THEN 1 ELSE 0 END) AS p1,
      SUM(CASE WHEN priority = 'P2' THEN 1 ELSE 0 END) AS p2,
      SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending
    FROM review_queue
    WHERE analysis_id = $1
  `, [analysisId]);
  const row = result?.rows?.[0];
  return {
    total: toNumber(row?.total, 0),
    P0: toNumber(row?.p0, 0),
    P1: toNumber(row?.p1, 0),
    P2: toNumber(row?.p2, 0),
    pending: toNumber(row?.pending, 0),
  };
}

export async function pgGetReviewQueueItemById(itemId) {
  const result = await safeQuery('SELECT * FROM review_queue WHERE id = $1 LIMIT 1', [itemId]);
  return mapReviewQueueItem(result?.rows?.[0]);
}

export async function pgGetStoryGraphByAnalysis(analysisId) {
  const nodeResult = await safeQuery(
    'SELECT * FROM analysis_graph_nodes WHERE analysis_id = $1 ORDER BY created_at ASC, id ASC',
    [analysisId],
  );
  const edgeResult = await safeQuery(
    'SELECT * FROM analysis_graph_edges WHERE analysis_id = $1 ORDER BY created_at ASC, id ASC',
    [analysisId],
  );

  const nodes = (nodeResult?.rows || []).map(mapGraphNode);
  const edges = (edgeResult?.rows || []).map(mapGraphEdge);
  if (!nodes.length && !edges.length) return null;

  return {
    nodes,
    edges,
    summary: {
      nodeCount: nodes.length,
      edgeCount: edges.length,
      edgeTypes: edges.reduce((acc, edge) => {
        const key = edge.type || 'unknown';
        acc[key] = (acc[key] || 0) + 1;
        return acc;
      }, {}),
    },
  };
}

export async function pgGetStoryGraphProvenance(analysisId, nodeId) {
  const graph = await pgGetStoryGraphByAnalysis(analysisId);
  if (!graph) return null;
  const node = graph.nodes.find((item) => item.id === nodeId);
  if (!node) return null;
  return {
    node,
    incoming: graph.edges.filter((edge) => edge.to === nodeId),
    outgoing: graph.edges.filter((edge) => edge.from === nodeId),
  };
}

export async function pgGetJobById(jobId) {
  const result = await safeQuery('SELECT * FROM jobs WHERE id = $1 LIMIT 1', [jobId]);
  const row = result?.rows?.[0];
  if (!row) return null;
  const steps = await safeQuery(
    'SELECT id, step_name, status, progress, message FROM job_steps WHERE job_id = $1 ORDER BY id ASC',
    [jobId],
  );
  return {
    ...mapJobRow(row),
    steps: (steps?.rows || []).map(mapStepRow),
  };
}

export async function pgListJobs({ status, type, limit = 20, offset = 0 } = {}) {
  const where = [];
  const params = [];
  if (status) {
    params.push(status);
    where.push(`status = $${params.length}`);
  }
  if (type) {
    params.push(type);
    where.push(`type = $${params.length}`);
  }

  const safeLimit = Math.max(1, Math.min(100, Number(limit) || 20));
  const safeOffset = Math.max(0, Number(offset) || 0);
  params.push(safeLimit);
  params.push(safeOffset);
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const rows = await safeQuery(
    `SELECT * FROM jobs ${whereSql} ORDER BY created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  const countResult = await safeQuery(
    `SELECT COUNT(*) AS total FROM jobs ${where.length ? `WHERE ${where.join(' AND ')}` : ''}`,
    params.slice(0, params.length - 2),
  );
  return {
    jobs: (rows?.rows || []).map(mapJobRow),
    total: toNumber(countResult?.rows?.[0]?.total, 0),
    limit: safeLimit,
    offset: safeOffset,
  };
}

export async function pgListRunnablePendingJobs(limit = 100) {
  const safeLimit = Math.max(1, Number(limit) || 100);
  const rows = await safeQuery(`
    SELECT j.*
    FROM jobs j
    WHERE j.status = $1
      AND NOT EXISTS (
        SELECT 1
        FROM job_dependencies d
        LEFT JOIN jobs dep ON dep.id = d.depends_on_job_id
        WHERE d.job_id = j.id
          AND (dep.status IS NULL OR dep.status != $2)
      )
    ORDER BY j.priority DESC, j.created_at ASC
    LIMIT $3
  `, ['pending', 'completed', safeLimit]);

  return (rows?.rows || []).map(mapJobRow);
}

export async function pgGetRunningJobStats() {
  const result = await safeQuery(`
    SELECT
      COUNT(*) AS running_count,
      SUM(
        CASE
          WHEN type IN ('corpus_analysis', 'incident_analysis', 'coherence_pass')
          THEN 1
          ELSE 0
        END
      ) AS running_analysis_count
    FROM jobs
    WHERE status = $1
  `, ['running']);
  const row = result?.rows?.[0];

  return {
    runningCount: toNumber(row?.running_count, 0),
    runningAnalysisCount: toNumber(row?.running_analysis_count, 0),
  };
}

export async function pgCountQueuedAndRunningJobs() {
  const result = await safeQuery(`
    SELECT COUNT(*) AS total
    FROM jobs
    WHERE status IN ($1, $2)
  `, ['pending', 'running']);

  return toNumber(result?.rows?.[0]?.total, 0);
}

export async function pgListProjectAnalysisSnapshots(projectId, limit = 30) {
  const safeLimit = Math.max(1, Math.min(100, Number(limit) || 30));
  const result = await safeQuery(
    'SELECT * FROM project_analysis_snapshots WHERE project_id = $1 ORDER BY updated_at DESC LIMIT $2',
    [String(projectId), safeLimit],
  );
  return (result?.rows || []).map(mapProjectSnapshot);
}

export async function pgGetProjectAnalysisSnapshot(projectId, analysisId) {
  const result = await safeQuery(
    'SELECT * FROM project_analysis_snapshots WHERE project_id = $1 AND analysis_id = $2 LIMIT 1',
    [String(projectId), String(analysisId)],
  );
  return mapProjectSnapshot(result?.rows?.[0]);
}
