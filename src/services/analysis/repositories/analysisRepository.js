import {
  pgGetAnalysisById,
  pgGetStoryGraphByAnalysis,
  pgGetStoryGraphProvenance,
  pgListAnalysesByCorpus,
  pgListChunkResultsByAnalysis,
  pgListCorpusChunksForAnalysis,
} from '../../storage/postgres/read.js';
import {
  pgCreateAnalysis,
  pgFailStaleProcessingAnalyses,
  pgInsertChunkResult,
  pgPersistStoryGraph,
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
};
