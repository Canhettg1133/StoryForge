import express from 'express';
import { JOB_CONFIG, JOB_PRIORITY, JOB_TYPES } from '../config.js';

function isObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function normalizePriority(priorityInput, fallback) {
  if (Number.isFinite(priorityInput)) {
    return Math.max(0, Math.min(3, Number(priorityInput)));
  }

  if (typeof priorityInput === 'string') {
    const key = priorityInput.trim().toUpperCase();
    if (key in JOB_PRIORITY) {
      return JOB_PRIORITY[key];
    }
  }

  if (typeof fallback === 'string') {
    const key = fallback.trim().toUpperCase();
    if (key in JOB_PRIORITY) {
      return JOB_PRIORITY[key];
    }
  }

  return JOB_PRIORITY.NORMAL;
}

function sendSseEvent(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

export function createJobsRouter(queue) {
  const router = express.Router();

  router.post('/', async (req, res) => {
    try {
      const { type, inputData, dependsOn, priority } = req.body || {};

      if (!Object.values(JOB_TYPES).includes(type)) {
        const expectedTypes = Object.values(JOB_TYPES).join(', ');
        return res.status(400).json({
          error: `Invalid job type. Expected one of: ${expectedTypes}.`,
        });
      }

      if (!isObject(inputData)) {
        return res.status(400).json({
          error: 'inputData is required and must be an object.',
        });
      }

      const job = await queue.createJob({
        type,
        inputData,
        dependsOn: Array.isArray(dependsOn) ? dependsOn : [],
        priority: normalizePriority(priority, inputData?.options?.priority),
      });

      return res.status(201).json({
        id: job.id,
        status: job.status,
        createdAt: job.createdAt,
      });
    } catch (error) {
      if (error?.code === 'QUEUE_FULL') {
        return res.status(429).json({ error: error.message });
      }

      if (error?.code === 'INVALID_INPUT') {
        return res.status(400).json({ error: error.message });
      }

      if (
        typeof error?.message === 'string' &&
        error.message.includes('FOREIGN KEY')
      ) {
        return res.status(400).json({
          error: 'One or more dependency job IDs do not exist.',
        });
      }

      return res.status(500).json({
        error: error?.message || 'Failed to create job.',
      });
    }
  });

  router.get('/:id/progress', async (req, res) => {
    const jobId = req.params.id;
    const job = await queue.getJobAsync(jobId);

    if (!job) {
      return res.status(404).json({ error: 'Job not found.' });
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    res.write(`retry: ${JOB_CONFIG.SSE_RECONNECT_DELAY}\n\n`);
    sendSseEvent(res, 'snapshot', job);

    const heartbeat = setInterval(() => {
      res.write(': ping\n\n');
    }, 15000);

    const listener = (event) => {
      if (event.jobId !== jobId) {
        return;
      }

      sendSseEvent(res, event.event, event.data);

      if (
        event.event === 'complete' ||
        event.event === 'cancelled' ||
        (event.event === 'error' && event.data?.retrying === false)
      ) {
        clearInterval(heartbeat);
        queue.off('job_event', listener);
        res.end();
      }
    };

    queue.on('job_event', listener);

    req.on('close', () => {
      clearInterval(heartbeat);
      queue.off('job_event', listener);
      res.end();
    });
  });

  router.get('/:id', async (req, res) => {
    const job = await queue.getJobAsync(req.params.id);
    if (!job) {
      return res.status(404).json({ error: 'Job not found.' });
    }

    return res.json(job);
  });

  router.get('/', async (req, res) => {
    const { status, type, limit, offset } = req.query;
    const result = await queue.listJobsAsync({
      status,
      type,
      limit,
      offset,
    });

    return res.json(result);
  });

  router.delete('/:id', async (req, res) => {
    const job = await queue.cancelJob(req.params.id);
    if (!job) {
      return res.status(404).json({ error: 'Job not found.' });
    }

    return res.json({
      id: job.id,
      status: job.status,
    });
  });

  return router;
}
