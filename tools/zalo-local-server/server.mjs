import express from 'express';
import sharp from 'sharp';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const DEFAULT_PORT = 11452;
const DEFAULT_DELAY_MS = 12000;
const COMMAND_TIMEOUT_MS = 45000;
const RECEIPT_WIDTH = 916;
const RECEIPT_HEIGHT = 2047;
const DEFAULT_RECEIPTS_DIR = path.join(repoRoot, 'data', 'zalo-receipts');
const DEFAULT_ZALO_WEB_PROFILE_DIR = path.join(repoRoot, 'data', 'zalo-web-profile');
const ZALO_DEMO_HEADER_PATH = path.join(__dirname, 'assets', 'zalo-mobile-demo-header.png');
const ZALO_GROUP_PREVIEW_PATH = path.join(__dirname, 'assets', 'zalo-group-preview-reference.png');
const ZALO_GROUP_AVATAR_PATH = path.join(__dirname, 'assets', 'zalo-group-avatar-reference.jpg');
const ZALO_DEMO_INPUT_BAR_PATH = path.join(__dirname, 'assets', 'zalo-mobile-demo-input-bar.png');
const ZALO_DEMO_HEART_PATH = path.join(__dirname, 'assets', 'zalo-mobile-demo-heart.png');
const ZALO_DEMO_SHARE_PATH = path.join(__dirname, 'assets', 'zalo-mobile-demo-share.png');
const ZALO_DEMO_SENT_STATUS_PATH = path.join(__dirname, 'assets', 'zalo-mobile-demo-sent-status.png');
const ZALO_DEMO_YELLOW_HAND_PATH = path.join(__dirname, 'assets', 'zalo-demo-yellow-hand.png');

const VN_MOBILE_PREFIXES = [
  '032', '033', '034', '035', '036', '037', '038', '039', '086', '096', '097', '098',
  '070', '076', '077', '078', '079', '089', '090', '093',
  '081', '082', '083', '084', '085', '088', '091', '094',
  '052', '056', '058', '059', '055',
];

export function normalizeVietnameseMobilePhone(value) {
  const clean = String(value || '').replace(/[^0-9+]/g, '');
  let normalized = clean;

  if (clean.startsWith('+84')) {
    normalized = `0${clean.slice(3)}`;
  } else if (clean.startsWith('84') && clean.length > 9) {
    normalized = `0${clean.slice(2)}`;
  }

  if (normalized.length !== 10 || !normalized.startsWith('0')) {
    return '';
  }

  return VN_MOBILE_PREFIXES.includes(normalized.slice(0, 3)) ? normalized : '';
}

export function parseOpenZcaJson(output) {
  const text = String(output || '').trim();
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {}

  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    try {
      return JSON.parse(lines[i]);
    } catch {}
  }

  const starts = [text.indexOf('{'), text.indexOf('[')].filter((index) => index >= 0);
  const start = starts.length > 0 ? Math.min(...starts) : -1;
  const end = Math.max(text.lastIndexOf('}'), text.lastIndexOf(']'));
  if (start >= 0 && end > start) {
    return JSON.parse(text.slice(start, end + 1));
  }

  throw new Error('OpenZCA không trả JSON hợp lệ.');
}

function getCandidateId(candidate) {
  return String(
    candidate?.userId ??
    candidate?.uid ??
    candidate?.id ??
    candidate?.threadId ??
    candidate?.zaloId ??
    '',
  ).trim();
}

function isCandidateLike(value) {
  return value && typeof value === 'object' && !Array.isArray(value) && getCandidateId(value);
}

function collectCandidates(value, output = [], seen = new Set()) {
  if (!value) return output;

  if (Array.isArray(value)) {
    value.forEach((item) => collectCandidates(item, output, seen));
    return output;
  }

  if (typeof value !== 'object') return output;

  if (isCandidateLike(value)) {
    const id = getCandidateId(value);
    if (!seen.has(id)) {
      seen.add(id);
      output.push(value);
    }
  }

  const preferredKeys = ['users', 'friends', 'results', 'items', 'data', 'list', 'rows'];
  for (const key of preferredKeys) {
    if (Object.prototype.hasOwnProperty.call(value, key)) {
      collectCandidates(value[key], output, seen);
    }
  }

  return output;
}

function candidateMatchesPhone(candidate, targetPhone) {
  const possibleValues = [
    candidate?.phone,
    candidate?.phoneNumber,
    candidate?.mobile,
    candidate?.username,
    candidate?.account,
    candidate?.zaloName,
  ];
  const targetDigits = String(targetPhone || '').replace(/\D/g, '');
  const countryDigits = targetDigits.startsWith('0') ? `84${targetDigits.slice(1)}` : targetDigits;

  return possibleValues.some((value) => {
    const digits = String(value || '').replace(/\D/g, '');
    return digits && (digits === targetDigits || digits === countryDigits);
  });
}

