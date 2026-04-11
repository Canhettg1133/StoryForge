const DEFAULT_OPTIONS = {
  linkThreshold: 0.35,
  majorLocationMentionThreshold: 2,
  minLocationMentions: 2,
  incidentChapterWindow: 2,
  maxIncidentCount: 40,
  maxEvidencePerLocation: 4,
};

const LOCATION_PREFIX_TOKENS = new Set([
  'truong', 'thpt', 'thcs', 'hoc', 'vien',
  'thon', 'lang', 'xa', 'huyen', 'quan',
  'tp', 'pho', 'duong', 'ngo',
  'benh', 'nha', 'nghia',
  'khu', 'toa', 'biet',
  'khach', 'chung', 'ham',
  'nui', 'rung', 'dong', 'ho', 'song',
  'den', 'chua', 'dinh',
  'lau', 'thap', 'coc', 'son', 'dao',
]);

const LOCATION_PREFIX_BIGRAMS = new Set([
  'dai hoc',
  'hoc vien',
  'thanh pho',
  'benh vien',
  'nha tho',
  'nghia trang',
  'nha may',
  'toa nha',
  'biet thu',
  'khach san',
  'chung cu',
]);

const LOCATION_SUFFIX_TOKENS = new Set([
  'pho', 'quan', 'huyen', 'xa', 'lang', 'thon',
  'vien', 'truong', 'nui', 'rung', 'song', 'ho',
  'son', 'dao', 'coc', 'cung', 'dien', 'thap',
  'thanh', 'tran', 'chau', 'bao', 'mon',
]);

const LOCATION_FRAGMENT_STOP_TOKENS = new Set([
  'va', 'voi', 'nhung', 'roi', 'sau', 'truoc', 'khi', 'de', 'la', 'thi', 'ma',
  'neu', 'vi', 'nen', 'dong', 'thoi',
]);

const LOCATION_NOISE_TOKENS = new Set([
  'hoan', 'nghenh', 'nhap', 'chuc',
  'hoan_toan', 'khong', 'co', 'tinh', 'luc', 'so', 'do',
  'bat', 'ky', 'nguoi', 'dang', 'phai', 'duoc',
]);

const EVENT_ARRAY_KEYS = [
  'majorEvents',
  'major',
  'major_events',
  'minorEvents',
  'minor',
  'minor_events',
  'plotTwists',
  'twists',
  'plot_twists',
  'cliffhangers',
  'cliffhanger',
  'cliff_hangers',
];

const NESTED_EVENT_KEYS = ['subevents', 'subEvents', 'children'];

function normalizeWhitespace(value) {
  return String(value || '').replace(/\s+/gu, ' ').trim();
}

function normalizeLocationKey(value) {
  return normalizeWhitespace(value)
    .toLowerCase()
    .replace(/[\p{P}\p{S}]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

function clamp(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return min;
  }
  return Math.max(min, Math.min(max, n));
}

function round(value, digits = 3) {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return 0;
  }
  const base = 10 ** digits;
  return Math.round(n * base) / base;
}

