/**
 * viewerDbService - Database operations for Phase 4 Analysis Viewer
 * Handles: event_annotations, saved_searches, export_history, event_usage, linked_events
 *
 * IMPORTANT: Dexie compound index syntax uses '[field1+field2]' as a single string key.
 * Queries use .where('[field1+field2]').equals([val1, val2])
 */

import db from '../db/database.js';

function normalizeText(value) {
  return String(value || '').trim();
}

function toComparableName(value) {
  return normalizeText(value).toLowerCase();
}

function safeJsonParse(value, fallback = null) {
  if (!value) return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function safeJsonStringify(value, fallback = '{}') {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value ?? {});
  } catch {
    return fallback;
  }
}

function buildCanonFactDescription(eventPayload, notes = '') {
  const chapter = Number(eventPayload?.chapter);
  const chapterLabel = Number.isFinite(chapter) && chapter > 0 ? `Ch.${chapter}` : 'Ch.?';
  const severity = normalizeText(eventPayload?.severity || 'unknown');
  const locationName = normalizeText(
    eventPayload?.locationLink?.locationName
    || eventPayload?.primaryLocationName
    || '',
  );
  const base = normalizeText(eventPayload?.description || '');
  const parts = [
    `[Corpus Event] ${chapterLabel} | ${severity}`,
    locationName ? `@ ${locationName}` : '',
    base,
    notes ? `Ghi chu: ${normalizeText(notes)}` : '',
  ].filter(Boolean);
  return parts.join(' - ');
}

async function upsertProjectLocationFromEvent(projectId, eventPayload) {
  const locationName = normalizeText(
    eventPayload?.locationLink?.locationName
    || eventPayload?.primaryLocationName
    || '',
  );

  if (!projectId || !locationName) {
    return null;
  }

  const normalized = toComparableName(locationName);
  const existing = await db.locations
    .where('project_id')
    .equals(projectId)
    .filter((item) => toComparableName(item?.name) === normalized)
    .first();

  const detailParts = [
    normalizeText(eventPayload?.locationLink?.evidenceSnippet || ''),
    normalizeText(eventPayload?.grounding?.evidenceSnippet || ''),
  ].filter(Boolean);
  const details = detailParts.join('\n\n');

  if (existing) {
    const patch = {};
    if (!normalizeText(existing.description)) {
      patch.description = `Nhap tu Corpus Analysis (${locationName})`;
    }
    if (details && !normalizeText(existing.details)) {
      patch.details = details;
    }
    if (Object.keys(patch).length > 0) {
      await db.locations.update(existing.id, patch);
    }
    return existing.id;
  }

  return db.locations.add({
    project_id: projectId,
    name: locationName,
    aliases: [],
    description: `Nhap tu Corpus Analysis (${locationName})`,
    details: details || '',
    parent_location_id: null,
    created_at: Date.now(),
    source_type: 'analysis_event',
    source_event_id: normalizeText(eventPayload?.id || ''),
  });
}

async function upsertCanonFactFromEvent({
  eventId,
  corpusId,
  projectId,
  chapterId,
  notes = '',
  eventPayload = null,
  linkedEventId = null,
}) {
  if (!projectId || !eventId || !eventPayload) {
    return null;
  }

  const sourceEventId = normalizeText(eventPayload.id || eventId);
  if (!sourceEventId) {
    return null;
  }

  const existing = await db.canonFacts
    .where('project_id')
    .equals(projectId)
    .filter((fact) => (
      fact?.source_type === 'analysis_event'
      && normalizeText(fact?.source_event_id) === sourceEventId
    ))
    .first();

  const description = buildCanonFactDescription(eventPayload, notes);
  const patch = {
    fact_type: 'fact',
    status: 'active',
    source_chapter_id: chapterId || null,
    source_type: 'analysis_event',
    source_event_id: sourceEventId,
    source_corpus_id: corpusId || null,
    source_link_id: linkedEventId || null,
    event_severity: normalizeText(eventPayload.severity || ''),
    event_chapter: Number.isFinite(Number(eventPayload.chapter))
      ? Number(eventPayload.chapter)
      : null,
    event_location_name: normalizeText(
      eventPayload.locationLink?.locationName
      || eventPayload.primaryLocationName
      || '',
    ),
    event_review_status: normalizeText(eventPayload.reviewStatus || ''),
    event_tags: Array.isArray(eventPayload.tags) ? eventPayload.tags : [],
    event_quality_score: Number(eventPayload?.quality?.score || 0),
    event_grounding_evidence: normalizeText(
      eventPayload?.grounding?.evidenceSnippet
      || eventPayload?.locationLink?.evidenceSnippet
      || '',
    ),
    notes: normalizeText(notes),
    auto_generated: true,
  };

  if (existing) {
    await db.canonFacts.update(existing.id, {
      ...patch,
      description: normalizeText(existing.description) || description,
    });
    return existing.id;
  }

  return db.canonFacts.add({
    project_id: projectId,
    description,
    ...patch,
    created_at: Date.now(),
  });
}

async function materializeLinkedEventToProject({
  eventId,
  corpusId,
  projectId,
  chapterId,
  notes,
  eventPayload,
  linkedEventId,
}) {
  if (!eventPayload || !projectId) {
    return { locationId: null, canonFactId: null };
  }

  const locationId = await upsertProjectLocationFromEvent(projectId, eventPayload);
  const canonFactId = await upsertCanonFactFromEvent({
    eventId,
    corpusId,
    projectId,
    chapterId,
    notes,
    eventPayload,
    linkedEventId,
  });

  return { locationId, canonFactId };
}

