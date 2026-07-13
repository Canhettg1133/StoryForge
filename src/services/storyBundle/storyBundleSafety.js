export const STORY_BUNDLE_LIMITS = Object.freeze({
  fileBytes: 256 * 1024 * 1024,
  uncompressedBytes: 512 * 1024 * 1024,
  manifestBytes: 1024 * 1024,
  jsonSectionBytes: 64 * 1024 * 1024,
  entryCount: 10_000,
  assetBytes: 25 * 1024 * 1024,
  imageBytes: 8 * 1024 * 1024,
  jsonDepth: 64,
  jsonNodes: 1_000_000,
});

const ALLOWED_FILES = new Set([
  'manifest.json',
  'data/project.json',
  'data/canon.json',
  'data/analysis.json',
  'data/chats.json',
  'data/lab.json',
]);
const ALLOWED_DIRECTORIES = new Set(['data/', 'assets/', 'assets/project/', 'assets/chat/']);
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function bundleError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

export function validateBundlePath(name) {
  const path = String(name || '');
  const normalized = path.replace(/\\/g, '/');
  const parts = normalized.split('/');
  if (
    !path
    || path.includes('\\')
    || normalized.startsWith('/')
    || /^[a-z]:/iu.test(normalized)
    || parts.some((part, index) => part === '..' || (part === '' && index !== parts.length - 1))
  ) {
    throw bundleError('STORY_BUNDLE_UNSAFE_PATH', 'File chứa đường dẫn ZIP không an toàn.');
  }
  if (normalized.endsWith('/')) {
    if (!ALLOWED_DIRECTORIES.has(normalized)) {
      throw bundleError('STORY_BUNDLE_ENTRY_NOT_ALLOWED', 'File chứa thư mục không được hỗ trợ.');
    }
    return normalized;
  }
  const assetAllowed = /^assets\/(project|chat)\/[a-z0-9][a-z0-9._-]*$/iu.test(normalized);
  if (!ALLOWED_FILES.has(normalized) && !assetAllowed) {
    throw bundleError('STORY_BUNDLE_ENTRY_NOT_ALLOWED', 'File chứa entry ngoài hợp đồng Story Bundle.');
  }
  return normalized;
}

function findEocd(bytes) {
  const minimum = Math.max(0, bytes.length - 65_557);
  for (let offset = bytes.length - 22; offset >= minimum; offset -= 1) {
    if (
      bytes[offset] === 0x50
      && bytes[offset + 1] === 0x4b
      && bytes[offset + 2] === 0x05
      && bytes[offset + 3] === 0x06
    ) return offset;
  }
  return -1;
}

