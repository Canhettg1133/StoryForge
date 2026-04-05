import { randomUUID } from 'node:crypto';
import { parseAIJsonValue } from '../../../utils/aiJson.js';
import { ANALYSIS_CONFIG } from '../analysisConfig.js';
import { extractKnowledgeProfile, mergeKnowledgeProfile } from '../grounding/knowledgeExtraction.js';
import { mergeOutputParts, shouldContinueOutput } from '../outputChunker.js';
import { runIncidentAnalysis } from '../pipeline/incidentAnalyzer.js';
import { buildDeepIncidentPassPrompt } from '../prompts/deepIncidentPassPrompt.js';
import { buildGlobalIncidentPassPrompt } from '../prompts/globalIncidentPassPrompt.js';
import SessionClient from '../sessionClient.js';

const DEFAULT_OPTIONS = {
  maxGlobalWords: 900000,
  maxGlobalIncidents: 130,
  maxGlobalParts: 6,
  maxGlobalOutputTokens: ANALYSIS_CONFIG.session.maxOutputPerPart,
  maxDeepParts: 3,
  maxDeepOutputTokens: 18000,
  perIncidentMaxWords: 900000,
  maxEventsPerIncident: 24,
  maxKnowledgeEvents: 260,
};

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function toObject(value) {
  return value && typeof value === 'object' ? value : {};
}

function normalizeText(value) {
  return String(value || '').replace(/\s+/gu, ' ').trim();
}

function parseChapter(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'string') {
    const match = value.match(/(\d{1,5})/u);
    if (match) {
      const parsed = Number(match[1]);
      return Number.isFinite(parsed) ? Math.floor(parsed) : null;
    }
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.floor(parsed) : null;
}

function countWords(text) {
  const normalized = normalizeText(text);
  if (!normalized) return 0;
  return normalized.split(/\s+/u).length;
}

function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function clampChapter(value, chapterCount, fallback = null) {
  const n = parseChapter(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.min(Math.max(1, chapterCount), n));
}

function emitProgress(onProgress, phase, progress, message) {
  onProgress({
    phase,
    progress: Math.max(0, Math.min(1, Number(progress) || 0)),
    message: normalizeText(message),
  });
}

function parseKeyList(value) {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.map((item) => normalizeText(item)).filter(Boolean);
  }
  return String(value)
    .split(/[\n,;]+/u)
    .map((item) => item.trim())
    .filter(Boolean);
}

function resolveApiKeys(options = {}) {
  return [...new Set([
    ...parseKeyList(options.apiKeys),
    ...parseKeyList(options.apiKey),
    ...parseKeyList(process.env.STORYFORGE_GEMINI_PROXY_KEYS),
    ...parseKeyList(process.env.STORYFORGE_GEMINI_PROXY_KEY),
    ...parseKeyList(process.env.STORYFORGE_PROXY_API_KEY),
    ...parseKeyList(process.env.STORYFORGE_GEMINI_DIRECT_API_KEYS),
    ...parseKeyList(process.env.STORYFORGE_GEMINI_DIRECT_API_KEY),
    ...parseKeyList(process.env.GEMINI_API_KEY),
  ])];
}

