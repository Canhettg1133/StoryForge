import aiService from '../ai/client.js';
import modelRouter, { QUALITY_MODES, TASK_TYPES } from '../ai/router.js';
import { parseAIJsonValue } from '../../utils/aiJson.js';
import { buildDeepAnalysisPrompt } from './prompts/deepAnalysisPrompt.js';

const DEFAULT_BATCH_TOKEN_CAP = 120000;
const ARRAY_FIELDS = [
  'chapterCanon',
  'characterUpdates',
  'relationshipUpdates',
  'worldUpdates',
  'timelineEvents',
  'styleObservations',
  'adultCanonNotes',
  'canonRestrictions',
  'creativeGaps',
  'uncertainties',
  'sourceEvidence',
  'analysisWindows',
  'incidentClusters',
  'continuityRisks',
];

function cleanText(value, maxLength = 1200) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > maxLength ? `${text.slice(0, maxLength).trim()}...` : text;
}

function normalizeStringList(value, maxLength = 900) {
  if (Array.isArray(value)) {
    return value.map((item) => cleanText(item, maxLength)).filter(Boolean);
  }
  const text = cleanText(value, maxLength);
  return text ? [text] : [];
}

function normalizeChapterIndex(value, fallback = 0) {
  const parsed = Math.trunc(Number(value));
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  return Math.max(0, Math.trunc(Number(fallback)) || 0);
}

function normalizeChapterIndexList(value) {
  return [...new Set(normalizeStringList(value, 40)
    .map((item) => normalizeChapterIndex(item))
    .filter((item) => item > 0))]
    .sort((a, b) => a - b);
}

