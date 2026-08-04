import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import '../../../public/translator-runtime/js/translation/source-reader.js';

const {
  createLazyChunkReader,
  estimateChunkCountFromPreview,
  scanTranslatorSource,
  selectLargeFileChunkCut,
  buildBlobPartsFromChunks,
} = globalThis.TranslatorLargeFileSource;

class TrackingFile extends Blob {
  constructor(parts, options = {}) {
    super(parts, { type: 'text/plain;charset=utf-8' });
    this.name = options.name || 'large.txt';
    this.lastModified = options.lastModified || Date.now();
    this.sliceCalls = [];
    this.fullTextCalls = 0;
  }

  async text() {
    this.fullTextCalls += 1;
    return super.text();
  }

  slice(start, end, contentType) {
    this.sliceCalls.push({ start, end });
    return super.slice(start, end, contentType);
  }
}

describe('translator large-file source helpers', () => {
  it.each([4500, 6000])('reads each source byte at most once for %i-character chunks', async (chunkSize) => {
    const text = `${'Đoạn truyện có tiếng Việt và emoji 🐉. '.repeat(140000)}Kết thúc.`;
    const file = new TrackingFile([text]);

    const chunks = [];
    for await (const chunk of createLazyChunkReader(file, {
      chunkSize,
      windowBytes: 256 * 1024,
      minWindowBytes: 256 * 1024,
    })) {
      chunks.push(chunk);
    }

    const bytesRead = file.sliceCalls.reduce((sum, call) => sum + (call.end - call.start), 0);
    expect(bytesRead).toBeLessThanOrEqual(Math.ceil(file.size * 1.05));
    expect(chunks.map(chunk => chunk.text).join('')).toBe(text);
  });

  it('preserves UTF-8 BOM, emoji, CRLF and exact checkpoint offsets', async () => {
    const text = '\uFEFFMở đầu 🐉\r\n\r\nChương hai 😄\r\n\r\nKết thúc.';
    const file = new TrackingFile([text]);
    const firstPass = [];

    for await (const chunk of createLazyChunkReader(file, {
      chunkSize: 12,
      windowBytes: 16,
      minWindowBytes: 16,
    })) {
      firstPass.push(chunk);
    }

    expect(firstPass.map(chunk => chunk.text).join('')).toBe(text.replace(/^\uFEFF/, ''));
    expect(firstPass.every((chunk, index) => (
      index === 0 || chunk.byteStart === firstPass[index - 1].byteEnd
    ))).toBe(true);
    expect(firstPass.at(-1).byteEnd).toBe(file.size);

    const checkpoint = firstPass[1];
    const resumed = [];
    for await (const chunk of createLazyChunkReader(file, {
      chunkSize: 12,
      windowBytes: 16,
      minWindowBytes: 16,
      startByte: checkpoint.byteStart,
      startIndex: checkpoint.index,
    })) {
      resumed.push(chunk);
    }

    expect(resumed[0].byteStart).toBe(checkpoint.byteStart);
    expect(resumed.map(chunk => chunk.text).join('')).toBe(firstPass.slice(1).map(chunk => chunk.text).join(''));
  });

  it('searches a source once, reports progress and returns three preceding chunks', async () => {
    const text = Array.from({ length: 80 }, (_, index) => (
      index === 73 ? `Chương ${index}: MỐC BÍ MẬT ở gần cuối.` : `Chương ${index}: Nội dung bình thường.`
    )).join('\n\n');
    const file = new TrackingFile([text]);
    const progress = [];

    const result = await scanTranslatorSource(file, 'mốc bí mật', {
      chunkSize: 40,
      limit: 12,
      contextCount: 3,
      onProgress: value => progress.push(value),
    });

    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].sourcePreview.toLocaleLowerCase('vi-VN')).toContain('mốc bí mật');
    expect(result.matches[0].contextBefore.split('\n\nChunk ')).toHaveLength(3);
    expect(result.matches[0].byteEnd).toBeGreaterThan(result.matches[0].byteStart);
    expect(progress.at(-1)).toBe(1);
    expect(file.sliceCalls.reduce((sum, call) => sum + call.end - call.start, 0)).toBeLessThanOrEqual(file.size);
  });

  it('cancels a cooperative search before reading the whole file', async () => {
    const file = new TrackingFile(['Nội dung không có từ khóa.\n\n'.repeat(250000)]);
    const controller = new AbortController();

    const result = await scanTranslatorSource(file, 'không-tồn-tại', {
      chunkSize: 4500,
      signal: controller.signal,
      onProgress: () => controller.abort(),
    });

    expect(result.cancelled).toBe(true);
    expect(result.scannedBytes).toBeLessThan(file.size);
  });

  it('reads large files through bounded slices instead of file.text()', async () => {
    const text = Array.from({ length: 1200 }, (_, index) =>
      `Đoạn ${index + 1}: Nội dung tiếng Việt có dấu để kiểm tra đọc file lớn.`
    ).join('\n\n');
    const file = new TrackingFile([text]);

    const chunks = [];
    for await (const chunk of createLazyChunkReader(file, {
      chunkSize: 1200,
      windowBytes: 4096,
      minWindowBytes: 4096,
    })) {
      chunks.push(chunk);
      if (chunks.length >= 4) break;
    }

    expect(file.fullTextCalls).toBe(0);
    expect(file.sliceCalls.length).toBeGreaterThan(0);
    expect(file.sliceCalls.every(call => (call.end - call.start) <= 4096)).toBe(true);
    expect(chunks.every(chunk => chunk.byteEnd > chunk.byteStart)).toBe(true);
  });

  it('keeps the byte cursor moving and reconstructs text in order', async () => {
    const paragraphs = [
      'Mở đầu có tiếng Việt có dấu.',
      'Đoạn hai có khoảng trắng và xuống dòng.',
      'Một đoạn rất dài '.repeat(80),
      'Kết thúc.',
    ];
    const text = paragraphs.join('\n\n');
    const file = new TrackingFile([text]);

    const chunks = [];
    for await (const chunk of createLazyChunkReader(file, {
      chunkSize: 160,
      windowBytes: 512,
      minWindowBytes: 512,
    })) {
      chunks.push(chunk);
    }

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk, index) => index === 0 || chunk.byteStart >= chunks[index - 1].byteEnd)).toBe(true);
    expect(chunks.map(chunk => chunk.text).join('')).toBe(text);
  });

  it('cuts near paragraph boundaries when possible and hard-cuts long paragraphs', () => {
    const boundaryText = `A ${'x'.repeat(80)}\n\nB ${'y'.repeat(80)}`;
    const boundaryCut = selectLargeFileChunkCut(boundaryText, 90);
    expect(boundaryText.slice(0, boundaryCut)).toContain('\n\n');

    const longParagraph = 'z'.repeat(500);
    const hardCut = selectLargeFileChunkCut(longParagraph, 120);
    expect(hardCut).toBe(120);
  });

  it('builds Blob parts without joining all translated chunks into one string', () => {
    const chunks = ['Một', null, 'Hai', 'Ba'];
    const parts = buildBlobPartsFromChunks(chunks, { includePending: false });

    expect(parts).toEqual(['Một', '\n\n', 'Hai', '\n\n', 'Ba']);
  });

  it('marks chunk estimates as approximate from preview data', () => {
    const estimate = estimateChunkCountFromPreview({
      fileSize: 20 * 1024 * 1024,
      previewText: 'Tiếng Việt có dấu. '.repeat(100),
      chunkSize: 4500,
    });

    expect(estimate.approximate).toBe(true);
    expect(estimate.count).toBeGreaterThan(0);
  });

  it('loads source-reader before the translation engine and keeps worker timer in place', () => {
    const html = readFileSync(resolve(process.cwd(), 'public/translator-runtime/index.html'), 'utf8');
    const workerIndex = html.indexOf('js/worker-timer.js');
    const sourceReaderIndex = html.indexOf('js/translation/source-reader.js');
    const engineIndex = html.indexOf('js/translation/engine.js');

    expect(workerIndex).toBeGreaterThan(-1);
    expect(sourceReaderIndex).toBeGreaterThan(-1);
    expect(engineIndex).toBeGreaterThan(-1);
    expect(workerIndex).toBeLessThan(engineIndex);
    expect(sourceReaderIndex).toBeLessThan(engineIndex);
  });

  it('searches only on button or Enter and ships a cancellable worker', () => {
    const html = readFileSync(resolve(process.cwd(), 'public/translator-runtime/index.html'), 'utf8');
    const fileHandler = readFileSync(
      resolve(process.cwd(), 'public/translator-runtime/js/ui/file-handler.js'),
      'utf8'
    );
    const worker = readFileSync(
      resolve(process.cwd(), 'public/translator-runtime/js/translation/source-search-worker.js'),
      'utf8'
    );

    expect(html).toContain('data-click-action="runStartChunkSearch"');
    expect(html).toContain('data-keydown-action="runStartChunkSearch"');
    expect(html).toContain('<details id="startChunkDetails">');
    expect(fileHandler).not.toContain('setTimeout(() => runStartChunkSearch()');
    expect(fileHandler).toContain("startChunkSearchWorker.terminate()");
    expect(worker).toContain("importScripts('./source-reader.js?v=22')");
    expect(worker).toContain("type: 'progress'");
  });

  it('presents start-position search as an optional, plain-language action', () => {
    const html = readFileSync(resolve(process.cwd(), 'public/translator-runtime/index.html'), 'utf8');
    const css = readFileSync(resolve(process.cwd(), 'public/translator-runtime/style.css'), 'utf8');
    const fileHandler = readFileSync(
      resolve(process.cwd(), 'public/translator-runtime/js/ui/file-handler.js'),
      'utf8'
    );

    expect(html).toContain('Dịch từ đoạn khác');
    expect(html).toContain('Tùy chọn · mặc định dịch từ đầu truyện');
    expect(html).toContain('Tìm trong truyện');
    expect(html).toContain('id="cancelStartChunkSearchBtn"');
    expect(html).toMatch(/id="cancelStartChunkSearchBtn"[^>]+hidden/u);
    expect(html).not.toContain('Dùng 3 chunk trước làm ngữ cảnh');
    expect(html).not.toContain('Tìm đoạn bắt đầu</h2>');
    expect(css).toContain('.optional-tool-summary');
    expect(fileHandler).toContain('function setStartChunkSearchBusy(isBusy)');
  });

  it('routes large uploads through preview loading before the FileReader text path', () => {
    const fileHandler = readFileSync(
      resolve(process.cwd(), 'public/translator-runtime/js/ui/file-handler.js'),
      'utf8'
    );
    const largeBranchIndex = fileHandler.indexOf('isLargeFileCandidate(file)');
    const previewReadIndex = fileHandler.indexOf('readFilePreview(file)');
    const textFlowCallIndex = fileHandler.indexOf('processTextFile(file);');

    expect(largeBranchIndex).toBeGreaterThan(-1);
    expect(textFlowCallIndex).toBeGreaterThan(largeBranchIndex);
    expect(previewReadIndex).toBeGreaterThan(textFlowCallIndex);
  });

  it('shows a visible upload busy state while reading and indexing a story file', () => {
    const html = readFileSync(resolve(process.cwd(), 'public/translator-runtime/index.html'), 'utf8');
    const fileHandler = readFileSync(
      resolve(process.cwd(), 'public/translator-runtime/js/ui/file-handler.js'),
      'utf8'
    );

    expect(html).toContain('id="uploadStatus"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('id="uploadStatusText"');
    expect(fileHandler).toContain('function setFileLoadState');
    expect(fileHandler).toContain("setFileLoadState('reading', file)");
    expect(fileHandler).toContain("setFileLoadState('indexing', file)");
    expect(fileHandler).toContain("setFileLoadState('preview', file)");
    expect(fileHandler).toContain("setFileLoadState('idle')");
    expect(fileHandler).toContain('fileInput.disabled = isBusy');
    expect(fileHandler).toContain("uploadArea.setAttribute('aria-busy'");
  });

  it('builds prompted chunks on demand instead of mapping the whole story first', () => {
    const engine = readFileSync(
      resolve(process.cwd(), 'public/translator-runtime/js/translation/engine.js'),
      'utf8'
    );

    expect(engine).not.toContain('chunks.map(chunk => buildPromptedChunk');
    expect(engine).toContain('buildPromptedChunk(customPrompt, chunks[chunkIndex], sourceLang)');
    expect(engine).toContain('buildPromptedChunk(customPrompt, chunk.text, sourceLang)');
  });
});
