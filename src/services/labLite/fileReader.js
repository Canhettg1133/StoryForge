import { parseChaptersFromText } from './chapterParser.js';
import { wrap } from 'comlink';

const EXTENSION_TO_TYPE = {
  '.txt': 'txt',
  '.md': 'md',
  '.docx': 'docx',
};

const MIME_TO_TYPE = {
  'text/plain': 'txt',
  'text/markdown': 'md',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
};

let workerApi = null;

function canUseIngestWorker(fileType) {
  return ['txt', 'md'].includes(fileType) && typeof Worker !== 'undefined';
}

function getIngestWorkerApi() {
  if (!workerApi) {
    const worker = new Worker(new URL('./ingestWorker.js', import.meta.url), { type: 'module' });
    workerApi = wrap(worker);
  }
  return workerApi;
}

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

export function detectLabLiteFileType(file = {}) {
  const extensionType = EXTENSION_TO_TYPE[getExtension(file.name || file.fileName || '')];
  if (extensionType) return extensionType;

  const mimeType = String(file.type || file.mimeType || '').toLowerCase().split(';')[0].trim();
  return MIME_TO_TYPE[mimeType] || null;
}

async function readDocxText(file) {
  try {
    const mammoth = await import('mammoth/mammoth.browser');
    const arrayBuffer = await file.arrayBuffer();
    const result = await mammoth.extractRawText({ arrayBuffer });
    return String(result?.value || '').trim();
  } catch (error) {
    const wrapped = new Error('DOCX parser is not available in this browser build.');
    wrapped.code = 'DOCX_UNSUPPORTED';
    wrapped.cause = error;
    throw wrapped;
  }
}

export async function readLabLiteFile(file, options = {}) {
  if (!file) {
    throw new Error('Please choose a file.');
  }

  const fileType = detectLabLiteFileType(file);
  if (!fileType) {
    const error = new Error('Unsupported file type. Lab Lite currently supports TXT, MD, and DOCX.');
    error.code = 'UNSUPPORTED_FILE_TYPE';
    throw error;
  }

  if (canUseIngestWorker(fileType)) {
    try {
      return await getIngestWorkerApi().readTextFile(file, {
        ...options,
        onProgress: undefined,
      });
    } catch (error) {
      console.warn('[LabLite] Worker ingest failed; falling back to main thread parser.', error);
    }
  }

  const rawText = fileType === 'docx'
    ? await readDocxText(file)
    : await file.text();

  const parsed = parseChaptersFromText(rawText, {
    ...options,
    fallbackTitlePrefix: options.fallbackTitlePrefix || 'Chapter',
  });

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
