import JSZip from 'jszip';
import { XMLParser } from 'fast-xml-parser';
import { MAX_STYLE_IMPORTER_SOURCE_TOKENS } from './fileSafety.js';
import { estimateStyleImporterTokensDetailed } from './tokenEstimator.js';

const EXTENSION_TO_TYPE = {
  '.txt': 'txt',
  '.md': 'md',
  '.doc': 'doc',
  '.docx': 'docx',
  '.epub': 'epub',
};

const MIME_TO_TYPE = {
  'text/plain': 'txt',
  'text/markdown': 'md',
  'application/msword': 'doc',
  'application/epub+zip': 'epub',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
};

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseTagValue: false,
  trimValues: true,
});

function getExtension(fileName = '') {
  const match = String(fileName || '').toLowerCase().match(/(\.[^.]+)$/u);
  return match?.[1] || '';
}

function asArray(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function titleFromFileName(fileName = '') {
  return String(fileName || 'Untitled')
    .replace(/\.[^.]+$/u, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim() || 'Untitled';
}

function sanitizeWhitespace(text = '') {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/\t/g, ' ')
    .replace(/[ ]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function decodeHtmlEntities(text = '') {
  return String(text || '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (match, code) => {
      const parsed = Number(code);
      return Number.isNaN(parsed) ? match : String.fromCodePoint(parsed);
    })
    .replace(/&#x([0-9a-f]+);/gi, (match, hex) => {
      const parsed = Number.parseInt(hex, 16);
      return Number.isNaN(parsed) ? match : String.fromCodePoint(parsed);
    });
}

function stripHtml(html = '') {
  const withoutScripts = String(html || '')
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, ' ');

  const withBreaks = withoutScripts
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|section|article)>/gi, '\n');

  return sanitizeWhitespace(decodeHtmlEntities(withBreaks.replace(/<[^>]+>/g, ' ')));
}

function dirname(filePath = '') {
  const normalized = String(filePath || '').replace(/\\/g, '/');
  const index = normalized.lastIndexOf('/');
  return index >= 0 ? normalized.slice(0, index) : '.';
}

function normalizePath(filePath = '') {
  const parts = String(filePath || '').replace(/\\/g, '/').split('/');
  const stack = [];
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') stack.pop();
    else stack.push(part);
  }
  return stack.join('/');
}

function resolveHref(basePath, href = '') {
  const baseDir = dirname(basePath);
  return normalizePath(`${baseDir}/${href}`);
}

async function readZipText(zip, filePath) {
  const normalized = String(filePath || '').replace(/^\/+/, '');
  const directFile = zip.file(normalized) || zip.file(filePath);
  return directFile ? directFile.async('string') : null;
}

function getContainerOpfPath(containerXml) {
  const parsed = xmlParser.parse(containerXml);
  const rootfiles = parsed?.container?.rootfiles?.rootfile;
  return asArray(rootfiles)[0]?.['@_full-path'] || null;
}

function getMetadataValue(metadata, keys) {
  for (const key of keys) {
    const first = asArray(metadata?.[key])[0];
    if (typeof first === 'string') return decodeHtmlEntities(first);
    if (first && typeof first === 'object' && first['#text']) return decodeHtmlEntities(first['#text']);
  }
  return null;
}

function isLegacyDocBuffer(bytes) {
  return bytes?.[0] === 0xd0
    && bytes?.[1] === 0xcf
    && bytes?.[2] === 0x11
    && bytes?.[3] === 0xe0;
}

export function detectStyleImporterFileType(file = {}) {
  const extensionType = EXTENSION_TO_TYPE[getExtension(file.name || file.fileName || '')];
  if (extensionType) return extensionType;

  const mimeType = String(file.type || file.mimeType || '').toLowerCase().split(';')[0].trim();
  return MIME_TO_TYPE[mimeType] || null;
}

