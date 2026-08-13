import { chromium } from 'playwright';

const targetUrl = process.argv[2] || 'http://127.0.0.1:5173/translator-runtime/index.html';
const cpuThrottle = Math.max(1, Number(process.argv[3]) || 6);
const viewport = {
  width: Math.max(320, Number(process.argv[4]) || 390),
  height: Math.max(480, Number(process.argv[5]) || 844),
};
const browser = await chromium.launch({ headless: true });

try {
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 1,
  });
  await context.route('https://fonts.googleapis.com/**', route => route.fulfill({
    status: 200,
    contentType: 'text/css',
    body: '',
  }));
  await context.route('https://fonts.gstatic.com/**', route => route.abort());
  const page = await context.newPage();
  const errors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', error => errors.push(`pageerror: ${error.message}`));

  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpuThrottle });
  const response = await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#hanAuditPanel', { state: 'attached' });

  const cleanScan = await page.evaluate(async () => {
    const chunkText = 'a'.repeat(10 * 1024);
    translatedChunks = Array.from({ length: 1024 }, () => chunkText);
    originalChunks = [];
    currentTranslatorSessionId = null;
    isTranslating = false;
    bumpTranslatorOutputGeneration();

    const longTasks = [];
    const mutations = [];
    const observer = typeof PerformanceObserver === 'function'
      ? new PerformanceObserver((list) => {
          list.getEntries().forEach(entry => longTasks.push({
            startTime: entry.startTime,
            duration: entry.duration,
          }));
        })
      : null;
    observer?.observe({ type: 'longtask' });
    const panel = document.getElementById('hanAuditPanel');
    const mutationObserver = new MutationObserver(() => mutations.push(performance.now()));
    mutationObserver.observe(panel, { childList: true, subtree: true, characterData: true });

    await new Promise(resolve => setTimeout(resolve, 0));
    const startedAt = performance.now();
    const result = await runHanAuditManual();
    const elapsedMs = performance.now() - startedAt;
    await new Promise(resolve => setTimeout(resolve, 50));
    observer?.disconnect();
    mutationObserver.disconnect();
    const measuredLongTasks = longTasks.filter(entry => entry.startTime >= startedAt);

    let maxMutationsPerSecond = 0;
    for (let index = 0; index < mutations.length; index += 1) {
      let end = index;
      while (end < mutations.length && mutations[end] - mutations[index] < 1000) end += 1;
      maxMutationsPerSecond = Math.max(maxMutationsPerSecond, end - index);
    }
    return {
      ok: result.ok,
      issueCount: result.issues?.length || 0,
      totalChars: chunkText.length * translatedChunks.length,
      elapsedMs,
      longTaskCount: measuredLongTasks.length,
      maxLongTaskMs: measuredLongTasks.length ? Math.max(...measuredLongTasks.map(entry => entry.duration)) : 0,
      panelMutationCount: mutations.length,
      maxMutationsPerSecond,
    };
  });

  const issueUi = await page.evaluate(async () => {
    document.getElementById('resultSection').style.display = 'block';
    translatedChunks = Array.from({ length: 40 }, (_, index) => `Chunk ${index + 1} has \u4E2D residue`);
    originalChunks = Array.from({ length: 40 }, (_, index) => `Source ${index + 1}`);
    currentTranslatorSessionId = null;
    bumpTranslatorOutputGeneration();
    const result = await runHanAuditManual();
    return { ok: result.ok, issueCount: result.issues?.length || 0 };
  });
  const chipCount = await page.locator('#hanAuditPanel .han-audit-chip').count();
  await page.locator('#hanAuditPanel .han-audit-chip').first().click();
  const modalVisible = await page.locator('#chunkDetailModal').isVisible();
  const highlightedRanges = await page.locator('#chunkDetailModal .han-audit-mark').count();

  const cancel = await page.evaluate(async () => {
    closeChunkDetail();
    const chunkText = 'a'.repeat(10 * 1024);
    translatedChunks = Array.from({ length: 1024 }, () => chunkText);
    originalChunks = [];
    bumpTranslatorOutputGeneration();
    const scanPromise = runHanAuditManual();
    await new Promise(resolve => setTimeout(resolve, 0));
    const button = document.querySelector('[data-click-action="cancelHanAudit"]');
    const startedAt = performance.now();
    button?.click();
    const handlerMs = performance.now() - startedAt;
    const result = await scanPromise;
    return {
      buttonFound: Boolean(button),
      handlerMs,
      completionMs: performance.now() - startedAt,
      reason: result.reason || '',
    };
  });

  console.log(JSON.stringify({
    httpStatus: response?.status() || 0,
    viewport: page.viewportSize(),
    cpuThrottle,
    cleanScan,
    issueUi: { ...issueUi, chipCount, modalVisible, highlightedRanges },
    cancel,
    consoleErrors: errors,
  }, null, 2));
} finally {
  await browser.close();
}
