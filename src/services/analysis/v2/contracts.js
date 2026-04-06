const PUBLIC_RUN_MODE_ALIASES = {
  fast: 'fast_preview',
  fast_preview: 'fast_preview',
  balanced: 'balanced',
  deep: 'deep',
  incident_only_1m: 'full_corpus_1m',
  full_corpus_1m: 'full_corpus_1m',
  legacy: 'legacy',
};

function normalizeText(value) {
  return String(value || '').replace(/\s+/gu, ' ').trim();
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function toObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function toNumber(value, fallback = null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function resolveChapterNumber(value, chapterCount = 1, fallback = null) {
  const parsed = toNumber(value, fallback);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(Math.max(1, chapterCount || 1), Math.floor(parsed)));
}

function normalizeEvidenceList(value) {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeText(item)).filter(Boolean).slice(0, 12);
  }
  if (typeof value === 'string') {
    return value
      .split(/[\n|]+/u)
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 12);
  }
  return [];
}

function normalizeNameList(value) {
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

function makeStableEntityId(prefix, name, fallback = 'item') {
  const normalized = normalizeText(name)
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9]+/gu, '_')
    .replace(/^_+|_+$/gu, '')
    .replace(/_+/gu, '_')
    .slice(0, 56);
  return `${prefix}_${normalized || fallback}`;
}

function isLocationLikeName(name = '') {
  const normalized = normalizeText(name);
  if (!normalized || normalized.length > 84) return false;
  if (/[.!?]/u.test(normalized)) return false;

  const loose = normalized
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '');
  const tokens = loose.split(/\s+/u).filter(Boolean);
  if (tokens.length === 0 || tokens.length > 8) return false;

  const hints = new Set([
    'nha', 'tro', 'truong', 'phong', 'toa', 'lau', 'sanh', 'san', 'sau',
    'hem', 'ngo', 'duong', 'thanh', 'pho', 'xa', 'huyen', 'lang', 'thon',
    'vien', 'benh', 'vien', 'nui', 'rung', 'song', 'ho', 'dao', 'cau',
    'chua', 'dinh', 'cung', 'dien', 'thap', 'nghia', 'trang', 'lop',
  ]);
  const storyNoise = new Set(['thay', 'noi', 'hoang', 'so', 'mot', 'nay', 'kia', 'roi']);
  const hintCount = tokens.reduce((count, token) => count + (hints.has(token) ? 1 : 0), 0);
  const noiseCount = tokens.reduce((count, token) => count + (storyNoise.has(token) ? 1 : 0), 0);

  if (noiseCount >= 2 && hintCount === 0) return false;
  if (tokens.length >= 4 && hintCount === 0) return false;
  return hintCount > 0 || tokens.length <= 2;
}

function createIssue(path, message, severity = 'error') {
  return { path, message, severity };
}

export function normalizePublicRunMode(mode) {
  const normalized = normalizeText(mode).toLowerCase();
  return PUBLIC_RUN_MODE_ALIASES[normalized] || 'balanced';
}

export function toChapterArrayIndex(chapterNumber) {
  const normalized = toNumber(chapterNumber, null);
  return Number.isFinite(normalized) ? Math.max(0, Math.floor(normalized) - 1) : null;
}