export function inspectZipCentralDirectory(bytes) {
  if (bytes.length > STORY_BUNDLE_LIMITS.fileBytes) {
    throw bundleError('STORY_BUNDLE_FILE_TOO_LARGE', 'File StoryForge vượt giới hạn 256 MiB.');
  }
  const eocdOffset = findEocd(bytes);
  if (eocdOffset < 0) throw bundleError('STORY_BUNDLE_ZIP_INVALID', 'ZIP StoryForge không hợp lệ.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const entryCount = view.getUint16(eocdOffset + 10, true);
  const centralSize = view.getUint32(eocdOffset + 12, true);
  const centralOffset = view.getUint32(eocdOffset + 16, true);
  if (entryCount === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
    throw bundleError('STORY_BUNDLE_ZIP64_UNSUPPORTED', 'Story Bundle v1 không hỗ trợ ZIP64.');
  }
  if (entryCount > STORY_BUNDLE_LIMITS.entryCount) {
    throw bundleError('STORY_BUNDLE_TOO_MANY_ENTRIES', 'File có quá nhiều ZIP entry.');
  }
  if (centralOffset + centralSize > bytes.length) {
    throw bundleError('STORY_BUNDLE_ZIP_INVALID', 'Central directory của ZIP không hợp lệ.');
  }

  const entries = [];
  const seen = new Set();
  let offset = centralOffset;
  let totalUncompressed = 0;
  for (let index = 0; index < entryCount; index += 1) {
    if (view.getUint32(offset, true) !== 0x02014b50) {
      throw bundleError('STORY_BUNDLE_ZIP_INVALID', 'Central directory chứa entry không hợp lệ.');
    }
    const flags = view.getUint16(offset + 8, true);
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const uncompressedSize = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const externalAttributes = view.getUint32(offset + 38, true);
    const nameStart = offset + 46;
    const nameEnd = nameStart + nameLength;
    if (nameEnd + extraLength + commentLength > bytes.length) {
      throw bundleError('STORY_BUNDLE_ZIP_INVALID', 'ZIP entry bị cắt ngắn.');
    }
    const name = new TextDecoder((flags & 0x0800) ? 'utf-8' : 'utf-8', { fatal: true })
      .decode(bytes.slice(nameStart, nameEnd));
    const normalized = validateBundlePath(name);
    const duplicateKey = normalized.toLowerCase();
    if (seen.has(duplicateKey)) {
      throw bundleError('STORY_BUNDLE_DUPLICATE_ENTRY', 'File chứa ZIP entry trùng tên.');
    }
    seen.add(duplicateKey);
    if ((flags & 0x0001) !== 0 || ![0, 8].includes(method)) {
      throw bundleError('STORY_BUNDLE_ZIP_UNSUPPORTED', 'ZIP sử dụng tính năng không được hỗ trợ.');
    }
    const unixMode = (externalAttributes >>> 16) & 0xf000;
    if (unixMode === 0xa000) {
      throw bundleError('STORY_BUNDLE_SYMLINK_REJECTED', 'ZIP symlink không được hỗ trợ.');
    }
    totalUncompressed += uncompressedSize;
    if (totalUncompressed > STORY_BUNDLE_LIMITS.uncompressedBytes) {
      throw bundleError('STORY_BUNDLE_ZIP_BOMB', 'Tổng dữ liệu giải nén vượt giới hạn 512 MiB.');
    }
    if (normalized.startsWith('assets/') && uncompressedSize > STORY_BUNDLE_LIMITS.assetBytes) {
      throw bundleError('STORY_BUNDLE_ASSET_TOO_LARGE', 'Asset trong bundle vượt giới hạn 25 MiB.');
    }
    entries.push({ name: normalized, compressedSize, uncompressedSize, isDirectory: normalized.endsWith('/') });
    offset = nameEnd + extraLength + commentLength;
  }
  return { entries, totalUncompressed };
}

function validateJsonTree(value) {
  let nodes = 0;
  const stack = [{ value, depth: 0 }];
  while (stack.length > 0) {
    const current = stack.pop();
    nodes += 1;
    if (nodes > STORY_BUNDLE_LIMITS.jsonNodes) {
      throw bundleError('STORY_BUNDLE_JSON_TOO_COMPLEX', 'JSON trong file quá phức tạp.');
    }
    if (current.depth > STORY_BUNDLE_LIMITS.jsonDepth) {
      throw bundleError('STORY_BUNDLE_JSON_TOO_DEEP', 'JSON trong file vượt độ sâu cho phép.');
    }
    if (!current.value || typeof current.value !== 'object') continue;
    for (const key of Object.keys(current.value)) {
      if (FORBIDDEN_KEYS.has(key)) {
        throw bundleError('STORY_BUNDLE_FORBIDDEN_KEY', 'JSON chứa key không an toàn.');
      }
      stack.push({ value: current.value[key], depth: current.depth + 1 });
    }
  }
}

export function parseBoundedJson(text, { manifest = false } = {}) {
  const bytes = new TextEncoder().encode(String(text || '')).length;
  const limit = manifest ? STORY_BUNDLE_LIMITS.manifestBytes : STORY_BUNDLE_LIMITS.jsonSectionBytes;
  if (bytes > limit) {
    throw bundleError(
      manifest ? 'STORY_BUNDLE_MANIFEST_TOO_LARGE' : 'STORY_BUNDLE_SECTION_TOO_LARGE',
      manifest ? 'Manifest vượt giới hạn 1 MiB.' : 'JSON section vượt giới hạn 64 MiB.',
    );
  }
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw bundleError('STORY_BUNDLE_JSON_INVALID', 'JSON trong Story Bundle không hợp lệ.');
  }
  validateJsonTree(value);
  return value;
}

export function validateImageMagic(bytes, mimeType) {
  const mime = String(mimeType || '').toLowerCase();
  const png = bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
    .every((value, index) => bytes[index] === value);
  const jpeg = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const webp = bytes.length >= 12
    && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF'
    && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP';
  return (mime === 'image/png' && png)
    || (mime === 'image/jpeg' && jpeg)
    || (mime === 'image/webp' && webp);
}

export function makeStoryBundleError(code, message) {
  return bundleError(code, message);
}
