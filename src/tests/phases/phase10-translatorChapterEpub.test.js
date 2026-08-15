import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import JSZip from 'jszip';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { describe, expect, it } from 'vitest';
import { parseEpub } from '../../services/corpus/parser/epubParser.js';

const repoRoot = process.cwd();
const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseTagValue: false,
});

function loadEpubRuntime() {
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
    'public/translator-runtime/js/chapter/chapter-epub.js',
  ]) {
    vm.runInContext(
      fs.readFileSync(path.join(repoRoot, relativePath), 'utf8'),
      context,
      { filename: relativePath },
    );
  }
  return {
    indexer: context.TranslatorChapterIndexer,
    epub: context.TranslatorChapterEpub,
  };
}

function firstLocalEntry(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  expect(view.getUint32(0, true)).toBe(0x04034b50);
  const compressionMethod = view.getUint16(8, true);
  const fileNameLength = view.getUint16(26, true);
  const fileName = new TextDecoder().decode(bytes.slice(30, 30 + fileNameLength));
  return { compressionMethod, fileName };
}

async function makeBook({ partial = false } = {}) {
  const { indexer, epub } = loadEpubRuntime();
  const sourceText = [
    'Lời giới thiệu cho truyện.',
    'Quyển I: Khởi đầu',
    'Dẫn nhập cho quyển một.',
    'Chương 1: Mở & đi',
    'Một hai ba bốn năm sáu bảy tám chín mười mười một mười hai mười ba mười bốn mười năm mười sáu mười bảy mười tám mười chín hai mươi hai mốt hai hai. <script>alert("x")</script> & an toàn\u0001\uFFFE 😀',
    'Chương 2: 第二章',
    'Ba bốn năm sáu bảy tám chín mười mười một mười hai mười ba mười bốn mười năm mười sáu mười bảy mười tám mười chín hai mươi hai mốt hai hai hai ba hai bốn hai năm. 中文 🚀',
  ].join('\n');
  const blob = new Blob([sourceText], { type: 'text/plain;charset=utf-8' });
  const { chapters } = await indexer.scanChapterBlob(blob);
  const snapshot = Object.freeze({
    blob,
    fileName: 'truyen-thu.txt',
    kind: 'translated',
    partial,
    partialReason: partial ? 'running' : null,
    completedChunks: partial ? 2 : 4,
    totalChunks: 4,
    revision: 4,
  });
  return epub.buildChapterEpub({
    snapshot,
    chapters,
    title: 'Truyện <thử> & hay',
    author: 'Tác giả & bạn',
    modified: '2026-08-15T04:05:06Z',
  }, { JSZip });
}