export function validatePassAOutput(raw = {}, chapterCount = 1) {
  const issues = [];
  const source = toArray(raw.incidents);
  const incidents = [];

  for (let index = 0; index < source.length; index += 1) {
    const item = toObject(source[index]);
    const title = normalizeText(item.title || item.name || item.description || '');
    const chapterStart = resolveChapterNumber(item.chapterStart, chapterCount, null);
    const chapterEnd = resolveChapterNumber(item.chapterEnd ?? item.chapterStart, chapterCount, chapterStart);
    const confidence = clamp(item.confidence, 0, 1, 0.65);

    if (!title) {
      issues.push(createIssue(`incidents[${index}].title`, 'Missing incident title'));
      continue;
    }
    if (!Number.isFinite(chapterStart) || !Number.isFinite(chapterEnd)) {
      issues.push(createIssue(`incidents[${index}].chapterRange`, 'Invalid chapterStart/chapterEnd'));
      continue;
    }

    incidents.push({
      id: normalizeText(item.id || '') || `inc_v2_${index + 1}`,
      title,
      type: normalizeText(item.type || 'subplot') || 'subplot',
      chapterStart: Math.min(chapterStart, chapterEnd),
      chapterEnd: Math.max(chapterStart, chapterEnd),
      confidence,
      description: normalizeText(item.description || ''),
      why: normalizeText(item.why || ''),
      anchorEventDescription: normalizeText(item.anchorEventDescription || ''),
      locationHint: normalizeText(item.locationHint || ''),
      tags: normalizeNameList(item.tags),
      boundaryNote: normalizeText(item.boundaryNote || ''),
      evidence: normalizeEvidenceList(item.evidence),
    });
  }

  return {
    valid: incidents.length > 0 && !issues.some((item) => item.severity === 'error'),
    value: {
      meta: toObject(raw.meta),
      incidents,
    },
    issues,
  };
}

export function validatePassBOutput(raw = {}, chapterCount = 1) {
  const issues = [];
  const incidentPatch = toObject(raw.incident);
  const events = [];
  const locations = [];
  const causalLinks = toArray(raw.causal_links || raw.causalLinks)
    .filter((item) => item && typeof item === 'object')
    .map((item) => ({
      fromEventId: normalizeText(item.fromEventId || item.from || ''),
      toEventId: normalizeText(item.toEventId || item.to || ''),
      relation: normalizeText(item.relation || 'causes') || 'causes',
      confidence: clamp(item.confidence, 0, 1, 0.6),
      evidenceRefs: normalizeEvidenceList(item.evidenceRefs || item.evidence),
    }))
    .filter((item) => item.fromEventId && item.toEventId);

  for (const [index, item] of toArray(raw.events).entries()) {
    const event = toObject(item);
    const description = normalizeText(event.description || event.summary || event.title || '');
    const chapter = resolveChapterNumber(event.chapter, chapterCount, null);
    if (!description) {
      issues.push(createIssue(`events[${index}].description`, 'Missing event description'));
      continue;
    }
    if (!Number.isFinite(chapter)) {
      issues.push(createIssue(`events[${index}].chapter`, 'Missing 1-based chapterNumber for event'));
      continue;
    }

    events.push({
      id: normalizeText(event.id || '') || `evt_v2_${index + 1}`,
      description,
      chapter,
      position: normalizeText(event.position || 'middle') || 'middle',
      severity: normalizeText(event.severity || 'major') || 'major',
      eventType: normalizeText(event.eventType || event.type || 'major') || 'major',
      emotionalIntensity: Math.round(clamp(event.emotionalIntensity, 1, 10, 7)),
      insertability: Math.round(clamp(event.insertability, 1, 10, 6)),
      characters: normalizeNameList(event.characters),
      tags: normalizeNameList(event.tags),
      locationName: normalizeText(event.locationName || event.location || ''),
      evidenceSnippet: normalizeText(event.evidenceSnippet || ''),
      evidence: normalizeEvidenceList(event.evidence),
    });
  }

  for (const [index, item] of toArray(raw.locations).entries()) {
    const location = toObject(item);
    const name = normalizeText(location.name || location.location || '');
    if (!name) {
      issues.push(createIssue(`locations[${index}].name`, 'Missing location name'));
      continue;
    }

    locations.push({
      id: normalizeText(location.id || '') || makeStableEntityId('loc_v2', name, String(index + 1)),
      name,
      description: normalizeText(location.description || location.summary || ''),
      aliases: normalizeNameList(location.aliases),
      timeline: toArray(location.timeline)
        .filter((entry) => entry && typeof entry === 'object')
        .map((entry) => ({
          eventId: normalizeText(entry.eventId || entry.id || ''),
          chapter: resolveChapterNumber(entry.chapter, chapterCount, null),
          summary: normalizeText(entry.summary || entry.description || ''),
        }))
        .filter((entry) => entry.eventId || entry.chapter || entry.summary),
    });
  }

  return {
    valid: events.length > 0 && !issues.some((item) => item.severity === 'error'),
    value: {
      incident_patch: {
        description: normalizeText(incidentPatch.description || ''),
        why: normalizeText(incidentPatch.why || incidentPatch.trigger || ''),
        preconditions: normalizeNameList(incidentPatch.preconditions),
        progression: normalizeNameList(incidentPatch.progression),
        turning_points: normalizeNameList(incidentPatch.turning_points || incidentPatch.turningPoints),
        climax: normalizeText(incidentPatch.climax || ''),
        outcome: normalizeText(incidentPatch.outcome || ''),
        consequences: normalizeNameList(incidentPatch.consequences),
        evidence_refs: normalizeEvidenceList(incidentPatch.evidence_refs || incidentPatch.evidenceRefs),
      },
      events,
      locations,
      causal_links: causalLinks,
    },
    issues,
  };
}