export function normalizeDeepAnalysisResult(raw, { allowAdultCanon = false } = {}) {
  const parsed = raw && typeof raw === 'object' ? raw : {};
  const result = Object.fromEntries(ARRAY_FIELDS.map((field) => [field, []]));

  result.chapterCanon = Array.isArray(parsed.chapterCanon)
    ? parsed.chapterCanon.map((item) => ({
      chapterIndex: normalizeChapterIndex(item?.chapterIndex),
      title: cleanText(item?.title, 180),
      summary: cleanText(item?.summary, 1600),
      mainEvents: normalizeStringList(item?.mainEvents),
      charactersAppearing: normalizeStringList(item?.charactersAppearing, 180),
      stateChanges: normalizeStringList(item?.stateChanges),
      evidence: normalizeStringList(item?.evidence),
    })).filter((item) => item.chapterIndex > 0 || item.summary || item.mainEvents.length > 0)
    : [];

  result.characterUpdates = Array.isArray(parsed.characterUpdates)
    ? parsed.characterUpdates.map((item) => ({
      name: cleanText(item?.name, 180),
      aliases: normalizeStringList(item?.aliases, 120),
      role: cleanText(item?.role, 120),
      status: cleanText(item?.status, 400),
      personality: cleanText(item?.personality, 800),
      goals: cleanText(item?.goals, 500),
      secrets: cleanText(item?.secrets, 500),
      voice: cleanText(item?.voice, 500),
      evidence: normalizeStringList(item?.evidence),
    })).filter((item) => item.name)
    : [];

  result.relationshipUpdates = Array.isArray(parsed.relationshipUpdates)
    ? parsed.relationshipUpdates.map((item) => ({
      characterA: cleanText(item?.characterA || item?.charA, 180),
      characterB: cleanText(item?.characterB || item?.charB, 180),
      relation: cleanText(item?.relation || item?.relationship, 240),
      change: cleanText(item?.change || item?.summary, 900),
      evidence: normalizeStringList(item?.evidence),
    })).filter((item) => item.characterA && item.characterB)
    : [];

  result.worldUpdates = Array.isArray(parsed.worldUpdates)
    ? parsed.worldUpdates.map((item) => {
      const type = ['location', 'object', 'term', 'faction', 'rule'].includes(item?.type) ? item.type : 'term';
      return {
        type,
        name: cleanText(item?.name, 180),
        description: cleanText(item?.description || item?.definition, 1000),
        evidence: normalizeStringList(item?.evidence),
      };
    }).filter((item) => item.name || item.description)
    : [];

  result.timelineEvents = Array.isArray(parsed.timelineEvents)
    ? parsed.timelineEvents.map((item) => ({
      chapterIndex: normalizeChapterIndex(item?.chapterIndex),
      event: cleanText(item?.event || item?.description, 1000),
      dateMarker: cleanText(item?.dateMarker || item?.date_marker, 180),
      evidence: normalizeStringList(item?.evidence),
    })).filter((item) => item.event)
    : [];

  result.styleObservations = normalizeStringList(parsed.styleObservations);
  result.adultCanonNotes = allowAdultCanon ? normalizeStringList(parsed.adultCanonNotes) : [];
  result.canonRestrictions = normalizeStringList(parsed.canonRestrictions);
  result.creativeGaps = normalizeStringList(parsed.creativeGaps);
  result.uncertainties = normalizeStringList(parsed.uncertainties);
  result.sourceEvidence = normalizeStringList(parsed.sourceEvidence);
  result.analysisWindows = Array.isArray(parsed.analysisWindows)
    ? parsed.analysisWindows.map((item, index) => ({
      windowId: cleanText(item?.windowId || item?.id || `window_${index + 1}`, 120),
      chapterStart: normalizeChapterIndex(item?.chapterStart || item?.chapter_start),
      chapterEnd: normalizeChapterIndex(item?.chapterEnd || item?.chapter_end),
      summary: cleanText(item?.summary, 1600),
      keyIncidents: normalizeStringList(item?.keyIncidents || item?.key_incidents),
      evidence: normalizeStringList(item?.evidence),
    })).filter((item) => item.chapterStart || item.chapterEnd || item.summary)
    : [];
  result.incidentClusters = Array.isArray(parsed.incidentClusters)
    ? parsed.incidentClusters.map((item, index) => ({
      id: cleanText(item?.id || `incident_${index + 1}`, 120),
      title: cleanText(item?.title, 220),
      chapterIndexes: normalizeChapterIndexList(item?.chapterIndexes || item?.chapter_indexes),
      summary: cleanText(item?.summary, 1600),
      canonImpact: cleanText(item?.canonImpact || item?.canon_impact, 1200),
      evidence: normalizeStringList(item?.evidence),
    })).filter((item) => item.title || item.summary || item.chapterIndexes.length > 0)
    : [];
  result.continuityRisks = Array.isArray(parsed.continuityRisks)
    ? parsed.continuityRisks.map((item) => {
      const type = ['timeline', 'character_state', 'relationship', 'world_rule', 'style', 'restriction'].includes(item?.type) ? item.type : 'restriction';
      const severity = ['low', 'medium', 'high'].includes(item?.severity) ? item.severity : 'medium';
      return {
        type,
        severity,
        chapterIndexes: normalizeChapterIndexList(item?.chapterIndexes || item?.chapter_indexes),
        description: cleanText(item?.description || item?.summary, 1400),
        evidence: normalizeStringList(item?.evidence),
        suggestedReview: cleanText(item?.suggestedReview || item?.suggested_review, 900),
      };
    }).filter((item) => item.description)
    : [];
  return result;
}