function summarizeAnalysisResult(result) {
  const raw = safeJsonParse(result, result) || {};
  const knowledge = parseResultLayer(raw.knowledge);
  const l2 = raw?.events || raw?.resultL2 || {};
  const majorEvents = l2?.majorEvents || l2?.major || l2?.major_events || [];
  const minorEvents = l2?.minorEvents || l2?.minor || l2?.minor_events || [];
  const twists = l2?.plotTwists || l2?.twists || l2?.plot_twists || [];
  const cliffhangers = l2?.cliffhangers || l2?.cliffhanger || l2?.cliff_hangers || [];
  const locations = knowledge?.locations || raw?.worldbuilding?.locations || raw?.locations || raw?.locationEntities || [];
  const incidents = raw?.incidents || raw?.incidentClusters || [];
  const objects = knowledge?.objects || raw?.objects || raw?.worldbuilding?.objects || raw?.worldbuilding?.items || [];
  const terms = knowledge?.terms || raw?.terms || raw?.worldTerms || raw?.worldbuilding?.terms || [];
  const characters = knowledge?.characters || raw?.characters?.profiles || raw?.structural?.characters || [];

  const count = (list) => (Array.isArray(list) ? list.length : 0);

  return {
    majorEvents: count(majorEvents),
    minorEvents: count(minorEvents),
    twists: count(twists),
    cliffhangers: count(cliffhangers),
    totalEvents: count(majorEvents) + count(minorEvents) + count(twists) + count(cliffhangers),
    locations: count(locations),
    incidents: count(incidents),
    characters: count(characters),
    objects: count(objects),
    terms: count(terms),
  };
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function safeArrayFromValue(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return [];
    return trimmed
      .split(/[\n,;|]+/u)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

function mergeUniqueText(existing = [], incoming = []) {
  const map = new Map();
  for (const item of [...existing, ...incoming]) {
    const text = normalizeText(item);
    if (!text) continue;
    const key = text.toLowerCase();
    if (!map.has(key)) {
      map.set(key, text);
    }
  }
  return [...map.values()];
}

function pickFirstText(...values) {
  for (const value of values) {
    const text = normalizeText(value);
    if (text) return text;
  }
  return '';
}

function normalizeEntityName(value) {
  return normalizeText(value);
}

function isLikelyEntityName(name, maxWords = 8, maxLength = 72) {
  const text = normalizeText(name);
  if (!text) return false;
  if (text.length > maxLength) return false;
  if (/[.!?]/u.test(text)) return false;
  const words = text.split(/\s+/u).filter(Boolean);
  if (words.length > maxWords) return false;
  return true;
}

function dedupeByName(items = []) {
  const map = new Map();

  for (const item of toArray(items)) {
    const name = normalizeEntityName(item?.name);
    if (!name) continue;
    const key = name.toLowerCase();
    const aliases = mergeUniqueText([], safeArrayFromValue(item?.aliases));

    if (!map.has(key)) {
      map.set(key, { ...item, name, aliases });
      continue;
    }

    const existing = map.get(key);
    map.set(key, {
      ...existing,
      ...item,
      name: existing.name || name,
      aliases: mergeUniqueText(existing.aliases, aliases),
      description: pickFirstText(existing.description, item.description),
      details: pickFirstText(existing.details, item.details),
      role: pickFirstText(existing.role, item.role),
      personality: pickFirstText(existing.personality, item.personality),
      goals: pickFirstText(existing.goals, item.goals),
      appearance: pickFirstText(existing.appearance, item.appearance),
      category: pickFirstText(existing.category, item.category),
      definition: pickFirstText(existing.definition, item.definition),
      timeline: [
        ...toArray(existing.timeline),
        ...toArray(item.timeline),
      ],
    });
  }

  return [...map.values()];
}

function parseResultLayer(value) {
  return safeJsonParse(value, value) || {};
}

function getKnowledgeNode(raw = {}) {
  const knowledge = parseResultLayer(raw.knowledge);
  if (knowledge && typeof knowledge === 'object' && Object.keys(knowledge).length > 0) {
    return knowledge;
  }
  return {};
}

function normalizeEntityTimeline(value) {
  return toArray(value)
    .filter((item) => item && typeof item === 'object')
    .map((item) => ({
      eventId: normalizeText(item.eventId || item.id || ''),
      chapter: Number.isFinite(Number(item.chapter)) ? Number(item.chapter) : null,
      summary: normalizeText(item.summary || item.description || ''),
    }))
    .filter((item) => item.eventId || item.chapter || item.summary);
}

function extractWorldProfile(raw = {}) {
  const knowledge = getKnowledgeNode(raw);
  const top = parseResultLayer(raw.world_profile || raw.worldProfile);
  const worldProfileNode = parseResultLayer(knowledge.world_profile || knowledge.worldProfile);
  const worldbuilding = parseResultLayer(raw.worldbuilding);
  const l3 = parseResultLayer(raw.resultL3);
  const setting = parseResultLayer(worldbuilding.setting || l3.setting);
  const powers = parseResultLayer(worldbuilding.powers || l3.powers);
  const magicSystem = parseResultLayer(worldbuilding.magicSystem || l3.magicSystem);
  const summary = parseResultLayer(raw.summary);

  const worldName = pickFirstText(
    top.world_name,
    top.worldName,
    worldProfileNode.world_name,
    worldProfileNode.worldName,
    setting.worldName,
    setting.name,
    worldbuilding.worldName,
    worldbuilding.name,
    summary.worldName,
  );
  const worldType = pickFirstText(
    top.world_type,
    top.worldType,
    worldProfileNode.world_type,
    worldProfileNode.worldType,
    setting.worldType,
    setting.type,
    worldbuilding.worldType,
    summary.worldType,
  );
  const worldScale = pickFirstText(
    top.world_scale,
    top.worldScale,
    worldProfileNode.world_scale,
    worldProfileNode.worldScale,
    setting.scale,
    setting.worldScale,
    worldbuilding.worldScale,
    summary.worldScale,
  );
  const worldEra = pickFirstText(
    top.world_era,
    top.worldEra,
    worldProfileNode.world_era,
    worldProfileNode.worldEra,
    setting.era,
    setting.worldEra,
    worldbuilding.worldEra,
    summary.worldEra,
  );
  const worldDescription = pickFirstText(
    top.world_description,
    top.worldDescription,
    worldProfileNode.world_description,
    worldProfileNode.worldDescription,
    setting.description,
    worldbuilding.description,
    summary.worldDescription,
  );

  const worldRules = mergeUniqueText(
    safeArrayFromValue(top.world_rules || top.worldRules),
    safeArrayFromValue(worldProfileNode.world_rules || worldProfileNode.worldRules),
    safeArrayFromValue(setting.rules),
    [
      ...safeArrayFromValue(worldbuilding.rules),
      ...safeArrayFromValue(powers.rules),
      ...safeArrayFromValue(magicSystem.rules),
      ...safeArrayFromValue(summary.worldRules),
    ],
  );

  return {
    world_name: worldName,
    world_type: worldType,
    world_scale: worldScale,
    world_era: worldEra,
    world_description: worldDescription,
    world_rules: worldRules,
  };
}

function normalizeCharacterRecord(item) {
  if (typeof item === 'string') {
    const name = normalizeEntityName(item);
    return name ? { name, aliases: [], role: 'supporting' } : null;
  }

  if (!item || typeof item !== 'object') return null;

  const name = normalizeEntityName(
    item.name
    || item.character
    || item.fullName
    || item.title,
  );
  if (!name) return null;

  return {
    name,
    aliases: safeArrayFromValue(item.aliases),
    role: pickFirstText(item.role, item.type, item.archetype, 'supporting'),
    appearance: pickFirstText(item.appearance, item.look, item.visual),
    personality: pickFirstText(item.personality, item.traits, item.temperament),
    personalityTags: pickFirstText(item.personalityTags, item.personality_tags, item.tags),
    flaws: pickFirstText(item.flaws, item.weakness, item.weaknesses),
    goals: pickFirstText(item.goals, item.goal, item.motivation),
    secrets: pickFirstText(item.secrets, item.secret),
    notes: pickFirstText(item.notes, item.description, item.summary),
    timeline: normalizeEntityTimeline(item.timeline || item.timelineEvents),
  };
}

function extractCharacters(raw = {}) {
  const knowledge = getKnowledgeNode(raw);
  const l1 = parseResultLayer(raw.resultL1);
  const l4 = parseResultLayer(raw.resultL4);
  const structural = parseResultLayer(raw.structural);
  const charactersNode = parseResultLayer(raw.characters);

  const source = [
    ...toArray(knowledge.characters),
    ...toArray(structural.characters),
    ...toArray(l1.characters),
    ...toArray(charactersNode.profiles),
    ...toArray(raw.characterProfiles),
    ...toArray(l4.profiles),
  ];

  return dedupeByName(source
    .map((item) => normalizeCharacterRecord(item))
    .filter(Boolean));
}

function normalizeLocationRecord(item, { trusted = false } = {}) {
  if (typeof item === 'string') {
    const name = normalizeEntityName(item);
    return name ? { name, aliases: [], description: '' } : null;
  }

  if (!item || typeof item !== 'object') return null;

  const name = normalizeEntityName(item.name || item.location || item.label);
  if (!name || !isLikelyEntityName(name, 9, 84)) return null;

  const mentionCount = Number(item.mentionCount || item.mentions || 0);
  const isMajor = Boolean(item.isMajor);
  const description = pickFirstText(item.description, item.summary);

  if (!trusted) {
    if (!description && !isMajor && mentionCount < 2) {
      return null;
    }
  }

  return {
    name,
    aliases: safeArrayFromValue(item.aliases),
    description,
    details: pickFirstText(item.details, item.evidence?.join?.('\n')),
    timeline: normalizeEntityTimeline(item.timeline || item.timelineEvents),
  };
}

function extractLocationsFromEvents(raw = {}) {
  const events = parseResultLayer(raw.events || raw.resultL2);
  const groups = [
    ...toArray(events.majorEvents || events.major || events.major_events),
    ...toArray(events.minorEvents || events.minor || events.minor_events),
    ...toArray(events.plotTwists || events.twists || events.plot_twists),
    ...toArray(events.cliffhangers || events.cliffhanger || events.cliff_hangers),
  ];

  return groups
    .map((event) => {
      const name = pickFirstText(
        event?.locationLink?.locationName,
        event?.primaryLocationName,
        event?.locationName,
      );
      return name ? { name } : null;
    })
    .filter(Boolean);
}

function extractLocations(raw = {}) {
  const knowledge = getKnowledgeNode(raw);
  const worldbuilding = parseResultLayer(raw.worldbuilding);
  const trusted = [
    ...toArray(knowledge.locations),
    ...toArray(worldbuilding.locations),
  ];
  const fallback = [
    ...toArray(raw.locations),
    ...toArray(raw.locationEntities),
    ...extractLocationsFromEvents(raw),
  ];

  return dedupeByName([
    ...trusted.map((item) => normalizeLocationRecord(item, { trusted: true })).filter(Boolean),
    ...fallback.map((item) => normalizeLocationRecord(item, { trusted: false })).filter(Boolean),
  ]);
}

function normalizeWorldTermRecord(item) {
  if (typeof item === 'string') {
    const name = normalizeEntityName(item);
    return name ? { name, category: 'other', definition: '' } : null;
  }

  if (!item || typeof item !== 'object') return null;
  const name = normalizeEntityName(item.name || item.term || item.title);
  if (!name) return null;

  return {
    name,
    aliases: safeArrayFromValue(item.aliases),
    category: pickFirstText(item.category, item.type, 'other'),
    definition: pickFirstText(item.definition, item.description, item.note),
    timeline: normalizeEntityTimeline(item.timeline || item.timelineEvents),
  };
}

function extractWorldTerms(raw = {}) {
  const knowledge = getKnowledgeNode(raw);
  const worldbuilding = parseResultLayer(raw.worldbuilding);
  const l3 = parseResultLayer(raw.resultL3);
  const powers = parseResultLayer(worldbuilding.powers || l3.powers);
  const magicSystem = parseResultLayer(worldbuilding.magicSystem || l3.magicSystem);
  const source = [
    ...toArray(knowledge.terms),
    ...toArray(raw.worldTerms),
    ...toArray(worldbuilding.terms),
    ...toArray(l3.terms),
    ...toArray(powers.terms),
    ...toArray(magicSystem.terms),
  ];

  return dedupeByName(source
    .map((item) => normalizeWorldTermRecord(item))
    .filter(Boolean));
}

function normalizeObjectRecord(item) {
  if (typeof item === 'string') {
    const name = normalizeEntityName(item);
    return name ? { name, owner: '', description: '', properties: '' } : null;
  }

  if (!item || typeof item !== 'object') return null;
  const name = normalizeEntityName(item.name || item.title || item.object);
  if (!name) return null;

  return {
    name,
    owner: pickFirstText(item.owner, item.ownerName, item.holder),
    description: pickFirstText(item.description, item.summary),
    properties: typeof item.properties === 'string'
      ? item.properties
      : safeJsonStringify(item.properties || {}, '{}'),
    timeline: normalizeEntityTimeline(item.timeline || item.timelineEvents),
  };
}

function extractObjects(raw = {}) {
  const knowledge = getKnowledgeNode(raw);
  const worldbuilding = parseResultLayer(raw.worldbuilding);
  const source = [
    ...toArray(knowledge.objects),
    ...toArray(raw.objects),
    ...toArray(worldbuilding.objects),
    ...toArray(worldbuilding.items),
  ];

  return dedupeByName(source
    .map((item) => normalizeObjectRecord(item))
    .filter(Boolean));
}

function flattenEventsForTimeline(raw = {}) {
  const events = parseResultLayer(raw.events || raw.resultL2);
  const groups = [
    ...toArray(events.majorEvents || events.major || events.major_events),
    ...toArray(events.minorEvents || events.minor || events.minor_events),
    ...toArray(events.plotTwists || events.twists || events.plot_twists),
    ...toArray(events.cliffhangers || events.cliffhanger || events.cliff_hangers),
  ];

  return groups
    .filter((item) => item && typeof item === 'object')
    .map((item, index) => ({
      id: normalizeText(item.id || `evt_${index}`),
      chapter: Number.isFinite(Number(item.chapter || item.chapterIndex))
        ? Number(item.chapter || item.chapterIndex)
        : null,
      summary: normalizeText(item.description || item.summary || item.title || ''),
      locationName: normalizeText(
        item.locationLink?.locationName
        || item.primaryLocationName
        || item.locationName
        || '',
      ),
      tags: toArray(item.tags).map((tag) => normalizeText(tag).toLowerCase()).filter(Boolean),
    }))
    .filter((item) => item.chapter || item.summary || item.locationName);
}

function findTimelineForEntity(name, events = [], type = 'generic') {
  const normalizedName = toComparableName(name);
  if (!normalizedName) return [];

  const matched = [];
  for (const event of events) {
    const eventSummary = normalizeText(event.summary);
    const eventSummaryLower = eventSummary.toLowerCase();
    const eventLocationLower = normalizeText(event.locationName).toLowerCase();
    const tagHit = toArray(event.tags).some((tag) => tag.includes(normalizedName));
    const locationHit = (
      eventLocationLower
      && (eventLocationLower.includes(normalizedName) || normalizedName.includes(eventLocationLower))
    );
    const summaryHit = eventSummaryLower.includes(normalizedName);

    const hit = type === 'location'
      ? (locationHit || summaryHit)
      : (summaryHit || tagHit);
    if (!hit) continue;

    matched.push({
      eventId: event.id || null,
      chapter: event.chapter || null,
      summary: eventSummary || '',
    });
  }

  return matched
    .sort((a, b) => Number(a.chapter || 999999) - Number(b.chapter || 999999))
    .slice(0, 10);
}

function timelineToText(timeline = []) {
  if (!timeline.length) return '';
  return timeline
    .map((item) => {
      const chapterText = item.chapter ? `Ch.${item.chapter}` : 'Ch.?';
      const summary = normalizeText(item.summary || item.eventId || '');
      return `${chapterText}: ${summary}`;
    })
    .join('\n');
}

async function materializeSnapshotIntoProject(projectId, result) {
  if (!projectId) {
    return null;
  }

  const raw = safeJsonParse(result, result) || {};
  const worldProfile = extractWorldProfile(raw);
  const characters = extractCharacters(raw);
  const objects = extractObjects(raw);
  const locations = extractLocations(raw);
  const worldTerms = extractWorldTerms(raw);
  const timelineEvents = flattenEventsForTimeline(raw);

  const now = Date.now();
  const stats = {
    worldUpdated: false,
    charactersAdded: 0,
    charactersUpdated: 0,
    locationsAdded: 0,
    locationsUpdated: 0,
    objectsAdded: 0,
    objectsUpdated: 0,
    worldTermsAdded: 0,
    worldTermsUpdated: 0,
    extracted: {
      characters: characters.length,
      locations: locations.length,
      objects: objects.length,
      worldTerms: worldTerms.length,
    },
  };

  await db.transaction(
    'rw',
    db.projects,
    db.characters,
    db.locations,
    db.objects,
    db.worldTerms,
    async () => {
      const project = await db.projects.get(projectId);
      if (project) {
        const patch = {};
        const existingRules = safeArrayFromValue(
          safeJsonParse(project.world_rules, project.world_rules),
        );
        const nextRules = mergeUniqueText(existingRules, worldProfile.world_rules);

        if (!normalizeText(project.world_name) && worldProfile.world_name) {
          patch.world_name = worldProfile.world_name;
        }
        if (!normalizeText(project.world_type) && worldProfile.world_type) {
          patch.world_type = worldProfile.world_type;
        }
        if (!normalizeText(project.world_scale) && worldProfile.world_scale) {
          patch.world_scale = worldProfile.world_scale;
        }
        if (!normalizeText(project.world_era) && worldProfile.world_era) {
          patch.world_era = worldProfile.world_era;
        }
        if (!normalizeText(project.world_description) && worldProfile.world_description) {
          patch.world_description = worldProfile.world_description;
        }
        if (nextRules.length > 0 && JSON.stringify(existingRules) !== JSON.stringify(nextRules)) {
          patch.world_rules = JSON.stringify(nextRules);
        }

        if (Object.keys(patch).length > 0) {
          patch.updated_at = now;
          await db.projects.update(projectId, patch);
          stats.worldUpdated = true;
        }
      }

      const existingCharacters = await db.characters.where('project_id').equals(projectId).toArray();
      const charMap = new Map(
        existingCharacters.map((item) => [toComparableName(item.name), item]),
      );

      for (const incoming of characters) {
        const key = toComparableName(incoming.name);
        if (!key) continue;
        const existing = charMap.get(key);
        const personalityTagsText = Array.isArray(incoming.personalityTags)
          ? incoming.personalityTags.join(', ')
          : normalizeText(incoming.personalityTags || '');

        if (!existing) {
          const createdId = await db.characters.add({
            project_id: projectId,
            name: incoming.name,
            aliases: incoming.aliases || [],
            role: incoming.role || 'supporting',
            appearance: incoming.appearance || '',
            personality: incoming.personality || '',
            flaws: incoming.flaws || '',
            personality_tags: personalityTagsText,
            pronouns_self: '',
            pronouns_other: '',
            speech_pattern: '',
            current_status: '',
            goals: incoming.goals || '',
            secrets: incoming.secrets || '',
            notes: incoming.notes || '',
            created_at: now,
          });
          stats.charactersAdded += 1;
          charMap.set(key, {
            id: createdId,
            ...incoming,
            name: incoming.name,
          });
          continue;
        }

        const patch = {};
        const nextAliases = mergeUniqueText(existing.aliases, incoming.aliases);
        if (JSON.stringify(existing.aliases || []) !== JSON.stringify(nextAliases)) {
          patch.aliases = nextAliases;
        }
        if (!normalizeText(existing.appearance) && incoming.appearance) {
          patch.appearance = incoming.appearance;
        }
        if (!normalizeText(existing.personality) && incoming.personality) {
          patch.personality = incoming.personality;
        }
        if (!normalizeText(existing.flaws) && incoming.flaws) {
          patch.flaws = incoming.flaws;
        }
        if (!normalizeText(existing.personality_tags) && personalityTagsText) {
          patch.personality_tags = personalityTagsText;
        }
        if (!normalizeText(existing.goals) && incoming.goals) {
          patch.goals = incoming.goals;
        }
        if (!normalizeText(existing.secrets) && incoming.secrets) {
          patch.secrets = incoming.secrets;
        }
        if (!normalizeText(existing.notes) && incoming.notes) {
          patch.notes = incoming.notes;
        }
        const existingRole = normalizeText(existing.role || 'supporting').toLowerCase();
        const incomingRole = normalizeText(incoming.role || '').toLowerCase();
        if (
          incomingRole
          && incomingRole !== existingRole
          && (existingRole === 'supporting' || !existingRole)
        ) {
          patch.role = incomingRole;
        }

        if (Object.keys(patch).length > 0) {
          await db.characters.update(existing.id, patch);
          stats.charactersUpdated += 1;
        }
      }

      const ownerIdForName = (ownerName) => {
        const key = toComparableName(ownerName);
        if (!key) return null;
        return charMap.get(key)?.id || null;
      };

      const mergeTimelineText = (baseText, timelineText) => {
        const base = normalizeText(baseText);
        if (!timelineText) return base;
        if (base.toLowerCase().includes('timeline:')) return base;
        if (!base) return `Timeline:\n${timelineText}`;
        return `${base}\n\nTimeline:\n${timelineText}`;
      };

      const resolveEntityTimeline = (incoming, type = 'generic') => {
        const explicit = normalizeEntityTimeline(incoming?.timeline || []);
        if (explicit.length > 0) {
          return explicit;
        }
        return findTimelineForEntity(incoming?.name, timelineEvents, type);
      };

      const existingObjects = await db.objects.where('project_id').equals(projectId).toArray();
      const objectMap = new Map(
        existingObjects.map((item) => [toComparableName(item.name), item]),
      );

      for (const incoming of objects) {
        const key = toComparableName(incoming.name);
        if (!key) continue;
        const existing = objectMap.get(key);
        const timeline = resolveEntityTimeline(incoming, 'generic');
        const timelineText = timelineToText(timeline);
        const resolvedOwnerId = ownerIdForName(incoming.owner);
        const mergedProperties = mergeTimelineText(incoming.properties, timelineText);

        if (!existing) {
          const createdId = await db.objects.add({
            project_id: projectId,
            name: incoming.name,
            description: incoming.description || '',
            owner_character_id: resolvedOwnerId,
            properties: mergedProperties || '',
            created_at: now,
          });
          stats.objectsAdded += 1;
          objectMap.set(key, {
            id: createdId,
            ...incoming,
          });
          continue;
        }

        const patch = {};
        if (!normalizeText(existing.description) && incoming.description) {
          patch.description = incoming.description;
        }
        if (!existing.owner_character_id && resolvedOwnerId) {
          patch.owner_character_id = resolvedOwnerId;
        }
        if (timelineText) {
          patch.properties = mergeTimelineText(existing.properties || incoming.properties || '', timelineText);
        } else if (!normalizeText(existing.properties) && mergedProperties) {
          patch.properties = mergedProperties;
        }

        if (Object.keys(patch).length > 0) {
          await db.objects.update(existing.id, patch);
          stats.objectsUpdated += 1;
        }
      }

      const existingLocations = await db.locations.where('project_id').equals(projectId).toArray();
      const locationMap = new Map(
        existingLocations.map((item) => [toComparableName(item.name), item]),
      );

      for (const incoming of locations) {
        const key = toComparableName(incoming.name);
        if (!key) continue;
        const existing = locationMap.get(key);
        const timeline = resolveEntityTimeline(incoming, 'location');
        const timelineText = timelineToText(timeline);
        const mergedDetails = mergeTimelineText(incoming.details, timelineText);

        if (!existing) {
          const createdId = await db.locations.add({
            project_id: projectId,
            name: incoming.name,
            aliases: incoming.aliases || [],
            description: incoming.description || '',
            details: mergedDetails || '',
            parent_location_id: null,
            created_at: now,
            source_type: 'analysis_snapshot',
          });
          stats.locationsAdded += 1;
          locationMap.set(key, {
            id: createdId,
            ...incoming,
          });
          continue;
        }

        const patch = {};
        const nextAliases = mergeUniqueText(existing.aliases, incoming.aliases);
        if (JSON.stringify(existing.aliases || []) !== JSON.stringify(nextAliases)) {
          patch.aliases = nextAliases;
        }
        if (!normalizeText(existing.description) && incoming.description) {
          patch.description = incoming.description;
        }
        if (timelineText) {
          patch.details = mergeTimelineText(existing.details || incoming.details || '', timelineText);
        } else if (!normalizeText(existing.details) && incoming.details) {
          patch.details = incoming.details;
        }

        if (Object.keys(patch).length > 0) {
          await db.locations.update(existing.id, patch);
          stats.locationsUpdated += 1;
        }
      }

      const existingWorldTerms = await db.worldTerms.where('project_id').equals(projectId).toArray();
      const termMap = new Map(
        existingWorldTerms.map((item) => [toComparableName(item.name), item]),
      );

      for (const incoming of worldTerms) {
        const key = toComparableName(incoming.name);
        if (!key) continue;
        const existing = termMap.get(key);
        const timeline = resolveEntityTimeline(incoming, 'generic');
        const timelineText = timelineToText(timeline);
        const mergedDefinition = mergeTimelineText(incoming.definition, timelineText);

        if (!existing) {
          const createdId = await db.worldTerms.add({
            project_id: projectId,
            name: incoming.name,
            aliases: incoming.aliases || [],
            definition: mergedDefinition || '',
            category: incoming.category || 'other',
            created_at: now,
          });
          stats.worldTermsAdded += 1;
          termMap.set(key, {
            id: createdId,
            ...incoming,
          });
          continue;
        }

        const patch = {};
        const nextAliases = mergeUniqueText(existing.aliases, incoming.aliases);
        if (JSON.stringify(existing.aliases || []) !== JSON.stringify(nextAliases)) {
          patch.aliases = nextAliases;
        }
        if (timelineText) {
          patch.definition = mergeTimelineText(existing.definition || incoming.definition || '', timelineText);
        } else if (!normalizeText(existing.definition) && incoming.definition) {
          patch.definition = incoming.definition;
        }
        if (!normalizeText(existing.category) && incoming.category) {
          patch.category = incoming.category;
        }

        if (Object.keys(patch).length > 0) {
          await db.worldTerms.update(existing.id, patch);
          stats.worldTermsUpdated += 1;
        }
      }
    },
  );

  return stats;
}

// ─── Event Annotations ────────────────────────────────────────────────────────

/**
 * Get annotation for a specific event
 */
export async function getAnnotation(corpusId, eventId) {
  const results = await db.event_annotations
    .where('[corpus_id+event_id]')
    .equals([corpusId, eventId])
    .toArray();
  return results[0] || null;
}

/**
 * Get all annotations for a corpus
 */
export async function getAnnotationsForCorpus(corpusId) {
  return db.event_annotations
    .where('corpus_id')
    .equals(corpusId)
    .toArray();
}

/**
 * Get starred annotations only
 */
export async function getStarredAnnotations(corpusId) {
  return db.event_annotations
    .where('corpus_id')
    .equals(corpusId)
    .filter(a => a.starred)
    .toArray();
}

/**
 * Get annotations with notes
 */
export async function getAnnotatedEvents(corpusId) {
  return db.event_annotations
    .where('corpus_id')
    .equals(corpusId)
    .filter(a => Boolean(a.note))
    .toArray();
}

/**
 * Save (upsert) annotation for an event
 */
export async function saveAnnotation(corpusId, eventId, data) {
  const existing = await db.event_annotations
    .where('[corpus_id+event_id]')
    .equals([corpusId, eventId])
    .first();

  const record = {
    corpus_id: corpusId,
    event_id: eventId,
    note: data.note ?? '',
    custom_tags: Array.isArray(data.customTags) ? data.customTags : (data.custom_tags || []),
    starred: Boolean(data.starred),
    usage_count: existing?.usage_count ?? 0,
    linked_project_ids: Array.isArray(data.linkedProjectIds)
      ? data.linkedProjectIds
      : (data.linked_project_ids || []),
    updated_at: Date.now(),
  };

  if (existing) {
    await db.event_annotations.update(existing.id, record);
    return existing.id;
  } else {
    record.created_at = Date.now();
    return db.event_annotations.add(record);
  }
}

/**
 * Delete annotation
 */
export async function deleteAnnotation(corpusId, eventId) {
  const existing = await db.event_annotations
    .where('[corpus_id+event_id]')
    .equals([corpusId, eventId])
    .first();
  if (existing) {
    await db.event_annotations.delete(existing.id);
  }
}

/**
 * Toggle star on annotation
 */
export async function toggleAnnotationStar(corpusId, eventId) {
  const existing = await db.event_annotations
    .where('[corpus_id+event_id]')
    .equals([corpusId, eventId])
    .first();
  if (existing) {
    await db.event_annotations.update(existing.id, {
      starred: !existing.starred,
      updated_at: Date.now(),
    });
    return !existing.starred;
  }
  return false;
}

/**
 * Batch update annotations (e.g., after editing events)
 */
export async function batchUpdateAnnotations(corpusId, eventIds, updates) {
  const annotations = await db.event_annotations
    .where('corpus_id')
    .equals(corpusId)
    .filter(a => eventIds.includes(a.event_id))
    .toArray();

  await db.event_annotations.bulkPut(
    annotations.map(a => ({
      ...a,
      ...updates,
      updated_at: Date.now(),
    }))
  );
}

// ─── Saved Searches ───────────────────────────────────────────────────────────

/**
 * Get all saved searches for a corpus (non-history only)
 */
export async function getSavedSearches(corpusId) {
  return db.saved_searches
    .where('corpus_id')
    .equals(corpusId)
    .filter(s => !s.name?.startsWith('__history__'))
    .reverse()
    .sortBy('created_at');
}

/**
 * Get all saved searches (global)
 */
export async function getAllSavedSearches() {
  return db.saved_searches
    .filter(s => !s.name?.startsWith('__history__'))
    .reverse()
    .sortBy('created_at');
}

/**
 * Save a named search query
 */
export async function saveSearch(search) {
  const record = {
    corpus_id: search.corpusId || null,
    name: search.name || `Search ${new Date().toLocaleString('vi-VN')}`,
    query: search.query || '',
    filters: typeof search.filters === 'object' ? JSON.stringify(search.filters) : (search.filters || '{}'),
    created_at: Date.now(),
  };
  return db.saved_searches.add(record);
}

/**
 * Update a saved search
 */
export async function updateSavedSearch(id, updates) {
  const patch = { ...updates };
  if (updates.filters && typeof updates.filters === 'object') {
    patch.filters = JSON.stringify(updates.filters);
  }
  patch.created_at = Date.now();
  await db.saved_searches.update(id, patch);
}

/**
 * Delete a saved search
 */
export async function deleteSavedSearch(id) {
  await db.saved_searches.delete(id);
}

/**
 * Find saved search by name for a corpus
 */
export async function findSavedSearchByName(corpusId, name) {
  const results = await db.saved_searches
    .where('corpus_id')
    .equals(corpusId)
    .filter(s => s.name === name)
    .toArray();
  return results[0] || null;
}

// ─── Search History ────────────────────────────────────────────────────────────

const MAX_SEARCH_HISTORY = 50;

/**
 * Add query to search history (deduplicated, newest first)
 */
export async function addToSearchHistory(corpusId, query, filters = {}) {
  if (!query || !query.trim()) return;

  // Remove duplicate if exists
  const existing = await db.saved_searches
    .where('corpus_id')
    .equals(corpusId)
    .filter(s => s.query === query && s.name?.startsWith('__history__'))
    .toArray();

  for (const item of existing) {
    await db.saved_searches.delete(item.id);
  }

  // Add new entry with history marker
  const record = {
    corpus_id: corpusId,
    name: `__history__${query.substring(0, 60)}`,
    query: query.trim(),
    filters: JSON.stringify(filters),
    created_at: Date.now(),
  };
  const id = await db.saved_searches.add(record);

  // Trim history to max entries
  const allHistory = await db.saved_searches
    .where('corpus_id')
    .equals(corpusId)
    .filter(s => s.name?.startsWith('__history__'))
    .toArray();

  if (allHistory.length > MAX_SEARCH_HISTORY) {
    const sorted = allHistory.sort((a, b) => b.created_at - a.created_at);
    const toDelete = sorted.slice(MAX_SEARCH_HISTORY);
    await db.saved_searches.bulkDelete(toDelete.map(h => h.id));
  }

  return id;
}

/**
 * Get search history for a corpus
 */
export async function getSearchHistory(corpusId, limit = 20) {
  const history = await db.saved_searches
    .where('corpus_id')
    .equals(corpusId)
    .filter(s => s.name?.startsWith('__history__'))
    .toArray();

  const sorted = history
    .sort((a, b) => b.created_at - a.created_at)
    .slice(0, limit);

  return sorted.map(h => ({
    ...h,
    query: h.query,
    filters: h.filters ? JSON.parse(h.filters) : {},
  }));
}

/**
 * Clear search history for a corpus
 */
export async function clearSearchHistory(corpusId) {
  const history = await db.saved_searches
    .where('corpus_id')
    .equals(corpusId)
    .filter(s => s.name?.startsWith('__history__'))
    .toArray();

  await db.saved_searches.bulkDelete(history.map(h => h.id));
}

// ─── Export History ───────────────────────────────────────────────────────────

/**
 * Record an export action
 */
export async function recordExport(corpusId, eventIds, format, options = {}) {
  const record = {
    corpus_id: corpusId,
    event_ids: JSON.stringify(eventIds),
    event_count: eventIds.length,
    format,
    options: JSON.stringify(options),
    created_at: Date.now(),
  };
  return db.export_history.add(record);
}

/**
 * Get export history for a corpus
 */
export async function getExportHistory(corpusId, limit = 20) {
  return db.export_history
    .where('corpus_id')
    .equals(corpusId)
    .reverse()
    .limit(limit)
    .toArray();
}

/**
 * Get all export history
 */
export async function getAllExportHistory(limit = 50) {
  return db.export_history
    .orderBy('created_at')
    .reverse()
    .limit(limit)
    .toArray();
}

/**
 * Delete export history entry
 */
export async function deleteExportHistory(id) {
  await db.export_history.delete(id);
}

// ─── Event Usage Tracking ─────────────────────────────────────────────────────

/**
 * Increment usage count for an event
 */
export async function trackEventUsage(corpusId, eventId, action = 'export') {
  const existing = await db.event_usage
    .where('[corpus_id+event_id]')
    .equals([corpusId, eventId])
    .first();

  if (existing) {
    const history = existing.history || [];
    history.unshift({
      action,
      timestamp: Date.now(),
    });
    // Keep last 20 actions
    if (history.length > 20) history.pop();

    await db.event_usage.update(existing.id, {
      usage_count: (existing.usage_count || 0) + 1,
      last_used_at: Date.now(),
      last_action: action,
      history,
    });
    return existing.usage_count + 1;
  } else {
    await db.event_usage.add({
      corpus_id: corpusId,
      event_id: eventId,
      usage_count: 1,
      last_used_at: Date.now(),
      last_action: action,
      history: [{ action, timestamp: Date.now() }],
    });
    return 1;
  }
}

/**
 * Batch track usage for multiple events
 */
export async function batchTrackUsage(corpusId, eventIds, action = 'export') {
  for (const eventId of eventIds) {
    await trackEventUsage(corpusId, eventId, action);
  }
}

/**
 * Get usage stats for events in a corpus
 */
export async function getUsageStats(corpusId) {
  const usages = await db.event_usage
    .where('corpus_id')
    .equals(corpusId)
    .toArray();

  const stats = {};
  let totalUsage = 0;
  let mostUsed = null;
  let maxCount = 0;

  for (const u of usages) {
    stats[u.event_id] = {
      count: u.usage_count,
      lastUsed: u.last_used_at,
      lastAction: u.last_action,
    };
    totalUsage += u.usage_count;
    if (u.usage_count > maxCount) {
      maxCount = u.usage_count;
      mostUsed = u.event_id;
    }
  }

  return { stats, totalUsage, mostUsed, maxCount };
}

/**
 * Get usage count for a single event
 */
export async function getEventUsageCount(corpusId, eventId) {
  const existing = await db.event_usage
    .where('[corpus_id+event_id]')
    .equals([corpusId, eventId])
    .first();
  return existing?.usage_count || 0;
}

/**
 * Reset usage count for an event
 */
export async function resetEventUsage(corpusId, eventId) {
  const existing = await db.event_usage
    .where('[corpus_id+event_id]')
    .equals([corpusId, eventId])
    .first();
  if (existing) {
    await db.event_usage.update(existing.id, {
      usage_count: 0,
      history: [],
      last_used_at: null,
      last_action: null,
    });
  }
}

// ─── Linked Events (to Projects) ──────────────────────────────────────────────

/**
 * Link an event to a story project
 */
export async function linkEventToProject(
  eventId,
  corpusId,
  projectId,
  chapterId = null,
  sceneId = null,
  notes = '',
  eventPayload = null,
) {
  // Check if link already exists
  const existing = await db.linked_events
    .where('[event_id+project_id]')
    .equals([eventId, projectId])
    .first();

  const normalizedEvent = eventPayload && typeof eventPayload === 'object'
    ? eventPayload
    : null;
  const eventSnapshot = normalizedEvent
    ? {
      id: normalizeText(normalizedEvent.id || eventId),
      description: normalizeText(normalizedEvent.description || ''),
      chapter: Number.isFinite(Number(normalizedEvent.chapter)) ? Number(normalizedEvent.chapter) : null,
      severity: normalizeText(normalizedEvent.severity || ''),
      reviewStatus: normalizeText(normalizedEvent.reviewStatus || ''),
      locationName: normalizeText(
        normalizedEvent.locationLink?.locationName
        || normalizedEvent.primaryLocationName
        || '',
      ),
      qualityScore: Number(normalizedEvent?.quality?.score || 0),
    }
    : null;

  let linkId;

  if (existing) {
    await db.linked_events.update(existing.id, {
      chapter_id: chapterId,
      scene_id: sceneId,
      notes,
      event_summary: eventSnapshot?.description || existing.event_summary || '',
      event_chapter: eventSnapshot?.chapter ?? existing.event_chapter ?? null,
      event_severity: eventSnapshot?.severity || existing.event_severity || '',
      event_location_name: eventSnapshot?.locationName || existing.event_location_name || '',
      event_review_status: eventSnapshot?.reviewStatus || existing.event_review_status || '',
      event_quality_score: Number.isFinite(eventSnapshot?.qualityScore)
        ? eventSnapshot.qualityScore
        : (existing.event_quality_score || 0),
      event_snapshot: eventSnapshot ? safeJsonStringify(eventSnapshot) : (existing.event_snapshot || null),
      updated_at: Date.now(),
    });
    linkId = existing.id;
  } else {
    linkId = await db.linked_events.add({
      event_id: eventId,
      corpus_id: corpusId,
      project_id: projectId,
      chapter_id: chapterId,
      scene_id: sceneId,
      notes,
      event_summary: eventSnapshot?.description || '',
      event_chapter: eventSnapshot?.chapter ?? null,
      event_severity: eventSnapshot?.severity || '',
      event_location_name: eventSnapshot?.locationName || '',
      event_review_status: eventSnapshot?.reviewStatus || '',
      event_quality_score: Number(eventSnapshot?.qualityScore || 0),
      event_snapshot: eventSnapshot ? safeJsonStringify(eventSnapshot) : null,
      created_at: Date.now(),
    });
  }

  try {
    const materialized = await materializeLinkedEventToProject({
      eventId,
      corpusId,
      projectId,
      chapterId,
      notes,
      eventPayload: normalizedEvent,
      linkedEventId: linkId,
    });

    if (materialized.locationId || materialized.canonFactId) {
      await db.linked_events.update(linkId, {
        materialized_location_id: materialized.locationId || null,
        materialized_canon_fact_id: materialized.canonFactId || null,
        updated_at: Date.now(),
      });
    }
  } catch (error) {
    // Do not fail linking because materialization failed.
    console.warn('Failed to materialize linked event into project store:', error);
  }

  return linkId;
}

/**
 * Unlink an event from a project
 */
export async function unlinkEventFromProject(eventId, projectId) {
  const existing = await db.linked_events
    .where('[event_id+project_id]')
    .equals([eventId, projectId])
    .first();
  if (existing) {
    await db.linked_events.delete(existing.id);
  }
}

/**
 * Get all events linked to a project
 */
export async function getEventsLinkedToProject(projectId) {
  return db.linked_events
    .where('project_id')
    .equals(projectId)
    .toArray();
}

/**
 * Get all projects an event is linked to
 */
export async function getProjectsLinkedToEvent(eventId) {
  return db.linked_events
    .where('event_id')
    .equals(eventId)
    .toArray();
}

/**
 * Get all event links for a corpus
 */
export async function getEventLinksForCorpus(corpusId) {
  return db.linked_events
    .where('corpus_id')
    .equals(corpusId)
    .toArray();
}

/**
 * Update link notes
 */
export async function updateEventLinkNotes(linkId, notes) {
  await db.linked_events.update(linkId, {
    notes,
    updated_at: Date.now(),
  });
}

/**
 * Get events linked to a specific chapter
 */
export async function getEventsLinkedToChapter(projectId, chapterId) {
  return db.linked_events
    .where('project_id')
    .equals(projectId)
    .filter(l => l.chapter_id === chapterId)
    .toArray();
}

// ─────────────────────────────────────────────────────────────────────────────
// Analysis snapshots (L1-L6) persisted by project
// ─────────────────────────────────────────────────────────────────────────────

export async function saveAnalysisSnapshotToProject({
  projectId,
  corpusId,
  analysisId,
  status = 'completed',
  layers = [],
  result = null,
  materializeProjectEntities = true,
}) {
  if (!projectId || !analysisId) {
    throw new Error('projectId và analysisId là bắt buộc để lưu snapshot.');
  }

  const resultJson = safeJsonStringify(result, '{}');
  const summary = summarizeAnalysisResult(result);
  const now = Date.now();

  const existing = await db.project_analysis_snapshots
    .where('[project_id+analysis_id]')
    .equals([projectId, analysisId])
    .first();

  const record = {
    project_id: projectId,
    corpus_id: corpusId || null,
    analysis_id: analysisId,
    status: normalizeText(status || 'completed'),
    layers: Array.isArray(layers) ? layers : [],
    result_json: resultJson,
    summary,
    updated_at: now,
  };

  let snapshotId = null;
  if (existing) {
    await db.project_analysis_snapshots.update(existing.id, record);
    snapshotId = existing.id;
  } else {
    snapshotId = await db.project_analysis_snapshots.add({
      ...record,
      created_at: now,
    });
  }

  let materialized = null;
  if (materializeProjectEntities) {
    materialized = await materializeSnapshotIntoProject(projectId, result);
  }

  return {
    snapshotId,
    summary,
    materialized,
  };
}

export async function getProjectAnalysisSnapshots(projectId, limit = 20) {
  if (!projectId) return [];
  const rows = await db.project_analysis_snapshots
    .where('project_id')
    .equals(projectId)
    .reverse()
    .sortBy('updated_at');
  return rows.slice(0, limit);
}

export async function getProjectAnalysisSnapshot(projectId, analysisId) {
  if (!projectId || !analysisId) return null;
  return db.project_analysis_snapshots
    .where('[project_id+analysis_id]')
    .equals([projectId, analysisId])
    .first();
}

export async function deleteProjectAnalysisSnapshot(snapshotId) {
  if (!snapshotId) return;
  await db.project_analysis_snapshots.delete(snapshotId);
}

// ─── Combined helpers ──────────────────────────────────────────────────────────

/**
 * Load all viewer data for a corpus (annotations + saved searches + usage)
 */
export async function loadViewerDataForCorpus(corpusId) {
  const [annotations, savedSearches, searchHistory, exportHistory, usageStats, linkedEvents] =
    await Promise.all([
      getAnnotationsForCorpus(corpusId),
      getSavedSearches(corpusId),
      getSearchHistory(corpusId),
      getExportHistory(corpusId),
      getUsageStats(corpusId),
      getEventLinksForCorpus(corpusId),
    ]);

  return {
    annotations,
    savedSearches,
    searchHistory,
    exportHistory,
    usageStats,
    linkedEvents,
  };
}

/**
 * Build a lookup map of annotations keyed by eventId
 */
export async function getAnnotationMap(corpusId) {
  const annotations = await getAnnotationsForCorpus(corpusId);
  const map = {};
  for (const a of annotations) {
    map[a.event_id] = a;
  }
  return map;
}

/**
 * Build a lookup map of usage counts keyed by eventId
 */
export async function getUsageCountMap(corpusId) {
  const usages = await db.event_usage
    .where('corpus_id')
    .equals(corpusId)
    .toArray();
  const map = {};
  for (const u of usages) {
    map[u.event_id] = u.usage_count || 0;
  }
  return map;
}
