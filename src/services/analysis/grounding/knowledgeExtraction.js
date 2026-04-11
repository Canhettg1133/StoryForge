import { parseAIJsonValue } from '../../../utils/aiJson.js';
import SessionClient from '../sessionClient.js';
import { buildKnowledgeExtractionPrompt } from '../prompts/knowledgeExtractionPrompt.js';

const DEFAULT_OPTIONS = {
  maxEvents: 220,
  maxOutputTokens: 18000,
  temperature: 0.2,
};

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

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeText(value) {
  return String(value || '').replace(/\s+/gu, ' ').trim();
}

function parseChapter(value) {
  if (value == null || value === '') return null;

  if (typeof value === 'string') {
    const match = value.match(/(\d{1,4})/u);
    if (match) {
      const parsed = Number(match[1]);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
    }
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : null;
}

function normalizeTagList(value) {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeText(item)).filter(Boolean);
  }
  if (typeof value === 'string') {
    return value
      .split(/[\n,;|]+/u)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

function normalizeTimeline(value, eventById, fallbackFn) {
  const normalized = toArray(value)
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const eventId = normalizeText(item.eventId || item.id || '');
      const chapter = parseChapter(item.chapter);
      const summary = normalizeText(item.summary || item.description || '');
      if (!eventId && !chapter && !summary) return null;

      const eventRef = eventId ? eventById.get(eventId) : null;
      return {
        eventId: eventId || (eventRef?.id || null),
        chapter: chapter || eventRef?.chapter || null,
        summary: summary || eventRef?.summary || '',
      };
    })
    .filter(Boolean);

  if (normalized.length > 0) {
    return dedupeTimeline(normalized);
  }

  const fallback = typeof fallbackFn === 'function' ? fallbackFn() : [];
  return dedupeTimeline(fallback);
}

function dedupeTimeline(timeline = []) {
  const deduped = [];
  const seen = new Set();

  for (const item of timeline) {
    const signature = `${item.eventId || ''}|${item.chapter || ''}|${item.summary || ''}`;
    if (seen.has(signature)) continue;
    seen.add(signature);
    deduped.push(item);
  }

  return deduped
    .sort((a, b) => Number(a.chapter || 999999) - Number(b.chapter || 999999))
    .slice(0, 12);
}

function eventLocationName(event = {}) {
  return normalizeText(
    event.locationName
    || event.primaryLocationName
    || event.locationLink?.locationName
    || '',
  );
}

function flattenEvents(eventsLayer = {}) {
  const keys = new Set();
  for (const key of EVENT_ARRAY_KEYS) {
    if (Array.isArray(eventsLayer?.[key])) {
      keys.add(key);
    }
  }

  for (const [key, value] of Object.entries(eventsLayer || {})) {
    if (!Array.isArray(value)) continue;
    const lower = key.toLowerCase();
    if (lower.includes('event') || lower.includes('twist') || lower.includes('cliff')) {
      keys.add(key);
    }
  }

  const flat = [];
  const visit = (event) => {
    if (!event || typeof event !== 'object') return;

    flat.push({
      id: normalizeText(event.id || ''),
      chapter: parseChapter(event.chapter ?? event.chapterIndex),
      severity: normalizeText(event.severity || ''),
      summary: normalizeText(event.description || event.summary || event.title || ''),
      tags: normalizeTagList(event.tags),
      characters: normalizeTagList(event.characters),
      locationName: eventLocationName(event),
    });

    for (const key of NESTED_EVENT_KEYS) {
      if (!Array.isArray(event[key])) continue;
      for (const child of event[key]) {
        visit(child);
      }
    }
  };

  for (const key of keys) {
    for (const event of toArray(eventsLayer[key])) {
      visit(event);
    }
  }

  const deduped = new Map();
  for (const event of flat) {
    const key = event.id || `${event.chapter || ''}_${event.summary}`.toLowerCase();
    if (!key) continue;
    if (!deduped.has(key)) {
      deduped.set(key, event);
    }
  }
  return [...deduped.values()];
}

