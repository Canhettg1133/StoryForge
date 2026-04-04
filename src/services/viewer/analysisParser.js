/**
 * Analysis Parser - Parse L1-L6 results từ Phase 3
 * Chuyển đổi raw analysis output thành structured data cho viewer
 */

import { parseJsonField } from '../analysis/outputChunker.js';

export const AUTO_ACCEPT_QUALITY_THRESHOLD = 60;
export const AUTO_ACCEPT_CHAPTER_CONFIDENCE_THRESHOLD = 0.45;

/**
 * Parse full analysis results (L1-L6)
 */
export function parseAnalysisResults(rawResults) {
  if (!rawResults) return null;

  return {
    // L1: Structural
    structural: rawResults.structural || parseJsonField(rawResults.resultL1, {}),
    characters: extractCharacters(rawResults),
    ships: extractShips(rawResults),
    tropes: extractTropes(rawResults),
    metadata: extractMetadata(rawResults),

    // L2: Events
    events: parseEvents(rawResults),
    locations: parseLocations(rawResults),
    incidents: parseIncidents(rawResults),

    // L3: World-building
    worldbuilding: rawResults.worldbuilding || parseJsonField(rawResults.resultL3, {}),

    // L4: Characters profiles
    characterProfiles: parseCharacterProfiles(rawResults),

    // L5: Relationships
    relationships: parseRelationships(rawResults),

    // L6: Craft
    craft: rawResults.craft || parseJsonField(rawResults.resultL6, {}),

    // Summary
    summary: extractSummary(rawResults),

    // Raw layers for reference
    layers: {
      l1: parseJsonField(rawResults.resultL1, null),
      l2: parseJsonField(rawResults.resultL2, null),
      l3: parseJsonField(rawResults.resultL3, null),
      l4: parseJsonField(rawResults.resultL4, null),
      l5: parseJsonField(rawResults.resultL5, null),
      l6: parseJsonField(rawResults.resultL6, null),
    },
  };
}

function extractCharacters(raw) {
  const l1 = raw?.structural || raw?.resultL1 || {};
  const chars = l1?.characters || l1?.characterList || [];
  if (Array.isArray(chars)) return chars;
  if (typeof chars === 'object') return Object.values(chars);
  return [];
}

function extractShips(raw) {
  const l1 = raw?.structural || raw?.resultL1 || {};
  const ships = l1?.relationships || l1?.ships || [];
  if (Array.isArray(ships)) return ships;
  if (typeof ships === 'object') return Object.values(ships);
  return [];
}

function extractTropes(raw) {
  const l1 = raw?.structural || raw?.resultL1 || {};
  const tropes = l1?.tropes || l1?.commonTropes || [];
  if (Array.isArray(tropes)) return tropes;
  if (typeof tropes === 'object') return Object.values(tropes);
  return [];
}

function extractMetadata(raw) {
  const l1 = raw?.structural || raw?.resultL1 || {};
  return {
    title: l1?.title || l1?.storyTitle || '',
    genre: l1?.genre || l1?.genres || '',
    targetAudience: l1?.targetAudience || '',
    pov: l1?.pov || '',
    tense: l1?.tense || '',
    rating: l1?.rating || '',
    warnings: l1?.warnings || [],
    tags: l1?.tags || [],
    wordCount: l1?.wordCount || raw?.meta?.wordCount || 0,
    chapters: l1?.chapters || raw?.meta?.chapters || 0,
  };
}

function parseEvents(raw) {
  const l2 = raw?.events || raw?.resultL2 || {};

  const major = normalizeEventArray(
    l2?.majorEvents || l2?.major || l2?.major_events || [],
    'major',
  );
  const minor = normalizeEventArray(
    l2?.minorEvents || l2?.minor || l2?.minor_events || [],
    'minor',
  );
  const twists = normalizeEventArray(
    l2?.plotTwists || l2?.twists || l2?.plot_twists || [],
    'twist',
  );
  const cliffhangers = normalizeEventArray(
    l2?.cliffhangers || l2?.cliffhanger || l2?.cliff_hangers || [],
    'cliffhanger',
  );

  return { major, minor, twists, cliffhangers };
}

