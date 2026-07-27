import { detectPromptExtractionAttempt } from './protection.js';

export const MAX_CHAT_ATTACHMENT_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_CHAT_IMAGE_FILE_BYTES = 8 * 1024 * 1024;
export const MAX_CHAT_IMAGE_CONTEXT_BYTES = 12 * 1024 * 1024;

const IMAGE_MAGIC = {
  'image/png': [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  'image/jpeg': [0xff, 0xd8, 0xff],
  'image/webp': [0x52, 0x49, 0x46, 0x46],
};
const IMAGE_EXTENSIONS = {
  'image/png': new Set(['png']),
  'image/jpeg': new Set(['jpg', 'jpeg']),
  'image/webp': new Set(['webp']),
};

function attachmentError(code = 'SUPREME_ATTACHMENT_INVALID', status = 422) {
  return Object.assign(new Error(code), { code, status });
}

function safeMetadata(value) {
  return String(value || '')
    .replace(/[<>&"']/gu, '_')
    .replace(/[\u0000-\u001f\u007f]/gu, '')
    .slice(0, 240);
}

function safeAttachmentText(value) {
  return String(value || '').replace(
    /<\s*\/?\s*(ATTACHMENT_DATA|CHUNK|PROFILE)\b/giu,
    (match) => match.replace('<', '&lt;'),
  );
}

function parseImageDataUrl(dataUrl) {
  const match = String(dataUrl || '').match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/u);
  if (!match) throw attachmentError();
  const payload = match[2];
  const paddingBytes = payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0;
  const encodedBytes = paddingBytes > 0 ? payload.slice(0, -paddingBytes) : payload;
  if (
    payload.length % 4 !== 0
    || /[^A-Za-z0-9+/]/u.test(encodedBytes)
    || encodedBytes.includes('=')
    || (paddingBytes === 1 && encodedBytes.length % 4 !== 3)
    || (paddingBytes === 2 && encodedBytes.length % 4 !== 2)
    || (paddingBytes === 0 && encodedBytes.length % 4 !== 0)
  ) {
    throw attachmentError();
  }
  const byteLength = ((payload.length / 4) * 3) - paddingBytes;
  let binary;
  try {
    binary = atob(payload.slice(0, 16));
  } catch {
    throw attachmentError();
  }
  return {
    mimeType: match[1],
    byteLength,
    prefixBytes: Uint8Array.from(binary, (character) => character.charCodeAt(0)),
  };
}

function hasMagicBytes(bytes, mimeType) {
  const magic = IMAGE_MAGIC[mimeType];
  if (!magic || bytes.length < magic.length) return false;
  if (!magic.every((byte, index) => bytes[index] === byte)) return false;
  if (mimeType === 'image/webp') {
    return bytes.length >= 12
      && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP';
  }
  return true;
}

export function validateSupremeImage(attachment) {
  const decoded = parseImageDataUrl(attachment.dataUrl);
  const extension = String(attachment.fileName || '')
    .trim()
    .toLowerCase()
    .split('.')
    .pop();
  if (
    decoded.mimeType !== attachment.mimeType
    || decoded.byteLength !== Number(attachment.sizeBytes)
    || decoded.byteLength > MAX_CHAT_IMAGE_FILE_BYTES
    || !hasMagicBytes(decoded.prefixBytes, decoded.mimeType)
    || !IMAGE_EXTENSIONS[decoded.mimeType]?.has(extension)
  ) {
    throw attachmentError();
  }
  return attachment;
}

export function prepareSupremeAttachments(attachments = []) {
  const safeAttachments = [];
  const skippedAttachmentChunks = [];
  let totalImageBytes = 0;

  for (const attachment of attachments) {
    if (attachment.kind === 'image') {
      validateSupremeImage(attachment);
      totalImageBytes += Number(attachment.sizeBytes || 0);
      safeAttachments.push(attachment);
      continue;
    }

    const safeChunks = [];
    for (const chunk of attachment.chunks || []) {
      if (detectPromptExtractionAttempt(`${chunk.title}\n${chunk.text}`).blocked) {
        skippedAttachmentChunks.push({
          fileId: attachment.fileId,
          chunkIndex: chunk.chunkIndex,
          code: 'UNTRUSTED_INSTRUCTION_BLOCKED',
        });
      } else {
        safeChunks.push(chunk);
      }
    }
    const profileText = detectPromptExtractionAttempt(attachment.profileText).blocked
      ? ''
      : attachment.profileText;
    safeAttachments.push({ ...attachment, profileText, chunks: safeChunks });
  }

  if (totalImageBytes > MAX_CHAT_IMAGE_CONTEXT_BYTES) {
    throw attachmentError('SUPREME_IMAGE_CONTEXT_TOO_LARGE', 413);
  }
  return { attachments: safeAttachments, skippedAttachmentChunks };
}

export function buildSupremeAttachmentText(attachments = []) {
  const blocks = [];
  for (const attachment of attachments) {
    if (attachment.kind !== 'document_context') continue;
    const chunks = (attachment.chunks || []).map((chunk) => [
      `<CHUNK index="${Number(chunk.chunkIndex || 0)}" title="${safeMetadata(chunk.title)}">`,
      safeAttachmentText(chunk.text),
      '</CHUNK>',
    ].join('\n'));
    blocks.push([
      `<ATTACHMENT_DATA file_id="${safeMetadata(attachment.fileId)}" file_name="${safeMetadata(attachment.fileName)}" file_type="${safeMetadata(attachment.fileType)}">`,
      attachment.profileText ? `<PROFILE>\n${safeAttachmentText(attachment.profileText)}\n</PROFILE>` : '',
      ...chunks,
      '</ATTACHMENT_DATA>',
    ].filter(Boolean).join('\n'));
  }
  return blocks.join('\n\n');
}
