export const CANON_PACK_VERSION = 1;

export function createEmptyCanonPack({
  id = '',
  corpusId = '',
  title = 'Canon Pack',
  sourceTitle = '',
  metadata = {},
} = {}) {
  const timestamp = Date.now();
  return {
    id,
    corpusId,
    title,
    status: 'draft',
    globalCanon: {
      summary: '',
      themes: [],
      majorConflicts: [],
      worldRules: [],
      mainCharacters: [],
      timelineAnchors: [],
      hardRestrictions: [],
    },
    arcCanon: [],
    characterCanon: [],
    relationshipCanon: [],
    chapterCanon: [],
    styleCanon: {
      observations: [],
      tone: '',
      pacing: '',
      voice: '',
    },
    adultCanon: {
      enabled: false,
      notes: [],
    },
    canonRestrictions: [],
    creativeGaps: [],
    canonIndex: {
      byCharacter: {},
      byReveal: {},
      byRelationship: {},
      byWorldbuilding: {},
      recommendedDeepChapters: [],
      incidentClusters: {},
      continuityRisks: [],
    },
    uncertainties: [],
    metadata: {
      version: CANON_PACK_VERSION,
      sourceTitle,
      builtAt: timestamp,
      updatedAt: timestamp,
      ...metadata,
    },
  };
}

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function clean(value, maxLength = 2000) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > maxLength ? `${text.slice(0, maxLength).trim()}...` : text;
}

export function normalizeCanonPack(pack = {}) {
  const base = createEmptyCanonPack({
    id: pack.id || '',
    corpusId: pack.corpusId || '',
    title: clean(pack.title || 'Canon Pack', 180),
    sourceTitle: pack.metadata?.sourceTitle || '',
    metadata: pack.metadata || {},
  });

  return {
    ...base,
    ...pack,
    title: clean(pack.title || base.title, 180),
    globalCanon: {
      ...base.globalCanon,
      ...(pack.globalCanon || {}),
      themes: asArray(pack.globalCanon?.themes),
      majorConflicts: asArray(pack.globalCanon?.majorConflicts),
      worldRules: asArray(pack.globalCanon?.worldRules),
      mainCharacters: asArray(pack.globalCanon?.mainCharacters),
      timelineAnchors: asArray(pack.globalCanon?.timelineAnchors),
      hardRestrictions: asArray(pack.globalCanon?.hardRestrictions),
    },
    arcCanon: asArray(pack.arcCanon),
    characterCanon: asArray(pack.characterCanon).filter((item) => item?.name),
    relationshipCanon: asArray(pack.relationshipCanon),
    chapterCanon: asArray(pack.chapterCanon),
    styleCanon: {
      ...base.styleCanon,
      ...(pack.styleCanon || {}),
      observations: asArray(pack.styleCanon?.observations),
    },
    adultCanon: Boolean(pack.adultCanon?.enabled)
      ? {
        enabled: true,
        detailsHidden: pack.adultCanon?.detailsHidden !== false,
        notes: asArray(pack.adultCanon?.notes),
      }
      : {
        enabled: false,
        notes: [],
      },
    canonRestrictions: asArray(pack.canonRestrictions),
    creativeGaps: asArray(pack.creativeGaps),
    canonIndex: {
      ...base.canonIndex,
      ...(pack.canonIndex || {}),
      recommendedDeepChapters: asArray(pack.canonIndex?.recommendedDeepChapters),
      continuityRisks: asArray(pack.canonIndex?.continuityRisks),
    },
    uncertainties: asArray(pack.uncertainties),
    metadata: {
      ...base.metadata,
      ...(pack.metadata || {}),
      version: CANON_PACK_VERSION,
      readiness: pack.metadata?.readiness || null,
      sourceBatches: asArray(pack.metadata?.sourceBatches),
      coverage: pack.metadata?.coverage || null,
      updatedAt: Date.now(),
    },
  };
}
