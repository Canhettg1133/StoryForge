import { isChatImageAttachment } from './promptBuilder.js';

const MAX_MESSAGES = 60;
const MAX_MESSAGE_CHARS = 20000;
const MAX_TOTAL_TEXT_CHARS = 200000;

function cleanText(value = '') {
  return String(value || '').trim();
}

function normalizeDocumentContext({ attachment = {}, chunks = [], profileText } = {}) {
  return {
    kind: 'document_context',
    fileId: Number(attachment.id || 0),
    fileName: cleanText(attachment.file_name || attachment.fileName),
    fileType: cleanText(attachment.file_type || attachment.fileType),
    profileText: cleanText(profileText ?? attachment.profile_text),
    chunks: (chunks || [])
      .map((chunk, index) => ({
        chunkIndex: Number(chunk.chunk_index ?? chunk.chunkIndex ?? index),
        title: cleanText(chunk.title),
        text: cleanText(chunk.text),
      }))
      .filter((chunk) => chunk.text),
  };
}

function normalizeImage(attachment = {}) {
  return {
    kind: 'image',
    fileId: Number(attachment.id || 0),
    fileName: cleanText(attachment.file_name || attachment.fileName),
    mimeType: cleanText(attachment.mime_type || attachment.mimeType),
    sizeBytes: Number(attachment.size_bytes || attachment.sizeBytes || 0),
    dataUrl: cleanText(attachment.data_url || attachment.dataUrl),
    turnOnly: attachment.turn_only === true || attachment.turnOnly === true,
  };
}

function getLatestReusableImages(historyMessages = []) {
  for (let index = historyMessages.length - 1; index >= 0; index -= 1) {
    const message = historyMessages[index];
    if (message?.role !== 'user') continue;
    const images = (message.attachments || []).filter(
      (attachment) =>
        isChatImageAttachment(attachment)
        && attachment.turn_only !== true
        && attachment.turnOnly !== true
        && Boolean(attachment.data_url || attachment.dataUrl),
    );
    if (images.length > 0) return images;
  }
  return [];
}

export function buildSupremeMessages({
  historyMessages = [],
  userText = '',
} = {}) {
  const currentUserText = cleanText(userText);
  if (!currentUserText || currentUserText.length > MAX_MESSAGE_CHARS) {
    throw new Error('Tin nhắn Tối Thượng phải có từ 1 đến 20.000 ký tự.');
  }
  let remainingChars = MAX_TOTAL_TEXT_CHARS - currentUserText.length;
  const selectedHistory = [];
  const candidates = (historyMessages || [])
    .filter((message) => message?.role === 'user' || message?.role === 'assistant');
  for (
    let index = candidates.length - 1;
    index >= 0 && selectedHistory.length < MAX_MESSAGES - 1;
    index -= 1
  ) {
    const content = cleanText(candidates[index].content);
    if (!content || content.length > MAX_MESSAGE_CHARS || content.length > remainingChars) continue;
    selectedHistory.unshift({
      role: candidates[index].role,
      content,
    });
    remainingChars -= content.length;
  }
  return [
    ...selectedHistory,
    {
      role: 'user',
      content: currentUserText,
    },
  ];
}

export function buildSupremeAttachmentPayload({
  attachmentContexts = [],
  currentImageAttachments = [],
  historyMessages = [],
} = {}) {
  const documents = (attachmentContexts || [])
    .map((context) => normalizeDocumentContext(context))
    .filter((attachment) => attachment.profileText || attachment.chunks.length > 0);
  const currentImages = (currentImageAttachments || []).filter(isChatImageAttachment);
  const selectedImages = currentImages.length > 0
    ? currentImages
    : getLatestReusableImages(historyMessages);

  return [
    ...documents,
    ...selectedImages.map(normalizeImage),
  ];
}

export function buildSupremeFullReadAttachment({
  attachment,
  chunks = [],
  profileText = '',
} = {}) {
  return normalizeDocumentContext({ attachment, chunks, profileText });
}
