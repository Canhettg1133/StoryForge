import path from 'node:path';
import { parseDocx } from './docxParser.js';
import { parseEpub } from './epubParser.js';
import { parsePdf } from './pdfParser.js';
import { parseTxt } from './txtParser.js';

const EXTENSION_TO_TYPE = {
  '.txt': 'txt',
  '.epub': 'epub',
  '.pdf': 'pdf',
  '.docx': 'docx',
};

const MIME_TO_TYPE = {
  'text/plain': 'txt',
  'application/epub+zip': 'epub',
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
};

const SUPPORTED_TYPES = Object.freeze(['txt', 'epub', 'pdf', 'docx']);

export function detectFileType({ fileName = '', mimeType = '' } = {}) {
  const extension = path.extname(fileName || '').toLowerCase();
  if (EXTENSION_TO_TYPE[extension]) {
    return EXTENSION_TO_TYPE[extension];
  }

  const normalizedMimeType = String(mimeType || '').toLowerCase().split(';')[0].trim();
  if (MIME_TO_TYPE[normalizedMimeType]) {
    return MIME_TO_TYPE[normalizedMimeType];
  }

  return null;
}

export async function parseCorpusFile({
  buffer,
  fileName,
  mimeType,
  options = {},
}) {
  const fileType = detectFileType({ fileName, mimeType });

  if (!fileType) {
    const error = new Error('Unsupported file type. Supported: TXT, EPUB, PDF, DOCX.');
    error.code = 'UNSUPPORTED_FILE_TYPE';
    throw error;
  }

  let parsed;

  switch (fileType) {
    case 'txt':
      parsed = parseTxt(buffer, { ...options, fileName });
      break;
    case 'epub':
      parsed = await parseEpub(buffer, { ...options, fileName });
      break;
    case 'pdf':
      parsed = await parsePdf(buffer, { ...options, fileName });
      break;
    case 'docx':
      parsed = await parseDocx(buffer, { ...options, fileName });
      break;
    default: {
      const error = new Error('Unsupported file type parser');
      error.code = 'UNSUPPORTED_FILE_TYPE';
      throw error;
    }
  }

  return {
    fileType,
    metadata: parsed.metadata || {},
    chapters: parsed.chapters || [],
    rawText: parsed.rawText || '',
  };
}

export { SUPPORTED_TYPES };
