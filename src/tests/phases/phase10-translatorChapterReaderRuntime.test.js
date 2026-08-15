import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

function loadReaderUtils() {
  const context = {
    Array,
    Blob,
    Math,
    Number,
    Object,
    String,
    TextDecoder,
    TextEncoder,
    Uint8Array,
    console: { log() {}, warn() {}, error() {} },
  };
  context.globalThis = context;
  context.self = context;
  vm.createContext(context);
  const file = 'public/translator-runtime/js/chapter/chapter-feature.js';
  vm.runInContext(fs.readFileSync(path.join(process.cwd(), file), 'utf8'), context, { filename: file });
  return context.TranslatorChapterFeatureUtils;
}

describe('Translator chapter reader performance guards', () => {
  it('caps the virtual table-of-contents window at 60 rows', () => {
    const utils = loadReaderUtils();
    const windowState = utils.computeVirtualWindow(5_000, 83_000, 640);

    expect(windowState.start).toBeGreaterThanOrEqual(0);
    expect(windowState.end).toBeLessThanOrEqual(5_000);
    expect(windowState.end - windowState.start).toBeLessThanOrEqual(60);
  });

  it('creates contiguous content pages no larger than 256 KiB', () => {
    const utils = loadReaderUtils();
    const pages = utils.createBytePages(117, (256 * 1024 * 3) + 931);

    expect(pages[0].start).toBe(117);
    expect(pages.at(-1).end).toBe((256 * 1024 * 3) + 931);
    expect(pages.every(page => page.end - page.start <= 256 * 1024)).toBe(true);
    for (let index = 1; index < pages.length; index += 1) {
      expect(pages[index].start).toBe(pages[index - 1].end);
    }
  });

  it('does not cut a UTF-8 code point at an internal page boundary', () => {
    const utils = loadReaderUtils();
    const bytes = new TextEncoder().encode(`abc${'😀'}xyz`);
    const safeEnd = utils.findSafeUtf8End(bytes, 5);
    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes.slice(0, safeEnd));

    expect(decoded).toBe('abc');
    expect(safeEnd).toBe(3);
  });

  it('allows a manual heading at byte zero to replace only the synthetic Nội dung fallback', () => {
    const utils = loadReaderUtils();

    expect(utils.isSyntheticFallbackChapter({
      title: 'Nội dung',
      family: 'special',
      headingByteStart: 0,
      contentByteStart: 0,
    }, 1)).toBe(true);
    expect(utils.isSyntheticFallbackChapter({
      title: 'Chương 1',
      family: 'chapter',
      headingByteStart: 0,
      contentByteStart: 10,
    }, 1)).toBe(false);
  });
});
