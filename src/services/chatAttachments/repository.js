import db from '../db/database.js';
import {
  CHAT_ATTACHMENT_SCOPES,
  CHAT_ATTACHMENT_STATUSES,
} from './fileSafety.js';

function now() {
  return Date.now();
}

function normalizeId(value) {
  const id = Number(value);
  return Number.isFinite(id) && id > 0 ? id : null;
}

function normalizeAttachmentInput(attachment = {}) {
  const timestamp = now();
  return {
    project_id: Number(attachment.project_id || 0),
    thread_id: normalizeId(attachment.thread_id),
    scope: attachment.scope === CHAT_ATTACHMENT_SCOPES.PROJECT
      ? CHAT_ATTACHMENT_SCOPES.PROJECT
      : CHAT_ATTACHMENT_SCOPES.THREAD,
    file_name: String(attachment.file_name || attachment.fileName || 'Tệp đính kèm').trim(),
    file_type: String(attachment.file_type || attachment.fileType || '').trim(),
    mime_type: String(attachment.mime_type || attachment.mimeType || '').trim(),
    size_bytes: Number(attachment.size_bytes || attachment.sizeBytes || 0),
    status: attachment.status || CHAT_ATTACHMENT_STATUSES.INDEXED,
    turn_only: Boolean(attachment.turn_only),
    error_message: attachment.error_message || '',
    chunk_count: Number(attachment.chunk_count || 0),
    profile_text: attachment.profile_text || '',
    read_at: attachment.read_at || null,
    created_at: attachment.created_at || timestamp,
    updated_at: attachment.updated_at || timestamp,
  };
}

function normalizeChunkInput(chunk = {}, attachmentId) {
  return {
    attachment_id: Number(attachmentId),
    chunk_index: Number(chunk.chunk_index || 0),
    title: String(chunk.title || '').trim(),
    text: String(chunk.text || ''),
    start_offset: Number(chunk.start_offset || 0),
    end_offset: Number(chunk.end_offset || 0),
    estimated_tokens: Number(chunk.estimated_tokens || 0),
    ai_notes: String(chunk.ai_notes || ''),
    created_at: chunk.created_at || now(),
  };
}

async function deleteAttachmentRows(attachmentIds = []) {
  const ids = attachmentIds.map(normalizeId).filter(Boolean);
  if (ids.length === 0) return;

  await Promise.all([
    db.ai_chat_attachment_chunks.where('attachment_id').anyOf(ids).delete(),
    db.ai_chat_message_attachments.where('attachment_id').anyOf(ids).delete(),
    db.ai_chat_attachments.bulkDelete(ids),
  ]);
}

export async function saveChatAttachmentWithChunks({ attachment = {}, chunks = [] } = {}) {
  const normalizedAttachment = normalizeAttachmentInput({
    ...attachment,
    chunk_count: chunks.length,
  });

  const attachmentId = await db.ai_chat_attachments.add(normalizedAttachment);
  const chunkRows = (chunks || []).map((chunk, index) => normalizeChunkInput({
    ...chunk,
    chunk_index: Number.isFinite(Number(chunk.chunk_index)) ? Number(chunk.chunk_index) : index,
  }, attachmentId));

  if (chunkRows.length > 0) {
    await db.ai_chat_attachment_chunks.bulkAdd(chunkRows);
  }

  return db.ai_chat_attachments.get(attachmentId);
}

export async function updateChatAttachment(attachmentId, patch = {}) {
  const id = normalizeId(attachmentId);
  if (!id) return 0;
  return db.ai_chat_attachments.update(id, {
    ...patch,
    updated_at: now(),
  });
}

export async function replaceChatAttachmentChunks(attachmentId, chunks = []) {
  const id = normalizeId(attachmentId);
  if (!id) return [];

  await db.ai_chat_attachment_chunks.where('attachment_id').equals(id).delete();
  const rows = (chunks || []).map((chunk, index) => normalizeChunkInput({
    ...chunk,
    chunk_index: Number.isFinite(Number(chunk.chunk_index)) ? Number(chunk.chunk_index) : index,
  }, id));

  if (rows.length > 0) {
    await db.ai_chat_attachment_chunks.bulkAdd(rows);
  }

  await updateChatAttachment(id, { chunk_count: rows.length });
  return getChatAttachmentChunks(id);
}

export async function updateChatAttachmentChunk(chunkId, patch = {}) {
  const id = normalizeId(chunkId);
  if (!id) return 0;
  return db.ai_chat_attachment_chunks.update(id, patch);
}

export async function getChatAttachmentChunks(attachmentId) {
  const id = normalizeId(attachmentId);
  if (!id) return [];
  return db.ai_chat_attachment_chunks
    .where('attachment_id')
    .equals(id)
    .sortBy('chunk_index');
}

export async function listChatAttachmentsForThread(threadId) {
  const id = normalizeId(threadId);
  if (!id) return [];
  return db.ai_chat_attachments
    .where('thread_id')
    .equals(id)
    .sortBy('updated_at');
}

export async function listChatAttachmentsForProject(projectId) {
  const id = Number(projectId || 0);
  return db.ai_chat_attachments
    .where('project_id')
    .equals(id)
    .filter((attachment) => attachment.scope === CHAT_ATTACHMENT_SCOPES.PROJECT)
    .toArray();
}

export async function linkMessageAttachments({ messageId, attachmentIds = [] } = {}) {
  const normalizedMessageId = normalizeId(messageId);
  const ids = attachmentIds.map(normalizeId).filter(Boolean);
  if (!normalizedMessageId || ids.length === 0) return [];

  const rows = ids.map((attachmentId, index) => ({
    message_id: normalizedMessageId,
    attachment_id: attachmentId,
    order_index: index,
    created_at: now(),
  }));
  await db.ai_chat_message_attachments.bulkAdd(rows);
  return rows;
}

export async function listMessageAttachmentSummaries(messageId) {
  const normalizedMessageId = normalizeId(messageId);
  if (!normalizedMessageId) return [];

  const links = await db.ai_chat_message_attachments
    .where('message_id')
    .equals(normalizedMessageId)
    .sortBy('order_index');
  const ids = links.map((link) => normalizeId(link.attachment_id)).filter(Boolean);
  if (ids.length === 0) return [];

  const attachments = await db.ai_chat_attachments.where('id').anyOf(ids).toArray();
  const byId = new Map(attachments.map((attachment) => [Number(attachment.id), attachment]));
  return links
    .map((link) => byId.get(Number(link.attachment_id)))
    .filter(Boolean);
}

export async function hydrateMessagesWithAttachmentSummaries(messages = []) {
  const hydrated = [];
  for (const message of messages || []) {
    const attachments = await listMessageAttachmentSummaries(message.id);
    hydrated.push(attachments.length > 0 ? { ...message, attachments } : message);
  }
  return hydrated;
}

export async function deleteChatThreadAttachmentData(threadId) {
  const id = normalizeId(threadId);
  if (!id) return;
  const attachments = await db.ai_chat_attachments.where('thread_id').equals(id).toArray();
  await deleteAttachmentRows(attachments.map((attachment) => attachment.id));
}

export async function deleteChatProjectAttachmentData(projectId) {
  const id = Number(projectId || 0);
  const attachments = await db.ai_chat_attachments.where('project_id').equals(id).toArray();
  await deleteAttachmentRows(attachments.map((attachment) => attachment.id));
}

export async function deleteChatAttachment(attachmentId) {
  await deleteAttachmentRows([attachmentId]);
}