function canUseAi(options = {}) {
  const model = normalizeText(options.model);
  const keys = resolveApiKeys(options);
  return Boolean(model && keys.length > 0);
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function sumTokenUsage(parts = []) {
  return parts.reduce((acc, part) => ({
    promptTokenCount: acc.promptTokenCount + toNumber(part?.usageMetadata?.promptTokenCount, 0),
    candidatesTokenCount: acc.candidatesTokenCount + toNumber(part?.usageMetadata?.candidatesTokenCount, 0),
    totalTokenCount: acc.totalTokenCount + toNumber(part?.usageMetadata?.totalTokenCount, 0),
  }), {
    promptTokenCount: 0,
    candidatesTokenCount: 0,
    totalTokenCount: 0,
  });
}

function mergeUsage(left = {}, right = {}) {
  return {
    promptTokenCount: toNumber(left.promptTokenCount, 0) + toNumber(right.promptTokenCount, 0),
    candidatesTokenCount: toNumber(left.candidatesTokenCount, 0) + toNumber(right.candidatesTokenCount, 0),
    totalTokenCount: toNumber(left.totalTokenCount, 0) + toNumber(right.totalTokenCount, 0),
  };
}

function throwIfAborted(signal) {
  if (!signal?.aborted) return;
  const error = new Error('Analysis cancelled');
  error.code = 'ANALYSIS_CANCELLED';
  throw error;
}

function normalizeSeverityText(value) {
  const s = normalizeText(value).toLowerCase();
  if (['crucial', 'critical', 'key'].includes(s)) return 'crucial';
  if (['major', 'important', 'significant'].includes(s)) return 'major';
  if (['minor', 'small'].includes(s)) return 'minor';
  if (['moderate', 'medium'].includes(s)) return 'moderate';
  return 'major';
}

function severityFromNumeric(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 'major';
  if (n >= 0.85) return 'crucial';
  if (n >= 0.65) return 'major';
  if (n >= 0.4) return 'moderate';
  return 'minor';
}

function normalizeStringArray(value) {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeText(item)).filter(Boolean);
  }
  if (typeof value === 'string') {
    return value
      .split(/[\n,;]+/u)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

function buildChaptersFromChunks(chunks = []) {
  const grouped = new Map();

  for (const chunk of chunks) {
    const text = normalizeText(chunk?.text || '');
    if (!text) continue;

    const rawChapterIndex = Number.isFinite(Number(chunk?.chapterIndex))
      ? Number(chunk.chapterIndex)
      : 0;
    if (!grouped.has(rawChapterIndex)) {
      grouped.set(rawChapterIndex, { rawChapterIndex, rows: [] });
    }

    grouped.get(rawChapterIndex).rows.push({
      orderA: Number.isFinite(Number(chunk?.startPosition)) ? Number(chunk.startPosition) : Number.MAX_SAFE_INTEGER,
      orderB: Number.isFinite(Number(chunk?.chunkIndex)) ? Number(chunk.chunkIndex) : Number.MAX_SAFE_INTEGER,
      text,
    });
  }

  return [...grouped.values()]
    .sort((a, b) => a.rawChapterIndex - b.rawChapterIndex)
    .map((group, index) => {
      const orderedRows = group.rows
        .slice()
        .sort((a, b) => (a.orderA - b.orderA) || (a.orderB - b.orderB));
      const content = orderedRows.map((row) => row.text).join('\n\n').trim();
      const chapterNumber = index + 1;

      return {
        chapterIndex: index,
        chapterNumber,
        title: `Chapter ${chapterNumber}`,
        content,
        text: content,
        wordCount: countWords(content),
      };
    })
    .filter((chapter) => chapter.content);
}

function collectContext(chapters = [], maxWords = 900000) {
  const safeMaxWords = Math.max(1000, Number(maxWords) || 900000);
  const selected = [];
  let totalWords = 0;

  for (const chapter of chapters) {
    const words = Math.max(0, Number(chapter.wordCount) || countWords(chapter.content));
    if (selected.length > 0 && totalWords + words > safeMaxWords) break;
    selected.push(chapter);
    totalWords += words;
  }

  const text = selected
    .map((chapter) => `Chapter ${chapter.chapterNumber}: ${chapter.title}\n${chapter.content}`)
    .join('\n\n')
    .trim();

  return { chapters: selected, text, wordCount: totalWords };
}

function collectIncidentContext(chapters = [], incident = {}, maxWords = 900000) {
  const chapterCount = Math.max(1, chapters.length);
  const start = clampChapter(incident.chapterStart, chapterCount, 1);
  const end = clampChapter(incident.chapterEnd, chapterCount, start);
  const inRange = chapters.filter((chapter) => chapter.chapterNumber >= start && chapter.chapterNumber <= end);
  return collectContext(inRange.length ? inRange : chapters, maxWords);
}

async function callStepJsonMultipart({
  prompt,
  inputText,
  options = {},
  signal,
  maxOutputTokens,
  maxParts = 3,
  apiKeyCursorStart = 0,
}) {
  const sessionClient = new SessionClient({
    provider: options.provider,
    model: options.model,
    apiKey: options.apiKey,
    apiKeys: options.apiKeys,
    apiKeyCursorStart,
    proxyUrl: options.proxyUrl,
    directUrl: options.directUrl,
    temperature: Number.isFinite(Number(options.temperature)) ? Number(options.temperature) : 0.2,
    maxOutputTokens: Math.max(1000, Number(maxOutputTokens) || ANALYSIS_CONFIG.session.maxOutputPerPart),
  });

  const limitParts = Math.max(1, Number(maxParts) || 1);
  const responses = [];
  const texts = [];

  try {
    throwIfAborted(signal);
    let response = await sessionClient.startSession(inputText, prompt, { signal });
    responses.push(response);
    texts.push(String(response?.text || ''));

    let hasMore = shouldContinueOutput({
      text: response?.text || '',
      finishReason: response?.finishReason,
      maxOutputTokens,
    });

    let currentPart = 1;
    while (hasMore && currentPart < limitParts) {
      throwIfAborted(signal);
      currentPart += 1;
      response = await sessionClient.continueSession(ANALYSIS_CONFIG.session.continuePrompt, { signal });
      responses.push(response);
      texts.push(String(response?.text || ''));
      hasMore = shouldContinueOutput({
        text: response?.text || '',
        finishReason: response?.finishReason,
        maxOutputTokens,
      });
    }

    if (hasMore) {
      const error = new Error(`AI output incomplete after ${limitParts} parts`);
      error.code = 'ANALYSIS_OUTPUT_INCOMPLETE';
      throw error;
    }

    let parsed;
    try {
      parsed = mergeOutputParts(texts);
    } catch {
      parsed = parseAIJsonValue(texts.join('\n'));
    }

    return {
      parsed: toObject(parsed),
      partCount: texts.length,
      usageMetadata: sumTokenUsage(responses),
    };
  } finally {
    sessionClient.endSession();
  }
}

function normalizeIncidentType(value) {
  const s = normalizeText(value).toLowerCase();
  if (['major_plot_point', 'major', 'main'].includes(s)) return 'major_plot_point';
  if (['pov_thread', 'pov'].includes(s)) return 'pov_thread';
  return 'subplot';
}

function normalizeGlobalIncidents(raw = {}, chapterCount = 1, maxIncidents = 130) {
  const source = toArray(raw?.incidents);
  const chapterSamples = source.flatMap((item) => [
    parseChapter(item?.chapterStart ?? item?.startChapter),
    parseChapter(item?.chapterEnd ?? item?.endChapter),
  ]).filter((item) => Number.isFinite(item));
  const likelyZeroBased = chapterSamples.length > 0 && chapterSamples.some((item) => item === 0);

  const normalized = [];
  for (let index = 0; index < source.length; index += 1) {
    const item = source[index];
    const title = normalizeText(item?.title || item?.name || item?.description || '');
    if (!title) continue;

    const rawStart = parseChapter(item?.chapterStart ?? item?.startChapter);
    const rawEnd = parseChapter(item?.chapterEnd ?? item?.endChapter ?? rawStart);
    if (!Number.isFinite(rawStart) || !Number.isFinite(rawEnd)) continue;

    const start = clampChapter(rawStart + (likelyZeroBased ? 1 : 0), chapterCount, 1);
    const end = clampChapter(rawEnd + (likelyZeroBased ? 1 : 0), chapterCount, start);
    const confidence = clampNumber(item?.confidence, 0, 1, 0.65);

    normalized.push({
      id: normalizeText(item?.id || '') || `inc_1m_${index + 1}_${randomUUID().slice(0, 8)}`,
      title,
      type: normalizeIncidentType(item?.type),
      chapterStart: Math.min(start, end),
      chapterEnd: Math.max(start, end),
      confidence,
      description: normalizeText(item?.description || ''),
      why: normalizeText(item?.why || ''),
      anchorEventDescription: normalizeText(item?.anchorEventDescription || ''),
      locationHint: normalizeText(item?.locationHint || ''),
      tags: normalizeStringArray(item?.tags),
      boundaryNote: normalizeText(item?.boundaryNote || ''),
      evidence: normalizeStringArray(item?.evidence).slice(0, 8),
    });
  }

  const deduped = new Map();
  for (const item of normalized) {
    const key = `${item.chapterStart}|${item.chapterEnd}|${item.title.toLowerCase()}`;
    const existing = deduped.get(key);
    if (!existing || item.confidence > existing.confidence) {
      deduped.set(key, item);
    }
  }

  return [...deduped.values()]
    .sort((a, b) => (a.chapterStart - b.chapterStart) || (b.confidence - a.confidence))
    .slice(0, Math.max(1, Number(maxIncidents) || 130));
}

function normalizeIncidentPatch(raw = {}) {
  return {
    description: normalizeText(raw?.description || ''),
    why: normalizeText(raw?.why || raw?.trigger || ''),
    preconditions: normalizeStringArray(raw?.preconditions),
    progression: normalizeStringArray(raw?.progression),
    turning_points: normalizeStringArray(raw?.turning_points || raw?.turningPoints),
    climax: normalizeText(raw?.climax || ''),
    outcome: normalizeText(raw?.outcome || ''),
    consequences: normalizeStringArray(raw?.consequences),
    evidence_refs: normalizeStringArray(raw?.evidence_refs || raw?.evidenceRefs),
  };
}

function normalizeDeepEvents(rawEvents = [], incident = {}, chapterCount = 1, maxEventsPerIncident = 24) {
  const source = toArray(rawEvents).filter((item) => item && typeof item === 'object');
  const chapterSamples = source
    .map((item) => parseChapter(item?.chapter ?? item?.chapterIndex))
    .filter((item) => Number.isFinite(item));
  const likelyZeroBased = chapterSamples.length > 0 && chapterSamples.some((item) => item === 0);

  const result = [];
  for (let index = 0; index < source.length; index += 1) {
    const item = source[index];
    const description = normalizeText(item?.description || item?.summary || item?.title || '');
    if (!description || description.length < 8) continue;

    const rawChapter = parseChapter(item?.chapter ?? item?.chapterIndex ?? incident.chapterStart);
    const chapter = clampChapter(
      (rawChapter == null ? incident.chapterStart : rawChapter) + (likelyZeroBased ? 1 : 0),
      chapterCount,
      clampChapter(incident.chapterStart, chapterCount, 1),
    );
    const positionRaw = normalizeText(item?.position || '').toLowerCase();
    const position = ['beginning', 'middle', 'end'].includes(positionRaw) ? positionRaw : 'middle';

    const severity = normalizeSeverityText(item?.severity);
    const eventTypeRaw = normalizeText(item?.eventType || item?.type).toLowerCase();
    const eventType = ['major', 'minor', 'twist', 'cliffhanger'].includes(eventTypeRaw)
      ? eventTypeRaw
      : (severity === 'minor' ? 'minor' : 'major');

    const emotionalIntensity = Math.round(clampNumber(item?.emotionalIntensity, 1, 10, 7));
    const insertability = Math.round(clampNumber(item?.insertability, 1, 10, 6));
    const evidence = normalizeStringArray(item?.evidence);
    const evidenceSnippet = normalizeText(item?.evidenceSnippet || evidence[0] || '');
    const locationName = normalizeText(item?.locationName || item?.location || item?.locationHint || '');

    result.push({
      id: normalizeText(item?.id || '') || `evt_1m_${incident.id}_${index + 1}`,
      description,
      chapter,
      position,
      severity,
      eventType,
      emotionalIntensity,
      insertability,
      characters: normalizeStringArray(item?.characters),
      tags: normalizeStringArray(item?.tags),
      locationName,
      evidence,
      evidenceSnippet,
      incidentId: incident.id,
    });
  }

  return result.slice(0, Math.max(1, Number(maxEventsPerIncident) || 24));
}

function normalizeTimeline(raw = [], chapterCount = 1) {
  return toArray(raw)
    .filter((item) => item && typeof item === 'object')
    .map((item) => ({
      eventId: normalizeText(item?.eventId || item?.id || '') || null,
      chapter: clampChapter(item?.chapter, chapterCount, null),
      summary: normalizeText(item?.summary || item?.description || ''),
    }))
    .filter((item) => item.eventId || item.chapter || item.summary);
}

function normalizeDeepLocations(rawLocations = [], incident = {}, chapterCount = 1) {
  const source = toArray(rawLocations).filter((item) => item && typeof item === 'object');
  const normalized = [];

  for (let index = 0; index < source.length; index += 1) {
    const item = source[index];
    const name = normalizeText(item?.name || item?.location || item?.label || '');
    if (!name) continue;

    normalized.push({
      id: normalizeText(item?.id || '') || `loc_1m_${incident.id}_${index + 1}`,
      name,
      description: normalizeText(item?.description || item?.summary || ''),
      aliases: normalizeStringArray(item?.aliases),
      timeline: normalizeTimeline(item?.timeline, chapterCount),
      mentionCount: Math.max(1, Number(item?.mentionCount) || 1),
      importance: clampNumber(item?.importance, 0, 1, 0.6),
      confidence: clampNumber(item?.confidence, 0, 1, 0.65),
      isMajor: Boolean(item?.isMajor ?? true),
      incidentIds: [incident.id],
      evidence: normalizeStringArray(item?.evidence),
    });
  }

  return normalized;
}

function dedupeEvents(events = []) {
  const map = new Map();
  for (const event of events) {
    if (!event) continue;
    const key = normalizeText(event.id) || [
      normalizeText(event.incidentId),
      normalizeText(event.description).toLowerCase(),
      event.chapter || '',
    ].join('|');
    if (!key) continue;
    if (!map.has(key)) {
      map.set(key, event);
      continue;
    }
    const existing = map.get(key);
    map.set(key, {
      ...existing,
      ...event,
      characters: [...new Set([...(existing.characters || []), ...(event.characters || [])])],
      tags: [...new Set([...(existing.tags || []), ...(event.tags || [])])],
      evidence: [...new Set([...(existing.evidence || []), ...(event.evidence || [])])],
      evidenceSnippet: existing.evidenceSnippet || event.evidenceSnippet,
    });
  }
  return [...map.values()];
}

function dedupeLocations(locations = []) {
  const map = new Map();
  for (const location of locations) {
    if (!location) continue;
    const key = normalizeText(location.name).toLowerCase();
    if (!key) continue;
    if (!map.has(key)) {
      map.set(key, location);
      continue;
    }
    const existing = map.get(key);
    map.set(key, {
      ...existing,
      ...location,
      name: existing.name || location.name,
      description: existing.description || location.description,
      aliases: [...new Set([...(existing.aliases || []), ...(location.aliases || [])])],
      incidentIds: [...new Set([...(existing.incidentIds || []), ...(location.incidentIds || [])])],
      evidence: [...new Set([...(existing.evidence || []), ...(location.evidence || [])])],
      mentionCount: Math.max(Number(existing.mentionCount || 0), Number(location.mentionCount || 0)),
      confidence: Math.max(Number(existing.confidence || 0), Number(location.confidence || 0)),
      importance: Math.max(Number(existing.importance || 0), Number(location.importance || 0)),
    });
  }
  return [...map.values()];
}

function bucketFromEventType(event = {}) {
  const eventType = normalizeText(event.eventType).toLowerCase();
  if (eventType === 'twist') return 'plotTwists';
  if (eventType === 'cliffhanger') return 'cliffhangers';
  if (eventType === 'minor') return 'minorEvents';
  if (eventType === 'major') return 'majorEvents';

  const severity = normalizeSeverityText(event.severity);
  return severity === 'minor' ? 'minorEvents' : 'majorEvents';
}

function buildEventsLayer(events = [], locations = []) {
  const locationMap = new Map(
    locations.map((item) => [normalizeText(item?.name).toLowerCase(), item]).filter(([name]) => Boolean(name)),
  );

  const layer = {
    majorEvents: [],
    minorEvents: [],
    plotTwists: [],
    cliffhangers: [],
  };

  for (const event of events) {
    if (!event?.description) continue;
    const location = event.locationName
      ? locationMap.get(normalizeText(event.locationName).toLowerCase())
      : null;

    const mapped = {
      id: event.id || `evt_1m_${randomUUID().slice(0, 8)}`,
      description: event.description,
      chapter: clampChapter(event.chapter, 99999, null),
      position: event.position || 'middle',
      severity: normalizeSeverityText(event.severity),
      emotionalIntensity: Math.round(clampNumber(event.emotionalIntensity, 1, 10, 7)),
      insertability: Math.round(clampNumber(event.insertability, 1, 10, 6)),
      characters: toArray(event.characters),
      tags: toArray(event.tags),
      incidentId: event.incidentId || null,
      evidenceSnippet: normalizeText(event.evidenceSnippet || event.evidence?.[0] || ''),
      locationLink: location
        ? { locationId: location.id || null, locationName: location.name || '' }
        : (event.locationName ? { locationId: null, locationName: event.locationName } : null),
      _type: normalizeText(event.eventType || ''),
    };

    const bucket = bucketFromEventType(event);
    layer[bucket].push(mapped);
  }

  return layer;
}

function buildIncidentsLayer(incidents = [], deepByIncident = new Map(), chapterCount = 1) {
  return incidents.map((incident) => {
    const deep = deepByIncident.get(incident.id) || {};
    const patch = deep.patch || {};
    const events = toArray(deep.events);
    const incidentLocations = toArray(deep.locations);
    const topLocation = incidentLocations[0] || null;

    return {
      id: incident.id,
      title: incident.title,
      type: incident.type,
      chapterStart: clampChapter(incident.chapterStart, chapterCount, 1),
      chapterEnd: clampChapter(incident.chapterEnd, chapterCount, clampChapter(incident.chapterStart, chapterCount, 1)),
      confidence: clampNumber(incident.confidence, 0, 1, 0.65),
      description: patch.description || incident.description || '',
      why: patch.why || incident.why || '',
      preconditions: patch.preconditions || [],
      progression: patch.progression || [],
      turning_points: patch.turning_points || [],
      climax: patch.climax || '',
      outcome: patch.outcome || '',
      consequences: patch.consequences || [],
      evidence_refs: patch.evidence_refs || [],
      tags: incident.tags || [],
      anchorEventDescription: incident.anchorEventDescription || '',
      eventIds: events.map((event) => event.id).filter(Boolean),
      eventCount: events.length,
      subeventCount: events.length,
      evidenceSnippet: normalizeText((incident.evidence || [])[0] || ''),
      location: topLocation
        ? {
          id: topLocation.id || null,
          name: topLocation.name || '',
          confidence: clampNumber(topLocation.confidence, 0, 1, 0.6),
          isMajor: Boolean(topLocation.isMajor),
        }
        : null,
    };
  });
}

function normalizeHeuristicEvent(event = {}, index = 0) {
  const description = normalizeText(event.description || event.title || '');
  if (!description) return null;

  const chapterRaw = parseChapter(event.chapter ?? event.chapterIndex);
  const chapter = Number.isFinite(chapterRaw) ? Math.max(1, chapterRaw + (chapterRaw === 0 ? 1 : 0)) : null;
  const severity = typeof event.severity === 'number'
    ? severityFromNumeric(event.severity)
    : normalizeSeverityText(event.severity);
  const eventType = normalizeText(event._type || '').toLowerCase();

  return {
    id: normalizeText(event.id || '') || `evt_fallback_${index + 1}_${randomUUID().slice(0, 8)}`,
    description,
    chapter,
    position: 'middle',
    severity,
    eventType: ['major', 'minor', 'twist', 'cliffhanger'].includes(eventType) ? eventType : 'major',
    emotionalIntensity: 6,
    insertability: 6,
    characters: normalizeStringArray(event.characters),
    tags: normalizeStringArray(event.tags),
    locationName: normalizeText(event.locationLink?.locationName || ''),
    evidence: normalizeStringArray(event.evidence),
    evidenceSnippet: normalizeText((event.evidence || [])[0] || ''),
    incidentId: normalizeText(event.incidentId || ''),
  };
}

function normalizeHeuristicIncident(incident = {}, index = 0, chapterCount = 1) {
  const title = normalizeText(incident.title || incident.description || '');
  if (!title) return null;

  const start = clampChapter(
    parseChapter(incident.startChapter ?? incident.chapterStart) + 1,
    chapterCount,
    1,
  );
  const end = clampChapter(
    parseChapter(incident.endChapter ?? incident.chapterEnd ?? incident.startChapter ?? incident.chapterStart) + 1,
    chapterCount,
    start,
  );

  return {
    id: normalizeText(incident.id || '') || `inc_fallback_${index + 1}_${randomUUID().slice(0, 8)}`,
    title,
    type: normalizeIncidentType(incident.type),
    chapterStart: Math.min(start, end),
    chapterEnd: Math.max(start, end),
    confidence: clampNumber(incident.confidence, 0, 1, 0.6),
    description: normalizeText(incident.description || ''),
    why: '',
    anchorEventDescription: '',
    tags: normalizeStringArray(incident.tags),
    evidence: normalizeStringArray(incident.evidence),
  };
}

function buildFinalResult({
  incidents = [],
  events = [],
  locations = [],
  knowledge = null,
  mode = 'incident_only_1m',
  tokenUsage = null,
}) {
  const dedupedEvents = dedupeEvents(events);
  const dedupedLocations = dedupeLocations(locations);
  const eventsLayer = buildEventsLayer(dedupedEvents, dedupedLocations);
  const deepMap = new Map();

  for (const incident of incidents) {
    const incidentEvents = dedupedEvents.filter((event) => event.incidentId === incident.id);
    const incidentLocations = dedupedLocations.filter((location) => (location.incidentIds || []).includes(incident.id));
    deepMap.set(incident.id, {
      patch: normalizeIncidentPatch({
        description: incident.description,
        why: incident.why,
        preconditions: incident.preconditions,
        progression: incident.progression,
        turning_points: incident.turning_points,
        climax: incident.climax,
        outcome: incident.outcome,
        consequences: incident.consequences,
        evidence_refs: incident.evidence_refs,
      }),
      events: incidentEvents,
      locations: incidentLocations,
    });
  }

  const chapterCount = dedupedEvents.reduce(
    (max, event) => Math.max(max, Number(event.chapter) || 1),
    1,
  );
  const incidentsLayer = buildIncidentsLayer(incidents, deepMap, chapterCount);

  const worldProfile = toObject(knowledge?.world_profile);
  const worldbuilding = {
    setting: {
      worldName: normalizeText(worldProfile.world_name || ''),
      worldType: normalizeText(worldProfile.world_type || ''),
      worldScale: normalizeText(worldProfile.world_scale || ''),
      worldEra: normalizeText(worldProfile.world_era || ''),
      rules: normalizeStringArray(worldProfile.world_rules),
      description: normalizeText(worldProfile.world_description || ''),
    },
    powers: {},
    magicSystem: {},
    locations: toArray(knowledge?.locations).length ? toArray(knowledge.locations) : dedupedLocations,
    objects: toArray(knowledge?.objects),
    terms: toArray(knowledge?.terms),
  };

  const result = {
    meta: {
      part: 1,
      hasMore: false,
      complete: true,
      coveredLayers: ['l1', 'l2', 'l3', 'l4', 'l5', 'l6'],
      runMode: mode,
    },
    structural: {
      characters: [],
      ships: [],
      tropes: [],
      metadata: {},
    },
    events: eventsLayer,
    worldbuilding,
    characters: {
      profiles: toArray(knowledge?.characters),
    },
    locations: worldbuilding.locations,
    objects: worldbuilding.objects,
    terms: worldbuilding.terms,
    relationships: {
      ships: [],
      plotHoles: [],
      unresolvedThreads: [],
    },
    craft: {
      style: {},
      emotional: {},
      pacing: {},
      dialogueTechniques: {},
    },
    incidents: incidentsLayer,
    summary: {
      rarityScore: 0,
      keyTakeaways: incidentsLayer.slice(0, 8).map((item) => item.title),
      mostInsertableEvents: dedupedEvents.slice(0, 12).map((item) => item.description),
      mostInsertableCharacters: toArray(knowledge?.characters).slice(0, 12).map((item) => item.name).filter(Boolean),
      warnings: [],
      genre: '',
      targetAudience: '',
    },
  };

  if (knowledge && typeof knowledge === 'object') {
    result.knowledge = knowledge;
    result.world_profile = knowledge.world_profile || null;
    return mergeKnowledgeProfile(result, knowledge);
  }

  if (tokenUsage) {
    result.tokenUsage = tokenUsage;
  }

  return result;
}

function buildHeuristicArtifacts(corpusId, chapters = [], options = {}) {
  const heuristic = runIncidentAnalysis(
    corpusId,
    {
      chapters: chapters.map((chapter) => ({
        chapterIndex: chapter.chapterIndex,
        title: chapter.title,
        content: chapter.content,
      })),
      incidents: [],
      events: [],
      locations: [],
      consistencyRisks: [],
    },
    {
      ...options,
      mode: 'deep',
    },
  );

  const incidents = toArray(heuristic.incidents)
    .map((item, index) => normalizeHeuristicIncident(item, index, Math.max(1, chapters.length)))
    .filter(Boolean);
  const events = toArray(heuristic.events)
    .map((item, index) => normalizeHeuristicEvent(item, index))
    .filter(Boolean);
  const locations = toArray(heuristic.locations).map((item) => ({
    id: normalizeText(item?.id || '') || `loc_fallback_${randomUUID().slice(0, 8)}`,
    name: normalizeText(item?.name || ''),
    description: normalizeText(item?.description || ''),
    aliases: normalizeStringArray(item?.aliases),
    timeline: normalizeTimeline(item?.timeline || [], Math.max(1, chapters.length)),
    mentionCount: Math.max(1, Number(item?.mentionCount) || 1),
    importance: clampNumber(item?.importance, 0, 1, 0.5),
    confidence: clampNumber(item?.confidence, 0, 1, 0.6),
    isMajor: Boolean(item?.isMajor),
    incidentIds: normalizeStringArray(item?.incidentIds),
    evidence: normalizeStringArray(item?.evidence),
  })).filter((item) => item.name);

  return { incidents, events, locations };
}

async function runPassA({
  chapters,
  options,
  modeOptions,
  signal,
}) {
  const context = collectContext(chapters, modeOptions.maxGlobalWords);
  if (!context.text) {
    return {
      incidents: [],
      usage: { promptTokenCount: 0, candidatesTokenCount: 0, totalTokenCount: 0 },
      partsGenerated: 0,
    };
  }

  const prompt = buildGlobalIncidentPassPrompt({
    chapterCount: chapters.length,
    maxIncidents: modeOptions.maxGlobalIncidents,
    outputBudget: modeOptions.maxGlobalOutputTokens,
  });

  const ai = await callStepJsonMultipart({
    prompt,
    inputText: context.text,
    options,
    signal,
    maxOutputTokens: modeOptions.maxGlobalOutputTokens,
    maxParts: modeOptions.maxGlobalParts,
  });

  return {
    incidents: normalizeGlobalIncidents(ai.parsed, chapters.length, modeOptions.maxGlobalIncidents),
    usage: ai.usageMetadata,
    partsGenerated: ai.partCount,
  };
}

async function runPassB({
  incidents,
  chapters,
  options,
  modeOptions,
  signal,
  onProgress,
}) {
  const keyPool = resolveApiKeys(options);
  const concurrency = Math.max(1, Math.min(Math.max(1, keyPool.length), incidents.length || 1));

  const deepByIncident = new Map();
  const allEvents = [];
  const allLocations = [];
  let partsGenerated = 0;
  let usage = { promptTokenCount: 0, candidatesTokenCount: 0, totalTokenCount: 0 };

  const processOneIncident = async (incident, globalIndex) => {
    const context = collectIncidentContext(chapters, incident, modeOptions.perIncidentMaxWords);
    if (!context.text) {
      return {
        incidentId: incident.id,
        patch: normalizeIncidentPatch({}),
        events: [],
        locations: [],
        usageMetadata: { promptTokenCount: 0, candidatesTokenCount: 0, totalTokenCount: 0 },
        partCount: 0,
      };
    }

    const prompt = buildDeepIncidentPassPrompt(incident, {
      chapterCount: chapters.length,
      eventBudget: modeOptions.maxEventsPerIncident,
    });

    const ai = await callStepJsonMultipart({
      prompt,
      inputText: context.text,
      options,
      signal,
      maxOutputTokens: modeOptions.maxDeepOutputTokens,
      maxParts: modeOptions.maxDeepParts,
      apiKeyCursorStart: globalIndex,
    });

    const parsed = toObject(ai.parsed);
    const patch = normalizeIncidentPatch(parsed.incident || parsed.summary || {});
    const events = normalizeDeepEvents(
      parsed.events || parsed.timelineEvents || [],
      incident,
      chapters.length,
      modeOptions.maxEventsPerIncident,
    );
    const locations = normalizeDeepLocations(parsed.locations || [], incident, chapters.length);

    return {
      incidentId: incident.id,
      patch,
      events,
      locations,
      usageMetadata: ai.usageMetadata,
      partCount: ai.partCount,
    };
  };

  for (let batchStart = 0; batchStart < incidents.length; batchStart += concurrency) {
    throwIfAborted(signal);
    const batch = incidents.slice(batchStart, batchStart + concurrency);
    const settled = await Promise.allSettled(
      batch.map((incident, index) => processOneIncident(incident, batchStart + index)),
    );

    for (let i = 0; i < settled.length; i += 1) {
      const result = settled[i];
      const globalIndex = batchStart + i;
      const progress = incidents.length
        ? 0.45 + ((globalIndex + 1) / incidents.length) * 0.32
        : 0.77;
      emitProgress(
        onProgress,
        'incident_1m_pass_b',
        progress,
        `Deep pass ${Math.min(globalIndex + 1, incidents.length)}/${incidents.length}`,
      );

      if (result.status !== 'fulfilled') continue;
      const value = result.value;
      deepByIncident.set(value.incidentId, {
        patch: value.patch,
        events: value.events,
        locations: value.locations,
      });
      allEvents.push(...value.events);
      allLocations.push(...value.locations);
      partsGenerated += Number(value.partCount || 0);
      usage = mergeUsage(usage, value.usageMetadata);
    }
  }

  return {
    deepByIncident,
    events: dedupeEvents(allEvents),
    locations: dedupeLocations(allLocations),
    usage,
    partsGenerated,
  };
}

export async function runIncidentOnly1MJob({
  corpusId,
  chunks = [],
  options = {},
  signal,
  onProgress = () => {},
} = {}) {
  if (!corpusId) {
    const error = new Error('Missing corpusId for incident_only_1m job');
    error.code = 'INVALID_INPUT';
    throw error;
  }

  const modeOptions = {
    ...DEFAULT_OPTIONS,
    ...toObject(options.ai),
  };
  const chapters = buildChaptersFromChunks(chunks);
  if (!chapters.length) {
    const error = new Error('Corpus does not contain readable chapter text');
    error.code = 'EMPTY_CORPUS_CHUNKS';
    throw error;
  }

  emitProgress(onProgress, 'incident_1m_bootstrap', 0.04, 'Preparing 1M corpus context');
  const heuristicArtifacts = buildHeuristicArtifacts(corpusId, chapters, options);

  if (!canUseAi(options)) {
    const finalResult = buildFinalResult({
      incidents: heuristicArtifacts.incidents,
      events: heuristicArtifacts.events,
      locations: heuristicArtifacts.locations,
      mode: 'incident_only_1m',
    });
    return {
      success: true,
      incidentCount: heuristicArtifacts.incidents.length,
      aiSteps: [],
      partsGenerated: 0,
      finalResult,
      aiApplied: false,
      reason: 'missing_model_or_key',
    };
  }

  const aiSteps = [];
  let totalPartsGenerated = 0;
  let tokenUsage = { promptTokenCount: 0, candidatesTokenCount: 0, totalTokenCount: 0 };

  try {
    throwIfAborted(signal);
    emitProgress(onProgress, 'incident_1m_pass_a', 0.18, 'Pass A: global major-incident extraction');
    const passA = await runPassA({
      chapters,
      options,
      modeOptions,
      signal,
    });

    totalPartsGenerated += Number(passA.partsGenerated || 0);
    tokenUsage = mergeUsage(tokenUsage, passA.usage);

    let incidents = passA.incidents.length
      ? passA.incidents
      : heuristicArtifacts.incidents;
    if (passA.incidents.length > 0) {
      aiSteps.push('pass_a_global_incidents');
    }

    if (!incidents.length) {
      const finalResult = buildFinalResult({
        incidents: heuristicArtifacts.incidents,
        events: heuristicArtifacts.events,
        locations: heuristicArtifacts.locations,
        mode: 'incident_only_1m',
        tokenUsage,
      });
      return {
        success: true,
        incidentCount: 0,
        aiSteps,
        partsGenerated: totalPartsGenerated,
        finalResult,
        aiApplied: aiSteps.length > 0,
        reason: 'no_incidents',
      };
    }

    emitProgress(onProgress, 'incident_1m_pass_b', 0.42, 'Pass B: parallel deep analysis per incident');
    const passB = await runPassB({
      incidents,
      chapters,
      options,
      modeOptions,
      signal,
      onProgress,
    });

    totalPartsGenerated += Number(passB.partsGenerated || 0);
    tokenUsage = mergeUsage(tokenUsage, passB.usage);
    if (passB.events.length > 0 || passB.locations.length > 0) {
      aiSteps.push('pass_b_deep_parallel');
    }

    const deepByIncident = passB.deepByIncident;
    incidents = incidents.map((incident) => {
      const deep = deepByIncident.get(incident.id);
      if (!deep) return incident;
      const patch = deep.patch || {};
      return {
        ...incident,
        description: patch.description || incident.description || '',
        why: patch.why || incident.why || '',
        preconditions: patch.preconditions || [],
        progression: patch.progression || [],
        turning_points: patch.turning_points || [],
        climax: patch.climax || '',
        outcome: patch.outcome || '',
        consequences: patch.consequences || [],
        evidence_refs: patch.evidence_refs || [],
      };
    });

    const baseEvents = passB.events.length ? passB.events : heuristicArtifacts.events;
    const baseLocations = passB.locations.length ? passB.locations : heuristicArtifacts.locations;
    let finalResult = buildFinalResult({
      incidents,
      events: baseEvents,
      locations: baseLocations,
      mode: 'incident_only_1m',
      tokenUsage,
    });

    emitProgress(onProgress, 'incident_1m_pass_c', 0.84, 'Pass C: knowledge extraction from incidents/events');
    let knowledge = null;
    try {
      const extracted = await extractKnowledgeProfile(
        finalResult,
        {
          ...options,
          maxEvents: modeOptions.maxKnowledgeEvents,
        },
        signal,
      );
      if (extracted?.applied && extracted?.data) {
        knowledge = extracted.data;
        finalResult = mergeKnowledgeProfile(finalResult, extracted.data);
        aiSteps.push('pass_c_knowledge');
      }
      tokenUsage = mergeUsage(tokenUsage, extracted?.usageMetadata || {});
    } catch {
      // Keep finalResult from previous step as fallback.
    }

    emitProgress(onProgress, 'incident_1m_finalize', 0.95, 'Finalizing incident-only analysis');
    finalResult = {
      ...finalResult,
      tokenUsage,
      meta: {
        ...(finalResult.meta || {}),
        aiSteps,
        incidentCount: incidents.length,
        aiApplied: aiSteps.length > 0,
      },
      knowledge: knowledge || finalResult.knowledge || null,
    };

    return {
      success: true,
      incidentCount: incidents.length,
      aiSteps,
      partsGenerated: totalPartsGenerated,
      finalResult,
      aiApplied: aiSteps.length > 0,
    };
  } catch (error) {
    const fallback = buildFinalResult({
      incidents: heuristicArtifacts.incidents,
      events: heuristicArtifacts.events,
      locations: heuristicArtifacts.locations,
      mode: 'incident_only_1m',
      tokenUsage,
    });

    return {
      success: true,
      incidentCount: heuristicArtifacts.incidents.length,
      aiSteps,
      partsGenerated: totalPartsGenerated,
      finalResult: fallback,
      aiApplied: aiSteps.length > 0,
      aiError: error?.message || 'incident_only_1m_failed',
    };
  }
}

export default {
  runIncidentOnly1MJob,
};
