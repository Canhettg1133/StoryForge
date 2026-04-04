import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { getCorpusById, updateCorpusById } from '../corpus/db/queries.js';
import {
  createCorpusAnalysis,
  getCorpusAnalysisById,
  insertChunkResult,
  listChunkResultsByAnalysis,
  listCorpusAnalysesByCorpus,
  listCorpusChunksForAnalysis,
  updateCorpusAnalysis,
} from './db/queries.js';
import {
  ANALYSIS_CONFIG,
  estimateAnalysisTime,
  resolveAnalysisConfig,
} from './analysisConfig.js';
import { groundAnalysisEvents } from './eventGrounding.js';
import { enrichWithIncidentIntelligence } from './incidentIntelligence.js';
import { mergeOutputParts, parseJsonField, splitLayerResults } from './outputChunker.js';
import {
  analyzeWithSession,
  buildCorpusSessionInputs,
} from './sessionAnalyzer.js';

const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled']);

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function createServiceError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function isAbortError(error) {
  return (
    error?.name === 'AbortError'
    || error?.code === 'ANALYSIS_CANCELLED'
  );
}

function throwIfAborted(signal) {
  if (!signal?.aborted) {
    return;
  }

  throw createServiceError('ANALYSIS_CANCELLED', 'ÄĂ£ há»§y phĂ¢n tĂ­ch');
}

function serializeAnalysis(analysis, options = {}) {
  if (!analysis) {
    return null;
  }

  const includeResults = options.includeResults === true;

  const payload = {
    id: analysis.id,
    corpusId: analysis.corpusId,
    chunkSize: analysis.chunkSize,
    chunkOverlap: analysis.chunkOverlap,
    provider: analysis.provider,
    model: analysis.model,
    temperature: analysis.temperature,
    status: analysis.status,
    progress: analysis.progress,
    currentPhase: analysis.currentPhase,
    totalChunks: analysis.totalChunks,
    processedChunks: analysis.processedChunks,
    partsGenerated: analysis.partsGenerated,
    errorMessage: analysis.errorMessage,
    createdAt: analysis.createdAt,
    startedAt: analysis.startedAt,
    completedAt: analysis.completedAt,
  };

  if (!includeResults) {
    return payload;
  }

  payload.result = parseJsonField(analysis.finalResult, null);
  payload.layers = {
    l1: parseJsonField(analysis.resultL1, null),
    l2: parseJsonField(analysis.resultL2, null),
    l3: parseJsonField(analysis.resultL3, null),
    l4: parseJsonField(analysis.resultL4, null),
    l5: parseJsonField(analysis.resultL5, null),
    l6: parseJsonField(analysis.resultL6, null),
  };

  return payload;
}

class CorpusAnalysisService extends EventEmitter {
  constructor() {
    super();
    this.running = new Map();
  }

  emitAnalysisEvent(analysisId, event, data = {}) {
    this.emit('analysis_event', {
      analysisId,
      event,
      data: {
        ...data,
        type: event,
        timestamp: Date.now(),
      },
    });
  }

  listByCorpus(corpusId, options = {}) {
    const result = listCorpusAnalysesByCorpus(corpusId, options);
    return {
      ...result,
      analyses: result.analyses.map((item) => serializeAnalysis(item, { includeResults: false })),
    };
  }

  getById(analysisId, options = {}) {
    const analysis = getCorpusAnalysisById(analysisId);
    return serializeAnalysis(analysis, options);
  }

  getRawById(analysisId) {
    return getCorpusAnalysisById(analysisId);
  }

  getLayer(analysisId, layer) {
    const analysis = getCorpusAnalysisById(analysisId);
    if (!analysis) {
      return null;
    }

    const key = String(layer || '').toLowerCase();
    const layerMap = {
      l1: analysis.resultL1,
      l2: analysis.resultL2,
      l3: analysis.resultL3,
      l4: analysis.resultL4,
      l5: analysis.resultL5,
      l6: analysis.resultL6,
    };

    if (!(key in layerMap)) {
      return {
        valid: false,
        layer: key,
        value: null,
      };
    }

    return {
      valid: true,
      layer: key,
      value: parseJsonField(layerMap[key], null),
    };
  }

