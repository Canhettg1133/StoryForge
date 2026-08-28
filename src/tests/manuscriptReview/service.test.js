import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import db from '../../services/db/database.js';
import { startManuscriptReview } from '../../features/manuscriptReview/service.js';
import { loadReviewReports } from '../../features/manuscriptReview/repository.js';
import { LITERARY_CRITERIA } from '../../features/manuscriptReview/constants.js';
import keyManager from '../../services/ai/keyManager.js';
import { AG_PROXY_PROFILE_ID } from '../../services/ai/openAIProxyConfig.js';

const evidence = { paragraph_id: 'p1', quote: 'Mưa' };
const snapshot = {
  project_id: 1, chapter_id: 2, scene_id: 3, scope: 'scene', text: 'Mưa gõ mái hiên.', sceneParagraphs: ['Mưa gõ mái hiên.'],
  paragraphs: [{ id: 'p1', text: 'Mưa gõ mái hiên.', runs: [{ offset: 0, length: 15, from: 1 }] }], context: {},
};
const route = { provider: 'ollama', model: 'qwen3:small' };
const results = {
  adherence: { summary: 'Đánh giá yêu cầu.', findings: [], criteria: [] },
  literary: { summary: 'Đánh giá văn.', findings: [], scores: LITERARY_CRITERIA.map(({ id }) => ({ criterion_id: id, score: 4, strength: 'Có hình ảnh.', limitation: 'Cần thêm bối cảnh.', evidence: [evidence], confidence: 0.7 })) },
  signals: { summary: 'Không thấy rõ tín hiệu.', findings: [], signal_level: 'none' },
};
function response(mode, override) {
  return new Response(`${JSON.stringify({ message: { content: override ?? JSON.stringify(results[mode]) }, done: false })}\n${JSON.stringify({ done: true, done_reason: 'stop' })}\n`);
}

