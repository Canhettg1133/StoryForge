import { countWords } from '../../corpus/utils/textUtils.js';

const DEFAULT_OPTIONS = {
  qualityThreshold: 60,
  chapterConfidenceThreshold: 0.45,
  evidenceSnippetChars: 240,
  maxKeywords: 8,
  maxQueryTokens: 40,
  minDescriptionLength: 12,
  bm25: {
    k1: 1.2,
    b: 0.75,
  },
};

const EVENT_COLLECTION_CANDIDATES = [
  ['majorEvents', 'major', 'major_events'],
  ['minorEvents', 'minor', 'minor_events'],
  ['plotTwists', 'twists', 'plot_twists'],
  ['cliffhangers', 'cliffhanger', 'cliff_hangers'],
];

const NESTED_EVENT_KEYS = ['subevents', 'subEvents', 'children'];

const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'been', 'by', 'for', 'from', 'had', 'has', 'have',
  'he', 'her', 'his', 'in', 'is', 'it', 'its', 'of', 'on', 'or', 'she', 'that', 'the', 'their',
  'them', 'they', 'this', 'to', 'was', 'were', 'with', 'you', 'your', 've', 'll',
  'la', 'va', 'cua', 'cho', 'mot', 'nhung', 'trong', 'tren', 'duoc', 'khi', 'noi', 'nay', 'kia',
  'da', 'dang', 'se', 'co', 'khong', 'rat', 'nhu', 'de', 'di', 'tai', 'tu', 'den', 'sau', 'truoc',
  'phan', 'chuong', 'event', 'su', 'kien',
]);

function clamp(value, min, max) {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    return min;
  }

  return Math.max(min, Math.min(max, num));
}

function normalizeWhitespace(value) {
  return String(value || '').replace(/\s+/gu, ' ').trim();
}

function round(value, digits = 3) {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    return 0;
  }

  const base = 10 ** digits;
  return Math.round(num * base) / base;
}

function toEventObject(event) {
  if (event && typeof event === 'object') {
    return { ...event };
  }

  if (typeof event === 'string') {
    return {
      description: normalizeWhitespace(event),
    };
  }

  return null;
}