async function readDocxText(file) {
  const mammoth = await import('mammoth/mammoth.browser');
  const arrayBuffer = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer });
  return String(result?.value || '').trim();
}

async function readDocText(file) {
  const arrayBuffer = await file.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  if (isLegacyDocBuffer(bytes)) {
    throw new Error('DOC cu khong doc truc tiep duoc trong browser. Hay luu lai thanh DOCX roi tai len Prompt Doctor.');
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes).trim();
}

async function readEpubText(file) {
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const containerXml = await readZipText(zip, 'META-INF/container.xml');
  if (!containerXml) throw new Error('EPUB khong hop le: thieu META-INF/container.xml.');

  const opfPath = getContainerOpfPath(containerXml);
  if (!opfPath) throw new Error('EPUB khong hop le: thieu package document.');

  const packageXml = await readZipText(zip, opfPath);
  if (!packageXml) throw new Error('EPUB khong hop le: khong tim thay package document.');

  const pkg = xmlParser.parse(packageXml)?.package;
  const manifestById = new Map();
  asArray(pkg?.manifest?.item).forEach((item) => {
    if (item?.['@_id']) manifestById.set(item['@_id'], item);
  });

  const sections = [];
  for (const spineItem of asArray(pkg?.spine?.itemref)) {
    const item = manifestById.get(spineItem?.['@_idref']);
    const mediaType = String(item?.['@_media-type'] || '').toLowerCase();
    const properties = String(item?.['@_properties'] || '').toLowerCase();
    if (!item?.['@_href'] || properties.includes('nav')) continue;
    if (!mediaType.includes('html') && !mediaType.includes('xhtml')) continue;

    const html = await readZipText(zip, resolveHref(opfPath, item['@_href']));
    const text = stripHtml(html || '');
    if (text) sections.push(text);
  }

  if (sections.length === 0) {
    const fallbackHtmlFiles = zip.file(/\.(xhtml|html)$/i).filter((item) => !/nav|toc/i.test(item.name));
    for (const item of fallbackHtmlFiles) {
      const text = stripHtml(await item.async('string'));
      if (text) sections.push(text);
    }
  }

  const rawText = sanitizeWhitespace(sections.join('\n\n'));
  if (!rawText) throw new Error('EPUB parser khong trich duoc noi dung doc duoc.');

  return {
    rawText,
    sectionCount: sections.length,
    metadata: {
      title: getMetadataValue(pkg?.metadata, ['dc:title', 'title']),
      author: getMetadataValue(pkg?.metadata, ['dc:creator', 'creator']),
      language: getMetadataValue(pkg?.metadata, ['dc:language', 'language']),
    },
  };
}

export async function readStyleImporterFile(file) {
  if (!file) throw new Error('Please choose a file.');

  const fileType = detectStyleImporterFileType(file);
  if (!fileType) throw new Error('Prompt Doctor ho tro TXT, MD, DOCX va EPUB.');

  let result;
  if (fileType === 'docx') {
    result = { rawText: await readDocxText(file), sectionCount: 1, metadata: {} };
  } else if (fileType === 'doc') {
    result = { rawText: await readDocText(file), sectionCount: 1, metadata: {} };
  } else if (fileType === 'epub') {
    result = await readEpubText(file);
  } else {
    result = { rawText: await file.text(), sectionCount: 1, metadata: {} };
  }

  const rawText = sanitizeWhitespace(result.rawText);
  if (!rawText) throw new Error('File khong co noi dung van ban de phan tich.');

  return {
    fileType,
    sourceFileName: file.name || 'Untitled',
    title: result.metadata?.title || titleFromFileName(file.name),
    rawText,
    sectionCount: result.sectionCount || 1,
    metadata: result.metadata || {},
  };
}

function sliceByTokenBudget(text, tokenBudget, tokenToCharRatio, start, end) {
  const maxChars = Math.max(1, Math.floor(tokenBudget / tokenToCharRatio));
  return sanitizeWhitespace(String(text || '').slice(start, Math.min(end, start + maxChars)));
}

