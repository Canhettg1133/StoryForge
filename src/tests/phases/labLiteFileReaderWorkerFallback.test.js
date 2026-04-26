import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeFile, VIETNAMESE_CJK_TEXT } from '../helpers/labLiteTestUtils.js';

async function importFileReaderWithWorker(workerValue, wrapImpl = null) {
  vi.resetModules();
  const previousWorker = globalThis.Worker;
  if (workerValue === undefined) {
    delete globalThis.Worker;
  } else {
    globalThis.Worker = workerValue;
  }
  if (wrapImpl) {
    vi.doMock('comlink', () => ({ wrap: wrapImpl }));
  }
  const module = await import('../../services/labLite/fileReader.js');
  return {
    module,
    restore: () => {
      if (previousWorker === undefined) delete globalThis.Worker;
      else globalThis.Worker = previousWorker;
      vi.doUnmock('comlink');
    },
  };
}

describe('Lab Lite file reader worker fallback', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    vi.doUnmock('comlink');
  });

  it('uses the main-thread TXT path when Worker is unavailable', async () => {
    const { module, restore } = await importFileReaderWithWorker(undefined);
    try {
      const parsed = await module.readLabLiteFile(makeFile('truyen-thu.txt', [
        'Chương 1: Mở đầu',
        '',
        VIETNAMESE_CJK_TEXT,
        '',
        'Chương 2: Dấu mốc',
        '',
        'Minh ghi lại lời hứa mới để giữ mạch truyện.',
      ].join('\n')));

      expect(parsed.fileType).toBe('txt');
      expect(parsed.title).toBe('truyen thu');
      expect(parsed.chapters).toHaveLength(2);
      expect(parsed.rawText).toContain('Chương 1');
      expect(parsed.rawText).toContain('她在旧城门前停下');
      expect(parsed.rawText).not.toContain(`Ch${String.fromCharCode(0x00c6)}`);
    } finally {
      restore();
    }
  });

  it('falls back to main-thread parsing when worker ingest throws', async () => {
    class ThrowingWorker {}
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { module, restore } = await importFileReaderWithWorker(ThrowingWorker, () => ({
      readTextFile: vi.fn().mockRejectedValue(new Error('worker failed')),
    }));
    try {
      const parsed = await module.readLabLiteFile(makeFile('fallback.md', [
        '# Ghi chú',
        '',
        'Chapter 1: Start',
        '',
        'The fallback parser keeps this chapter after worker failure.',
      ].join('\n'), 'text/markdown'));

      expect(parsed.fileType).toBe('md');
      expect(parsed.chapters).toHaveLength(1);
      expect(parsed.chapters[0].content).toContain('fallback parser');
      expect(warnSpy).toHaveBeenCalledWith(
        '[LabLite] Worker ingest failed; falling back to main thread parser.',
        expect.any(Error),
      );
    } finally {
      restore();
    }
  });

  it('rejects unsupported extensions before parsing', async () => {
    const { module, restore } = await importFileReaderWithWorker(undefined);
    try {
      await expect(module.readLabLiteFile(makeFile('story.epub', 'binary', 'application/epub+zip')))
        .rejects.toMatchObject({ code: 'UNSUPPORTED_FILE_TYPE' });
    } finally {
      restore();
    }
  });

  it('keeps DOCX on the DOCX parser path instead of TXT worker ingest', async () => {
    class FakeWorker {
      constructor() {
        throw new Error('TXT worker should not be constructed for DOCX');
      }
    }
    const { module, restore } = await importFileReaderWithWorker(FakeWorker);
    try {
      await expect(module.readLabLiteFile(makeFile(
        'demo.docx',
        'not a real docx',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      ))).rejects.toMatchObject({ code: 'DOCX_UNSUPPORTED' });
    } finally {
      restore();
    }
  });

  it('passes reader options through the fallback parser', async () => {
    const { module, restore } = await importFileReaderWithWorker(undefined);
    try {
      const parsed = await module.readLabLiteFile(makeFile('custom-title.txt', 'Một đoạn duy nhất không có heading.'), {
        title: 'Tên hiển thị riêng',
        fallbackTitlePrefix: 'Phần',
      });

      expect(parsed.title).toBe('Tên hiển thị riêng');
      expect(parsed.chapters).toHaveLength(1);
      expect(parsed.chapters[0].title).toBe('Phần 1');
    } finally {
      restore();
    }
  });
});
