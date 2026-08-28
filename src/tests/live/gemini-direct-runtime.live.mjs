import { chromium } from 'playwright';

const key1 = String(process.env.STORYFORGE_GEMINI_KEY_1 || '').trim();
const key2 = String(process.env.STORYFORGE_GEMINI_KEY_2 || '').trim();
const baseUrl = process.env.STORYFORGE_TRANSLATOR_URL
  || 'http://127.0.0.1:5173/translator-runtime/index.html?v=28';
const model = process.env.STORYFORGE_GEMINI_MODEL || 'gemini-3.5-flash-lite';

if (!key1 || !key2) {
  throw new Error('Set STORYFORGE_GEMINI_KEY_1 and STORYFORGE_GEMINI_KEY_2.');
}

const keys = [key1, key2];
const startedAt = Date.now();
const requestRows = [];
const consoleRows = [];
const pageErrors = [];
const pendingRows = new Map();

function isGeminiGenerateRequest(url) {
  return url.hostname === 'generativelanguage.googleapis.com'
    && url.pathname.endsWith(':generateContent');
}

function keyIndexFromUrl(url) {
  const apiKey = url.searchParams.get('key');
  return keys.findIndex((key) => key === apiKey);
}

function classifyRequest(request) {
  const body = String(request.postData() || '');
  return body.includes('MANDATORY TRANSLATION CORRECTION') ? 'han_correction' : 'main';
}

function summarizeRows(rows) {
  const byKey = [0, 1].map((keyIndex) => {
    const keyRows = rows.filter((row) => row.keyIndex === keyIndex);
    const statuses = {};
    const phases = {};
    for (const row of keyRows) {
      const status = String(row.status ?? 'pending');
      statuses[status] = (statuses[status] || 0) + 1;
      phases[row.phase] = (phases[row.phase] || 0) + 1;
    }
    return {
      keyIndex,
      requests: keyRows.length,
      phases,
      statuses,
      temperatures: keyRows.reduce((counts, row) => {
        const value = String(row.temperature ?? 'unknown');
        counts[value] = (counts[value] || 0) + 1;
        return counts;
      }, {}),
      maxInAny60Seconds: keyRows.reduce((maximum, row) => {
        const count = keyRows.filter((candidate) => (
          candidate.startedAt >= row.startedAt
          && candidate.startedAt < row.startedAt + 60_000
        )).length;
        return Math.max(maximum, count);
      }, 0),
      maxInAny65Seconds: keyRows.reduce((maximum, row) => {
        const count = keyRows.filter((candidate) => (
          candidate.startedAt >= row.startedAt
          && candidate.startedAt < row.startedAt + 65_000
        )).length;
        return Math.max(maximum, count);
      }, 0),
      firstAtMs: keyRows.length ? Math.min(...keyRows.map((row) => row.startedAt - startedAt)) : null,
      lastAtMs: keyRows.length ? Math.max(...keyRows.map((row) => row.startedAt - startedAt)) : null,
    };
  });

  return {
    total: rows.length,
    byKey,
    main: rows.filter((row) => row.phase === 'main').length,
    hanCorrection: rows.filter((row) => row.phase === 'han_correction').length,
  };
}

function makeChineseParagraph(index) {
  const sentences = [
    `第${index}段，夜色笼罩临江城，沈砚沿着湿漉漉的石阶走向多年无人居住的旧宅。`,
    '他记得前世就在这一夜，家族蒙受不白之冤，父亲含恨入狱，母亲病倒在寒冷的偏院。',
    '重活一世，他没有立刻惊动任何人，只把门缝里的密信收入袖中，仔细听着院墙外的脚步声。',
    '远处更鼓响了三下，河面雾气翻涌，挂在廊下的旧灯被风吹得忽明忽暗。',
    '侍女阿宁低声问他是否需要报官，他摇了摇头，因为真正的敌人正藏在衙门深处。',
    '书房桌上摆着半盏冷茶、一枚断裂的玉佩，以及一份尚未送出的盐运账册。',
    '沈砚翻开账册，发现每一笔亏空都指向城南码头，却有人故意把罪名栽到沈家头上。',
    '他让阿宁守住后门，自己换上粗布衣裳，准备在天亮之前找到当年的唯一证人。',
    '雨水顺着屋檐落下，他望着镜中年轻的面容，终于确信命运真的给了自己第二次机会。',
    '这一回，他不仅要洗清旧案，还要护住亲人，让所有参与阴谋的人付出应有的代价。',
  ];
  return sentences.join('');
}

