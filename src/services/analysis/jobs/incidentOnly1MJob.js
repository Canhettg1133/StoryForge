import { randomUUID } from 'node:crypto';
import { parseAIJsonValue } from '../../../utils/aiJson.js';
import { ANALYSIS_CONFIG } from '../analysisConfig.js';
import { extractKnowledgeProfile, mergeKnowledgeProfile } from '../grounding/knowledgeExtraction.js';
import { mergeOutputParts, shouldContinueOutput } from '../outputChunker.js';
import { runIncidentAnalysis } from '../pipeline/incidentAnalyzer.js';
import { buildReviewQueue } from '../pipeline/reviewQueueBuilder.js';
import { buildDeepIncidentPassPrompt } from '../prompts/deepIncidentPassPrompt.js';
import { buildGlobalIncidentPassPrompt } from '../prompts/globalIncidentPassPrompt.js';
import SessionClient from '../sessionClient.js';
import {
  completePass,
  consolidateCanonicalKnowledge,
  createPassTracker,
  finalizeTracker,
  markPassDegraded,
  normalizePublicRunMode,
  startPass,
  validatePassAOutput,
  validatePassBOutput,
  validatePassCOutput,
} from '../v2/contracts.js';
import { buildStoryGraph } from '../v2/storyGraph.js';
import { buildAnalysisArtifactV3 } from '../v3/artifactBuilder.js';

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