describe('Translator EPUB 3 exporter', () => {
  it('returns bytes and writes the uncompressed mimetype entry first', async () => {
    const result = await makeBook();

    expect(result.bytes).toBeInstanceOf(Uint8Array);
    expect(result.fileName).toBe('Truyện thử & hay.epub');
    expect(firstLocalEntry(result.bytes)).toEqual({
      compressionMethod: 0,
      fileName: 'mimetype',
    });
    const zip = await JSZip.loadAsync(result.bytes);
    await expect(zip.file('mimetype').async('string')).resolves.toBe('application/epub+zip');
  });

  it('emits valid EPUB 3 XML with nav, NCX fallback, manifest/spine and matching two-level targets', async () => {
    const { bytes } = await makeBook();
    const zip = await JSZip.loadAsync(bytes);
    const requiredFiles = [
      'META-INF/container.xml',
      'OEBPS/content.opf',
      'OEBPS/nav.xhtml',
      'OEBPS/toc.ncx',
      'OEBPS/Styles/book.css',
      'OEBPS/Text/front-matter.xhtml',
      'OEBPS/Text/chapter-000001.xhtml',
      'OEBPS/Text/chapter-000002.xhtml',
    ];
    for (const fileName of requiredFiles) expect(zip.file(fileName)).toBeTruthy();

    const xmlFiles = await Promise.all(requiredFiles
      .filter(fileName => /\.(xml|opf|ncx|xhtml)$/i.test(fileName))
      .map(async fileName => [fileName, await zip.file(fileName).async('string')]));
    for (const [fileName, xml] of xmlFiles) {
      expect(XMLValidator.validate(xml), fileName).toBe(true);
    }

    const opf = await zip.file('OEBPS/content.opf').async('string');
    const nav = await zip.file('OEBPS/nav.xhtml').async('string');
    const ncx = await zip.file('OEBPS/toc.ncx').async('string');
    const pkg = xmlParser.parse(opf).package;
    expect(pkg['@_version']).toBe('3.0');
    expect(opf).toContain('properties="nav"');
    expect(opf).toContain('<spine toc="ncx"');
    expect(opf).toContain('dcterms:modified');
    expect(nav).toMatch(/Quyển I: Khởi đầu[\s\S]*?<ol>[\s\S]*?Chương 1[\s\S]*?Chương 2/);
    expect(ncx).toMatch(/Quyển I: Khởi đầu[\s\S]*?<navPoint[\s\S]*?Chương 1[\s\S]*?Chương 2/);
    const navTargets = [...new Set(nav.match(/Text\/chapter-\d{6}\.xhtml/g) || [])];
    const ncxTargets = [...new Set(ncx.match(/Text\/chapter-\d{6}\.xhtml/g) || [])];
    expect(navTargets).toEqual(ncxTargets);
    expect(navTargets).toEqual(['Text/chapter-000001.xhtml', 'Text/chapter-000002.xhtml']);
  });

  it('escapes untrusted text, strips XML control characters and round-trips through the existing EPUB parser', async () => {
    const { bytes } = await makeBook();
    const zip = await JSZip.loadAsync(bytes);
    const chapter = await zip.file('OEBPS/Text/chapter-000001.xhtml').async('string');

    expect(chapter).toContain('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; an toàn');
    expect(chapter).not.toContain('<script>');
    expect(chapter).not.toContain('\u0001');
    expect(chapter).not.toContain('\uFFFE');
    expect(chapter).toContain('😀');

    const parsed = await parseEpub(bytes, { fileName: 'fallback.epub' });
    expect(parsed.metadata).toMatchObject({
      title: 'Truyện <thử> & hay',
      author: 'Tác giả & bạn',
      language: 'vi',
    });
    expect(parsed.chapters.map(item => item.title)).toEqual([
      'Chương 1: Mở & đi',
      'Chương 2: 第二章',
    ]);
    expect(parsed.rawText).toContain('<script>alert("x")</script> & an toàn');
    expect(parsed.rawText).toContain('中文 🚀');
  });

  it('labels partial exports in metadata, filename, information page and final chapter', async () => {
    const result = await makeBook({ partial: true });
    const zip = await JSZip.loadAsync(result.bytes);
    const opf = await zip.file('OEBPS/content.opf').async('string');
    const frontMatter = await zip.file('OEBPS/Text/front-matter.xhtml').async('string');
    const lastChapter = await zip.file('OEBPS/Text/chapter-000002.xhtml').async('string');

    expect(result.fileName).toMatch(/Bản tạm\.epub$/);
    expect(opf).toContain('Bản tạm');
    expect(frontMatter).toMatch(/Bản tạm/i);
    expect(frontMatter).toMatch(/2\s*\/\s*4\s*chunk/i);
    expect(lastChapter).toMatch(/chưa hoàn tất/i);
  });

  it('exports a one-section fallback and a 1,001-chapter manifest without missing entries', async () => {
    const { indexer, epub } = loadEpubRuntime();
    const fallbackBlob = new Blob(['Văn bản không có tiêu đề chương.']);
    const fallback = await epub.buildChapterEpub({
      snapshot: {
        blob: fallbackBlob,
        fileName: 'fallback.txt',
        kind: 'source',
        partial: false,
        completedChunks: 0,
        totalChunks: 0,
      },
      chapters: [],
      title: 'Fallback',
      modified: '2026-08-15T04:05:06Z',
    }, { JSZip });
    const fallbackZip = await JSZip.loadAsync(fallback.bytes);
    expect(fallbackZip.file('OEBPS/Text/chapter-000001.xhtml')).toBeTruthy();

    const chapterCount = 1_001;
    const blob = new Blob(Array.from(
      { length: chapterCount },
      (_, index) => `Chương ${index + 1}\nNội dung ${index + 1}.\n`,
    ));
    const { chapters } = await indexer.scanChapterBlob(blob);
    expect(chapters).toHaveLength(chapterCount);
    const large = await epub.buildChapterEpub({
      snapshot: {
        blob,
        fileName: 'large.txt',
        kind: 'source',
        partial: false,
        completedChunks: 0,
        totalChunks: 0,
      },
      chapters,
      title: 'Một nghìn lẻ một chương',
      modified: '2026-08-15T04:05:06Z',
    }, { JSZip });
    const largeZip = await JSZip.loadAsync(large.bytes);
    expect(largeZip.file('OEBPS/Text/chapter-000001.xhtml')).toBeTruthy();
    expect(largeZip.file('OEBPS/Text/chapter-001001.xhtml')).toBeTruthy();
    const opf = await largeZip.file('OEBPS/content.opf').async('string');
    expect(opf.match(/<itemref idref="chapter-/g)).toHaveLength(chapterCount);
  });
});
