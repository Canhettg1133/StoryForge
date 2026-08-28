import fs from 'node:fs';
import path from 'node:path';

import { createTranslatorOpenAIProxyWebHandler } from '../../../api/translator-openai-proxy.js';

const apiKey = String(process.env.STORYFORGE_LIVE_CATIE_KEY || '').trim();
const baseUrl = String(process.env.STORYFORGE_LIVE_CATIE_BASE_URL || 'https://catiecli.sukaka.top/v1')
  .trim()
  .replace(/\/+$/u, '');
const model = String(process.env.STORYFORGE_LIVE_CATIE_MODEL || 'gcli-gemini-3-flash-preview').trim();
const waveGapMs = Math.max(60_000, Number(process.env.STORYFORGE_LIVE_CATIE_WAVE_GAP_MS || 65_000));
const cleanWaitMs = Math.max(60_000, Number(process.env.STORYFORGE_LIVE_CATIE_CLEAN_WAIT_MS || 70_000));
const sourceLength = Math.max(500, Number(process.env.STORYFORGE_LIVE_CATIE_SOURCE_LENGTH || 4_900));
const diagnosticMode = String(process.env.STORYFORGE_LIVE_CATIE_MODE || 'live-matrix').trim();
const nativeFetch = globalThis.fetch.bind(globalThis);

if (!apiKey) {
  throw new Error('Thiếu STORYFORGE_LIVE_CATIE_KEY.');
}

const apiSource = fs.readFileSync(
  path.join(process.cwd(), 'public/translator-runtime/js/gemini/api.js'),
  'utf8',
);
const relayGroupSizeMatch = apiSource.match(/PROXY_RELAY_CHAT_BATCH_MAX_SIZE\s*=\s*(\d+)/u);
if (!relayGroupSizeMatch) {
  throw new Error('Không đọc được PROXY_RELAY_CHAT_BATCH_MAX_SIZE từ production client.');
}
const localRelayGroupSize = Number(relayGroupSizeMatch[1]);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildSource() {
  const seed = '夜色沉 xuống trên thành cổ. Lâm Phong siết chuôi kiếm, nhìn đoàn người đang vượt qua cổng phía bắc. ';
  return seed.repeat(Math.ceil(sourceLength / seed.length)).slice(0, sourceLength);
}

function buildPayload(id) {
  return {
    model,
    messages: [
      {
        role: 'system',
        content: 'Dịch đoạn truyện sau sang tiếng Việt tự nhiên. Chỉ trả về bản dịch, không giải thích.',
      },
      {
        role: 'user',
        content: `[LIVE_DIAGNOSTIC_${id}]\n${buildSource()}`,
      },
    ],
    temperature: 0.7,
    stream: false,
    max_tokens: 32_768,
  };
}

function parseBody(text) {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return text;
  }
}

function summarizeError(body) {
  if (!body) return '';
  if (typeof body === 'string') return body.slice(0, 240);
  const value = body?.detail || body?.error?.message || body?.error || body?.message || body?.code || '';
  return String(value).slice(0, 240);
}

function printEvent(name, data = {}) {
  process.stdout.write(`${JSON.stringify({ event: name, at: new Date().toISOString(), ...data })}\n`);
}

async function requestDirect(payload, meta) {
  const startedAt = Date.now();
  const response = await nativeFetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  const text = await response.text();
  const body = parseBody(text);
  return {
    ...meta,
    ok: response.ok,
    status: response.status,
    latencyMs: Date.now() - startedAt,
    error: response.ok ? '' : summarizeError(body),
  };
}

const relayHandler = createTranslatorOpenAIProxyWebHandler({
  requireFeatureImpl: async (_request, featureKey) => ({
    ok: true,
    decision: { allowed: true, feature: featureKey },
    user: { id: 'live-catie-diagnostic' },
  }),
});

function createRelayRuntime() {
  return {
    env: {
      OPENAI_PROXY_BATCH_CONCURRENCY: '6',
      OPENAI_PROXY_RATE_LIMIT_MAX: '10000',
      USAGE_LOGGING_ENABLED: 'false',
    },
    platform: 'live-diagnostic',
  };
}