function formatIssues(issues = []) {
  return toArray(issues)
    .map((item) => `${item.path || 'root'}: ${item.message || 'invalid'}`)
    .filter(Boolean)
    .slice(0, 6);
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

function dedupeStrings(items = []) {
  return [...new Set(normalizeStringArray(items))];
}

function normalizeMentionEntities(items = [], kind = 'generic') {
  const map = new Map();
  for (const item of toArray(items)) {
    const source = toObject(item);
    const name = normalizeText(source.name || '');
    if (!name) continue;
    const key = name.toLowerCase();
    const existing = map.get(key) || {};
    map.set(key, {
      ...existing,
      ...source,
      name,
      roleHint: normalizeText(existing.roleHint || source.roleHint || source.role || ''),
      ownerHint: normalizeText(existing.ownerHint || source.ownerHint || source.owner || ''),
      kind: normalizeText(existing.kind || source.kind || ''),
      category: normalizeText(existing.category || source.category || ''),
      definitionHint: normalizeText(existing.definitionHint || source.definitionHint || source.definition || ''),
      eventIds: dedupeStrings([...(existing.eventIds || []), ...(source.eventIds || [])]),
      chapters: [...new Set([
        ...toArray(existing.chapters).map((value) => parseChapter(value)).filter((value) => Number.isFinite(value)),
        ...toArray(source.chapters).map((value) => parseChapter(value)).filter((value) => Number.isFinite(value)),
      ])].sort((left, right) => left - right),
      evidence: dedupeStrings([...(existing.evidence || []), ...(source.evidence || [])]).slice(0, 8),
      mentionCount: Math.max(
        Number(existing.mentionCount || 0),
        Number(source.mentionCount || 0),
        dedupeStrings([...(existing.eventIds || []), ...(source.eventIds || [])]).length,
        dedupeStrings([...(existing.evidence || []), ...(source.evidence || [])]).length,
        1,
      ),
      _kind: kind,
    });
  }
  return [...map.values()];
}

function normalizeRelationshipMentions(items = []) {
  const map = new Map();
  for (const item of toArray(items)) {
    const source = toObject(item);
    const left = normalizeText(source.source || source.character1Id || '');
    const right = normalizeText(source.target || source.character2Id || '');
    if (!left || !right) continue;
    const type = normalizeText(source.type || 'neutral') || 'neutral';
    const key = `${left.toLowerCase()}|${right.toLowerCase()}|${type}`;
    const existing = map.get(key) || {};
    map.set(key, {
      ...existing,
      source: left,
      target: right,
      type,
      eventIds: dedupeStrings([...(existing.eventIds || []), ...(source.eventIds || [])]),
      chapters: [...new Set([
        ...toArray(existing.chapters).map((value) => parseChapter(value)).filter((value) => Number.isFinite(value)),
        ...toArray(source.chapters).map((value) => parseChapter(value)).filter((value) => Number.isFinite(value)),
      ])].sort((a, b) => a - b),
      evidence: dedupeStrings([...(existing.evidence || []), ...(source.evidence || [])]).slice(0, 8),
    });
  }
  return [...map.values()];
}

function normalizeStyleObservations(items = []) {
  const result = [];
  const seen = new Set();
  for (const item of toArray(items)) {
    const source = toObject(item);
    const observation = normalizeText(source.observation || source.note || '');
    if (!observation) continue;
    const normalized = {
      id: normalizeText(source.id || '') || `style_obs_${result.length + 1}`,
      chapter: parseChapter(source.chapter),
      eventId: normalizeText(source.eventId || ''),
      signalType: normalizeText(source.signalType || source.type || 'other') || 'other',
      observation,
      evidence: normalizeText(source.evidence || ''),
    };
    const signature = [
      normalized.chapter || '',
      normalized.eventId,
      normalized.signalType,
      normalized.observation,
    ].join('|').toLowerCase();
    if (seen.has(signature)) continue;
    seen.add(signature);
    result.push(normalized);
  }
  return result;
}

function summarizeStyleEvidence(styleEvidence = {}) {
  return {
    observations: normalizeStyleObservations(styleEvidence.observations),
  };
}

function normalizeWorldSeed(seed = {}) {
  const source = toObject(seed);
  return {
    world_name: normalizeText(source.world_name || source.worldName || ''),
    world_type: normalizeText(source.world_type || source.worldType || ''),
    world_rules: dedupeStrings(source.world_rules || source.worldRules),
    primary_locations: dedupeStrings(source.primary_locations || source.primaryLocations),
    dominant_forces: dedupeStrings(source.dominant_forces || source.dominantForces),
    world_description: normalizeText(source.world_description || source.worldDescription || ''),
  };
}

function normalizeStyleSeed(seed = {}) {
  const source = toObject(seed);
  const normalizeDensity = (value, fallback = 'medium') => {
    const normalized = normalizeText(value).toLowerCase();
    return ['low', 'medium', 'high'].includes(normalized) ? normalized : fallback;
  };
  return {
    pov: normalizeText(source.pov || ''),
    tense: normalizeText(source.tense || ''),
    register: normalizeText(source.register || ''),
    tone: dedupeStrings(source.tone),
    dialogue_density: normalizeDensity(source.dialogue_density || source.dialogueDensity, 'medium'),
    description_density: normalizeDensity(source.description_density || source.descriptionDensity, 'medium'),
    action_density: normalizeDensity(source.action_density || source.actionDensity, 'medium'),
    style_signals: dedupeStrings(source.style_signals || source.styleSignals),
    motifs: dedupeStrings(source.motifs),
  };
}

function createEntityMentions() {
  return {
    characters: [],
    objects: [],
    terms: [],
    relationships: [],
  };
}

export function mergeEntityMentions(left = createEntityMentions(), right = createEntityMentions()) {
  return {
    characters: normalizeMentionEntities([...(left.characters || []), ...(right.characters || [])], 'character'),
    objects: normalizeMentionEntities([...(left.objects || []), ...(right.objects || [])], 'object'),
    terms: normalizeMentionEntities([...(left.terms || []), ...(right.terms || [])], 'term'),
    relationships: normalizeRelationshipMentions([...(left.relationships || []), ...(right.relationships || [])]),
  };
}

export function buildKnowledgeFallback({
  worldSeed = {},
  mentions = createEntityMentions(),
  locations = [],
  events = [],
} = {}) {
  const normalizedWorldSeed = normalizeWorldSeed(worldSeed);
  const eventById = new Map(
    toArray(events)
      .filter((item) => item?.id)
      .map((item) => [item.id, item]),
  );
  const buildMentionTimeline = (item = {}) => {
    const eventIds = toArray(item.eventIds);
    const chapters = toArray(item.chapters);
    const evidence = toArray(item.evidence);
    const singleEventFallback = eventIds.length <= 1 ? normalizeText(evidence[0] || '') : '';

    return eventIds.map((eventId, index) => {
      const event = eventById.get(eventId) || {};
      const chapter = chapters[index] || event.chapter || (eventIds.length <= 1 ? chapters[0] || null : null);
      const summary = normalizeText(
        evidence[index]
        || event.description
        || event.evidenceSnippet
        || singleEventFallback,
      );

      return {
        eventId,
        chapter,
        summary,
      };
    }).filter((item) => item.eventId || item.chapter || item.summary);
  };
  const characterMap = new Map();
  for (const mention of normalizeMentionEntities(mentions.characters, 'character')) {
    characterMap.set(mention.name.toLowerCase(), {
      name: mention.name,
      role: mention.roleHint || 'supporting',
      appearance: '',
      personality: '',
      personality_tags: [],
      flaws: '',
      goals: '',
      secrets: '',
      timeline: buildMentionTimeline(mention),
    });
  }
  for (const event of toArray(events)) {
    for (const rawName of toArray(event.characters)) {
      const name = normalizeText(rawName);
      if (!name) continue;
      const key = name.toLowerCase();
      const existing = characterMap.get(key) || {
        name,
        role: 'supporting',
        appearance: '',
        personality: '',
        personality_tags: [],
        flaws: '',
        goals: '',
        secrets: '',
        timeline: [],
      };
      existing.timeline = [...existing.timeline, {
        eventId: event.id || null,
        chapter: event.chapter || null,
        summary: event.description || '',
      }];
      characterMap.set(key, existing);
    }
  }

  const locationMap = new Map();
  for (const location of toArray(locations)) {
    const name = normalizeText(location?.name || '');
    if (!name) continue;
    locationMap.set(name.toLowerCase(), {
      name,
      description: normalizeText(location.description || ''),
      aliases: dedupeStrings(location.aliases),
      timeline: toArray(location.timeline),
    });
  }
  for (const name of normalizedWorldSeed.primary_locations) {
    const key = name.toLowerCase();
    if (!locationMap.has(key)) {
      locationMap.set(key, {
        name,
        description: '',
        aliases: [],
        timeline: [],
      });
    }
  }

  const objects = normalizeMentionEntities(mentions.objects, 'object').map((item) => ({
    name: item.name,
    owner: item.ownerHint || '',
    description: '',
    properties: item.kind || '',
    timeline: buildMentionTimeline(item),
  }));

  const terms = normalizeMentionEntities(mentions.terms, 'term').map((item) => ({
    name: item.name,
    category: item.category || 'other',
    definition: item.definitionHint || '',
    timeline: buildMentionTimeline(item),
  }));

  return {
    world_profile: {
      world_name: normalizedWorldSeed.world_name,
      world_type: normalizedWorldSeed.world_type,
      world_scale: '',
      world_era: '',
      world_rules: normalizedWorldSeed.world_rules,
      world_description: normalizedWorldSeed.world_description,
    },
    characters: [...characterMap.values()],
    locations: [...locationMap.values()],
    objects,
    terms,
  };
}

export function buildRelationshipLayer(relationshipMentions = []) {
  return normalizeRelationshipMentions(relationshipMentions).map((item) => ({
    id: `${item.source}_${item.target}_${item.type}`.toLowerCase().replace(/[^a-z0-9_]+/gu, '_'),
    character1Id: item.source,
    character2Id: item.target,
    type: item.type,
    polarity: item.type === 'enemies' ? 'negative' : (item.type === 'romantic' || item.type === 'allies' ? 'positive' : 'neutral'),
    canonOrFanon: { type: 'canon' },
    interactionCount: Math.max(item.eventIds.length, item.chapters.length, item.evidence.length, 1),
    description: item.evidence[0] || '',
  }));
}

export function buildCraftProfile({ styleSeed = {}, styleEvidence = {}, events = [] } = {}) {
  const seed = normalizeStyleSeed(styleSeed);
  const observations = normalizeStyleObservations(styleEvidence.observations);
  const densityObservations = (type) => observations.filter((item) => item.signalType === type).map((item) => item.observation);
  const averageIntensity = events.length
    ? Number((events.reduce((sum, item) => sum + clampNumber(item.emotionalIntensity, 1, 10, 6), 0) / events.length).toFixed(2))
    : 0;
  const peakEvent = toArray(events)
    .slice()
    .sort((left, right) => clampNumber(right.emotionalIntensity, 1, 10, 0) - clampNumber(left.emotionalIntensity, 1, 10, 0))[0] || null;
  const chaptersWithEvents = new Set(toArray(events).map((item) => parseChapter(item.chapter)).filter((value) => Number.isFinite(value)));

  return {
    style: {
      pov: seed.pov || 'khong_ro',
      tense: seed.tense || 'khong_ro',
      register: seed.register || 'trung_tinh',
      tone: seed.tone,
      styleSignals: dedupeStrings([
        ...seed.style_signals,
        ...observations.map((item) => item.observation),
      ]).slice(0, 12),
      motifs: seed.motifs,
      evidenceCount: observations.length,
    },
    emotional: {
      averageIntensity,
      peakChapter: peakEvent?.chapter || null,
      peakEvent: peakEvent?.description || '',
      toneAnchors: seed.tone.slice(0, 6),
    },
    pacing: {
      dialogueDensity: seed.dialogue_density,
      descriptionDensity: seed.description_density,
      actionDensity: seed.action_density,
      eventCount: events.length,
      activeChapters: chaptersWithEvents.size,
      rhythmSignals: densityObservations('rhythm').slice(0, 6),
    },
    dialogueTechniques: {
      density: seed.dialogue_density,
      observations: densityObservations('dialogue_density').slice(0, 6),
      povSupport: observations
        .filter((item) => ['pov', 'tense'].includes(item.signalType))
        .map((item) => item.observation)
        .slice(0, 6),
    },
  };
}

export function buildCoverageAudit({
  knowledge = {},
  mentions = createEntityMentions(),
  locations = [],
  events = [],
  relationships = [],
} = {}) {
  const toCoverageRatio = (returned, observed) => {
    if (!observed) return 1;
    const ratio = Number(returned || 0) / Number(observed || 0);
    return Math.max(0, Math.min(1, ratio));
  };
  const knowledgeSource = toObject(knowledge);
  const observedCharacterNames = new Set([
    ...normalizeMentionEntities(mentions.characters, 'character').map((item) => item.name),
    ...toArray(events).flatMap((item) => normalizeStringArray(item.characters)),
  ].map((item) => item.toLowerCase()));
  const observedLocationNames = new Set([
    ...toArray(locations).map((item) => normalizeText(item?.name || '')),
    ...normalizeStringArray(knowledgeSource.world_profile?.primary_locations),
  ].filter(Boolean).map((item) => item.toLowerCase()));
  const observedObjectMentions = normalizeMentionEntities(mentions.objects, 'object');
  const observedTermMentions = normalizeMentionEntities(mentions.terms, 'term');
  const observedRelationshipMentions = normalizeRelationshipMentions(mentions.relationships);

  const returnedCharacters = new Set(toArray(knowledgeSource.characters).map((item) => normalizeText(item?.name || '').toLowerCase()).filter(Boolean));
  const returnedLocations = new Set(toArray(knowledgeSource.locations).map((item) => normalizeText(item?.name || '').toLowerCase()).filter(Boolean));
  const returnedObjects = new Set(toArray(knowledgeSource.objects).map((item) => normalizeText(item?.name || '').toLowerCase()).filter(Boolean));
  const returnedTerms = new Set(toArray(knowledgeSource.terms).map((item) => normalizeText(item?.name || '').toLowerCase()).filter(Boolean));
  const returnedRelationships = new Set(toArray(relationships).map((item) => `${normalizeText(item.character1Id).toLowerCase()}|${normalizeText(item.character2Id).toLowerCase()}|${normalizeText(item.type).toLowerCase()}`));

  const omittedCandidates = {
    characters: normalizeMentionEntities(mentions.characters, 'character').filter((item) => !returnedCharacters.has(item.name.toLowerCase())),
    locations: toArray(locations)
      .map((item) => ({
        name: normalizeText(item?.name || ''),
        evidence: normalizeStringArray(item?.evidence),
        eventIds: toArray(item?.timeline).map((entry) => normalizeText(entry?.eventId || '')).filter(Boolean),
      }))
      .filter((item) => item.name && !returnedLocations.has(item.name.toLowerCase())),
    objects: observedObjectMentions.filter((item) => !returnedObjects.has(item.name.toLowerCase())),
    terms: observedTermMentions.filter((item) => !returnedTerms.has(item.name.toLowerCase())),
    relationships: observedRelationshipMentions.filter((item) => !returnedRelationships.has(`${item.source.toLowerCase()}|${item.target.toLowerCase()}|${item.type.toLowerCase()}`)),
  };

  const observedCount = {
    characters: observedCharacterNames.size,
    locations: observedLocationNames.size,
    objects: observedObjectMentions.length,
    terms: observedTermMentions.length,
    relationships: observedRelationshipMentions.length,
  };
  const returnedCount = {
    characters: returnedCharacters.size,
    locations: returnedLocations.size,
    objects: returnedObjects.size,
    terms: returnedTerms.size,
    relationships: returnedRelationships.size,
  };

  const coverage = {
    characters: toCoverageRatio(returnedCount.characters, observedCount.characters),
    locations: toCoverageRatio(returnedCount.locations, observedCount.locations),
    objects: toCoverageRatio(returnedCount.objects, observedCount.objects),
    terms: toCoverageRatio(returnedCount.terms, observedCount.terms),
    relationships: toCoverageRatio(returnedCount.relationships, observedCount.relationships),
  };
  const rawCoverage = {
    characters: observedCount.characters ? returnedCount.characters / observedCount.characters : 1,
    locations: observedCount.locations ? returnedCount.locations / observedCount.locations : 1,
    objects: observedCount.objects ? returnedCount.objects / observedCount.objects : 1,
    terms: observedCount.terms ? returnedCount.terms / observedCount.terms : 1,
    relationships: observedCount.relationships ? returnedCount.relationships / observedCount.relationships : 1,
  };
  const overReturned = {
    characters: returnedCount.characters > observedCount.characters && observedCount.characters > 0,
    locations: returnedCount.locations > observedCount.locations && observedCount.locations > 0,
    objects: returnedCount.objects > observedCount.objects && observedCount.objects > 0,
    terms: returnedCount.terms > observedCount.terms && observedCount.terms > 0,
    relationships: returnedCount.relationships > observedCount.relationships && observedCount.relationships > 0,
  };
  const overReturnedCount = {
    characters: Math.max(0, returnedCount.characters - observedCount.characters),
    locations: Math.max(0, returnedCount.locations - observedCount.locations),
    objects: Math.max(0, returnedCount.objects - observedCount.objects),
    terms: Math.max(0, returnedCount.terms - observedCount.terms),
    relationships: Math.max(0, returnedCount.relationships - observedCount.relationships),
  };
  const complete = Object.entries(coverage).every(([key, value]) => value >= 0.6 && !overReturned[key]);

  return {
    observedCount,
    returnedCount,
    coverage,
    rawCoverage,
    overReturned,
    overReturnedCount,
    complete,
    omittedCandidates,
  };
}

export function applyCoverageRecall({
  knowledge = {},
  coverageAudit = null,
  relationships = [],
} = {}) {
  const source = {
    world_profile: toObject(knowledge.world_profile),
    characters: toArray(knowledge.characters).slice(),
    locations: toArray(knowledge.locations).slice(),
    objects: toArray(knowledge.objects).slice(),
    terms: toArray(knowledge.terms).slice(),
  };
  const audit = toObject(coverageAudit);
  const omitted = toObject(audit.omittedCandidates);
  let recallApplied = false;

  for (const item of toArray(omitted.characters)) {
    if ((item.evidence || []).length === 0 && (item.eventIds || []).length === 0) continue;
    source.characters.push({
      name: item.name,
      role: item.roleHint || 'supporting',
      appearance: '',
      personality: '',
      personality_tags: [],
      flaws: '',
      goals: '',
      secrets: '',
      timeline: toArray(item.eventIds).map((eventId, index) => ({
        eventId,
        chapter: item.chapters?.[index] || item.chapters?.[0] || null,
        summary: item.evidence?.[index] || item.evidence?.[0] || '',
      })),
    });
    recallApplied = true;
  }

  for (const item of toArray(omitted.locations)) {
    if (!item.name) continue;
    source.locations.push({
      name: item.name,
      description: '',
      aliases: [],
      timeline: toArray(item.eventIds).map((eventId, index) => ({
        eventId,
        chapter: item.chapters?.[index] || item.chapters?.[0] || null,
        summary: item.evidence?.[index] || item.evidence?.[0] || '',
      })),
    });
    recallApplied = true;
  }

  for (const item of toArray(omitted.objects)) {
    source.objects.push({
      name: item.name,
      owner: item.ownerHint || '',
      description: '',
      properties: item.kind || '',
      timeline: toArray(item.eventIds).map((eventId, index) => ({
        eventId,
        chapter: item.chapters?.[index] || item.chapters?.[0] || null,
        summary: item.evidence?.[index] || item.evidence?.[0] || '',
      })),
    });
    recallApplied = true;
  }

  for (const item of toArray(omitted.terms)) {
    source.terms.push({
      name: item.name,
      category: item.category || 'other',
      definition: item.definitionHint || '',
      timeline: toArray(item.eventIds).map((eventId, index) => ({
        eventId,
        chapter: item.chapters?.[index] || item.chapters?.[0] || null,
        summary: item.evidence?.[index] || item.evidence?.[0] || '',
      })),
    });
    recallApplied = true;
  }

  const nextRelationships = relationships.slice();
  for (const item of toArray(omitted.relationships)) {
    nextRelationships.push({
      id: `${item.source}_${item.target}_${item.type}`.toLowerCase().replace(/[^a-z0-9_]+/gu, '_'),
      character1Id: item.source,
      character2Id: item.target,
      type: item.type,
      polarity: item.type === 'enemies' ? 'negative' : (item.type === 'romantic' || item.type === 'allies' ? 'positive' : 'neutral'),
      canonOrFanon: { type: 'canon' },
      interactionCount: Math.max((item.eventIds || []).length, (item.evidence || []).length, 1),
      description: item.evidence?.[0] || '',
    });
    recallApplied = true;
  }

  return {
    knowledge: source,
    relationships: nextRelationships,
    recallApplied,
  };
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

async function callValidatedMultipartStep({
  prompt,
  inputText,
  options,
  signal,
  maxOutputTokens,
  maxParts,
  validator,
  repairTitle,
  apiKeyCursorStart = 0,
}) {
  const attempts = [];
  let lastValidation = null;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const repairSuffix = attempt === 0
      ? ''
      : `\n\nRepair instruction:\nThe previous JSON failed validation for ${repairTitle}. Fix these issues exactly and return valid JSON only:\n- ${formatIssues(lastValidation?.issues).join('\n- ')}`;

    const ai = await callStepJsonMultipart({
      prompt: `${prompt}${repairSuffix}`,
      inputText,
      options,
      signal,
      maxOutputTokens,
      maxParts,
      apiKeyCursorStart,
    });

    const validation = validator(ai.parsed);
    lastValidation = validation;
    attempts.push({
      attempt: attempt + 1,
      valid: validation.valid,
      issues: validation.issues || [],
    });

    if (validation.valid) {
      return {
        parsed: validation.value,
        usageMetadata: ai.usageMetadata,
        partCount: ai.partCount,
        repaired: attempt > 0,
        retries: attempt,
        issues: validation.issues || [],
        attempts,
      };
    }
  }

  return {
    parsed: lastValidation?.value || {},
    usageMetadata: { promptTokenCount: 0, candidatesTokenCount: 0, totalTokenCount: 0 },
    partCount: 0,
    repaired: false,
    retries: 1,
    issues: lastValidation?.issues || [],
    attempts,
    failedValidation: true,
  };
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

function makeStableLocationId(name = '', fallback = 'location') {
  const normalized = normalizeText(name)
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9]+/gu, '_')
    .replace(/^_+|_+$/gu, '')
    .replace(/_+/gu, '_')
    .slice(0, 56);
  return `loc_1m_${normalized || fallback}`;
}

