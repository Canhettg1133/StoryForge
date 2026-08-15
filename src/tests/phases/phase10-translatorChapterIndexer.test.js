import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

const repoRoot = process.cwd();
const SLICE_BYTES = 256 * 1024;

function loadChapterIndexer() {
  const context = {
    Array,
    ArrayBuffer,
    Blob,
    Date,
    Map,
    Math,
    Number,
    Object,
    Promise,
    RegExp,
    Set,
    String,
    TextDecoder,
    TextEncoder,
    Uint8Array,
    console: { log() {}, warn() {}, error() {} },
  };
  context.globalThis = context;
  context.self = context;
  vm.createContext(context);

  for (const relativePath of [
    'public/translator-runtime/js/chapter/chapter-rules.js',
    'public/translator-runtime/js/chapter/chapter-indexer.js',
  ]) {
    vm.runInContext(
      fs.readFileSync(path.join(repoRoot, relativePath), 'utf8'),
      context,
      { filename: relativePath },
    );
  }

  return {
    rules: context.TranslatorChapterRules,
    indexer: context.TranslatorChapterIndexer,
  };
}

class TrackingBlob extends Blob {
  constructor(parts) {
    super(parts, { type: 'text/plain;charset=utf-8' });
    this.fullTextCalls = 0;
    this.sliceCalls = [];
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

function makeCrossSliceFixture() {
  const encoder = new TextEncoder();
  const prefix = encoder.encode(`\uFEFF${'x'.repeat(SLICE_BYTES - 5)}`);
  const tail = encoder.encode('😀\r\nChương 1: Mép lát\r\nNội dung đầu.\r\nChương 2\r\nKết thúc 🚀');
  const bytes = new Uint8Array(prefix.length + tail.length);
  bytes.set(prefix, 0);
  bytes.set(tail, prefix.length);
  return bytes;
}

describe('Translator chapter heading rules', () => {
  it('classifies the supported Vietnamese, English, Roman, ordinal-word and Chinese forms', () => {
    const { rules } = loadChapterIndexer();

    const cases = [
      ['Chương 12: Gặp lại', 'chapter', 12, 'leaf'],
      ['Chapter IV - The Gate', 'chapter', 4, 'leaf'],
      ['Hồi 19', 'hoi', 19, 'leaf'],
      ['Tiết 3: Gió', 'tiet', 3, 'leaf'],
      ['Phần II: Trở về', 'phan', 2, 'container'],
      ['Quyển 5', 'quyen', 5, 'container'],
      ['Quyển thứ hai làm thanh xuân như hạ hoa sáng chói', 'quyen', 2, 'container'],
      ['quyển thứ nhất cao trung năm tháng', 'quyen', 1, 'container'],
      ['Tập 6: Biển', 'tap', 6, 'container'],
      ['Thứ 93 chương', 'chapter', 93, 'leaf'],
      ['Thứ 94 chương tên chương không có dấu phân cách', 'chapter', 94, 'leaf'],
      ['Chương thứ 96', 'chapter', 96, 'leaf'],
      ['Đệ nhất chương', 'chapter', 1, 'leaf'],
      ['第十二章', 'chapter', 12, 'leaf'],
      ['第3回', 'hoi', 3, 'leaf'],
      ['Ngoại truyện: Ngày mưa', 'special', null, 'leaf'],
      ['Prologue', 'special', null, 'leaf'],
      ['Hậu ký', 'special', null, 'leaf'],
    ];
    for (const [line, family, ordinal, level] of cases) {
      expect(rules.parseChapterHeading(line)).toMatchObject({ title: line, family, ordinal, level });
    }
    for (const line of [
      'Chương trình dịch đang chạy',
      'Phần mềm này rất nhẹ',
      'Tập thể nhân vật bước ra',
      'phần không thỏa đáng lắm.',
      'phần trăm, xem như đó là khoản thu nhập thêm.',
      'tập năm vị chính Phó bí thư huyện thảo luận việc này.',
      'Phần thứ hai trong phương án của Ủy ban Giáo dục, chính là phổ cập cơ chế giáo dục bắt buộc.',
      'Phần thứ nhất, là giới thiệu tình huống cơ bản tại thành phố.',
      'Chapterhouse is a normal word',
      '2026',
    ]) {
      expect(rules.parseChapterHeading(line)).toBeNull();
    }
  });

  it('keeps titled reversed-order chapters under their volume without accepting prose lookalikes', async () => {
    const { indexer } = loadChapterIndexer();
    const blob = new Blob([
      'Giới thiệu.\n',
      'Quyển thứ nhất cao trung năm tháng\n',
      'Thứ 1 chương chữ thập giao lộ\nNội dung một.\n',
      'Thứ 2 chương gấp gáp tình thế\nNội dung hai.\n',
      'Hồi 602 đi ngủ, nửa đêm nhân vật mới trở về. Đây là một câu văn xuôi rất dài, không phải tiêu đề và không được chia thành chương riêng dù bắt đầu giống mốc chương.\n',
      'Chương vi lãnh đạm nói: "Ta không có hứng thú."\n',
      'Thứ 3 chương mẹ cùng lão đầu\nNội dung ba.',
    ]);

    const { chapters } = await indexer.scanChapterBlob(blob);
    const leaves = chapters.filter(chapter => chapter.family === 'chapter');

    expect(leaves.map(chapter => chapter.ordinal)).toEqual([1, 2, 3]);
    expect(leaves.every(chapter => chapter.parentIndex === 1)).toBe(true);
    expect(chapters.some(chapter => chapter.title.startsWith('Hồi 602 đi ngủ'))).toBe(false);
    expect(chapters.some(chapter => chapter.title.startsWith('Chương vi lãnh đạm'))).toBe(false);
  });

  it('keeps same-family duplicate ordinals because imperfect source numbering is still a real boundary', async () => {
    const { indexer } = loadChapterIndexer();
    const substantiveContent = `${'Nội dung thật của chương bị trùng số. '.repeat(20)}\n`;
    const blob = new Blob([
      `Chương 2: Hai\n${substantiveContent}`,
      `Chương 3: Ba phần một\n${substantiveContent}`,
      `Chương 3: Ba phần hai\n${substantiveContent}`,
      'Chương 4: Bốn\nNội dung.',
    ]);

    const { chapters } = await indexer.scanChapterBlob(blob);

    expect(chapters.map(chapter => chapter.ordinal)).toEqual([2, 3, 3, 4]);
  });
});

describe('Translator streaming chapter indexer', () => {
  it('reads fixed byte slices once, survives a long line and UTF-8 split, and never calls blob.text()', async () => {
    const { indexer } = loadChapterIndexer();
    const blob = new TrackingBlob([makeCrossSliceFixture()]);

    const result = await indexer.scanChapterBlob(blob);

    expect(result.chapters.filter(chapter => chapter.family === 'chapter').map(chapter => chapter.ordinal)).toEqual([1, 2]);
    expect(blob.fullTextCalls).toBe(0);
    expect(blob.sliceCalls.length).toBeGreaterThanOrEqual(2);
    expect(blob.sliceCalls.every(call => call.end - call.start <= SLICE_BYTES)).toBe(true);
    expect(blob.sliceCalls.reduce((sum, call) => sum + call.end - call.start, 0)).toBeLessThanOrEqual(blob.size + 1024);
    expect(result.bytesRead).toBe(blob.size);
    const leaves = result.chapters.filter(chapter => chapter.family === 'chapter');
    expect(result.chapters[0]).toMatchObject({ title: 'Mở đầu', level: 'leaf' });
    await expect(blob.slice(leaves[0].contentByteStart, leaves[0].byteEnd).text()).resolves.toBe('Nội dung đầu.\r\n');
    await expect(blob.slice(leaves[1].contentByteStart, leaves[1].byteEnd).text()).resolves.toBe('Kết thúc 🚀');
    await expect(blob.slice(leaves[0].headingByteStart, leaves[0].contentByteStart).text()).resolves.toBe('Chương 1: Mép lát\r\n');
  });

  it('keeps a two-level hierarchy and demotes a trailing container with no child to a leaf', async () => {
    const { indexer } = loadChapterIndexer();
    const blob = new Blob([
      'Quyển I: Thành nội\n',
      'Lời dẫn quyển.\n',
      'Chương 1\nMột.\n',
      'Hồi 2\nHai.\n',
      'Phần II: Biển xa\n',
      'Tiết 3\nBa.\n',
      'Tập 9: Chuyện riêng\nNội dung độc lập.',
    ]);

    const { chapters } = await indexer.scanChapterBlob(blob);

    expect(chapters.map(chapter => ({ title: chapter.title, level: chapter.level, parentIndex: chapter.parentIndex }))).toEqual([
      { title: 'Quyển I: Thành nội', level: 'container', parentIndex: null },
      { title: 'Chương 1', level: 'leaf', parentIndex: 0 },
      { title: 'Hồi 2', level: 'leaf', parentIndex: 0 },
      { title: 'Phần II: Biển xa', level: 'container', parentIndex: null },
      { title: 'Tiết 3', level: 'leaf', parentIndex: 3 },
      { title: 'Tập 9: Chuyện riêng', level: 'leaf', parentIndex: null },
    ]);
  });

  it('accepts bare-number headings only when at least three form a plausible sequence', async () => {
    const { indexer } = loadChapterIndexer();
    const sequence = await indexer.scanChapterBlob(new Blob(['1\nA\n2\nB\n3\nC']));
    const isolated = await indexer.scanChapterBlob(new Blob(['Năm 2026\n2026\nMột đoạn văn bình thường.']));

    expect(sequence.chapters.map(chapter => chapter.ordinal)).toEqual([1, 2, 3]);
    expect(sequence.chapters.every(chapter => chapter.confidence === 'sequence')).toBe(true);
    expect(isolated.chapters).toHaveLength(1);
    expect(isolated.chapters[0].title).toBe('Nội dung');
  });

  it('drops a repeated table-of-contents cluster and keeps the later real headings', async () => {
    const { indexer } = loadChapterIndexer();
    const text = [
      'MỤC LỤC',
      'Chương 1: Mở cửa',
      'Chương 2: Vào thành',
      '---',
      'Lời giới thiệu.',
      'Chương 1: Mở cửa',
      'Nội dung thật của chương một.',
      'Chương 2: Vào thành',
      'Nội dung thật của chương hai.',
    ].join('\n');

    const { chapters } = await indexer.scanChapterBlob(new Blob([text]));
    const leaves = chapters.filter(chapter => chapter.family === 'chapter');

    expect(leaves).toHaveLength(2);
    expect(leaves[0].headingByteStart).toBe(new TextEncoder().encode(text.slice(0, text.lastIndexOf('Chương 1: Mở cửa'))).length);
    expect(leaves[1].headingByteStart).toBe(new TextEncoder().encode(text.slice(0, text.lastIndexOf('Chương 2: Vào thành'))).length);
  });

  it('treats form-feed as layout whitespace and folds embedded PDF table-of-contents entries into front matter', async () => {
    const { indexer } = loadChapterIndexer();
    const text = [
      '\f          Mục lục',
      'Quyển 1',
      'Quyển 2',
      '\f          Quyển 1',
      'Chương   1: Thời Gian Đảo Ngược',
      'Chương   2: Đứa Con Phản Nghịch',
      'Tên sách và tác giả.',
      '\f          Chương 1: Thời Gian Đảo Ngược',
      'Nội dung thật chương một.',
      '          Chương 2: Đứa Con Phản Nghịch',
      'Nội dung thật chương hai.',
      '\f          Quyển 2',
      'Chương   3: Mừng Thọ',
      '\f          Chương 3: Mừng Thọ',
      'Nội dung thật chương ba.',
    ].join('\n');

    const { chapters } = await indexer.scanChapterBlob(new Blob([text]));

    expect(chapters.map(chapter => chapter.title)).toEqual([
      'Mở đầu',
      'Quyển 1',
      'Chương 1: Thời Gian Đảo Ngược',
      'Chương 2: Đứa Con Phản Nghịch',
      'Quyển 2',
      'Chương 3: Mừng Thọ',
    ]);
    expect(chapters.filter(chapter => chapter.level === 'leaf' && chapter.title !== 'Mở đầu')
      .every(chapter => chapter.byteEnd > chapter.contentByteStart)).toBe(true);
  });

  it('drops a dense numbered table-of-contents run when displayed titles differ from real headings', async () => {
    const { indexer } = loadChapterIndexer();
    const text = [
      '\f Mục lục',
      '\f Quyển 1',
      'Chương 1: Tên Cũ Một',
      'Chương 2: Tên Cũ Hai',
      'Chương 3: Tên Cũ Ba',
      'Tên sách và tác giả.',
      '\f Chương 1: Tên Chính Thức Một',
      'Nội dung thật chương một đủ dài để không giống một dòng mục lục.',
      'Chương 2: Tên Chính Thức Hai',
      'Nội dung thật chương hai đủ dài để không giống một dòng mục lục.',
      'Chương 3: Tên Chính Thức Ba',
      'Nội dung thật chương ba.',
    ].join('\n');

    const { chapters } = await indexer.scanChapterBlob(new Blob([text]));

    expect(chapters.filter(chapter => chapter.family === 'chapter').map(chapter => chapter.title)).toEqual([
      'Chương 1: Tên Chính Thức Một',
      'Chương 2: Tên Chính Thức Hai',
      'Chương 3: Tên Chính Thức Ba',
    ]);
  });

  it('folds a nearby ebook chapter cover into the real heading despite punctuation and case drift', async () => {
    const { indexer } = loadChapterIndexer();
    const text = [
      'Chương 948: Khó Phân Định Được Bộ Máy Cửu An Sau Này (Thượng)',
      'Tên sách',
      'Tác giả: Tác giả mẫu',
      'Nguồn: nguồn mẫu',
      'Chương 948: Khó phân định được bộ máy Cửu An sau này. (Thượng)',
      'Nội dung thật.',
      'Chương 949: Chương tiếp theo',
      'Nội dung tiếp theo.',
    ].join('\n');

    const { chapters } = await indexer.scanChapterBlob(new Blob([text]));

    expect(chapters.map(chapter => chapter.title)).toEqual([
      'Mở đầu',
      'Chương 948: Khó phân định được bộ máy Cửu An sau này. (Thượng)',
      'Chương 949: Chương tiếp theo',
    ]);
  });

  it('falls back to one readable chapter and caps ambiguous diagnostics', async () => {
    const { indexer } = loadChapterIndexer();
    const noisyNumbers = Array.from({ length: 500 }, (_, index) => `${10_000 + index}\nDòng ${index}`).join('\n');

    const result = await indexer.scanChapterBlob(new Blob([`Truyện không có tiêu đề.\n${noisyNumbers}`]));

    expect(result.chapters).toHaveLength(1);
    expect(result.chapters[0]).toMatchObject({
      title: 'Nội dung',
      level: 'leaf',
      headingByteStart: 0,
      contentByteStart: 0,
    });
    expect(result.chapters[0].byteEnd).toBe(new Blob([`Truyện không có tiêu đề.\n${noisyNumbers}`]).size);
    expect(result.warning).toMatch(/không.*chương/i);
    expect(result.diagnostics.length).toBeLessThanOrEqual(200);
  });

  it('recomputes contiguous byte ranges after removing or adding a manual boundary', () => {
    const { indexer } = loadChapterIndexer();
    const first = {
      title: 'Chương 1',
      ordinal: 1,
      family: 'chapter',
      level: 'leaf',
      headingByteStart: 0,
      contentByteStart: 10,
      confidence: 'accepted',
    };
    const falseBoundary = {
      title: '20',
      ordinal: 20,
      family: 'chapter',
      level: 'leaf',
      headingByteStart: 20,
      contentByteStart: 23,
      confidence: 'suggested',
    };
    const last = {
      title: 'Chương 2',
      ordinal: 2,
      family: 'chapter',
      level: 'leaf',
      headingByteStart: 40,
      contentByteStart: 50,
      confidence: 'accepted',
    };

    const removed = indexer.rebuildChapterIndex([first, last], 80).chapters;
    expect(removed.map(chapter => [chapter.headingByteStart, chapter.byteEnd])).toEqual([
      [0, 40],
      [40, 80],
    ]);

    const restored = indexer.rebuildChapterIndex([last, falseBoundary, first], 80).chapters;
    expect(restored.map(chapter => [chapter.headingByteStart, chapter.byteEnd])).toEqual([
      [0, 20],
      [20, 40],
      [40, 80],
    ]);
    expect(restored[1]).toMatchObject({ title: '20', confidence: 'suggested' });
  });
});
