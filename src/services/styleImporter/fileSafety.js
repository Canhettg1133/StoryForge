export const MAX_STYLE_IMPORTER_FILE_BYTES = 10 * 1024 * 1024;
export const FULL_FILE_MAX_BYTES = 5 * 1024 * 1024;
export const MODEL_INPUT_LIMIT_TOKENS = 1_000_000;
export const CHUNK_TARGET_TOKENS = 650_000;
export const CHUNK_HARD_CAP_TOKENS = 750_000;

const ALLOWED_EXTENSIONS = new Set(['.txt', '.md']);
const UNSAFE_EXTENSIONS = new Set([
  '.exe',
  '.js',
  '.html',
  '.htm',
  '.docm',
  '.zip',
  '.rar',
  '.7z',
]);
const UNSAFE_MIME_PARTS = [
  'html',
  'javascript',
  'ecmascript',
  'zip',
  'rar',
  '7z',
  'x-msdownload',
];
const TEXT_MIME_TYPES = new Set([
  '',
  'text/plain',
  'text/markdown',
  'application/octet-stream',
]);

function getExtension(fileName = '') {
  const match = String(fileName || '').toLowerCase().match(/(\.[^.]+)$/u);
  return match?.[1] || '';
}

function makeResult(ok, code, message, extra = {}) {
  return {
    ok,
    code,
    message,
    ...extra,
  };
}

async function readMagicBytes(file, maxBytes = 96) {
  if (!file || typeof file.slice !== 'function') return new Uint8Array();
  const blob = file.slice(0, maxBytes);
  if (!blob || typeof blob.arrayBuffer !== 'function') return new Uint8Array();
  try {
    return new Uint8Array(await blob.arrayBuffer());
  } catch {
    return new Uint8Array();
  }
}

function asciiPrefix(bytes) {
  return Array.from(bytes || [])
    .map((value) => String.fromCharCode(value))
    .join('')
    .trimStart()
    .toLowerCase();
}

function hasUnsafeMagicBytes(bytes) {
  if (!bytes || bytes.length === 0) return false;
  if (bytes[0] === 0x4d && bytes[1] === 0x5a) return true; // MZ executable
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) return true; // ZIP/DOCX/EPUB archives

  const prefix = asciiPrefix(bytes);
  return prefix.startsWith('<!doctype html')
    || prefix.startsWith('<html')
    || prefix.startsWith('<script')
    || prefix.startsWith('<?xml');
}

export function detectMojibakeWarnings(text = '') {
  const value = String(text || '');
  const warnings = [];
  if (!value) return warnings;

  const replacementCount = (value.match(/\uFFFD/gu) || []).length;
  if (replacementCount > 0) {
    warnings.push(`Phát hiện ${replacementCount} ký tự lỗi giải mã.`);
  }

  const mojibakeSignals = ['Ă', 'Â', 'áº', 'á»', 'Ä‘', 'Æ°', 'Æ¡'];
  const signalCount = mojibakeSignals.reduce((total, signal) => (
    total + (value.split(signal).length - 1)
  ), 0);
  if (signalCount >= 8) {
    warnings.push('Nội dung có dấu hiệu lỗi mã hóa tiếng Việt.');
  }

  return warnings;
}

export async function inspectStyleImporterFile(file) {
  if (!file) {
    return makeResult(false, 'NO_FILE', 'Chưa chọn file.');
  }

  const name = String(file.name || file.fileName || '');
  const extension = getExtension(name);
  const mimeType = String(file.type || file.mimeType || '').toLowerCase().split(';')[0].trim();
  const size = Number(file.size || 0);

  if (size > MAX_STYLE_IMPORTER_FILE_BYTES) {
    return makeResult(false, 'FILE_TOO_LARGE', 'File vượt quá giới hạn 10MB.', {
      extension,
      mimeType,
      size,
    });
  }

  if (UNSAFE_EXTENSIONS.has(extension)) {
    return makeResult(false, 'UNSAFE_EXTENSION', 'Định dạng file này bị chặn vì lý do an toàn.', {
      extension,
      mimeType,
      size,
    });
  }

  if (!ALLOWED_EXTENSIONS.has(extension)) {
    return makeResult(false, 'UNSUPPORTED_EXTENSION', 'Style Importer v1 chỉ hỗ trợ TXT và MD.', {
      extension,
      mimeType,
      size,
    });
  }

  if (UNSAFE_MIME_PARTS.some((part) => mimeType.includes(part))) {
    return makeResult(false, 'UNSAFE_MIME', 'MIME type của file không an toàn để phân tích.', {
      extension,
      mimeType,
      size,
    });
  }

  if (!TEXT_MIME_TYPES.has(mimeType) && !mimeType.startsWith('text/')) {
    return makeResult(false, 'UNSUPPORTED_MIME', 'MIME type không khớp với file văn bản.', {
      extension,
      mimeType,
      size,
    });
  }

  const magicBytes = await readMagicBytes(file);
  if (hasUnsafeMagicBytes(magicBytes)) {
    return makeResult(false, 'UNSAFE_MAGIC_BYTES', 'Magic bytes cho thấy file không phải văn bản an toàn.', {
      extension,
      mimeType,
      size,
    });
  }

  return makeResult(true, 'SAFE_TEXT_FILE', 'File hợp lệ để phân tích.', {
    extension,
    mimeType,
    size,
  });
}