async function runAdminUsageEvidence() {
  const insertedRows = [];
  const deferredTasks = [];
  const usageHandler = createTranslatorOpenAIProxyWebHandler({
    requireFeatureImpl: async (_request, featureKey) => ({
      ok: true,
      decision: { allowed: true, feature: featureKey },
      user: { id: 'admin-usage-diagnostic' },
      supabase: {
        from: () => ({
          insert: async (row) => {
            insertedRows.push(row);
            return { error: null };
          },
        }),
      },
    }),
  });

  const runInvocation = async ({ size, upstreamStatus }) => {
    const payloads = Array.from({ length: size }, (_, index) => buildPayload(`admin_${size}_${index}`));
    globalThis.fetch = async () => new Response(JSON.stringify(
      upstreamStatus === 200
        ? { choices: [{ message: { content: 'Bản dịch hợp lệ.' } }] }
        : { detail: '速率限制: 10 次/分钟' },
    ), {
      status: upstreamStatus,
      headers: { 'content-type': 'application/json' },
    });
    const request = new Request('https://storyforge.live.test/api/translator-openai-proxy', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer live-diagnostic-storyforge-token',
        'Content-Type': 'application/json',
        'X-StoryForge-Upstream-Key': apiKey,
      },
      body: JSON.stringify({
        action: size === 1 ? 'chat' : 'chat_stream_batch',
        baseUrl,
        chatCompletionsPath: '/v1/chat/completions',
        templateId: 'convert',
        ...(size === 1 ? { payload: payloads[0] } : { payloads }),
      }),
    });
    const response = await usageHandler(request, {
      env: {
        OPENAI_PROXY_BATCH_CONCURRENCY: '6',
        OPENAI_PROXY_RATE_LIMIT_MAX: '10000',
        USAGE_LOGGING_ENABLED: 'true',
      },
      defer(promise) {
        deferredTasks.push(Promise.resolve(promise));
        return promise;
      },
    });
    const text = await response.text();
    const innerStatuses = size === 1
      ? [response.status]
      : text.split('\n').map((line) => line.trim()).filter(Boolean).map((line) => JSON.parse(line).status);
    await Promise.all(deferredTasks.splice(0));
    return { size, upstreamStatus, innerStatuses };
  };

  try {
    const invocations = [
      await runInvocation({ size: 2, upstreamStatus: 429 }),
      await runInvocation({ size: 8, upstreamStatus: 429 }),
      await runInvocation({ size: 1, upstreamStatus: 200 }),
      await runInvocation({ size: 10, upstreamStatus: 429 }),
    ];
    printEvent('admin-usage-evidence', {
      invocations,
      adminRows: insertedRows.map((row) => ({
        action: row.metadata?.action,
        count: row.count,
        status: row.status,
      })),
    });
  } finally {
    globalThis.fetch = nativeFetch;
  }
}

async function requestRelayGroup(payloads, groupIndex) {
  const request = new Request('https://storyforge.live.test/api/translator-openai-proxy', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer live-diagnostic-storyforge-token',
      'Content-Type': 'application/json',
      'X-StoryForge-Upstream-Key': apiKey,
    },
    body: JSON.stringify({
      action: payloads.length === 1 ? 'chat' : 'chat_stream_batch',
      baseUrl,
      chatCompletionsPath: '/v1/chat/completions',
      templateId: 'convert',
      ...(payloads.length === 1 ? { payload: payloads[0] } : { payloads }),
    }),
  });

  const response = await relayHandler(request, createRelayRuntime());
  const text = await response.text();
  if (payloads.length === 1) {
    const body = parseBody(text);
    return [{
      groupIndex,
      itemIndex: 0,
      ok: response.ok,
      status: response.status,
      error: response.ok ? '' : summarizeError(body),
    }];
  }

  const entries = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  return entries.map((entry) => ({
    groupIndex,
    itemIndex: Number(entry.index),
    ok: Boolean(entry.ok),
    status: Number(entry.status),
    error: entry.ok ? '' : summarizeError(entry.body),
  }));
}

function splitPayloads(payloads, groupSizes) {
  const groups = [];
  let offset = 0;
  groupSizes.forEach((size) => {
    groups.push(payloads.slice(offset, offset + size));
    offset += size;
  });
  if (offset !== payloads.length || groups.some((group) => group.length === 0)) {
    throw new Error(`Nhóm relay không khớp: ${groupSizes.join('+')} cho ${payloads.length} request.`);
  }
  return groups;
}