const sourceText = Array.from({ length: 30 }, (_, index) => makeChineseParagraph(index + 1)).join('\n\n');
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();

page.on('pageerror', (error) => pageErrors.push(String(error?.message || error)));
page.on('console', (message) => {
  const text = message.text();
  if (/\[(?:Gemini|Queue|Rotation|Validation|HanAudit)|Smart Chunking|Using parallel|thử lại|Đang chờ/i.test(text)) {
    consoleRows.push({ atMs: Date.now() - startedAt, type: message.type(), text: text.slice(0, 500) });
  }
});
page.on('request', (request) => {
  let url;
  try {
    url = new URL(request.url());
  } catch {
    return;
  }
  if (!isGeminiGenerateRequest(url)) return;
  let temperature = null;
  try {
    temperature = JSON.parse(request.postData() || '{}')?.generationConfig?.temperature ?? null;
  } catch {
    temperature = null;
  }
  const row = {
    id: requestRows.length + 1,
    keyIndex: keyIndexFromUrl(url),
    model: decodeURIComponent(url.pathname.split('/').pop().replace(':generateContent', '')),
    phase: classifyRequest(request),
    temperature,
    startedAt: Date.now(),
    status: null,
    finishedAt: null,
  };
  requestRows.push(row);
  pendingRows.set(request, row);
});
page.on('response', (response) => {
  const row = pendingRows.get(response.request());
  if (!row) return;
  row.status = response.status();
  row.finishedAt = Date.now();
});
page.on('requestfailed', (request) => {
  const row = pendingRows.get(request);
  if (!row) return;
  row.status = 'network_failed';
  row.finishedAt = Date.now();
});

const progressTimer = setInterval(async () => {
  const runtime = await page.evaluate(() => ({
    translating: typeof isTranslating !== 'undefined' && isTranslating,
    status: document.getElementById('progressStatus')?.textContent || '',
  })).catch(() => ({ translating: null, status: '' }));
  process.stdout.write(`${JSON.stringify({
    type: 'progress',
    elapsedSeconds: Math.round((Date.now() - startedAt) / 1000),
    requests: requestRows.length,
    responses: requestRows.filter((row) => row.status != null).length,
    ...runtime,
  })}\n`);
}, 20_000);

try {
  const response = await page.goto(baseUrl, { waitUntil: 'networkidle', timeout: 60_000 });
  if (!response?.ok()) throw new Error(`Translator page returned HTTP ${response?.status()}.`);

  await page.evaluate(() => {
    storyForgeAccessSnapshot = {
      features: {
        'translator.access': { allowed: true },
        'translator.parallel_high': { allowed: true },
        'provider.gemini_direct': { allowed: true },
      },
    };
    setActiveTranslatorTemplateId('convert');
    const promptInput = document.getElementById('customPrompt');
    if (promptInput && typeof PROMPT_TEMPLATES !== 'undefined') {
      promptInput.value = PROMPT_TEMPLATES.convert || '';
    }
  });

  await page.locator('#toggleSettingsBtn').click();
  await page.locator('[data-config-toggle="gemini"]').click();
  for (const key of keys) {
    await page.locator('#newApiKey').fill(key);
    await page.locator('[data-click-action="addApiKey"]').click();
  }

  const directButton = page.locator('[data-click-action="activateGeminiDirect"]');
  if (await directButton.isEnabled()) await directButton.click();
  await page.locator('#customModelName').fill(model);
  await page.locator('[data-click-action="useCustomGeminiModel"]').click();

  await page.locator('[data-config-toggle="general"]').click();
  await page.locator('#sourceLang').selectOption('zh-CN');
  await page.locator('#parallelCount').fill('30');
  await page.locator('#rpmPerKey').fill('15');
  await page.locator('#chunkSize').fill('500');
  for (const selector of ['#sourceLang', '#parallelCount', '#rpmPerKey', '#chunkSize']) {
    await page.locator(selector).dispatchEvent('change');
  }
  await page.locator('#originalText').fill(sourceText);

  const setup = await page.evaluate((expectedModel) => ({
    chunks: splitTextIntoChunks(document.getElementById('originalText').value, 500).length,
    keys: getTranslatorRpmKeyCount(TRANSLATOR_PROVIDERS.GEMINI_DIRECT),
    parallel: Number(document.getElementById('parallelCount').value),
    rpm: Number(document.getElementById('rpmPerKey').value),
    activeModel: getActiveModels()[0]?.name || '',
    expectedModel,
  }), model);
  process.stdout.write(`${JSON.stringify({ type: 'setup', ...setup })}\n`);
  if (setup.chunks !== 30 || setup.keys !== 2 || setup.parallel !== 30 || setup.rpm !== 15 || setup.activeModel !== model) {
    throw new Error(`Unexpected runtime setup: ${JSON.stringify(setup)}`);
  }

  await page.locator('#translateBtn').click();
  await page.waitForFunction(() => typeof isTranslating !== 'undefined' && isTranslating, null, { timeout: 30_000 });
  await page.waitForFunction(() => typeof isTranslating !== 'undefined' && !isTranslating, null, { timeout: 12 * 60_000 });

  const automaticResult = await page.evaluate(() => ({
    translatedCount: Array.isArray(translatedChunks)
      ? translatedChunks.filter((value) => typeof value === 'string' && value.trim()).length
      : 0,
    undefinedOutputs: Array.isArray(translatedChunks)
      ? translatedChunks.filter((value) => value == null).length
      : 0,
    failedChunks: typeof chunkTrackingData !== 'undefined' && Array.isArray(chunkTrackingData)
      ? chunkTrackingData.filter((row) => row?.status === 'failed').length
      : null,
    hanStatus: typeof hanAuditState !== 'undefined' ? hanAuditState.status : 'unavailable',
    remainingHanIssues: typeof hanAuditState !== 'undefined' ? hanAuditState.issues.length : null,
    trackerRetries: typeof chunkTrackingData !== 'undefined' && Array.isArray(chunkTrackingData)
      ? chunkTrackingData.reduce((sum, row) => sum + Number(row?.retryCount || 0), 0)
      : null,
    rpmBuckets: Object.fromEntries(Object.entries(translatorRpmTimestamps).map(([bucket, rows]) => [
      bucket,
      rows.map((row) => ({ kind: row.kind, ageMs: Date.now() - row.timestamp })),
    ])),
  }));
  const automaticCompletedAt = Date.now();
  process.stdout.write(`${JSON.stringify({
    type: 'automatic_result',
    elapsedSeconds: Math.round((automaticCompletedAt - startedAt) / 1000),
    initialWave: summarizeRows(requestRows.slice(0, 30)),
    requests: summarizeRows(requestRows),
    runtime: automaticResult,
  })}\n`);

  const requestsBeforeControlledAudit = requestRows.length;
  const controlledAuditStartedAt = Date.now();
  const controlledAudit = await page.evaluate(async () => {
    translatedChunks[0] = `${String(translatedChunks[0] || '')}\n测试`;
    if (typeof bumpTranslatorOutputGeneration === 'function') bumpTranslatorOutputGeneration();
    const scan = await runHanAuditScan({ silent: true });
    const correction = await retryHanAuditIssues({ silent: true });
    return {
      scanOk: scan.ok,
      detectedIssues: scan.issues.length,
      correction,
      remainingHan: getHanAuditCore().scanHanInText(String(translatedChunks[0] || '')).hanCount,
      rpmBuckets: Object.fromEntries(Object.entries(translatorRpmTimestamps).map(([bucket, rows]) => [
        bucket,
        rows.map((row) => ({ kind: row.kind, ageMs: Date.now() - row.timestamp })),
      ])),
    };
  });
  const controlledRows = requestRows.slice(requestsBeforeControlledAudit);
  process.stdout.write(`${JSON.stringify({
    type: 'controlled_han_result',
    elapsedSeconds: Math.round((Date.now() - startedAt) / 1000),
    waitedMsBeforeFirstRequest: controlledRows.length
      ? controlledRows[0].startedAt - controlledAuditStartedAt
      : null,
    requests: summarizeRows(controlledRows),
    runtime: controlledAudit,
  })}\n`);

  process.stdout.write(`${JSON.stringify({
    type: 'final',
    elapsedSeconds: Math.round((Date.now() - startedAt) / 1000),
    requests: summarizeRows(requestRows),
    pageErrors,
    relevantConsoleTail: consoleRows.slice(-80),
  })}\n`);
} finally {
  clearInterval(progressTimer);
  await context.close();
  await browser.close();
}
