import JSZip from 'jszip';

export const CHAT_ATTACHMENT_SCOPES = Object.freeze({
  THREAD: 'thread',
  PROJECT: 'project',
});

export const CHAT_ATTACHMENT_STATUSES = Object.freeze({
  VALIDATING: 'validating',
  EXTRACTING: 'extracting',
  INDEXED: 'indexed',
  READING: 'reading',
  READY: 'ready',
  FAILED: 'failed',
});

export const MAX_CHAT_ATTACHMENT_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_CHAT_IMAGE_FILE_BYTES = 8 * 1024 * 1024;
export const MAX_CHAT_IMAGE_ATTACHMENTS_PER_TURN = 4;
export const MAX_CHAT_IMAGE_CONTEXT_BYTES = 12 * 1024 * 1024;
export const MAX_CHAT_ATTACHMENT_ZIP_ENTRIES = 3500;
export const MAX_CHAT_ATTACHMENT_ZIP_UNCOMPRESSED_BYTES = 80 * 1024 * 1024;
export const CHAT_ATTACHMENT_ACCEPT = '.txt,.md,.docx,.epub,.pdf,.png,.jpg,.jpeg,.webp';

const EXTENSION_TO_TYPE = new Map([
  ['.txt', 'txt'],
  ['.md', 'md'],
  ['.docx', 'docx'],
  ['.epub', 'epub'],
  ['.pdf', 'pdf'],
  ['.png', 'image'],
  ['.jpg', 'image'],
  ['.jpeg', 'image'],
  ['.webp', 'image'],
]);

const ZIP_CONTAINER_EXTENSIONS = new Set(['.docx', '.epub']);
const IMAGE_EXTENSION_TO_MIME = new Map([
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
]);
const IMAGE_MIME_TYPES = new Set(IMAGE_EXTENSION_TO_MIME.values());
const LOOSE_BINARY_MIME_TYPES = new Set(['', 'application/octet-stream']);
const UNSAFE_EXTENSIONS = new Set([
  '.exe',
  '.js',
  '.mjs',
  '.cjs',
  '.html',
  '.htm',
  '.doc',
  '.docm',
  '.zip',
  '.rar',
  '.7z',
  '.bat',
  '.cmd',
  '.ps1',
]);

const UNSAFE_MIME_PARTS = [
  'html',
  'javascript',
  'ecmascript',
  'x-msdownload',
  'x-msdos-program',
  'rar',
  '7z',
];