function parseLocations(raw) {
  const source = raw?.locations || raw?.locationEntities || raw?.worldbuilding?.locations || [];
  if (!Array.isArray(source)) return [];

  return source
    .map((location) => normalizeLocation(location))
    .filter(Boolean);
}

function normalizeLocation(location) {
  if (!location) return null;
  if (typeof location === 'string') {
    const name = String(location || '').trim();
    if (!name) return null;
    return {
      id: generateEventId({ location: name }),
      name,
      normalized: name.toLowerCase(),
      mentionCount: 1,
      chapterSpread: 0,
      chapterStart: null,
      chapterEnd: null,
      importance: 0,
      isMajor: false,
      evidence: [],
    };
  }

  const name = String(location.name || location.label || '').trim();
  if (!name) return null;

  return {
    id: location.id || generateEventId({ location: name }),
    name,
    normalized: String(location.normalized || name).toLowerCase(),
    mentionCount: Number.isFinite(Number(location.mentionCount)) ? Number(location.mentionCount) : 0,
    chapterSpread: Number.isFinite(Number(location.chapterSpread)) ? Number(location.chapterSpread) : 0,
    chapterStart: parseChapter(location.chapterStart),
    chapterEnd: parseChapter(location.chapterEnd),
    importance: Number.isFinite(Number(location.importance)) ? Number(location.importance) : 0,
    isMajor: Boolean(location.isMajor),
    evidence: Array.isArray(location.evidence) ? location.evidence : [],
  };
}

function parseIncidents(raw) {
  const source = raw?.incidents || raw?.incidentClusters || [];
  if (!Array.isArray(source)) return [];

  return source
    .map((incident) => normalizeIncident(incident))
    .filter(Boolean);
}

function normalizeIncident(incident) {
  if (!incident || typeof incident !== 'object') return null;

  const title = String(incident.title || incident.name || incident.anchorEventDescription || '').trim();
  if (!title) return null;

  return {
    id: incident.id || generateEventId({ incident: title }),
    title,
    location: incident.location ? normalizeIncidentLocation(incident.location) : null,
    chapterStart: parseChapter(incident.chapterStart),
    chapterEnd: parseChapter(incident.chapterEnd),
    confidence: clamp(incident.confidence ?? incident.score ?? 0, 0, 1),
    anchorEventId: incident.anchorEventId || null,
    anchorEventDescription: String(incident.anchorEventDescription || '').trim(),
    eventIds: Array.isArray(incident.eventIds)
      ? incident.eventIds.map((item) => String(item || '').trim()).filter(Boolean)
      : [],
    eventCount: Number.isFinite(Number(incident.eventCount))
      ? Number(incident.eventCount)
      : (Array.isArray(incident.eventIds) ? incident.eventIds.length : 0),
    subeventCount: Number.isFinite(Number(incident.subeventCount)) ? Number(incident.subeventCount) : 0,
    evidenceSnippet: String(incident.evidenceSnippet || '').trim(),
    tags: Array.isArray(incident.tags) ? normalizeTags(incident.tags) : [],
  };
}

function normalizeIncidentLocation(location) {
  if (!location || typeof location !== 'object') return null;
  const name = String(location.name || '').trim();
  if (!name) return null;

  return {
    id: location.id || null,
    name,
    confidence: clamp(location.confidence ?? 0, 0, 1),
    isMajor: Boolean(location.isMajor),
  };
}

function normalizeEventArray(arr, sourceType = 'event') {
  if (!Array.isArray(arr)) return [];
  return arr
    .map((event) => normalizeEvent(event, sourceType))
    .filter(Boolean);
}