function hashString(value) {
  const source = String(value || '');
  let hash = 0;
  for (let i = 0; i < source.length; i += 1) {
    hash = ((hash << 5) - hash) + source.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
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

function tokenize(value) {
  const source = normalizeLocationKey(value);
  if (!source) {
    return [];
  }
  return source
    .split(' ')
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
}

function splitSentences(text) {
  const source = String(text || '');
  if (!source.trim()) {
    return [];
  }

  return source
    .split(/[.!?\n]+/u)
    .map((item) => normalizeWhitespace(item))
    .filter(Boolean);
}

function shouldTreatAsLocation(name) {
  const normalized = normalizeLocationKey(name);
  if (!normalized || normalized.length < 3) {
    return false;
  }

  const tokens = normalized.split(' ').filter(Boolean);
  if (tokens.length < 2 || tokens.length > 9) {
    return false;
  }

  const first = tokens[0];
  const second = tokens[1] || '';
  const last = tokens[tokens.length - 1];
  const prefix2 = `${first} ${second}`.trim();

  const hasPrefix = LOCATION_PREFIX_BIGRAMS.has(prefix2) || LOCATION_PREFIX_TOKENS.has(first);
  const hasSuffix = LOCATION_SUFFIX_TOKENS.has(last);
  const noiseCount = tokens
    .map((token) => (LOCATION_NOISE_TOKENS.has(token) ? 1 : 0))
    .reduce((sum, item) => sum + item, 0);

  if (!(hasPrefix || hasSuffix)) {
    return false;
  }
  if (tokens.length >= 5 && noiseCount >= 2) {
    return false;
  }

  return true;
}

function trimLocationPhrase(value) {
  const tokens = normalizeWhitespace(value).split(' ').filter(Boolean);
  if (!tokens.length) return '';

  const kept = [];
  for (const token of tokens) {
    const normalizedToken = normalizeLocationKey(token);
    if (LOCATION_FRAGMENT_STOP_TOKENS.has(normalizedToken)) {
      break;
    }
    kept.push(token);
    if (kept.length >= 6) break;
  }

  return kept.join(' ').trim();
}

function extractLocationCandidatesFromSentence(sentence) {
  const candidates = [];
  const source = normalizeWhitespace(sentence);
  if (!source) {
    return candidates;
  }

  // Matches patterns like "tai truong trung hoc A".
  const prepositionPattern = /\b(?:tai|o|at|in)\s+([^,.;:!?]{4,80})/giu;
  for (const match of source.matchAll(prepositionPattern)) {
    const value = trimLocationPhrase(match[1]);
    if (!value) {
      continue;
    }

    const capped = value.split(' ').slice(0, 6).join(' ');
    if (shouldTreatAsLocation(capped)) {
      candidates.push(capped);
    }
  }

  const phrasePattern = /\b([\p{L}\p{N}]+(?:\s+[\p{L}\p{N}]+){1,7})/gu;
  for (const match of source.matchAll(phrasePattern)) {
    const value = trimLocationPhrase(match[1]);
    if (!value || !shouldTreatAsLocation(value)) {
      continue;
    }
    candidates.push(value);
  }

  return [...new Set(candidates)];
}

function pickSnippet(text, query, maxLength = 220) {
  const source = normalizeWhitespace(text);
  if (!source) {
    return '';
  }

  const needle = normalizeWhitespace(query).toLowerCase();
  const index = needle ? source.toLowerCase().indexOf(needle) : -1;

  if (index < 0) {
    const base = source.slice(0, maxLength).trim();
    return source.length > maxLength ? `${base}...` : base;
  }

  const start = Math.max(0, index - Math.floor(maxLength * 0.3));
  const end = Math.min(source.length, start + maxLength);
  const snippet = source.slice(start, end).trim();
  return `${start > 0 ? '...' : ''}${snippet}${end < source.length ? '...' : ''}`;
}

function gatherChunksById(chunks) {
  const map = new Map();
  for (const chunk of (chunks || [])) {
    if (!chunk?.id) {
      continue;
    }

    map.set(chunk.id, {
      id: chunk.id,
      chapterId: chunk.chapterId || null,
      chapterIndex: parseChapter(chunk.chapterIndex),
      chunkIndex: Number.isFinite(Number(chunk.chunkIndex)) ? Number(chunk.chunkIndex) : null,
      text: String(chunk.text || ''),
    });
  }
  return map;
}

function average(values = []) {
  if (!values.length) {
    return 0;
  }
  return values.reduce((sum, item) => sum + Number(item || 0), 0) / values.length;
}

function createLocationEntity(input) {
  const normalized = normalizeLocationKey(input.name);
  const mentionCount = input.mentions?.length || 0;
  const chapterSpread = input.chapterSet.size;

  const importance = round((mentionCount * 1.2) + (chapterSpread * 1.8), 3);
  const isMajor = mentionCount >= input.options.majorLocationMentionThreshold || chapterSpread >= 2;

  const sortedMentions = [...input.mentions]
    .sort((a, b) => (Number(a.chapterIndex || 0) - Number(b.chapterIndex || 0)))
    .slice(0, input.options.maxEvidencePerLocation);

  const tokens = [...new Set(tokenize(`${input.name} ${sortedMentions.map((item) => item.snippet).join(' ')}`))];

  return {
    id: `loc_${hashString(normalized)}`,
    name: input.name,
    normalized,
    mentionCount,
    chapterSpread,
    chapterStart: sortedMentions.length
      ? Math.min(...sortedMentions.map((item) => Number(item.chapterIndex || 0)).filter((n) => n > 0))
      : null,
    chapterEnd: sortedMentions.length
      ? Math.max(...sortedMentions.map((item) => Number(item.chapterIndex || 0)).filter((n) => n > 0))
      : null,
    importance,
    isMajor,
    tokens,
    evidence: sortedMentions,
  };
}

export function extractLocationEntities(chunks = [], options = {}) {
  const mergedOptions = {
    ...DEFAULT_OPTIONS,
    ...(options || {}),
  };

  const buckets = new Map();

  for (const chunk of chunks || []) {
    const text = String(chunk?.text || '');
    if (!text.trim()) {
      continue;
    }

    const chapterIndex = parseChapter(chunk?.chapterIndex);
    const sentences = splitSentences(text);

    for (const sentence of sentences) {
      const candidates = extractLocationCandidatesFromSentence(sentence);
      for (const candidate of candidates) {
        const normalized = normalizeLocationKey(candidate);
        if (!normalized) {
          continue;
        }

        const existing = buckets.get(normalized) || {
          name: candidate,
          chapterSet: new Set(),
          mentions: [],
          options: mergedOptions,
        };

        if (chapterIndex) {
          existing.chapterSet.add(chapterIndex);
        }

        existing.mentions.push({
          chunkId: chunk.id || null,
          chapterId: chunk.chapterId || null,
          chapterIndex,
          chunkIndex: Number.isFinite(Number(chunk.chunkIndex)) ? Number(chunk.chunkIndex) : null,
          snippet: pickSnippet(sentence, candidate, 180),
        });

        if (candidate.length > existing.name.length) {
          existing.name = candidate;
        }

        buckets.set(normalized, existing);
      }
    }
  }

  const locations = [...buckets.values()]
    .map((item) => createLocationEntity(item))
    .filter((item) => (
      item.mentionCount >= mergedOptions.minLocationMentions
      || item.chapterSpread >= 2
      || item.isMajor
    ))
    .sort((a, b) => (b.importance - a.importance) || (b.mentionCount - a.mentionCount));

  return {
    locations,
    stats: {
      totalLocations: locations.length,
      majorLocations: locations.filter((item) => item.isMajor).length,
    },
  };
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeExternalLocationEntity(item, options = {}) {
  if (!item || typeof item !== 'object') {
    return null;
  }

  const name = normalizeWhitespace(item.name || item.location || item.label || '');
  const tokenCount = tokenize(name).length;
  const hasDescription = Boolean(normalizeWhitespace(item.description || ''));
  if (!name || tokenCount < (hasDescription ? 1 : 2) || tokenCount > 8 || name.length > 84) {
    return null;
  }

  const normalized = normalizeLocationKey(name);
  const chapterStart = parseChapter(item.chapterStart ?? item.chapter_start);
  const chapterEnd = parseChapter(item.chapterEnd ?? item.chapter_end ?? chapterStart);
  const spreadRaw = Number(item.chapterSpread || item.chapter_spread);
  const chapterSpread = chapterStart && chapterEnd
    ? Math.max(1, Math.abs(chapterEnd - chapterStart) + 1)
    : (Number.isFinite(spreadRaw) && spreadRaw > 0 ? spreadRaw : 1);
  const mentionCount = Math.max(1, Number(item.mentionCount || item.mentions || 1));

  return {
    id: item.id || `loc_${hashString(normalized)}`,
    name,
    normalized,
    mentionCount,
    chapterSpread,
    chapterStart: chapterStart || null,
    chapterEnd: chapterEnd || null,
    importance: round(Number(item.importance || 0)),
    isMajor: Boolean(item.isMajor || mentionCount >= options.majorLocationMentionThreshold),
    tokens: [...new Set(tokenize(`${name} ${normalizeWhitespace(item.description || '')}`))],
    evidence: toArray(item.evidence)
      .map((ev) => {
        if (!ev || typeof ev !== 'object') return null;
        return {
          chunkId: ev.chunkId || null,
          chapterId: ev.chapterId || null,
          chapterIndex: parseChapter(ev.chapterIndex),
          chunkIndex: Number.isFinite(Number(ev.chunkIndex)) ? Number(ev.chunkIndex) : null,
          snippet: normalizeWhitespace(ev.snippet || ev.evidence || ''),
        };
      })
      .filter(Boolean),
    aliases: toArray(item.aliases).map((alias) => normalizeWhitespace(alias)).filter(Boolean),
    description: normalizeWhitespace(item.description || ''),
  };
}

function mergeLocationEntities(extracted = [], external = [], options = {}) {
  const map = new Map();

  const put = (location) => {
    if (!location?.normalized) return;
    const existing = map.get(location.normalized);
    if (!existing) {
      map.set(location.normalized, location);
      return;
    }

    const mentionCount = Math.max(Number(existing.mentionCount || 0), Number(location.mentionCount || 0));
    const chapterSpread = Math.max(Number(existing.chapterSpread || 0), Number(location.chapterSpread || 0));
    const chapterStart = [existing.chapterStart, location.chapterStart]
      .filter((x) => Number.isFinite(Number(x)) && Number(x) > 0);
    const chapterEnd = [existing.chapterEnd, location.chapterEnd]
      .filter((x) => Number.isFinite(Number(x)) && Number(x) > 0);

    map.set(location.normalized, {
      ...existing,
      ...location,
      name: existing.name.length >= location.name.length ? existing.name : location.name,
      mentionCount,
      chapterSpread,
      chapterStart: chapterStart.length ? Math.min(...chapterStart) : null,
      chapterEnd: chapterEnd.length ? Math.max(...chapterEnd) : null,
      isMajor: Boolean(existing.isMajor || location.isMajor),
      importance: Math.max(Number(existing.importance || 0), Number(location.importance || 0)),
      aliases: [...new Set([...(existing.aliases || []), ...(location.aliases || [])])],
      description: normalizeWhitespace(existing.description || location.description || ''),
      tokens: [...new Set([...(existing.tokens || []), ...(location.tokens || [])])],
      evidence: [...new Map(
        [...(existing.evidence || []), ...(location.evidence || [])]
          .filter((item) => item?.snippet)
          .map((item) => [item.snippet, item]),
      ).values()].slice(0, options.maxEvidencePerLocation || 4),
    });
  };

  for (const item of extracted || []) {
    put(item);
  }
  for (const item of external || []) {
    put(item);
  }

  return [...map.values()]
    .filter((item) => (
      item.mentionCount >= (options.minLocationMentions || 2)
      || item.chapterSpread >= 2
      || item.isMajor
      || Boolean(normalizeWhitespace(item.description || ''))
    ))
    .sort((a, b) => (Number(b.importance || 0) - Number(a.importance || 0)));
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

function toEventObject(event) {
  if (event && typeof event === 'object') {
    return { ...event };
  }
  if (typeof event === 'string') {
    return { description: normalizeWhitespace(event) };
  }
  return null;
}

function resolveEventArrays(eventsLayer) {
  const keys = new Set();
  for (const key of EVENT_ARRAY_KEYS) {
    if (Array.isArray(eventsLayer?.[key])) {
      keys.add(key);
    }
  }

  for (const [key, value] of Object.entries(eventsLayer || {})) {
    if (Array.isArray(value) && value.length > 0) {
      const lower = key.toLowerCase();
      if (lower.includes('event') || lower.includes('twist') || lower.includes('cliff')) {
        keys.add(key);
      }
    }
  }

  return [...keys];
}

function scoreLocationForEvent({ event, description, eventTokens, location, chunksById }) {
  const descLower = description.toLowerCase();
  const locationNameLower = location.name.toLowerCase();
  const explicitMentions = [event?.location, event?.place, event?.setting, event?.site]
    .map((item) => normalizeWhitespace(item).toLowerCase())
    .filter(Boolean);

  let explicitBoost = 0;
  if (descLower.includes(locationNameLower)) {
    explicitBoost += 1.35;
  }

  for (const mention of explicitMentions) {
    if (mention.includes(location.normalized) || location.normalized.includes(mention)) {
      explicitBoost += 1.5;
      break;
    }
  }

  let overlapCount = 0;
  for (const token of eventTokens) {
    if (location.tokens.includes(token)) {
      overlapCount += 1;
    }
  }
  const overlap = overlapCount / Math.max(1, new Set(eventTokens).size);

  const eventChapter = parseChapter(event?.chapter ?? event?.chapterIndex ?? event?.grounding?.chapterIndex);

  let chapterPrior = 0;
  if (eventChapter && location.chapterStart && location.chapterEnd) {
    const center = (location.chapterStart + location.chapterEnd) / 2;
    const diff = Math.abs(eventChapter - center);
    chapterPrior = Math.max(0, 1 - (diff / 8)) * 0.8;
  }

  let groundingBoost = 0;
  const chunkId = event?.grounding?.chunkId || null;
  if (chunkId && location.evidence.some((item) => item.chunkId === chunkId)) {
    groundingBoost = 0.9;
  }

  const score = explicitBoost + (overlap * 1.25) + chapterPrior + groundingBoost + (location.isMajor ? 0.2 : 0);

  const evidence = (() => {
    if (chunkId && chunksById.has(chunkId)) {
      const chunk = chunksById.get(chunkId);
      return pickSnippet(chunk.text, location.name, 220);
    }

    const first = location.evidence[0];
    return first?.snippet || '';
  })();

  return {
    location,
    score,
    overlap,
    overlapCount,
    explicitBoost,
    chapterPrior,
    groundingBoost,
    evidence,
  };
}

function computeLinkConfidence(best, second) {
  if (!best) {
    return 0;
  }

  const strength = clamp(best.score / 3.8, 0, 1);
  const margin = clamp((best.score - (second?.score || 0)) / Math.max(1, Math.abs(best.score)), 0, 1);
  const explicit = clamp(best.explicitBoost / 1.5, 0, 1);

  return clamp((strength * 0.55) + (margin * 0.3) + (explicit * 0.15), 0, 1);
}

function enrichEventLocation(event, context) {
  const eventObj = toEventObject(event);
  if (!eventObj) {
    return event;
  }

  const description = resolveEventDescription(eventObj);
  const eventTokens = tokenize([
    description,
    Array.isArray(eventObj.tags) ? eventObj.tags.join(' ') : eventObj.tags,
    Array.isArray(eventObj.characters) ? eventObj.characters.join(' ') : eventObj.characters,
  ].filter(Boolean).join(' '));

  let best = null;
  let second = null;

  for (const location of context.locations) {
    const candidate = scoreLocationForEvent({
      event: eventObj,
      description,
      eventTokens,
      location,
      chunksById: context.chunksById,
    });

    if (!best || candidate.score > best.score) {
      second = best;
      best = candidate;
    } else if (!second || candidate.score > second.score) {
      second = candidate;
    }
  }

  const confidence = round(computeLinkConfidence(best, second), 4);
  const canLink = best && best.score >= context.options.linkThreshold;

  const locationLink = canLink
    ? {
      locationId: best.location.id,
      locationName: best.location.name,
      confidence,
      evidenceSnippet: best.evidence,
      isMajorLocation: best.location.isMajor,
      score: round(best.score),
      overlap: round(best.overlap),
      source: 'lexical+chapter',
    }
    : null;

  const result = {
    ...eventObj,
    locationLink,
    primaryLocationId: locationLink?.locationId || null,
    primaryLocationName: locationLink?.locationName || null,
  };

  for (const key of NESTED_EVENT_KEYS) {
    if (!Array.isArray(eventObj[key])) {
      continue;
    }

    result[key] = eventObj[key]
      .map((item) => enrichEventLocation(item, context))
      .filter(Boolean);
  }

  return result;
}

export function linkEventLocations(result = {}, chunks = [], locations = [], options = {}) {
  const mergedOptions = {
    ...DEFAULT_OPTIONS,
    ...(options || {}),
  };

  const eventsLayer = result?.events;
  if (!eventsLayer || typeof eventsLayer !== 'object') {
    return {
      result,
      stats: {
        totalEvents: 0,
        linkedEvents: 0,
        lowConfidenceLinks: 0,
      },
    };
  }

  const context = {
    options: mergedOptions,
    locations,
    chunksById: gatherChunksById(chunks),
  };

  const keys = resolveEventArrays(eventsLayer);
  const nextEvents = { ...eventsLayer };

  for (const key of keys) {
    const list = nextEvents[key];
    if (!Array.isArray(list)) {
      continue;
    }

    nextEvents[key] = list
      .map((event) => enrichEventLocation(event, context))
      .filter(Boolean);
  }

  let totalEvents = 0;
  let linkedEvents = 0;
  let lowConfidenceLinks = 0;

  const visit = (event) => {
    if (!event || typeof event !== 'object') {
      return;
    }

    totalEvents += 1;

    const confidence = Number(event.locationLink?.confidence || 0);
    if (event.locationLink?.locationId) {
      linkedEvents += 1;
      if (confidence < 0.45) {
        lowConfidenceLinks += 1;
      }
    }

    for (const key of NESTED_EVENT_KEYS) {
      if (!Array.isArray(event[key])) {
        continue;
      }
      for (const child of event[key]) {
        visit(child);
      }
    }
  };

  for (const key of keys) {
    for (const event of (nextEvents[key] || [])) {
      visit(event);
    }
  }

  return {
    result: {
      ...result,
      events: nextEvents,
      locations,
    },
    stats: {
      totalEvents,
      linkedEvents,
      lowConfidenceLinks,
    },
  };
}

function toSeverityRank(severity) {
  const value = String(severity || '').toLowerCase();
  if (value === 'crucial') return 4;
  if (value === 'major') return 3;
  if (value === 'moderate') return 2;
  return 1;
}

function gatherFlatEvents(eventsLayer = {}) {
  const keys = resolveEventArrays(eventsLayer);
  const flat = [];

  const visit = (event, type) => {
    const eventObj = toEventObject(event);
    if (!eventObj) {
      return;
    }

    flat.push({
      ...eventObj,
      _sourceType: type,
      _chapter: parseChapter(eventObj.chapter ?? eventObj.chapterIndex ?? eventObj.grounding?.chapterIndex) || 0,
      _severityRank: toSeverityRank(eventObj.severity),
    });

    for (const key of NESTED_EVENT_KEYS) {
      if (!Array.isArray(eventObj[key])) {
        continue;
      }

      for (const child of eventObj[key]) {
        visit(child, type);
      }
    }
  };

  for (const key of keys) {
    const list = eventsLayer[key] || [];
    const lower = key.toLowerCase();
    const normalizedType = lower.includes('minor')
      ? 'minor'
      : (lower.includes('major') ? 'major' : (lower.includes('twist') ? 'twist' : 'event'));
    for (const event of list) {
      visit(event, normalizedType);
    }
  }

  return flat;
}

function chooseIncidentAnchor(events) {
  const sorted = [...events].sort((a, b) => {
    if (b._severityRank !== a._severityRank) {
      return b._severityRank - a._severityRank;
    }
    return Number((b.qualityProxy || b.quality?.score || 0) - (a.qualityProxy || a.quality?.score || 0));
  });

  return sorted[0] || null;
}

export function buildIncidentClusters(result = {}, options = {}) {
  const mergedOptions = {
    ...DEFAULT_OPTIONS,
    ...(options || {}),
  };

  const eventsLayer = result?.events;
  if (!eventsLayer || typeof eventsLayer !== 'object') {
    return {
      result,
      stats: {
        incidentCount: 0,
        incidentEventCoverage: 0,
      },
    };
  }

  const allEvents = gatherFlatEvents(eventsLayer);
  if (!allEvents.length) {
    return {
      result,
      stats: {
        incidentCount: 0,
        incidentEventCoverage: 0,
      },
    };
  }

  const anchors = allEvents.filter((event) => (
    event._severityRank >= 3
    || ['major', 'twist'].includes(event._sourceType)
  ));

  const clusters = [];
  for (const anchor of anchors) {
    const locationId = anchor.locationLink?.locationId || 'unknown';
    const chapter = anchor._chapter || 0;

    const existing = clusters.find((cluster) => (
      cluster.locationId === locationId
      && Math.abs(cluster.chapterCenter - chapter) <= mergedOptions.incidentChapterWindow
    ));

    if (existing) {
      existing.anchorEvents.push(anchor);
      existing.chapterCenter = round((existing.chapterCenter + chapter) / 2, 3);
      continue;
    }

    clusters.push({
      id: `incident_${hashString(`${locationId}_${chapter}_${anchor.id || anchor.description}`)}`,
      locationId,
      locationName: anchor.locationLink?.locationName || 'Chua xac dinh dia diem',
      locationConfidence: Number(anchor.locationLink?.confidence || 0),
      chapterCenter: chapter,
      anchorEvents: [anchor],
      events: [],
    });
  }

  for (const event of allEvents) {
    let best = null;
    let bestScore = 0;

    for (const cluster of clusters) {
      let score = 0;

      if ((event.locationLink?.locationId || 'unknown') === cluster.locationId) {
        score += 1.2;
      }

      const chapterDiff = Math.abs((event._chapter || 0) - cluster.chapterCenter);
      if (chapterDiff <= 1) score += 0.8;
      else if (chapterDiff <= mergedOptions.incidentChapterWindow) score += 0.4;

      if (event._severityRank >= 3) {
        score += 0.2;
      }

      if (score > bestScore) {
        bestScore = score;
        best = cluster;
      }
    }

    if (best && bestScore >= 0.9) {
      best.events.push(event);
    }
  }

  const incidents = clusters
    .map((cluster) => {
      const uniqueEvents = [...new Map(cluster.events.map((item) => [item.id || `${item.description}_${item._chapter}`, item])).values()];
      if (!uniqueEvents.length) {
        return null;
      }

      const anchor = chooseIncidentAnchor(cluster.anchorEvents.length ? cluster.anchorEvents : uniqueEvents);
      const chapters = uniqueEvents.map((item) => item._chapter).filter((value) => value > 0);
      const chapterStart = chapters.length ? Math.min(...chapters) : null;
      const chapterEnd = chapters.length ? Math.max(...chapters) : null;

      const locationConfidence = average(uniqueEvents.map((item) => Number(item.locationLink?.confidence || 0)));
      const confidence = clamp((locationConfidence * 0.65) + (Math.min(uniqueEvents.length, 8) / 8) * 0.35, 0, 1);

      const eventIds = uniqueEvents
        .map((item) => item.id)
        .filter(Boolean);

      return {
        id: cluster.id,
        title: anchor?.description
          ? `${cluster.locationName} - ${anchor.description.slice(0, 80)}`
          : `${cluster.locationName} - Cum su kien`,
        location: {
          id: cluster.locationId !== 'unknown' ? cluster.locationId : null,
          name: cluster.locationName,
          confidence: round(locationConfidence, 4),
          isMajor: Boolean(anchor?.locationLink?.isMajorLocation),
        },
        chapterStart,
        chapterEnd,
        confidence: round(confidence, 4),
        anchorEventId: anchor?.id || null,
        anchorEventDescription: anchor?.description || '',
        eventIds,
        eventCount: eventIds.length,
        subeventCount: Math.max(0, eventIds.length - 1),
        evidenceSnippet: anchor?.locationLink?.evidenceSnippet || anchor?.grounding?.evidenceSnippet || '',
        tags: [...new Set(uniqueEvents.flatMap((item) => Array.isArray(item.tags) ? item.tags : []))].slice(0, 10),
      };
    })
    .filter(Boolean)
    .sort((a, b) => (b.confidence - a.confidence) || (b.eventCount - a.eventCount))
    .slice(0, mergedOptions.maxIncidentCount);

  const incidentMap = new Map();
  for (const incident of incidents) {
    for (const eventId of incident.eventIds) {
      if (!incidentMap.has(eventId)) {
        incidentMap.set(eventId, incident.id);
      }
    }
  }

  const keys = resolveEventArrays(eventsLayer);
  const taggedEvents = { ...eventsLayer };

  const tagIncident = (event) => {
    const eventObj = toEventObject(event);
    if (!eventObj) {
      return event;
    }

    const incidentId = eventObj.id ? incidentMap.get(eventObj.id) || null : null;
    const next = {
      ...eventObj,
      incidentId,
    };

    for (const key of NESTED_EVENT_KEYS) {
      if (!Array.isArray(eventObj[key])) {
        continue;
      }
      next[key] = eventObj[key].map((child) => tagIncident(child)).filter(Boolean);
    }

    return next;
  };

  for (const key of keys) {
    const list = taggedEvents[key];
    if (!Array.isArray(list)) {
      continue;
    }

    taggedEvents[key] = list.map((event) => tagIncident(event)).filter(Boolean);
  }

  return {
    result: {
      ...result,
      events: taggedEvents,
      incidents,
    },
    stats: {
      incidentCount: incidents.length,
      incidentEventCoverage: round(incidentMap.size / Math.max(1, allEvents.length), 4),
    },
  };
}

export function enrichWithIncidentIntelligence(result = {}, chunks = [], options = {}) {
  const mergedOptions = {
    ...DEFAULT_OPTIONS,
    ...(options || {}),
  };

  const extracted = extractLocationEntities(chunks, mergedOptions);
  const seeded = toArray(result?.locations)
    .map((item) => normalizeExternalLocationEntity(item, mergedOptions))
    .filter(Boolean);
  const mergedLocations = mergeLocationEntities(
    extracted.locations,
    seeded,
    mergedOptions,
  );

  const linked = linkEventLocations(result, chunks, mergedLocations, mergedOptions);
  const clustered = buildIncidentClusters(linked.result, mergedOptions);

  return {
    result: clustered.result,
    stats: {
      locations: extracted.stats,
      locationSeed: {
        seededLocations: seeded.length,
        mergedLocations: mergedLocations.length,
      },
      eventLocationLinks: linked.stats,
      incidents: clustered.stats,
    },
  };
}