function parseChapter(value) {
  if (value == null || value === '') {
    return null;
  }

  if (typeof value === 'string') {
    const match = value.match(/(\d{1,4})/u);
    if (match) {
      const parsed = Number(match[1]);
      return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : null;
    }
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : null;
}

function resolveEventDescription(event) {
  const candidates = [
    event?.description,
    event?.summary,
    event?.title,
    event?.name,
    event?.event,
    event?.text,
    event?.content,
    event?.note,
  ];

  for (const item of candidates) {
    const value = normalizeWhitespace(item);
    if (value) {
      return value;
    }
  }

  return '';
}

function tokenize(text) {
  const normalized = String(text || '')
    .toLowerCase()
    .replace(/[\p{P}\p{S}]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();

  if (!normalized) {
    return [];
  }

  return normalized
    .split(' ')
    .map((token) => token.trim())
    .filter((token) => token.length >= 2)
    .filter((token) => !STOPWORDS.has(token))
    .filter((token) => /\p{L}|\p{N}/u.test(token));
}

function buildTermFreq(tokens) {
  const map = new Map();
  for (const token of tokens) {
    map.set(token, (map.get(token) || 0) + 1);
  }
  return map;
}

function buildChunkDocs(chunks = []) {
  return (chunks || [])
    .map((chunk) => {
      const text = normalizeWhitespace(chunk?.text);
      if (!text) {
        return null;
      }

      const tokens = tokenize(text);
      if (!tokens.length) {
        return null;
      }

      return {
        id: chunk.id,
        chunkIndex: Number.isFinite(Number(chunk.chunkIndex)) ? Number(chunk.chunkIndex) : null,
        chapterId: chunk.chapterId || null,
        chapterIndex: Number.isFinite(Number(chunk.chapterIndex)) ? Number(chunk.chapterIndex) : null,
        text,
        tokens,
        tf: buildTermFreq(tokens),
        length: tokens.length,
        wordCount: Number.isFinite(Number(chunk.wordCount)) ? Number(chunk.wordCount) : countWords(text),
      };
    })
    .filter(Boolean);
}

function buildDocumentFrequency(chunkDocs) {
  const df = new Map();

  for (const doc of chunkDocs) {
    const unique = new Set(doc.tokens);
    for (const token of unique) {
      df.set(token, (df.get(token) || 0) + 1);
    }
  }

  return df;
}

function getIdf(term, df, docCount) {
  const freq = df.get(term) || 0;
  return Math.log(1 + ((docCount - freq + 0.5) / (freq + 0.5)));
}

function computeBm25Score({ queryTerms, doc, df, avgDocLength, docCount, bm25Config }) {
  const k1 = bm25Config.k1;
  const b = bm25Config.b;
  let score = 0;

  for (const term of queryTerms) {
    const tf = doc.tf.get(term) || 0;
    if (tf <= 0) {
      continue;
    }

    const idf = getIdf(term, df, docCount);
    const denominator = tf + k1 * (1 - b + (b * doc.length) / Math.max(1, avgDocLength));
    score += idf * ((tf * (k1 + 1)) / Math.max(0.01, denominator));
  }

  return score;
}

function scoreChunk({ event, queryTerms, querySet, doc, context }) {
  if (!queryTerms.length || !doc) {
    return null;
  }

  const bm25 = computeBm25Score({
    queryTerms,
    doc,
    df: context.documentFrequency,
    avgDocLength: context.averageDocLength,
    docCount: context.docCount,
    bm25Config: context.options.bm25,
  });

  let overlapCount = 0;
  for (const term of querySet) {
    if (doc.tf.has(term)) {
      overlapCount += 1;
    }
  }

  const overlapRatio = overlapCount / Math.max(1, querySet.size);

  const chapterHint = parseChapter(event?.chapter);
  let chapterPrior = 0;

  if (chapterHint && Number.isFinite(Number(doc.chapterIndex)) && Number(doc.chapterIndex) > 0) {
    const diff = Math.abs(chapterHint - Number(doc.chapterIndex));
    chapterPrior = Math.max(0, 1 - (diff / 8)) * 0.25;
  }

  const lexicalScore = bm25 + overlapRatio * 2 + chapterPrior;

  const matchedKeywords = [...querySet]
    .filter((term) => doc.tf.has(term))
    .sort((a, b) => (doc.tf.get(b) || 0) - (doc.tf.get(a) || 0))
    .slice(0, context.options.maxKeywords);

  return {
    doc,
    bm25,
    overlapRatio,
    overlapCount,
    chapterPrior,
    lexicalScore,
    matchedKeywords,
  };
}

function computeChapterConfidence(best, secondBest) {
  if (!best) {
    return 0;
  }

  const bm25Signal = Math.tanh(best.bm25 / 6);
  const overlapSignal = clamp(best.overlapRatio, 0, 1);
  const lexicalSignal = Math.tanh(best.lexicalScore / 8);
  const marginSignal = Math.max(0, best.lexicalScore - (secondBest?.lexicalScore || 0))
    / Math.max(1, Math.abs(best.lexicalScore));

  let confidence = (
    (0.30 * bm25Signal)
    + (0.35 * overlapSignal)
    + (0.20 * lexicalSignal)
    + (0.15 * marginSignal)
  );

  if (best.overlapCount === 0) {
    confidence *= 0.4;
  }

  return clamp(confidence, 0, 1);
}

function findSnippet(text, matchedKeywords = [], maxChars = 240) {
  const source = normalizeWhitespace(text);
  if (!source) {
    return '';
  }

  const normalizedKeywords = (matchedKeywords || [])
    .map((item) => normalizeWhitespace(item).toLowerCase())
    .filter(Boolean);

  let index = -1;
  for (const keyword of normalizedKeywords) {
    index = source.toLowerCase().indexOf(keyword);
    if (index >= 0) {
      break;
    }
  }

  if (index < 0) {
    const fallback = source.slice(0, maxChars).trim();
    return source.length > maxChars ? `${fallback}...` : fallback;
  }

  const windowSize = Math.max(80, maxChars);
  const leftPad = Math.floor(windowSize * 0.35);
  const start = Math.max(0, index - leftPad);
  const end = Math.min(source.length, start + windowSize);
  const snippet = source.slice(start, end).trim();

  const prefix = start > 0 ? '...' : '';
  const suffix = end < source.length ? '...' : '';
  return `${prefix}${snippet}${suffix}`;
}

function collectEventQueryText(event) {
  const pieces = [
    resolveEventDescription(event),
    Array.isArray(event?.tags) ? event.tags.join(' ') : event?.tags,
    Array.isArray(event?.characters) ? event.characters.join(' ') : event?.characters,
    Array.isArray(event?.ships) ? event.ships.join(' ') : event?.ships,
  ];

  return pieces
    .map((item) => normalizeWhitespace(item))
    .filter(Boolean)
    .join(' ')
    .trim();
}

function estimateQualityProxy(event) {
  let score = 0;

  const description = resolveEventDescription(event);
  if (description.length >= 20) score += 40;
  else if (description.length >= 12) score += 25;
  else if (description.length >= 8) score += 15;

  if (parseChapter(event?.chapter)) score += 20;
  if (String(event?.severity || '').trim()) score += 20;
  if (Number.isFinite(Number(event?.emotionalIntensity))) score += 10;
  if (Number.isFinite(Number(event?.insertability))) score += 10;

  return Math.min(100, score);
}

function resolveReviewStatus({ qualityProxy, chapterConfidence, options }) {
  const autoAccepted = (
    qualityProxy >= options.qualityThreshold
    && chapterConfidence >= options.chapterConfidenceThreshold
  );

  return autoAccepted ? 'auto_accepted' : 'needs_review';
}

function groundSingleEvent(rawEvent, context) {
  const event = toEventObject(rawEvent);
  if (!event) {
    return rawEvent;
  }

  const description = resolveEventDescription(event);
  const queryText = collectEventQueryText(event);
  const queryTerms = tokenize(queryText).slice(0, context.options.maxQueryTokens);
  const querySet = new Set(queryTerms);

  const existingChapter = parseChapter(event.chapter);
  const qualityProxy = estimateQualityProxy({ ...event, description });

  let best = null;
  let secondBest = null;

  if (queryTerms.length >= 2 || description.length >= context.options.minDescriptionLength) {
    for (const doc of context.chunkDocs) {
      const candidate = scoreChunk({
        event,
        queryTerms,
        querySet,
        doc,
        context,
      });

      if (!candidate) {
        continue;
      }

      if (!best || candidate.lexicalScore > best.lexicalScore) {
        secondBest = best;
        best = candidate;
      } else if (!secondBest || candidate.lexicalScore > secondBest.lexicalScore) {
        secondBest = candidate;
      }
    }
  }

  const chapterConfidence = round(computeChapterConfidence(best, secondBest), 4);
  const groundedChapter = Number.isFinite(Number(best?.doc?.chapterIndex)) && Number(best.doc.chapterIndex) > 0
    ? Number(best.doc.chapterIndex)
    : null;

  const useGroundedChapter = (
    groundedChapter != null
    && (
      !existingChapter
      || chapterConfidence >= context.options.chapterConfidenceThreshold
      || Math.abs(existingChapter - groundedChapter) <= 1
    )
  );

  const finalChapter = useGroundedChapter
    ? groundedChapter
    : (existingChapter || groundedChapter || null);

  const reviewStatus = resolveReviewStatus({
    qualityProxy: estimateQualityProxy({ ...event, chapter: finalChapter, description }),
    chapterConfidence,
    options: context.options,
  });

  const evidenceSnippet = best
    ? findSnippet(best.doc.text, best.matchedKeywords, context.options.evidenceSnippetChars)
    : '';

  const grounding = {
    algorithm: 'bm25+keyword_overlap',
    chunkId: best?.doc?.id || null,
    chunkIndex: best?.doc?.chunkIndex ?? null,
    chapterId: best?.doc?.chapterId || null,
    chapterIndex: groundedChapter,
    chapterConfidence,
    lexicalScore: round(best?.lexicalScore || 0),
    bm25Score: round(best?.bm25 || 0),
    keywordOverlap: round(best?.overlapRatio || 0),
    matchedKeywords: best?.matchedKeywords || [],
    evidenceSnippet,
    sourceChapter: existingChapter,
    chapterSource: useGroundedChapter ? 'grounded' : (existingChapter ? 'existing' : 'grounded'),
  };

  const result = {
    ...event,
    chapter: finalChapter,
    chapterConfidence,
    grounding,
    reviewStatus,
    needsReview: reviewStatus === 'needs_review',
    qualityProxy,
  };

  for (const key of NESTED_EVENT_KEYS) {
    if (!Array.isArray(event[key])) {
      continue;
    }

    result[key] = event[key]
      .map((item) => groundSingleEvent(item, context))
      .filter(Boolean);
  }

  return result;
}

function resolveEventCollectionKeys(eventsLayer) {
  const keys = new Set();
  const layer = eventsLayer || {};

  for (const group of EVENT_COLLECTION_CANDIDATES) {
    for (const key of group) {
      if (Array.isArray(layer[key])) {
        keys.add(key);
      }
    }
  }

  // Fallback: include additional event-like arrays.
  for (const [key, value] of Object.entries(layer)) {
    if (!Array.isArray(value) || value.length === 0) {
      continue;
    }

    const lower = key.toLowerCase();
    if (lower.includes('event') || lower.includes('twist') || lower.includes('cliff')) {
      keys.add(key);
    }
  }

  return [...keys];
}

function summarizeGrounding(eventsLayer) {
  const keys = resolveEventCollectionKeys(eventsLayer);
  let total = 0;
  let grounded = 0;
  let needsReview = 0;
  let confidenceTotal = 0;

  const visit = (event) => {
    if (!event || typeof event !== 'object') {
      return;
    }

    total += 1;

    const confidence = clamp(event.chapterConfidence, 0, 1);
    confidenceTotal += confidence;

    if (event?.grounding?.chunkId) {
      grounded += 1;
    }

    if (event.reviewStatus === 'needs_review' || event.needsReview) {
      needsReview += 1;
    }

    for (const key of NESTED_EVENT_KEYS) {
      if (!Array.isArray(event[key])) {
        continue;
      }

      for (const item of event[key]) {
        visit(item);
      }
    }
  };

  for (const key of keys) {
    const list = eventsLayer[key];
    if (!Array.isArray(list)) {
      continue;
    }

    for (const event of list) {
      visit(event);
    }
  }

  return {
    total,
    grounded,
    needsReview,
    averageChapterConfidence: total > 0 ? round(confidenceTotal / total) : 0,
  };
}

export function groundAnalysisEvents(result = {}, chunks = [], options = {}) {
  const mergedOptions = {
    ...DEFAULT_OPTIONS,
    ...(options || {}),
    bm25: {
      ...DEFAULT_OPTIONS.bm25,
      ...(options?.bm25 || {}),
    },
  };

  const eventsLayer = result?.events;
  if (!eventsLayer || typeof eventsLayer !== 'object') {
    return {
      result,
      stats: {
        total: 0,
        grounded: 0,
        needsReview: 0,
        averageChapterConfidence: 0,
      },
    };
  }

  const chunkDocs = buildChunkDocs(chunks);
  if (!chunkDocs.length) {
    return {
      result,
      stats: {
        total: 0,
        grounded: 0,
        needsReview: 0,
        averageChapterConfidence: 0,
      },
    };
  }

  const documentFrequency = buildDocumentFrequency(chunkDocs);
  const averageDocLength = chunkDocs.reduce((sum, doc) => sum + doc.length, 0) / chunkDocs.length;

  const context = {
    chunkDocs,
    documentFrequency,
    averageDocLength,
    docCount: chunkDocs.length,
    options: mergedOptions,
  };

  const groundedEvents = { ...eventsLayer };
  const keys = resolveEventCollectionKeys(groundedEvents);

  for (const key of keys) {
    const list = groundedEvents[key];
    if (!Array.isArray(list)) {
      continue;
    }

    groundedEvents[key] = list
      .map((event) => groundSingleEvent(event, context))
      .filter(Boolean);
  }

  const groundedResult = {
    ...result,
    events: groundedEvents,
  };

  const stats = summarizeGrounding(groundedEvents);

  return {
    result: groundedResult,
    stats,
  };
}

export { DEFAULT_OPTIONS as EVENT_GROUNDING_DEFAULT_OPTIONS };
