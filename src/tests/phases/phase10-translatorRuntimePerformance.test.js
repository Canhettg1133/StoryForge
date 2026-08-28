import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

const repoRoot = process.cwd();

function loadRuntimeContext(files, extraContext = {}) {
  const context = {
    console: { log: () => {}, warn: () => {}, error: () => {} },
    Date,
    setTimeout,
    clearTimeout,
    ...extraContext,
  };
  vm.createContext(context);
  files.forEach((file) => {
    const fullPath = path.join(repoRoot, file);
    vm.runInContext(fs.readFileSync(fullPath, 'utf8'), context, { filename: file });
  });
  return context;
}

function makeVietnameseText(targetChars) {
  const paragraph = 'Lâm Phong nhìn về phía Trường An. "Ngươi thật sự muốn đi sao?" Nàng khẽ hỏi.\nHắn đáp: Ta phải tìm Thiên Kiếm môn, công pháp Huyền Minh, và lời hứa năm xưa.\n\n';
  return paragraph.repeat(Math.ceil(targetChars / paragraph.length)).slice(0, targetChars);
}

describe('phase10 translator runtime performance', () => {
  it('builds a bounded large-output preview while preserving Unicode text and chunk order', () => {
    const context = loadRuntimeContext([
      'public/translator-runtime/js/translation/engine.js',
    ]);

    expect(typeof context.buildTranslatedTextPreview).toBe('function');

    const chunks = Array.from({ length: 1800 }, (_, index) => (
      index % 7 === 0
        ? null
        : `#${index + 1} ${makeVietnameseText(5900)}`
    ));

    const preview = context.buildTranslatedTextPreview(chunks, {
      pendingLabel: 'Đang dịch',
      maxChars: 120_000,
    });

    expect(preview.length).toBeLessThanOrEqual(125_000);
    expect(preview).toContain('Lâm Phong');
    expect(preview).toContain('Thiên Kiếm môn');
    expect(preview).toContain('[Đang dịch chunk 1]');
    expect(preview.indexOf('#2')).toBeLessThan(preview.indexOf('#3'));
    expect(preview).not.toContain('Dá»');
    expect(preview).not.toContain('�');

    const emojiPreview = context.buildTranslatedTextPreview(['A'.repeat(99) + '📚 trailing'], {
      pendingLabel: 'Đang dịch',
      maxChars: 100,
    });
    expect(emojiPreview.endsWith('\uD83D')).toBe(false);
  });

  it('keeps the final chunk tail visible when previewing a truncated large translation', () => {
    const context = loadRuntimeContext([
      'public/translator-runtime/js/translation/engine.js',
    ]);

    const chunks = [
      `Chunk 1\n${'A'.repeat(90000)}`,
      `Chunk 2\n${'B'.repeat(90000)}`,
      `Chunk 3\n${'C'.repeat(40000)}\nTAIL-MARKER-FINAL-CHUNK`,
    ];

    const preview = context.buildTranslatedTextPreview(chunks, {
      pendingLabel: 'Đang dịch',
      maxChars: 120000,
    });

    expect(preview.length).toBeLessThanOrEqual(125000);
    expect(preview).toContain('Chunk 1');
    expect(preview).toContain('TAIL-MARKER-FINAL-CHUNK');
  });

  it('shows only a few previous chunks when previewing a resumed translation', () => {
    const context = loadRuntimeContext([
      'public/translator-runtime/js/translation/engine.js',
    ]);

    context.translationStartChunkIndex = 8;
    context.translatedChunks = [
      'CHUNK-CU-1',
      'CHUNK-CU-2',
      'CHUNK-CU-3',
      'CHUNK-CU-4',
      'CHUNK-CU-5',
      'CHUNK-CU-6',
      'CHUNK-CU-7',
      'CHUNK-CU-8',
      'CHUNK-MOI-9',
      null,
    ];

    const preview = context.buildLargeFileResultPreview('Đang dịch', 10_000);

    expect(preview).toContain('3 chunk đã dịch gần nhất');
    expect(preview).not.toContain('CHUNK-CU-5');
    expect(preview).toContain('CHUNK-CU-6');
    expect(preview).toContain('CHUNK-CU-7');
    expect(preview).toContain('CHUNK-CU-8');
    expect(preview).toContain('CHUNK-MOI-9');
    expect(preview).toContain('[Đang dịch chunk 10]');
    expect(preview.length).toBeLessThanOrEqual(10_000);
  });

  it('exports the full translated chunks instead of the capped preview text', async () => {
    let downloadedBlob = null;
    let translatedTextValue = '';

    const translatedTextEl = {
      get value() {
        return translatedTextValue;
      },
      set value(nextValue) {
        translatedTextValue = String(nextValue);
      },
    };

    const anchorEl = {
      href: '',
      download: '',
      click() {},
    };

    const context = loadRuntimeContext([
      'public/translator-runtime/js/translation/engine.js',
      'public/translator-runtime/js/ui/progress.js',
    ], {
      Blob,
      URL: {
        createObjectURL(blob) {
          downloadedBlob = blob;
          return 'blob:translator-test';
        },
        revokeObjectURL() {},
      },
      document: {
        body: {
          appendChild() {},
          removeChild() {},
        },
        createElement(tagName) {
          if (tagName === 'a') return anchorEl;
          return {};
        },
        getElementById(id) {
          if (id === 'translatedText') return translatedTextEl;
          return null;
        },
      },
    });

    context.showToast = () => {};
    context.isTranslating = true;
    context.TRANSLATOR_SOURCE_MODES = { TEXT: 'text', LARGE_FILE: 'large-file' };
    context.currentSourceMode = 'text';
    context.originalFileName = 'story.txt';
    context.translatedChunks = [
      `Chunk 1\n${'A'.repeat(199950)}`,
      `Chunk 2\n${'B'.repeat(4000)}\nTAIL-MARKER-FINAL-CHUNK`,
    ];

    translatedTextEl.value = context.buildTranslatedTextPreview(context.translatedChunks);
    expect(translatedTextEl.value).not.toBe(
      context.buildTranslatedTextFromChunks(context.translatedChunks, '⏳ Đang dịch')
    );

    context.downloadResult();

    expect(downloadedBlob).toBeTruthy();
    const downloadedText = await downloadedBlob.text();
    expect(downloadedText).toBe(
      context.buildTranslatedTextFromChunks(context.translatedChunks, '⏳ Đang dịch')
    );
  });

  it('distinguishes partial and complete session downloads while keeping the same saved output', async () => {
    let downloadedBlob = null;
    let toastMessage = '';
    const anchorEl = {
      href: '',
      download: '',
      click() {},
    };
    const context = loadRuntimeContext([
      'public/translator-runtime/js/ui/progress.js',
    ], {
      Blob,
      URL: {
        createObjectURL(blob) {
          downloadedBlob = blob;
          return 'blob:translator-session-test';
        },
        revokeObjectURL() {},
      },
      document: {
        body: {
          appendChild() {},
          removeChild() {},
        },
        createElement() {
          return anchorEl;
        },
      },
    });

    context.showToast = (message) => {
      toastMessage = message;
    };
    let sessionComplete = false;
    context.getTranslatorSession = async () => ({
      completedChunks: 2,
      isComplete: sessionComplete,
    });
    context.getTranslatorSessionOutputParts = async () => [
      'Chunk cũ đã dịch',
      '\n\n',
      'Chunk mới đã dịch',
    ];

    await context.downloadTranslatorSessionResult('session-1', 'truyen_translated.txt');

    expect(anchorEl.download).toBe('truyen_translated_partial_2chunks.txt');
    expect(await downloadedBlob.text()).toBe('Chunk cũ đã dịch\n\nChunk mới đã dịch');
    expect(toastMessage).toBe('Đã tải 2 chunk đã dịch.');

    sessionComplete = true;
    await context.downloadTranslatorSessionResult('session-1', 'truyen_translated.txt');

    expect(anchorEl.download).toBe('truyen_translated.txt');
    expect(await downloadedBlob.text()).toBe('Chunk cũ đã dịch\n\nChunk mới đã dịch');
    expect(toastMessage).toBe('Đã tải bản dịch đầy đủ.');
  });

  it('downloads a processed session with failed chunks only as an honestly marked issue file', async () => {
    let downloadedBlob = null;
    let toastMessage = '';
    const anchorEl = { href: '', download: '', click() {} };
    const context = loadRuntimeContext([
      'public/translator-runtime/js/ui/progress.js',
    ], {
      Blob,
      URL: {
        createObjectURL(blob) {
          downloadedBlob = blob;
          return 'blob:translator-issues-test';
        },
        revokeObjectURL() {},
      },
      document: {
        body: { appendChild() {}, removeChild() {} },
        createElement() { return anchorEl; },
      },
    });
    context.showToast = (message) => { toastMessage = message; };
    context.getTranslatorSession = async () => ({
      completedChunks: 3,
      failedChunks: 1,
      isComplete: true,
      outputRevision: 7,
    });
    context.getTranslatorSessionOutputParts = async () => [
      'Chunk 1 đã dịch',
      '\n\n',
      '[LỖI CHUNK 2]\nNguyên nhân: quota',
      '\n\n',
      'Chunk 3 đã dịch',
    ];

    const downloaded = await context.downloadTranslatorSessionResult('session-issues', 'truyen.txt');

    expect(downloaded).toBe(true);
    expect(anchorEl.download).toBe('truyen_issues_1chunk.txt');
    expect(await downloadedBlob.text()).toContain('[LỖI CHUNK 2]');
    expect(toastMessage).toBe('Đã tải bản có đánh dấu 1 chunk lỗi.');
  });

  it('refuses to assemble a download while chunk retry is mutating output', async () => {
    let downloadedBlob = null;
    let outputReads = 0;
    let toastMessage = '';
    const context = loadRuntimeContext([
      'public/translator-runtime/js/ui/progress.js',
    ], {
      Blob,
      URL: {
        createObjectURL(blob) {
          downloadedBlob = blob;
          return 'blob:should-not-exist';
        },
        revokeObjectURL() {},
      },
      document: {
        body: { appendChild() {}, removeChild() {} },
        createElement() { return { href: '', download: '', click() {} }; },
      },
      isChunkIssueRetryBusy: true,
    });
    context.showToast = (message) => { toastMessage = message; };
    context.getTranslatorSession = async () => ({ isComplete: true, failedChunks: 0, outputRevision: 1 });
    context.getTranslatorSessionOutputParts = async () => {
      outputReads += 1;
      return ['Không được đọc'];
    };

    const downloaded = await context.downloadTranslatorSessionResult('session-busy', 'truyen.txt');

    expect(downloaded).toBe(false);
    expect(outputReads).toBe(0);
    expect(downloadedBlob).toBeNull();
    expect(toastMessage).toContain('đang được cập nhật');
  });

  it('allows a stable history session to download while another session is retrying', async () => {
    let downloadedBlob = null;
    const anchorEl = { href: '', download: '', click() {} };
    const context = loadRuntimeContext([
      'public/translator-runtime/js/ui/progress.js',
    ], {
      Blob,
      URL: {
        createObjectURL(blob) {
          downloadedBlob = blob;
          return 'blob:unrelated-history';
        },
        revokeObjectURL() {},
      },
      document: {
        body: { appendChild() {}, removeChild() {} },
        createElement() { return anchorEl; },
      },
      isChunkIssueRetryBusy: true,
      chunkIssueRetrySessionId: 'active-session',
    });
    context.showToast = () => {};
    context.getTranslatorSession = async () => ({
      isComplete: true,
      failedChunks: 0,
      outputRevision: 3,
    });
    context.getTranslatorSessionOutputParts = async () => ['Bản dịch lịch sử ổn định'];

    const downloaded = await context.downloadTranslatorSessionResult('history-session', 'lich-su.txt');

    expect(downloaded).toBe(true);
    expect(anchorEl.download).toBe('lich-su.txt');
    expect(await downloadedBlob.text()).toBe('Bản dịch lịch sử ổn định');
  });

  it('drops a stale download snapshot when output revision changes during assembly', async () => {
    let downloadedBlob = null;
    let sessionReads = 0;
    let toastMessage = '';
    const context = loadRuntimeContext([
      'public/translator-runtime/js/ui/progress.js',
    ], {
      Blob,
      URL: {
        createObjectURL(blob) {
          downloadedBlob = blob;
          return 'blob:stale-download';
        },
        revokeObjectURL() {},
      },
      document: {
        body: { appendChild() {}, removeChild() {} },
        createElement() { return { href: '', download: '', click() {} }; },
      },
      isChunkIssueRetryBusy: false,
    });
    context.showToast = (message) => { toastMessage = message; };
    context.getTranslatorSession = async () => {
      const readIndex = sessionReads++;
      return {
        isComplete: true,
        failedChunks: 0,
        ...(readIndex === 0 ? {} : { outputRevision: 1 }),
      };
    };
    context.getTranslatorSessionOutputParts = async () => ['Snapshot cũ'];

    const downloaded = await context.downloadTranslatorSessionResult('session-race', 'truyen.txt');

    expect(downloaded).toBe(false);
    expect(sessionReads).toBe(2);
    expect(downloadedBlob).toBeNull();
    expect(toastMessage).toContain('vừa thay đổi');
  });

  it('downloads the in-memory large-file output when checkpoint persistence becomes unavailable', async () => {
    let downloadedBlob = null;
    let persistedReadCount = 0;
    const context = loadRuntimeContext([
      'public/translator-runtime/js/translation/source-reader.js',
      'public/translator-runtime/js/ui/progress.js',
    ], {
      Blob,
      TextEncoder,
      TextDecoder,
      URL: {
        createObjectURL(blob) {
          downloadedBlob = blob;
          return 'blob:translator-memory-test';
        },
        revokeObjectURL() {},
      },
      document: {
        body: { appendChild() {}, removeChild() {} },
        createElement() { return { click() {}, href: '', download: '' }; },
      },
    });
    context.showToast = () => {};
    context.currentTranslatorSessionId = 'session-with-quota-error';
    context.currentTranslatorPersistenceAvailable = false;
    context.originalFileName = 'story.txt';
    context.completedChunks = 2;
    context.translatedChunks = ['Bản dịch một', 'Bản dịch hai'];
    context.getTranslatorSessionOutputParts = async () => {
      persistedReadCount += 1;
      return ['Dữ liệu cũ'];
    };

    await context.downloadCurrentLargeFileResult();

    expect(persistedReadCount).toBe(0);
    expect(await downloadedBlob.text()).toBe('Bản dịch một\n\nBản dịch hai');
  });

  it('marks an in-memory fallback download when persistence is unavailable and errors remain', async () => {
    let downloadedBlob = null;
    let toastMessage = '';
    const anchorEl = { href: '', download: '', click() {} };
    const context = loadRuntimeContext([
      'public/translator-runtime/js/translation/source-reader.js',
      'public/translator-runtime/js/ui/chunk-tracker.js',
      'public/translator-runtime/js/ui/progress.js',
    ], {
      Blob,
      TextEncoder,
      TextDecoder,
      URL: {
        createObjectURL(blob) {
          downloadedBlob = blob;
          return 'blob:translator-memory-issues';
        },
        revokeObjectURL() {},
      },
      document: {
        body: { appendChild() {}, removeChild() {} },
        createElement() { return anchorEl; },
        getElementById() { return null; },
      },
    });
    context.showToast = (message) => { toastMessage = message; };
    context.currentTranslatorSessionId = 'session-without-persistence';
    context.currentTranslatorPersistenceAvailable = false;
    context.originalFileName = 'story.txt';
    context.completedChunks = 2;
    context.translatedChunks = ['Bản dịch một', '[LỖI CHUNK 2]\nNguyên nhân: quota'];

    const downloaded = await context.downloadCurrentLargeFileResult();

    expect(downloaded).toBe(true);
    expect(anchorEl.download).toBe('story_issues_1chunk.txt');
    expect(await downloadedBlob.text()).toContain('[LỖI CHUNK 2]');
    expect(toastMessage).toBe('Đã tải bản có đánh dấu 1 chunk lỗi.');
  });

  it('runs chunk settlement callbacks as each request finishes instead of waiting for the whole batch', async () => {
    const context = loadRuntimeContext([
      'public/translator-runtime/js/translation/engine.js',
    ]);

    expect(typeof context.settleChunkPromisesIndividually).toBe('function');

    let resolveSlow;
    const slow = new Promise((resolve) => {
      resolveSlow = resolve;
    });
    const events = [];

    const settling = context.settleChunkPromisesIndividually([
      slow,
      Promise.resolve('fast-result'),
    ], (result, index) => {
      events.push(`${index}:${result.status}:${result.value || ''}`);
    });

    await Promise.resolve();
    await Promise.resolve();

    expect(events).toEqual(['1:fulfilled:fast-result']);

    resolveSlow('slow-result');
    await settling;

    expect(events).toEqual([
      '1:fulfilled:fast-result',
      '0:fulfilled:slow-result',
    ]);
  });

  it('turns fulfilled empty translation results into chunk failures', async () => {
    const context = loadRuntimeContext([
      'public/translator-runtime/js/translation/errors.js',
      'public/translator-runtime/js/translation/engine.js',
    ]);
    const results = [];

    await context.settleChunkPromisesIndividually([
      Promise.resolve(undefined),
      Promise.resolve('   '),
      Promise.resolve('Bản dịch hợp lệ'),
    ], (result) => {
      results.push(result);
    });

    expect(results[0]).toMatchObject({
      status: 'rejected',
      reason: { code: 'INVALID_RESPONSE_FORMAT' },
    });
    expect(results[1]).toMatchObject({
      status: 'rejected',
      reason: { code: 'INVALID_RESPONSE_FORMAT' },
    });
    expect(results[2]).toMatchObject({ status: 'fulfilled', value: 'Bản dịch hợp lệ' });
  });

  it('moves the chunk tracker through settled 100-row windows and reports the active range', () => {
    const context = loadRuntimeContext([
      'public/translator-runtime/js/ui/chunk-tracker.js',
    ]);

    [1, 7, 25, 50, 100].forEach((parallelCount) => {
      const rows = Array.from({ length: 250 }, (_, index) => ({
        index,
        status: index < 100
          ? 'success'
          : (index < 100 + parallelCount ? 'translating' : 'pending'),
      }));

      expect(context.getChunkTrackerWindowState(rows)).toEqual({
        start: 100,
        end: 200,
        firstChunk: 101,
        lastChunk: 200,
        activeFirstChunk: 101,
        activeLastChunk: 100 + parallelCount,
      });
    });

    const rows = Array.from({ length: 250 }, (_, index) => ({
      index,
      status: index < 200 ? 'success' : 'pending',
    }));
    rows.slice(100, 200).forEach((row) => {
      row.status = 'success';
    });
    expect(context.getChunkTrackerWindowState(rows).start).toBe(200);

    rows[3].status = 'retrying';
    expect(context.getChunkTrackerWindowState(rows).start).toBe(0);
  });

  it('expands the chunk tracker window for active ranges crossing a 100-row boundary', () => {
    const context = loadRuntimeContext([
      'public/translator-runtime/js/ui/chunk-tracker.js',
    ]);

    const activeAcrossBoundary = Array.from({ length: 150 }, (_, index) => ({
      index,
      status: index < 89
        ? 'success'
        : (index <= 108 ? 'translating' : 'pending'),
    }));

    const activeState = context.getChunkTrackerWindowState(activeAcrossBoundary);
    expect(activeState.firstChunk).toBeLessThanOrEqual(90);
    expect(activeState.lastChunk).toBeGreaterThanOrEqual(109);
    expect(activeState.activeFirstChunk).toBe(90);
    expect(activeState.activeLastChunk).toBe(109);

    const settledThenNext = activeAcrossBoundary.map((row, index) => ({
      ...row,
      status: index < 109 ? 'success' : 'pending',
    }));
    expect(context.getChunkTrackerWindowState(settledThenNext)).toEqual({
      start: 100,
      end: 200,
      firstChunk: 101,
      lastChunk: 150,
      activeFirstChunk: 0,
      activeLastChunk: 0,
    });
  });

  it('keeps translator runtime sources as valid UTF-8 rather than mojibake literals', () => {
    const files = [
      'public/translator-runtime/index.html',
      'public/translator-runtime/js/theme.js',
      'public/translator-runtime/js/app.js',
      'public/translator-runtime/js/translation/engine.js',
      'public/translator-runtime/js/translation/chunker.js',
      'public/translator-runtime/js/translation/retry.js',
      'public/translator-runtime/js/translation/local-store.js',
      'public/translator-runtime/js/translation/han-audit-core.js',
      'public/translator-runtime/js/translation/han-audit-worker.js',
      'public/translator-runtime/js/translation/han-audit.js',
      'public/translator-runtime/js/history/history.js',
      'public/translator-runtime/js/worker-timer.js',
      'public/translator-runtime/js/ui/progress.js',
      'public/translator-runtime/js/ui/chunk-tracker.js',
      'public/translator-runtime/js/ui/controls.js',
    ];

    files.forEach((file) => {
      const source = fs.readFileSync(path.join(repoRoot, file), 'utf8');
      expect(source, file).not.toMatch(/Dá»|Ä[\u0080-\u00bf]|Ã[\u0080-\u00bf]|ðŸ|�/u);
      expect(source, file).not.toMatch(/[\u0080-\u009f]/u);
    });

    const html = fs.readFileSync(path.join(repoRoot, 'public/translator-runtime/index.html'), 'utf8');
    expect(html).toContain('Dịch Truyện');
    expect(html).toContain('📚');
  });

  it('keeps the persistent iframe full-sized while hidden to avoid runtime resize churn', () => {
    const appLayoutCss = fs.readFileSync(path.join(repoRoot, 'src/components/common/AppLayout.css'), 'utf8');
    const hostCss = fs.readFileSync(path.join(repoRoot, 'src/components/translator/PersistentTranslatorHost.css'), 'utf8');

    expect(appLayoutCss).not.toMatch(/translator-shell[\s\S]*?width:\s*1px/u);
    expect(appLayoutCss).not.toMatch(/translator-shell[\s\S]*?height:\s*1px/u);
    expect(hostCss).not.toMatch(/is-background[\s\S]*?width:\s*1px/u);
    expect(hostCss).not.toMatch(/is-background[\s\S]*?height:\s*1px/u);
    expect(`${appLayoutCss}\n${hostCss}`).toMatch(/visibility:\s*hidden/u);
  });
});