function trimToEstimatedTokenBudget(text, maxTokens) {
  let current = sanitizeWhitespace(text);
  let detail = estimateStyleImporterTokensDetailed(current);
  while (detail.estimatedTokens > maxTokens && current.length > 1) {
    const ratio = maxTokens / detail.estimatedTokens;
    current = sanitizeWhitespace(current.slice(0, Math.max(1, Math.floor(current.length * ratio * 0.98))));
    detail = estimateStyleImporterTokensDetailed(current);
  }
  return { text: current, tokenDetail: detail };
}

export function buildStyleImporterSample({
  rawText = '',
  totalEstimatedTokens = 0,
  maxSourceTokens = MAX_STYLE_IMPORTER_SOURCE_TOKENS,
} = {}) {
  const sourceText = sanitizeWhitespace(rawText);
  const sourceTokenDetail = estimateStyleImporterTokensDetailed(sourceText);
  const sourceEstimatedTokens = Math.max(
    sourceTokenDetail.estimatedTokens,
    Number(totalEstimatedTokens) || 0,
  );

  if (!sourceText) {
    return {
      mode: 'empty',
      estimatedRequests: 0,
      totalEstimatedTokens: 0,
      sampleEstimatedTokens: 0,
      chunks: [],
      warnings: ['File khong co noi dung van ban de phan tich.'],
    };
  }

  if (sourceEstimatedTokens <= maxSourceTokens) {
    return {
      mode: 'full',
      estimatedRequests: 1,
      totalEstimatedTokens: sourceEstimatedTokens,
      sampleEstimatedTokens: sourceTokenDetail.estimatedTokens,
      chunks: [{
        id: 'style_sample_full',
        label: 'Full analysis sample',
        text: sourceText,
        estimatedTokens: sourceTokenDetail.estimatedTokens,
        positionPercent: { start: 0, end: 100 },
        sampleStrategy: 'full',
      }],
      warnings: [],
    };
  }

  const ratio = Math.max(1, sourceEstimatedTokens) / Math.max(1, sourceText.length);
  const firstThirdEnd = Math.floor(sourceText.length / 3);
  const secondThirdEnd = Math.floor((sourceText.length * 2) / 3);
  const beginning = sliceByTokenBudget(sourceText, maxSourceTokens * 0.4, ratio, 0, firstThirdEnd);
  const middle = sliceByTokenBudget(sourceText, maxSourceTokens * 0.4, ratio, firstThirdEnd, secondThirdEnd);
  const endingBudgetChars = Math.max(1, Math.floor((maxSourceTokens * 0.2) / ratio));
  const endingStart = Math.max(secondThirdEnd, sourceText.length - endingBudgetChars);
  const ending = sanitizeWhitespace(sourceText.slice(endingStart));

  const composed = [
    '[SAMPLE: BEGINNING]',
    beginning,
    '',
    '[SAMPLE: MIDDLE]',
    middle,
    '',
    '[SAMPLE: END]',
    ending,
  ].join('\n');

  const trimmed = trimToEstimatedTokenBudget(composed, maxSourceTokens);
  return {
    mode: 'sample',
    estimatedRequests: 1,
    totalEstimatedTokens: sourceEstimatedTokens,
    sampleEstimatedTokens: trimmed.tokenDetail.estimatedTokens,
    chunks: [{
      id: 'style_sample_250k',
      label: 'Analysis sample',
      text: trimmed.text,
      estimatedTokens: trimmed.tokenDetail.estimatedTokens,
      positionPercent: { start: 0, end: 100 },
      sampleStrategy: 'fixed_40_40_20',
    }],
    warnings: [
      `Source was larger than ${maxSourceTokens} tokens; Prompt Doctor used a fixed beginning/middle/end sample.`,
    ],
  };
}
