import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import '../../../public/translator-runtime/js/translation/source-reader.js';

const {
  createLazyChunkReader,
  estimateChunkCountFromPreview,
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
