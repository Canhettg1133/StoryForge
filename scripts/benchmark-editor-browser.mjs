import { chromium } from 'playwright';
import { WORD_COUNT_CACHE_VERSION } from '../src/services/projects/sceneWordCounts.js';

function readNumberArgument(name, fallback) {
  const raw = process.argv.find((argument) => argument.startsWith(`--${name}=`));
  const value = Number(raw?.slice(name.length + 3));
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

const baseUrl = process.argv.find((argument) => argument.startsWith('--url='))
  ?.slice('--url='.length) || 'http://127.0.0.1:3000';
const chapterCount = readNumberArgument('chapters', 1_000);
const scenesPerChapter = readNumberArgument('scenes-per-chapter', 3);
const cpuThrottle = readNumberArgument('cpu', 6);
const viewport = {
  width: readNumberArgument('width', 390),
  height: readNumberArgument('height', 844),
};
const enforceBudgets = process.argv.includes('--enforce');
const runInteractions = process.argv.includes('--interactions');
const routeRounds = 20;
const panelCycles = 50;
const projectId = 9_001;
const wordsPerScene = 120;

function percentile(values, percentileValue) {
  if (values.length === 0) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * percentileValue) - 1)] || 0;
}

async function readHeapBytes(cdp) {
  const performanceMetrics = await cdp.send('Performance.getMetrics');
  return performanceMetrics.metrics.find((metric) => metric.name === 'JSHeapUsedSize')?.value || 0;
}