function collectContext(result = {}, options = {}) {
  const maxEvents = Math.max(40, Number(options.maxEvents) || DEFAULT_OPTIONS.maxEvents);
  const events = flattenEvents(result?.events || {})
    .filter((item) => item.id && item.summary)
    .slice(0, maxEvents);

  const incidents = toArray(result?.incidents)
    .map((item) => ({
      id: normalizeText(item?.id || ''),
      title: normalizeText(item?.title || item?.anchorEventDescription || ''),
      chapterStart: parseChapter(item?.chapterStart ?? item?.startChapter),
      chapterEnd: parseChapter(item?.chapterEnd ?? item?.endChapter),
      eventIds: toArray(item?.eventIds).map((id) => normalizeText(id)).filter(Boolean),
    }))
    .filter((item) => item.title)
    .slice(0, 30);

  const characters = toArray(result?.characters?.profiles)
    .map((item) => ({
      name: normalizeText(item?.name || item?.characterName || ''),
      role: normalizeText(item?.role || ''),
      appearance: normalizeText(item?.appearance || ''),
      personality: normalizeText(item?.personality || ''),
      flaws: normalizeText(item?.flaws || ''),
      goals: normalizeText(item?.goals || ''),
    }))
    .filter((item) => item.name)
    .slice(0, 80);

  const worldSeed = result?.world_seed || result?.worldSeed || null;
  const styleSeed = result?.style_seed || result?.styleSeed || null;
  const entityMentions = result?.entity_mentions || result?.entityMentions || null;
  const styleEvidence = result?.style_evidence || result?.styleEvidence || null;

  return {
    worldbuilding: result?.worldbuilding || {},
    summary: result?.summary || {},
    world_seed: worldSeed,
    style_seed: styleSeed,
    entity_mentions: entityMentions,
    style_evidence: styleEvidence,
    incidents,
    characters,
    events,
  };
}

function inferTimelineForName(name, events = [], type = 'generic') {
  const normalizedName = normalizeText(name).toLowerCase();
  if (!normalizedName) return [];

  const matched = [];
  for (const event of events) {
    const summaryLower = normalizeText(event.summary).toLowerCase();
    const locationLower = normalizeText(event.locationName).toLowerCase();
    const tagLower = toArray(event.tags).map((item) => normalizeText(item).toLowerCase());
    const characterLower = toArray(event.characters).map((item) => normalizeText(item).toLowerCase());

    const isLocationHit = locationLower
      && (locationLower.includes(normalizedName) || normalizedName.includes(locationLower));
    const isSummaryHit = summaryLower.includes(normalizedName);
    const isTagHit = tagLower.some((item) => item.includes(normalizedName) || normalizedName.includes(item));
    const isCharacterHit = characterLower.some((item) => item.includes(normalizedName) || normalizedName.includes(item));

    let hit = isSummaryHit || isTagHit;
    if (type === 'location') {
      hit = isLocationHit || isSummaryHit;
    } else if (type === 'character') {
      hit = isCharacterHit || isSummaryHit || isTagHit;
    }

    if (!hit) continue;
    matched.push({
      eventId: event.id || null,
      chapter: event.chapter || null,
      summary: event.summary || '',
    });
  }

  return dedupeTimeline(matched);
}

function normalizeWorldProfile(profile = {}, fallback = {}) {
  return {
    world_name: normalizeText(
      profile.world_name
      || profile.worldName
      || fallback.world_name
      || fallback.worldName
      || '',
    ),
    world_type: normalizeText(
      profile.world_type
      || profile.worldType
      || fallback.world_type
      || fallback.worldType
      || '',
    ),
    world_scale: normalizeText(
      profile.world_scale
      || profile.worldScale
      || fallback.world_scale
      || fallback.worldScale
      || '',
    ),
    world_era: normalizeText(
      profile.world_era
      || profile.worldEra
      || fallback.world_era
      || fallback.worldEra
      || '',
    ),
    world_rules: normalizeTagList(
      profile.world_rules
      || profile.worldRules
      || fallback.world_rules
      || fallback.worldRules
      || [],
    ),
    world_description: normalizeText(
      profile.world_description
      || profile.worldDescription
      || fallback.world_description
      || fallback.worldDescription
      || '',
    ),
  };
}

