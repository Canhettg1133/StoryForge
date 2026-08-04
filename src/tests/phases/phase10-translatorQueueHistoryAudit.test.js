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

function getCssRuleBody(source, selector) {
  const startToken = `${selector} {`;
  const start = source.indexOf(startToken);
  expect(start).toBeGreaterThanOrEqual(0);

  const braceStart = source.indexOf('{', start);
  expect(braceStart).toBeGreaterThanOrEqual(0);

  const end = source.indexOf('\n}', braceStart);
  expect(end).toBeGreaterThan(braceStart);
  return source.slice(braceStart + 1, end);
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
    expect(html).toContain('Dịch từ đoạn khác');
    expect(html).toContain('Hàng đợi');
    expect(initSource).toContain('handleStartChunkSearchInput');
    expect(initSource).toContain('toggleTranslationQueuePanel');
  });

  it('keeps long translator history and queue names inside the visible panel width', () => {
    const css = readRuntime('public/translator-runtime/style.css');
    const historySource = readRuntime('public/translator-runtime/js/history/history.js');
    const fileHandlerSource = readRuntime('public/translator-runtime/js/ui/file-handler.js');
    const historyListRule = getCssRuleBody(css, '.history-list');
    const historyInfoRule = getCssRuleBody(css, '.history-item .history-info');
    const historyNameRule = getCssRuleBody(css, '.history-item .history-name');
    const queueListRule = getCssRuleBody(css, '.translation-queue-list');
    const queueMainRule = getCssRuleBody(css, '.translation-queue-item__main');
    const queueNameRule = getCssRuleBody(css, '.translation-queue-item__main strong');

    expect(historyListRule).toContain('overflow-x: hidden;');
    expect(historyInfoRule).toContain('flex: 1 1 0;');
    expect(historyInfoRule).toContain('overflow: hidden;');
    expect(historyNameRule).toContain('text-overflow: ellipsis;');
    expect(historySource).toContain('name.title = item.name;');
    expect(historySource).toContain('name.textContent = item.name;');
    expect(fileHandlerSource).toContain('<strong title="${escapeHtmlAttribute(sessionName)}">${escapeHtml(sessionName)}</strong>');
    expect(queueListRule).toContain('overflow-x: hidden;');
    expect(queueMainRule).toContain('flex: 1 1 0;');
    expect(queueMainRule).toContain('overflow: hidden;');
    expect(queueNameRule).toContain('display: block;');
    expect(queueNameRule).toContain('text-overflow: ellipsis;');
  });

  it('keeps selected and dropped story files routed into the translator queue', () => {
    const fileHandlerSource = readRuntime('public/translator-runtime/js/ui/file-handler.js');
    const handleFileSelectBody = getFunctionBody(fileHandlerSource, 'handleFileSelect');
    const handleDropBody = getFunctionBody(fileHandlerSource, 'handleDrop');
    const enqueueBody = getFunctionBody(fileHandlerSource, 'enqueueTranslatorFiles');

    expect(handleFileSelectBody).toContain('if (isTranslating)');
    expect(handleFileSelectBody).toContain("await enqueueTranslatorFiles(files)");
    expect(handleFileSelectBody).toContain("await processFile(files[0])");
    expect(handleFileSelectBody).toContain("await enqueueTranslatorFiles(files.slice(1))");
    expect(handleDropBody).toContain('if (isTranslating)');
    expect(handleDropBody).toContain("await enqueueTranslatorFiles(files)");
    expect(handleDropBody).toContain("if (files.length > 1) await enqueueTranslatorFiles(files.slice(1));");
    expect(enqueueBody).toContain("filter(file => /\\.txt$/i.test(file.name || ''))");
    expect(enqueueBody).toContain('createLocalSessionForFile(file');
    expect(enqueueBody).toContain('enqueueTranslatorSession(session.id)');
    expect(enqueueBody).toContain('renderTranslationQueue()');
    expect(enqueueBody).toContain('toggleTranslationQueuePanel(true)');
  });

  it('exposes direct queue controls for adding files, running, cancelling, and drag reordering', () => {
    const html = readRuntime('public/translator-runtime/index.html');
    const appSource = readRuntime('public/translator-runtime/js/app.js');
    const initSource = readRuntime('public/translator-runtime/js/init.js');
    const fileHandlerSource = readRuntime('public/translator-runtime/js/ui/file-handler.js');
    const localStoreSource = readRuntime('public/translator-runtime/js/translation/local-store.js');
    const renderQueueBody = getFunctionBody(fileHandlerSource, 'renderTranslationQueue');

    expect(html).toContain('id="queueFileInput"');
    expect(html).toContain('id="queueFilesBtn"');
    expect(html).toContain('id="runTranslationQueueBtn"');
    expect(appSource).toContain("document.getElementById('queueFileInput')");
    expect(appSource).toContain('handleQueueFileSelect');
    expect(fileHandlerSource).toContain('async function handleQueueFileSelect');
    expect(fileHandlerSource).toContain('function openQueueFilePicker');
    expect(fileHandlerSource).toContain('async function startTranslatorQueue');
    expect(fileHandlerSource).toContain('async function cancelQueuedTranslatorItem');
    expect(fileHandlerSource).toContain('function handleQueueDragStart');
    expect(fileHandlerSource).toContain('async function handleQueueDrop');
    expect(renderQueueBody).toContain('draggable="${canReorder ? \'true\' : \'false\'}"');
    expect(renderQueueBody).toContain('data-click-action="cancelQueuedTranslatorItem"');
    expect(renderQueueBody).toContain('data-queue-id="${escapeHtmlAttribute(item.id)}"');
    expect(localStoreSource).toContain('async function reorderTranslatorQueueItems');
    expect(initSource).toContain('startTranslatorQueue');
    expect(initSource).toContain('handleQueueDragStart');
    expect(initSource).toContain('handleQueueDrop');
  });
});
