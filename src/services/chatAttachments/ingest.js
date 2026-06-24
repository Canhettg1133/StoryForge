import {
  CHAT_ATTACHMENT_SCOPES,
  CHAT_ATTACHMENT_STATUSES,
  validateChatAttachmentFile,
} from './fileSafety.js';
import { parseChatAttachmentFile } from './parser.js';
import { buildChatAttachmentChunks } from './chunker.js';
import {
  replaceChatAttachmentChunks,
  saveChatAttachmentWithChunks,
  updateChatAttachment,
} from './repository.js';
import db from '../db/database.js';

function normalizeScope(scope) {
  return scope === CHAT_ATTACHMENT_SCOPES.PROJECT
    ? CHAT_ATTACHMENT_SCOPES.PROJECT
    : CHAT_ATTACHMENT_SCOPES.THREAD;
}

function bytesToBase64(bytes) {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64');
  }
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.slice(offset, offset + chunkSize));
  }
  return btoa(binary);
}

async function fileToDataUrl(file, mimeType) {
  if (typeof FileReader !== 'undefined' && file instanceof Blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(reader.error || new Error('Không thể đọc dữ liệu ảnh.'));
      reader.readAsDataURL(file);
    });
  }

  const buffer = file?.buffer
    ? file.buffer.buffer.slice(file.buffer.byteOffset, file.buffer.byteOffset + file.buffer.byteLength)
    : await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  return `data:${mimeType};base64,${bytesToBase64(bytes)}`;
}

export async function ingestChatAttachmentFile({
  file,
  projectId = 0,
  threadId = null,
  scope = CHAT_ATTACHMENT_SCOPES.THREAD,
  turnOnly = false,
  parsePdfFile,
} = {}) {
  const safety = await validateChatAttachmentFile(file);
  if (!safety.ok) {
    const error = new Error(safety.message);
    error.code = safety.code;
    throw error;
  }

  const normalizedScope = normalizeScope(scope);
  if (safety.fileType === 'image') {
    const dataUrl = await fileToDataUrl(file, safety.mimeType);
    return saveChatAttachmentWithChunks({
      attachment: {
        project_id: Number(projectId || 0),
        thread_id: Number(threadId || 0) || null,
        scope: normalizedScope,
        file_name: file.name || file.originalname || 'Ảnh đính kèm',
        file_type: safety.fileType,
        mime_type: safety.mimeType,
        size_bytes: safety.size,
        status: CHAT_ATTACHMENT_STATUSES.INDEXED,
        turn_only: Boolean(turnOnly),
        data_url: dataUrl,
      },
      chunks: [],
    });
  }

  const initial = await saveChatAttachmentWithChunks({
    attachment: {
      project_id: Number(projectId || 0),
      thread_id: Number(threadId || 0) || null,
      scope: normalizedScope,
      file_name: file.name || file.originalname || 'Tệp đính kèm',
      file_type: safety.fileType,
      mime_type: safety.mimeType,
      size_bytes: safety.size,
      status: CHAT_ATTACHMENT_STATUSES.EXTRACTING,
      turn_only: Boolean(turnOnly),
    },
    chunks: [],
  });

  try {
    const parsed = await parseChatAttachmentFile(file, { parsePdfFile });
    const chunks = buildChatAttachmentChunks({
      attachmentId: initial.id,
      text: parsed.rawText,
      fileName: parsed.sourceFileName,
    });
    await replaceChatAttachmentChunks(initial.id, chunks);
    await updateChatAttachment(initial.id, {
      file_name: parsed.sourceFileName || file.name || 'Tệp đính kèm',
      file_type: parsed.fileType || safety.fileType,
      status: CHAT_ATTACHMENT_STATUSES.INDEXED,
      error_message: '',
    });
    return db.ai_chat_attachments.get(initial.id);
  } catch (error) {
    await updateChatAttachment(initial.id, {
      status: CHAT_ATTACHMENT_STATUSES.FAILED,
      error_message: error?.message || 'Không thể đọc tệp đính kèm.',
    });
    throw error;
  }
}
