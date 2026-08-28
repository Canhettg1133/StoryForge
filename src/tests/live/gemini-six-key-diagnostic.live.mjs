// Opt-in live diagnostic. Supply { keys: [...], mode: 'probe' | 'compare' }
// on stdin; credentials are never saved or included in diagnostic output.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { acquireVitestRunLock } from '../../../scripts/vitest-resource-guard.mjs';

const input = [];
for await (const part of process.stdin) input.push(part);
const config = JSON.parse(Buffer.concat(input).toString('utf8'));
const keys = (config.keys || []).map((key) => String(key).replace(/\\_/g, '_').trim());
if (keys.length !== 6 || new Set(keys).size !== 6 || keys.some((key) => !/^AIza[\w-]{35}$/.test(key))) {
  throw new Error('Exactly six distinct, correctly formatted Gemini keys are required.');
}
const mode = config.mode || 'probe';
if (!['probe', 'compare'].includes(mode)) throw new Error('Unknown diagnostic mode.');
const model = 'gemini-3.5-flash-lite';
const root = path.resolve('public/translator-runtime');
const files = [
  'js/app.js', 'js/translation/request-contract.js', 'js/translation/errors.js',
  'js/gemini/model-rotation.js', 'js/gemini/api.js', 'js/translation/retry.js',
  'js/translation/engine.js', 'js/features/chunk-key-usage/state.js',
];
const scripts = files.map((name) => ({ name, text: fs.readFileSync(path.join(root, name), 'utf8') }));
const paragraph = [
  '夜色笼罩临江城，沈砚沿着湿漉漉的石阶走向多年无人居住的旧宅。',
  '他记得前世就在这一夜，家族蒙受不白之冤，父亲含恨入狱，母亲病倒在寒冷的偏院。',
  '重活一世，他没有立刻惊动任何人，只把门缝里的密信收入袖中，仔细听着院墙外的脚步声。',
  '远处更鼓响了三下，河面雾气翻涌，挂在廊下的旧灯被风吹得忽明忽暗。',
  '侍女阿宁低声问他是否需要报官，他摇了摇头，因为真正的敌人正藏在衙门深处。',
  '书房桌上摆着半盏冷茶、一枚断裂的玉佩，以及一份尚未送出的盐运账册。',
  '沈砚翻开账册，发现每一笔亏空都指向城南码头，却有人故意把罪名栽到沈家头上。',
  '他让阿宁守住后门，自己换上粗布衣裳，准备在天亮之前找到当年的唯一证人。',
  '雨水顺着屋檐落下，他望着镜中年轻的面容，终于确信命运真的给了自己第二次机会。',
  '这一回，他不仅要洗清旧案，还要护住亲人，让所有参与阴谋的人付出应有的代价。',
].join('');
const repeat = Math.max(1, Math.min(8, Number(config.repeat) || 1));
const source = Array.from({ length: repeat }, (_, index) => `第${index + 1}段。${paragraph}`).join('\n\n');
const template = config.template || 'convert';
const redact = (value) => {
  let text = String(value ?? '');
  for (const key of keys) text = text.replaceAll(key, '[REDACTED]');
  return text.replace(/AIza[\w-]+/g, '[REDACTED]');
};
const started = Date.now();
const reportPath = path.join(os.tmpdir(), `storyforge-gemini-${mode}-${started}.json`);
const report = {
  model, mode, template, sourceChars: source.length, runtime: 'Node VM, real production functions and live Google HTTP',
  sourceSha256: createHash('sha256').update(source).digest('hex'),
  files: scripts.map(({ name, text }) => ({ name, sha256: createHash('sha256').update(text).digest('hex') })),
  startedAt: new Date(started).toISOString(), requests: [], scenarios: [], logs: [],
};
function emit(value) { process.stdout.write(`${redact(JSON.stringify(value))}\n`); }
function save() { fs.writeFileSync(reportPath, redact(JSON.stringify(report, null, 2))); }
const lock = await acquireVitestRunLock();
let activeContext;
let stopped = false;
const deadline = setTimeout(() => {
  stopped = true;
  if (activeContext) vm.runInContext('cancelRequested = true; activeRequestControllers.forEach(c => c.abort());', activeContext);
}, 12 * 60_000);
const progress = setInterval(() => {
  save();
  emit({ type: 'progress', seconds: Math.round((Date.now() - started) / 1000),
    requests: report.requests.length, completed: report.requests.filter((row) => row.finishedAt).length });
}, 20_000);