function normalizeReceiptMessageText(value) {
  return String(value || '')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function recentMessagesContainText(payload, expectedMessage) {
  const expected = normalizeReceiptMessageText(expectedMessage);
  if (!expected) return false;
  const messages = Array.isArray(payload?.messages) ? payload.messages : [];
  return messages.some((message) => normalizeReceiptMessageText(message?.content) === expected);
}

function getCandidateDisplayName(candidate) {
  return String(
    candidate?.displayName ??
    candidate?.dName ??
    candidate?.name ??
    candidate?.zaloName ??
    candidate?.username ??
    '',
  ).trim();
}

export function selectSingleOpenZcaUser(payload, queryPhone) {
  const targetPhone = normalizeVietnameseMobilePhone(queryPhone);
  if (!targetPhone) {
    throw new Error('Số điện thoại không hợp lệ hoặc không phải số di động Việt Nam.');
  }

  const candidates = collectCandidates(payload).filter((candidate) => getCandidateId(candidate));
  if (candidates.length === 0) {
    throw new Error(`Không tìm thấy user Zalo cho số ${targetPhone}.`);
  }

  const exactPhoneMatches = candidates.filter((candidate) => candidateMatchesPhone(candidate, targetPhone));
  const pool = exactPhoneMatches.length > 0 ? exactPhoneMatches : candidates;

  if (pool.length > 1) {
    throw new Error(`Tìm thấy nhiều user Zalo cho số ${targetPhone}, đã dừng để tránh gửi nhầm.`);
  }

  return {
    userId: getCandidateId(pool[0]),
    raw: pool[0],
    matchedBy: exactPhoneMatches.length === 1 ? 'phone-field' : 'single-result',
  };
}

function resolveOpenZcaCommand(cwd = repoRoot) {
  if (process.env.OPENZCA_BIN) {
    return { file: process.env.OPENZCA_BIN, prefixArgs: [] };
  }

  const cliPath = path.join(cwd, 'node_modules', 'openzca', 'dist', 'cli.js');
  if (fs.existsSync(cliPath)) {
    return { file: process.execPath, prefixArgs: [cliPath] };
  }

  const binName = process.platform === 'win32' ? 'openzca.cmd' : 'openzca';
  return { file: path.join(cwd, 'node_modules', '.bin', binName), prefixArgs: [] };
}

function formatCommandError(error) {
  const stderr = String(error?.stderr || '').trim();
  const stdout = String(error?.stdout || '').trim();
  const message = String(error?.message || '').trim();
  return stderr || stdout || message || 'OpenZCA command failed.';
}

function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function safeFilePart(value) {
  const safe = String(value || '')
    .normalize('NFKD')
    .replace(/[^\w.-]+/g, '_')
    .replace(/_{2,}/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/\.\.+/g, '.')
    .slice(0, 80);
  return safe || 'lead';
}

function formatReceiptDateFolder(date) {
  return date.toISOString().slice(0, 10);
}

function formatReceiptTime(date) {
  return new Intl.DateTimeFormat('vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date);
}

function wrapText(value, maxChars = 34, maxLines = 28) {
  const paragraphs = String(value || '').split(/\r?\n/);
  const lines = [];

  for (const paragraph of paragraphs) {
    const words = paragraph.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      lines.push('');
      continue;
    }

    let line = '';
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (next.length <= maxChars) {
        line = next;
        continue;
      }

      if (line) lines.push(line);
      if (word.length <= maxChars) {
        line = word;
      } else {
        for (let index = 0; index < word.length; index += maxChars) {
          lines.push(word.slice(index, index + maxChars));
        }
        line = '';
      }

      if (lines.length >= maxLines) break;
    }
    if (line && lines.length < maxLines) lines.push(line);
    if (lines.length >= maxLines) break;
  }

  if (lines.length > maxLines) lines.length = maxLines;
  if (lines.length === maxLines && lines[maxLines - 1].length > 3) {
    lines[maxLines - 1] = `${lines[maxLines - 1].slice(0, -3)}...`;
  }
  return lines;
}

