import { getCorpusDb } from '../../corpus/db/schema.js';

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
  totalChunks: 'total_chunks',
  processedChunks: 'processed_chunks',
  progress: 'progress',
  currentPhase: 'current_phase',
  partsGenerated: 'parts_generated',
  errorMessage: 'error_message',
  startedAt: 'started_at',
  completedAt: 'completed_at',
};

function toNumber(value, fallback = null) {
  if (value == null) {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function mapAnalysis(row) {
  if (!row) {
    return null;
  }

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
  if (!row) {
    return null;
  }

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

export function createCorpusAnalysis(payload) {
  const db = getCorpusDb();
  const now = Date.now();

  db.prepare(`
    INSERT INTO corpus_analyses (
      id,
      corpus_id,
      chunk_size,
      chunk_overlap,
      provider,
      model,
      temperature,
      status,
      level_0_status,
      level_1_status,
      level_2_status,
      total_chunks,
      processed_chunks,
      progress,
      current_phase,
      parts_generated,
      error_message,
      created_at,
      started_at,
      completed_at
    ) VALUES (
      @id,
      @corpusId,
      @chunkSize,
      @chunkOverlap,
      @provider,
      @model,
      @temperature,
      @status,
      @level0Status,
      @level1Status,
      @level2Status,
      @totalChunks,
      @processedChunks,
      @progress,
      @currentPhase,
      @partsGenerated,
      @errorMessage,
      @createdAt,
      @startedAt,
      @completedAt
    )
  `).run({
    id: payload.id,
    corpusId: payload.corpusId,
    chunkSize: payload.chunkSize ?? 500000,
    chunkOverlap: payload.chunkOverlap ?? 0,
    provider: payload.provider ?? 'gemini_proxy',
    model: payload.model ?? null,
    temperature: payload.temperature ?? 0.2,
    status: payload.status ?? 'pending',
    level0Status: payload.level0Status ?? 'pending',
    level1Status: payload.level1Status ?? 'pending',
    level2Status: payload.level2Status ?? 'pending',
    totalChunks: payload.totalChunks ?? 1,
    processedChunks: payload.processedChunks ?? 0,
    progress: payload.progress ?? 0,
    currentPhase: payload.currentPhase ?? 'queued',
    partsGenerated: payload.partsGenerated ?? 0,
    errorMessage: payload.errorMessage ?? null,
    createdAt: payload.createdAt ?? now,
    startedAt: payload.startedAt ?? null,
    completedAt: payload.completedAt ?? null,
  });

  return getCorpusAnalysisById(payload.id);
}

export function updateCorpusAnalysis(analysisId, updates = {}) {
  const db = getCorpusDb();
  const setClauses = [];
  const params = {
    id: analysisId,
  };

  for (const [inputKey, inputValue] of Object.entries(updates || {})) {
    if (inputValue === undefined || !Object.prototype.hasOwnProperty.call(ANALYSIS_UPDATE_FIELDS, inputKey)) {
      continue;
    }

    const column = ANALYSIS_UPDATE_FIELDS[inputKey];
    setClauses.push(`${column} = @${inputKey}`);
    params[inputKey] = inputValue;
  }

  if (setClauses.length === 0) {
    return getCorpusAnalysisById(analysisId);
  }

  const result = db.prepare(`
    UPDATE corpus_analyses
    SET ${setClauses.join(', ')}
    WHERE id = @id
  `).run(params);

  if (result.changes === 0) {
    return null;
  }

  return getCorpusAnalysisById(analysisId);
}

export function getCorpusAnalysisById(analysisId) {
  const db = getCorpusDb();
  const row = db.prepare('SELECT * FROM corpus_analyses WHERE id = ?').get(analysisId);
  return mapAnalysis(row);
}

export function listCorpusAnalysesByCorpus(corpusId, { limit = 20, offset = 0 } = {}) {
  const db = getCorpusDb();
  const safeLimit = Math.max(1, Math.min(100, Number(limit) || 20));
  const safeOffset = Math.max(0, Number(offset) || 0);

  const rows = db.prepare(`
    SELECT *
    FROM corpus_analyses
    WHERE corpus_id = @corpusId
    ORDER BY created_at DESC
    LIMIT @limit OFFSET @offset
  `).all({
    corpusId,
    limit: safeLimit,
    offset: safeOffset,
  });

  const total = db
    .prepare('SELECT COUNT(*) AS total FROM corpus_analyses WHERE corpus_id = ?')
    .get(corpusId);

  return {
    analyses: rows.map(mapAnalysis),
    total: toNumber(total?.total, 0),
    limit: safeLimit,
    offset: safeOffset,
  };
}

export function insertChunkResult(payload) {
  const db = getCorpusDb();

  db.prepare(`
    INSERT INTO chunk_results (
      id,
      analysis_id,
      chunk_index,
      chapter_id,
      processing_time_ms,
      input_tokens,
      output_tokens,
      result,
      error,
      started_at,
      completed_at,
      created_at
    ) VALUES (
      @id,
      @analysisId,
      @chunkIndex,
      @chapterId,
      @processingTimeMs,
      @inputTokens,
      @outputTokens,
      @result,
      @error,
      @startedAt,
      @completedAt,
      @createdAt
    )
  `).run({
    id: payload.id,
    analysisId: payload.analysisId,
    chunkIndex: payload.chunkIndex,
    chapterId: payload.chapterId ?? null,
    processingTimeMs: payload.processingTimeMs ?? null,
    inputTokens: payload.inputTokens ?? null,
    outputTokens: payload.outputTokens ?? null,
    result: payload.result ?? null,
    error: payload.error ?? null,
    startedAt: payload.startedAt ?? null,
    completedAt: payload.completedAt ?? null,
    createdAt: payload.createdAt ?? Date.now(),
  });
}

export function listChunkResultsByAnalysis(analysisId) {
  const db = getCorpusDb();

  return db.prepare(`
    SELECT *
    FROM chunk_results
    WHERE analysis_id = ?
    ORDER BY chunk_index ASC
  `).all(analysisId).map(mapChunkResult);
}

export function listCorpusChunksForAnalysis(corpusId) {
  const db = getCorpusDb();

  return db.prepare(`
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
    WHERE chunks.corpus_id = @corpusId
    ORDER BY
      CASE WHEN chunks.start_position IS NULL THEN 1 ELSE 0 END ASC,
      chunks.start_position ASC,
      chapters.chapter_index ASC,
      chunks.chunk_index ASC
  `).all({ corpusId }).map((row) => ({
    id: row.id,
    chapterId: row.chapter_id,
    chapterIndex: toNumber(row.chapter_index, 0),
    chunkIndex: toNumber(row.chunk_index, 0),
    text: row.text,
    wordCount: toNumber(row.word_count, 0),
    startPosition: toNumber(row.start_position),
  }));
}