const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  await context.route('https://fonts.googleapis.com/**', (route) => route.abort());
  await context.route('https://fonts.gstatic.com/**', (route) => route.abort());
  await context.addInitScript(() => {
    window.__storyForgePerf = { longTasks: [], frames: [], layoutShift: 0, lcp: 0 };
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          window.__storyForgePerf.longTasks.push({ startTime: entry.startTime, duration: entry.duration });
        }
      }).observe({ type: 'longtask', buffered: true });
      new PerformanceObserver((list) => {
        const entries = list.getEntries();
        window.__storyForgePerf.lcp = entries.at(-1)?.startTime || window.__storyForgePerf.lcp;
      }).observe({ type: 'largest-contentful-paint', buffered: true });
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (!entry.hadRecentInput) window.__storyForgePerf.layoutShift += entry.value;
        }
      }).observe({ type: 'layout-shift', buffered: true });
    } catch {
      // Older engines can omit one of the optional performance entry types.
    }
    let previousFrame = performance.now();
    const sampleFrame = (now) => {
      window.__storyForgePerf.frames.push(now - previousFrame);
      if (window.__storyForgePerf.frames.length > 2_000) window.__storyForgePerf.frames.shift();
      previousFrame = now;
      requestAnimationFrame(sampleFrame);
    };
    requestAnimationFrame(sampleFrame);
  });

  const seedPage = await context.newPage();
  await seedPage.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded' });
  await seedPage.waitForSelector('.dashboard', { state: 'attached' });
  await seedPage.waitForFunction(() => indexedDB.databases?.().then((rows) => (
    rows.some((row) => row.name === 'StoryForgeDB' && Number(row.version) > 1)
  )));
  const seedResult = await seedPage.evaluate(async ({
    fixtureProjectId,
    fixtureChapterCount,
    fixtureScenesPerChapter,
    fixtureWordsPerScene,
    fixtureWordCountVersion,
  }) => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('StoryForgeDB');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const chapterRows = [];
    const sceneRows = [];
    const now = new Date().toISOString();
    const sceneText = `<p>${'nội dung kiểm thử '.repeat(fixtureWordsPerScene / 3)}</p>`;

    for (let chapterIndex = 0; chapterIndex < fixtureChapterCount; chapterIndex += 1) {
      const chapterId = (fixtureProjectId * 10_000) + chapterIndex + 1;
      chapterRows.push({
        id: chapterId,
        project_id: fixtureProjectId,
        title: `Chương ${chapterIndex + 1}`,
        order_index: chapterIndex,
        status: 'draft',
        actual_word_count: fixtureWordsPerScene * fixtureScenesPerChapter,
        word_count_version: fixtureWordCountVersion,
        created_at: now,
        updated_at: now,
      });
      for (let sceneIndex = 0; sceneIndex < fixtureScenesPerChapter; sceneIndex += 1) {
        sceneRows.push({
          id: (chapterId * 10) + sceneIndex + 1,
          project_id: fixtureProjectId,
          chapter_id: chapterId,
          title: `Cảnh ${sceneIndex + 1}`,
          order_index: sceneIndex,
          status: 'draft',
          draft_text: sceneText,
          final_text: '',
          word_count: fixtureWordsPerScene,
          word_count_version: fixtureWordCountVersion,
          created_at: now,
          updated_at: now,
        });
      }
    }

    await new Promise((resolve, reject) => {
      const transaction = db.transaction(['projects', 'chapters', 'scenes'], 'readwrite');
      transaction.objectStore('projects').put({
        id: fixtureProjectId,
        title: `Benchmark ${fixtureChapterCount} chương`,
        genre_primary: 'fantasy',
        status: 'active',
        target_length: fixtureChapterCount,
        actual_word_count: fixtureChapterCount * fixtureScenesPerChapter * fixtureWordsPerScene,
        created_at: now,
        updated_at: now,
      });
      const chapters = transaction.objectStore('chapters');
      const scenes = transaction.objectStore('scenes');
      chapterRows.forEach((row) => chapters.put(row));
      sceneRows.forEach((row) => scenes.put(row));
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error || new Error('Fixture transaction aborted.'));
    });
    db.close();
    return { chapters: chapterRows.length, scenes: sceneRows.length };
  }, {
    fixtureProjectId: projectId,
    fixtureChapterCount: chapterCount,
    fixtureScenesPerChapter: scenesPerChapter,
    fixtureWordsPerScene: wordsPerScene,
    fixtureWordCountVersion: WORD_COUNT_CACHE_VERSION,
  });
  await seedPage.close();

  const page = await context.newPage();
  const errors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpuThrottle });
  await cdp.send('Performance.enable');

  const startedAt = Date.now();
  const response = await page.goto(`${baseUrl}/project/${projectId}/editor`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.story-editor-content', { state: 'attached', timeout: 30_000 });
  const readyWallMs = Date.now() - startedAt;
  const loadRuntime = await page.evaluate(() => {
    const longTasks = window.__storyForgePerf.longTasks.slice();
    return {
      readyPerformanceMs: performance.now(),
      loadLongTaskCount: longTasks.length,
      loadMaxLongTaskMs: Math.max(0, ...longTasks.map((entry) => entry.duration)),
    };
  });
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent('storyforge:open-mobile-editor-panel', {
      detail: { panel: 'chapters' },
    }));
  });
  await page.waitForFunction(() => document.querySelectorAll('.chapter-node, .chapter-mobile-group').length > 0);
  await page.waitForTimeout(500);

  const runtime = await page.evaluate(async () => {
    window.__storyForgePerf.longTasks = [];
    window.__storyForgePerf.frames = [];
    const scrollContainer = document.querySelector('.chapter-list-tree, .chapter-list-mobile-tree');
    if (scrollContainer) {
      const maxScrollTop = Math.max(0, scrollContainer.scrollHeight - scrollContainer.clientHeight);
      const step = Math.max(80, Math.min(160, scrollContainer.clientHeight * 0.18));
      let scrollTop = 0;
      for (let index = 0; index < 120 && scrollTop < maxScrollTop; index += 1) {
        scrollTop = Math.min(maxScrollTop, scrollTop + step);
        scrollContainer.scrollTop = scrollTop;
        await new Promise((resolve) => requestAnimationFrame(resolve));
      }
    }
    const sortedFrames = window.__storyForgePerf.frames.slice().sort((a, b) => a - b);
    const p95Frame = sortedFrames[Math.max(0, Math.ceil(sortedFrames.length * 0.95) - 1)] || 0;
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const scrollLongTasks = window.__storyForgePerf.longTasks;
    return {
      domNodes: document.getElementsByTagName('*').length,
      mountedChapterRows: document.querySelectorAll('.chapter-node, .chapter-mobile-group').length,
      scrollLongTaskCount: scrollLongTasks.length,
      scrollMaxLongTaskMs: Math.max(0, ...scrollLongTasks.map((entry) => entry.duration)),
      scrollP95FrameMs: p95Frame,
      scrollFramesOver50Ms: sortedFrames.filter((duration) => duration > 50).length,
      lcpMs: window.__storyForgePerf.lcp,
      cls: window.__storyForgePerf.layoutShift,
    };
  });
  const heapBytes = await readHeapBytes(cdp);
  let interactionRuntime = {};

  if (runInteractions && viewport.width > 900) {
    const routeTargets = [
      { label: 'Thế giới', selector: '.world-lore' },
      { label: 'Sổ tay truyện', selector: '.story-bible' },
      { label: 'Bảng dàn ý', selector: '.outline-board' },
      { label: 'Viết truyện', selector: '.story-editor-content' },
    ];
    const navigateTo = async ({ label, selector }) => {
      const button = page.locator('.sidebar-item', { hasText: label }).first();
      await button.hover();
      const navigationStartedAt = await page.evaluate(() => performance.now());
      await button.click();
      await page.waitForSelector(selector, { state: 'attached', timeout: 10_000 });
      const duration = await page.evaluate((startedAt) => performance.now() - startedAt, navigationStartedAt);
      return { label, duration };
    };

    for (const target of routeTargets) await navigateTo(target);
    await page.evaluate(() => { window.__storyForgePerf.longTasks = []; });
    const routeDurations = [];
    const routeDurationsByTarget = new Map(routeTargets.map(({ label }) => [label, []]));
    for (let round = 0; round < routeRounds; round += 1) {
      for (const target of routeTargets) {
        const measurement = await navigateTo(target);
        routeDurations.push(measurement.duration);
        routeDurationsByTarget.get(measurement.label).push(measurement.duration);
      }
    }
    const routeLongTasks = await page.evaluate(() => window.__storyForgePerf.longTasks.slice());
    const routeByTarget = Object.fromEntries([...routeDurationsByTarget].map(([label, durations]) => [label, {
      medianMs: Number(percentile(durations, 0.5).toFixed(1)),
      p95Ms: Number(percentile(durations, 0.95).toFixed(1)),
      maxMs: Number(Math.max(0, ...durations).toFixed(1)),
    }]));
    interactionRuntime = {
      routeRounds,
      routeTransitions: routeDurations.length,
      routeByTarget,
      routeMedianMs: Number(percentile(routeDurations, 0.5).toFixed(1)),
      routeP95Ms: Number(percentile(routeDurations, 0.95).toFixed(1)),
      routeMaxMs: Number(Math.max(0, ...routeDurations).toFixed(1)),
      routeLongTaskCount: routeLongTasks.length,
      routeMaxLongTaskMs: Number(Math.max(0, ...routeLongTasks.map((entry) => entry.duration)).toFixed(1)),
    };
  }

  if (runInteractions && viewport.width <= 900) {
    await cdp.send('HeapProfiler.enable');
    await page.evaluate(async () => {
      document.querySelector('.scene-editor-overlay')?.click();
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });
    await cdp.send('HeapProfiler.collectGarbage');
    const panelHeapBeforeBytes = await readHeapBytes(cdp);
    const panelRuntime = await page.evaluate(async (cycles) => {
      const waitForPaint = () => new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
      });
      const domBefore = document.getElementsByTagName('*').length;
      const openDurations = [];
      const closeDurations = [];
      window.__storyForgePerf.longTasks = [];

      for (let cycle = 0; cycle < cycles; cycle += 1) {
        const openStartedAt = performance.now();
        window.dispatchEvent(new CustomEvent('storyforge:open-mobile-editor-panel', {
          detail: { panel: 'chapters' },
        }));
        await waitForPaint();
        openDurations.push(performance.now() - openStartedAt);
        const closeStartedAt = performance.now();
        document.querySelector('.scene-editor-overlay')?.click();
        await waitForPaint();
        closeDurations.push(performance.now() - closeStartedAt);
      }

      const panelLongTasks = window.__storyForgePerf.longTasks.slice();
      const percentile = (values, ratio) => {
        if (values.length === 0) return 0;
        const sorted = [...values].sort((left, right) => left - right);
        return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))];
      };
      return {
        panelCycles: cycles,
        panelDomBefore: domBefore,
        panelDomAfter: document.getElementsByTagName('*').length,
        panelLongTaskCount: panelLongTasks.length,
        panelMaxLongTaskMs: Math.max(0, ...panelLongTasks.map((entry) => entry.duration)),
        panelOpenP95Ms: percentile(openDurations, 0.95),
        panelOpenMaxMs: Math.max(0, ...openDurations),
        panelCloseP95Ms: percentile(closeDurations, 0.95),
        panelCloseMaxMs: Math.max(0, ...closeDurations),
      };
    }, panelCycles);
    await cdp.send('HeapProfiler.collectGarbage');
    const panelHeapAfterBytes = await readHeapBytes(cdp);
    const panelDomGrowthPercent = panelRuntime.panelDomBefore > 0
      ? Math.max(0, ((panelRuntime.panelDomAfter - panelRuntime.panelDomBefore) / panelRuntime.panelDomBefore) * 100)
      : 0;
    const panelHeapGrowthPercent = panelHeapBeforeBytes > 0
      ? Math.max(0, ((panelHeapAfterBytes - panelHeapBeforeBytes) / panelHeapBeforeBytes) * 100)
      : 0;
    interactionRuntime = {
      ...panelRuntime,
      panelDomGrowthPercent: Number(panelDomGrowthPercent.toFixed(2)),
      panelHeapBeforeMiB: Number((panelHeapBeforeBytes / (1024 * 1024)).toFixed(2)),
      panelHeapAfterMiB: Number((panelHeapAfterBytes / (1024 * 1024)).toFixed(2)),
      panelHeapGrowthPercent: Number(panelHeapGrowthPercent.toFixed(2)),
    };
  }

  const result = {
    httpStatus: response?.status() || 0,
    viewport,
    cpuThrottle,
    fixture: seedResult,
    readyWallMs,
    ...loadRuntime,
    ...runtime,
    ...interactionRuntime,
    heapMiB: Number((heapBytes / (1024 * 1024)).toFixed(2)),
    consoleErrors: errors,
  };
  const routeP95Ms = result.routeP95Ms || 0;
  const panelHeapGrowthPercent = result.panelHeapGrowthPercent || 0;
  result.budget = {
    dataReady: readyWallMs <= 5_000,
    heap: result.heapMiB <= 250,
    dom: result.domNodes <= 2_500,
    mountedRows: result.mountedChapterRows < 30,
    scrollInteraction: result.scrollMaxLongTaskMs <= 100,
    scrollFrames: result.scrollP95FrameMs <= 20 && result.scrollFramesOver50Ms === 0,
    lcp: result.lcpMs <= 2_500,
    cls: result.cls <= 0.1,
    warmNavigation: !runInteractions || viewport.width <= 900 || routeP95Ms <= 200,
    panelStability: !runInteractions || viewport.width > 900 || (
      result.panelDomGrowthPercent <= 10
      && panelHeapGrowthPercent <= 10
      && result.panelMaxLongTaskMs <= 100
    ),
    console: errors.length === 0,
  };
  result.passed = Object.values(result.budget).every(Boolean);
  console.log(JSON.stringify(result, null, 2));
  if (enforceBudgets && !result.passed) process.exitCode = 1;
} finally {
  await browser.close();
}
