const EMPTY_HTML_RE = /^(?:\s|&nbsp;|<p>\s*(?:<br\s*\/?>)?\s*<\/p>|<br\s*\/?>|<div>\s*(?:<br\s*\/?>)?\s*<\/div>)*$/iu;

function toTextId(value) {
  return String(value ?? '').trim();
}

function toIsoTimestamp(value, fallback = Date.now()) {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'number' && Number.isFinite(value)) return new Date(value).toISOString();
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : new Date(fallback).toISOString();
}

function normalizeStatus(value, fallback = 'draft') {
  return String(value || fallback).trim() || fallback;
}

function htmlToPlainText(value = '') {
  return String(value || '')
    .replace(/<[^>]+>/gu, ' ')
    .replace(/&nbsp;/giu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

function countWordsFromHtml(value = '') {
  const text = htmlToPlainText(value);
  if (!text) return 0;
  return text.split(/\s+/u).filter(Boolean).length;
}

export function normalizeMirrorText(draftText = '', finalText = '') {
  const draft = String(draftText || '');
  if (draft.trim() && !EMPTY_HTML_RE.test(draft)) return draft;
  return String(finalText || '');
}

export function hasMirrorText(draftText = '', finalText = '') {
  const content = normalizeMirrorText(draftText, finalText);
  return Boolean(String(content || '').trim() && !EMPTY_HTML_RE.test(content));
}

function byteSize(value) {
  return new TextEncoder().encode(String(value || '')).length;
}

function fallbackHash(value) {
  let hash = 0x811c9dc5;
  const text = String(value || '');
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a:${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

async function sha256(value) {
  const text = String(value || '');
  if (!globalThis.crypto?.subtle) return fallbackHash(text);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return `sha256:${[...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

export async function buildSceneMirrorEvent({
  project,
  chapter,
  scene,
  clientIds = {},
  now = Date.now(),
} = {}) {
  if (!project?.id || !chapter?.id || !scene?.id) {
    throw new Error('Thiếu project, chapter hoặc scene để mirror truyện.');
  }

  const content = normalizeMirrorText(scene.draft_text, scene.final_text);
  const contentHash = await sha256(content);
  const clientUpdatedAt = toIsoTimestamp(scene.updated_at || project.updated_at || now, now);
  const wordCount = countWordsFromHtml(content);
  const clientProjectId = toTextId(clientIds.projectId || project.id);
  const clientChapterId = toTextId(clientIds.chapterId || chapter.id);
  const clientSceneId = toTextId(clientIds.sceneId || scene.id);

  return {
    idempotencyKey: [
      'scene',
      clientProjectId,
      clientSceneId,
      contentHash.replace(/[^a-z0-9]+/giu, '-'),
      clientUpdatedAt,
    ].join(':'),
    resourceType: 'scene.upsert',
    payloadVersion: 1,
    clientUpdatedAt,
    project: {
      clientProjectId,
      title: String(project.title || `Dự án ${project.id}`).trim(),
      genre: String(project.genre_primary || project.genre || '').trim(),
      status: normalizeStatus(project.status, 'active'),
      wordCount: Number(project.actual_word_count || project.word_count || 0) || 0,
      updatedAt: toIsoTimestamp(project.updated_at || now, now),
    },
    chapter: {
      clientChapterId,
      title: String(chapter.title || `Chương ${Number(chapter.order_index || 0) + 1}`).trim(),
      orderIndex: Number(chapter.order_index || 0),
      status: normalizeStatus(chapter.status),
      wordCount: Number(chapter.actual_word_count || chapter.word_count || wordCount) || wordCount,
    },
    scene: {
      clientSceneId,
      title: String(scene.title || `Cảnh ${Number(scene.order_index || 0) + 1}`).trim(),
      orderIndex: Number(scene.order_index || 0),
      status: normalizeStatus(scene.status),
      content,
      contentHash,
      sizeBytes: byteSize(content),
      wordCount,
      updatedAt: clientUpdatedAt,
    },
  };
}

export default {
  buildSceneMirrorEvent,
  hasMirrorText,
  normalizeMirrorText,
};
