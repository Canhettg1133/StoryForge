import db from '../db/database.js';
import { mergeCharacterPatch } from '../../utils/characterIdentity.js';

const HONORIFICS = [
  'su huynh',
  'su ty',
  'su de',
  'su muoi',
  'cong tu',
  'co nuong',
  'tieu thu',
  'dien ha',
  'ha thu',
  'vuong gia',
  'lang quan',
  'thi ve',
  'anh',
  'chi',
  'co',
  'ong',
  'ba',
];

const AMBIGUOUS_TOKENS = new Set([
  'anh',
  'em',
  'chi',
  'co',
  'ong',
  'ba',
  'minh',
  'toi',
  'ta',
  'han',
  'nang',
]);

const KIND_TO_TABLE = {
  character: 'characters',
  location: 'locations',
  object: 'objects',
  world_term: 'worldTerms',
};

function cleanText(value) {
  return String(value || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripDiacritics(value) {
  return cleanText(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function normalizeIdentityText(value) {
  return stripDiacritics(value)
    .replace(/[\u2018\u2019\u201c\u201d"'`()\[\]{}]/g, ' ')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeKind(kind) {
  if (kind === 'term') return 'world_term';
  return kind;
}

function uniqueTextList(values = []) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const text = cleanText(value);
    if (!text) continue;
    const key = normalizeIdentityText(text);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(text);
  }
  return result;
}

function uniqueKeyList(values = []) {
  return [...new Set(values.map((value) => normalizeIdentityText(value)).filter(Boolean))];
}

function stripHonorificPrefix(normalizedValue) {
  let next = normalizeIdentityText(normalizedValue);
  let changed = true;
  while (changed) {
    changed = false;
    for (const honorific of HONORIFICS) {
      if (next === honorific) return '';
      if (next.startsWith(`${honorific} `)) {
        next = next.slice(honorific.length + 1).trim();
        changed = true;
      }
    }
  }
  return next;
}

function meaningfulTokens(value) {
  return normalizeIdentityText(value)
    .split(' ')
    .map((token) => token.trim())
    .filter((token) => token.length > 1 && !AMBIGUOUS_TOKENS.has(token));
}

function numericTokens(value) {
  return normalizeIdentityText(value).match(/\d+/g) || [];
}

function numericIdentityCompatible(left, right) {
  const leftNumbers = numericTokens(left);
  const rightNumbers = numericTokens(right);
  if (leftNumbers.length === 0 && rightNumbers.length === 0) return true;
  if (leftNumbers.length !== rightNumbers.length) return false;
  return leftNumbers.every((token, index) => token === rightNumbers[index]);
}

function isContiguousSubsequence(shorterTokens, longerTokens) {
  if (shorterTokens.length === 0 || shorterTokens.length > longerTokens.length) return false;
  for (let index = 0; index <= longerTokens.length - shorterTokens.length; index += 1) {
    const slice = longerTokens.slice(index, index + shorterTokens.length);
    if (slice.join(' ') === shorterTokens.join(' ')) {
      return true;
    }
  }
  return false;
}

function safeSubsetMatchScore(left, right) {
  if (!numericIdentityCompatible(left, right)) return 0;
  const leftTokens = meaningfulTokens(left);
  const rightTokens = meaningfulTokens(right);
  if (leftTokens.length < 2 || rightTokens.length < 2) return 0;
  const shorter = leftTokens.length <= rightTokens.length ? leftTokens : rightTokens;
  const longer = leftTokens.length > rightTokens.length ? leftTokens : rightTokens;
  if (!isContiguousSubsequence(shorter, longer)) return 0;
  if (longer.slice(longer.length - shorter.length).join(' ') === shorter.join(' ')) {
    return 0.93;
  }
  return 0.9;
}

function mergeUniqueAliases(existing = [], incoming = []) {
  return uniqueTextList([...(Array.isArray(existing) ? existing : []), ...(Array.isArray(incoming) ? incoming : [])]);
}

function firstBlankFill(existingValue, incomingValue) {
  return cleanText(existingValue) ? existingValue : incomingValue;
}

function normalizeEntityIdentity(kind, input = {}) {
  const normalizedKind = normalizeKind(kind);
  const rawName = cleanText(input.raw_name || input.name || input.title || input.term || '');
  const aliases = uniqueTextList([
    ...(Array.isArray(input.aliases) ? input.aliases : []),
    ...(Array.isArray(input.alias_keys) ? input.alias_keys : []),
  ]);
  const normalizedName = normalizeIdentityText(rawName);
  const strippedName = normalizedKind === 'character'
    ? stripHonorificPrefix(normalizedName)
    : normalizedName;
  const aliasKeys = uniqueKeyList([
    ...aliases,
    normalizedName,
    strippedName,
    ...(normalizedKind === 'character'
      ? aliases.map((alias) => stripHonorificPrefix(alias))
      : []),
  ]);
  const identityBase = normalizedKind === 'character'
    ? (strippedName || normalizedName)
    : normalizedName;

  return {
    kind: normalizedKind,
    raw_name: rawName,
    normalized_name: normalizedName,
    stripped_name: strippedName,
    aliases,
    alias_keys: aliasKeys,
    identity_key: identityBase ? `${normalizedKind}:${identityBase}` : '',
  };
}

function buildEntityIdentityRecord(entity, kind) {
  const identity = normalizeEntityIdentity(kind, entity);
  return {
    ...entity,
    entity_kind: normalizeKind(kind),
    identity,
  };
}

function buildEntityIdentityIndex(existingEntities = [], kind) {
  const records = existingEntities.map((entity) => buildEntityIdentityRecord(entity, kind));
  const exactName = new Map();
  const aliases = new Map();

  for (const record of records) {
    const exactKey = record.identity.normalized_name;
    if (exactKey) {
      if (!exactName.has(exactKey)) exactName.set(exactKey, []);
      exactName.get(exactKey).push(record);
    }
    for (const aliasKey of record.identity.alias_keys) {
      if (!aliases.has(aliasKey)) aliases.set(aliasKey, []);
      aliases.get(aliasKey).push(record);
    }
  }

  return { records, exactName, aliases };
}

function buildResolverDebug(candidateIdentity, compared, resolution, reason, matchTier, score) {
  return {
    candidate: {
      normalized_name: candidateIdentity.normalized_name,
      stripped_name: candidateIdentity.stripped_name,
      alias_keys: candidateIdentity.alias_keys,
      identity_key: candidateIdentity.identity_key,
    },
    compared,
    resolution,
    reason,
    match_tier: matchTier,
    score,
  };
}

function uniqueRecords(records = []) {
  const seen = new Set();
  const result = [];
  for (const record of records) {
    const key = record?.id ?? `${record?.entity_kind}:${record?.identity?.identity_key}:${record?.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(record);
  }
  return result;
}

function resolveAmbiguous(candidateIdentity, records, matchTier, reason, score = 0.5) {
  return {
    status: 'ambiguous_review',
    matchedEntity: null,
    matchedEntityId: null,
    score,
    matchTier,
    debug: buildResolverDebug(
      candidateIdentity,
      records.map((record) => ({
        id: record.id || null,
        name: record.name || '',
        normalized_name: record.identity.normalized_name,
        alias_keys: record.identity.alias_keys,
        score,
        tier: matchTier,
      })),
      'ambiguous_review',
      reason,
      matchTier,
      score,
    ),
  };
}

function resolveMatched(candidateIdentity, record, matchTier, reason, score = 1) {
  return {
    status: 'matched_existing',
    matchedEntity: record,
    matchedEntityId: record.id || null,
    score,
    matchTier,
    debug: buildResolverDebug(
      candidateIdentity,
      [{
        id: record.id || null,
        name: record.name || '',
        normalized_name: record.identity.normalized_name,
        alias_keys: record.identity.alias_keys,
        score,
        tier: matchTier,
      }],
      'matched_existing',
      reason,
      matchTier,
      score,
    ),
  };
}

function resolveCreated(candidateIdentity, compared = [], reason = 'No deterministic match found.') {
  return {
    status: 'created_new',
    matchedEntity: null,
    matchedEntityId: null,
    score: 0,
    matchTier: 'create_new',
    debug: buildResolverDebug(candidateIdentity, compared, 'created_new', reason, 'create_new', 0),
  };
}

function resolveCharacterCandidate(candidateIdentity, index) {
  const compared = index.records.map((record) => ({
    id: record.id || null,
    name: record.name || '',
    normalized_name: record.identity.normalized_name,
    alias_keys: record.identity.alias_keys,
  }));
  const exactMatches = uniqueRecords([
    ...(index.exactName.get(candidateIdentity.normalized_name) || []),
  ]);
  if (exactMatches.length === 1) {
    return resolveMatched(candidateIdentity, exactMatches[0], 'exact_normalized_name', 'Exact normalized name match.');
  }
  if (exactMatches.length > 1) {
    return resolveAmbiguous(candidateIdentity, exactMatches, 'exact_normalized_name', 'More than one entity shares the normalized name.');
  }

  const aliasMatches = uniqueRecords([
    ...(index.aliases.get(candidateIdentity.normalized_name) || []),
    ...candidateIdentity.alias_keys.flatMap((aliasKey) => index.aliases.get(aliasKey) || []),
  ]);
  if (aliasMatches.length === 1) {
    return resolveMatched(candidateIdentity, aliasMatches[0], 'exact_alias', 'Exact alias match.');
  }
  if (aliasMatches.length > 1) {
    return resolveAmbiguous(candidateIdentity, aliasMatches, 'exact_alias', 'Alias resolves to multiple existing characters.');
  }

  const subsetCandidates = [];
  const seenIds = new Set();
  for (const record of index.records) {
    const aliasScores = record.identity.alias_keys.map((aliasKey) => Math.max(
      safeSubsetMatchScore(candidateIdentity.normalized_name, aliasKey),
      safeSubsetMatchScore(candidateIdentity.stripped_name, aliasKey),
    ));
    const score = Math.max(
      safeSubsetMatchScore(candidateIdentity.normalized_name, record.identity.normalized_name),
      safeSubsetMatchScore(candidateIdentity.stripped_name, record.identity.normalized_name),
      ...aliasScores,
    );
    if (score <= 0) continue;
    if (seenIds.has(record.id)) continue;
    seenIds.add(record.id);
    subsetCandidates.push({ record, score });
  }
  subsetCandidates.sort((left, right) => right.score - left.score);
  if (subsetCandidates.length === 1) {
    return resolveMatched(
      candidateIdentity,
      subsetCandidates[0].record,
      'safe_subset',
      'Safe contiguous multi-token subset match.',
      subsetCandidates[0].score,
    );
  }
  if (subsetCandidates.length > 1) {
    const [best, second] = subsetCandidates;
    if (best.score >= 0.9 && (!second || best.score - second.score >= 0.04)) {
      return resolveMatched(
        candidateIdentity,
        best.record,
        'safe_subset',
        'Safe subset match with clear winner.',
        best.score,
      );
    }
    return resolveAmbiguous(
      candidateIdentity,
      subsetCandidates.map((item) => item.record),
      'safe_subset',
      'Multiple subset matches are too close to auto-merge.',
      best?.score || 0.9,
    );
  }

  if (candidateIdentity.stripped_name && candidateIdentity.stripped_name !== candidateIdentity.normalized_name) {
    const strippedMatches = uniqueRecords([
      ...(index.exactName.get(candidateIdentity.stripped_name) || []),
      ...(index.aliases.get(candidateIdentity.stripped_name) || []),
    ]);
    if (strippedMatches.length === 1) {
      return resolveMatched(candidateIdentity, strippedMatches[0], 'title_stripped', 'Honorific/title stripped exact match.');
    }
    if (strippedMatches.length > 1) {
      return resolveAmbiguous(candidateIdentity, strippedMatches, 'title_stripped', 'Title-stripped name resolves to multiple characters.');
    }
  }

  return resolveCreated(candidateIdentity, compared, 'No exact/alias/subset character match was safe enough.');
}

function resolveGenericCandidate(candidateIdentity, index) {
  const compared = index.records.map((record) => ({
    id: record.id || null,
    name: record.name || '',
    normalized_name: record.identity.normalized_name,
    alias_keys: record.identity.alias_keys,
  }));
  const exactMatches = uniqueRecords([
    ...(index.exactName.get(candidateIdentity.normalized_name) || []),
  ]);
  if (exactMatches.length === 1) {
    return resolveMatched(candidateIdentity, exactMatches[0], 'exact_normalized_name', 'Exact normalized name match.');
  }
  if (exactMatches.length > 1) {
    return resolveAmbiguous(candidateIdentity, exactMatches, 'exact_normalized_name', 'More than one entity shares the normalized name.');
  }

  const aliasMatches = uniqueRecords([
    ...(index.aliases.get(candidateIdentity.normalized_name) || []),
    ...candidateIdentity.alias_keys.flatMap((aliasKey) => index.aliases.get(aliasKey) || []),
  ]);
  if (aliasMatches.length === 1) {
    return resolveMatched(candidateIdentity, aliasMatches[0], 'exact_alias', 'Exact alias match.');
  }
  if (aliasMatches.length > 1) {
    return resolveAmbiguous(candidateIdentity, aliasMatches, 'exact_alias', 'Alias collision requires manual review.');
  }

  return resolveCreated(candidateIdentity, compared, 'No deterministic exact name or alias match.');
}

function resolveEntityCandidate(candidate, existingEntities = [], kind) {
  const normalizedKind = normalizeKind(kind || candidate?.entity_kind);
  const candidateIdentity = normalizeEntityIdentity(normalizedKind, candidate);
  const index = buildEntityIdentityIndex(existingEntities, normalizedKind);
  if (!candidateIdentity.normalized_name) {
    return {
      status: 'rejected',
      matchedEntity: null,
      matchedEntityId: null,
      score: 0,
      matchTier: 'invalid_candidate',
      debug: buildResolverDebug(candidateIdentity, [], 'rejected', 'Candidate has no usable normalized name.', 'invalid_candidate', 0),
    };
  }
  if (normalizedKind === 'character') {
    return resolveCharacterCandidate(candidateIdentity, index);
  }
  return resolveGenericCandidate(candidateIdentity, index);
}

function mergeGenericEntityPatch(existing, incoming, kind) {
  const patch = {};
  if (kind !== 'object') {
    const nextAliases = mergeUniqueAliases(existing.aliases, incoming.aliases);
    if (JSON.stringify(existing.aliases || []) !== JSON.stringify(nextAliases)) {
      patch.aliases = nextAliases;
    }
  }

  if (kind === 'location') {
    patch.description = firstBlankFill(existing.description, incoming.description);
    patch.details = firstBlankFill(existing.details, incoming.details);
    patch.story_function = firstBlankFill(existing.story_function, incoming.story_function);
  } else if (kind === 'object') {
    patch.description = firstBlankFill(existing.description, incoming.description);
    patch.properties = firstBlankFill(existing.properties, incoming.properties);
    if (!existing.owner_character_id && incoming.owner_character_id) {
      patch.owner_character_id = incoming.owner_character_id;
    }
  } else if (kind === 'world_term') {
    patch.definition = firstBlankFill(existing.definition, incoming.definition);
    patch.category = firstBlankFill(existing.category, incoming.category);
    patch.story_function = firstBlankFill(existing.story_function, incoming.story_function);
  }

  if (incoming.source_chapter_id && !existing.source_chapter_id) {
    patch.source_chapter_id = incoming.source_chapter_id;
  }
  if (incoming.source_kind && !existing.source_kind) {
    patch.source_kind = incoming.source_kind;
  }

  const identity = normalizeEntityIdentity(kind, {
    ...existing,
    ...patch,
    aliases: patch.aliases || existing.aliases || [],
  });
  patch.normalized_name = identity.normalized_name;
  patch.alias_keys = identity.alias_keys;
  patch.identity_key = identity.identity_key;

  Object.keys(patch).forEach((key) => {
    if (patch[key] === existing[key] || (cleanText(patch[key]) === '' && cleanText(existing[key]) !== '')) {
      delete patch[key];
    }
  });

  if (Object.keys(patch).length > 0) {
    patch.updated_at = Date.now();
  }
  return patch;
}

function tablePayloadFromCandidate(projectId, candidate, kind) {
  const normalizedKind = normalizeKind(kind);
  const payload = typeof candidate.payload_json === 'string'
    ? JSON.parse(candidate.payload_json)
    : (candidate.payload_json || candidate);
  const identity = normalizeEntityIdentity(normalizedKind, payload);
  const base = {
    project_id: projectId,
    name: cleanText(payload.name || candidate.raw_name || ''),
    normalized_name: identity.normalized_name,
    alias_keys: identity.alias_keys,
    identity_key: identity.identity_key,
    source_chapter_id: candidate.chapter_id || payload.source_chapter_id || null,
    source_kind: cleanText(payload.source_kind || candidate.source_type || ''),
    created_at: Date.now(),
  };

  if (normalizedKind === 'character') {
    return {
      ...base,
      aliases: mergeUniqueAliases(payload.aliases, candidate.aliases),
      role: cleanText(payload.role || 'supporting') || 'supporting',
      appearance: cleanText(payload.appearance || ''),
      age: cleanText(payload.age || ''),
      personality: cleanText(payload.personality || ''),
      flaws: cleanText(payload.flaws || ''),
      personality_tags: cleanText(payload.personality_tags || payload.personalityTags || ''),
      pronouns_self: cleanText(payload.pronouns_self || ''),
      pronouns_other: cleanText(payload.pronouns_other || ''),
      speech_pattern: cleanText(payload.speech_pattern || ''),
      current_status: cleanText(payload.current_status || ''),
      goals: cleanText(payload.goals || ''),
      secrets: cleanText(payload.secrets || ''),
      notes: cleanText(payload.notes || ''),
      story_function: cleanText(payload.story_function || ''),
    };
  }

  if (normalizedKind === 'location') {
    return {
      ...base,
      aliases: mergeUniqueAliases(payload.aliases, candidate.aliases),
      description: cleanText(payload.description || ''),
      details: cleanText(payload.details || ''),
      story_function: cleanText(payload.story_function || ''),
      parent_location_id: payload.parent_location_id || null,
    };
  }

  if (normalizedKind === 'object') {
    return {
      ...base,
      description: cleanText(payload.description || ''),
      owner_character_id: payload.owner_character_id || null,
      properties: cleanText(payload.properties || ''),
      story_function: cleanText(payload.story_function || ''),
    };
  }

  return {
    ...base,
    aliases: mergeUniqueAliases(payload.aliases, candidate.aliases),
    definition: cleanText(payload.definition || ''),
    category: cleanText(payload.category || 'other') || 'other',
    story_function: cleanText(payload.story_function || ''),
  };
}

function buildSuggestionPayload(candidate, resolution, kind) {
  const normalizedKind = normalizeKind(kind);
  const options = (resolution.debug?.compared || []).map((item) => ({
    entity_id: item.id,
    name: item.name,
    match_tier: item.tier || resolution.matchTier,
    score: item.score || resolution.score || 0,
  }));
  const recommendedTarget = options[0]?.entity_id || null;
  return {
    candidate_ids: [candidate.id],
    entity_kind: normalizedKind,
    raw_name: candidate.raw_name,
    normalized_name: candidate.normalized_name,
    resolution_options: options,
    recommended_action: recommendedTarget ? 'match_existing' : 'create_new',
    recommended_target_id: recommendedTarget,
    resolver_debug_json: resolution.debug,
    source_chapter_id: candidate.chapter_id || null,
    revision_id: candidate.revision_id || null,
  };
}

async function createEntityResolutionSuggestion(projectId, candidate, resolution, kind) {
  const payload = buildSuggestionPayload(candidate, resolution, kind);
  await db.suggestions.add({
    project_id: projectId,
    type: 'entity_resolution',
    status: 'pending',
    source_chapter_id: candidate.chapter_id || null,
    source_scene_id: null,
    target_id: payload.recommended_target_id || null,
    target_name: candidate.raw_name || '',
    current_value: '',
    suggested_value: payload.recommended_target_id
      ? `Gop vao entity #${payload.recommended_target_id}`
      : 'Tao entity moi',
    reasoning: resolution.debug?.reason || 'Entity identity ambiguous; manual review required.',
    candidate_op: JSON.stringify(payload),
    created_at: Date.now(),
  });
}

function parseCandidatePayload(candidate) {
  if (!candidate) return {};
  if (typeof candidate.payload_json === 'string') {
    try {
      return JSON.parse(candidate.payload_json);
    } catch {
      return {};
    }
  }
  return candidate.payload_json || {};
}

async function loadExistingEntities(projectId, kind) {
  const tableName = KIND_TO_TABLE[normalizeKind(kind)];
  if (!tableName) return [];
  return db[tableName].where('project_id').equals(projectId).toArray();
}

async function materializeResolvedDecision(projectId, candidate, resolution, kind, existingEntities) {
  const normalizedKind = normalizeKind(kind);
  const tableName = KIND_TO_TABLE[normalizedKind];
  const table = db[tableName];
  const payload = tablePayloadFromCandidate(projectId, candidate, normalizedKind);

  if (resolution.status === 'matched_existing' && resolution.matchedEntityId) {
    const current = existingEntities.find((entity) => entity.id === resolution.matchedEntityId)
      || await table.get(resolution.matchedEntityId);
    if (!current) {
      return { status: 'ambiguous_review', createdEntry: null, matchedEntityId: null };
    }
    const patch = normalizedKind === 'character'
      ? {
        ...mergeCharacterPatch(current, {
          ...payload,
          aliases: payload.aliases || [],
        }),
        normalized_name: payload.normalized_name,
        alias_keys: payload.alias_keys,
        identity_key: payload.identity_key,
      }
      : mergeGenericEntityPatch(current, payload, normalizedKind);
    if (Object.keys(patch).length > 0) {
      await table.update(current.id, patch);
      Object.assign(current, patch);
    }
    return {
      status: 'matched_existing',
      createdEntry: null,
      matchedEntityId: current.id,
      updatedEntity: current,
    };
  }

  if (resolution.status === 'created_new') {
    const createdId = await table.add(payload);
    const createdEntry = { ...payload, id: createdId };
    existingEntities.push(createdEntry);
    return {
      status: 'created_new',
      createdEntry,
      matchedEntityId: createdId,
    };
  }

  return { status: resolution.status, createdEntry: null, matchedEntityId: null };
}

async function updateCandidateStatus(candidateId, patch) {
  await db.entity_resolution_candidates.update(candidateId, {
    ...patch,
    updated_at: Date.now(),
  });
}

function mergePayloads(existingPayload, incomingPayload) {
  return {
    ...existingPayload,
    ...incomingPayload,
    aliases: mergeUniqueAliases(existingPayload.aliases, incomingPayload.aliases),
  };
}

function toCandidateRows({
  projectId,
  chapterId = null,
  revisionId = null,
  sessionKey = '',
  sourceType = '',
  sourceRef = '',
  resolutionStatus = 'pending_canon',
  extracted = {},
}) {
  const now = Date.now();
  const rowsByKey = new Map();
  const groups = [
    ['character', extracted.characters || []],
    ['location', extracted.locations || []],
    ['object', extracted.objects || []],
    ['world_term', extracted.terms || extracted.worldTerms || []],
  ];

  for (const [kind, items] of groups) {
    for (const item of Array.isArray(items) ? items : []) {
      const payload = item && typeof item === 'object' ? item : { name: cleanText(item) };
      const identity = normalizeEntityIdentity(kind, payload);
      if (!identity.normalized_name) continue;
      const dedupeKey = `${kind}:${identity.identity_key || identity.normalized_name}`;
      const existing = rowsByKey.get(dedupeKey);
      if (existing) {
        const mergedPayload = mergePayloads(parseCandidatePayload(existing), payload);
        const mergedIdentity = normalizeEntityIdentity(kind, mergedPayload);
        rowsByKey.set(dedupeKey, {
          ...existing,
          raw_name: existing.raw_name || payload.name || '',
          normalized_name: mergedIdentity.normalized_name,
          aliases: mergeUniqueAliases(existing.aliases, payload.aliases),
          alias_keys: mergedIdentity.alias_keys,
          identity_key: mergedIdentity.identity_key,
          payload_json: JSON.stringify(mergedPayload),
          updated_at: now,
        });
        continue;
      }
      rowsByKey.set(dedupeKey, {
        project_id: projectId,
        chapter_id: chapterId,
        revision_id: revisionId,
        session_key: sessionKey,
        entity_kind: kind,
        source_type: sourceType,
        source_ref: sourceRef,
        raw_name: identity.raw_name,
        normalized_name: identity.normalized_name,
        aliases: identity.aliases,
        alias_keys: identity.alias_keys,
        identity_key: identity.identity_key,
        payload_json: JSON.stringify(payload),
        resolution_status: resolutionStatus,
        matched_entity_id: null,
        resolver_debug_json: null,
        created_at: now,
        updated_at: now,
      });
    }
  }

  return [...rowsByKey.values()];
}

export async function stageExtractedEntityCandidates({
  projectId,
  chapterId = null,
  revisionId = null,
  sessionKey = '',
  sourceType = 'chapter_extract',
  sourceRef = '',
  resolutionStatus = 'pending_canon',
  extracted = {},
}) {
  if (!projectId) return { stagedCount: 0, rows: [] };
  const rows = toCandidateRows({
    projectId,
    chapterId,
    revisionId,
    sessionKey,
    sourceType,
    sourceRef,
    resolutionStatus,
    extracted,
  });
  if (rows.length === 0) {
    return { stagedCount: 0, rows: [] };
  }
  const ids = await db.entity_resolution_candidates.bulkAdd(rows, undefined, { allKeys: true });
  const materializedRows = rows.map((row, index) => ({
    ...row,
    id: Array.isArray(ids) ? ids[index] : null,
  }));
  return {
    stagedCount: materializedRows.length,
    rows: materializedRows,
  };
}

export async function markEntityCandidatesPendingResolution({
  projectId,
  sessionKey = '',
  chapterId = null,
  revisionId = null,
}) {
  const candidates = await db.entity_resolution_candidates
    .where('project_id')
    .equals(projectId)
    .filter((candidate) => {
      if (sessionKey && candidate.session_key !== sessionKey) return false;
      if (chapterId != null && candidate.chapter_id !== chapterId) return false;
      return candidate.resolution_status === 'pending_canon';
    })
    .toArray();

  for (const candidate of candidates) {
    await updateCandidateStatus(candidate.id, {
      revision_id: revisionId ?? candidate.revision_id ?? null,
      resolution_status: 'pending_resolution',
    });
  }

  return candidates.length;
}

export async function resolveAndMaterializeEntityCandidates({
  projectId,
  sessionKey = '',
  chapterId = null,
  revisionId = null,
}) {
  if (!projectId) {
    return {
      createdCount: 0,
      created: {
        characters: 0,
        locations: 0,
        objects: 0,
        worldTerms: 0,
      },
      createdEntries: { characters: [], locations: [], objects: [], worldTerms: [] },
      stats: {},
    };
  }

  await markEntityCandidatesPendingResolution({
    projectId,
    sessionKey,
    chapterId,
    revisionId,
  });

  const candidates = await db.entity_resolution_candidates
    .where('project_id')
    .equals(projectId)
    .filter((candidate) => {
      if (sessionKey && candidate.session_key !== sessionKey) return false;
      if (chapterId != null && candidate.chapter_id !== chapterId) return false;
      return candidate.resolution_status === 'pending_resolution';
    })
    .toArray();

  const createdEntries = {
    characters: [],
    locations: [],
    objects: [],
    worldTerms: [],
  };
  const stats = {
    matched_existing: 0,
    created_new: 0,
    ambiguous_review: 0,
    rejected: 0,
  };

  const existingByKind = {
    character: await loadExistingEntities(projectId, 'character'),
    location: await loadExistingEntities(projectId, 'location'),
    object: await loadExistingEntities(projectId, 'object'),
    world_term: await loadExistingEntities(projectId, 'world_term'),
  };

  for (const candidate of candidates) {
    const kind = normalizeKind(candidate.entity_kind);
    const existingEntities = existingByKind[kind] || [];
    const resolution = resolveEntityCandidate({
      ...parseCandidatePayload(candidate),
      raw_name: candidate.raw_name,
      aliases: candidate.aliases || [],
      entity_kind: kind,
    }, existingEntities, kind);

    if (resolution.status === 'ambiguous_review') {
      await createEntityResolutionSuggestion(projectId, candidate, resolution, kind);
      stats.ambiguous_review += 1;
      await updateCandidateStatus(candidate.id, {
        revision_id: revisionId ?? candidate.revision_id ?? null,
        resolution_status: 'ambiguous_review',
        resolver_debug_json: JSON.stringify(resolution.debug),
      });
      continue;
    }

    if (resolution.status === 'rejected') {
      stats.rejected += 1;
      await updateCandidateStatus(candidate.id, {
        revision_id: revisionId ?? candidate.revision_id ?? null,
        resolution_status: 'rejected',
        resolver_debug_json: JSON.stringify(resolution.debug),
      });
      continue;
    }

    const materialized = await materializeResolvedDecision(projectId, candidate, resolution, kind, existingEntities);
    if (materialized.status === 'matched_existing') {
      stats.matched_existing += 1;
    } else if (materialized.status === 'created_new' && materialized.createdEntry) {
      stats.created_new += 1;
      if (kind === 'character') createdEntries.characters.push(materialized.createdEntry);
      if (kind === 'location') createdEntries.locations.push(materialized.createdEntry);
      if (kind === 'object') createdEntries.objects.push(materialized.createdEntry);
      if (kind === 'world_term') createdEntries.worldTerms.push(materialized.createdEntry);
    } else if (materialized.status === 'ambiguous_review') {
      stats.ambiguous_review += 1;
    }

    await updateCandidateStatus(candidate.id, {
      revision_id: revisionId ?? candidate.revision_id ?? null,
      resolution_status: materialized.status,
      matched_entity_id: materialized.matchedEntityId || null,
      resolver_debug_json: JSON.stringify(resolution.debug),
    });
  }

  return {
    createdCount: [
      createdEntries.characters.length,
      createdEntries.locations.length,
      createdEntries.objects.length,
      createdEntries.worldTerms.length,
    ].reduce((sum, value) => sum + value, 0),
    created: {
      characters: createdEntries.characters.length,
      locations: createdEntries.locations.length,
      objects: createdEntries.objects.length,
      worldTerms: createdEntries.worldTerms.length,
    },
    createdEntries,
    stats,
  };
}

export async function applyEntityResolutionSuggestion({
  suggestionId,
  resolutionAction = 'auto',
  targetEntityId = null,
}) {
  const suggestion = await db.suggestions.get(suggestionId);
  if (!suggestion) {
    throw new Error('Khong tim thay de xuat entity resolution.');
  }
  const payload = suggestion.candidate_op
    ? JSON.parse(suggestion.candidate_op)
    : {};
  const kind = normalizeKind(payload.entity_kind);
  const candidateIds = Array.isArray(payload.candidate_ids) ? payload.candidate_ids : [];
  if (candidateIds.length === 0) {
    throw new Error('De xuat entity resolution khong co candidate nao.');
  }

  const candidates = await db.entity_resolution_candidates
    .where('id')
    .anyOf(candidateIds)
    .toArray();
  const existingEntities = await loadExistingEntities(suggestion.project_id, kind);
  const action = resolutionAction === 'auto'
    ? (payload.recommended_action || (payload.recommended_target_id ? 'match_existing' : 'create_new'))
    : resolutionAction;
  const targetId = targetEntityId || payload.recommended_target_id || null;
  const createdEntries = {
    characters: [],
    locations: [],
    objects: [],
    worldTerms: [],
  };

  for (const candidate of candidates) {
    const resolution = action === 'match_existing'
      ? {
        status: 'matched_existing',
        matchedEntityId: targetId,
      }
      : {
        status: 'created_new',
        matchedEntityId: null,
      };
    const materialized = await materializeResolvedDecision(
      suggestion.project_id,
      candidate,
      resolution,
      kind,
      existingEntities,
    );
    await updateCandidateStatus(candidate.id, {
      resolution_status: materialized.status,
      matched_entity_id: materialized.matchedEntityId || null,
      resolver_debug_json: JSON.stringify({
        manual_resolution: true,
        action,
        target_entity_id: targetId || null,
      }),
    });

    if (materialized.createdEntry) {
      if (kind === 'character') createdEntries.characters.push(materialized.createdEntry);
      if (kind === 'location') createdEntries.locations.push(materialized.createdEntry);
      if (kind === 'object') createdEntries.objects.push(materialized.createdEntry);
      if (kind === 'world_term') createdEntries.worldTerms.push(materialized.createdEntry);
    }
  }

  return {
    action,
    targetEntityId: targetId,
    createdEntries,
  };
}

export {
  HONORIFICS,
  AMBIGUOUS_TOKENS,
  KIND_TO_TABLE,
  buildEntityIdentityIndex,
  buildEntityIdentityRecord,
  normalizeEntityIdentity,
  normalizeKind,
  parseCandidatePayload,
  resolveEntityCandidate,
};
