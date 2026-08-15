import { performance } from 'node:perf_hooks';

await import('../public/translator-runtime/js/translation/source-reader.js');
await import('../public/translator-runtime/js/translation/han-audit-core.js');
await import('../public/translator-runtime/js/translation/han-audit/file-source.js');

const MIB = 1024 * 1024;
const SLICE_BYTES = 256 * 1024;
const encoder = new TextEncoder();
const requestedSizes = process.argv
  .find(argument => argument.startsWith('--sizes='))
  ?.slice('--sizes='.length)
  .split(',')
  .map(Number)
  .filter(size => Number.isFinite(size) && size > 0) || [5, 20, 50];
const densities = ['clean', 'sparse', 'dense'];

class TrackingBlob {
  constructor(blob, name) {
    this.blob = blob;
    this.name = name;
    this.size = blob.size;
    this.lastModified = 0;
    this.sliceCalls = [];
  }

  arrayBuffer() {
    return this.blob.arrayBuffer();
  }

  slice(start, end, type) {
    this.sliceCalls.push({ start, end });
    return this.blob.slice(start, end, type);
  }
}

function buildFixture(sizeMiB, density) {
  const targetBytes = Math.trunc(sizeMiB * MIB);
  let bytes = new Uint8Array(targetBytes);
  bytes.fill(0x61);
  if (density === 'sparse') {
    for (let cursor = 32 * 1024; cursor + 3 <= bytes.length; cursor += 64 * 1024) {
      bytes.set([0xE4, 0xB8, 0xAD], cursor);
    }
  } else if (density === 'dense') {
    let cursor = 0;
    for (; cursor + 3 <= bytes.length; cursor += 3) bytes.set([0xE4, 0xB8, 0xAD], cursor);
  }
  const blob = new Blob([bytes], { type: 'text/plain;charset=utf-8' });
  bytes = null;
  return new TrackingBlob(blob, `${density}-${sizeMiB}mib.txt`);
}

function forceGc() {
  if (typeof global.gc === 'function') global.gc();
}

async function runBenchmark(sizeMiB, density) {
  const tracked = buildFixture(sizeMiB, density);
  const snapshot = await globalThis.TranslatorHanFileSource.createSnapshot(tracked, {
    fileName: tracked.name,
    chunkSize: 4500,
  });
  tracked.sliceCalls.length = 0;
  forceGc();
  const heapBefore = process.memoryUsage().heapUsed;
  const startedAt = performance.now();
  const result = await globalThis.TranslatorHanFileSource.scanSnapshot(snapshot);
  const elapsedMs = performance.now() - startedAt;
  forceGc();
  const heapDeltaBytes = Math.max(0, process.memoryUsage().heapUsed - heapBefore);
  const bytesSliced = tracked.sliceCalls.reduce((sum, call) => sum + Math.max(0, call.end - call.start), 0);
  const scanSliceCount = tracked.sliceCalls.length;
  const indexBytes = encoder.encode(JSON.stringify(result.issues)).length;

  if (result.bytesRead !== tracked.size) throw new Error(`${density} ${sizeMiB} MiB: bytesRead không khớp.`);
  if (bytesSliced > tracked.size + 3) throw new Error(`${density} ${sizeMiB} MiB: đọc lặp byte ngoài ngân sách.`);
  if (tracked.sliceCalls.some(call => call.end - call.start > SLICE_BYTES)) {
    throw new Error(`${density} ${sizeMiB} MiB: có lát đọc vượt 256 KiB.`);
  }
  if (result.issues.some(issue => 'text' in issue || 'preview' in issue || 'ranges' in issue)) {
    throw new Error(`${density} ${sizeMiB} MiB: issue index giữ nội dung không cần thiết.`);
  }
  if (indexBytes > 4 * MIB) throw new Error(`${density} ${sizeMiB} MiB: issue index vượt 4 MiB.`);
  if (sizeMiB === 50 && heapDeltaBytes > 32 * MIB) {
    throw new Error(`${density} 50 MiB: heap tăng ${(heapDeltaBytes / MIB).toFixed(1)} MiB, vượt 32 MiB.`);
  }

  const replacements = new Map();
  if (result.issues[0]) {
    const issue = result.issues[0];
    replacements.set(issue.chunkIndex, globalThis.TranslatorHanFileSource.createReplacement(issue, 'Đã sửa.'));
  }
  const output = globalThis.TranslatorHanFileSource.buildOutputBlob(snapshot, replacements);
  if (!(output instanceof Blob)) throw new Error(`${density} ${sizeMiB} MiB: output không phải Blob ghép lát.`);

  return {
    type: 'han-file-scan',
    density,
    sizeMiB,
    elapsedMs: Number(elapsedMs.toFixed(1)),
    heapDeltaMiB: Number((heapDeltaBytes / MIB).toFixed(2)),
    slices: scanSliceCount,
    issues: result.issues.length,
    totalHan: result.totalHan,
    indexMiB: Number((indexBytes / MIB).toFixed(3)),
  };
}

for (const sizeMiB of requestedSizes) {
  for (const density of densities) {
    console.log(JSON.stringify(await runBenchmark(sizeMiB, density)));
  }
}