function normalizeCharacter(item = {}, events = [], eventById = new Map()) {
  const name = normalizeText(item.name || item.characterName || '');
  if (!name) return null;

  return {
    name,
    role: normalizeText(item.role || 'supporting') || 'supporting',
    appearance: normalizeText(item.appearance || ''),
    personality: normalizeText(item.personality || ''),
    personality_tags: normalizeTagList(item.personality_tags || item.personalityTags || item.tags || []),
    flaws: normalizeText(item.flaws || item.weakness || ''),
    goals: normalizeText(item.goals || item.goal || ''),
    secrets: normalizeText(item.secrets || item.secret || ''),
    timeline: normalizeTimeline(
      item.timeline,
      eventById,
      () => inferTimelineForName(name, events, 'character'),
    ),
  };
}

function normalizeLocation(item = {}, events = [], eventById = new Map()) {
  const name = normalizeText(item.name || item.location || item.label || '');
  if (!name) return null;

  return {
    name,
    description: normalizeText(item.description || item.summary || ''),
    aliases: normalizeTagList(item.aliases || []),
    timeline: normalizeTimeline(
      item.timeline,
      eventById,
      () => inferTimelineForName(name, events, 'location'),
    ),
  };
}

function normalizeObject(item = {}, events = [], eventById = new Map()) {
  const name = normalizeText(item.name || item.object || item.title || '');
  if (!name) return null;

  return {
    name,
    owner: normalizeText(item.owner || item.ownerName || ''),
    description: normalizeText(item.description || item.summary || ''),
    properties: normalizeText(item.properties || ''),
    timeline: normalizeTimeline(
      item.timeline,
      eventById,
      () => inferTimelineForName(name, events, 'generic'),
    ),
  };
}

function normalizeTerm(item = {}, events = [], eventById = new Map()) {
  const name = normalizeText(item.name || item.term || item.title || '');
  if (!name) return null;

  return {
    name,
    category: normalizeText(item.category || item.type || 'other') || 'other',
    definition: normalizeText(item.definition || item.description || ''),
    timeline: normalizeTimeline(
      item.timeline,
      eventById,
      () => inferTimelineForName(name, events, 'generic'),
    ),
  };
}

function dedupeByName(list = []) {
  const map = new Map();
  for (const item of toArray(list)) {
    const name = normalizeText(item?.name || '');
    if (!name) continue;
    const key = name.toLowerCase();
    if (!map.has(key)) {
      map.set(key, { ...item, name });
      continue;
    }

    const existing = map.get(key);
    map.set(key, {
      ...existing,
      ...item,
      name,
      aliases: [...new Set([...(existing.aliases || []), ...(item.aliases || [])])],
      timeline: dedupeTimeline([...(existing.timeline || []), ...(item.timeline || [])]),
      description: normalizeText(existing.description || item.description || ''),
      definition: normalizeText(existing.definition || item.definition || ''),
      properties: normalizeText(existing.properties || item.properties || ''),
      owner: normalizeText(existing.owner || item.owner || ''),
    });
  }
  return [...map.values()];
}

function normalizeKnowledgePayload(raw = {}, context = {}) {
  const events = toArray(context.events);
  const eventById = new Map(events.filter((item) => item.id).map((item) => [item.id, item]));

  const fallbackSetting = context.worldbuilding?.setting || {};
  const fallbackWorldProfile = {
    world_name: normalizeText(fallbackSetting.worldName || fallbackSetting.name || ''),
    world_type: normalizeText(fallbackSetting.worldType || fallbackSetting.type || ''),
    world_scale: normalizeText(fallbackSetting.worldScale || fallbackSetting.scale || ''),
    world_era: normalizeText(fallbackSetting.worldEra || fallbackSetting.era || ''),
    world_rules: normalizeTagList(fallbackSetting.rules || []),
    world_description: normalizeText(fallbackSetting.description || ''),
  };

  const characters = dedupeByName(
    toArray(raw.characters).map((item) => normalizeCharacter(item, events, eventById)).filter(Boolean),
  );
  const locations = dedupeByName(
    toArray(raw.locations).map((item) => normalizeLocation(item, events, eventById)).filter(Boolean),
  );
  const objects = dedupeByName(
    toArray(raw.objects).map((item) => normalizeObject(item, events, eventById)).filter(Boolean),
  );
  const terms = dedupeByName(
    toArray(raw.terms).map((item) => normalizeTerm(item, events, eventById)).filter(Boolean),
  );

  return {
    world_profile: normalizeWorldProfile(raw.world_profile || raw.worldProfile || {}, fallbackWorldProfile),
    characters,
    locations,
    objects,
    terms,
  };
}