function normalizeEvent(event, sourceType = 'event') {
  if (typeof event === 'string') {
    event = { description: event };
  }

  if (!event || typeof event !== 'object') return null;

  const eventType = normalizeEventType(event._type || event.type || sourceType);
  const description = resolveEventDescription(event);
  if (!isMeaningfulDescription(description)) {
    return null;
  }

  const chapter = parseChapter(
    event.chapter
    ?? event.chapterIndex
    ?? event.chapterNo
    ?? event.chapterNumber
    ?? event.ch
    ?? extractChapterFromText(description),
  );

  const subevents = normalizeEventArray(event.subevents || event.subEvents || [], eventType);
  const children = normalizeEventArray(event.children || [], eventType);

  const id = event.id || event.eventId || generateEventId({
    description,
    chapter,
    eventType,
  });

  const chapterConfidence = normalizeConfidence(
    event.chapterConfidence
    ?? event.chapter_confidence
    ?? event.grounding?.chapterConfidence
    ?? event.grounding?.confidence,
  );

  const grounding = normalizeGrounding(event.grounding);
  const locationLink = normalizeLocationLink(
    event.locationLink
    || event.location
    || event.placeLink
    || null,
  );
  const reviewStatus = normalizeReviewStatus(event.reviewStatus);
  const qualityScore = calculateEventQualityScore({
    description,
    chapter,
    severity: event.severity,
    emotionalIntensity: event.emotionalIntensity ?? event.intensity,
    insertability: event.insertability,
    chapterConfidence,
    evidenceSnippet: grounding?.evidenceSnippet,
  });
  const derivedReviewStatus = (
    qualityScore >= AUTO_ACCEPT_QUALITY_THRESHOLD
    && (chapterConfidence == null || chapterConfidence >= AUTO_ACCEPT_CHAPTER_CONFIDENCE_THRESHOLD)
  )
    ? 'auto_accepted'
    : 'needs_review';
  const finalReviewStatus = reviewStatus || derivedReviewStatus;
  const needsReview = event.needsReview === true || finalReviewStatus === 'needs_review';

  return {
    id,
    description,
    severity: normalizeSeverity(event.severity, eventType),
    chapter,
    chapterEnd: parseChapter(event.chapterEnd),
    position: event.position || event.chapterPosition || 'middle',
    canonOrFanon: normalizeCanonFanon(event.canonOrFanon || event.type),
    rarity: normalizeRarity(event.rarity),
    tags: normalizeTags(event.tags),
    characters: normalizeCharacterList(event.characters || event.involvedCharacters || []),
    ships: normalizeShipList(event.ships || event.relationships || []),
    emotionalIntensity: normalizeScore(
      event.emotionalIntensity ?? event.intensity ?? event.emotionalIntensityScore,
      1,
      10,
    ),
    insertability: normalizeScore(
      event.insertability ?? event.insertabilityScore,
      1,
      10,
    ),
    chapterConfidence,
    locationLink,
    primaryLocationId: event.primaryLocationId || locationLink?.locationId || null,
    primaryLocationName: event.primaryLocationName || locationLink?.locationName || null,
    incidentId: event.incidentId || event.incident_id || null,
    reviewStatus: finalReviewStatus,
    needsReview,
    grounding,
    subevents,
    children,
    annotation: null,
    _type: eventType,
    quality: {
      hasChapter: chapter != null,
      hasSeverity: Boolean(event.severity),
      hasGrounding: Boolean(grounding?.chunkId),
      score: qualityScore,
      autoAccepted: finalReviewStatus === 'auto_accepted',
    },
  };
}

function generateEventId(event) {
  const str = JSON.stringify(event);
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + ch;
    hash |= 0;
  }
  return `evt_${Math.abs(hash).toString(36)}`;
}

function normalizeEventType(value) {
  const s = String(value || '').toLowerCase().trim();
  if (['major', 'major_event', 'major-events'].includes(s)) return 'major';
  if (['minor', 'minor_event', 'minor-events'].includes(s)) return 'minor';
  if (['twist', 'plot_twist', 'plot-twist', 'plottwist'].includes(s)) return 'twist';
  if (['cliffhanger', 'cliff_hanger', 'cliff-hanger'].includes(s)) return 'cliffhanger';
  return 'event';
}

function normalizeSeverity(sev, eventType = 'event') {
  const s = String(sev || '').toLowerCase();
  if (['crucial', 'critical', 'key'].includes(s)) return 'crucial';
  if (['major', 'important', 'significant'].includes(s)) return 'major';
  if (['moderate', 'medium'].includes(s)) return 'moderate';

  if (eventType === 'twist') return 'crucial';
  if (eventType === 'cliffhanger') return 'major';
  if (eventType === 'major') return 'major';
  if (eventType === 'minor') return 'minor';
  return 'moderate';
}