export function validatePassCOutput(raw = {}) {
  const issues = [];
  const worldProfile = toObject(raw.world_profile || raw.worldProfile);

  const normalizeEntity = (item, index, kind) => {
    const source = toObject(item);
    const name = normalizeText(source.name || source.term || source.location || source.object || '');
    if (!name) {
      issues.push(createIssue(`${kind}[${index}].name`, `Missing ${kind} name`));
      return null;
    }
    return {
      name,
      ...source,
    };
  };

  return {
    valid: true,
    value: {
      world_profile: {
        world_name: normalizeText(worldProfile.world_name || worldProfile.worldName || ''),
        world_type: normalizeText(worldProfile.world_type || worldProfile.worldType || ''),
        world_scale: normalizeText(worldProfile.world_scale || worldProfile.worldScale || ''),
        world_era: normalizeText(worldProfile.world_era || worldProfile.worldEra || ''),
        world_rules: normalizeNameList(worldProfile.world_rules || worldProfile.worldRules),
        world_description: normalizeText(worldProfile.world_description || worldProfile.worldDescription || ''),
      },
      characters: toArray(raw.characters).map((item, index) => normalizeEntity(item, index, 'characters')).filter(Boolean),
      locations: toArray(raw.locations).map((item, index) => normalizeEntity(item, index, 'locations')).filter(Boolean),
      objects: toArray(raw.objects).map((item, index) => normalizeEntity(item, index, 'objects')).filter(Boolean),
      terms: toArray(raw.terms).map((item, index) => normalizeEntity(item, index, 'terms')).filter(Boolean),
    },
    issues,
  };
}

export function createPassTracker(runMode = 'balanced') {
  return {
    artifactVersion: 'v2',
    runMode: normalizePublicRunMode(runMode),
    manifest: {
      artifactVersion: 'v2',
      pipeline: 'analysis_v2',
      runMode: normalizePublicRunMode(runMode),
      startedAt: Date.now(),
      completedAt: null,
    },
    passStatus: {},
    degradedRunReport: {
      hasDegradedPasses: false,
      items: [],
    },
  };
}

export function startPass(tracker, passId, title, extra = {}) {
  if (!tracker?.passStatus) return;
  tracker.passStatus[passId] = {
    id: passId,
    title,
    status: 'running',
    startedAt: Date.now(),
    completedAt: null,
    retries: 0,
    repaired: false,
    metrics: {},
    ...extra,
  };
}

export function completePass(tracker, passId, extra = {}) {
  const current = tracker?.passStatus?.[passId];
  if (!current) return;
  tracker.passStatus[passId] = {
    ...current,
    status: extra.status || 'completed',
    completedAt: Date.now(),
    metrics: {
      ...(current.metrics || {}),
      ...(extra.metrics || {}),
    },
    repaired: Boolean(extra.repaired || current.repaired),
    retries: Number(extra.retries ?? current.retries ?? 0),
  };
}

export function markPassDegraded(tracker, passId, reason, details = {}) {
  if (!tracker) return;
  tracker.degradedRunReport = tracker.degradedRunReport || { hasDegradedPasses: false, items: [] };
  tracker.degradedRunReport.hasDegradedPasses = true;
  tracker.degradedRunReport.items.push({
    passId,
    reason,
    at: Date.now(),
    ...details,
  });

  const current = tracker.passStatus?.[passId];
  if (current) {
    tracker.passStatus[passId] = {
      ...current,
      status: 'degraded',
      completedAt: Date.now(),
      degradedReason: reason,
    };
  }
}

