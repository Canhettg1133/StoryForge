import {
  pgGetIncidentById,
  pgGetLatestAnalysisIdForCorpus,
  pgGetReviewQueueItemById,
  pgGetReviewQueueStatsByAnalysis,
  pgListAnalysisEventsByIncident,
  pgListAnalysisLocationsByAnalysis,
  pgListConsistencyRisksByAnalysis,
  pgListIncidentsByAnalysis,
  pgListReviewQueueByAnalysis,
} from '../../storage/postgres/read.js';
import {
  pgReplaceIncidentFirstArtifacts,
  pgUpsertIncident,
  pgUpsertReviewQueueItem,
} from '../../storage/postgres/write.js';

export const incidentFirstRepository = {
  async replaceArtifacts(payload) {
    await pgReplaceIncidentFirstArtifacts(payload);
  },
  async getIncidentByIdAsync(incidentId) {
    return pgGetIncidentById(incidentId);
  },
  async getLatestAnalysisIdForCorpusAsync(corpusId, options = {}) {
    return pgGetLatestAnalysisIdForCorpus(corpusId, options);
  },
  async getReviewQueueItemByIdAsync(itemId) {
    return pgGetReviewQueueItemById(itemId);
  },
  async getReviewQueueStatsByAnalysisAsync(analysisId) {
    return pgGetReviewQueueStatsByAnalysis(analysisId);
  },
  async listAnalysisEventsByIncidentAsync(incidentId) {
    return pgListAnalysisEventsByIncident(incidentId);
  },
  async listAnalysisLocationsByAnalysisAsync(analysisId) {
    return pgListAnalysisLocationsByAnalysis(analysisId);
  },
  async listConsistencyRisksByAnalysisAsync(analysisId, options = {}) {
    return pgListConsistencyRisksByAnalysis(analysisId, options);
  },
  async listIncidentsByAnalysisAsync(analysisId) {
    return pgListIncidentsByAnalysis(analysisId);
  },
  async listReviewQueueByAnalysisAsync(analysisId, options = {}) {
    return pgListReviewQueueByAnalysis(analysisId, options);
  },
  async upsertIncident(payload) {
    return pgUpsertIncident(payload);
  },
  async upsertReviewQueueItem(payload) {
    return pgUpsertReviewQueueItem(payload);
  },
};
