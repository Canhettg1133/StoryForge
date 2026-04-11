function toNumber(value, fallback = null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

function tokenize(text) {
  if (!text) return [];
  return normalizeText(text)
    .split(' ')
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
}

function getIncidentRange(incident = {}) {
  const start = toNumber(
    incident.startChapter
    ?? incident.chapterStart
    ?? incident.chapterStartIndex
    ?? incident.chapterRange?.[0],
    null,
  );
  const end = toNumber(
    incident.endChapter
    ?? incident.chapterEnd
    ?? incident.chapterEndIndex
    ?? incident.chapterRange?.[1],
    start,
  );

  if (start == null || end == null) {
    return [null, null];
  }

  return [Math.min(start, end), Math.max(start, end)];
}

function getChapterText(chapters = [], chapterIndex) {
  if (!Number.isFinite(Number(chapterIndex)) || chapterIndex < 0) {
    return '';
  }

  const chapter = chapters[chapterIndex];
  if (!chapter) return '';
  return String(chapter.content || chapter.text || '').trim();
}

export function calculateLexicalOverlap(textA, textB) {
  const tokensA = new Set(tokenize(textA));
  const tokensB = new Set(tokenize(textB));

  if (tokensA.size === 0 || tokensB.size === 0) {
    return 0;
  }

  let intersection = 0;
  for (const token of tokensA) {
    if (tokensB.has(token)) intersection += 1;
  }

  const union = tokensA.size + tokensB.size - intersection;
  return union > 0 ? (intersection / union) : 0;
}

function calculateBM25Approx(reference, sample) {
  // Lightweight fallback BM25 approximation using weighted lexical overlap.
  const overlap = calculateLexicalOverlap(reference, sample);
  const refTokens = tokenize(reference).length;
  const sampleTokens = tokenize(sample).length;

  if (!refTokens || !sampleTokens) return 0;

  const lengthBalance = Math.min(refTokens, sampleTokens) / Math.max(refTokens, sampleTokens);
  return Math.max(0, Math.min(1, (overlap * 0.75) + (lengthBalance * 0.25)));
}

export function refineIncidentBoundary(incident, chapters = [], options = {}) {
  const overlapThreshold = Number.isFinite(Number(options.overlapThreshold))
    ? Number(options.overlapThreshold)
    : 0.3;
  const bm25Threshold = Number.isFinite(Number(options.bm25Threshold))
    ? Number(options.bm25Threshold)
    : 0.4;

  const [startChapter, endChapter] = getIncidentRange(incident);
  const startText = getChapterText(chapters, startChapter);
  const endText = getChapterText(chapters, endChapter);
  const prevText = getChapterText(chapters, (startChapter ?? 0) - 1);
  const nextText = getChapterText(chapters, (endChapter ?? 0) + 1);

  const startOverlap = calculateLexicalOverlap(startText, prevText || nextText);
  const endOverlap = calculateLexicalOverlap(endText, nextText || prevText);
  const startBM25 = calculateBM25Approx(startText, prevText || nextText);
  const endBM25 = calculateBM25Approx(endText, nextText || prevText);

  let uncertainStart = Boolean(incident?.uncertainStart);
  let uncertainEnd = Boolean(incident?.uncertainEnd);
  const notes = [];

  if (startChapter == null || startOverlap < overlapThreshold || startBM25 < bm25Threshold) {
    uncertainStart = true;
    notes.push(`UNCERTAIN_START overlap=${startOverlap.toFixed(2)} bm25=${startBM25.toFixed(2)}`);
  }

  if (endChapter == null || endOverlap < overlapThreshold || endBM25 < bm25Threshold) {
    uncertainEnd = true;
    notes.push(`UNCERTAIN_END overlap=${endOverlap.toFixed(2)} bm25=${endBM25.toFixed(2)}`);
  }

  const activeSpan = (
    startChapter != null
    && endChapter != null
    && endChapter >= startChapter
  )
    ? (endChapter - startChapter + 1)
    : Math.max(1, Number(incident?.activeSpan) || 1);

  return {
    ...incident,
    startChapter,
    endChapter,
    uncertainStart,
    uncertainEnd,
    boundaryNote: [String(incident?.boundaryNote || '').trim(), ...notes]
      .filter(Boolean)
      .join('\n'),
    activeSpan,
    overlapScores: {
      start: Number(startOverlap.toFixed(4)),
      end: Number(endOverlap.toFixed(4)),
    },
    bm25Scores: {
      start: Number(startBM25.toFixed(4)),
      end: Number(endBM25.toFixed(4)),
    },
  };
}

export function refineBoundaries(incidents = [], chapters = [], options = {}) {
  return (incidents || []).map((incident) => refineIncidentBoundary(incident, chapters, options));
}
