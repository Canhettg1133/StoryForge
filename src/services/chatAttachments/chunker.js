export const CHAT_ATTACHMENT_CHUNK_TARGET_CHARS = 6000;
export const CHAT_ATTACHMENT_RETRIEVAL_CHUNKS = 8;

function normalizeText(text = '') {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/\t/g, ' ')
    .replace(/[ ]{2,}/g, ' ')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();
}

function estimateTokens(text = '') {
  return Math.max(1, Math.ceil(String(text || '').length / 4));
}

function findCutPoint(text, target) {
  if (text.length <= target) return text.length;
  const min = Math.max(1, Math.floor(target * 0.62));
  const max = Math.min(text.length, Math.floor(target * 1.22));
  const boundaries = [
    /\n\s*\n+/g,
    /\n+/g,
    /[.!?。！？…]+["')\]]?\s+/g,
    /\s+/g,
  ];

  for (const boundary of boundaries) {
    let bestBefore = -1;
    let firstAfter = -1;
    const regex = new RegExp(boundary.source, boundary.flags.includes('g') ? boundary.flags : `${boundary.flags}g`);
    let match;
    while ((match = regex.exec(text)) !== null) {
      const end = match.index + match[0].length;
      if (end >= min && end <= target) bestBefore = end;
      if (firstAfter < 0 && end > target && end <= max) firstAfter = end;
      if (end > max) break;
      if (match[0].length === 0) regex.lastIndex += 1;
    }
    if (bestBefore > 0) return bestBefore;
    if (firstAfter > 0) return firstAfter;
  }

  return target;
}

function tokenizeQuery(text = '') {
  return Array.from(new Set(
    String(text || '')
      .normalize('NFC')
      .toLowerCase()
      .split(/[^\p{L}\p{N}_]+/u)
      .map((item) => item.trim())
      .filter((item) => item.length >= 2),
  ));
}

function scoreChunk(queryTokens, chunk) {
  const text = String(chunk?.text || '').toLowerCase();
  if (!text || queryTokens.length === 0) return 0;
  return queryTokens.reduce((score, token) => (
    text.includes(token) ? score + Math.min(4, token.length) : score
  ), 0);
}

export function buildChatAttachmentChunks({
  attachmentId = null,
  text = '',
  fileName = '',
  chunkSize = CHAT_ATTACHMENT_CHUNK_TARGET_CHARS,
} = {}) {
  const source = normalizeText(text);
  const safeChunkSize = Math.max(40, Number(chunkSize) || CHAT_ATTACHMENT_CHUNK_TARGET_CHARS);
  const chunks = [];
  let cursor = 0;

  while (cursor < source.length) {
    const remaining = source.slice(cursor);
    const cut = findCutPoint(remaining, safeChunkSize);
    const chunkText = normalizeText(remaining.slice(0, cut));
    if (chunkText) {
      chunks.push({
        attachment_id: attachmentId,
        chunk_index: chunks.length,
        title: `${fileName || 'Tệp'} · đoạn ${chunks.length + 1}`,
        text: chunkText,
        start_offset: cursor,
        end_offset: cursor + cut,
        estimated_tokens: estimateTokens(chunkText),
      });
    }
    cursor += Math.max(1, cut);
  }

  return chunks;
}

export function selectRelevantAttachmentChunks({
  query = '',
  chunks = [],
  maxChunks = CHAT_ATTACHMENT_RETRIEVAL_CHUNKS,
} = {}) {
  const safeMax = Math.max(1, Number(maxChunks) || CHAT_ATTACHMENT_RETRIEVAL_CHUNKS);
  const queryTokens = tokenizeQuery(query);
  const scored = (chunks || [])
    .map((chunk) => ({
      chunk,
      score: scoreChunk(queryTokens, chunk),
    }))
    .filter((item) => item.chunk?.text);

  const selected = scored
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return Number(a.chunk.chunk_index || 0) - Number(b.chunk.chunk_index || 0);
    })
    .slice(0, safeMax)
    .map((item) => item.chunk)
    .sort((a, b) => Number(a.chunk_index || 0) - Number(b.chunk_index || 0));

  return selected.length > 0
    ? selected
    : (chunks || []).filter((chunk) => chunk?.text).slice(0, safeMax);
}

export function buildChunkCitation(chunk = {}, attachment = {}) {
  const fileName = attachment.file_name || attachment.fileName || 'Tệp đính kèm';
  const index = Number(chunk.chunk_index || 0) + 1;
  const title = chunk.title ? ` · ${chunk.title}` : '';
  return `${fileName} · đoạn ${index}${title}`;
}