function parseChapter(ch) {
  if (ch == null || ch === '') return null;

  if (typeof ch === 'string') {
    const match = ch.match(/(\d{1,4})/u);
    if (match) {
      const extracted = Number(match[1]);
      return Number.isFinite(extracted) && extracted > 0 ? Math.floor(extracted) : null;
    }
  }

  const n = Number(ch);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

function extractChapterFromText(text) {
  const source = String(text || '').trim();
  if (!source) {
    return null;
  }

  const match = source.match(/\b(?:ch(?:apter)?|chuong|chương)\s*[\.:#-]?\s*(\d{1,4})\b/iu);
  if (!match) {
    return null;
  }

  const chapter = Number(match[1]);
  return Number.isFinite(chapter) && chapter > 0 ? Math.floor(chapter) : null;
}

function normalizeCanonFanon(cf) {
  const s = String(cf || '').toLowerCase();
  if (['canon', 'canonical', 'c'].includes(s)) {
    return { type: 'canon', confidence: 1.0 };
  }
  if (['fanon', 'fanonical', 'f'].includes(s)) {
    return { type: 'fanon', confidence: 0.8 };
  }
  if (typeof cf === 'object' && cf !== null) {
    return {
      type: cf.type || 'canon',
      confidence: clamp(cf.confidence || cf.conf || 0.5, 0, 1),
    };
  }
  return { type: 'canon', confidence: 0.5 };
}

function normalizeRarity(rarity) {
  if (!rarity) return { score: 'common', label: 'Common' };
  if (typeof rarity === 'string') {
    const s = rarity.toLowerCase();
    if (s.includes('rare') || s.includes('uncommon')) return { score: 'rare', label: 'Rare' };
    if (s.includes('good') || s.includes('common+')) return { score: 'common_but_good', label: 'Common but Good' };
    return { score: 'common', label: 'Common' };
  }
  return {
    score: rarity.score || 'common',
    label: rarity.label || rarity.score || 'Common',
  };
}

function normalizeTags(tags) {
  if (!tags) return [];
  if (typeof tags === 'string') return tags.split(',').map(t => t.trim()).filter(Boolean);
  if (!Array.isArray(tags)) return [];
  return tags.map(t => String(t).trim().toLowerCase().replace(/\s+/g, '_')).filter(Boolean);
}

function normalizeCharacterList(chars) {
  if (!chars) return [];
  if (typeof chars === 'string') return chars.split(',').map(c => c.trim()).filter(Boolean);
  if (!Array.isArray(chars)) return [];
  return chars.map(c => typeof c === 'string' ? c : c.name || c.id).filter(Boolean);
}

function normalizeShipList(ships) {
  if (!ships) return [];
  if (typeof ships === 'string') return ships.split(',').map(s => s.trim()).filter(Boolean);
  if (!Array.isArray(ships)) return [];
  return ships.map(s => typeof s === 'string' ? s : s.name || s.id).filter(Boolean);
}

function normalizeScore(value, min, max) {
  if (value == null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.max(min, Math.min(max, n));
}

function normalizeConfidence(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return clamp(n, 0, 1);
}

function normalizeReviewStatus(value) {
  const normalized = String(value || '').toLowerCase().trim();
  if (['auto_accepted', 'accepted', 'auto'].includes(normalized)) return 'auto_accepted';
  if (['needs_review', 'review', 'pending'].includes(normalized)) return 'needs_review';
  return null;
}

function normalizeGrounding(input) {
  if (!input || typeof input !== 'object') {
    return null;
  }

  return {
    algorithm: input.algorithm || null,
    chunkId: input.chunkId || null,
    chunkIndex: Number.isFinite(Number(input.chunkIndex)) ? Number(input.chunkIndex) : null,
    chapterId: input.chapterId || null,
    chapterIndex: parseChapter(input.chapterIndex),
    chapterConfidence: normalizeConfidence(input.chapterConfidence ?? input.confidence),
    lexicalScore: Number.isFinite(Number(input.lexicalScore)) ? Number(input.lexicalScore) : null,
    bm25Score: Number.isFinite(Number(input.bm25Score)) ? Number(input.bm25Score) : null,
    keywordOverlap: Number.isFinite(Number(input.keywordOverlap)) ? Number(input.keywordOverlap) : null,
    matchedKeywords: Array.isArray(input.matchedKeywords)
      ? input.matchedKeywords.map((item) => String(item || '').trim()).filter(Boolean)
      : [],
    evidenceSnippet: String(input.evidenceSnippet || '').trim(),
    sourceChapter: parseChapter(input.sourceChapter),
    chapterSource: input.chapterSource || null,
  };
}

function normalizeLocationLink(input) {
  if (!input) {
    return null;
  }

  if (typeof input === 'string') {
    const name = String(input || '').trim();
    if (!name) return null;
    return {
      locationId: null,
      locationName: name,
      confidence: null,
      evidenceSnippet: '',
      isMajorLocation: false,
      source: null,
    };
  }

  if (typeof input !== 'object') {
    return null;
  }

  const locationName = String(
    input.locationName || input.name || input.location || input.label || '',
  ).trim();

  if (!locationName) {
    return null;
  }

  return {
    locationId: input.locationId || input.id || null,
    locationName,
    confidence: normalizeConfidence(input.confidence),
    evidenceSnippet: String(input.evidenceSnippet || input.evidence || '').trim(),
    isMajorLocation: Boolean(input.isMajorLocation || input.isMajor),
    source: input.source || null,
  };
}

function clamp(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function parseCharacterProfiles(raw) {
  const l4 = raw?.characters || raw?.resultL4 || {};
  if (Array.isArray(l4)) return l4.map(normalizeCharacter);
  if (typeof l4 === 'object') {
    return Object.entries(l4).map(([id, profile]) => normalizeCharacter({ id, ...profile }));
  }
  return [];
}

function normalizeCharacter(char) {
  if (!char) return null;
  return {
    id: char.id || generateEventId(char),
    name: char.name || char.characterName || 'Unknown',
    description: char.description || char.summary || '',
    role: char.role || char.type || 'secondary',
    isPOV: Boolean(char.isPOV || char.pov || char.mainPOV),
    appearanceCount: clamp(char.appearanceCount || char.appearances || 0, 0, Infinity),
    arc: char.arc || char.characterArc || '',
    motivation: char.motivation || '',
    traits: normalizeTags(char.traits || char.personality || []),
    relationships: char.relationships || [],
  };
}

function parseRelationships(raw) {
  const l5 = raw?.relationships || raw?.resultL5 || {};
  if (Array.isArray(l5)) return l5.map(normalizeRelationship);
  if (typeof l5 === 'object') return Object.entries(l5).map(([id, rel]) => normalizeRelationship({ id, ...rel }));
  return [];
}

function normalizeRelationship(rel) {
  if (!rel) return null;
  return {
    id: rel.id || `${rel.character1Id || rel.source}_${rel.character2Id || rel.target}`,
    character1Id: rel.character1Id || rel.source || '',
    character2Id: rel.character2Id || rel.target || '',
    type: normalizeRelationshipType(rel.type),
    polarity: rel.polarity || inferPolarity(rel.type),
    canonOrFanon: normalizeCanonFanon(rel.canonOrFanon),
    interactionCount: clamp(rel.interactionCount || rel.interactions || 0, 0, Infinity),
    description: rel.description || rel.summary || '',
  };
}

function normalizeRelationshipType(type) {
  const s = String(type || '').toLowerCase();
  if (['enemy', 'enemies', 'rival', 'antagonist'].includes(s)) return 'enemies';
  if (['romantic', 'romance', 'couple', 'pairing', 'ship'].includes(s)) return 'romantic';
  if (['ally', 'allies', 'friend', 'friends'].includes(s)) return 'allies';
  if (['family', 'relative'].includes(s)) return 'family';
  return 'neutral';
}

function inferPolarity(type) {
  const t = normalizeRelationshipType(type);
  if (t === 'enemies') return 'negative';
  if (t === 'romantic') return 'positive';
  if (t === 'allies') return 'positive';
  return 'neutral';
}

function extractSummary(raw) {
  const s = raw?.summary || raw?.meta || {};
  if (typeof s === 'string') return { text: s };
  return {
    text: s.text || s.summary || s.description || '',
    highlights: s.highlights || s.keyPoints || [],
    wordCount: s.wordCount || raw?.meta?.wordCount || 0,
    chapters: s.chapters || raw?.meta?.chapters || 0,
  };
}

/**
 * Flatten all events into a single sorted array
 */
export function flattenEvents(eventsData) {
  if (!eventsData) return [];

  const all = [
    ...normalizeEventArray(eventsData.major || [], 'major').map(e => ({ ...e, _type: 'major' })),
    ...normalizeEventArray(eventsData.minor || [], 'minor').map(e => ({ ...e, _type: 'minor' })),
    ...normalizeEventArray(eventsData.twists || [], 'twist').map(e => ({ ...e, _type: 'twist' })),
    ...normalizeEventArray(eventsData.cliffhangers || [], 'cliffhanger').map(e => ({ ...e, _type: 'cliffhanger' })),
  ];

  const bySignature = new Map();
  for (const event of all) {
    const signature = getEventSignature(event);
    const existing = bySignature.get(signature);
    if (!existing) {
      bySignature.set(signature, event);
      continue;
    }

    const preferCurrent = (
      Number(event.quality?.score || 0) > Number(existing.quality?.score || 0)
      || (event.description || '').length > (existing.description || '').length
    );
    if (preferCurrent) {
      bySignature.set(signature, {
        ...existing,
        ...event,
      });
    }
  }

  const deduped = [...bySignature.values()];

  return deduped.sort((a, b) => {
    const severityOrder = { crucial: 0, major: 1, moderate: 2, minor: 3 };
    const sevDiff = (severityOrder[a.severity] ?? 4) - (severityOrder[b.severity] ?? 4);
    if (sevDiff !== 0) return sevDiff;

    const chapterA = Number.isFinite(Number(a.chapter)) ? Number(a.chapter) : Number.MAX_SAFE_INTEGER;
    const chapterB = Number.isFinite(Number(b.chapter)) ? Number(b.chapter) : Number.MAX_SAFE_INTEGER;
    if (chapterA !== chapterB) return chapterA - chapterB;

    return (a.description || '').localeCompare(b.description || '');
  });
}

/**
 * Build mind map tree structure from events
 */
export function buildMindMap(events) {
  if (!events || !events.length) {
    return { id: 'root', label: 'Story Arc', children: [] };
  }

  const root = { id: 'root', label: 'Story Arc', children: [] };

  const bySeverity = {
    crucial: [],
    major: [],
    moderate: [],
    minor: [],
  };

  for (const event of events) {
    const bucket = bySeverity[event.severity];
    if (bucket) bucket.push(event);
  }

  const colorMap = {
    crucial: '#22c55e',
    major: '#3b82f6',
    moderate: '#f97316',
    minor: '#9ca3af',
  };

  for (const [severity, items] of Object.entries(bySeverity)) {
    if (!items.length) continue;

    const categoryNode = {
      id: `sev_${severity}`,
      label: capitalize(severity),
      type: 'category',
      color: colorMap[severity] || '#9ca3af',
      children: items.map(item => ({
        id: item.id,
        label: truncate(item.description, 60),
        type: 'event',
        data: item,
        color: colorMap[item.severity] || colorMap.minor,
        width: 220,
        height: 80,
      })),
    };

    root.children.push(categoryNode);
  }

  return root;
}

/**
 * Build character graph data for D3/force-directed layout
 */
export function buildCharacterGraph(characterProfiles, relationships) {
  const nodes = (characterProfiles || []).map(c => ({
    id: c.id,
    name: c.name,
    appearances: c.appearanceCount || 0,
    mainPOV: c.isPOV || false,
    role: c.role || 'secondary',
    color: c.isPOV ? '#f59e0b' : '#6366f1',
  }));

  const edges = (relationships || []).map(r => ({
    id: r.id,
    source: r.character1Id,
    target: r.character2Id,
    type: r.type,
    canonOrFanon: r.canonOrFanon?.type || 'canon',
    interactions: r.interactionCount || 0,
    polarity: r.polarity || 'neutral',
  }));

  return { nodes, edges };
}

/**
 * Build timeline data from events
 */
export function buildTimeline(events) {
  if (!events || !events.length) return [];

  const chapters = {};

  for (const event of events) {
    const ch = Number.isFinite(Number(event.chapter)) ? Number(event.chapter) : 0;
    if (!chapters[ch]) {
      chapters[ch] = [];
    }
    chapters[ch].push(event);
  }

  return Object.entries(chapters)
    .sort(([a], [b]) => {
      const chapterA = Number(a);
      const chapterB = Number(b);
      if (chapterA === 0) return 1;
      if (chapterB === 0) return -1;
      return chapterA - chapterB;
    })
    .map(([chapter, chapterEvents]) => ({
      chapter: Number(chapter),
      events: chapterEvents.sort((a, b) => a.position.localeCompare(b.position)),
    }));
}

/**
 * Get statistics from events
 */
export function getEventStats(events) {
  const all = flattenEvents(events);

  const canonCount = all.filter(e => e.canonOrFanon?.type === 'canon').length;
  const fanonCount = all.filter(e => e.canonOrFanon?.type === 'fanon').length;
  const autoAcceptedCount = all.filter((e) => e.reviewStatus === 'auto_accepted').length;
  const needsReviewCount = all.filter((e) => e.reviewStatus === 'needs_review' || e.needsReview).length;
  const locationLinkedCount = all.filter((e) => e.locationLink?.locationName).length;
  const avgIntensity = all.length
    ? all.reduce((sum, e) => sum + (e.emotionalIntensity || 0), 0) / all.length
    : 0;

  const tagCounts = {};
  for (const event of all) {
    for (const tag of (event.tags || [])) {
      tagCounts[tag] = (tagCounts[tag] || 0) + 1;
    }
  }

  const topTags = Object.entries(tagCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([tag, count]) => ({ tag, count }));

  return {
    total: all.length,
    bySeverity: {
      crucial: all.filter(e => e.severity === 'crucial').length,
      major: all.filter(e => e.severity === 'major').length,
      moderate: all.filter(e => e.severity === 'moderate').length,
      minor: all.filter(e => e.severity === 'minor').length,
    },
    canonCount,
    fanonCount,
    autoAcceptedCount,
    needsReviewCount,
    locationLinkedCount,
    avgIntensity: Math.round(avgIntensity * 10) / 10,
    topTags,
    chapters: [...new Set(all.map((e) => e.chapter).filter((value) => Number.isFinite(Number(value)) && Number(value) > 0))]
      .sort((a, b) => a - b),
  };
}

function resolveEventDescription(event) {
  const candidates = [
    event.description,
    event.summary,
    event.title,
    event.name,
    event.event,
    event.text,
    event.content,
    event.note,
  ];

  for (const item of candidates) {
    const value = String(item || '').replace(/\s+/gu, ' ').trim();
    if (value) {
      return value;
    }
  }

  return '';
}

function isMeaningfulDescription(text) {
  const value = String(text || '').replace(/\s+/gu, ' ').trim();
  if (!value || value.length < 8) {
    return false;
  }

  const lower = value.toLowerCase();
  const placeholders = new Set([
    'n/a',
    'na',
    'none',
    'khong ro',
    'không rõ',
    'chua ro',
    'chưa rõ',
    '...',
    '-',
  ]);

  return !placeholders.has(lower);
}

function getEventSignature(event) {
  const description = String(event?.description || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
  const chapter = Number.isFinite(Number(event?.chapter)) ? Number(event.chapter) : 0;
  const type = String(event?._type || 'event');
  return `${type}|${chapter}|${description}`;
}

function calculateEventQualityScore(event) {
  let score = 0;

  const description = String(event?.description || '').trim();
  if (description.length >= 20) score += 40;
  else if (description.length >= 12) score += 25;
  else if (description.length >= 8) score += 15;

  if (Number.isFinite(Number(event?.chapter)) && Number(event.chapter) > 0) score += 20;
  if (String(event?.severity || '').trim()) score += 20;
  if (Number.isFinite(Number(event?.emotionalIntensity))) score += 10;
  if (Number.isFinite(Number(event?.insertability))) score += 10;
  if (Number.isFinite(Number(event?.chapterConfidence)) && Number(event.chapterConfidence) >= 0.45) score += 8;
  if (Number.isFinite(Number(event?.chapterConfidence)) && Number(event.chapterConfidence) >= 0.7) score += 4;
  if (String(event?.evidenceSnippet || '').trim().length >= 40) score += 8;

  return Math.min(100, score);
}

// Helpers
function capitalize(str) {
  return str ? str.charAt(0).toUpperCase() + str.slice(1) : '';
}

function truncate(str, maxLen) {
  if (!str) return '';
  return str.length <= maxLen ? str : str.slice(0, maxLen - 3) + '...';
}