describe('review orchestration through the real AI client and IndexedDB', () => {
  const runs = [];
  function start(options = {}) { const run = startManuscriptReview({ snapshot, route, modes: ['signals'], ...options }); runs.push(run); return run; }
  beforeEach(async () => {
    localStorage.clear(); vi.stubGlobal('crypto', webcrypto);
    await db.qaReports.clear();
  });
  afterEach(() => { runs.splice(0).forEach((run) => run.cancel()); vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('runs three passes sequentially with frozen routing, independent prompts and only QA writes', async () => {
    const requests = [];
    vi.stubGlobal('fetch', vi.fn((_url, init) => {
      const body = JSON.parse(init.body); requests.push(body);
      // Changing the global model/quality does not change this run.
      localStorage.setItem('sf-ai-settings', JSON.stringify({ provider: 'gemini_direct', quality: 'best' }));
      return Promise.resolve(response(['adherence', 'literary', 'signals'][requests.length - 1]));
    }));
    const progress = [];
    const sceneBefore = await db.scenes.toArray();
    const outcome = await start({ modes: ['signals', 'adherence', 'literary'], onProgress: (event) => progress.push(event) }).done;
    expect(outcome.errors).toEqual({});
    expect(outcome.reports).toHaveLength(3);
    expect(requests.map((request) => request.model)).toEqual(Array(3).fill('qwen3:small'));
    expect(requests[1].messages.some((message) => message.content.includes('Đánh giá yêu cầu.'))).toBe(false);
    expect(progress.filter((event) => event.status === 'running').map((event) => event.mode)).toEqual(['adherence', 'literary', 'signals']);
    const saved = await loadReviewReports({ projectId: 1, sceneId: 3, scope: 'scene' });
    expect(saved).toHaveLength(3);
    expect(saved.every((row) => row.project_id === 1 && row.chapter_id === 2 && row.scene_id === 3 && row.source_signature.length === 64)).toBe(true);
    expect(JSON.stringify(saved)).not.toMatch(/"(?:document|runs|apiKey|connectionFingerprint)"/u);
    expect(await db.scenes.toArray()).toEqual(sceneBefore);
  });

  it('keeps previous successful rows on a failed pass; retry replaces only that pass', async () => {
    await db.qaReports.bulkAdd([
      { project_id: 1, scene_id: 3, report_type: 'other_qa', summary: 'Không đụng vào.' },
      { project_id: 1, scene_id: 3, scope: 'scene', mode: 'signals', report_type: 'manuscript_review:signals:scene', result: { summary: 'Báo cáo cũ.' } },
    ]);
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(response('signals', '{broken'))));
    expect((await start().done).errors.signals).toBeTruthy();
    expect((await loadReviewReports({ projectId: 1, sceneId: 3, scope: 'scene' }))[0].result.summary).toBe('Báo cáo cũ.');
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(response('signals'))));
    await start().done;
    expect(await db.qaReports.count()).toBe(2);
    expect((await loadReviewReports({ projectId: 1, sceneId: 3, scope: 'scene' }))[0].result.summary).toBe(results.signals.summary);
    expect(await db.qaReports.where('report_type').equals('other_qa').count()).toBe(1);
  });

  it('does not fallback or retry after provider failure, but continues the next selected pass', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response('Unavailable', { status: 503 })).mockResolvedValueOnce(response('signals')));
    const outcome = await start({ modes: ['adherence', 'signals'] }).done;
    expect(outcome.errors.adherence).toBeTruthy();
    expect(outcome.reports.map((row) => row.mode)).toEqual(['signals']);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('does not silently retry the proxy relay as a direct request', async () => {
    keyManager.addKey('gemini_proxy', 'review-only-test-key');
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('No relay here', { status: 404 }))));
    const outcome = await start({ route: { provider: 'openai_proxy', proxyProfileId: AG_PROXY_PROFILE_ID, model: 'test-model' } }).done;
    expect(outcome.errors.signals).toBeTruthy();
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('does not apply prose-cleanup rules to literal words inside structured evidence', async () => {
    const quote = 'Mã antmlThinking xuất hiện trong sổ.';
    const input = { ...snapshot, text: quote, sceneParagraphs: [quote], paragraphs: [{ id: 'p1', text: quote, runs: [{ offset: 0, from: 1, length: quote.length }] }] };
    const output = { summary: 'Một chi tiết trong sổ.', signal_level: 'low', findings: [{ criterion_id: 'repetition', severity: 'low', explanation: 'Cân nhắc trong cảnh.', suggestion: 'Đọc lại.', confidence: 0.7, evidence: [{ paragraph_id: 'p1', quote }] }] };
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(response('signals', JSON.stringify(output)))));
    const outcome = await start({ snapshot: input }).done;
    expect(outcome.errors).toEqual({});
    expect(outcome.reports[0]?.result.findings[0]?.evidence[0].quote).toBe(quote);
  });

  it('cancels a waiting request and never starts the remaining passes', async () => {
    let signal;
    vi.stubGlobal('fetch', vi.fn((_url, init) => new Promise((_resolve, reject) => {
      signal = init.signal;
      signal.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')));
    })));
    const run = start({ modes: ['adherence', 'signals'] });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    run.cancel();
    expect((await run.done).cancelled).toBe(true);
    expect(signal.aborted).toBe(true);
    expect(await db.qaReports.count()).toBe(0);
  });

  it('stops not-yet-started passes if the connection endpoint changes', async () => {
    vi.stubGlobal('fetch', vi.fn(() => {
      localStorage.setItem('sf-ai-settings', JSON.stringify({ ollamaUrl: 'http://localhost:12000' }));
      return Promise.resolve(response('adherence'));
    }));
    const outcome = await start({ modes: ['adherence', 'signals'] }).done;
    expect(outcome.reports).toHaveLength(1);
    expect(outcome.errors.signals).toMatch(/cấu hình|kết nối/iu);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('enforces source/prompt/context budgets before calling a provider', async () => {
    vi.stubGlobal('fetch', vi.fn());
    await expect(start({ snapshot: { ...snapshot, text: 'a'.repeat(60001) } }).done).rejects.toThrow(/60.000/u);
    await expect(start({ authorRequest: 'yêu cầu '.repeat(20000) }).done).rejects.toThrow(/token/iu);
    await expect(start({ snapshot: { ...snapshot, text: 'mưa '.repeat(7000), paragraphs: [{ id: 'p1', text: 'mưa '.repeat(7000), runs: [] }] }, route: { provider: 'ollama', model: 'phi3' } }).done).rejects.toThrow(/Ollama|context/iu);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('distinguishes paragraph boundaries from hard breaks in signatures', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(response('signals'))));
    const text = 'a\n\nb';
    const oneParagraph = { ...snapshot, text, sceneParagraphs: [text], paragraphs: [{ id: 'p1', text, runs: [] }] };
    const twoParagraphs = { ...snapshot, text, sceneParagraphs: ['a', 'b'], paragraphs: [{ id: 'p1', text: 'a', runs: [] }, { id: 'p2', text: 'b', runs: [] }] };
    const first = (await start({ snapshot: oneParagraph }).done).reports[0];
    const second = (await start({ snapshot: twoParagraphs }).done).reports[0];
    expect(first.source_signature).not.toBe(second.source_signature);
    expect(first.scene_signature).not.toBe(second.scene_signature);
  });

  it('rejects oversized output and times out its own instance without retrying', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(response('signals', 'x'.repeat(64001)))));
    expect((await start().done).errors.signals).toMatch(/giới hạn/iu);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    vi.stubGlobal('fetch', vi.fn((_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))))));
    const run = start();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    await vi.advanceTimersByTimeAsync(180000);
    expect((await run.done).errors.signals).toMatch(/180/u);
    expect(await db.qaReports.count()).toBe(0);
  });
});
