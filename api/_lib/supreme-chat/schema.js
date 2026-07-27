const OPERATIONS = new Set(['chat', 'attachment_chunk', 'attachment_merge']);
const MESSAGE_ROLES = new Set(['user', 'assistant']);
const TOP_LEVEL_FIELDS = new Set(['operation', 'route', 'messages', 'attachments']);
const ROUTE_FIELDS = new Set(['provider', 'proxyProfileId', 'model']);
const MESSAGE_FIELDS = new Set(['role', 'content']);
const IMAGE_FIELDS = new Set([
  'kind',
  'fileId',
  'fileName',
  'mimeType',
  'sizeBytes',
  'dataUrl',
  'turnOnly',
]);
const DOCUMENT_FIELDS = new Set([
  'kind',
  'fileId',
  'fileName',
  'fileType',
  'profileText',
  'chunks',
]);
const CHUNK_FIELDS = new Set(['chunkIndex', 'title', 'text']);
const DOCUMENT_FILE_TYPES = new Set(['txt', 'md', 'docx', 'epub', 'pdf']);
const MAX_MESSAGES = 60;
const MAX_MESSAGE_CHARS = 20000;
const MAX_TOTAL_TEXT_CHARS = 200000;
const MAX_MODEL_CHARS = 200;
const MAX_IMAGES = 4;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_IMAGE_CONTEXT_BYTES = 12 * 1024 * 1024;
const MAX_ATTACHMENT_TEXT_CHARS = 500000;
const MAX_DOCUMENT_ATTACHMENTS = 8;
const MAX_ATTACHMENT_CHUNKS = 256;
const MAX_ATTACHMENT_CHUNK_CHARS = 20000;

function schemaError(code = 'SUPREME_CHAT_REQUEST_INVALID') {
  const error = new Error(code);
  error.status = code === 'SUPREME_IMAGE_CONTEXT_TOO_LARGE' ? 413 : 422;
  error.code = code;
  return error;
}

function assertPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw schemaError();
}

function assertAllowedFields(value, allowedFields, code = 'SUPREME_CHAT_REQUEST_INVALID') {
  if (Object.keys(value).some((key) => !allowedFields.has(key))) throw schemaError(code);
}

function normalizeFileId(value) {
  const fileId = Number(value);
  if (!Number.isInteger(fileId) || fileId < 1) throw schemaError('SUPREME_ATTACHMENT_INVALID');
  return fileId;
}

function normalizeFileName(value) {
  const fileName = String(value || '').trim();
  if (!fileName || fileName.length > 240 || /[\u0000-\u001f\u007f]/u.test(fileName)) {
    throw schemaError('SUPREME_ATTACHMENT_INVALID');
  }
  return fileName;
}

function normalizeRoute(route) {
  assertPlainObject(route);
  assertAllowedFields(route, ROUTE_FIELDS);
  const provider = String(route.provider || '').trim();
  const model = String(route.model || '').trim();
  const proxyProfileId = String(route.proxyProfileId || '').trim();
  if (!model || model.length > MAX_MODEL_CHARS || /[\u0000-\u001f\u007f]/u.test(model)) {
    throw schemaError();
  }
  if (provider === 'openai_proxy') {
    if (proxyProfileId !== 'ag-gemini-proxy') throw schemaError('SUPREME_PROVIDER_UNSUPPORTED');
  } else if (provider === 'gemini_direct') {
    if (proxyProfileId) throw schemaError('SUPREME_PROVIDER_UNSUPPORTED');
  } else {
    throw schemaError('SUPREME_PROVIDER_UNSUPPORTED');
  }
  return { provider, model, ...(proxyProfileId ? { proxyProfileId } : {}) };
}

function normalizeMessages(messages) {
  if (!Array.isArray(messages) || messages.length < 1 || messages.length > MAX_MESSAGES) {
    throw schemaError();
  }
  let totalChars = 0;
  const normalized = messages.map((message) => {
    assertPlainObject(message);
    assertAllowedFields(message, MESSAGE_FIELDS);
    const role = String(message.role || '');
    const content = String(message.content ?? '');
    if (!MESSAGE_ROLES.has(role) || !content || content.length > MAX_MESSAGE_CHARS) {
      throw schemaError();
    }
    totalChars += content.length;
    return { role, content };
  });
  if (totalChars > MAX_TOTAL_TEXT_CHARS) throw schemaError();
  if (normalized.at(-1)?.role !== 'user') throw schemaError();
  return normalized;
}