function summarize(rows) {
  return keys.map((_, keyIndex) => {
    const matching = rows.filter((row) => row.key === keyIndex + 1);
    const counts = {};
    for (const row of matching) counts[row.status] = (counts[row.status] || 0) + 1;
    const peak = (windowMs) => Math.max(0, ...matching.map((row) => matching.filter((other) => (
      other.startedAt >= row.startedAt && other.startedAt < row.startedAt + windowMs
    )).length));
    return { key: keyIndex + 1, requests: matching.length, statuses: counts,
      maxIn60s: peak(60_000), maxIn65s: peak(65_000),
      inputTokens: matching.reduce((sum, row) => sum + (row.usage?.promptTokenCount || 0), 0),
      outputTokens: matching.reduce((sum, row) => sum + (row.usage?.candidatesTokenCount || 0), 0) };
  });
}

async function runScenario(name, keyIndices, count, parallel, retries) {
  if (stopped) throw new Error('Diagnostic deadline reached.');
  // Leave a clean provider window between independent scenarios; never reset
  // the local limiter midway through a scenario or overlap two test commands.
  const previous = report.requests.filter((row) => keyIndices.includes(row.key - 1));
  if (previous.length) {
    const waitMs = Math.max(...previous.map((row) => row.startedAt)) + 66_000 - Date.now();
    if (waitMs > 0) {
      emit({ type: 'clean_window_wait', scenario: name, seconds: Math.ceil(waitMs / 1000) });
      await delay(waitMs);
    }
  }
  const scenario = { name, keyCount: keyIndices.length, rpm: 10, parallel, count, retries, results: [], waves: [] };
  report.scenarios.push(scenario);
  const context = vm.createContext({
    URL, AbortController, setTimeout, clearTimeout,
    console: Object.fromEntries(['log', 'warn', 'error'].map((level) => [level, (...args) => {
      report.logs.push({ scenario: name, level, atMs: Date.now() - started, text: redact(args.join(' ')).slice(0, 1400) });
    }])),
    document: { addEventListener() {}, getElementById() { return null; }, querySelector() { return null; } },
    localStorage: { getItem() { return null; }, setItem() {} }, showToast() {},
    trackChunkRetry(chunkIndex, attempt) {
      report.logs.push({ scenario: name, kind: 'tracker_retry', chunkIndex, attempt, atMs: Date.now() - started });
    },
    sleep: async (ms) => {
      if (stopped) throw new Error('TRANSLATION_CANCELLED');
      await delay(ms);
      if (stopped) throw new Error('TRANSLATION_CANCELLED');
    },
    fetch: async (url, options) => {
      const target = new URL(url);
      const keyIndex = keys.indexOf(target.searchParams.get('key'));
      if (target.origin !== 'https://generativelanguage.googleapis.com'
        || target.pathname !== `/v1beta/models/${model}:generateContent` || keyIndex < 0) {
        throw new Error('Unexpected diagnostic destination.');
      }
      if (stopped || report.requests.length >= 150) throw new Error('Diagnostic request budget reached.');
      const body = JSON.parse(options.body);
      const row = { id: report.requests.length + 1, scenario: name, key: keyIndex + 1,
        startedAt: Date.now(), status: 'pending', temperature: body.generationConfig.temperature,
        systemChars: body.systemInstruction?.parts?.[0]?.text?.length || 0,
        inputChars: body.contents[0].parts[0].text.length, thinkingConfig: body.generationConfig.thinkingConfig };
      report.requests.push(row);
      try {
        const response = await fetch(url, options);
        row.status = response.status;
        row.headersAt = Date.now();
        const payload = await response.clone().json();
        row.finishedAt = Date.now();
        row.usage = payload.usageMetadata;
        row.googleError = payload.error;
        row.finishReason = payload.candidates?.[0]?.finishReason;
        row.blockReason = payload.promptFeedback?.blockReason;
        row.parts = (payload.candidates?.[0]?.content?.parts || []).map((part) => ({
          thought: Boolean(part.thought), chars: part.text?.length || 0,
          preview: String(part.text || '').slice(0, 180),
        }));
        if (row.status !== 200 || row.blockReason || row.finishReason !== 'STOP') {
          emit({ type: 'api_observation', ...row });
        }
        return response;
      } catch (error) {
        row.finishedAt = Date.now();
        row.transportError = redact(error.message);
        throw error;
      }
    },
  });
  activeContext = context;
  for (const script of scripts) vm.runInContext(script.text, context, { filename: script.name });
  context.diagnosticKeys = keyIndices.map((index) => keys[index]);
  context.diagnosticModel = model;
  context.diagnosticTemplate = template;
  vm.runInContext(`
    useProxy = false; useOllama = false; apiKeys = diagnosticKeys;
    GEMINI_MODELS = [{ name: diagnosticModel, enabled: true }]; rpmPerKey = 10;
    currentTranslatorSessionId = 'live-diagnostic'; cancelRequested = false;
  `, context);
  const prompt = vm.runInContext('PROMPT_TEMPLATES[diagnosticTemplate]', context);
  if (!prompt) throw new Error('Unknown production prompt template.');
  const request = context.buildPromptedChunk(prompt, source, 'zh-CN');
  emit({ type: 'scenario_start', name, keys: keyIndices.map((index) => index + 1), count, parallel, rpm: 10, sourceChars: source.length });
  let nextIndex = 0;
  while (nextIndex < count && !stopped) {
    const plan = await context.waitForTranslatorRpmBatchPlan({ requestedParallel: parallel, remainingChunks: count - nextIndex });
    if (plan.capacity <= 0) break;
    scenario.waves.push({ atMs: Date.now() - started, capacity: plan.capacity, keyAllocations: plan.keyAllocations });
    const indices = Array.from({ length: plan.capacity }, () => nextIndex++);
    const jobs = indices.map((index) => context.translateChunkWithRetry(request, index, retries));
    await context.settleChunkPromisesIndividually(jobs, (result, offset) => {
      const chunkIndex = indices[offset];
      const journal = context.getTranslatorChunkKeyUsage(chunkIndex);
      scenario.results.push({ chunkIndex, status: result.status,
        outputChars: result.value?.length ?? null,
        errorCode: result.reason?.code, error: redact(result.reason?.rawMessage || result.reason?.message || ''),
        attempts: journal?.attempts?.map((entry) => ({
          key: keyIndices[entry.keyIndex] + 1, kind: entry.kind, status: entry.status,
          errorCode: entry.errorCode, error: entry.error,
        })),
      });
    });
  }
  const rows = report.requests.filter((row) => row.scenario === name);
  scenario.summary = summarize(rows);
  scenario.success = scenario.results.filter((row) => row.status === 'fulfilled' && row.outputChars > 0).length;
  scenario.failed = scenario.results.length - scenario.success;
  scenario.retryAttempts = scenario.results.reduce((sum, row) => sum + Math.max(0, (row.attempts?.length || 0) - 1), 0);
  emit({ type: 'scenario_end', ...scenario, results: undefined });
  save();
  activeContext = null;
}

try {
  emit({ type: 'diagnostic_start', reportPath, model, mode, sourceChars: source.length });
  if (mode === 'probe') {
    for (let index = 0; index < keys.length; index += 1) await runScenario(`probe-key-${index + 1}`, [index], 1, 1, 1);
  } else {
    await runScenario('single-key-10', [0], 10, 10, 3);
    if (report.scenarios[0].success !== 10 || report.scenarios[0].retryAttempts > 0) {
      throw new Error('Single-key baseline is not clean; do not attribute this sample to multi-key concurrency.');
    }
    await runScenario('six-keys-30', [0, 1, 2, 3, 4, 5], 60, 30, 3);
    await runScenario('single-key-10-after', [0], 10, 10, 3);
  }
  report.summary = summarize(report.requests);
  emit({ type: 'diagnostic_end', reportPath, requests: report.requests.length, summary: report.summary });
} catch (error) {
  report.fatal = redact(error.message);
  emit({ type: 'diagnostic_error', message: report.fatal, reportPath });
  process.exitCode = 1;
} finally {
  clearTimeout(deadline);
  clearInterval(progress);
  save();
  await lock.release();
}