export function buildDeepAnalysisTargets({
  selectedChapterIndexes = [],
  selectedArcIds = [],
  arcs = [],
  groupManualChapters = false,
  manualGroupSize = 6,
} = {}) {
  const targets = [];
  const seenChapters = new Set();
  const seenArcIds = new Set();
  const arcById = new Map((arcs || []).map((arc) => [arc.id, arc]));

  for (const arcId of selectedArcIds || []) {
    if (seenArcIds.has(arcId)) continue;
    const arc = arcById.get(arcId);
    if (!arc) continue;
    seenArcIds.add(arcId);
    const chapterIndexes = Array.isArray(arc.recommendedDeepChapters) && arc.recommendedDeepChapters.length > 0
      ? arc.recommendedDeepChapters
      : Array.from({ length: Math.max(0, Number(arc.chapterEnd) - Number(arc.chapterStart) + 1) }, (_item, index) => Number(arc.chapterStart) + index);
    const normalizedChapterIndexes = [...new Set(chapterIndexes.map(Number).filter((value) => Number.isFinite(value) && value > 0))].sort((a, b) => a - b);
    normalizedChapterIndexes.forEach((chapterIndex) => seenChapters.add(chapterIndex));
    targets.push({
      targetType: 'arc',
      targetId: arc.id,
      title: arc.title || `Arc ${targets.length + 1}`,
      chapterIndexes: normalizedChapterIndexes,
    });
  }

  const manualChapterIndexes = [...new Set((selectedChapterIndexes || [])
    .map((chapterIndex) => normalizeChapterIndex(chapterIndex))
    .filter((chapterIndex) => chapterIndex > 0 && !seenChapters.has(chapterIndex)))]
    .sort((a, b) => a - b);

  if (groupManualChapters) {
    const maxGroupSize = Math.max(1, Math.trunc(Number(manualGroupSize)) || 6);
    let group = [];
    const flush = () => {
      if (group.length === 0) return;
      group.forEach((chapterIndex) => seenChapters.add(chapterIndex));
      const first = group[0];
      const last = group[group.length - 1];
      targets.push({
        targetType: group.length === 1 ? 'chapter' : 'chapter_set',
        targetId: group.length === 1 ? String(first) : `chapters_${first}_${last}`,
        title: group.length === 1 ? `Chapter ${first}` : `Chapter set ${first}-${last}`,
        chapterIndexes: group,
      });
      group = [];
    };

    for (const chapterIndex of manualChapterIndexes) {
      const previous = group[group.length - 1];
      if (group.length > 0 && (chapterIndex !== previous + 1 || group.length >= maxGroupSize)) {
        flush();
      }
      group.push(chapterIndex);
    }
    flush();
  }

  for (const chapterIndex of groupManualChapters ? [] : manualChapterIndexes) {
    const normalized = normalizeChapterIndex(chapterIndex);
    if (!normalized || seenChapters.has(normalized)) continue;
    seenChapters.add(normalized);
    targets.push({
      targetType: 'chapter',
      targetId: String(normalized),
      title: `Chương ${normalized}`,
      chapterIndexes: [normalized],
    });
  }

  return targets.filter((target) => target.chapterIndexes.length > 0);
}

export function planDeepAnalysisBatches({ targets = [], chapters = [], tokenCap = DEFAULT_BATCH_TOKEN_CAP } = {}) {
  const chapterByIndex = new Map((chapters || []).map((chapter) => [Number(chapter.index), chapter]));
  const batches = [];

  for (const target of targets) {
    let current = [];
    let currentTokens = 0;
    const targetChapters = (target.chapterIndexes || [])
      .map((index) => chapterByIndex.get(Number(index)))
      .filter(Boolean)
      .sort((a, b) => Number(a.index) - Number(b.index));

    for (const chapter of targetChapters) {
      const chapterTokens = Math.max(1, Number(chapter.estimatedTokens || 0));
      if (current.length > 0 && currentTokens + chapterTokens > tokenCap) {
        batches.push({ target, chapters: current, estimatedTokens: currentTokens });
        current = [];
        currentTokens = 0;
      }
      current.push(chapter);
      currentTokens += chapterTokens;
    }

    if (current.length > 0) {
      batches.push({ target, chapters: current, estimatedTokens: currentTokens });
    }
  }

  return batches;
}

export function runDeepAnalysisBatch({
  corpusTitle = '',
  target,
  chapters = [],
  allowAdultCanon = false,
}) {
  const messages = buildDeepAnalysisPrompt({ corpusTitle, target, chapters, allowAdultCanon });
  aiService.setRouter(modelRouter);

  return new Promise((resolve, reject) => {
    aiService.send({
      taskType: TASK_TYPES.FREE_PROMPT,
      messages,
      stream: false,
      allowConcurrent: true,
      routeOptions: {
        qualityOverride: QUALITY_MODES.BEST,
        useProxyQualityRouting: true,
      },
      onComplete: (text) => {
        try {
          resolve(normalizeDeepAnalysisResult(parseAIJsonValue(text), { allowAdultCanon }));
        } catch (error) {
          reject(error);
        }
      },
      onError: reject,
    });
  });
}

export function abortDeepAnalysis() {
  aiService.abort();
}
