import {
  pgGetAnalysisById,
  pgGetAnalysisArtifactByAnalysis,
  pgGetStoryGraphByAnalysis,
  pgGetStoryGraphProvenance,
  pgGetExecutionSessionById,
  pgGetActiveExecutionSessionByAnalysis,
  pgGetExecutionStageOutput,
  pgListAnalysesByCorpus,
  pgListAnalysisBeatsByAnalysis,
  pgListAnalysisEntitiesByAnalysis,
  pgListAnalysisEntityMentionsByAnalysis,
  pgListAnalysisReviewQueueByAnalysis,
  pgListAnalysisWindowsByAnalysis,
  pgListChunkResultsByAnalysis,
  pgListCorpusChunksForAnalysis,
} from '../../storage/postgres/read.js';
import {
  pgCreateAnalysis,
  pgFailStaleProcessingAnalyses,
  pgInsertChunkResult,
  pgPersistAnalysisArtifactV3,
  pgPersistStoryGraph,
  pgAcquireExecutionSession,
  pgRecoverExecutionSessions,
  pgTouchExecutionSession,
  pgUpdateExecutionSession,
  pgUpsertExecutionStageOutput,
  pgUpdateAnalysis,
} from '../../storage/postgres/write.js';

export const analysisRepository = {
  async createAnalysis(payload) {
    return pgCreateAnalysis(payload);
  },

  async updateAnalysis(analysisId, updates = {}) {
    return pgUpdateAnalysis(analysisId, updates);
  },

  async getAnalysisByIdAsync(analysisId) {
    return pgGetAnalysisById(analysisId);
  },

  async getAnalysisArtifactByAnalysisAsync(analysisId) {
    return pgGetAnalysisArtifactByAnalysis(analysisId);
  },

  async listAnalysesByCorpusAsync(corpusId, options = {}) {
    return pgListAnalysesByCorpus(corpusId, options);
  },

  async insertChunkResult(payload) {
    await pgInsertChunkResult(payload);
  },

  async listChunkResultsByAnalysisAsync(analysisId) {
    return pgListChunkResultsByAnalysis(analysisId);
  },

  async listCorpusChunksForAnalysisAsync(corpusId) {
    return pgListCorpusChunksForAnalysis(corpusId);
  },

  async listAnalysisWindowsByAnalysisAsync(analysisId) {
    return pgListAnalysisWindowsByAnalysis(analysisId);
  },

  async listAnalysisBeatsByAnalysisAsync(analysisId) {
    return pgListAnalysisBeatsByAnalysis(analysisId);
  },

  async listAnalysisEntitiesByAnalysisAsync(analysisId) {
    return pgListAnalysisEntitiesByAnalysis(analysisId);
  },

  async listAnalysisEntityMentionsByAnalysisAsync(analysisId) {
    return pgListAnalysisEntityMentionsByAnalysis(analysisId);
  },

  async listAnalysisReviewQueueByAnalysisAsync(analysisId) {
    return pgListAnalysisReviewQueueByAnalysis(analysisId);
  },

  async persistArtifactV3(payload) {
    await pgPersistAnalysisArtifactV3(payload);
  },

  async acquireExecutionSession(payload) {
    return pgAcquireExecutionSession(payload);
  },

  async updateExecutionSession(sessionId, updates = {}) {
    return pgUpdateExecutionSession(sessionId, updates);
  },

  async touchExecutionSession(sessionId, updates = {}) {
    return pgTouchExecutionSession(sessionId, updates);
  },

  async getExecutionSessionByIdAsync(sessionId) {
    return pgGetExecutionSessionById(sessionId);
  },

  async getActiveExecutionSessionByAnalysisAsync(analysisId) {
    return pgGetActiveExecutionSessionByAnalysis(analysisId);
  },

  async upsertExecutionStageOutput(payload) {
    return pgUpsertExecutionStageOutput(payload);
  },

  async getExecutionStageOutputAsync(sessionId, stageKey) {
    return pgGetExecutionStageOutput(sessionId, stageKey);
  },

  async getStoryGraphByAnalysisAsync(analysisId) {
    return pgGetStoryGraphByAnalysis(analysisId);
  },

  async getStoryGraphProvenanceAsync(analysisId, nodeId) {
    return pgGetStoryGraphProvenance(analysisId, nodeId);
  },

  async persistGraph(analysisId, corpusId, graph, passStatus = null) {
    await pgPersistStoryGraph({
      analysisId,
      corpusId,
      graph,
      passStatus,
    });
  },

  async failStaleProcessingAnalyses() {
    await pgFailStaleProcessingAnalyses();
  },

  async recoverExecutionSessions() {
    await pgRecoverExecutionSessions();
  },
};
