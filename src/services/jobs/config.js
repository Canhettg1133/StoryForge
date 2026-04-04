export const JOB_CONFIG = {
  PORT: 3847,
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
};

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

