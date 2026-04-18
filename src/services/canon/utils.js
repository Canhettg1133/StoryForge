export function cleanText(value) {
  return String(value || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function buildCanonChapterTextFromScenes(scenes = []) {
  return (scenes || [])
    .map((scene) => cleanText(scene.draft_text || scene.final_text || ''))
    .filter(Boolean)
    .join('\n\n');
}

export function buildCanonContentSignature(value = '') {
  const normalized = cleanText(value);
  let hash = 2166136261;
  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= normalized.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${normalized.length}:${(hash >>> 0).toString(36)}`;
}

export function isRevisionFreshForCanonText(revision, chapterText = '') {
  if (!revision) return false;
  const currentSignature = buildCanonContentSignature(chapterText);
  const revisionSignature = revision.content_signature || buildCanonContentSignature(revision.chapter_text || '');
  return currentSignature === revisionSignature;
}

export function normalizeKey(value) {
  return cleanText(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function uniqueList(items) {
  return Array.from(new Set((items || []).filter(Boolean)));
}

export function uniqueSummaryParts(items) {
  const seen = new Set();
  const result = [];

  (items || []).forEach((item) => {
    const chunks = String(item || '')
      .split('|')
      .map((part) => cleanText(part))
      .filter(Boolean);

    chunks.forEach((chunk) => {
      const key = normalizeKey(chunk);
      if (!key || seen.has(key)) return;
      seen.add(key);
      result.push(chunk);
    });
  });

  return result;
}

export function splitGoals(value) {
  if (Array.isArray(value)) {
    return uniqueList(value.map((item) => cleanText(item)).filter(Boolean));
  }
  return uniqueList(
    String(value || '')
      .split(/[,\n;|]/)
      .map((item) => cleanText(item))
      .filter(Boolean)
  );
}

export function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

export function normalizePayload(payload) {
  return payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
}

export function clampConfidence(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  if (numeric < 0) return 0;
  if (numeric > 1) return 1;
  return numeric;
}