const ALLOWED_MIME_TYPES = new Set([
  '',
  'application/octet-stream',
  'text/plain',
  'text/markdown',
  'application/pdf',
  'application/epub+zip',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

function makeResult(ok, code, message, extra = {}) {
  return {
    ok,
    code,
    message,
    ...extra,
  };
}

export function getChatAttachmentExtension(fileName = '') {
  const match = String(fileName || '').toLowerCase().match(/(\.[^.]+)$/u);
  return match?.[1] || '';
}

export function detectChatAttachmentFileType(file = {}) {
  const extension = getChatAttachmentExtension(file.name || file.fileName || file.originalname || '');
  return EXTENSION_TO_TYPE.get(extension) || null;
}

function normalizeMimeType(file = {}) {
  return String(file.type || file.mimeType || file.mimetype || '')
    .toLowerCase()
    .split(';')[0]
    .trim();
}

function normalizeFileSize(file = {}) {
  return Number(file.size || file.byteLength || file.buffer?.length || 0);
}

async function fileToArrayBuffer(file) {
  if (file?.buffer) {
    const buffer = file.buffer;
    return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  }
  if (typeof file?.arrayBuffer === 'function') {
    return file.arrayBuffer();
  }
  return new ArrayBuffer(0);
}

async function readMagicBytes(file, maxBytes = 128) {
  if (!file) return new Uint8Array();
  if (file.buffer) return new Uint8Array(file.buffer).slice(0, maxBytes);
  if (typeof file.slice === 'function') {
    const blob = file.slice(0, maxBytes);
    if (blob && typeof blob.arrayBuffer === 'function') {
      return new Uint8Array(await blob.arrayBuffer());
    }
  }
  const buffer = await fileToArrayBuffer(file);
  return new Uint8Array(buffer).slice(0, maxBytes);
}

function asciiPrefix(bytes) {
  return Array.from(bytes || [])
    .map((value) => String.fromCharCode(value))
    .join('')
    .trimStart()
    .toLowerCase();
}

function hasUnsafeMagicBytes(bytes, extension) {
  if (!bytes || bytes.length === 0) return false;
  if (bytes[0] === 0x4d && bytes[1] === 0x5a) return true;
  if (
    bytes[0] === 0x50
    && bytes[1] === 0x4b
    && !ZIP_CONTAINER_EXTENSIONS.has(extension)
  ) {
    return true;
  }

  const prefix = asciiPrefix(bytes);
  return prefix.startsWith('<!doctype html')
    || prefix.startsWith('<html')
    || prefix.startsWith('<script')
    || prefix.startsWith('<?xml');
}

function hasPdfMagicBytes(bytes) {
  if (!bytes || bytes.length < 5) return false;
  return asciiPrefix(bytes).startsWith('%pdf-');
}

function detectImageMimeFromMagicBytes(bytes) {
  if (!bytes || bytes.length < 4) return '';
  if (
    bytes[0] === 0x89
    && bytes[1] === 0x50
    && bytes[2] === 0x4e
    && bytes[3] === 0x47
    && bytes[4] === 0x0d
    && bytes[5] === 0x0a
    && bytes[6] === 0x1a
    && bytes[7] === 0x0a
  ) {
    return 'image/png';
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    bytes[0] === 0x52
    && bytes[1] === 0x49
    && bytes[2] === 0x46
    && bytes[3] === 0x46
    && bytes[8] === 0x57
    && bytes[9] === 0x45
    && bytes[10] === 0x42
    && bytes[11] === 0x50
  ) {
    return 'image/webp';
  }
  return '';
}

function validateImageAttachment({ extension, mimeType, magicBytes }) {
  const expectedMime = IMAGE_EXTENSION_TO_MIME.get(extension) || '';
  const hasStrictMime = !LOOSE_BINARY_MIME_TYPES.has(mimeType);
  if (hasStrictMime && (!IMAGE_MIME_TYPES.has(mimeType) || mimeType !== expectedMime)) {
    return makeResult(false, 'IMAGE_MIME_MISMATCH', 'MIME type của ảnh không khớp với phần mở rộng.');
  }

  const actualMime = detectImageMimeFromMagicBytes(magicBytes);
  if (!actualMime) {
    return makeResult(false, 'IMAGE_INVALID_SIGNATURE', 'Magic bytes không khớp định dạng ảnh được hỗ trợ.');
  }
  if (actualMime !== expectedMime) {
    return makeResult(false, 'IMAGE_MIME_MISMATCH', 'Magic bytes của ảnh không khớp với phần mở rộng.');
  }
  return makeResult(true, 'IMAGE_SAFE', 'Ảnh hợp lệ để gửi vào chat.');
}

function isUnsafeZipPath(name = '') {
  const normalized = String(name || '').replace(/\\/g, '/');
  return normalized.startsWith('/')
    || /^[a-z]:/iu.test(normalized)
    || normalized.split('/').some((part) => part === '..');
}

function readZipName(bytes) {
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}

function inspectZipCentralDirectory(arrayBuffer) {
  const view = new DataView(arrayBuffer);
  const bytes = new Uint8Array(arrayBuffer);
  const minEocdOffset = Math.max(0, bytes.length - 0xffff - 22);
  let eocdOffset = -1;

  for (let offset = bytes.length - 22; offset >= minEocdOffset; offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) {
      eocdOffset = offset;
      break;
    }
  }

  if (eocdOffset < 0) {
    return makeResult(false, 'ZIP_EOCD_MISSING', 'File nén thiếu central directory hợp lệ.');
  }

  const totalEntries = view.getUint16(eocdOffset + 10, true);
  const centralSize = view.getUint32(eocdOffset + 12, true);
  const centralOffset = view.getUint32(eocdOffset + 16, true);
  if (totalEntries === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
    return makeResult(false, 'ZIP64_UNSUPPORTED', 'ZIP64 chưa được hỗ trợ cho tệp đính kèm chat.');
  }
  if (totalEntries > MAX_CHAT_ATTACHMENT_ZIP_ENTRIES) {
    return makeResult(false, 'ZIP_TOO_MANY_ENTRIES', 'File có quá nhiều mục nén để xử lý an toàn.');
  }
  if (centralOffset + centralSize > bytes.length) {
    return makeResult(false, 'ZIP_DIRECTORY_INVALID', 'Central directory của file nén không hợp lệ.');
  }

  let cursor = centralOffset;
  let uncompressedBytes = 0;
  for (let index = 0; index < totalEntries; index += 1) {
    if (cursor + 46 > bytes.length || view.getUint32(cursor, true) !== 0x02014b50) {
      return makeResult(false, 'ZIP_ENTRY_INVALID', 'File nén chứa entry không hợp lệ.');
    }

    const entrySize = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const nameStart = cursor + 46;
    const nameEnd = nameStart + nameLength;
    const nextCursor = nameEnd + extraLength + commentLength;

    if (nameEnd > bytes.length || nextCursor > bytes.length) {
      return makeResult(false, 'ZIP_ENTRY_INVALID', 'File nén chứa entry không hợp lệ.');
    }
    if (entrySize === 0xffffffff) {
      return makeResult(false, 'ZIP64_UNSUPPORTED', 'ZIP64 chưa được hỗ trợ cho tệp đính kèm chat.');
    }

    const entryName = readZipName(bytes.slice(nameStart, nameEnd));
    if (isUnsafeZipPath(entryName)) {
      return makeResult(false, 'ZIP_UNSAFE_PATH', 'File nén chứa đường dẫn không an toàn.');
    }

    uncompressedBytes += entrySize;
    if (uncompressedBytes > MAX_CHAT_ATTACHMENT_ZIP_UNCOMPRESSED_BYTES) {
      return makeResult(false, 'ZIP_TOO_LARGE', 'File nén bung ra vượt giới hạn an toàn.');
    }
    cursor = nextCursor;
  }

  return makeResult(true, 'ZIP_DIRECTORY_SAFE', 'Central directory hợp lệ.', {
    entryCount: totalEntries,
    uncompressedBytes,
  });
}

async function inspectZipContainer(file, extension) {
  const arrayBuffer = await fileToArrayBuffer(file);
  const directoryResult = inspectZipCentralDirectory(arrayBuffer);
  if (!directoryResult.ok) return directoryResult;

  let zip;
  try {
    zip = await JSZip.loadAsync(arrayBuffer);
  } catch {
    return makeResult(false, 'ZIP_INSPECTION_FAILED', 'Không thể kiểm tra cấu trúc file nén của tệp này.');
  }

  const entries = Object.values(zip.files || {});
  for (const entry of entries) {
    if (isUnsafeZipPath(entry.name)) {
      return makeResult(false, 'ZIP_UNSAFE_PATH', 'File nén chứa đường dẫn không an toàn.');
    }
  }

  if (extension === '.docx' && !zip.file('[Content_Types].xml')) {
    return makeResult(false, 'DOCX_INVALID_CONTAINER', 'DOCX thiếu cấu trúc tài liệu hợp lệ.');
  }

  if (extension === '.epub' && !zip.file('META-INF/container.xml')) {
    return makeResult(false, 'EPUB_INVALID_CONTAINER', 'EPUB thiếu META-INF/container.xml.');
  }

  return makeResult(true, 'ZIP_SAFE', 'File nén hợp lệ.');
}

export async function validateChatAttachmentFile(file) {
  if (!file) {
    return makeResult(false, 'NO_FILE', 'Chưa chọn tệp.');
  }

  const fileName = String(file.name || file.fileName || file.originalname || '').trim();
  const extension = getChatAttachmentExtension(fileName);
  const fileType = EXTENSION_TO_TYPE.get(extension) || null;
  const mimeType = normalizeMimeType(file);
  const size = normalizeFileSize(file);

  if (!fileName) {
    return makeResult(false, 'NO_FILENAME', 'Tệp thiếu tên hợp lệ.');
  }

  if (UNSAFE_EXTENSIONS.has(extension)) {
    return makeResult(false, 'UNSAFE_EXTENSION', 'Định dạng tệp này bị chặn vì lý do an toàn.', {
      extension,
      fileType,
      mimeType,
      size,
    });
  }

  if (!fileType) {
    return makeResult(false, 'UNSUPPORTED_EXTENSION', 'Chỉ hỗ trợ TXT, MD, DOCX, EPUB, PDF, PNG, JPEG và WEBP.', {
      extension,
      fileType,
      mimeType,
      size,
    });
  }

  if (fileType === 'image' && size > MAX_CHAT_IMAGE_FILE_BYTES) {
    return makeResult(false, 'IMAGE_TOO_LARGE', 'Ảnh vượt giới hạn 8 MB cho chat.', {
      extension,
      fileType,
      mimeType,
      size,
    });
  }

  if (fileType !== 'image' && size > MAX_CHAT_ATTACHMENT_FILE_BYTES) {
    return makeResult(false, 'FILE_TOO_LARGE', 'Tệp vượt giới hạn 25 MB cho chat.', {
      extension,
      fileType,
      mimeType,
      size,
    });
  }

  if (
    UNSAFE_MIME_PARTS.some((part) => mimeType.includes(part))
    || (mimeType.includes('zip') && !ZIP_CONTAINER_EXTENSIONS.has(extension))
  ) {
    return makeResult(false, 'UNSAFE_MIME', 'MIME type của tệp không an toàn để phân tích.', {
      extension,
      fileType,
      mimeType,
      size,
    });
  }

  if (fileType !== 'image' && !ALLOWED_MIME_TYPES.has(mimeType) && !mimeType.startsWith('text/')) {
    return makeResult(false, 'UNSUPPORTED_MIME', 'MIME type không khớp với định dạng được hỗ trợ.', {
      extension,
      fileType,
      mimeType,
      size,
    });
  }

  const magicBytes = await readMagicBytes(file);
  if (hasUnsafeMagicBytes(magicBytes, extension)) {
    return makeResult(false, 'UNSAFE_MAGIC_BYTES', 'Magic bytes cho thấy tệp không an toàn.', {
      extension,
      fileType,
      mimeType,
      size,
    });
  }

  if (fileType === 'image') {
    const imageResult = validateImageAttachment({ extension, mimeType, magicBytes });
    if (!imageResult.ok) {
      return {
        ...imageResult,
        extension,
        fileType,
        mimeType,
        size,
      };
    }
    return makeResult(true, 'SAFE_ATTACHMENT_FILE', 'Ảnh hợp lệ để gửi vào chat.', {
      extension,
      fileType,
      mimeType: mimeType || IMAGE_EXTENSION_TO_MIME.get(extension) || '',
      size,
    });
  }

  if (fileType === 'pdf' && !hasPdfMagicBytes(magicBytes)) {
    return makeResult(false, 'PDF_INVALID_SIGNATURE', 'Magic bytes không khớp định dạng PDF.', {
      extension,
      fileType,
      mimeType,
      size,
    });
  }

  if (ZIP_CONTAINER_EXTENSIONS.has(extension)) {
    const zipResult = await inspectZipContainer(file, extension);
    if (!zipResult.ok) {
      return {
        ...zipResult,
        extension,
        fileType,
        mimeType,
        size,
      };
    }
  }

  return makeResult(true, 'SAFE_ATTACHMENT_FILE', 'Tệp hợp lệ để đưa vào chat.', {
    extension,
    fileType,
    mimeType,
    size,
  });
}
