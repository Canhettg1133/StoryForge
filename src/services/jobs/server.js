import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cors from 'cors';
import express from 'express';
import { initCorpusSchema } from '../corpus/db/schema.js';
import { createCorpusRouter } from '../corpus/routes/corpus.js';
import { JOB_CONFIG } from './config.js';
import { getJobQueue } from './jobQueue.js';
import { createJobsRouter } from './routes/jobs.js';

function createApp(queue) {
  const app = express();

  app.use(
    cors({
      origin: true,
      credentials: true,
    }),
  );
  app.use(express.json({ limit: '5mb' }));

  app.get('/health', (_req, res) => {
    res.json({
      ok: true,
      service: 'storyforge-jobs',
      timestamp: Date.now(),
    });
  });

  app.use('/api/jobs', createJobsRouter(queue));
  app.use('/api/corpus', createCorpusRouter());

  app.use((err, _req, res, _next) => {
    res.status(500).json({
      error: err?.message || 'Internal server error.',
    });
  });

  return app;
}

export function createJobServer({ port = JOB_CONFIG.PORT } = {}) {
  initCorpusSchema();
  const queue = getJobQueue();
  const app = createApp(queue);

  let server = null;

  return {
    app,
    queue,
    async start() {
      if (server) {
        return server;
      }

      queue.start();

      await new Promise((resolve, reject) => {
        server = app.listen(port, '0.0.0.0', resolve);
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

const modulePath = fileURLToPath(import.meta.url);
const entryPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
const isDirectRun = entryPath === modulePath;

if (isDirectRun) {
  const instance = createJobServer();

  instance
    .start()
    .then(() => {
      // eslint-disable-next-line no-console
      console.log(`[jobs] listening on http://localhost:${JOB_CONFIG.PORT}`);
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