  getChunkResults(analysisId) {
    return listChunkResultsByAnalysis(analysisId).map((row) => ({
      ...row,
      result: parseJsonField(row.result, row.result),
    }));
  }

  async start(corpusId, rawConfig = {}) {
    const corpus = getCorpusById(corpusId, { includeChapterContent: false });
    if (!corpus) {
      throw createServiceError('CORPUS_NOT_FOUND', 'KhĂ´ng tĂ¬m tháº¥y corpus.');
    }

    const config = resolveAnalysisConfig(rawConfig);
    const analysisId = randomUUID();
    const estimate = estimateAnalysisTime({
      wordCount: corpus.wordCount,
      maxParts: config.maxParts,
      chunkSize: config.chunkSize,
    });

    const analysisRecord = createCorpusAnalysis({
      id: analysisId,
      corpusId,
      chunkSize: config.chunkSize,
      chunkOverlap: config.chunkOverlap,
      provider: config.provider,
      model: config.model,
      temperature: config.temperature,
      status: 'pending',
      level0Status: 'pending',
      level1Status: 'pending',
      level2Status: 'pending',
      totalChunks: 0,
      processedChunks: 0,
      progress: 0,
      currentPhase: 'queued',
      partsGenerated: 0,
      errorMessage: null,
    });

    const serialized = serializeAnalysis(analysisRecord, { includeResults: false });

    this.emitAnalysisEvent(analysisId, 'progress', {
      ...serialized,
      phase: 'queued',
      progress: 0,
      message: 'ÄĂ£ xáº¿p hĂ ng phĂ¢n tĂ­ch',
    });

    const abortController = new AbortController();
    this.running.set(analysisId, {
      abortController,
      corpusId,
      startedAt: Date.now(),
    });

    this.runAnalysis({
      analysisId,
      corpusId,
      config: {
        ...config,
        apiKey: rawConfig.apiKey,
        apiKeys: rawConfig.apiKeys,
        proxyUrl: rawConfig.proxyUrl,
        directUrl: rawConfig.directUrl,
      },
      signal: abortController.signal,
    }).catch(() => {});

    return {
      ...serialized,
      estimatedTime: estimate.estimatedLabel,
      estimatedMinutes: estimate.estimatedMinutes,
    };
  }

