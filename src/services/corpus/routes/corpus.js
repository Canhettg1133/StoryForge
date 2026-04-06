import express from 'express';
import multer from 'multer';
import { ANALYSIS_CONFIG } from '../../analysis/analysisConfig.js';
import { getCorpusAnalysisService } from '../../analysis/index.js';
import { incidentFirstRepository } from '../../analysis/repositories/incidentFirstRepository.js';
import { analysisRepository } from '../../analysis/repositories/analysisRepository.js';
import { projectSnapshotRepository } from '../../projects/repositories/projectSnapshotRepository.js';
import {
  createCorpusFromUpload,
  getCorpusChunkPreview,
  getCorpusChapter,
  getCorpusRecord,
  listCorpusRecords,
  parseMetadata,
  rechunkCorpusRecord,
  removeCorpusRecord,
  updateCorpusRecord,
} from '../corpusService.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 100 * 1024 * 1024,
  },
});

const ANALYSIS_TERMINAL_EVENTS = new Set(['completed', 'error', 'cancelled']);

function sendSseEvent(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function getStoryGraphPayload(analysis = null) {
  const result = analysis?.result || null;
  if (!result || typeof result !== 'object') {
    return {
      graph: null,
      graphSummary: null,
    };
  }

  return {
    graph: result.story_graph || result.storyGraph || null,
    graphSummary: result.graph_summary || result.graphSummary || null,
  };
}

function toHttpError(error) {
  if (!error?.code) {
    return { status: 500, message: error?.message || 'Lỗi máy chủ nội bộ.' };
  }

  switch (error.code) {
    case 'UNSUPPORTED_FILE_TYPE':
      return { status: 415, message: error.message };
    case 'INVALID_INPUT':
      return { status: 400, message: error.message };
    case 'PARSE_FAILED':
      return { status: 422, message: error.message };
    case 'CORPUS_NOT_FOUND':
      return { status: 404, message: error.message };
    case 'CONTEXT_LIMIT_EXCEEDED':
      return { status: 400, message: error.message };
    case 'MISSING_API_KEY':
    case 'MISSING_PROXY_URL':
      return { status: 400, message: error.message };
    case 'ANALYSIS_OUTPUT_INCOMPLETE':
    case 'EMPTY_CORPUS_CHUNKS':
    case 'EMPTY_CORPUS_TEXT':
    case 'SESSION_CHUNK_COVERAGE_MISMATCH':
      return { status: 422, message: error.message };
    default:
      return { status: 500, message: error.message || 'Lỗi máy chủ nội bộ.' };
  }
}

export function createCorpusRouter() {
  const router = express.Router();
  const analysisService = getCorpusAnalysisService();

  async function resolveAnalysisId(corpusId, requestedAnalysisId = null) {
    if (requestedAnalysisId) {
      const analysis = await analysisService.getRawById(requestedAnalysisId);
      if (!analysis || analysis.corpusId !== corpusId) {
        return null;
      }
      return requestedAnalysisId;
    }

    return incidentFirstRepository.getLatestAnalysisIdForCorpusAsync(corpusId, { includeNonTerminal: true });
  }

  function parseReviewFilter(filter) {
    const value = String(filter || 'all').trim();
    if (value === 'needs_review') {
      return { status: 'pending', priority: null, filter: value };
    }
    if (['P0', 'P1', 'P2'].includes(value)) {
      return { status: null, priority: value, filter: value };
    }
    return { status: null, priority: null, filter: 'all' };
  }

  router.post('/', upload.single('file'), async (req, res) => {
    try {
      const metadata = parseMetadata(req.body?.metadata);
      const chunkSize = req.body?.chunkSize || metadata.chunkSize;

      const corpus = await createCorpusFromUpload({
        file: req.file,
        metadata,
        chunkSize,
      });

      return res.status(201).json({
        id: corpus.id,
        title: corpus.title,
        author: corpus.author,
        status: corpus.status,
        frontMatter: corpus.frontMatter || null,
        parseDiagnostics: corpus.parseDiagnostics || null,
        chapterCount: corpus.chapterCount,
        wordCount: corpus.wordCount,
        fileType: corpus.fileType,
        fandom: corpus.fandom,
        fandomConfidence: corpus.fandomConfidence,
        chunkSize: corpus.chunkSize,
        chunkCount: corpus.chunkCount,
        fandomSuggestion: corpus.fandomSuggestion,
        chunkSizeUsed: corpus.chunkSizeUsed,
        chapters: corpus.chapters,
        lastRechunkedAt: corpus.lastRechunkedAt,
        createdAt: corpus.createdAt,
      });
    } catch (error) {
      const httpError = toHttpError(error);
      return res.status(httpError.status).json({ error: httpError.message });
    }
  });

  router.get('/', async (req, res) => {
    const result = await listCorpusRecords({
      fandom: req.query?.fandom,
      status: req.query?.status,
      search: req.query?.search,
      limit: req.query?.limit,
      offset: req.query?.offset,
    });

    return res.json(result);
  });

  router.get('/:id/chapters/:chapterId', async (req, res) => {
    const chapter = await getCorpusChapter(req.params.id, req.params.chapterId);
    if (!chapter) {
      return res.status(404).json({ error: 'Không tìm thấy chương.' });
    }

    return res.json(chapter);
  });

  router.get('/:id/chunk-preview', async (req, res) => {
    try {
      const preview = await getCorpusChunkPreview(req.params.id, {
        chunkSizeWords: req.query?.chunkSizeWords,
        preset: req.query?.preset,
        customWords: req.query?.customWords,
        model: req.query?.model,
        parallelChunks: req.query?.parallelChunks,
      });

      return res.json(preview);
    } catch (error) {
      const httpError = toHttpError(error);
      return res.status(httpError.status).json({ error: httpError.message });
    }
  });

  router.post('/:id/rechunk', async (req, res) => {
    try {
      const result = await rechunkCorpusRecord(req.params.id, {
        chunkSizeWords: req.body?.chunkSizeWords,
        preset: req.body?.preset,
        customWords: req.body?.customWords,
        model: req.body?.model,
        parallelChunks: req.body?.parallelChunks,
        preserveParagraphs: req.body?.preserveParagraphs,
      });

      return res.json({
        success: true,
        ...result,
      });
    } catch (error) {
      const httpError = toHttpError(error);
      return res.status(httpError.status).json({ error: httpError.message });
    }
  });

  router.post('/:id/analyze', async (req, res) => {
    try {
      const analysis = await analysisService.start(req.params.id, req.body || {});
      return res.status(201).json(analysis);
    } catch (error) {
      const httpError = toHttpError(error);
      return res.status(httpError.status).json({ error: httpError.message });
    }
  });

  router.post('/:id/incident-analysis', async (req, res) => {
    try {
      const payload = req.body || {};
      const mode = payload.mode || payload.runMode || 'balanced';
      const analysis = await analysisService.start(req.params.id, {
        ...payload,
        runMode: mode,
      });

      return res.status(201).json({
        id: analysis.id,
        corpusId: analysis.corpusId,
        status: analysis.status,
        mode,
        estimatedTime: analysis.estimatedTime || null,
        estimatedMinutes: analysis.estimatedMinutes || null,
      });
    } catch (error) {
      const httpError = toHttpError(error);
      return res.status(httpError.status).json({ error: httpError.message });
    }
  });

  router.get('/:id/analysis', async (req, res) => {
    const corpus = await getCorpusRecord(req.params.id, { includeChapterContent: false });
    if (!corpus) {
      return res.status(404).json({ error: 'Không tìm thấy corpus.' });
    }

    const result = await analysisService.listByCorpus(req.params.id, {
      limit: req.query?.limit,
      offset: req.query?.offset,
    });

    return res.json(result);
  });

  router.get('/:id/analysis/:analysisId/stream', async (req, res) => {
    const analysis = await analysisService.getRawById(req.params.analysisId);
    if (!analysis || analysis.corpusId !== req.params.id) {
      return res.status(404).json({ error: 'Không tìm thấy bản phân tích.' });
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    res.write(`retry: ${ANALYSIS_CONFIG.sse.retryMs}\n\n`);
    sendSseEvent(
      res,
      'snapshot',
      await analysisService.getById(req.params.analysisId, {
        includeResults: analysis.status === 'completed',
      }),
    );

    const heartbeat = setInterval(() => {
      res.write(': ping\n\n');
    }, ANALYSIS_CONFIG.sse.heartbeatMs);

    const listener = (event) => {
      if (event.analysisId !== req.params.analysisId) {
        return;
      }

      sendSseEvent(res, event.event, event.data);

      if (ANALYSIS_TERMINAL_EVENTS.has(event.event)) {
        clearInterval(heartbeat);
        analysisService.off('analysis_event', listener);
        res.end();
      }
    };

    analysisService.on('analysis_event', listener);

    req.on('close', () => {
      clearInterval(heartbeat);
      analysisService.off('analysis_event', listener);
      res.end();
    });
  });

  router.get('/:id/analysis/:analysisId', async (req, res) => {
    const analysis = await analysisService.getById(req.params.analysisId, {
      includeResults: true,
    });

    if (!analysis || analysis.corpusId !== req.params.id) {
      return res.status(404).json({ error: 'Không tìm thấy bản phân tích.' });
    }

    return res.json(analysis);
  });

  router.get('/:id/analysis/:analysisId/graph', async (req, res) => {
    const analysis = await analysisService.getById(req.params.analysisId, {
      includeResults: true,
    });

    if (!analysis || analysis.corpusId !== req.params.id) {
      return res.status(404).json({ error: 'Khong tim thay ban phan tich.' });
    }

    const graph = await analysisRepository.getStoryGraphByAnalysisAsync(req.params.analysisId);
    const graphPayload = graph
      ? {
        graph,
        graphSummary: analysis?.graphSummary || analysis?.result?.graph_summary || graph.summary || null,
      }
      : getStoryGraphPayload(analysis);
    return res.json({
      analysisId: req.params.analysisId,
      corpusId: req.params.id,
      ...graphPayload,
    });
  });

  router.get('/:id/analysis/:analysisId/provenance/:nodeId', async (req, res) => {
    const analysis = await analysisService.getById(req.params.analysisId, {
      includeResults: true,
    });

    if (!analysis || analysis.corpusId !== req.params.id) {
      return res.status(404).json({ error: 'Khong tim thay ban phan tich.' });
    }

    const nodeId = String(req.params.nodeId || '').trim();
    if (!nodeId) {
      return res.status(404).json({ error: 'Khong tim thay provenance cho node.' });
    }

    const provenance = await analysisRepository.getStoryGraphProvenanceAsync(req.params.analysisId, nodeId);
    if (!provenance) {
      return res.status(404).json({ error: 'Khong tim thay node provenance.' });
    }

    return res.json({
      analysisId: req.params.analysisId,
      corpusId: req.params.id,
      ...provenance,
    });
  });

  router.get('/:id/analysis/:analysisId/layer/:layer', async (req, res) => {
    const analysis = await analysisService.getById(req.params.analysisId);
    if (!analysis || analysis.corpusId !== req.params.id) {
      return res.status(404).json({ error: 'Không tìm thấy bản phân tích.' });
    }

    const layer = await analysisService.getLayer(req.params.analysisId, req.params.layer);
    if (!layer?.valid) {
      return res.status(400).json({ error: 'Layer không hợp lệ. Dùng l1-l6.' });
    }

    return res.json({
      analysisId: req.params.analysisId,
      corpusId: req.params.id,
      layer: layer.layer,
      result: layer.value,
    });
  });

  router.get('/:id/incidents', async (req, res) => {
    const corpus = await getCorpusRecord(req.params.id, { includeChapterContent: false });
    if (!corpus) {
      return res.status(404).json({ error: 'Không tìm thấy corpus.' });
    }

    const analysisId = await resolveAnalysisId(req.params.id, req.query?.analysisId);
    if (!analysisId) {
      return res.json({ analysisId: null, incidents: [], total: 0 });
    }

    const incidents = await incidentFirstRepository.listIncidentsByAnalysisAsync(analysisId);
    return res.json({
      analysisId,
      incidents,
      total: incidents.length,
    });
  });

  router.get('/:id/incidents/:incidentId', async (req, res) => {
    const incident = await incidentFirstRepository.getIncidentByIdAsync(req.params.incidentId);
    if (!incident || incident.corpusId !== req.params.id) {
      return res.status(404).json({ error: 'Không tìm thấy incident.' });
    }

    const events = await incidentFirstRepository.listAnalysisEventsByIncidentAsync(incident.id);
    const allLocations = await incidentFirstRepository.listAnalysisLocationsByAnalysisAsync(incident.analysisId);
    const locationIds = new Set([
      ...(incident.relatedLocations || []),
      ...events
        .map((event) => event?.locationLink?.locationId)
        .filter(Boolean),
    ]);

    const locations = allLocations.filter((location) => {
      if (locationIds.has(location.id)) return true;
      return Array.isArray(location?.incidentIds) && location.incidentIds.includes(incident.id);
    });

    const eventIds = new Set(events.map((event) => event.id));
    const allRisks = await incidentFirstRepository.listConsistencyRisksByAnalysisAsync(incident.analysisId);
    const consistencyRisks = allRisks.filter((risk) => {
      if (Array.isArray(risk?.involvedIncidents) && risk.involvedIncidents.includes(incident.id)) return true;
      if (!Array.isArray(risk?.involvedEvents)) return false;
      return risk.involvedEvents.some((eventId) => eventIds.has(eventId));
    });

    return res.json({
      analysisId: incident.analysisId,
      incident,
      events,
      locations,
      consistencyRisks,
    });
  });

  router.patch('/:id/incidents/:incidentId', async (req, res) => {
    const incident = await incidentFirstRepository.getIncidentByIdAsync(req.params.incidentId);
    if (!incident || incident.corpusId !== req.params.id) {
      return res.status(404).json({ error: 'Không tìm thấy incident.' });
    }

    const updates = req.body || {};
    const next = await incidentFirstRepository.upsertIncident({
      ...incident,
      ...updates,
      id: incident.id,
      corpusId: incident.corpusId,
      analysisId: incident.analysisId,
      reviewedAt: Date.now(),
    });

    return res.json({
      updated: true,
      incident: next,
    });
  });

  router.get('/:id/review-queue', async (req, res) => {
    const corpus = await getCorpusRecord(req.params.id, { includeChapterContent: false });
    if (!corpus) {
      return res.status(404).json({ error: 'Không tìm thấy corpus.' });
    }

    const analysisId = await resolveAnalysisId(req.params.id, req.query?.analysisId);
    if (!analysisId) {
      return res.json({
        analysisId: null,
        items: [],
        stats: { total: 0, P0: 0, P1: 0, P2: 0, pending: 0 },
        total: 0,
      });
    }

    const filterConfig = parseReviewFilter(req.query?.filter);
    const limit = Math.max(1, Math.min(500, Number(req.query?.limit) || 20));
    const offset = Math.max(0, Number(req.query?.offset) || 0);

    const items = await incidentFirstRepository.listReviewQueueByAnalysisAsync(analysisId, {
      status: filterConfig.status,
      priority: filterConfig.priority,
      limit,
      offset,
    });
    const stats = await incidentFirstRepository.getReviewQueueStatsByAnalysisAsync(analysisId);

    return res.json({
      analysisId,
      filter: filterConfig.filter,
      items,
      stats,
      total: items.length,
      limit,
      offset,
    });
  });

  router.patch('/:id/review-queue/:itemId', async (req, res) => {
    const item = await incidentFirstRepository.getReviewQueueItemByIdAsync(req.params.itemId);
    if (!item || item.corpusId !== req.params.id) {
      return res.status(404).json({ error: 'Khong tim thay review item.' });
    }

    const payload = req.body || {};
    const status = payload.status || item.status;
    const resolved = status === 'resolved' || status === 'ignored';

    const next = await incidentFirstRepository.upsertReviewQueueItem({
      ...item,
      ...payload,
      id: item.id,
      corpusId: item.corpusId,
      analysisId: item.analysisId,
      reviewedAt: resolved ? Date.now() : item.reviewedAt,
    });

    return res.json({
      updated: true,
      item: next,
    });
  });

  router.delete('/analysis/:analysisId', async (req, res) => {
    const analysis = await analysisService.cancel(req.params.analysisId);
    if (!analysis) {
      return res.status(404).json({ error: 'Khong tim thay ban phan tich.' });
    }

    return res.json(analysis);
  });

  router.get('/projects/:projectId/analysis-snapshots', async (req, res) => {
    try {
      const items = await projectSnapshotRepository.listByProject(
        req.params.projectId,
        req.query?.limit,
      );
      return res.json({
        projectId: req.params.projectId,
        items,
        total: items.length,
      });
    } catch (error) {
      return res.status(503).json({
        error: error?.message || 'Khong the doc project snapshots tu Postgres.',
      });
    }
  });

  router.post('/projects/:projectId/analysis-snapshots', async (req, res) => {
    try {
      const saved = await projectSnapshotRepository.saveSnapshot({
        projectId: req.params.projectId,
        corpusId: req.body?.corpusId,
        analysisId: req.body?.analysisId,
        status: req.body?.status,
        layers: req.body?.layers,
        result: req.body?.result,
        artifactVersion: req.body?.artifactVersion,
      });
      return res.status(201).json(saved);
    } catch (error) {
      return res.status(503).json({
        error: error?.message || 'Khong the luu project snapshot vao Postgres.',
      });
    }
  });

  router.get('/:id', async (req, res) => {
    const corpus = await getCorpusRecord(req.params.id, {
      includeChapterContent: false,
    });

    if (!corpus) {
      return res.status(404).json({ error: 'Khong tim thay corpus.' });
    }

    return res.json(corpus);
  });

  router.patch('/:id', async (req, res) => {
    const updates = req.body || {};
    const updated = await updateCorpusRecord(req.params.id, updates);

    if (!updated) {
      return res.status(404).json({ error: 'Khong tim thay corpus.' });
    }

    return res.json({
      id: updated.id,
      updated: true,
      corpus: updated,
    });
  });

  router.delete('/:id', async (req, res) => {
    const deleted = await removeCorpusRecord(req.params.id);
    if (!deleted) {
      return res.status(404).json({ error: 'Khong tim thay corpus.' });
    }

    return res.json({ success: true });
  });

  return router;
}
