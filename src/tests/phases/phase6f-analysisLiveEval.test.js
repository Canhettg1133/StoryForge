/**
 * @vitest-environment node
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createJobServer } from '../../services/jobs/server.js';
import {
  evaluateAnalysisOutput,
  renderEvaluationMarkdown,
  renderEvaluationSummary,
  resolveLiveAnalysisConfig,
  validateLiveAnalysisConfig,
} from '../helpers/analysisLiveEval.js';

const hasDatabaseUrl = Boolean(String(process.env.DATABASE_URL || '').trim());
const postgresIt = hasDatabaseUrl ? it : it.skip;

function isConnectionRefused(error) {
  return error?.code === 'ECONNREFUSED'
    || String(error?.message || '').includes('ECONNREFUSED');
}

async function jsonRequest(baseUrl, pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, options);
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload?.error || `Request failed: ${response.status}`);
  }
  return payload;
}

async function waitForAnalysis(baseUrl, corpusId, analysisId, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const detail = await jsonRequest(baseUrl, `/api/corpus/${corpusId}/analysis/${analysisId}`);
    if (['completed', 'failed', 'cancelled'].includes(String(detail?.status || '').toLowerCase())) {
      return detail;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(`Timed out waiting for analysis ${analysisId}`);
}

describe('Phase 6F - Live analysis evaluator and backend route checks', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('resolves live config from dedicated test env first and validates required fields', () => {
    vi.stubEnv('DATABASE_URL', 'postgres://demo');
    vi.stubEnv('STORYFORGE_ANALYSIS_TEST_PROVIDER', 'gemini_proxy');
    vi.stubEnv('STORYFORGE_ANALYSIS_TEST_MODEL', 'gemini-2.5-flash');
    vi.stubEnv('STORYFORGE_ANALYSIS_TEST_API_KEYS', 'key-a,key-b');
    vi.stubEnv('STORYFORGE_ANALYSIS_TEST_PROXY_URL', 'http://proxy.local');

    const config = resolveLiveAnalysisConfig(process.env);
    const validation = validateLiveAnalysisConfig(config, process.env);

    expect(config.apiKeys).toEqual(['key-a', 'key-b']);
    expect(config.proxyUrl).toBe('http://proxy.local');
    expect(config.runMode).toBe('full_corpus_1m');
    expect(validation.valid).toBe(true);
  });

  it('evaluates analysis outputs with warnings but no hard failures', () => {
    const report = evaluateAnalysisOutput({
      detail: {
        id: 'analysis-1',
        corpusId: 'corpus-1',
        status: 'completed',
        provider: 'gemini_proxy',
        model: 'gemini-2.5-flash',
        startedAt: 1000,
        completedAt: 5000,
        result: {
          world_seed: {
            world_name: 'Lau tro so 18',
            world_rules: ['Khong duoc tu choi cong viec'],
          },
          style_seed: {
            pov: 'third_limited',
            tone: ['u am'],
          },
          craft: {
            style: {
              pov: 'third_limited',
              tone: ['u am'],
              styleSignals: ['khong khi u am', 'nhip truy duoi'],
            },
          },
          coverage_audit: {
            observedCount: { characters: 2, locations: 1, objects: 1, terms: 1, relationships: 1 },
            returnedCount: { characters: 2, locations: 1, objects: 1, terms: 0, relationships: 1 },
            coverage: { characters: 1, locations: 1, objects: 1, terms: 0, relationships: 1 },
            complete: false,
          },
          knowledge: {
            characters: [{ name: 'Lam Tham' }, { name: 'Dao Dao' }],
            locations: [{ name: 'Nha tro so 18' }],
            objects: [{ name: 'Chia khoa' }],
            terms: [],
          },
          relationships: [{ character1Id: 'Lam Tham', character2Id: 'Dao Dao', type: 'allies' }],
          incidents: [
            { id: 'inc-1', title: 'Mo dau', chapterStart: 1, chapterEnd: 1, confidence: 1, evidence: [] },
            { id: 'inc-2', title: 'Mo dau', chapterStart: 1, chapterEnd: 1, confidence: 1, evidence: [] },
          ],
          events: {
            majorEvents: [
              { id: 'evt-1', chapter: 1, evidence: [] },
            ],
          },
          analysis_run_manifest: {
            runMode: 'full_corpus_1m',
            startedAt: 1000,
            completedAt: 5000,
          },
          pass_status: {
            pass_a: { status: 'completed', startedAt: 1000, completedAt: 2000 },
            pass_c: { status: 'degraded', startedAt: 2000, completedAt: 5000 },
          },
        },
      },
      artifactPayload: {
        artifactVersion: 'v3',
        artifact: {
          artifact_version: 'v3',
          canonical_corpus: { chapterCount: 18 },
        },
      },
      windowsPayload: {
        beatCount: 1,
        windows: [{ id: 'window:1' }],
      },
      graphPayload: {
        graph: { nodes: [{ id: 'n1' }], edges: [] },
      },
      incidentsPayload: {
        incidents: [
          { id: 'inc-1', title: 'Mo dau', chapterStart: 1, chapterEnd: 1, confidence: 1, evidence: [] },
          { id: 'inc-2', title: 'Mo dau', chapterStart: 1, chapterEnd: 1, confidence: 1, evidence: [] },
        ],
      },
      reviewQueuePayload: {
        total: 2,
        stats: { total: 2 },
      },
      expectations: {
        label: 'fixture-demo',
      },
    });

    expect(report.verdict).toBe('pass_with_warnings');
    expect(report.warnings.length).toBeGreaterThan(0);
    expect(report.hardFailures).toHaveLength(0);
    expect(renderEvaluationMarkdown(report)).toContain('fixture-demo');
    expect(renderEvaluationSummary(report)).toContain('verdict=pass_with_warnings');
  });

  postgresIt('boots backend locally, uploads fixture text, runs non-live analysis, and serves artifact routes', async () => {
    vi.stubEnv('STORYFORGE_GEMINI_PROXY_KEYS', '');
    vi.stubEnv('STORYFORGE_GEMINI_PROXY_KEY', '');
    vi.stubEnv('STORYFORGE_PROXY_API_KEY', '');
    vi.stubEnv('STORYFORGE_GEMINI_DIRECT_API_KEYS', '');
    vi.stubEnv('STORYFORGE_GEMINI_DIRECT_API_KEY', '');
    vi.stubEnv('GEMINI_API_KEY', '');

    const serverInstance = createJobServer({ port: 0 });
    let server;
    try {
      server = await serverInstance.start();
    } catch (error) {
      if (isConnectionRefused(error)) {
        return;
      }
      throw error;
    }
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 3847;
    const baseUrl = `http://127.0.0.1:${port}`;
    let corpusId = null;

    try {
      const formData = new FormData();
      formData.append(
        'file',
        new Blob([
          'Chuong 01: Hoan nghenh nhap chuc\n\nLam Tham bi keo vao nha tro so 18 va doc quy tac ky la.\n\nChuong 02: Cong viec dau tien\n\nAnh gap nguy hiem va bat dau sinh ton theo quy tac.',
        ], { type: 'text/plain' }),
        'backend-e2e-fixture.txt',
      );
      formData.append('metadata', JSON.stringify({ title: 'Backend E2E Fixture', language: 'vi' }));

      const corpus = await jsonRequest(baseUrl, '/api/corpus', {
        method: 'POST',
        body: formData,
      });
      corpusId = corpus.id;

      const created = await jsonRequest(baseUrl, `/api/corpus/${corpusId}/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          runMode: 'full_corpus_1m',
          provider: 'gemini_proxy',
          model: 'gemini-2.5-flash',
          maxParts: 1,
        }),
      });

      const detail = await waitForAnalysis(baseUrl, corpusId, created.id);
      const incidents = await jsonRequest(baseUrl, `/api/corpus/${corpusId}/incidents?analysisId=${created.id}`);
      const artifact = await jsonRequest(baseUrl, `/api/corpus/${corpusId}/analysis/${created.id}/artifact`);
      const graph = await jsonRequest(baseUrl, `/api/corpus/${corpusId}/analysis/${created.id}/graph`);

      expect(detail.status).toBe('completed');
      expect(detail.startedAt).toBeTruthy();
      expect(detail.completedAt).toBeTruthy();
      expect(detail.currentPhase).toBeTruthy();
      expect(detail.manifest || detail.result?.analysis_run_manifest).toBeTruthy();
      expect(artifact.artifactVersion).toBe('v3');
      expect(typeof incidents.total).toBe('number');
      expect(Array.isArray(incidents.items || incidents.incidents || [])).toBe(true);
      expect(Array.isArray(graph.graph?.nodes || [])).toBe(true);
    } finally {
      if (corpusId) {
        await fetch(`${baseUrl}/api/corpus/${corpusId}`, { method: 'DELETE' }).catch(() => {});
      }
      await serverInstance.stop();
    }
  });
});