export function finalizeTracker(tracker, extra = {}) {
  if (!tracker) return null;
  tracker.manifest = {
    ...(tracker.manifest || {}),
    completedAt: Date.now(),
    ...extra,
  };
  return tracker;
}

export function consolidateCanonicalKnowledge(knowledge = {}, events = []) {
  const source = toObject(knowledge);
  const characterMap = new Map();
  for (const item of toArray(source.characters)) {
    const name = normalizeText(item?.name);
    if (!name) continue;
    const key = name.toLowerCase();
    const existing = characterMap.get(key) || {};
    characterMap.set(key, {
      ...existing,
      ...item,
      name,
      timeline: dedupeTimeline([...(toArray(existing.timeline)), ...(toArray(item.timeline))]),
    });
  }

  for (const event of toArray(events)) {
    for (const rawName of toArray(event?.characters)) {
      const name = normalizeText(rawName);
      if (!name) continue;
      const key = name.toLowerCase();
      const existing = characterMap.get(key) || {};
      characterMap.set(key, {
        ...existing,
        id: existing.id || `character:${key}`,
        name,
        role: existing.role || 'supporting',
        timeline: dedupeTimeline([
          ...toArray(existing.timeline),
          {
            eventId: event?.id || null,
            chapter: Number.isFinite(Number(event?.chapter || event?.chapterNumber))
              ? Number(event.chapter || event.chapterNumber)
              : null,
            summary: normalizeText(event?.description || ''),
          },
        ]),
      });
    }
  }

  const characters = [...characterMap.values()];
  const characterNames = new Set(characters.map((item) => item.name.toLowerCase()));

  const locationMap = new Map();

  for (const location of toArray(source.locations)) {
    const name = normalizeText(location?.name);
    if (!name) continue;
    const key = name.toLowerCase();
    if (characterNames.has(key)) continue;
    if (!isLocationLikeName(name)) continue;
    const existing = locationMap.get(key) || {};
    locationMap.set(key, {
      ...existing,
      ...location,
      name,
      aliases: [...new Set([...(toArray(existing.aliases)), ...(toArray(location.aliases))])],
      timeline: dedupeTimeline([...(toArray(existing.timeline)), ...(toArray(location.timeline))]),
      mentionCount: Math.max(Number(existing.mentionCount || 0), Number(location.mentionCount || 0)),
      confidence: Math.max(Number(existing.confidence || 0), Number(location.confidence || 0)),
    });
  }

  const eventLocationNames = new Set(
    toArray(events)
      .map((event) => normalizeText(event.locationName || event.primaryLocationName || event.locationLink?.locationName || ''))
      .filter(Boolean)
      .map((item) => item.toLowerCase()),
  );

  const filteredLocations = [...locationMap.values()].filter((item) => {
    const key = item.name.toLowerCase();
    return isLocationLikeName(item.name) || eventLocationNames.has(key);
  });

  const objects = dedupeNamedEntities(toArray(source.objects));
  const terms = dedupeNamedEntities(toArray(source.terms));

  return {
    ...source,
    characters,
    locations: filteredLocations,
    objects,
    terms,
  };
}

function dedupeNamedEntities(items = []) {
  const map = new Map();
  for (const item of toArray(items)) {
    const name = normalizeText(item?.name);
    if (!name) continue;
    const key = name.toLowerCase();
    const existing = map.get(key) || {};
    map.set(key, {
      ...existing,
      ...item,
      name,
      timeline: dedupeTimeline([...(toArray(existing.timeline)), ...(toArray(item.timeline))]),
    });
  }
  return [...map.values()];
}

function dedupeTimeline(items = []) {
  const seen = new Set();
  const result = [];
  for (const item of toArray(items)) {
    const key = [
      normalizeText(item?.eventId || item?.id || ''),
      Number.isFinite(Number(item?.chapter)) ? Number(item.chapter) : '',
      normalizeText(item?.summary || item?.description || ''),
    ].join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}