function formatDemoClockTime(date) {
  return new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

function extractZaloGroupLink(message) {
  const match = String(message || '').match(/https?:\/\/zalo\.me\/g\/[^\s]+/i);
  return match ? match[0] : '';
}

function buildMessagePlainTextContent(line, baseFill) {
  const emojiColors = {
    '🌿': '#58a91f',
    '✨': '#facc15',
  };
  const parts = [];
  let textBuffer = '';

  for (const char of Array.from(line)) {
    if (emojiColors[char]) {
      if (textBuffer) {
        parts.push(`<tspan fill="${baseFill}">${escapeXml(textBuffer)}</tspan>`);
        textBuffer = '';
      }
      parts.push(`<tspan fill="${emojiColors[char]}">${escapeXml(char)}</tspan>`);
    } else {
      textBuffer += char;
    }
  }

  if (textBuffer) {
    parts.push(`<tspan fill="${baseFill}">${escapeXml(textBuffer)}</tspan>`);
  }
  return parts.join('');
}

function isYellowHandEmoji(char) {
  return char === '🫶' || char === '🤝' || char === '🙏';
}

function estimateReceiptTextWidth(text, fontSize) {
  return Array.from(String(text || '')).reduce((width, char) => {
    if (/\s/.test(char)) return width + fontSize * 0.28;
    if (/[\u0000-\u007f]/.test(char)) return width + fontSize * 0.5;
    return width + fontSize * 0.58;
  }, 0);
}

function getZaloDemoYellowHandImageSvg({ x, y, width = 66, height = 59 }) {
  try {
    const base64 = fs.readFileSync(ZALO_DEMO_YELLOW_HAND_PATH).toString('base64');
    return `<image data-demo-yellow-hand="bitmap" x="${x}" y="${y}" width="${width}" height="${height}" preserveAspectRatio="xMidYMid meet" href="data:image/png;base64,${base64}"/>`;
  } catch {
    return `<text data-demo-yellow-hand="fallback" x="${x}" y="${y + height - 9}" fill="#f7bf14" font-family="Arial, sans-serif" font-size="${height}" font-weight="800">♡</text>`;
  }
}

function buildMessageLineContent(line, baseFill) {
  const parts = [];
  const urlPattern = /https?:\/\/[^\s]+/gi;
  let cursor = 0;
  let match;

  while ((match = urlPattern.exec(line)) !== null) {
    if (match.index > cursor) {
      parts.push(buildMessagePlainTextContent(line.slice(cursor, match.index), baseFill));
    }
    parts.push(`<tspan data-demo-link-text="true" fill="#0068d9" text-decoration="underline">${escapeXml(match[0])}</tspan>`);
    cursor = match.index + match[0].length;
  }

  if (cursor < line.length) {
    parts.push(buildMessagePlainTextContent(line.slice(cursor), baseFill));
  }

  return parts.join('');
}

function buildMessageTextLine(line, { x, y, fill, fontSize, weight }) {
  if (!Array.from(line).some(isYellowHandEmoji)) {
    return `<text x="${x}" y="${y}" fill="${fill}" font-family="Arial, sans-serif" font-size="${fontSize}" font-weight="${weight}">${buildMessageLineContent(line, fill)}</text>`;
  }

  const parts = [];
  let cursorX = x;
  let textBuffer = '';

  for (const char of Array.from(line)) {
    if (!isYellowHandEmoji(char)) {
      textBuffer += char;
      continue;
    }

    if (textBuffer) {
      parts.push(`<text x="${cursorX}" y="${y}" fill="${fill}" font-family="Arial, sans-serif" font-size="${fontSize}" font-weight="${weight}">${buildMessageLineContent(textBuffer, fill)}</text>`);
      cursorX += estimateReceiptTextWidth(textBuffer, fontSize);
      textBuffer = '';
    }

    parts.push(getZaloDemoYellowHandImageSvg({
      x: Math.round(cursorX),
      y: Math.round(y - fontSize - 8),
    }));
    cursorX += 64;
  }

  if (textBuffer) {
    parts.push(`<text x="${cursorX}" y="${y}" fill="${fill}" font-family="Arial, sans-serif" font-size="${fontSize}" font-weight="${weight}">${buildMessageLineContent(textBuffer, fill)}</text>`);
  }

  return `<g data-demo-yellow-hand-line="true">${parts.join('')}</g>`;
}

function buildMessageTextLines(lines, { x, y, lineHeight, fill, fontSize, weight = 400 }) {
  return lines.map((line, index) => {
    const lineY = y + index * lineHeight;
    const linkLineMarker = /https?:\/\/[^\s]+/i.test(line) ? ` data-demo-link-line-y="${Math.round(lineY)}"` : '';
    return `<g${linkLineMarker}>${buildMessageTextLine(line, { x, y: lineY, fill, fontSize, weight })}</g>`;
  }).join('\n');
}

function getZaloDemoHeaderImageSvg() {
  try {
    const base64 = fs.readFileSync(ZALO_DEMO_HEADER_PATH).toString('base64');
    return `<image x="0" y="0" width="916" height="205" preserveAspectRatio="none" href="data:image/png;base64,${base64}"/>`;
  } catch {
    return '<rect x="0" y="0" width="916" height="205" fill="url(#zaloHeader)"/>';
  }
}

function getZaloGroupPreviewImageSvg({ x, y, width, height }) {
  try {
    const base64 = fs.readFileSync(ZALO_GROUP_PREVIEW_PATH).toString('base64');
    return `<image data-demo-preview-y="${Math.round(y)}" x="${x}" y="${y}" width="${width}" height="${height}" preserveAspectRatio="none" href="data:image/png;base64,${base64}"/>`;
  } catch {
    return `<rect data-demo-preview-y="${Math.round(y)}" x="${x}" y="${y}" width="${width}" height="${height}" rx="18" fill="#0b69e7"/>`;
  }
}

function getZaloGroupAvatarImageSvg({ cx, cy, radius }) {
  try {
    const base64 = fs.readFileSync(ZALO_GROUP_AVATAR_PATH).toString('base64');
    const size = radius * 2;
    return `
  <defs>
    <clipPath id="zaloGroupAvatarClip">
      <circle cx="${cx}" cy="${cy}" r="${radius}"/>
    </clipPath>
  </defs>
  <circle cx="${cx}" cy="${cy}" r="${radius + 5}" fill="#ffffff"/>
  <image x="${cx - radius}" y="${cy - radius}" width="${size}" height="${size}" preserveAspectRatio="xMidYMid slice" clip-path="url(#zaloGroupAvatarClip)" href="data:image/jpeg;base64,${base64}"/>`;
  } catch {
    return '';
  }
}

function getZaloDemoInputBarImageSvg() {
  try {
    const base64 = fs.readFileSync(ZALO_DEMO_INPUT_BAR_PATH).toString('base64');
    return `<image data-demo-input-bar="bitmap" x="0" y="1879" width="916" height="168" preserveAspectRatio="none" href="data:image/png;base64,${base64}"/>`;
  } catch {
    return '<rect x="0" y="1879" width="916" height="168" fill="#ffffff"/>';
  }
}

function getZaloDemoHeartImageSvg({ x, y }) {
  try {
    const base64 = fs.readFileSync(ZALO_DEMO_HEART_PATH).toString('base64');
    return `
  <defs>
    <clipPath id="zaloDemoHeartClip">
      <circle cx="${x + 35}" cy="${y + 36}" r="35"/>
    </clipPath>
  </defs>
  <image data-demo-heart="bitmap" data-demo-heart-clip="circle" x="${x}" y="${y}" width="70" height="72" preserveAspectRatio="none" clip-path="url(#zaloDemoHeartClip)" href="data:image/png;base64,${base64}"/>`;
  } catch {
    return `<circle cx="${x + 35}" cy="${y + 36}" r="27" fill="#ffffff" filter="url(#softShadow)"/>`;
  }
}

function getZaloDemoShareImageSvg({ x, y }) {
  try {
    const base64 = fs.readFileSync(ZALO_DEMO_SHARE_PATH).toString('base64');
    return `
  <defs>
    <clipPath id="zaloDemoShareClip">
      <circle cx="${x + 43}" cy="${y + 43}" r="43"/>
    </clipPath>
  </defs>
  <image data-demo-share="bitmap" data-demo-share-clip="circle" x="${x}" y="${y}" width="86" height="86" preserveAspectRatio="none" clip-path="url(#zaloDemoShareClip)" href="data:image/png;base64,${base64}"/>`;
  } catch {
    return `<circle cx="${x + 43}" cy="${y + 43}" r="42" fill="#ffffff" filter="url(#softShadow)"/>`;
  }
}

function getZaloDemoSentStatusImageSvg({ x, y }) {
  try {
    const base64 = fs.readFileSync(ZALO_DEMO_SENT_STATUS_PATH).toString('base64');
    return `
  <defs>
    <clipPath id="zaloDemoSentStatusClip">
      <rect x="${x}" y="${y}" width="155" height="58" rx="29"/>
    </clipPath>
  </defs>
  <image data-demo-sent-status="bitmap" data-demo-sent-status-clip="round" x="${x}" y="${y}" width="155" height="58" preserveAspectRatio="none" clip-path="url(#zaloDemoSentStatusClip)" href="data:image/png;base64,${base64}"/>`;
  } catch {
    return `<rect x="${x + 5}" y="${y + 5}" width="147" height="48" rx="24" fill="#a8afb5"/>`;
  }
}

function getZaloStatusTimeOverlaySvg(timeText) {
  return `
  <rect x="0" y="0" width="558" height="84" fill="url(#statusTimeCover)"/>
  <text data-demo-status-time="${escapeXml(timeText)}" x="58" y="66" fill="#ffffff" font-family="Arial, sans-serif" font-size="33" font-weight="400">${escapeXml(timeText)}</text>`;
}

export function buildZaloDemoReceiptSvg(item) {
  const sentAt = item.completedAt ? new Date(item.completedAt) : new Date();
  const recipientName = item.zaloName || item.name || 'Đối tác Zalo';
  const message = String(item.message || '');
  const groupLink = extractZaloGroupLink(message);
  const messageLines = wrapText(message, 28, groupLink ? 24 : 31);
  const lineHeight = 49;
  const bubbleX = 233;
  const bubbleY = 318;
  const bubbleWidth = 642;
  const bubblePaddingTop = 46;
  const messageStartOffset = 67;
  const previewOffset = groupLink
    ? messageStartOffset + messageLines.length * lineHeight + 28
    : 0;
  const naturalBubbleHeight = groupLink
    ? Math.min(1560, Math.max(620, previewOffset + 408))
    : Math.min(1390, Math.max(220, bubblePaddingTop + messageLines.length * lineHeight + 34));
  const targetBubbleBottom = 1706;
  const shouldAnchorLongReceipt = groupLink && messageLines.length >= 12;
  const bubbleHeight = shouldAnchorLongReceipt
    ? Math.max(naturalBubbleHeight, targetBubbleBottom - bubbleY)
    : naturalBubbleHeight;
  const bubbleBottom = bubbleY + bubbleHeight;
  const messageStartY = bubbleY + messageStartOffset;
  const previewY = groupLink ? bubbleY + previewOffset : 0;
  const timeText = formatDemoClockTime(sentAt);
  const messageText = buildMessageTextLines(messageLines, {
    x: bubbleX + 31,
    y: messageStartY,
    lineHeight,
    fill: '#111827',
    fontSize: 41,
    weight: 400,
  });
  const previewX = bubbleX + 31;
  const previewWidth = 571;
  const previewHeight = 300;
  const preview = groupLink ? `
  ${getZaloGroupPreviewImageSvg({ x: previewX, y: previewY, width: previewWidth, height: previewHeight })}
  ${getZaloGroupAvatarImageSvg({ cx: previewX + 74, cy: previewY + 151, radius: 39 })}
  <text x="${bubbleX + 321}" y="${previewY + 363}" text-anchor="middle" fill="#0068d9" font-family="Arial, sans-serif" font-size="37" font-weight="800">Xem thông tin</text>` : '';

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${RECEIPT_WIDTH}" height="${RECEIPT_HEIGHT}" viewBox="0 0 ${RECEIPT_WIDTH} ${RECEIPT_HEIGHT}">
  <defs>
    <linearGradient id="zaloHeader" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0%" stop-color="#2173ee"/>
      <stop offset="100%" stop-color="#04c8df"/>
    </linearGradient>
    <linearGradient id="nameCover" x1="0" x2="1" y1="0" y2="0">
      <stop offset="0%" stop-color="#1f83fd"/>
      <stop offset="55%" stop-color="#188efc"/>
      <stop offset="100%" stop-color="#129dfc"/>
    </linearGradient>
    <linearGradient id="statusTimeCover" x1="0" x2="1" y1="0" y2="0">
      <stop offset="0%" stop-color="#246de4"/>
      <stop offset="100%" stop-color="#087ecb"/>
    </linearGradient>
    <filter id="softShadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="4" stdDeviation="6" flood-color="#7c8ca3" flood-opacity="0.22"/>
    </filter>
  </defs>
  <rect width="${RECEIPT_WIDTH}" height="${RECEIPT_HEIGHT}" fill="#e8f0f9"/>
  ${getZaloDemoHeaderImageSvg()}
  ${getZaloStatusTimeOverlaySvg(timeText)}

  <rect x="137" y="88" width="420" height="62" fill="url(#nameCover)"/>
  <text x="145" y="136" fill="#ffffff" font-family="Arial, sans-serif" font-size="40" font-weight="800">${escapeXml(recipientName)}</text>

  <rect x="0" y="205" width="${RECEIPT_WIDTH}" height="105" fill="#ffffff"/>
  <g transform="translate(372 226) scale(2.65)" fill="none" stroke="#606060" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/>
    <circle cx="9" cy="7" r="4"/>
    <path d="M19 8v6"/>
    <path d="M22 11h-6"/>
  </g>
  <text x="435" y="273" fill="#111111" font-family="Arial, sans-serif" font-size="35" font-weight="500">Kết bạn</text>

  <rect x="0" y="310" width="${RECEIPT_WIDTH}" height="1569" fill="#e8f0f9"/>
  ${getZaloDemoShareImageSvg({ x: 137, y: bubbleY + 653 })}

  <rect data-demo-bubble-y="${bubbleY}" data-demo-bubble-height="${bubbleHeight}" x="${bubbleX}" y="${bubbleY}" width="${bubbleWidth}" height="${bubbleHeight}" rx="18" fill="#d5f2ff" stroke="#d2e3ed" stroke-width="2"/>
  ${messageText}
  ${preview}
  ${getZaloDemoHeartImageSvg({ x: 805, y: bubbleBottom - 18 })}
  <rect x="${bubbleX}" y="${bubbleBottom + 30}" width="96" height="33" rx="16" fill="#9ba3aa" opacity="0.78"/>
  <text x="${bubbleX + 48}" y="${bubbleBottom + 55}" text-anchor="middle" fill="#ffffff" font-family="Arial, sans-serif" font-size="22" font-weight="700">${escapeXml(timeText)}</text>
  ${getZaloDemoSentStatusImageSvg({ x: 717, y: bubbleBottom + 76 })}

  ${getZaloDemoInputBarImageSvg()}
  <text data-demo-synthetic-marker="visible" x="836" y="2035" fill="#b6bcc4" font-family="Arial, sans-serif" font-size="15" font-weight="500">Mô phỏng</text>
</svg>`;
}

async function defaultReceiptRenderer({ item, receiptsDir }) {
  const completedAt = item.completedAt ? new Date(item.completedAt) : new Date();
  const zaloName = String(item.zaloName || '').trim();
  if (!zaloName) {
    throw new Error('Không lấy được tên Zalo thật từ OpenZCA nên không tạo ảnh demo để tránh sai tên.');
  }
  const dateFolder = formatReceiptDateFolder(completedAt);
  const timestamp = completedAt.toISOString().replace(/\D/g, '').slice(0, 14);
  const phone = normalizeVietnameseMobilePhone(item.phone) || safeFilePart(item.phone);
  const fileName = `${timestamp}_${safeFilePart(phone)}_${safeFilePart(item.id)}.png`;
  const receiptPath = path.posix.join(dateFolder, fileName);
  const absolutePath = path.join(receiptsDir, dateFolder, fileName);

  await fs.promises.mkdir(path.dirname(absolutePath), { recursive: true });
  await sharp(Buffer.from(buildZaloDemoReceiptSvg(item))).png().toFile(absolutePath);

  return {
    receiptPath,
    receiptUrl: `/receipts/${receiptPath}`,
    receiptCreatedAt: completedAt.toISOString(),
    receiptKind: 'zalo-demo-render',
    receiptVerifiedBy: 'openzca-send-success',
    receiptRecentVerified: false,
  };
}

function createZaloWebReceiptBrowser({ profileDir = DEFAULT_ZALO_WEB_PROFILE_DIR } = {}) {
  let browserContext = null;
  let page = null;
  let lastStatus = {
    available: true,
    browserOpen: false,
    loggedInLikely: false,
    message: 'Zalo Web receipt browser chưa mở.',
    lastError: '',
  };

  async function getOrCreatePage() {
    if (page && !page.isClosed()) return page;

    const { chromium } = await import('playwright');
    await fs.promises.mkdir(profileDir, { recursive: true });
    browserContext = await chromium.launchPersistentContext(profileDir, {
      headless: false,
      viewport: { width: 1365, height: 900 },
      args: ['--disable-notifications'],
    });
    page = browserContext.pages()[0] || await browserContext.newPage();
    page.setDefaultTimeout(15000);
    page.setDefaultNavigationTimeout(45000);
    await page.goto('https://chat.zalo.me/', { waitUntil: 'domcontentloaded' }).catch(() => {});
    return page;
  }

  async function readPageStatus() {
    if (!page || page.isClosed()) {
      lastStatus = {
        available: true,
        browserOpen: false,
        loggedInLikely: false,
        message: 'Zalo Web receipt browser chưa mở.',
        lastError: lastStatus.lastError || '',
      };
      return lastStatus;
    }

    try {
      const status = await page.evaluate(() => {
        const text = document.body?.innerText || '';
        const loginLikely = /quét mã|qr|đăng nhập|login/i.test(text);
        const loggedInLikely = /tin nhắn|danh bạ|tìm kiếm|chat/i.test(text) && !loginLikely;
        return { url: location.href, loginLikely, loggedInLikely };
      });
      lastStatus = {
        available: true,
        browserOpen: true,
        loggedInLikely: Boolean(status.loggedInLikely),
        url: status.url,
        message: status.loggedInLikely
          ? 'Zalo Web receipt browser có vẻ đã đăng nhập.'
          : 'Zalo Web receipt browser đang mở. Nếu còn QR, hãy đăng nhập Zalo Web.',
        lastError: '',
      };
      return lastStatus;
    } catch (error) {
      lastStatus = {
        available: true,
        browserOpen: true,
        loggedInLikely: false,
        message: 'Không đọc được trạng thái Zalo Web receipt browser.',
        lastError: formatCommandError(error),
      };
      return lastStatus;
    }
  }

  async function open() {
    const activePage = await getOrCreatePage();
    await activePage.bringToFront().catch(() => {});
    return readPageStatus();
  }

  async function findSearchInput(activePage) {
    const selectors = [
      'input[placeholder*="Tìm"]',
      'input[placeholder*="tìm"]',
      'input[placeholder*="Search"]',
      '[contenteditable="true"][data-placeholder*="Tìm"]',
      '[contenteditable="true"]',
    ];
    for (const selector of selectors) {
      const locator = activePage.locator(selector).first();
      if (await locator.count().catch(() => 0)) {
        try {
          if (await locator.isVisible()) return locator;
        } catch {}
      }
    }
    return null;
  }

  async function clickConversationResult(activePage, item) {
    const targets = [
      item.phone,
      item.userId,
      item.zaloName,
      item.name,
    ].map((value) => String(value || '').trim()).filter(Boolean);

    for (const target of targets) {
      const result = activePage.getByText(target, { exact: false }).first();
      if (await result.count().catch(() => 0)) {
        try {
          await result.click({ timeout: 5000 });
          await activePage.waitForTimeout(1500);
          return true;
        } catch {}
      }
    }
    return false;
  }

  async function openConversation(activePage, item) {
    await activePage.goto('https://chat.zalo.me/', { waitUntil: 'domcontentloaded' }).catch(() => {});
    await activePage.waitForTimeout(1500);
    const bodyText = await activePage.locator('body').innerText({ timeout: 5000 }).catch(() => '');
    if (/quét mã|qr|đăng nhập|login/i.test(bodyText)) {
      throw new Error('Zalo Web chưa đăng nhập trong receipt browser. Hãy bấm MỞ ZALO WEB và quét QR trước.');
    }

    const searchInput = await findSearchInput(activePage);
    if (!searchInput) {
      throw new Error('Không tìm thấy ô tìm kiếm trên Zalo Web để mở đúng cuộc trò chuyện.');
    }

    await searchInput.click();
    await searchInput.fill(item.phone);
    await activePage.waitForTimeout(2000);
    const clicked = await clickConversationResult(activePage, item);
    if (!clicked) {
      throw new Error(`Không mở được cuộc trò chuyện Zalo Web cho ${item.phone}.`);
    }
  }

  async function waitForVisibleSentMessage(activePage, expectedMessage) {
    const expected = normalizeReceiptMessageText(expectedMessage);
    if (!expected) throw new Error('Nội dung tin nhắn trống, không thể xác minh ảnh biên nhận.');

    const found = await activePage.waitForFunction((message) => {
      const normalize = (value) => String(value || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
      const expectedText = normalize(message);
      const nodes = Array.from(document.querySelectorAll('div, span, p, pre, [role="row"], [role="listitem"]'));
      return nodes.some((node) => {
        const rect = node.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return false;
        const text = normalize(node.innerText || node.textContent || '');
        return text === expectedText || text.includes(expectedText);
      });
    }, expected, { timeout: 20000 }).catch(() => null);

    if (!found) {
      throw new Error('Không thấy đúng tin nhắn trong Zalo Web, không chụp biên nhận.');
    }
  }

  async function captureReceipt({ item, receiptsDir, recentVerified }) {
    const activePage = await getOrCreatePage();
    await activePage.bringToFront().catch(() => {});
    await openConversation(activePage, item);
    await waitForVisibleSentMessage(activePage, item.message);

    const completedAt = item.completedAt ? new Date(item.completedAt) : new Date();
    const dateFolder = formatReceiptDateFolder(completedAt);
    const timestamp = completedAt.toISOString().replace(/\D/g, '').slice(0, 14);
    const phone = normalizeVietnameseMobilePhone(item.phone) || safeFilePart(item.phone);
    const fileName = `${timestamp}_${safeFilePart(phone)}_${safeFilePart(item.id)}_zalo_web.png`;
    const receiptPath = path.posix.join(dateFolder, fileName);
    const absolutePath = path.join(receiptsDir, dateFolder, fileName);
    await fs.promises.mkdir(path.dirname(absolutePath), { recursive: true });
    await activePage.screenshot({ path: absolutePath, fullPage: false });

    return {
      receiptPath,
      receiptUrl: `/receipts/${receiptPath}`,
      receiptCreatedAt: completedAt.toISOString(),
      receiptKind: 'zalo-web-real',
      receiptVerifiedBy: 'zalo-web-dom',
      receiptRecentVerified: Boolean(recentVerified),
    };
  }

  return {
    getStatus: readPageStatus,
    open,
    captureReceipt,
  };
}

async function verifyRecentOpenZcaMessage({ commandRunner, item }) {
  if (!item.userId || !item.message) return false;
  try {
    const result = await commandRunner(
      ['msg', 'recent', item.userId, '--json', '-n', '20', '--source', 'auto'],
      { timeoutMs: COMMAND_TIMEOUT_MS },
    );
    return recentMessagesContainText(parseOpenZcaJson(result.stdout), item.message);
  } catch {
    return false;
  }
}

function createRealZaloWebReceiptRenderer({ commandRunner, receiptBrowser }) {
  return async function realZaloWebReceiptRenderer({ item, receiptsDir }) {
    const recentVerified = await verifyRecentOpenZcaMessage({ commandRunner, item });
    const receipt = await receiptBrowser.captureReceipt({ item, receiptsDir, recentVerified });
    return {
      ...receipt,
      receiptKind: receipt?.receiptKind || 'zalo-web-real',
      receiptVerifiedBy: receipt?.receiptVerifiedBy || 'zalo-web-dom',
      receiptRecentVerified: Boolean(receipt?.receiptRecentVerified ?? recentVerified),
    };
  };
}

export function extractQrDataUrl(output) {
  const match = String(output || '').match(/data:image\/png;base64,[A-Za-z0-9+/=]+/);
  if (!match) {
    throw new Error('OpenZCA không trả về QR data URL hợp lệ.');
  }
  return match[0];
}

export function parseOpenZcaAuthStatus(output) {
  const text = String(output || '').trim();
  if (!text) return {};

  try {
    const parsed = JSON.parse(text);
    return {
      loggedIn: parsed.loggedIn === undefined ? undefined : Boolean(parsed.loggedIn),
      profile: String(parsed.profile || '').trim(),
      userId: String(parsed.userId || '').trim(),
      displayName: String(parsed.displayName || '').trim(),
    };
  } catch {
    // openzca auth status uses util.inspect output, not JSON.
  }

  const readStringField = (field) => {
    const pattern = new RegExp(`['"]?${field}['"]?\\s*:\\s*(['"])(.*?)\\1`, 's');
    const match = text.match(pattern);
    return match ? match[2].replace(/\\(['"\\])/g, '$1').trim() : '';
  };
  const loggedInMatch = text.match(/['"]?loggedIn['"]?\s*:\s*(true|false)/i);

  return {
    loggedIn: loggedInMatch ? loggedInMatch[1].toLowerCase() === 'true' : undefined,
    profile: readStringField('profile'),
    userId: readStringField('userId'),
    displayName: readStringField('displayName'),
  };
}

export function runOpenZcaCommand(args, options = {}) {
  const timeoutMs = options.timeoutMs || COMMAND_TIMEOUT_MS;
  const cwd = options.cwd || repoRoot;
  const command = resolveOpenZcaCommand(cwd);

  return new Promise((resolve, reject) => {
    execFile(
      command.file,
      [...command.prefixArgs, ...args],
      {
        cwd,
        timeout: timeoutMs,
        windowsHide: true,
        maxBuffer: 10 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        if (error) {
          error.stdout = stdout;
          error.stderr = stderr;
          reject(error);
          return;
        }
        resolve({ stdout, stderr });
      },
    );
  });
}

function publicItem(item) {
  return {
    id: item.id,
    name: item.name,
    phone: item.phone,
    source: item.source,
    message: item.message,
    status: item.status,
    error: item.error || '',
    userId: item.userId || '',
    zaloName: item.zaloName || '',
    startedAt: item.startedAt || '',
    completedAt: item.completedAt || '',
    receiptPath: item.receiptPath || '',
    receiptUrl: item.receiptUrl || '',
    receiptCreatedAt: item.receiptCreatedAt || '',
    receiptError: item.receiptError || '',
    receiptKind: item.receiptKind || '',
    receiptVerifiedBy: item.receiptVerifiedBy || '',
    receiptRecentVerified: Boolean(item.receiptRecentVerified),
  };
}

function createQueueManager({
  commandRunner = runOpenZcaCommand,
  defaultDelayMs = DEFAULT_DELAY_MS,
  receiptRenderer = defaultReceiptRenderer,
  receiptsDir = DEFAULT_RECEIPTS_DIR,
} = {}) {
  const state = {
    running: false,
    stopping: false,
    currentIndex: -1,
    startedAt: '',
    completedAt: '',
    message: 'Đang chờ lệnh gửi Zalo.',
    items: [],
  };
  let runId = 0;

  function getStatus() {
    return {
      running: state.running,
      stopping: state.stopping,
      currentIndex: state.currentIndex,
      total: state.items.length,
      startedAt: state.startedAt,
      completedAt: state.completedAt,
      message: state.message,
      items: state.items.map(publicItem),
    };
  }

  async function sleep(ms) {
    if (ms <= 0) return;
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function sendLead(item) {
    if (!item.message || !String(item.message).trim()) {
      throw new Error('Nội dung tin nhắn trống, không gửi.');
    }

    const phone = normalizeVietnameseMobilePhone(item.phone);
    if (!phone) {
      throw new Error('Số điện thoại không hợp lệ hoặc không phải số di động Việt Nam.');
    }
    item.phone = phone;

    const found = await commandRunner(['friend', 'find', '--json', phone], { timeoutMs: COMMAND_TIMEOUT_MS });
    const selected = selectSingleOpenZcaUser(parseOpenZcaJson(found.stdout), phone);
    item.userId = selected.userId;
    item.zaloName = getCandidateDisplayName(selected.raw);

    await commandRunner(['msg', 'send', selected.userId, String(item.message), '--raw'], {
      timeoutMs: COMMAND_TIMEOUT_MS,
    });
  }

  async function processQueue(activeRunId, delayMs) {
    for (let index = 0; index < state.items.length; index += 1) {
      if (activeRunId !== runId || state.stopping) break;

      const item = state.items[index];
      state.currentIndex = index;
      item.status = 'RUNNING';
      item.startedAt = new Date().toISOString();
      state.message = `Đang gửi: ${item.phone}`;

      try {
        await sendLead(item);
        item.status = 'SUCCESS';
        item.completedAt = new Date().toISOString();
        item.receiptError = '';
        if (receiptRenderer) {
          try {
            const receipt = await receiptRenderer({ item, receiptsDir });
            item.receiptPath = receipt?.receiptPath || '';
            item.receiptUrl = receipt?.receiptUrl || '';
            item.receiptCreatedAt = receipt?.receiptCreatedAt || '';
            item.receiptKind = receipt?.receiptKind || '';
            item.receiptVerifiedBy = receipt?.receiptVerifiedBy || '';
            item.receiptRecentVerified = Boolean(receipt?.receiptRecentVerified);
          } catch (receiptError) {
            item.receiptError = formatCommandError(receiptError);
          }
        }
        state.message = `Đã gửi thành công: ${item.phone}`;
      } catch (error) {
        item.status = 'FAILED';
        item.error = formatCommandError(error);
        item.completedAt = new Date().toISOString();
        state.message = `Lỗi gửi ${item.phone}: ${item.error}`;
      }

      const hasNext = index < state.items.length - 1;
      if (hasNext && !state.stopping) {
        await sleep(delayMs);
      }
    }

    state.items.forEach((item) => {
      if (item.status === 'PENDING') {
        item.status = 'CANCELLED';
        item.error = 'Đã dừng trước khi gửi.';
        item.completedAt = new Date().toISOString();
      }
    });

    state.running = false;
    state.stopping = false;
    state.currentIndex = state.items.length;
    state.completedAt = new Date().toISOString();
    if (!state.message || state.message.startsWith('Đang gửi:')) {
      state.message = 'Đã xử lý xong queue Zalo.';
    }
  }

  async function startQueue({ queue, delaySec }) {
    if (state.running) {
      const error = new Error('Queue Zalo đang chạy, hãy dừng hoặc chờ xong trước khi bắt đầu queue mới.');
      error.statusCode = 409;
      throw error;
    }

    const items = (Array.isArray(queue) ? queue : [])
      .map((lead) => {
        const phone = normalizeVietnameseMobilePhone(lead?.phone);
        if (!phone) return null;
        return {
          id: String(lead.id || phone),
          name: String(lead.name || ''),
          phone,
          source: String(lead.source || ''),
          message: String(lead.message || ''),
          status: 'PENDING',
          error: '',
          userId: '',
          zaloName: '',
          startedAt: '',
          completedAt: '',
          receiptPath: '',
          receiptUrl: '',
          receiptCreatedAt: '',
          receiptError: '',
          receiptKind: '',
          receiptVerifiedBy: '',
          receiptRecentVerified: false,
        };
      })
      .filter(Boolean);

    if (items.length === 0) {
      const error = new Error('Không có số di động Việt Nam hợp lệ để gửi.');
      error.statusCode = 400;
      throw error;
    }

    state.running = true;
    state.stopping = false;
    state.currentIndex = 0;
    state.startedAt = new Date().toISOString();
    state.completedAt = '';
    state.message = `Đã nhận queue ${items.length} lead.`;
    state.items = items;
    runId += 1;

    const activeRunId = runId;
    const delayMs = Number.isFinite(Number(delaySec))
      ? Math.max(0, Number(delaySec) * 1000)
      : defaultDelayMs;

    setTimeout(() => {
      processQueue(activeRunId, delayMs).catch((error) => {
        state.running = false;
        state.message = formatCommandError(error);
      });
    }, 0);

    return getStatus();
  }

  function stopQueue() {
    if (state.running) {
      state.stopping = true;
      state.message = 'Đang dừng queue Zalo sau tác vụ hiện tại.';
    }
    return getStatus();
  }

  return {
    getStatus,
    startQueue,
    stopQueue,
  };
}

function applyCors(req, res, next) {
  const origin = req.headers.origin;
  const allowed =
    !origin ||
    origin === 'null' ||
    /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin);

  if (allowed) {
    res.setHeader('Access-Control-Allow-Origin', origin || '*');
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  next();
}

async function getAuthStatus(commandRunner) {
  try {
    const result = await commandRunner(['auth', 'status'], { timeoutMs: 15000 });
    const detail = String(result.stdout || '').trim();
    const account = parseOpenZcaAuthStatus(detail);
    return {
      loggedIn: account.loggedIn === false ? false : true,
      profile: account.profile || '',
      userId: account.userId || '',
      displayName: account.displayName || '',
      detail: detail || 'OpenZCA đã sẵn sàng.',
    };
  } catch (error) {
    return {
      loggedIn: false,
      error: formatCommandError(error),
    };
  }
}

function sendDashboardHtml(res) {
  res.sendFile(path.join(repoRoot, 'zalo-lead-connector.html'));
}

export function createZaloLocalServer(options = {}) {
  const commandRunner = options.commandRunner || runOpenZcaCommand;
  const receiptsDir = options.receiptsDir || DEFAULT_RECEIPTS_DIR;
  const receiptBrowser = options.receiptBrowser || null;
  const hasReceiptRendererOverride = Object.prototype.hasOwnProperty.call(options, 'receiptRenderer');
  const receiptRenderer = hasReceiptRendererOverride
    ? options.receiptRenderer
    : defaultReceiptRenderer;
  const queue = createQueueManager({
    commandRunner,
    defaultDelayMs: options.defaultDelayMs,
    receiptRenderer,
    receiptsDir,
  });
  const app = express();

  app.use(applyCors);
  app.use(express.json({ limit: '1mb' }));
  app.use('/receipts', express.static(receiptsDir, {
    fallthrough: false,
    setHeaders(res) {
      res.setHeader('Cache-Control', 'no-store');
    },
  }));

  app.get('/health', (req, res) => {
    res.json({ ok: true });
  });

  app.get('/favicon.ico', (req, res) => {
    res.status(204).end();
  });

  app.get('/', (req, res) => {
    sendDashboardHtml(res);
  });

  app.get('/zalo-lead-connector.html', (req, res) => {
    sendDashboardHtml(res);
  });

  app.get('/api/zalo/status', async (req, res) => {
    const auth = await getAuthStatus(commandRunner);
    res.json({
      ok: true,
      auth,
      queue: queue.getStatus(),
    });
  });

  app.get('/api/zalo-web/status', async (req, res) => {
    if (!receiptBrowser) {
      res.json({
        ok: true,
        receiptBrowser: {
          available: false,
          browserOpen: false,
          loggedInLikely: false,
          message: 'Zalo Web receipt đã tắt. Server đang dùng ảnh demo sau khi OpenZCA gửi thành công.',
          lastError: '',
        },
      });
      return;
    }

    try {
      res.json({
        ok: true,
        receiptBrowser: await receiptBrowser.getStatus(),
      });
    } catch (error) {
      res.status(500).json({
        ok: false,
        error: formatCommandError(error),
      });
    }
  });

  app.post('/api/zalo-web/open', async (req, res) => {
    if (!receiptBrowser) {
      res.status(410).json({
        ok: false,
        error: 'Zalo Web receipt đã tắt. Server đang dùng ảnh demo sau khi OpenZCA gửi thành công.',
      });
      return;
    }

    try {
      res.json({
        ok: true,
        receiptBrowser: await receiptBrowser.open(),
      });
    } catch (error) {
      res.status(500).json({
        ok: false,
        error: formatCommandError(error),
      });
    }
  });

  app.post('/api/zalo/auth/login-qr', async (req, res) => {
    try {
      const result = await commandRunner(['auth', 'login', '--qr-base64'], { timeoutMs: 30000 });
      res.json({
        ok: true,
        qrDataUrl: extractQrDataUrl(result.stdout),
        message: 'Quét QR bằng ứng dụng Zalo, dashboard sẽ tự kiểm tra trạng thái đăng nhập.',
      });
    } catch (error) {
      res.status(500).json({
        ok: false,
        error: formatCommandError(error),
        queue: queue.getStatus(),
      });
    }
  });

  app.post('/api/zalo/queue/start', async (req, res) => {
    const auth = await getAuthStatus(commandRunner);
    if (!auth.loggedIn) {
      res.status(409).json({
        ok: false,
        error: `Chưa đăng nhập OpenZCA. Chạy npm run dev rồi bấm QUÉT QR trong dashboard. ${auth.error || ''}`.trim(),
        auth,
        queue: queue.getStatus(),
      });
      return;
    }

    try {
      const status = await queue.startQueue(req.body || {});
      res.status(202).json({ ok: true, queue: status });
    } catch (error) {
      res.status(error.statusCode || 500).json({
        ok: false,
        error: error.message,
        queue: queue.getStatus(),
      });
    }
  });

  app.post('/api/zalo/queue/stop', (req, res) => {
    res.json({ ok: true, queue: queue.stopQueue() });
  });

  const server = http.createServer(app);
  return { app, server, queue, receiptBrowser };
}

function isMainModule() {
  return import.meta.url === pathToFileURL(process.argv[1] || '').href;
}

function openBrowser(url) {
  const command = process.platform === 'win32'
    ? { file: 'cmd', args: ['/c', 'start', '', url] }
    : process.platform === 'darwin'
      ? { file: 'open', args: [url] }
      : { file: 'xdg-open', args: [url] };

  execFile(command.file, command.args, { windowsHide: true }, () => {});
}

if (isMainModule()) {
  const port = Number(process.env.ZALO_LOCAL_PORT || DEFAULT_PORT);
  const url = `http://127.0.0.1:${port}/zalo-lead-connector.html`;
  const shouldOpen = process.argv.includes('--open') || process.env.ZALO_OPEN_BROWSER === '1';
  const { server } = createZaloLocalServer();
  server.on('error', (error) => {
    if (error?.code === 'EADDRINUSE') {
      console.error(`Port ${port} đang được dùng. Nếu dashboard cũ đang chạy, mở ${url} hoặc tắt process cũ rồi chạy lại.`);
      if (shouldOpen) openBrowser(url);
      process.exit(0);
    }
    throw error;
  });
  server.listen(port, '127.0.0.1', () => {
    console.log(`Zalo local OpenZCA server listening on http://127.0.0.1:${port}`);
    console.log(`Dashboard: ${url}`);
    if (shouldOpen) openBrowser(url);
  });
}
