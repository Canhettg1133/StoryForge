import { performance } from 'node:perf_hooks';
import JSZip from 'jszip';

await import('../public/translator-runtime/js/chapter/chapter-rules.js');
await import('../public/translator-runtime/js/chapter/chapter-indexer.js');
await import('../public/translator-runtime/js/chapter/chapter-epub.js');

const MIB = 1024 * 1024;
const encoder = new TextEncoder();
const requestedSizes = process.argv
  .find(argument => argument.startsWith('--sizes='))
  ?.slice('--sizes='.length)
  .split(',')
  .map(Number)
  .filter(size => Number.isFinite(size) && size > 0) || [5, 20, 50];
const runEpub = process.argv.includes('--epub');
const filler = 'Noi dung truyen duoc giu thanh tung dong ngan de mo phong van ban that.\n'.repeat(256);

function buildFixture(sizeMiB) {
  const targetBytes = Math.trunc(sizeMiB * MIB);
  const chapterCount = Math.min(5_000, Math.max(100, Math.trunc(sizeMiB * 100)));
  const parts = [];
  let writtenBytes = 0;

  for (let index = 1; index <= chapterCount; index += 1) {
    const remainingChapters = chapterCount - index + 1;
    const targetPartBytes = Math.max(1, Math.floor((targetBytes - writtenBytes) / remainingChapters));
    const heading = `Chương ${index}: Mốc benchmark ${index}\n`;
    const headingBytes = encoder.encode(heading).length;
    const contentBytes = Math.max(0, targetPartBytes - headingBytes);
    parts.push(heading);
    let remainingContent = contentBytes;
    while (remainingContent > 0) {
      const length = Math.min(remainingContent, filler.length);
      const isFinalFragment = length === remainingContent;
      parts.push(isFinalFragment
        ? (length === 1 ? '\n' : `${filler.slice(0, length - 1)}\n`)
        : filler);
      remainingContent -= length;
    }
    writtenBytes += headingBytes + contentBytes;
  }

  if (writtenBytes < targetBytes) parts.push('x'.repeat(targetBytes - writtenBytes));
  const blob = new Blob(parts, { type: 'text/plain;charset=utf-8' });
  parts.length = 0;
  return { blob, chapterCount };
}

function forceGc() {
  if (typeof global.gc === 'function') global.gc();
}

async function benchmarkScan(sizeMiB) {
  const { blob, chapterCount } = buildFixture(sizeMiB);
  forceGc();
  const heapBefore = process.memoryUsage().heapUsed;
  const startedAt = performance.now();
  const result = await globalThis.TranslatorChapterIndexer.scanChapterBlob(blob);
  const elapsedMs = performance.now() - startedAt;
  const heapAfter = process.memoryUsage().heapUsed;
  const heapDeltaBytes = Math.max(0, heapAfter - heapBefore);
  const expectedSlices = Math.ceil(blob.size / (256 * 1024));
  const indexBytes = encoder.encode(JSON.stringify(result.chapters)).length;

  if (result.bytesRead !== blob.size) throw new Error(`${sizeMiB} MiB: bytesRead không khớp Blob.`);
  if (result.sliceCount !== expectedSlices) throw new Error(`${sizeMiB} MiB: số lát đọc không tuyến tính.`);
  if (result.diagnostics.length > 200) throw new Error(`${sizeMiB} MiB: diagnostics vượt giới hạn.`);
  if (result.chapters.length !== chapterCount) throw new Error(`${sizeMiB} MiB: mất mốc chương.`);
  if (indexBytes > 4 * MIB) throw new Error(`${sizeMiB} MiB: cấu trúc index vượt 4 MiB.`);
  if (sizeMiB === 20 && heapDeltaBytes > 32 * MIB) {
    throw new Error(`20 MiB: heap sau scan tăng ${(heapDeltaBytes / MIB).toFixed(1)} MiB, vượt mục tiêu 32 MiB.`);
  }

  return {
    sizeMiB,
    elapsedMs: Number(elapsedMs.toFixed(1)),
    heapDeltaMiB: Number((heapDeltaBytes / MIB).toFixed(2)),
    chapters: result.chapters.length,
    slices: result.sliceCount,
    indexMiB: Number((indexBytes / MIB).toFixed(3)),
    blob,
    result,
  };
}

function jsZipAtLevel(level) {
  return function BenchmarkZip() {
    const zip = new JSZip();
    const generateAsync = zip.generateAsync.bind(zip);
    zip.generateAsync = options => generateAsync({
      ...options,
      compressionOptions: { level },
    });
    return zip;
  };
}

async function benchmarkEpub(scan) {
  const snapshot = Object.freeze({
    blob: scan.blob,
    fileName: 'benchmark.txt',
    kind: 'translated',
    partial: false,
    partialReason: null,
    completedChunks: scan.result.chapters.length,
    totalChunks: scan.result.chapters.length,
    revision: 'benchmark',
  });

  async function runLevel(level) {
    forceGc();
    const startedAt = performance.now();
    const output = await globalThis.TranslatorChapterEpub.buildChapterEpub({
      snapshot,
      chapters: scan.result.chapters,
      title: 'Benchmark Translator',
      modified: '2026-08-15T00:00:00Z',
    }, { JSZip: jsZipAtLevel(level) });
    return {
      level,
      elapsedMs: Number((performance.now() - startedAt).toFixed(1)),
      outputMiB: Number((output.bytes.byteLength / MIB).toFixed(3)),
    };
  }

  const level3 = await runLevel(3);
  const level9 = await runLevel(9);
  if (level3.elapsedMs > level9.elapsedMs * 1.2) {
    throw new Error(`EPUB level 3 chậm hơn level 9 quá 20% (${level3.elapsedMs} ms so với ${level9.elapsedMs} ms).`);
  }
  return { level3, level9 };
}

const scans = [];
for (const sizeMiB of requestedSizes) {
  const scan = await benchmarkScan(sizeMiB);
  scans.push(scan);
  console.log(JSON.stringify({ type: 'scan', ...scan, blob: undefined, result: undefined }));
}

if (runEpub) {
  const reference = scans.find(scan => scan.sizeMiB === Math.min(...requestedSizes)) || scans[0];
  console.log(JSON.stringify({ type: 'epub', ...(await benchmarkEpub(reference)) }));
}
