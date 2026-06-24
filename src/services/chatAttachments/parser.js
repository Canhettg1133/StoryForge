import { readStyleImporterFile } from '../styleImporter/fileReader.js';
import { validateChatAttachmentFile } from './fileSafety.js';

const TEXT_READER_CHUNK_BYTES = 1024 * 1024;

function makeParseError(code, message, cause = null) {
  const error = new Error(message);
  error.code = code;
  if (cause) error.cause = cause;
  return error;
}

function normalizeParsedText(value = '') {
  return String(value || '')
    .replace(/\r\n/g, '\n')
    .replace(/\t/g, ' ')
    .replace(/[ ]{2,}/g, ' ')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();
}

function titleFromFileName(fileName = '') {
  return String(fileName || 'Tệp đính kèm')
    .replace(/\.[^.]+$/u, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim() || 'Tệp đính kèm';
}

function normalizeSourceFileName(file = {}) {
  return file.name || file.originalname || file.fileName || 'Tệp đính kèm';
}

async function decodeTextBlobInSlices(file) {
  const decoder = new TextDecoder('utf-8', { fatal: false });
  const size = Number(file.size || 0);
  let text = '';

  for (let offset = 0; offset < size; offset += TEXT_READER_CHUNK_BYTES) {
    const end = Math.min(size, offset + TEXT_READER_CHUNK_BYTES);
    const blob = file.slice(offset, end);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    text += decoder.decode(bytes, { stream: end < size });
  }

  text += decoder.decode();
  return text;
}

async function decodeTextStream(file) {
  const decoder = new TextDecoder('utf-8', { fatal: false });
  const reader = file.stream().getReader();
  let text = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }

  text += decoder.decode();
  return text;
}

async function readTextAttachmentFile(file, fileType) {
  const sourceFileName = normalizeSourceFileName(file);
  let rawText = '';

  if (typeof file?.stream === 'function') {
    rawText = await decodeTextStream(file);
  } else if (typeof file?.slice === 'function') {
    rawText = await decodeTextBlobInSlices(file);
  } else if (file?.buffer) {
    rawText = new TextDecoder('utf-8', { fatal: false }).decode(file.buffer);
  } else if (typeof file?.text === 'function') {
    rawText = await file.text();
  } else if (typeof file?.arrayBuffer === 'function') {
    rawText = new TextDecoder('utf-8', { fatal: false }).decode(await file.arrayBuffer());
  }

  rawText = normalizeParsedText(rawText);
  if (!rawText) throw makeParseError('EMPTY_ATTACHMENT_TEXT', 'Tệp không có nội dung văn bản đọc được.');

  return {
    fileType,
    sourceFileName,
    title: titleFromFileName(sourceFileName),
    rawText,
    sectionCount: 1,
    metadata: {},
  };
}

export async function parseChatAttachmentFile(file, options = {}) {
  const safety = await validateChatAttachmentFile(file);
  if (!safety.ok) {
    throw makeParseError(safety.code, safety.message);
  }

  if (safety.fileType === 'pdf') {
    if (typeof options.parsePdfFile === 'function') {
      const parsed = await options.parsePdfFile(file);
      const rawText = normalizeParsedText(parsed?.rawText || parsed?.text || '');
      if (!rawText) throw makeParseError('EMPTY_ATTACHMENT_TEXT', 'PDF không có nội dung văn bản đọc được.');
      return {
        fileType: 'pdf',
        sourceFileName: normalizeSourceFileName(file),
        title: parsed?.title || titleFromFileName(normalizeSourceFileName(file)),
        rawText,
        sectionCount: Number(parsed?.sectionCount || parsed?.chapters?.length || 1),
        metadata: parsed?.metadata || {},
      };
    }

    throw makeParseError(
      'PDF_BACKEND_REQUIRED',
      'PDF cần jobs server để trích xuất an toàn. Hãy chạy jobs server rồi thử lại.',
    );
  }

  if (safety.fileType === 'txt' || safety.fileType === 'md') {
    return readTextAttachmentFile(file, safety.fileType);
  }

  try {
    const parsed = await readStyleImporterFile(file);
    const rawText = normalizeParsedText(parsed.rawText);
    if (!rawText) throw makeParseError('EMPTY_ATTACHMENT_TEXT', 'Tệp không có nội dung văn bản đọc được.');
    return {
      ...parsed,
      fileType: safety.fileType,
      rawText,
    };
  } catch (error) {
    if (error?.code) throw error;
    throw makeParseError('ATTACHMENT_PARSE_FAILED', error?.message || 'Không thể đọc tệp đính kèm.', error);
  }
}
