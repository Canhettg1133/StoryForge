import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cors from 'cors';
import express from 'express';
import { analysisRepository } from '../analysis/repositories/analysisRepository.js';
import { createCorpusRouter } from '../corpus/routes/corpus.js';
import { createChatAttachmentsRouter } from '../chatAttachments/routes/chatAttachments.js';
import { bootstrapPostgres } from '../storage/postgres/bootstrap.js';
import { requirePostgresDatabase } from '../storage/postgres/client.js';
import { JOB_CONFIG } from './config.js';
import { getJobQueue } from './jobQueue.js';
import { createJobsRouter } from './routes/jobs.js';

function normalizeHost(value) {
  return String(value || '').trim().toLowerCase();
}

export function isRemoteJobBindHost(host) {
  const normalized = normalizeHost(host);
  return normalized === '0.0.0.0' || normalized === '::';
}

export function validateJobServerSecurity({
  host = JOB_CONFIG.BIND_HOST,
  apiToken = JOB_CONFIG.API_TOKEN,
  allowedOriginsConfigured = JOB_CONFIG.ALLOWED_ORIGINS_CONFIGURED,
} = {}) {
  if (!isRemoteJobBindHost(host)) return;
  if (!apiToken) {
    const error = new Error('JOB_API_TOKEN is required when JOB_BIND_HOST exposes the jobs server.');
    error.code = 'JOB_API_TOKEN_REQUIRED';
    throw error;
  }
  if (!allowedOriginsConfigured) {
    const error = new Error('JOB_ALLOWED_ORIGINS is required when JOB_BIND_HOST exposes the jobs server.');
    error.code = 'JOB_ALLOWED_ORIGINS_REQUIRED';
    throw error;
  }
}

export function isJobOriginAllowed(origin, allowedOrigins = JOB_CONFIG.ALLOWED_ORIGINS) {
  if (!origin) return true;
  return allowedOrigins.includes(origin);
}

function createOriginGuard(allowedOrigins) {
  return (req, res, next) => {
    if (!isJobOriginAllowed(req.headers.origin, allowedOrigins)) {
      return res.status(403).json({
        code: 'JOB_ORIGIN_NOT_ALLOWED',
        error: 'Origin không được phép gọi Job API.',
      });
    }
    return next();
  };
}

function createTokenGuard(apiToken) {
  return (req, res, next) => {
    if (!apiToken || req.path === '/health') return next();
    const authHeader = String(req.headers.authorization || '').trim();
    const bearer = authHeader.match(/^Bearer\s+(.+)$/iu)?.[1]?.trim() || '';
    const headerToken = String(req.headers['x-job-api-token'] || '').trim();
    if (bearer === apiToken || headerToken === apiToken) return next();
    return res.status(401).json({
      code: 'JOB_AUTH_REQUIRED',
      error: 'Cần token để gọi Job API.',
    });
  };
}

function createSafeErrorHandler() {
  return (_err, _req, res, _next) => {
    if (res.headersSent) return;
    res.status(500).json({
      code: 'JOB_INTERNAL_ERROR',
      error: 'Lỗi máy chủ nội bộ.',
    });
  };
}

function createApp(queue, {
  allowedOrigins = JOB_CONFIG.ALLOWED_ORIGINS,
  apiToken = JOB_CONFIG.API_TOKEN,
} = {}) {
  const app = express();

  app.use(createOriginGuard(allowedOrigins));
  app.use(
    cors({
      origin(origin, callback) {
        callback(null, isJobOriginAllowed(origin, allowedOrigins));
      },
      credentials: true,
    }),
  );
  app.use(express.json({ limit: '5mb' }));
  app.use(createTokenGuard(apiToken));

  app.get('/health', (_req, res) => {
    res.json({
      ok: true,
      service: 'storyforge-jobs',
      timestamp: Date.now(),
    });
  });

  app.use('/api/jobs', createJobsRouter(queue));
  app.use('/api/corpus', createCorpusRouter());
  app.use('/api/chat-attachments', createChatAttachmentsRouter());

  app.use(createSafeErrorHandler());

  return app;
}

export function createJobServer({
  port = JOB_CONFIG.PORT,
  host = JOB_CONFIG.BIND_HOST,
  allowedOrigins = JOB_CONFIG.ALLOWED_ORIGINS,
  allowedOriginsConfigured = JOB_CONFIG.ALLOWED_ORIGINS_CONFIGURED,
  apiToken = JOB_CONFIG.API_TOKEN,
} = {}) {
  validateJobServerSecurity({ host, apiToken, allowedOriginsConfigured });
  const queue = getJobQueue();
  const app = createApp(queue, { allowedOrigins, apiToken });

  let server = null;

  return {
    app,
    queue,
    async start() {
      if (server) {
        return server;
      }

      requirePostgresDatabase('StoryForge jobs server');
      await bootstrapPostgres();
      await jobRepositoryRecovery(queue);
      queue.start();

      await new Promise((resolve, reject) => {
        server = app.listen(port, host, resolve);
        server.once('error', reject);
      });

      return server;
    },
    async stop() {
      await queue.stop();

      if (!server) {
        return;
      }

      await new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });

      server = null;
    },
  };
}

async function jobRepositoryRecovery(queue) {
  await queue.recoverInterruptedState?.();
  await analysisRepository.recoverExecutionSessions?.();
  await analysisRepository.failStaleProcessingAnalyses();
}

const modulePath = fileURLToPath(import.meta.url);
const entryPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
const isDirectRun = entryPath === modulePath;

if (isDirectRun) {
  const instance = createJobServer();

  instance
    .start()
    .then(() => {
      // eslint-disable-next-line no-console
      console.log(`[jobs] listening on http://${JOB_CONFIG.BIND_HOST}:${JOB_CONFIG.PORT}`);
    })
    .catch((error) => {
      // eslint-disable-next-line no-console
      console.error('[jobs] failed to start', error);
      process.exitCode = 1;
    });

  const gracefulShutdown = async () => {
    await instance.stop();
    process.exit(0);
  };

  process.on('SIGINT', gracefulShutdown);
  process.on('SIGTERM', gracefulShutdown);
}