function normalizeAttachments(attachments, route) {
  if (attachments === undefined) return [];
  if (!Array.isArray(attachments)) throw schemaError('SUPREME_ATTACHMENT_INVALID');
  let imageCount = 0;
  let imageBytes = 0;
  let documentCount = 0;
  let textChars = 0;
  const normalized = attachments.map((attachment) => {
    assertPlainObject(attachment);
    if (attachment.kind === 'image') {
      assertAllowedFields(attachment, IMAGE_FIELDS, 'SUPREME_ATTACHMENT_INVALID');
      imageCount += 1;
      const sizeBytes = Number(attachment.sizeBytes || 0);
      imageBytes += sizeBytes;
      if (
        !Number.isInteger(sizeBytes)
        || sizeBytes < 1
        || sizeBytes > MAX_IMAGE_BYTES
        || !['image/png', 'image/jpeg', 'image/webp'].includes(attachment.mimeType)
        || !String(attachment.dataUrl || '').startsWith(`data:${attachment.mimeType};base64,`)
      ) {
        throw schemaError('SUPREME_ATTACHMENT_INVALID');
      }
      return {
        kind: 'image',
        fileId: normalizeFileId(attachment.fileId),
        fileName: normalizeFileName(attachment.fileName),
        mimeType: attachment.mimeType,
        sizeBytes,
        dataUrl: attachment.dataUrl,
        turnOnly: attachment.turnOnly === true,
      };
    }
    if (attachment.kind !== 'document_context') throw schemaError('SUPREME_ATTACHMENT_INVALID');
    documentCount += 1;
    if (documentCount > MAX_DOCUMENT_ATTACHMENTS) {
      throw schemaError('SUPREME_ATTACHMENT_INVALID');
    }
    assertAllowedFields(attachment, DOCUMENT_FIELDS, 'SUPREME_ATTACHMENT_INVALID');
    const fileType = String(attachment.fileType || '').toLowerCase();
    if (!DOCUMENT_FILE_TYPES.has(fileType)) throw schemaError('SUPREME_ATTACHMENT_INVALID');
    const fileName = normalizeFileName(attachment.fileName);
    if (!fileName.toLowerCase().endsWith(`.${fileType}`)) {
      throw schemaError('SUPREME_ATTACHMENT_INVALID');
    }
    const profileText = String(attachment.profileText || '');
    if (
      !Array.isArray(attachment.chunks)
      || attachment.chunks.length > MAX_ATTACHMENT_CHUNKS
      || (!profileText && attachment.chunks.length < 1)
    ) {
      throw schemaError('SUPREME_ATTACHMENT_INVALID');
    }
    const chunks = attachment.chunks.map((chunk) => {
      assertPlainObject(chunk);
      assertAllowedFields(chunk, CHUNK_FIELDS, 'SUPREME_ATTACHMENT_INVALID');
      const chunkIndex = Number(chunk.chunkIndex);
      const title = String(chunk.title || '');
      const text = String(chunk.text || '');
      if (
        !Number.isInteger(chunkIndex)
        || chunkIndex < 0
        || chunkIndex > 1_000_000
        || title.length > 500
        || !text
        || text.length > MAX_ATTACHMENT_CHUNK_CHARS
      ) {
        throw schemaError('SUPREME_ATTACHMENT_INVALID');
      }
      textChars += title.length + text.length;
      return {
        chunkIndex,
        title,
        text,
      };
    });
    textChars += profileText.length;
    return {
      kind: 'document_context',
      fileId: normalizeFileId(attachment.fileId),
      fileName,
      fileType,
      profileText,
      chunks,
    };
  });
  if (imageCount > MAX_IMAGES || imageBytes > MAX_IMAGE_CONTEXT_BYTES) {
    throw schemaError('SUPREME_IMAGE_CONTEXT_TOO_LARGE');
  }
  if (imageCount > 0 && route.provider !== 'openai_proxy') {
    throw schemaError('SUPREME_IMAGE_PROVIDER_UNSUPPORTED');
  }
  if (textChars > MAX_ATTACHMENT_TEXT_CHARS) throw schemaError('SUPREME_ATTACHMENT_INVALID');
  return normalized;
}

function validateOperationAttachments(operation, attachments) {
  if (operation === 'chat') return;
  if (
    attachments.length !== 1
    || attachments[0]?.kind !== 'document_context'
  ) {
    throw schemaError('SUPREME_ATTACHMENT_INVALID');
  }
  const chunkCount = attachments[0].chunks.length;
  if (
    (operation === 'attachment_chunk' && chunkCount !== 1)
    || (operation === 'attachment_merge' && chunkCount < 1)
  ) {
    throw schemaError('SUPREME_ATTACHMENT_INVALID');
  }
}

export function validateSupremeChatRequest(input) {
  assertPlainObject(input);
  if (Object.keys(input).some((key) => !TOP_LEVEL_FIELDS.has(key))) throw schemaError();
  const operation = String(input.operation || '');
  if (!OPERATIONS.has(operation)) throw schemaError();
  const route = normalizeRoute(input.route);
  const messages = normalizeMessages(input.messages);
  const attachments = normalizeAttachments(input.attachments, route);
  validateOperationAttachments(operation, attachments);
  return { operation, route, messages, attachments };
}

export const SUPREME_CHAT_LIMITS = Object.freeze({
  MAX_MESSAGES,
  MAX_MESSAGE_CHARS,
  MAX_TOTAL_TEXT_CHARS,
  MAX_MODEL_CHARS,
  MAX_IMAGES,
  MAX_IMAGE_BYTES,
  MAX_IMAGE_CONTEXT_BYTES,
  MAX_ATTACHMENT_TEXT_CHARS,
  MAX_DOCUMENT_ATTACHMENTS,
  MAX_ATTACHMENT_CHUNKS,
  MAX_ATTACHMENT_CHUNK_CHARS,
});
