export const CHAT_USER_MESSAGE_COLLAPSE_CHARS = 1500;
export const CHAT_USER_MESSAGE_COLLAPSE_LINES = 12;
export const CHAT_MESSAGE_PREVIEW_CHARS = 900;
export const CHAT_MESSAGE_PREVIEW_LINES = 8;
export const CHAT_LONG_PASTE_CHAR_THRESHOLD = 5000;

function normalizeText(value = '') {
  return String(value || '');
}

export function getLongTextLineCount(value = '') {
  const text = normalizeText(value);
  if (!text) return 0;
  return text.split(/\r\n|\r|\n/u).length;
}

export function getLongTextStats(value = '') {
  const text = normalizeText(value);
  const nonWhitespaceChars = text.replace(/\s+/gu, '').length;
  return {
    charCount: text.length,
    lineCount: getLongTextLineCount(text),
    estimatedTokens: text.trim()
      ? Math.max(1, Math.ceil(nonWhitespaceChars / 3.2))
      : 0,
  };
}

export function shouldCollapseUserMessage(value = '') {
  const stats = getLongTextStats(value);
  return stats.charCount > CHAT_USER_MESSAGE_COLLAPSE_CHARS
    || stats.lineCount > CHAT_USER_MESSAGE_COLLAPSE_LINES;
}

export function buildCollapsedMessagePreview(
  value = '',
  {
    maxChars = CHAT_MESSAGE_PREVIEW_CHARS,
    maxLines = CHAT_MESSAGE_PREVIEW_LINES,
  } = {},
) {
  const text = normalizeText(value);
  const lines = text.split(/\r\n|\r|\n/u);
  let preview = lines.slice(0, Math.max(1, Number(maxLines) || CHAT_MESSAGE_PREVIEW_LINES)).join('\n');
  const safeMaxChars = Math.max(1, Number(maxChars) || CHAT_MESSAGE_PREVIEW_CHARS);
  if (preview.length > safeMaxChars) {
    preview = preview.slice(0, safeMaxChars).trimEnd();
  }
  return preview.length < text.length ? `${preview}\n...` : preview;
}

function formatInteger(value) {
  try {
    return new Intl.NumberFormat('vi-VN').format(Number(value) || 0);
  } catch {
    return String(Number(value) || 0);
  }
}

export function formatLongTextStats(stats = {}) {
  const charCount = formatInteger(stats.charCount);
  const lineCount = formatInteger(stats.lineCount);
  const estimatedTokens = formatInteger(stats.estimatedTokens);
  return `${charCount} ký tự · ${lineCount} dòng · khoảng ${estimatedTokens} token`;
}

export function isLongComposerPaste(value = '') {
  return normalizeText(value).length >= CHAT_LONG_PASTE_CHAR_THRESHOLD;
}

export function buildChatTurnContent({ draft = '', pastedTexts = [], fallback = '' } = {}) {
  const parts = [
    normalizeText(draft).trim(),
    ...(pastedTexts || []).map((item) => normalizeText(item?.text || item)).filter((value) => value.length > 0),
  ].filter((value) => value.length > 0);
  return parts.length > 0 ? parts.join('\n\n') : normalizeText(fallback).trim();
}
