import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = process.cwd();

function readRuntime(file) {
  return fs.readFileSync(path.join(repoRoot, file), 'utf8');
}

function getFunctionBody(source, functionName) {
  const startToken = `function ${functionName}`;
  const start = source.indexOf(startToken);
  expect(start).toBeGreaterThanOrEqual(0);

  const signatureEnd = source.indexOf(') {', start);
  expect(signatureEnd).toBeGreaterThanOrEqual(0);

  const braceStart = signatureEnd + 2;
  let depth = 0;
  for (let index = braceStart; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') depth -= 1;
    if (depth === 0) {
      return source.slice(braceStart + 1, index);
    }
  }

  throw new Error(`Could not read body for ${functionName}`);
}

describe('translator queue/history audit', () => {
  it('keeps history in IndexedDB and strips chunk arrays before saving', () => {
    const historySource = readRuntime('public/translator-runtime/js/history/history.js');
    const saveHistoryBody = getFunctionBody(historySource, 'saveHistory');

    expect(historySource).toContain("const HISTORY_DB_NAME = 'NovelTranslatorDB'");
    expect(historySource).toContain('indexedDB.open(HISTORY_DB_NAME, HISTORY_DB_VERSION)');
    expect(saveHistoryBody).toContain('chunks: []');
    expect(saveHistoryBody).toContain('translatedChunksData: keepResumeData ? item.translatedChunksData : null');
    expect(historySource).toContain('function flushHistoryWrites');
  });

  it('persists large-file translation progress to history records', () => {
    const engineSource = readRuntime('public/translator-runtime/js/translation/engine.js');
    const largeFileBody = getFunctionBody(engineSource, 'startLargeFileTranslation');

    expect(largeFileBody).toContain('addToHistory(');
    expect(largeFileBody).toContain('updateHistoryProgress(');
    expect(largeFileBody).toContain('flushHistoryWrites');
  });

  it('downloads large-file history from local chunk storage instead of preview textarea', () => {
    const progressSource = readRuntime('public/translator-runtime/js/ui/progress.js');
    const downloadResultBody = getFunctionBody(progressSource, 'downloadResult');
    const historySource = readRuntime('public/translator-runtime/js/history/history.js');

    expect(downloadResultBody).toContain('currentSourceMode === TRANSLATOR_SOURCE_MODES.LARGE_FILE');
    expect(downloadResultBody).toContain('downloadCurrentLargeFileResult');
    expect(historySource).toContain('downloadHistoryResult');
    expect(historySource).toContain('getTranslatorSessionOutputParts');
  });

  it('loads local storage before the engine and exposes start search plus queue UI', () => {
    const html = readRuntime('public/translator-runtime/index.html');
    const initSource = readRuntime('public/translator-runtime/js/init.js');
    const localStoreIndex = html.indexOf('js/translation/local-store.js');
    const engineIndex = html.indexOf('js/translation/engine.js');

    expect(localStoreIndex).toBeGreaterThan(-1);
    expect(localStoreIndex).toBeLessThan(engineIndex);
    expect(html).toContain('id="startChunkPanel"');
    expect(html).toContain('id="translationQueuePanel"');
    expect(html).toContain('Tìm đoạn bắt đầu');
    expect(html).toContain('Hàng đợi');
    expect(initSource).toContain('handleStartChunkSearchInput');
    expect(initSource).toContain('toggleTranslationQueuePanel');
  });
});
