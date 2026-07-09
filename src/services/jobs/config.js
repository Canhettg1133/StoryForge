const ENV = globalThis.process?.env || {};

const DEFAULT_JOB_ALLOWED_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:4173',
  'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:5176',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:4173',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:5174',
  'http://127.0.0.1:5176',
];

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value || ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseOriginList(value, fallback = []) {
  const origins = String(value || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  return origins.length > 0 ? origins : fallback;
}

const configuredAllowedOrigins = String(ENV.JOB_ALLOWED_ORIGINS || '').trim();

export const JOB_CONFIG = {
  PORT: parsePositiveInteger(ENV.JOB_PORT, 3847),
  BIND_HOST: String(ENV.JOB_BIND_HOST || '127.0.0.1').trim() || '127.0.0.1',
  ALLOWED_ORIGINS: parseOriginList(configuredAllowedOrigins, DEFAULT_JOB_ALLOWED_ORIGINS),
  ALLOWED_ORIGINS_CONFIGURED: Boolean(configuredAllowedOrigins),
  API_TOKEN: String(ENV.JOB_API_TOKEN || '').trim(),
  MAX_CONCURRENT_JOBS: 2,
  MAX_CONCURRENT_ANALYSIS: 1,
  MAX_QUEUE_SIZE: 100,
  MAX_RETRIES: 3,
  RETRY_DELAYS: [1000, 5000, 30000],
  SSE_RECONNECT_DELAY: 5000,
  KEEP_COMPLETED_JOBS_DAYS: 7,
  KEEP_FAILED_JOBS_DAYS: 30,
  API_TIMEOUT: 30000,
};

export const JOB_PRIORITY = {
  LOW: 0,
  NORMAL: 1,
  HIGH: 2,
  CRITICAL: 3,
};

export const JOB_TYPES = {
  CORPUS_ANALYSIS: 'corpus_analysis',
  FILE_PARSING: 'file_parsing',
  INCIDENT_ANALYSIS: 'incident_analysis',
  COHERENCE_PASS: 'coherence_pass',
  SCOPED_RERUN: 'scoped_rerun',
  ANALYSIS_WINDOW: 'analysis_window',
  INCIDENT_REDUCER: 'incident_reducer',
  INCIDENT_WORKER: 'incident_worker',
  CHARACTER_CANONICALIZER: 'character_canonicalizer',
  WORLD_CANONICALIZER: 'world_canonicalizer',
  GRAPH_PROJECTION: 'graph_projection',
  REVIEW_INTELLIGENCE: 'review_intelligence',
};

export const ANALYSIS_JOB_TYPES = [
  JOB_TYPES.CORPUS_ANALYSIS,
  JOB_TYPES.INCIDENT_ANALYSIS,
  JOB_TYPES.COHERENCE_PASS,
  JOB_TYPES.SCOPED_RERUN,
  JOB_TYPES.ANALYSIS_WINDOW,
  JOB_TYPES.INCIDENT_REDUCER,
  JOB_TYPES.INCIDENT_WORKER,
  JOB_TYPES.CHARACTER_CANONICALIZER,
  JOB_TYPES.WORLD_CANONICALIZER,
  JOB_TYPES.GRAPH_PROJECTION,
  JOB_TYPES.REVIEW_INTELLIGENCE,
];

export const JOB_STATUS = {
  PENDING: 'pending',
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
};

export const RETRY_ON_ERRORS = [
  'ECONNRESET',
  'ETIMEDOUT',
  'AI_RATE_LIMIT',
  'AI_SERVICE_UNAVAILABLE',
];

export const NO_RETRY_ERRORS = [
  'INVALID_INPUT',
  'FILE_NOT_FOUND',
  'UNAUTHORIZED',
  'JOB_CANCELLED',
];
