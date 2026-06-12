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
      'public/translator-runtime/js/app.js',
      'public/translator-runtime/js/translation/engine.js',
      'public/translator-runtime/js/translation/chunker.js',
      'public/translator-runtime/js/translation/retry.js',
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
