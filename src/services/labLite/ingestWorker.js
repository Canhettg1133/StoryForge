import { expose } from 'comlink';
import { parseChaptersFromText } from './chapterParser.js';

const EXTENSION_TO_TYPE = {
  '.txt': 'txt',
  '.md': 'md',
};

function getExtension(fileName = '') {
  const match = String(fileName || '').toLowerCase().match(/(\.[^.]+)$/u);
  return match?.[1] || '';
}

function titleFromFileName(fileName = '') {
  return String(fileName || 'Untitled')
    .replace(/\.[^.]+$/u, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim() || 'Untitled';
}

async function readTextFile(file, options = {}) {
  const fileType = EXTENSION_TO_TYPE[getExtension(file?.name || file?.fileName || '')];
  if (!fileType) {
    throw new Error('Worker chỉ hỗ trợ TXT/MD trong giai đoạn này.');
  }
  options.onProgress?.({ phase: 'reading', message: 'Đang đọc file...', progress: 0.15 });
  const rawText = await file.text();
  options.onProgress?.({ phase: 'parsing', message: 'Đang tách chương...', progress: 0.45 });
  const parsed = parseChaptersFromText(rawText, {
    ...options,
    fallbackTitlePrefix: options.fallbackTitlePrefix || 'Chapter',
  });
  options.onProgress?.({ phase: 'complete', message: 'Đã tách chương.', progress: 1 });
  return {
    fileType,
    sourceFileName: file.name || 'Untitled',
    title: options.title || titleFromFileName(file.name),
    rawText: parsed.rawText,
    chapters: parsed.chapters,
    frontMatter: parsed.frontMatter,
    diagnostics: parsed.diagnostics,
  };
}

expose({ readTextFile });
