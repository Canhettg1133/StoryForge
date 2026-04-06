import { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import { createChunks } from '../../services/corpus/chunker.js';
import {
  analyzeChapterSegmentation,
  splitTextIntoChapters,
} from '../../services/corpus/detector/chapterDetector.js';
import {
  detectFandom,
  getFandomSuggestion,
} from '../../services/corpus/detector/fandomDetector.js';
import {
  detectFileType,
  parseCorpusFile,
  SUPPORTED_TYPES,
} from '../../services/corpus/parser/index.js';

describe('Phase 2 - Corpus Upload & Parse', () => {
  it('detects supported file types from extension and mime type', () => {
    expect(SUPPORTED_TYPES).toEqual(expect.arrayContaining(['txt', 'epub', 'pdf', 'docx']));

    expect(detectFileType({ fileName: 'story.txt' })).toBe('txt');
    expect(detectFileType({ fileName: 'book.epub' })).toBe('epub');
    expect(detectFileType({ fileName: 'scan.pdf' })).toBe('pdf');
    expect(detectFileType({ fileName: 'doc.docx' })).toBe('docx');
    expect(
      detectFileType({ fileName: 'unknown.bin', mimeType: 'text/plain' }),
    ).toBe('txt');
  });

  it('parses txt corpus into chapters and metadata', async () => {
    const text = [
      'Chapter 1: The Beginning',
      'Harry Potter walked into Hogwarts.',
      '',
      'Chapter 2: The Duel',
      'Draco challenged Harry in the hallway.',
    ].join('\n');

    const parsed = await parseCorpusFile({
      buffer: Buffer.from(text, 'utf8'),
      fileName: 'demo-story.txt',
      mimeType: 'text/plain',
      options: { language: 'en' },
    });

    expect(parsed.fileType).toBe('txt');
    expect(parsed.metadata.title).toContain('demo story');
    expect(parsed.chapters.length).toBeGreaterThanOrEqual(2);
    expect(parsed.rawText.length).toBeGreaterThan(10);
  });

  it('does not split duplicated chapter headings separated by decorative lines', () => {
    const text = [
      '========================================',
      'Số 18 Nhà Trọ',
      '========================================',
      '',
      '────────────────────',
      'Chương 01: Hoan nghênh nhập chức',
      '────────────────────',
      '',
      'Chương 01: Hoan nghênh nhập chức',
      '',
      '【 hoan nghênh nhập chức số 18 lầu trọ Phòng Quản Lý trợ lý. 】',
      'Đông',
      'Đông',
      'Đông',
      '',
      'Lâm Thâm ánh mắt đờ đẫn mà nhìn chằm chằm vào trước mặt sàn nhà.',
      '',
      '────────────────────',
      'Chương 02: Công tác nhật ký',
      '────────────────────',
      '',
      'Chương 02: Công tác nhật ký',
      '',
      '【10, trợ lý đối Phòng Quản Lý công việc có giữ bí mật nghĩa vụ. 】',
      'Chỉ tiêu lại là cái gì chỉ tiêu?',
      '【 cuối cùng, hoan nghênh nhập chức, Lâm Thâm tiên sinh. 】',
    ].join('\n');

    const parsed = splitTextIntoChapters(text, {
      fallbackTitlePrefix: 'Chapter',
    });

    expect(parsed).toHaveLength(2);
    expect(parsed[0].title).toContain('Chương 01');
    expect(parsed[1].title).toContain('Chương 02');
    expect(parsed[0].content).toContain('Lâm Thâm ánh mắt đờ đẫn');
    expect(parsed[1].content).toContain('Chỉ tiêu lại là cái gì chỉ tiêu');
  });

  it('keeps front matter out of fake chapter 1 while preserving the real first chapter', () => {
    const text = [
      'Truyện bạn đang theo dõi được thực hiện & thuộc bản quyền của Sắc Hiệp Viện.',
      '',
      '\tTheo nữ tiểu quỷ mông bự Loli muội muội bị xanh biếc bắt đầu dị thế giới toàn bộ thành viên hậu cung nón xanh tác giả: MP9494 (1-52)',
      '',
      '\tNTR! Theo nữ tiểu quỷ mông bự Loli muội muội bị xanh biếc bắt đầu dị thế giới mạo hiểm chung đồ nhị!',
      '',
      '\tChương 1:',
      '',
      '\t"Ca ca, ô ~ ta mông thịt lại biến nhiều rồi, làm sao bây giờ làm sao bây giờ! Ta rốt cuộc phải làm sao a ô ô ~ "',
      '',
      '\tXanh biếc ý dồi dào rừng rậm đường nhỏ phía trên, bá có chút im lặng quay đầu nhìn về phía muội muội của mình.',
    ].join('\n');

    const parsed = splitTextIntoChapters(text, {
      fallbackTitlePrefix: 'Chapter',
    });

    expect(parsed).toHaveLength(1);
    expect(parsed[0].title).toContain('Chương 1');
    expect(parsed[0].content).toContain('"Ca ca, ô ~ ta mông thịt lại biến nhiều');
    expect(parsed[0].content).not.toContain('Sắc Hiệp Viện');
  });

  it('emits front matter and diagnostics for noisy chapter segmentation', () => {
    const text = [
      'Truyện bạn đang theo dõi được thực hiện & thuộc bản quyền của Sắc Hiệp Viện.',
      '',
      'Tên truyện rất dài tác giả: MP9494',
      '',
      'Chương 1:',
      '',
      '"Ca ca, ô ~ ta mông thịt lại biến nhiều rồi..."',
      '',
      'Nội dung thật bắt đầu từ đây.',
      '',
      'Chỉ bất quá cùng số 1 cửa khác biệt, lần này số 2 cửa cũng không có bởi vì bọn họ tới gần mà mở ra.',
      '',
      'Chương 2: Tiếp diễn',
      '',
      'Nội dung chương 2.',
    ].join('\n');

    const result = analyzeChapterSegmentation(text, {
      fallbackTitlePrefix: 'Chapter',
    });

    expect(result.frontMatter?.content).toContain('bản quyền của Sắc Hiệp Viện');
    expect(result.chapters).toHaveLength(2);
    expect(result.diagnostics.hasFrontMatter).toBe(true);
    expect(result.diagnostics.acceptedBoundaries).toHaveLength(2);
    expect(result.diagnostics.headingCandidates.some((item) => item.text.includes('Chỉ bất quá'))).toBe(false);
  });

  it('throws a clear error for unsupported file type', async () => {
    await expect(
      parseCorpusFile({
        buffer: Buffer.from('binary content', 'utf8'),
        fileName: 'archive.bin',
        mimeType: 'application/octet-stream',
      }),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_FILE_TYPE' });
  });

  it('splits chapters whose numbers are written out in words', () => {
    const text = [
      'Chương bốn mươi ba',
      '',
      'Nội dung chương 43.',
      '',
      'Sau đó...',
      '',
      'Chương bốn mươi lăm',
      '',
      'Tiếng xúc xắc rơi xuống đất, hắn lại thua một cách nhục nhã.',
      '',
      '"Bá! Ngươi!!!"',
    ].join('\n');

    const parsed = splitTextIntoChapters(text, {
      fallbackTitlePrefix: 'Chapter',
      minWordsBeforeSplit: 10,
    });

    expect(parsed).toHaveLength(2);
    expect(parsed[0].title).toContain('bốn mươi ba');
    expect(parsed[1].title).toContain('bốn mươi lăm');
    expect(parsed[1].content).toContain('Tiếng xúc xắc rơi xuống đất');
  });

  it('chunks chapter text and returns chunk metadata', () => {
    const chapter = {
      id: 'chapter-1',
      title: 'Chapter 1',
      content: 'word '.repeat(1800),
    };

    const chunks = createChunks(chapter, {
      chunkSize: 500,
      overlap: 60,
      preserveParagraphs: false,
    });

    expect(chunks.length).toBeGreaterThan(2);
    expect(chunks[0]).toEqual(
      expect.objectContaining({
        chapterId: 'chapter-1',
        chapterTitle: 'Chapter 1',
        text: expect.any(String),
        wordCount: expect.any(Number),
        startWord: expect.any(String),
        endWord: expect.any(String),
      }),
    );
    expect(chunks.every((chunk) => chunk.wordCount > 0)).toBe(true);
  });

  it('detects fandom candidates and top suggestion', () => {
    const sample = [
      'Harry Potter and Hermione arrived at Hogwarts.',
      'Voldemort used dark magic and escaped Azkaban.',
      'The Quidditch match started at sunset.',
    ].join(' ');

    const detected = detectFandom(sample);
    expect(detected.length).toBeGreaterThan(0);
    expect(detected[0].key).toBe('harry_potter');

    const suggestion = getFandomSuggestion(sample);
    expect(suggestion).toEqual(
      expect.objectContaining({
        fandom: 'harry_potter',
        label: 'Harry Potter',
      }),
    );
    expect(suggestion.confidence).toBeGreaterThan(0.2);
  });
});