  async runAnalysis({ analysisId, corpusId, config, signal }) {
    try {
      throwIfAborted(signal);

      let analysis = updateCorpusAnalysis(analysisId, {
        status: 'processing',
        progress: 0.03,
        currentPhase: 'preparing',
        startedAt: Date.now(),
        level0Status: 'processing',
        level1Status: 'pending',
        level2Status: 'pending',
        errorMessage: null,
      });

      this.emitAnalysisEvent(analysisId, 'progress', {
        ...serializeAnalysis(analysis),
        phase: 'preparing',
        message: 'Äang chuáº©n bá»‹ chunk cá»§a corpus',
      });

      const chunks = listCorpusChunksForAnalysis(corpusId);
      console.error('[ANALYSIS-DEBUG] chunks.length:', chunks.length, 'chunkSize:', config.chunkSize);
      if (!chunks.length) {
        throw createServiceError('EMPTY_CORPUS_CHUNKS', 'Corpus khĂ´ng cĂ³ chunk Ä‘á»ƒ phĂ¢n tĂ­ch.');
      }

      const sessionInputs = buildCorpusSessionInputs(chunks, config.chunkSize);
      const totalSourceChunks = chunks.length;
      const coveredChunkCount = sessionInputs.reduce(
        (total, input) => total + (Array.isArray(input?.chunks) ? input.chunks.length : 0),
        0,
      );
      if (coveredChunkCount !== totalSourceChunks) {
        throw createServiceError(
          'SESSION_CHUNK_COVERAGE_MISMATCH',
          `Session input khong phu het chunk cua corpus (${coveredChunkCount}/${totalSourceChunks}).`,
        );
      }

      const totalInputWords = sessionInputs.reduce(
        (total, input) => total + Math.max(0, Number(input.wordCount) || 0),
        0,
      );
      const totalSessions = sessionInputs.length;
      let processedChunkCount = 0;

      analysis = updateCorpusAnalysis(analysisId, {
        totalChunks: totalSourceChunks,
        processedChunks: 0,
        progress: 0.05,
        currentPhase: 'session_input_ready',
      });

      this.emitAnalysisEvent(analysisId, 'progress', {
        ...serializeAnalysis(analysis),
        phase: 'session_input_ready',
        message: 'ÄĂ£ chuáº©n bá»‹ dá»¯ liá»‡u Ä‘áº§u vĂ o',
      });

      const normalizedApiKeys = [...new Set(
        (Array.isArray(config.apiKeys) ? config.apiKeys : [config.apiKeys, config.apiKey])
          .flat()
          .map((item) => String(item || '').trim())
          .filter(Boolean),
      )];
      const maxParallelSessions = Math.max(
        1,
        Math.min(totalSessions, normalizedApiKeys.length || 1),
      );

      let totalPartsGenerated = 0;
      const mergedResults = new Array(totalSessions);
      const tokenUsage = {
        promptTokenCount: 0,
        candidatesTokenCount: 0,
        totalTokenCount: 0,
      };
      const sessionStates = sessionInputs.map((input) => ({
        chunkCount: Math.max(1, Number(input?.chunks?.length) || 0),
        progress: 0,
        status: 'pending',
      }));

      const persistAndEmitProgress = ({
        phase,
        message,
        sessionIndex = null,
        sessionChunkCount = null,
        part = null,
        totalParts = null,
        hasMore = null,
      }) => {
        const weightedProgress = sessionStates.reduce((sum, state) => {
          const ratio = state.status === 'completed'
            ? 1
            : Math.max(0, Math.min(1, Number(state.progress) || 0));
          return sum + (state.chunkCount * ratio);
        }, 0);
        const ratio = totalSourceChunks > 0 ? (weightedProgress / totalSourceChunks) : 0;
        const progress = Math.min(0.95, 0.05 + (ratio * 0.88));

        const updated = updateCorpusAnalysis(analysisId, {
          progress,
          currentPhase: phase || 'processing',
          processedChunks: processedChunkCount,
          partsGenerated: totalPartsGenerated,
        });

        const payload = {
          ...serializeAnalysis(updated),
          phase: phase || 'processing',
          totalChunks: totalSourceChunks,
          totalSessions,
          maxParallelSessions,
          message: message || 'Dang xu ly phan tich',
        };

        if (Number.isFinite(Number(sessionIndex)) && Number(sessionIndex) >= 1) {
          payload.sessionIndex = Number(sessionIndex);
        }
        if (Number.isFinite(Number(sessionChunkCount)) && Number(sessionChunkCount) > 0) {
          payload.sessionChunkCount = Number(sessionChunkCount);
        }
        if (part != null) {
          payload.part = part;
        }
        if (totalParts != null) {
          payload.totalParts = totalParts;
        }
        if (hasMore != null) {
          payload.hasMore = hasMore;
        }

        this.emitAnalysisEvent(analysisId, 'progress', payload);
      };

      persistAndEmitProgress({
        phase: 'session_dispatch_ready',
        message: `San sang chay ${totalSessions} session, toi da ${maxParallelSessions} session song song`,
      });

      const processSingleSession = async (sessionIndex) => {
        throwIfAborted(signal);

        const input = sessionInputs[sessionIndex];
        const currentSession = sessionIndex + 1;
        const sessionState = sessionStates[sessionIndex];
        const sessionChunkCount = sessionState.chunkCount;

        sessionState.status = 'running';
        sessionState.progress = 0.02;
        persistAndEmitProgress({
          phase: 'session_processing',
          sessionIndex: currentSession,
          sessionChunkCount,
          message: `Dang phan tich session ${currentSession}/${totalSessions}`,
        });

        const sessionResult = await analyzeWithSession({
          text: input.text,
          layers: config.layers,
          config: {
            ...config,
            apiKeyStartIndex: sessionIndex,
          },
          signal,
          onProgress: (payload) => {
            throwIfAborted(signal);

            const part = Math.max(0, Number(payload.part) || 0);
            const totalParts = Math.max(
              part,
              Number(payload.totalParts) || Number(config.maxParts) || ANALYSIS_CONFIG.session.maxParts,
            );
            const sessionProgress = Math.max(0, Math.min(1, Number(payload.progress) || 0));
            sessionState.progress = Math.max(sessionState.progress, sessionProgress);

            persistAndEmitProgress({
              phase: payload.phase || 'processing',
              sessionIndex: currentSession,
              sessionChunkCount,
              part,
              totalParts,
              message: payload.message || `Dang xu ly session ${currentSession}/${totalSessions}`,
            });
          },
          onPart: ({ part, response, hasMore }) => {
            throwIfAborted(signal);

            totalPartsGenerated += 1;
            const globalPart = totalPartsGenerated;

            insertChunkResult({
              id: randomUUID(),
              analysisId,
              chunkIndex: globalPart,
              result: response?.text || null,
              inputTokens: toNumber(response?.usageMetadata?.promptTokenCount, null),
              outputTokens: toNumber(response?.usageMetadata?.candidatesTokenCount, null),
              processingTimeMs: null,
              startedAt: Date.now(),
              completedAt: Date.now(),
              error: null,
            });

            persistAndEmitProgress({
              phase: 'part_saved',
              sessionIndex: currentSession,
              sessionChunkCount,
              part: globalPart,
              totalParts: totalPartsGenerated,
              hasMore,
              message: `Da luu part ${globalPart} (session ${currentSession}/${totalSessions}, part noi bo ${part || 0})`,
            });
          },
        });

        mergedResults[sessionIndex] = sessionResult.merged || {};
        tokenUsage.promptTokenCount += toNumber(sessionResult.tokenUsage?.promptTokenCount, 0);
        tokenUsage.candidatesTokenCount += toNumber(sessionResult.tokenUsage?.candidatesTokenCount, 0);
        tokenUsage.totalTokenCount += toNumber(sessionResult.tokenUsage?.totalTokenCount, 0);

        processedChunkCount = Math.min(totalSourceChunks, processedChunkCount + sessionChunkCount);
        sessionState.status = 'completed';
        sessionState.progress = 1;

        persistAndEmitProgress({
          phase: 'chunk_completed',
          sessionIndex: currentSession,
          sessionChunkCount,
          message: `Hoan tat session ${currentSession}/${totalSessions} (${processedChunkCount}/${totalSourceChunks} chunk)`,
        });
      };

      for (let batchStart = 0; batchStart < totalSessions; batchStart += maxParallelSessions) {
        throwIfAborted(signal);

        const batchIndexes = [];
        for (
          let index = batchStart;
          index < Math.min(totalSessions, batchStart + maxParallelSessions);
          index += 1
        ) {
          batchIndexes.push(index);
        }

        const settled = await Promise.allSettled(
          batchIndexes.map((sessionIndex) => processSingleSession(sessionIndex)),
        );
        const rejected = settled.find((item) => item.status === 'rejected');

        if (rejected && rejected.status === 'rejected') {
          throw rejected.reason;
        }
      }

      if (processedChunkCount !== totalSourceChunks) {
        throw createServiceError(
          'SESSION_CHUNK_COVERAGE_MISMATCH',
          `Session xu ly thieu chunk (${processedChunkCount}/${totalSourceChunks}).`,
        );
      }

      throwIfAborted(signal);

      persistAndEmitProgress({
        phase: 'event_grounding',
        message: 'Dang grounding su kien vao chapter/chunk',
      });

      const mergedResult = mergeOutputParts(
        mergedResults.map((item) => JSON.stringify(item || {})),
      );
      const grounding = groundAnalysisEvents(mergedResult, chunks, {
        qualityThreshold: 60,
        chapterConfidenceThreshold: 0.45,
      });
      persistAndEmitProgress({
        phase: 'incident_intelligence',
        message: 'Dang trich xuat dia diem va gom incident clusters',
      });

      const incidentIntelligence = enrichWithIncidentIntelligence(
        grounding.result || mergedResult,
        chunks,
      );

      const finalResult = incidentIntelligence.result || grounding.result || mergedResult;
      console.error(
        '[ANALYSIS-DEBUG] merged sessions:',
        mergedResults.length,
        'final keys:',
        Object.keys(finalResult),
        'grounding stats:',
        grounding.stats,
        'incident stats:',
        incidentIntelligence.stats,
      );
      const layerResults = splitLayerResults(finalResult);

      analysis = updateCorpusAnalysis(analysisId, {
        status: 'completed',
        progress: 1,
        currentPhase: 'completed',
        level0Status: 'completed',
        level1Status: 'completed',
        level2Status: 'completed',
        processedChunks: totalSourceChunks,
        partsGenerated: totalPartsGenerated,
        resultL1: layerResults.resultL1,
        resultL2: layerResults.resultL2,
        resultL3: layerResults.resultL3,
        resultL4: layerResults.resultL4,
        resultL5: layerResults.resultL5,
        resultL6: layerResults.resultL6,
        finalResult: JSON.stringify({
          ...finalResult,
          tokenUsage,
          meta: {
            ...(finalResult.meta || {}),
            provider: config.provider,
            model: config.model,
            layers: config.layers,
            inputWords: totalInputWords,
            parts: totalPartsGenerated,
            sessions: totalSessions,
            maxParallelSessions,
            totalChunks: totalSourceChunks,
            eventGrounding: grounding.stats,
            incidentIntelligence: incidentIntelligence.stats,
            completedAt: Date.now(),
          },
        }),
        completedAt: Date.now(),
        errorMessage: null,
      });

      updateCorpusById(corpusId, {
        status: 'analyzed',
      });

      this.emitAnalysisEvent(analysisId, 'completed', {
        ...serializeAnalysis(analysis, { includeResults: true }),
        message: 'PhĂ¢n tĂ­ch hoĂ n táº¥t',
      });
    } catch (error) {
      const cancelled = isAbortError(error);

      const failed = updateCorpusAnalysis(analysisId, {
        status: cancelled ? 'cancelled' : 'failed',
        progress: cancelled ? 0 : undefined,
        currentPhase: cancelled ? 'cancelled' : 'failed',
        errorMessage: cancelled ? 'ÄĂ£ há»§y phĂ¢n tĂ­ch' : (error?.message || 'PhĂ¢n tĂ­ch tháº¥t báº¡i'),
        completedAt: Date.now(),
      });

      if (cancelled) {
        this.emitAnalysisEvent(analysisId, 'cancelled', {
          ...serializeAnalysis(failed),
          message: 'ÄĂ£ há»§y phĂ¢n tĂ­ch',
        });
      } else {
        this.emitAnalysisEvent(analysisId, 'error', {
          ...serializeAnalysis(failed),
          message: error?.message || 'PhĂ¢n tĂ­ch tháº¥t báº¡i',
          retrying: false,
        });
      }
    } finally {
      this.running.delete(analysisId);
    }
  }

  cancel(analysisId) {
    const analysis = getCorpusAnalysisById(analysisId);
    if (!analysis) {
      return null;
    }

    if (TERMINAL_STATUSES.has(analysis.status)) {
      return serializeAnalysis(analysis, { includeResults: false });
    }

    const running = this.running.get(analysisId);
    if (running?.abortController) {
      running.abortController.abort();
    }

    const cancelled = updateCorpusAnalysis(analysisId, {
      status: 'cancelled',
      currentPhase: 'cancelled',
      errorMessage: 'ÄĂ£ há»§y phĂ¢n tĂ­ch',
      completedAt: Date.now(),
    });

    this.emitAnalysisEvent(analysisId, 'cancelled', {
      ...serializeAnalysis(cancelled),
      message: 'ÄĂ£ há»§y phĂ¢n tĂ­ch',
    });

    return serializeAnalysis(cancelled, { includeResults: false });
  }
}

let analysisServiceInstance = null;

export function getCorpusAnalysisService() {
  if (!analysisServiceInstance) {
    analysisServiceInstance = new CorpusAnalysisService();
  }

  return analysisServiceInstance;
}

export {
  serializeAnalysis,
};

