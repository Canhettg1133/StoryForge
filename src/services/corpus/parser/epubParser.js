import path from 'node:path';
import JSZip from 'jszip';
import { XMLParser } from 'fast-xml-parser';
import { splitTextIntoChapters } from '../detector/chapterDetector.js';
import { cleanTitle, countWords, decodeHtmlEntities, stripHtml } from '../utils/textUtils.js';

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseTagValue: false,
  trimValues: true,
});

function asArray(value) {
  if (value == null) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

async function readZipText(zip, filePath) {
  const normalized = filePath.replace(/^\/+/, '');
  const directFile = zip.file(normalized) || zip.file(filePath);
  if (!directFile) {
    return null;
  }
  return directFile.async('string');
}

function getContainerOpfPath(containerXml) {
  const parsed = xmlParser.parse(containerXml);
  const rootfiles = parsed?.container?.rootfiles?.rootfile;
  const rootfile = asArray(rootfiles)[0];
  return rootfile?.['@_full-path'] || null;
}

function extractPackage(packageXml) {
  const parsed = xmlParser.parse(packageXml);
  return parsed?.package || null;
}

function firstMetadataValue(metadata, keys) {
  for (const key of keys) {
    const value = metadata?.[key];
    if (value == null) {
      continue;
    }

    const first = asArray(value)[0];
    if (typeof first === 'string') {
      return decodeHtmlEntities(first);
    }

    if (typeof first === 'object' && first['#text']) {
      return decodeHtmlEntities(first['#text']);
    }
  }

  return null;
}

function extractChapterTitle(html, fallbackTitle) {
  const headingMatch = html.match(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/i);
  if (headingMatch?.[1]) {
    const title = stripHtml(headingMatch[1]);
    if (title) {
      return cleanTitle(title, fallbackTitle);
    }
  }

  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (titleMatch?.[1]) {
    const title = stripHtml(titleMatch[1]);
    if (title) {
      return cleanTitle(title, fallbackTitle);
    }
  }

  return cleanTitle(fallbackTitle, 'Chapter');
}

function resolveManifestHref(opfPath, href) {
  const opfDir = path.posix.dirname(opfPath);
  return path.posix.normalize(path.posix.join(opfDir, href));
}

export async function parseEpub(buffer, options = {}) {
  const zip = await JSZip.loadAsync(buffer);
  const containerXml = await readZipText(zip, 'META-INF/container.xml');

  if (!containerXml) {
    throw new Error('Invalid EPUB: missing META-INF/container.xml');
  }

  const opfPath = getContainerOpfPath(containerXml);
  if (!opfPath) {
    throw new Error('Invalid EPUB: missing package document path');
  }

  const packageXml = await readZipText(zip, opfPath);
  if (!packageXml) {
    throw new Error('Invalid EPUB: package document not found');
  }

  const pkg = extractPackage(packageXml);
  if (!pkg) {
    throw new Error('Invalid EPUB: failed to parse package document');
  }

  const manifestItems = asArray(pkg.manifest?.item);
  const manifestById = new Map();
  for (const item of manifestItems) {
    if (!item?.['@_id']) {
      continue;
    }
    manifestById.set(item['@_id'], item);
  }

  const chapters = [];
  const spineItems = asArray(pkg.spine?.itemref);

  for (const spineItem of spineItems) {
    const idref = spineItem?.['@_idref'];
    const manifestItem = idref ? manifestById.get(idref) : null;

    if (!manifestItem) {
      continue;
    }

    const mediaType = (manifestItem['@_media-type'] || '').toLowerCase();
    const properties = (manifestItem['@_properties'] || '').toLowerCase();
    if (properties.includes('nav')) {
      continue;
    }

    if (!mediaType.includes('html') && !mediaType.includes('xhtml')) {
      continue;
    }

    const href = manifestItem['@_href'];
    if (!href) {
      continue;
    }

    const chapterPath = resolveManifestHref(opfPath, href);
    const html = await readZipText(zip, chapterPath);
    if (!html) {
      continue;
    }

    const content = stripHtml(html);
    if (!content || countWords(content) < 20) {
      continue;
    }

    chapters.push({
      title: extractChapterTitle(html, `Chapter ${chapters.length + 1}`),
      content,
      href,
    });
  }

  if (chapters.length === 0) {
    const fallbackHtmlFiles = zip
      .file(/\.(xhtml|html)$/i)
      .filter((file) => !/nav|toc/i.test(file.name));

    for (const file of fallbackHtmlFiles) {
      const html = await file.async('string');
      const content = stripHtml(html);
      if (!content || countWords(content) < 20) {
        continue;
      }

      chapters.push({
        title: extractChapterTitle(html, `Chapter ${chapters.length + 1}`),
        content,
        href: file.name,
      });
    }
  }

  if (chapters.length <= 1 && chapters[0]?.content) {
    const split = splitTextIntoChapters(chapters[0].content, {
      fallbackTitlePrefix: 'Chapter',
      minWordsBeforeSplit: 120,
    });
    if (split.length > 1) {
      return {
        metadata: {
          title: firstMetadataValue(pkg.metadata, ['dc:title', 'title']) || options.fileName || 'Untitled',
          author: firstMetadataValue(pkg.metadata, ['dc:creator', 'creator']) || null,
          language: firstMetadataValue(pkg.metadata, ['dc:language', 'language']) || null,
        },
        chapters: split,
        rawText: split.map((item) => item.content).join('\n\n'),
      };
    }
  }

  if (chapters.length === 0) {
    throw new Error('EPUB parser could not extract readable chapter content');
  }

  return {
    metadata: {
      title: firstMetadataValue(pkg.metadata, ['dc:title', 'title']) || options.fileName || 'Untitled',
      author: firstMetadataValue(pkg.metadata, ['dc:creator', 'creator']) || null,
      language: firstMetadataValue(pkg.metadata, ['dc:language', 'language']) || null,
    },
    chapters,
    rawText: chapters.map((item) => item.content).join('\n\n'),
  };
}
