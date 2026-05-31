import { toVietnameseErrorMessage } from '../../utils/errorMessages';

function isLocalHost() {
  if (typeof window === 'undefined') {
    return false;
  }
  const host = window.location.hostname;
  return host === 'localhost' || host === '127.0.0.1' || host.endsWith('.localhost');
}

const CORPUS_API_BASE_URL = (
  import.meta.env.VITE_JOB_SERVER_URL || (isLocalHost() ? 'http://localhost:3847' : '')
).trim();

function requireCorpusApiBaseUrl() {
  if (!CORPUS_API_BASE_URL) {
    const error = new Error('Thiếu VITE_JOB_SERVER_URL cho Corpus API.');
    error.code = 'CORPUS_API_BASE_URL_MISSING';
    throw error;
  }
  return CORPUS_API_BASE_URL;
}

function buildUrl(pathname, query = {}) {
  const url = new URL(pathname, requireCorpusApiBaseUrl());

  for (const [key, value] of Object.entries(query || {})) {
    if (value === undefined || value === null || value === '') {
      continue;
    }
    url.searchParams.set(key, String(value));
  }

  return url.toString();
}

async function request(pathname, options = {}) {
  const {
    query,
    body,
    isFormData = false,
    headers,
    ...rest
  } = options;

  let response;
  const requestUrl = buildUrl(pathname, query);

  try {
    response = await fetch(requestUrl, {
      ...rest,
      headers: {
        ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
        ...(headers || {}),
      },
      body: isFormData ? body : body ? JSON.stringify(body) : undefined,
    });
  } catch (networkError) {
    const error = new Error(
      `Không thể kết nối Corpus API tại ${CORPUS_API_BASE_URL}. Hãy chạy jobs server (npm run jobs:server).`,
    );
    error.code = 'API_UNREACHABLE';
    error.cause = networkError;
    throw error;
  }

  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json')
    ? await response.json()
    : null;

  if (!response.ok) {
    const error = new Error(toVietnameseErrorMessage(payload?.error || `Request failed: ${response.status}`, 'Yêu cầu Corpus API thất bại.'));
    error.status = response.status;
    throw error;
  }

  return payload;
}

export const corpusApi = {
  create(formData) {
    return request('/api/corpus', {
      method: 'POST',
      body: formData,
      isFormData: true,
    });
  },

  list(query = {}) {
    return request('/api/corpus', { query });
  },

  getById(corpusId) {
    return request(`/api/corpus/${corpusId}`);
  },

  update(corpusId, updates) {
    return request(`/api/corpus/${corpusId}`, {
      method: 'PATCH',
      body: updates,
    });
  },

  remove(corpusId) {
    return request(`/api/corpus/${corpusId}`, {
      method: 'DELETE',
    });
  },

  getChapter(corpusId, chapterId) {
    return request(`/api/corpus/${corpusId}/chapters/${chapterId}`);
  },

  getChunkPreview(corpusId, query = {}) {
    return request(`/api/corpus/${corpusId}/chunk-preview`, { query });
  },

  rechunk(corpusId, payload = {}) {
    return request(`/api/corpus/${corpusId}/rechunk`, {
      method: 'POST',
      body: payload,
    });
  },

  startAnalysis(corpusId, payload = {}) {
    return request(`/api/corpus/${corpusId}/analyze`, {
      method: 'POST',
      body: payload,
    });
  },

  startIncidentAnalysis(corpusId, payload = {}) {
    return request(`/api/corpus/${corpusId}/incident-analysis`, {
      method: 'POST',
      body: payload,
    });
  },

  listAnalyses(corpusId, query = {}) {
    return request(`/api/corpus/${corpusId}/analysis`, { query });
  },

  getAnalysis(corpusId, analysisId, query = {}) {
    return request(`/api/corpus/${corpusId}/analysis/${analysisId}`, { query });
  },

  getAnalysisArtifact(corpusId, analysisId, query = {}) {
    return request(`/api/corpus/${corpusId}/analysis/${analysisId}/artifact`, { query });
  },

  getAnalysisWindows(corpusId, analysisId) {
    return request(`/api/corpus/${corpusId}/analysis/${analysisId}/windows`);
  },

  rerunAnalysisScope(corpusId, analysisId, payload = {}) {
    return request(`/api/corpus/${corpusId}/analysis/${analysisId}/rerun`, {
      method: 'POST',
      body: payload,
    });
  },

  getAnalysisGraph(corpusId, analysisId) {
    return request(`/api/corpus/${corpusId}/analysis/${analysisId}/graph`);
  },

  getAnalysisProvenance(corpusId, analysisId, nodeId) {
    return request(`/api/corpus/${corpusId}/analysis/${analysisId}/provenance/${nodeId}`);
  },

  listProjectAnalysisSnapshots(projectId, query = {}) {
    return request(`/api/corpus/projects/${projectId}/analysis-snapshots`, { query });
  },

  saveProjectAnalysisSnapshot(projectId, payload = {}) {
    return request(`/api/corpus/projects/${projectId}/analysis-snapshots`, {
      method: 'POST',
      body: payload,
    });
  },

  getAnalysisLayer(corpusId, analysisId, layer) {
    return request(`/api/corpus/${corpusId}/analysis/${analysisId}/layer/${layer}`);
  },

  listIncidents(corpusId, query = {}) {
    return request(`/api/corpus/${corpusId}/incidents`, { query });
  },

  getIncidentDetail(corpusId, incidentId) {
    return request(`/api/corpus/${corpusId}/incidents/${incidentId}`);
  },

  updateIncident(corpusId, incidentId, payload = {}) {
    return request(`/api/corpus/${corpusId}/incidents/${incidentId}`, {
      method: 'PATCH',
      body: payload,
    });
  },

  getReviewQueue(corpusId, query = {}) {
    return request(`/api/corpus/${corpusId}/review-queue`, { query });
  },

  updateReviewQueueItem(corpusId, itemId, payload = {}) {
    return request(`/api/corpus/${corpusId}/review-queue/${itemId}`, {
      method: 'PATCH',
      body: payload,
    });
  },

  cancelAnalysis(analysisId) {
    return request(`/api/corpus/analysis/${analysisId}`, {
      method: 'DELETE',
    });
  },

  subscribeAnalysis(corpusId, analysisId) {
    return new EventSource(buildUrl(`/api/corpus/${corpusId}/analysis/${analysisId}/stream`));
  },
};