function normalizeDeepLocations(rawLocations = [], incident = {}, chapterCount = 1) {
  const source = toArray(rawLocations).filter((item) => item && typeof item === 'object');
  const normalized = [];

  for (let index = 0; index < source.length; index += 1) {
    const item = source[index];
    const name = normalizeText(item?.name || item?.location || item?.label || '');
    if (!name) continue;

    normalized.push({
      id: normalizeText(item?.id || '') || makeStableLocationId(name, `${incident.id}_${index + 1}`),
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

function dedupeCharactersForResult(items = []) {
  const map = new Map();
  for (const item of items) {
    const name = normalizeText(item?.name || '');
    if (!name) continue;
    const key = name.toLowerCase();
    const existing = map.get(key) || {};
    map.set(key, {
      ...existing,
      ...item,
      name,
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
  worldSeed = null,
  styleSeed = null,
  entityMentions = null,
  styleEvidence = null,
  knowledge = null,
  relationships = [],
  craft = null,
  coverageAudit = null,
  mode = 'incident_only_1m',
  tokenUsage = null,
}) {
  const dedupedEvents = dedupeEvents(events);
  const dedupedLocations = dedupeLocations(locations);
  const normalizedWorldSeed = normalizeWorldSeed(worldSeed || {});
  const normalizedStyleSeed = normalizeStyleSeed(styleSeed || {});
  const normalizedEntityMentions = mergeEntityMentions(createEntityMentions(), entityMentions || createEntityMentions());
  const normalizedStyleEvidence = summarizeStyleEvidence(styleEvidence || {});
  const structuralCharacters = dedupeCharactersForResult([
    ...toArray(knowledge?.characters),
    ...dedupedEvents.flatMap((event) => toArray(event?.characters).map((name) => ({ name }))),
    ...toArray(normalizedEntityMentions.characters).map((item) => ({ name: item.name, role: item.roleHint || 'supporting' })),
  ]);
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
      worldName: normalizeText(worldProfile.world_name || normalizedWorldSeed.world_name || ''),
      worldType: normalizeText(worldProfile.world_type || normalizedWorldSeed.world_type || ''),
      worldScale: normalizeText(worldProfile.world_scale || ''),
      worldEra: normalizeText(worldProfile.world_era || ''),
      rules: dedupeStrings([...(worldProfile.world_rules || []), ...(normalizedWorldSeed.world_rules || [])]),
      description: normalizeText(worldProfile.world_description || normalizedWorldSeed.world_description || ''),
    },
    powers: {},
    magicSystem: {},
    locations: toArray(knowledge?.locations).length ? toArray(knowledge.locations) : dedupedLocations,
    objects: toArray(knowledge?.objects),
    terms: toArray(knowledge?.terms),
  };
  const resolvedCraft = craft || buildCraftProfile({
    styleSeed: normalizedStyleSeed,
    styleEvidence: normalizedStyleEvidence,
    events: dedupedEvents,
  });
  const resolvedRelationships = toArray(relationships);

  const result = {
    meta: {
      part: 1,
      hasMore: false,
      complete: true,
      coveredLayers: ['l1', 'l2', 'l3', 'l4', 'l5', 'l6'],
      runMode: mode,
    },
    world_seed: normalizedWorldSeed,
    style_seed: normalizedStyleSeed,
    entity_mentions: normalizedEntityMentions,
    style_evidence: normalizedStyleEvidence,
    coverage_audit: coverageAudit,
    structural: {
      characters: structuralCharacters,
      ships: [],
      tropes: [],
      metadata: {},
    },
    events: eventsLayer,
    worldbuilding,
    characters: {
      profiles: structuralCharacters,
    },
    locations: worldbuilding.locations,
    objects: worldbuilding.objects,
    terms: worldbuilding.terms,
    relationships: resolvedRelationships,
    craft: resolvedCraft,
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
    const merged = mergeKnowledgeProfile(result, knowledge);
    merged.relationships = resolvedRelationships;
    merged.craft = resolvedCraft;
    merged.coverage_audit = coverageAudit;
    merged.world_seed = normalizedWorldSeed;
    merged.style_seed = normalizedStyleSeed;
    merged.entity_mentions = normalizedEntityMentions;
    merged.style_evidence = normalizedStyleEvidence;
    return merged;
  }

  if (tokenUsage) {
    result.tokenUsage = tokenUsage;
  }

  return result;
}

function finalizeV3Result({
  corpusId,
  analysisId,
  chunks,
  baseResult,
  finalized,
  storyGraph,
  aiSteps = [],
  incidentCount = 0,
  aiApplied = false,
  runMode = 'full_corpus_1m',
  knowledge = null,
}) {
  const withCoreMeta = {
    ...baseResult,
    analysis_run_manifest: finalized.manifest,
    pass_status: finalized.passStatus,
    degraded_run_report: finalized.degradedRunReport,
    story_graph: storyGraph,
    graph_summary: storyGraph.summary,
    knowledge: knowledge || baseResult.knowledge || null,
  };

  const artifact = buildAnalysisArtifactV3({
    corpusId,
    analysisId,
    chunks,
    finalResult: withCoreMeta,
  });

  return {
    ...withCoreMeta,
    ...artifact,
    reviewQueue: artifact.review_queue,
    story_graph: storyGraph,
    graph_summary: storyGraph.summary,
    artifact_version: 'v3',
    meta: {
      ...(baseResult.meta || {}),
      aiSteps,
      incidentCount,
      aiApplied,
      runMode,
      artifactVersion: 'v3',
    },
  };
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
  tracker,
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

  const ai = await callValidatedMultipartStep({
    prompt,
    inputText: context.text,
    options,
    signal,
    maxOutputTokens: modeOptions.maxGlobalOutputTokens,
    maxParts: modeOptions.maxGlobalParts,
    repairTitle: 'Pass A incidents',
    validator: (parsed) => validatePassAOutput(parsed, chapters.length),
  });

  if (ai.failedValidation) {
    markPassDegraded(tracker, 'pass_a', 'validation_failed', {
      issues: ai.issues,
      fallback: 'heuristic_incidents',
    });
  }

  return {
    incidents: normalizeGlobalIncidents(ai.parsed, chapters.length, modeOptions.maxGlobalIncidents),
    worldSeed: normalizeWorldSeed(ai.parsed.world_seed || ai.parsed.worldSeed || {}),
    styleSeed: normalizeStyleSeed(ai.parsed.style_seed || ai.parsed.styleSeed || {}),
    usage: ai.usageMetadata,
    partsGenerated: ai.partCount,
    repaired: ai.repaired,
    retries: ai.retries,
    issues: ai.issues,
    failedValidation: Boolean(ai.failedValidation),
  };
}

async function runPassB({
  incidents,
  chapters,
  options,
  modeOptions,
  signal,
  onProgress,
  tracker,
}) {
  const keyPool = resolveApiKeys(options);
  const concurrency = Math.max(1, Math.min(Math.max(1, keyPool.length), incidents.length || 1));

  const deepByIncident = new Map();
  const allEvents = [];
  const allLocations = [];
  let allMentions = createEntityMentions();
  const allStyleObservations = [];
  let partsGenerated = 0;
  let usage = { promptTokenCount: 0, candidatesTokenCount: 0, totalTokenCount: 0 };

  const processOneIncident = async (incident, globalIndex) => {
    const context = collectIncidentContext(chapters, incident, modeOptions.perIncidentMaxWords);
    if (!context.text) {
      markPassDegraded(tracker, 'pass_b', 'empty_incident_context', {
        incidentId: incident.id,
        fallback: 'skip_incident',
      });
      return {
        incidentId: incident.id,
        patch: normalizeIncidentPatch({}),
        events: [],
        locations: [],
        mentions: createEntityMentions(),
        styleEvidence: { observations: [] },
        usageMetadata: { promptTokenCount: 0, candidatesTokenCount: 0, totalTokenCount: 0 },
        partCount: 0,
        failedValidation: false,
      };
    }

    const prompt = buildDeepIncidentPassPrompt(incident, {
      chapterCount: chapters.length,
      eventBudget: modeOptions.maxEventsPerIncident,
    });

    const ai = await callValidatedMultipartStep({
      prompt,
      inputText: context.text,
      options,
      signal,
      maxOutputTokens: modeOptions.maxDeepOutputTokens,
      maxParts: modeOptions.maxDeepParts,
      apiKeyCursorStart: globalIndex,
      repairTitle: `Pass B incident ${incident.id}`,
      validator: (parsed) => validatePassBOutput(parsed, chapters.length),
    });

    const parsed = toObject(ai.parsed);
    const patch = normalizeIncidentPatch(parsed.incident_patch || parsed.incident || parsed.summary || {});
    const events = normalizeDeepEvents(
      parsed.events || parsed.timelineEvents || [],
      incident,
      chapters.length,
      modeOptions.maxEventsPerIncident,
    );
    const locations = normalizeDeepLocations(parsed.locations || [], incident, chapters.length);
    const mentions = mergeEntityMentions(createEntityMentions(), parsed.mentions || createEntityMentions());
    const styleEvidence = summarizeStyleEvidence(parsed.style_evidence || parsed.styleEvidence || {});

    return {
      incidentId: incident.id,
      patch,
      events,
      locations,
      mentions,
      styleEvidence,
      usageMetadata: ai.usageMetadata,
      partCount: ai.partCount,
      repaired: ai.repaired,
      retries: ai.retries,
      issues: ai.issues,
      failedValidation: Boolean(ai.failedValidation),
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
      if (value.failedValidation) {
        markPassDegraded(tracker, 'pass_b', 'validation_failed', {
          incidentId: value.incidentId,
          issues: value.issues,
          fallback: 'skip_incident',
        });
      }
      deepByIncident.set(value.incidentId, {
        patch: value.patch,
        events: value.events,
        locations: value.locations,
      });
      allEvents.push(...value.events);
      allLocations.push(...value.locations);
      allMentions = mergeEntityMentions(allMentions, value.mentions || createEntityMentions());
      allStyleObservations.push(...toArray(value.styleEvidence?.observations));
      partsGenerated += Number(value.partCount || 0);
      usage = mergeUsage(usage, value.usageMetadata);
    }
  }

  return {
    deepByIncident,
    events: dedupeEvents(allEvents),
    locations: dedupeLocations(allLocations),
    mentions: allMentions,
    styleEvidence: {
      observations: normalizeStyleObservations(allStyleObservations),
    },
    usage,
    partsGenerated,
  };
}

export async function runIncidentOnly1MJob({
  corpusId,
  analysisId = null,
  chunks = [],
  options = {},
  signal,
  onProgress = () => { },
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
  const tracker = createPassTracker(options.runMode || options.mode || 'full_corpus_1m');
  const chapters = buildChaptersFromChunks(chunks);
  if (!chapters.length) {
    const error = new Error('Corpus does not contain readable chapter text');
    error.code = 'EMPTY_CORPUS_CHUNKS';
    throw error;
  }

  startPass(tracker, 'pass_0', 'Canonical Corpus Build');
  emitProgress(onProgress, 'incident_1m_bootstrap', 0.04, 'Preparing 1M corpus context');
  const heuristicArtifacts = buildHeuristicArtifacts(corpusId, chapters, options);
  completePass(tracker, 'pass_0', {
    metrics: {
      chapters: chapters.length,
      heuristicIncidents: heuristicArtifacts.incidents.length,
      heuristicEvents: heuristicArtifacts.events.length,
    },
  });

  if (!canUseAi(options)) {
    markPassDegraded(tracker, 'pass_a', 'missing_model_or_key', {
      fallback: 'heuristic_only',
    });
    const storyGraph = buildStoryGraph({
      incidents: heuristicArtifacts.incidents,
      events: heuristicArtifacts.events,
      knowledge: {},
    });
    const finalResultBase = buildFinalResult({
      incidents: heuristicArtifacts.incidents,
      events: heuristicArtifacts.events,
      locations: heuristicArtifacts.locations,
      mode: 'full_corpus_1m',
    });
    const reviewQueue = buildReviewQueue(
      heuristicArtifacts.incidents,
      heuristicArtifacts.events,
      heuristicArtifacts.locations,
      [],
      {
        corpusId,
        analysisId: `analysis_v2_${corpusId}`,
        graph: storyGraph,
      },
    );
    const finalResult = {
      ...finalResultBase,
      reviewQueue,
      review_queue: reviewQueue,
    };
    const finalized = finalizeTracker(tracker, {
      incidentCount: heuristicArtifacts.incidents.length,
      graphSummary: storyGraph.summary,
    });
    return {
      success: true,
      incidentCount: heuristicArtifacts.incidents.length,
      aiSteps: [],
      partsGenerated: 0,
      finalResult: finalizeV3Result({
        corpusId,
        analysisId,
        chunks,
        baseResult: finalResult,
        finalized,
        storyGraph,
        aiSteps: [],
        incidentCount: heuristicArtifacts.incidents.length,
        aiApplied: false,
        runMode: normalizePublicRunMode(options.runMode || options.mode || 'full_corpus_1m'),
      }),
      aiApplied: false,
      reason: 'missing_model_or_key',
    };
  }

  const aiSteps = [];
  let totalPartsGenerated = 0;
  let tokenUsage = { promptTokenCount: 0, candidatesTokenCount: 0, totalTokenCount: 0 };

  try {
    throwIfAborted(signal);
    startPass(tracker, 'pass_a', 'Global Incident Map');
    emitProgress(onProgress, 'incident_1m_pass_a', 0.18, 'Pass A: global major-incident extraction');
    const passA = await runPassA({
      chapters,
      options,
      modeOptions,
      signal,
      tracker,
    });

    totalPartsGenerated += Number(passA.partsGenerated || 0);
    tokenUsage = mergeUsage(tokenUsage, passA.usage);
    completePass(tracker, 'pass_a', {
      metrics: {
        incidents: passA.incidents.length,
        worldSeedRules: toArray(passA.worldSeed?.world_rules).length,
        styleSeedSignals: toArray(passA.styleSeed?.style_signals).length,
        partsGenerated: passA.partsGenerated || 0,
      },
      repaired: passA.repaired,
      retries: passA.retries,
      status: passA.failedValidation ? 'degraded' : 'completed',
    });

    let incidents = passA.incidents.length
      ? passA.incidents
      : heuristicArtifacts.incidents;
    const worldSeed = passA.worldSeed || normalizeWorldSeed({});
    const styleSeed = passA.styleSeed || normalizeStyleSeed({});
    if (passA.incidents.length > 0) {
      aiSteps.push('pass_a_global_incidents');
    }

    if (!incidents.length) {
      markPassDegraded(tracker, 'pass_a', 'no_incidents_after_validation', {
        fallback: 'heuristic_incidents',
      });
      const storyGraph = buildStoryGraph({
        incidents: heuristicArtifacts.incidents,
        events: heuristicArtifacts.events,
        knowledge: {},
      });
      const finalResultBase = buildFinalResult({
        incidents: heuristicArtifacts.incidents,
        events: heuristicArtifacts.events,
        locations: heuristicArtifacts.locations,
        worldSeed,
        styleSeed,
        mode: 'full_corpus_1m',
        tokenUsage,
      });
      const reviewQueue = buildReviewQueue(
        heuristicArtifacts.incidents,
        heuristicArtifacts.events,
        heuristicArtifacts.locations,
        [],
        {
          corpusId,
          analysisId: `analysis_v2_${corpusId}`,
          graph: storyGraph,
        },
      );
      const finalResult = {
        ...finalResultBase,
        reviewQueue,
        review_queue: reviewQueue,
      };
      const finalized = finalizeTracker(tracker, {
        incidentCount: 0,
        graphSummary: storyGraph.summary,
      });
      return {
        success: true,
        incidentCount: 0,
        aiSteps,
        partsGenerated: totalPartsGenerated,
        finalResult: finalizeV3Result({
          corpusId,
          analysisId,
          chunks,
          baseResult: finalResult,
          finalized,
          storyGraph,
          aiSteps,
          incidentCount: 0,
          aiApplied: aiSteps.length > 0,
          runMode: normalizePublicRunMode(options.runMode || options.mode || 'full_corpus_1m'),
        }),
        aiApplied: aiSteps.length > 0,
        reason: 'no_incidents',
      };
    }

    startPass(tracker, 'pass_b', 'Per-Incident Deep Extraction');
    emitProgress(onProgress, 'incident_1m_pass_b', 0.42, 'Pass B: parallel deep analysis per incident');
    const passB = await runPassB({
      incidents,
      chapters,
      options,
      modeOptions,
      signal,
      onProgress,
      tracker,
    });

    totalPartsGenerated += Number(passB.partsGenerated || 0);
    tokenUsage = mergeUsage(tokenUsage, passB.usage);
    completePass(tracker, 'pass_b', {
      metrics: {
        events: passB.events.length,
        locations: passB.locations.length,
        characterMentions: toArray(passB.mentions?.characters).length,
        objectMentions: toArray(passB.mentions?.objects).length,
        termMentions: toArray(passB.mentions?.terms).length,
        styleObservations: toArray(passB.styleEvidence?.observations).length,
        partsGenerated: passB.partsGenerated || 0,
      },
    });
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
    const entityMentions = mergeEntityMentions(createEntityMentions(), passB.mentions || createEntityMentions());
    const styleEvidence = summarizeStyleEvidence(passB.styleEvidence || { observations: [] });
    let finalResult = buildFinalResult({
      incidents,
      events: baseEvents,
      locations: baseLocations,
      worldSeed,
      styleSeed,
      entityMentions,
      styleEvidence,
      mode: 'full_corpus_1m',
      tokenUsage,
    });

    startPass(tracker, 'pass_c', 'Consolidation');
    emitProgress(onProgress, 'incident_1m_pass_c', 0.84, 'Pass C: consolidation of knowledge, style, and coverage');
    let knowledge = buildKnowledgeFallback({
      worldSeed,
      mentions: entityMentions,
      locations: baseLocations,
      events: baseEvents,
    });
    let relationships = buildRelationshipLayer(entityMentions.relationships);
    let craft = buildCraftProfile({
      styleSeed,
      styleEvidence,
      events: baseEvents,
    });
    let coverageAudit = null;
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
        const validatedKnowledge = validatePassCOutput(extracted.data);
        knowledge = consolidateCanonicalKnowledge({
          ...knowledge,
          ...validatedKnowledge.value,
          characters: [...toArray(knowledge.characters), ...toArray(validatedKnowledge.value.characters)],
          locations: [...toArray(knowledge.locations), ...toArray(validatedKnowledge.value.locations)],
          objects: [...toArray(knowledge.objects), ...toArray(validatedKnowledge.value.objects)],
          terms: [...toArray(knowledge.terms), ...toArray(validatedKnowledge.value.terms)],
        }, baseEvents);
        aiSteps.push('pass_c_knowledge');
        if (validatedKnowledge.issues.length > 0) {
          markPassDegraded(tracker, 'pass_c', 'schema_repaired', {
            issues: validatedKnowledge.issues,
            fallback: 'normalized_knowledge',
          });
        }
      } else {
        markPassDegraded(tracker, 'pass_c', 'knowledge_not_applied', {
          fallback: 'skip_knowledge',
        });
      }
      tokenUsage = mergeUsage(tokenUsage, extracted?.usageMetadata || {});
    } catch {
      markPassDegraded(tracker, 'pass_c', 'knowledge_extraction_failed', {
        fallback: 'skip_knowledge',
      });
    }
    coverageAudit = buildCoverageAudit({
      knowledge,
      mentions: entityMentions,
      locations: baseLocations,
      events: baseEvents,
      relationships,
    });
    if (!coverageAudit.complete) {
      const recalled = applyCoverageRecall({
        knowledge,
        coverageAudit,
        relationships,
      });
      if (recalled.recallApplied) {
        knowledge = consolidateCanonicalKnowledge(recalled.knowledge, baseEvents);
        relationships = recalled.relationships;
        coverageAudit = buildCoverageAudit({
          knowledge,
          mentions: entityMentions,
          locations: baseLocations,
          events: baseEvents,
          relationships,
        });
      }
      markPassDegraded(tracker, 'pass_c', 'coverage_incomplete', {
        coverage: coverageAudit.coverage,
        fallback: 'local_recall',
      });
    }
    finalResult = buildFinalResult({
      incidents,
      events: baseEvents,
      locations: baseLocations,
      worldSeed,
      styleSeed,
      entityMentions,
      styleEvidence,
      knowledge,
      relationships,
      craft,
      coverageAudit,
      mode: 'full_corpus_1m',
      tokenUsage,
    });
    completePass(tracker, 'pass_c', {
      metrics: {
        characters: toArray(knowledge.characters).length,
        locations: toArray(knowledge.locations).length,
        objects: toArray(knowledge.objects).length,
        terms: toArray(knowledge.terms).length,
        relationships: relationships.length,
        styleObservations: toArray(styleEvidence.observations).length,
        coverageComplete: coverageAudit.complete ? 1 : 0,
      },
      status: coverageAudit.complete ? 'completed' : 'degraded',
    });

    startPass(tracker, 'pass_e', 'Story Graph Build');
    const storyGraph = buildStoryGraph({
      incidents,
      events: baseEvents,
      knowledge: knowledge || finalResult.knowledge || {},
      relationships,
    });
    completePass(tracker, 'pass_e', {
      metrics: storyGraph.summary,
    });
    startPass(tracker, 'pass_f', 'Consistency + Coherence');
    completePass(tracker, 'pass_f', {
      metrics: {
        consistencyRisks: toArray(finalResult.consistencyRisks).length,
      },
    });
    startPass(tracker, 'pass_g', 'Review Pack');
    const reviewQueue = buildReviewQueue(
      incidents,
      baseEvents,
      baseLocations,
      toArray(finalResult.consistencyRisks),
      {
        corpusId,
        analysisId: `analysis_v2_${corpusId}`,
        graph: storyGraph,
      },
    );
    finalResult = {
      ...finalResult,
      reviewQueue,
      review_queue: reviewQueue,
    };
    completePass(tracker, 'pass_g', {
      metrics: {
        reviewQueueItems: reviewQueue.length,
      },
    });
    emitProgress(onProgress, 'incident_1m_finalize', 0.95, 'Finalizing incident-only analysis');
    const finalized = finalizeTracker(tracker, {
      incidentCount: incidents.length,
      graphSummary: storyGraph.summary,
    });
    finalResult = {
      ...finalResult,
      tokenUsage,
      meta: {
        ...(finalResult.meta || {}),
        aiSteps,
        incidentCount: incidents.length,
        aiApplied: aiSteps.length > 0,
        runMode: normalizePublicRunMode(options.runMode || options.mode || 'full_corpus_1m'),
        artifactVersion: 'v3',
      },
      knowledge: knowledge || finalResult.knowledge || null,
    };

    finalResult = finalizeV3Result({
      corpusId,
      analysisId,
      chunks,
      baseResult: finalResult,
      finalized,
      storyGraph,
      aiSteps,
      incidentCount: incidents.length,
      aiApplied: aiSteps.length > 0,
      runMode: normalizePublicRunMode(options.runMode || options.mode || 'full_corpus_1m'),
      knowledge: knowledge || finalResult.knowledge || null,
    });

    return {
      success: true,
      incidentCount: incidents.length,
      aiSteps,
      partsGenerated: totalPartsGenerated,
      finalResult,
      aiApplied: aiSteps.length > 0,
    };
  } catch (error) {
    markPassDegraded(tracker, 'pass_a', error?.message || 'incident_only_1m_failed', {
      fallback: 'heuristic_pipeline',
    });
    const storyGraph = buildStoryGraph({
      incidents: heuristicArtifacts.incidents,
      events: heuristicArtifacts.events,
      knowledge: {},
    });
    const fallbackBase = buildFinalResult({
      incidents: heuristicArtifacts.incidents,
      events: heuristicArtifacts.events,
      locations: heuristicArtifacts.locations,
      mode: 'full_corpus_1m',
      tokenUsage,
    });
    const reviewQueue = buildReviewQueue(
      heuristicArtifacts.incidents,
      heuristicArtifacts.events,
      heuristicArtifacts.locations,
      [],
      {
        corpusId,
        analysisId: `analysis_v2_${corpusId}`,
        graph: storyGraph,
      },
    );
    const fallback = {
      ...fallbackBase,
      reviewQueue,
      review_queue: reviewQueue,
    };
    const finalized = finalizeTracker(tracker, {
      incidentCount: heuristicArtifacts.incidents.length,
      graphSummary: storyGraph.summary,
    });

    return {
      success: true,
      incidentCount: heuristicArtifacts.incidents.length,
      aiSteps,
      partsGenerated: totalPartsGenerated,
      finalResult: finalizeV3Result({
        corpusId,
        analysisId,
        chunks,
        baseResult: fallback,
        finalized,
        storyGraph,
        aiSteps,
        incidentCount: heuristicArtifacts.incidents.length,
        aiApplied: aiSteps.length > 0,
        runMode: normalizePublicRunMode(options.runMode || options.mode || 'full_corpus_1m'),
      }),
      aiApplied: aiSteps.length > 0,
      aiError: error?.message || 'incident_only_1m_failed',
    };
  }
}

export default {
  runIncidentOnly1MJob,
};
