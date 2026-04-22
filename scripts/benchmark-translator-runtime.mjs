import fs from 'node:fs';
import vm from 'node:vm';
import { performance } from 'node:perf_hooks';
import { JSDOM } from 'jsdom';

globalThis.performance = performance;

function loadRuntimeContext(files) {
  const dom = new JSDOM(`<!doctype html><body>
    <div id="progressFill"></div>
    <span id="progressText"></span>
    <span id="progressDetails"></span>
    <div id="progressStatus"></div>
    <button id="downloadPartialBtn"></button>
    <div id="chunkTrackerList"></div>
    <div id="chunkTrackerSummary"></div>
    <span id="chunkTrackerBadge"></span>
    <section id="chunkTrackerPanel"></section>
  </body>`);

  const context = {
    console: { log() {}, warn() {}, error() {} },
    performance,
    Date,
    setTimeout,
    clearTimeout,
    document: dom.window.document,
    window: dom.window,
    useProxy: false,
    getProxyKeyCount: () => 0,
    translatedChunks: [],
  };

  vm.createContext(context);
  files.forEach((file) => {
    vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: file });
  });
  return context;
}

function makeLargeText(targetBytes) {
  const paragraph = 'Lâm Phong nhìn về phía thành Trường An. "Ngươi thật sự muốn đi sao?" Nàng khẽ hỏi.\nHắn đáp: Ta còn phải tìm Thiên Kiếm môn, công pháp Huyền Minh, và lời hứa năm xưa.\n\n';
  return paragraph.repeat(Math.ceil(targetBytes / Buffer.byteLength(paragraph))).slice(0, targetBytes);
}

function measure(label, fn) {
  const start = performance.now();
  const result = fn();
  const duration = performance.now() - start;
  console.log(`${label}: ${duration.toFixed(1)}ms`);
  return result;
}

const text = makeLargeText(10 * 1024 * 1024);
const context = loadRuntimeContext([
  'public/translator-runtime/js/translation/chunker.js',
  'public/translator-runtime/js/translation/engine.js',
  'public/translator-runtime/js/ui/progress.js',
  'public/translator-runtime/js/ui/chunk-tracker.js',
]);

const chunks = measure('chunking 10MiB', () => context.splitTextIntoChunks(text, 6000));
console.log(`chunks: ${chunks.length}`);

const prompt = '[PROMPT tiếng Việt Hán-Việt tên riêng]\n'.repeat(50);
const translated = chunks.map((chunk, index) => (index % 5 === 0 ? null : chunk));
context.translatedChunks = translated;

measure('prompt build per chunk x1000', () => {
  let total = 0;
  for (let index = 0; index < Math.min(1000, chunks.length); index += 1) {
    total += context.buildPromptedChunk(prompt, chunks[index]).length;
  }
  return total;
});

measure('bounded preview x200', () => {
  let last = '';
  for (let index = 0; index < 200; index += 1) {
    last = context.buildTranslatedTextPreview(translated, {
      pendingLabel: 'Đang dịch',
      maxChars: 200000,
    });
  }
  return last.length;
});

measure('history snapshot full join x40', () => {
  let last = '';
  for (let index = 0; index < 40; index += 1) {
    last = context.buildHistoryTextSnapshotFromChunks(translated);
  }
  return last.length;
});

measure('progress DOM update x5000', () => {
  for (let index = 0; index < 5000; index += 1) {
    context.updateProgress(index, 5000, `Đang dịch ${index}`);
  }
});

measure('chunk tracker init render', () => context.initChunkTracker(chunks, null, prompt));
measure('chunk tracker success updates x1000', () => {
  for (let index = 0; index < Math.min(1000, chunks.length); index += 1) {
    context.trackChunkSuccess(index, chunks[index], 'bench');
  }
});
