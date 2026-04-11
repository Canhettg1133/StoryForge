import { Document, HeadingLevel, Packer, Paragraph, TextRun } from 'docx';
import { saveAs } from 'file-saver';
import JSZip from 'jszip';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

function sanitizeFileName(value = 'storyforge-corpus') {
  return String(value || 'storyforge-corpus')
    .normalize('NFKD')
    .replace(/[^\w\s.-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase() || 'storyforge-corpus';
}

function escapeXml(value = '') {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function normalizeParagraphs(text = '') {
  return String(text || '')
    .replace(/\r\n?/g, '\n')
    .split(/\n{2,}/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function stripLeadingChapterPrefix(title = '') {
  let normalized = String(title || '').trim();

  for (let guard = 0; guard < 3; guard += 1) {
    const next = normalized
      .replace(/^(chương|chuong|chapter|chap|phần|phan|part|quyển|quyen|hồi|hoi|tập|tap|ch\.?)\s*/iu, '')
      .replace(/^(\d+|[ivxlcdm]+)\s*[:.)\-]?\s*/iu, '')
      .trim();

    if (next === normalized) {
      break;
    }

    normalized = next;
  }

  return normalized.trim();
}

function getDisplayChapterTitle(chapter, index) {
  const fallback = `Chương ${index + 1}`;
  const title = String(chapter?.title || '').trim();

  if (!title) {
    return fallback;
  }

  if (/^(chương|chuong|chapter|phần|phan|part|quyển|quyen|hồi|hoi|tập|tap)\b/iu.test(title)) {
    return title;
  }

  const stripped = stripLeadingChapterPrefix(title);
  return stripped ? `${fallback}: ${stripped}` : fallback;
}

function buildCorpusSections(corpus, chapters = []) {
  const frontMatter = String(corpus?.frontMatter?.content || '').trim();
  const normalizedChapters = (chapters || [])
    .map((chapter, index) => ({
      ...chapter,
      title: getDisplayChapterTitle(chapter, index),
      content: String(chapter?.content || '').trim(),
    }))
    .filter((chapter) => chapter.content);

  return {
    title: String(corpus?.title || 'Untitled').trim() || 'Untitled',
    author: String(corpus?.author || '').trim(),
    language: String(corpus?.language || 'vi').trim() || 'vi',
    frontMatter,
    chapters: normalizedChapters,
  };
}

function buildTxtContent(sections) {
  const lines = [sections.title];

  if (sections.author) {
    lines.push(`Tác giả: ${sections.author}`);
  }

  lines.push('');

  if (sections.frontMatter) {
    lines.push(sections.frontMatter, '');
  }

  sections.chapters.forEach((chapter) => {
    lines.push(chapter.title);
    lines.push('');
    lines.push(chapter.content);
    lines.push('', '');
  });

  return `${lines.join('\n').trim()}\n`;
}

function buildXhtmlDocument(title, paragraphs = [], language = 'vi') {
  const body = paragraphs.length
    ? paragraphs.map((paragraph) => `<p>${escapeXml(paragraph)}</p>`).join('\n')
    : '<p></p>';

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" lang="${escapeXml(language)}" xml:lang="${escapeXml(language)}">
  <head>
    <meta charset="utf-8" />
    <title>${escapeXml(title)}</title>
    <link rel="stylesheet" type="text/css" href="../Styles/book.css" />
  </head>
  <body>
    <div class="chapter">
      <h1>${escapeXml(title)}</h1>
      ${body}
    </div>
  </body>
</html>`;
}

function buildTocItems(sections) {
  const items = [];
  let playOrder = 1;

  if (sections.frontMatter) {
    items.push({
      id: 'front-matter',
      href: 'Text/front-matter.xhtml',
      label: 'Lời dẫn / Front Matter',
      playOrder: playOrder++,
    });
  }

  sections.chapters.forEach((chapter, index) => {
    items.push({
      id: `chapter-${index + 1}`,
      href: `Text/chapter-${String(index + 1).padStart(3, '0')}.xhtml`,
      label: chapter.title,
      playOrder: playOrder++,
    });
  });

  return items;
}

export async function exportCorpusToTxt(corpus, chapters = []) {
  const sections = buildCorpusSections(corpus, chapters);
  const blob = new Blob([buildTxtContent(sections)], {
    type: 'text/plain;charset=utf-8',
  });
  saveAs(blob, `${sanitizeFileName(sections.title)}.txt`);
}

export async function exportCorpusToDocx(corpus, chapters = []) {
  const sections = buildCorpusSections(corpus, chapters);
  const children = [
    new Paragraph({
      text: sections.title,
      heading: HeadingLevel.TITLE,
      spacing: { after: 280 },
    }),
  ];

  if (sections.author) {
    children.push(
      new Paragraph({
        text: `Tác giả: ${sections.author}`,
        spacing: { after: 240 },
      }),
    );
  }

  if (sections.frontMatter) {
    children.push(
      new Paragraph({
        text: 'Lời dẫn',
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 200, after: 120 },
      }),
    );

    normalizeParagraphs(sections.frontMatter).forEach((paragraph) => {
      children.push(
        new Paragraph({
          children: [new TextRun(paragraph)],
          spacing: { after: 160 },
        }),
      );
    });
  }

  sections.chapters.forEach((chapter) => {
    children.push(
      new Paragraph({
        text: chapter.title,
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 260, after: 120 },
      }),
    );

    normalizeParagraphs(chapter.content).forEach((paragraph) => {
      children.push(
        new Paragraph({
          children: [new TextRun(paragraph)],
          spacing: { after: 160 },
        }),
      );
    });
  });

  const doc = new Document({
    sections: [{
      properties: {},
      children,
    }],
  });

  const blob = await Packer.toBlob(doc);
  saveAs(blob, `${sanitizeFileName(sections.title)}.docx`);
}

export async function exportCorpusToEpub(corpus, chapters = []) {
  const sections = buildCorpusSections(corpus, chapters);
  const zip = new JSZip();
  const identifier = `${sanitizeFileName(sections.title)}-${Date.now()}`;
  const createdAt = new Date().toISOString();
  const tocItems = buildTocItems(sections);

  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  zip.folder('META-INF')?.file('container.xml', `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`);

  const oebps = zip.folder('OEBPS');
  const textFolder = oebps?.folder('Text');
  const stylesFolder = oebps?.folder('Styles');

  stylesFolder?.file('book.css', `body { font-family: serif; line-height: 1.6; margin: 0 auto; max-width: 42em; }
h1 { margin-bottom: 1.2em; }
p { margin: 0 0 1em; text-align: justify; }`);

  const manifestItems = [
    `<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>`,
    `<item id="toc" href="toc.xhtml" media-type="application/xhtml+xml"/>`,
    `<item id="css" href="Styles/book.css" media-type="text/css"/>`,
  ];
  const spineItems = [];

  if (sections.frontMatter) {
    textFolder?.file(
      'front-matter.xhtml',
      buildXhtmlDocument('Lời dẫn / Front Matter', normalizeParagraphs(sections.frontMatter), sections.language),
    );
    manifestItems.push('<item id="front-matter" href="Text/front-matter.xhtml" media-type="application/xhtml+xml"/>');
    spineItems.push('<itemref idref="front-matter"/>');
  }

  sections.chapters.forEach((chapter, index) => {
    const href = `chapter-${String(index + 1).padStart(3, '0')}.xhtml`;
    const itemId = `chapter-${index + 1}`;

    textFolder?.file(href, buildXhtmlDocument(chapter.title, normalizeParagraphs(chapter.content), sections.language));
    manifestItems.push(`<item id="${itemId}" href="Text/${href}" media-type="application/xhtml+xml"/>`);
    spineItems.push(`<itemref idref="${itemId}"/>`);
  });

  oebps?.file('toc.xhtml', `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" lang="${escapeXml(sections.language)}" xml:lang="${escapeXml(sections.language)}">
  <head>
    <meta charset="utf-8" />
    <title>Mục lục</title>
    <link rel="stylesheet" type="text/css" href="Styles/book.css" />
  </head>
  <body>
    <h1>Mục lục</h1>
    <ol>
      ${tocItems.map((item) => `<li><a href="${item.href}">${escapeXml(item.label)}</a></li>`).join('\n      ')}
    </ol>
  </body>
</html>`);

  oebps?.file('toc.ncx', `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head>
    <meta name="dtb:uid" content="${escapeXml(identifier)}"/>
    <meta name="dtb:depth" content="1"/>
    <meta name="dtb:totalPageCount" content="0"/>
    <meta name="dtb:maxPageNumber" content="0"/>
  </head>
  <docTitle><text>${escapeXml(sections.title)}</text></docTitle>
  ${sections.author ? `<docAuthor><text>${escapeXml(sections.author)}</text></docAuthor>` : ''}
  <navMap>
    ${tocItems.map((item) => `<navPoint id="${item.id}" playOrder="${item.playOrder}">
      <navLabel><text>${escapeXml(item.label)}</text></navLabel>
      <content src="${item.href}"/>
    </navPoint>`).join('\n    ')}
  </navMap>
</ncx>`);

  oebps?.file('content.opf', `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="bookid" version="2.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">${escapeXml(identifier)}</dc:identifier>
    <dc:title>${escapeXml(sections.title)}</dc:title>
    <dc:language>${escapeXml(sections.language)}</dc:language>
    ${sections.author ? `<dc:creator>${escapeXml(sections.author)}</dc:creator>` : ''}
    <dc:date>${escapeXml(createdAt)}</dc:date>
  </metadata>
  <manifest>
    ${manifestItems.join('\n    ')}
  </manifest>
  <spine toc="ncx">
    ${spineItems.join('\n    ')}
  </spine>
  <guide>
    <reference type="toc" title="Mục lục" href="toc.xhtml"/>
  </guide>
</package>`);

  const blob = await zip.generateAsync({
    type: 'blob',
    mimeType: 'application/epub+zip',
    compression: 'DEFLATE',
    compressionOptions: { level: 9 },
  });

  saveAs(blob, `${sanitizeFileName(sections.title)}.epub`);
}

function wrapText(text, font, fontSize, maxWidth) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  if (!words.length) return [''];

  const lines = [];
  let currentLine = words[0];

  for (let index = 1; index < words.length; index += 1) {
    const nextLine = `${currentLine} ${words[index]}`;
    if (font.widthOfTextAtSize(nextLine, fontSize) <= maxWidth) {
      currentLine = nextLine;
      continue;
    }

    lines.push(currentLine);
    currentLine = words[index];
  }

  lines.push(currentLine);
  return lines;
}

export async function exportCorpusToPdf(corpus, chapters = []) {
  const sections = buildCorpusSections(corpus, chapters);
  const pdfDoc = await PDFDocument.create();
  const regularFont = await pdfDoc.embedFont(StandardFonts.TimesRoman);
  const boldFont = await pdfDoc.embedFont(StandardFonts.TimesRomanBold);
  const pageSize = [595.28, 841.89];
  const margin = 50;
  const titleSize = 20;
  const headingSize = 15;
  const bodySize = 12;
  const lineHeight = 17;
  const paragraphGap = 8;
  let page = pdfDoc.addPage(pageSize);
  let { width, height } = page.getSize();
  let cursorY = height - margin;

  const ensureSpace = (required = lineHeight) => {
    if (cursorY - required >= margin) {
      return;
    }

    page = pdfDoc.addPage(pageSize);
    ({ width, height } = page.getSize());
    cursorY = height - margin;
  };

  const drawWrappedParagraph = (text, font, size, color = rgb(0.12, 0.12, 0.12)) => {
    const paragraphs = normalizeParagraphs(text);

    if (!paragraphs.length) {
      cursorY -= paragraphGap;
      return;
    }

    paragraphs.forEach((paragraph) => {
      const lines = wrapText(paragraph, font, size, width - margin * 2);
      lines.forEach((line) => {
        ensureSpace(size + 4);
        page.drawText(line, {
          x: margin,
          y: cursorY,
          size,
          font,
          color,
        });
        cursorY -= lineHeight;
      });
      cursorY -= paragraphGap;
    });
  };

  ensureSpace(titleSize + 10);
  page.drawText(sections.title, {
    x: margin,
    y: cursorY,
    size: titleSize,
    font: boldFont,
    color: rgb(0.08, 0.08, 0.08),
  });
  cursorY -= 30;

  if (sections.author) {
    drawWrappedParagraph(`Tác giả: ${sections.author}`, regularFont, bodySize, rgb(0.28, 0.28, 0.28));
    cursorY -= 6;
  }

  if (sections.frontMatter) {
    ensureSpace(headingSize + 10);
    page.drawText('Lời dẫn', {
      x: margin,
      y: cursorY,
      size: headingSize,
      font: boldFont,
    });
    cursorY -= 24;
    drawWrappedParagraph(sections.frontMatter, regularFont, bodySize);
    cursorY -= 8;
  }

  sections.chapters.forEach((chapter) => {
    ensureSpace(headingSize + 12);
    page.drawText(chapter.title, {
      x: margin,
      y: cursorY,
      size: headingSize,
      font: boldFont,
    });
    cursorY -= 24;
    drawWrappedParagraph(chapter.content, regularFont, bodySize);
    cursorY -= 6;
  });

  const bytes = await pdfDoc.save();
  const blob = new Blob([bytes], { type: 'application/pdf' });
  saveAs(blob, `${sanitizeFileName(sections.title)}.pdf`);
}