async function runWave({ scenario, wave, count, relayGroupSizes = null }) {
  const waveStartedAt = Date.now();
  const payloads = Array.from({ length: count }, (_, index) => buildPayload(`${scenario}_${wave}_${index + 1}`));
  const upstreamCalls = [];
  let activeUpstream = 0;
  let maxActiveUpstream = 0;

  globalThis.fetch = async (url, options) => {
    const startedAt = Date.now();
    activeUpstream += 1;
    maxActiveUpstream = Math.max(maxActiveUpstream, activeUpstream);
    const record = {
      index: upstreamCalls.length,
      startedOffsetMs: startedAt - waveStartedAt,
      completedOffsetMs: null,
      status: null,
    };
    upstreamCalls.push(record);
    try {
      const response = await nativeFetch(url, options);
      record.status = response.status;
      return response;
    } finally {
      record.completedOffsetMs = Date.now() - waveStartedAt;
      activeUpstream -= 1;
    }
  };

  try {
    let results;
    if (!relayGroupSizes) {
      results = await Promise.all(payloads.map((payload, index) => requestDirect(payload, {
        groupIndex: index,
        itemIndex: 0,
      })));
      upstreamCalls.push(...results.map((result, index) => ({
        index,
        startedOffsetMs: 0,
        completedOffsetMs: result.latencyMs,
        status: result.status,
      })));
      maxActiveUpstream = count;
    } else {
      const groups = splitPayloads(payloads, relayGroupSizes);
      const nested = await Promise.all(groups.map((group, index) => requestRelayGroup(group, index)));
      results = nested.flat();
    }

    const statuses = results.reduce((acc, result) => {
      const key = String(result.status);
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});
    const errors = [...new Set(results.map((result) => result.error).filter(Boolean))];
    const summary = {
      scenario,
      wave,
      requested: count,
      relayGroupSizes,
      ok: results.filter((result) => result.ok).length,
      failed: results.filter((result) => !result.ok).length,
      statuses,
      errors,
      durationMs: Date.now() - waveStartedAt,
      maxActiveUpstream,
      upstreamStartOffsetsMs: upstreamCalls.map((call) => call.startedOffsetMs),
      upstreamCompletedOffsetsMs: upstreamCalls.map((call) => call.completedOffsetMs),
    };
    printEvent('wave-summary', summary);
    return { ...summary, waveStartedAt };
  } finally {
    globalThis.fetch = nativeFetch;
  }
}

async function waitFromCompletion(label) {
  printEvent('clean-window-wait', { label, waitMs: cleanWaitMs });
  await sleep(cleanWaitMs);
}

async function runTwoWaveScenario({ scenario, count, relayGroupSizes = null }) {
  const first = await runWave({ scenario, wave: 1, count, relayGroupSizes });
  const elapsed = Date.now() - first.waveStartedAt;
  const remaining = Math.max(0, waveGapMs - elapsed);
  printEvent('wave-gap-wait', { scenario, elapsedMs: elapsed, remainingMs: remaining, targetGapMs: waveGapMs });
  if (remaining > 0) await sleep(remaining);
  const secondStartedAt = Date.now();
  const second = await runWave({ scenario, wave: 2, count, relayGroupSizes });
  return {
    scenario,
    first,
    second,
    actualWaveStartGapMs: secondStartedAt - first.waveStartedAt,
  };
}

async function main() {
  if (diagnosticMode === 'admin-usage') {
    await runAdminUsageEvidence();
    return;
  }

  printEvent('diagnostic-start', {
    baseUrl,
    model,
    waveGapMs,
    cleanWaitMs,
    sourceLength,
    localRelayGroupSize,
  });

  await waitFromCompletion('initial-isolation');

  const reports = [];
  reports.push(await runTwoWaveScenario({ scenario: 'direct-10', count: 10 }));

  await waitFromCompletion('after-direct-10');
  reports.push(await runTwoWaveScenario({ scenario: 'deployed-relay-batch-10', count: 10, relayGroupSizes: [10] }));

  await waitFromCompletion('after-deployed-relay-batch-10');
  const localGroups = [];
  let remaining = 10;
  while (remaining > 0) {
    const size = Math.min(localRelayGroupSize, remaining);
    localGroups.push(size);
    remaining -= size;
  }
  reports.push(await runTwoWaveScenario({ scenario: 'local-production-client', count: 10, relayGroupSizes: localGroups }));

  await waitFromCompletion('after-local-production-client');
  reports.push({
    scenario: 'direct-15-first-burst',
    first: await runWave({ scenario: 'direct-15-first-burst', wave: 1, count: 15 }),
  });

  printEvent('diagnostic-complete', {
    reports: reports.map((report) => ({
      scenario: report.scenario,
      wave1: report.first ? { ok: report.first.ok, failed: report.first.failed, statuses: report.first.statuses } : null,
      wave2: report.second ? { ok: report.second.ok, failed: report.second.failed, statuses: report.second.statuses } : null,
      actualWaveStartGapMs: report.actualWaveStartGapMs || null,
    })),
  });
}

main().catch((error) => {
  printEvent('diagnostic-failed', {
    message: error?.message || String(error),
    stack: error?.stack || '',
  });
  process.exitCode = 1;
}).finally(() => {
  globalThis.fetch = nativeFetch;
});
