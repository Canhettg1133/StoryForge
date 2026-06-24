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