function canRunKnowledgeAi(options = {}) {
  const model = normalizeText(options.model);
  const keys = [
    ...toArray(options.apiKeys),
    options.apiKey,
  ]
    .map((item) => normalizeText(item))
    .filter(Boolean);

  return Boolean(model && keys.length > 0);
}

export async function extractKnowledgeProfile(result = {}, options = {}, signal) {
  const mergedOptions = {
    ...DEFAULT_OPTIONS,
    ...options,
  };

  if (!canRunKnowledgeAi(mergedOptions)) {
    return {
      applied: false,
      reason: 'missing_model_or_key',
      data: null,
    };
  }

  const context = collectContext(result, mergedOptions);
  if (!context.events.length) {
    return {
      applied: false,
      reason: 'no_events',
      data: null,
    };
  }

  const prompt = buildKnowledgeExtractionPrompt({
    eventCount: context.events.length,
  });
  const inputText = JSON.stringify(context);

  const client = new SessionClient({
    provider: mergedOptions.provider,
    model: mergedOptions.model,
    apiKey: mergedOptions.apiKey,
    apiKeys: mergedOptions.apiKeys,
    proxyUrl: mergedOptions.proxyUrl,
    directUrl: mergedOptions.directUrl,
    temperature: Number.isFinite(Number(mergedOptions.temperature))
      ? Number(mergedOptions.temperature)
      : DEFAULT_OPTIONS.temperature,
    maxOutputTokens: Math.max(4000, Number(mergedOptions.maxOutputTokens) || DEFAULT_OPTIONS.maxOutputTokens),
  });

  try {
    const response = await client.startSession(inputText, prompt, { signal });
    const parsed = parseAIJsonValue(response?.text || '');
    const normalized = normalizeKnowledgePayload(parsed, context);

    return {
      applied: true,
      reason: null,
      data: normalized,
      usageMetadata: response?.usageMetadata || null,
    };
  } finally {
    client.endSession();
  }
}

export function mergeKnowledgeProfile(result = {}, knowledge = null) {
  if (!knowledge || typeof knowledge !== 'object') {
    return result;
  }

  const next = { ...result };
  next.knowledge = knowledge;
  next.world_profile = knowledge.world_profile;
  next.objects = toArray(knowledge.objects);
  next.terms = toArray(knowledge.terms);

  const worldbuilding = { ...(result.worldbuilding || {}) };
  const setting = { ...(worldbuilding.setting || {}) };
  const profile = knowledge.world_profile || {};

  worldbuilding.setting = {
    ...setting,
    worldName: normalizeText(profile.world_name || setting.worldName || ''),
    worldType: normalizeText(profile.world_type || setting.worldType || ''),
    worldScale: normalizeText(profile.world_scale || setting.worldScale || ''),
    worldEra: normalizeText(profile.world_era || setting.worldEra || ''),
    rules: normalizeTagList(profile.world_rules || setting.rules || []),
    description: normalizeText(profile.world_description || setting.description || ''),
  };
  worldbuilding.locations = toArray(knowledge.locations);
  worldbuilding.objects = toArray(knowledge.objects);
  worldbuilding.terms = toArray(knowledge.terms);
  next.worldbuilding = worldbuilding;

  next.characters = {
    ...(result.characters || {}),
    profiles: toArray(knowledge.characters).length
      ? toArray(knowledge.characters)
      : toArray(result?.characters?.profiles),
  };

  return next;
}

export default {
  extractKnowledgeProfile,
  mergeKnowledgeProfile,
};
