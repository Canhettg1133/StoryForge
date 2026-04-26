import { createEmptyCanonPack, normalizeCanonPack } from './canonPackSchema.js';
import { evaluateCanonPackReadiness } from './canonPackReadiness.js';

function uniqueByText(items = []) {
  const seen = new Set();
  const result = [];
  for (const item of items) {
    const text = typeof item === 'string' ? item : JSON.stringify(item);
    const key = text.toLowerCase().replace(/\s+/g, ' ').trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

function mergeCharacter(existing, incoming) {
  return {
    ...existing,
    ...Object.fromEntries(Object.entries(incoming).filter(([_key, value]) => {
      if (Array.isArray(value)) return value.length > 0;
      return value !== undefined && value !== null && value !== '';
    })),
    aliases: uniqueByText([...(existing.aliases || []), ...(incoming.aliases || [])]),
    evidence: uniqueByText([...(existing.evidence || []), ...(incoming.evidence || [])]),
  };
}

export function buildCanonIndex({ scoutResults = [], deepAnalysisItems = [] } = {}) {
  const byCharacter = {};
  const byReveal = {};
  const byRelationship = {};
  const byWorldbuilding = {};
  const recommendedDeepChapters = new Set();

  for (const result of scoutResults || []) {
    const chapterIndex = Number(result.chapterIndex || 0);
    if (!chapterIndex) continue;
    if (result.recommendation === 'deep_load') recommendedDeepChapters.add(chapterIndex);
    const signals = Array.isArray(result.detectedSignals) ? result.detectedSignals : [];
    if (signals.includes('reveal')) byReveal[chapterIndex] = result.reason || '';
    if (signals.includes('relationship_shift')) byRelationship[chapterIndex] = result.reason || '';
    if (signals.includes('worldbuilding')) byWorldbuilding[chapterIndex] = result.reason || '';
  }

  for (const item of deepAnalysisItems || []) {
    const result = item?.result || {};
    for (const chapterCanon of result.chapterCanon || []) {
      for (const name of chapterCanon.charactersAppearing || []) {
        if (!byCharacter[name]) byCharacter[name] = [];
        byCharacter[name].push(chapterCanon.chapterIndex);
      }
    }
  }

  for (const name of Object.keys(byCharacter)) {
    byCharacter[name] = [...new Set(byCharacter[name])].sort((a, b) => a - b);
  }

  return {
    byCharacter,
    byReveal,
    byRelationship,
    byWorldbuilding,
    recommendedDeepChapters: [...recommendedDeepChapters].sort((a, b) => a - b),
  };
}

export function buildCanonPack({
  corpus,
  arcs = [],
  scoutResults = [],
  deepAnalysisItems = [],
  allowAdultCanon = false,
  sourceBatches = [],
} = {}) {
  const pack = createEmptyCanonPack({
    corpusId: corpus?.id || '',
    title: `${corpus?.title || 'Truyện'} - Canon Pack`,
    sourceTitle: corpus?.title || '',
    metadata: {
      sourceFileName: corpus?.sourceFileName || '',
      chapterCount: corpus?.chapterCount || 0,
    },
  });

  const characterMap = new Map();
  const chapterCanon = [];
  const relationshipCanon = [];
  const worldRules = [];
  const timelineAnchors = [];
  const styleObservations = [];
  const adultNotes = [];
  const restrictions = [];
  const gaps = [];
  const uncertainties = [];
  const worldUpdates = [];
  const analysisWindows = [];
  const incidentClusters = [];
  const continuityRisks = [];

  for (const item of deepAnalysisItems || []) {
    if (item.status !== 'complete' || !item.result) continue;
    const result = item.result;
    chapterCanon.push(...(result.chapterCanon || []));
    relationshipCanon.push(...(result.relationshipUpdates || []));
    timelineAnchors.push(...(result.timelineEvents || []));
    styleObservations.push(...(result.styleObservations || []));
    adultNotes.push(...(result.adultCanonNotes || []));
    restrictions.push(...(result.canonRestrictions || []));
    gaps.push(...(result.creativeGaps || []));
    uncertainties.push(...(result.uncertainties || []));
    analysisWindows.push(...(result.analysisWindows || []));
    incidentClusters.push(...(result.incidentClusters || []));
    continuityRisks.push(...(result.continuityRisks || []));
    uncertainties.push(...(result.continuityRisks || []).map((risk) => {
      const chapters = Array.isArray(risk.chapterIndexes) && risk.chapterIndexes.length > 0
        ? ` chapters ${risk.chapterIndexes.join(', ')}`
        : '';
      return `[${risk.severity || 'medium'} ${risk.type || 'continuity'}${chapters}] ${risk.description || ''}`;
    }));

    for (const update of result.characterUpdates || []) {
      const key = String(update.name || '').toLowerCase();
      if (!key) continue;
      characterMap.set(key, mergeCharacter(characterMap.get(key) || { name: update.name }, update));
    }

    for (const update of result.worldUpdates || []) {
      worldUpdates.push(update);
      if (update.type === 'rule') {
        worldRules.push(update.description || update.name);
      }
    }
  }

  pack.arcCanon = (arcs || []).map((arc) => ({
    id: arc.id,
    title: arc.title,
    chapterStart: arc.chapterStart,
    chapterEnd: arc.chapterEnd,
    summary: arc.summary,
    importance: arc.importance,
    whyLoad: arc.whyLoad,
    recommendedDeepChapters: arc.recommendedDeepChapters || [],
  }));
  pack.chapterCanon = chapterCanon.sort((a, b) => Number(a.chapterIndex || 0) - Number(b.chapterIndex || 0));
  pack.characterCanon = [...characterMap.values()].sort((a, b) => a.name.localeCompare(b.name));
  pack.relationshipCanon = relationshipCanon;
  pack.globalCanon.summary = pack.chapterCanon
    .slice(0, 12)
    .map((chapter) => `Chương ${chapter.chapterIndex}: ${chapter.summary}`)
    .filter(Boolean)
    .join('\n');
  pack.globalCanon.worldRules = uniqueByText(worldRules);
  pack.globalCanon.timelineAnchors = timelineAnchors;
  pack.globalCanon.mainCharacters = pack.characterCanon.slice(0, 12).map((character) => character.name);
  pack.globalCanon.hardRestrictions = uniqueByText(restrictions);
  pack.styleCanon.observations = uniqueByText(styleObservations);
  pack.adultCanon = allowAdultCanon
    ? {
      enabled: true,
      detailsHidden: true,
      notes: uniqueByText(adultNotes),
    }
    : {
      enabled: false,
      notes: [],
    };
  pack.canonRestrictions = uniqueByText(restrictions);
  pack.creativeGaps = uniqueByText(gaps);
  pack.uncertainties = uniqueByText(uncertainties);
  pack.canonIndex = buildCanonIndex({ scoutResults, deepAnalysisItems });
  pack.metadata.worldUpdates = worldUpdates;
  pack.metadata.analysisWindows = analysisWindows;
  pack.metadata.incidentClusters = incidentClusters;
  pack.metadata.continuityRisks = continuityRisks;
  pack.canonIndex.incidentClusters = Object.fromEntries(incidentClusters.map((incident) => [
    incident.id || incident.title,
    incident.chapterIndexes || [],
  ]).filter(([key]) => key));
  pack.canonIndex.continuityRisks = continuityRisks.map((risk) => ({
    type: risk.type,
    severity: risk.severity,
    chapterIndexes: risk.chapterIndexes || [],
    description: risk.description,
  }));
  pack.metadata.sourceBatches = sourceBatches;
  pack.metadata.coverage = {
    chapterCanonCount: pack.chapterCanon.length,
    chapterCount: Number(corpus?.chapterCount || 0),
    deepAnalysisItemCount: (deepAnalysisItems || []).filter((item) => item.status === 'complete').length,
  };
  pack.metadata.readiness = evaluateCanonPackReadiness(pack, corpus, {
    deepAnalysisItems,
    allowAdultCanon,
  });

  return normalizeCanonPack(pack);
}
