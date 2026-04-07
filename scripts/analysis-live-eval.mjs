import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createJobServer } from '../src/services/jobs/server.js';
import {
  evaluateAnalysisOutput,
  mergeExpectations,
  renderEvaluationMarkdown,
  renderEvaluationSummary,
  resolveLiveAnalysisConfig,
  validateLiveAnalysisConfig,
} from '../src/tests/helpers/analysisLiveEval.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const fixturePath = path.join(repoRoot, 'src', 'tests', 'fixtures', 'corpus', 'so-18-test.txt');
const expectationsPath = path.join(repoRoot, 'src', 'tests', 'fixtures', 'corpus', 'so-18-test.expectations.json');

function normalizeText(value) {
  return String(value || '').replace(/\s+/gu, ' ').trim();
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

async function readJson(filePath) {
  const raw = await readFile(filePath, 'utf8');
  return JSON.parse(raw);
}

async function requestJson(baseUrl, pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, options);
  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json') ? await response.json() : null;

  if (!response.ok) {
    throw new Error(payload?.error || `Request failed: ${response.status} ${pathname}`);
  }

  return payload;
}

async function waitForAnalysis(baseUrl, corpusId, analysisId, timeoutMs) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const detail = await requestJson(baseUrl, `/api/corpus/${corpusId}/analysis/${analysisId}`);
    const status = normalizeText(detail?.status || '').toLowerCase();
    if (['completed', 'failed', 'cancelled'].includes(status)) {
      return detail;
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  throw new Error(`Timed out waiting for analysis ${analysisId}`);
}

async function removeCorpus(baseUrl, corpusId) {
  if (!corpusId) return;
  await fetch(`${baseUrl}/api/corpus/${corpusId}`, { method: 'DELETE' }).catch(() => {});
}

function buildOutputDir(label) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return path.join(repoRoot, 'tmp', 'analysis-evals', label, timestamp);
}

async function main() {
  const expectations = mergeExpectations(await readJson(expectationsPath));
  const liveConfig = resolveLiveAnalysisConfig(process.env);
  const validation = validateLiveAnalysisConfig(liveConfig, process.env);
  if (!validation.valid) {
    throw new Error(validation.errors.join('\n'));
  }

  const serverInstance = createJobServer({
    port: toNumber(process.env.STORYFORGE_ANALYSIS_TEST_PORT, 0),
  });
  const server = await serverInstance.start();
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 3847;
  const baseUrl = `http://127.0.0.1:${port}`;

  const outputDir = buildOutputDir('so-18-test');
  await mkdir(outputDir, { recursive: true });

  const buffer = await readFile(fixturePath);
  const formData = new FormData();
  formData.append('file', new Blob([buffer], { type: 'text/plain' }), 'so-18-test.txt');
  formData.append('metadata', JSON.stringify({
    title: expectations.label,
    language: 'vi',
  }));

  let corpusId = null;
  let analysisId = null;

  try {
    const createdCorpus = await requestJson(baseUrl, '/api/corpus', {
      method: 'POST',
      body: formData,
    });
    corpusId = createdCorpus.id;

    const startedLocallyAt = Date.now();
    const createdAnalysis = await requestJson(baseUrl, `/api/corpus/${corpusId}/analyze`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        provider: liveConfig.provider,
        model: liveConfig.model,
        apiKeys: liveConfig.apiKeys,
        proxyUrl: liveConfig.proxyUrl,
        directUrl: liveConfig.directUrl,
        runMode: liveConfig.runMode,
        maxParts: liveConfig.maxParts,
        chunkSize: liveConfig.chunkSize,
      }),
    });
    analysisId = createdAnalysis.id;

    const timeoutMs = toNumber(process.env.STORYFORGE_ANALYSIS_TEST_TIMEOUT_MS, 30 * 60 * 1000);
    const detail = await waitForAnalysis(baseUrl, corpusId, analysisId, timeoutMs);
    const completedLocallyAt = Date.now();

    const [artifactPayload, windowsPayload, graphPayload, incidentsPayload, reviewQueuePayload] = await Promise.all([
      requestJson(baseUrl, `/api/corpus/${corpusId}/analysis/${analysisId}/artifact`),
      requestJson(baseUrl, `/api/corpus/${corpusId}/analysis/${analysisId}/windows`),
      requestJson(baseUrl, `/api/corpus/${corpusId}/analysis/${analysisId}/graph`),
      requestJson(baseUrl, `/api/corpus/${corpusId}/incidents?analysisId=${analysisId}`),
      requestJson(baseUrl, `/api/corpus/${corpusId}/review-queue?analysisId=${analysisId}&limit=200`),
    ]);

    const report = evaluateAnalysisOutput({
      detail,
      artifactPayload,
      windowsPayload,
      graphPayload,
      incidentsPayload,
      reviewQueuePayload,
      expectations,
      startedAt: startedLocallyAt,
      completedAt: completedLocallyAt,
    });

    const snapshot = {
      detail,
      artifactPayload,
      windowsPayload,
      graphPayload,
      incidentsPayload,
      reviewQueuePayload,
      report,
    };

    await Promise.all([
      writeFile(path.join(outputDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8'),
      writeFile(path.join(outputDir, 'report.md'), renderEvaluationMarkdown(report), 'utf8'),
      writeFile(path.join(outputDir, 'summary.txt'), `${renderEvaluationSummary(report)}\n`, 'utf8'),
      writeFile(path.join(outputDir, 'artifact.snapshot.json'), `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8'),
    ]);

    console.log('Live analysis eval completed.');
    console.log(`corpusId=${corpusId}`);
    console.log(`analysisId=${analysisId}`);
    console.log(`outputDir=${outputDir}`);
    console.log(renderEvaluationSummary(report));

    if (report.verdict === 'fail') {
      process.exitCode = 1;
    }
  } finally {
    const keepCorpus = ['1', 'true', 'yes'].includes(String(process.env.STORYFORGE_ANALYSIS_TEST_KEEP_CORPUS || '').toLowerCase());
    if (!keepCorpus) {
      await removeCorpus(baseUrl, corpusId);
    }
    await serverInstance.stop();
  }
}

main().catch((error) => {
  console.error('[analysis:eval:live] failed');
  console.error(error?.stack || error?.message || error);
  process.exitCode = 1;
});
