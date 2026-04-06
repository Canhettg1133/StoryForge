import { randomUUID } from 'node:crypto';
import { parseAIJsonValue } from '../../../utils/aiJson.js';
import { normalizeConsistencyRisk } from '../models/consistencyRisk.js';
import { runIncidentAnalysis } from '../pipeline/incidentAnalyzer.js';
import { buildCoherencePrompt } from '../prompts/coherencePrompt.js';
import { buildConsistencyCheckPrompt } from '../prompts/consistencyCheckPrompt.js';
import { buildIncidentAnalysisPrompt } from '../prompts/incidentAnalysisPrompt.js';
import { buildSegmentationPrompt } from '../prompts/incidentSegmentationPrompt.js';
import SessionClient from '../sessionClient.js';

const DEFAULT_AI_OPTIONS = {
  enabled: false,
  maxSegmentationWords: 60000,
  perIncidentMaxWords: 14000,
  maxIncidents: 12,
};

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function toObject(value) {
  return value && typeof value === 'object' ? value : {};
}

function normalizeWhitespace(value) {
  return String(value || '').replace(/\s+/gu, ' ').trim();
}

function countWords(text) {
  const source = normalizeWhitespace(text);
  if (!source) return 0;
  return source.split(' ').length;
}

function clamp(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function emitProgress(onProgress, phase, progress, message) {
  onProgress({
    phase,
    progress: Math.max(0, Math.min(1, Number(progress) || 0)),
    message: String(message || '').trim(),
  });
}

function hasAnyApiKey(options = {}) {
  const keys = [
    ...(Array.isArray(options.apiKeys) ? options.apiKeys : []),
    options.apiKey,
    process.env.STORYFORGE_GEMINI_PROXY_KEY,
    process.env.STORYFORGE_GEMINI_PROXY_KEYS,
    process.env.STORYFORGE_PROXY_API_KEY,
    process.env.STORYFORGE_GEMINI_DIRECT_API_KEY,
    process.env.STORYFORGE_GEMINI_DIRECT_API_KEYS,
    process.env.GEMINI_API_KEY,
  ];

  return keys.some((item) => String(item || '').trim().length > 0);
}

function canUseAiPipeline({ chapters, options, aiOptions }) {
  if (!aiOptions.enabled) return false;
  if (!toArray(chapters).length) return false;
  if (!String(options.model || '').trim()) return false;
  if (!hasAnyApiKey(options)) return false;
  return true;
}

function collectSegmentationContext(chapters = [], maxWords = 60000) {
  const safeMaxWords = Math.max(4000, Number(maxWords) || 60000);
  const selected = [];
  let totalWords = 0;

  for (const chapter of chapters) {
    const rawText = chapter?.content || chapter?.text || '';
    const text = normalizeWhitespace(rawText);
    if (!text) continue;

    const chapterWords = countWords(text);
    if (selected.length > 0 && totalWords + chapterWords > safeMaxWords) {
      break;
    }

    const chapterIndex = Number.isFinite(Number(chapter.chapterIndex))
      ? Number(chapter.chapterIndex)
      : Number(chapter.index || selected.length);
    const chapterNumber = chapterIndex + 1;

    selected.push({
      chapterIndex,
      chapterNumber,
      title: normalizeWhitespace(chapter.title || ''),
      text,
    });
    totalWords += chapterWords;
  }

  const contextText = selected
    .map((item) => `Chapter ${item.chapterNumber}: ${item.title}\n${item.text}`)
    .join('\n\n')
    .trim();

  return {
    selected,
    text: contextText,
    chapterCount: selected.length,
  };
}

function getIncidentRange(incident = {}, chapterCount = null) {
  const start = Number.isFinite(Number(
    incident.startChapter
    ?? incident.chapterStart
    ?? incident.chapterStartIndex
    ?? incident.chapterRange?.[0],
  ))
    ? Number(
      incident.startChapter
      ?? incident.chapterStart
      ?? incident.chapterStartIndex
      ?? incident.chapterRange?.[0],
    )
    : null;
  const end = Number.isFinite(Number(
    incident.endChapter
    ?? incident.chapterEnd
    ?? incident.chapterEndIndex
    ?? incident.chapterRange?.[1],
  ))
    ? Number(
      incident.endChapter
      ?? incident.chapterEnd
      ?? incident.chapterEndIndex
      ?? incident.chapterRange?.[1],
    )
    : start;

  if (start == null || end == null) {
    return [null, null];
  }

  const safeStart = Math.max(1, Math.min(start, end));
  const safeEnd = Math.max(safeStart, end);
  if (chapterCount == null) {
    return [safeStart, safeEnd];
  }

  const maxBound = Math.max(1, chapterCount);
  return [Math.min(safeStart, maxBound), Math.min(safeEnd, maxBound)];
}

function collectIncidentContext(chapters = [], incident = {}, maxWords = 14000) {
  const safeMaxWords = Math.max(2000, Number(maxWords) || 14000);
  const chapterCount = chapters.length;
  const [startChapter, endChapter] = getIncidentRange(incident, chapterCount);

  const inRange = chapters.filter((chapter) => {
    const chapterIndex = Number.isFinite(Number(chapter.chapterIndex))
      ? Number(chapter.chapterIndex)
      : Number(chapter.index);
    if (!Number.isFinite(chapterIndex)) return false;
    if (startChapter == null || endChapter == null) return true;
    return chapterIndex >= startChapter && chapterIndex <= endChapter;
  });

  const selected = [];
  let totalWords = 0;

  for (const chapter of inRange.length ? inRange : chapters) {
    const text = normalizeWhitespace(chapter?.content || chapter?.text || '');
    if (!text) continue;
    const words = countWords(text);
    if (selected.length > 0 && totalWords + words > safeMaxWords) break;

    selected.push({
      chapterIndex: Number.isFinite(Number(chapter.chapterIndex))
        ? Number(chapter.chapterIndex)
        : Number(chapter.index),
      chapterNumber: (Number.isFinite(Number(chapter.chapterIndex))
        ? Number(chapter.chapterIndex)
        : Number(chapter.index)) + 1,
      title: normalizeWhitespace(chapter.title || ''),
      text,
    });
    totalWords += words;
  }

  const contextText = selected
    .map((item) => `Chapter ${item.chapterNumber}: ${item.title}\n${item.text}`)
    .join('\n\n')
    .trim();

  return {
    chapters: selected,
    text: contextText,
  };
}

async function callStepJson({
  prompt,
  inputText,
  options = {},
  signal,
  maxOutputTokens = 12000,
}) {
  const client = new SessionClient({
    provider: options.provider,
    model: options.model,
    apiKey: options.apiKey,
    apiKeys: options.apiKeys,
    proxyUrl: options.proxyUrl,
    directUrl: options.directUrl,
    temperature: Number.isFinite(Number(options.temperature)) ? Number(options.temperature) : 0.2,
    maxOutputTokens,
  });

  try {
    const response = await client.startSession(inputText, prompt, { signal });
    return parseAIJsonValue(response?.text || '');
  } finally {
    client.endSession();
  }
}

function normalizeSegmentationIncidents(incidents = []) {
  return toArray(incidents)
    .filter((item) => item && typeof item === 'object')
    .map((item, index) => {
      const startChapter = Number.isFinite(Number(item.startChapter))
        ? Number(item.startChapter)
        : null;
      const endChapter = Number.isFinite(Number(item.endChapter))
        ? Number(item.endChapter)
        : startChapter;

      return {
        id: item.id || `inc_ai_${randomUUID()}`,
        title: normalizeWhitespace(item.title || item.name || `Incident ${index + 1}`),
        type: normalizeWhitespace(item.type || 'subplot') || 'subplot',
        startChapter,
        endChapter,
        confidence: clamp(item.confidence, 0, 1, 0.65),
        uncertainStart: Boolean(item.uncertainStart),
        uncertainEnd: Boolean(item.uncertainEnd),
        boundaryNote: normalizeWhitespace(item.boundaryNote || ''),
        evidence: toArray(item.evidence).map((x) => normalizeWhitespace(x)).filter(Boolean),
        description: normalizeWhitespace(item.description || ''),
      };
    })
    .filter((item) => item.startChapter != null);
}

function normalizeAiEvent(raw = {}, incident = {}) {
  const severityRaw = String(raw.severity || '').toLowerCase();
  const mappedSeverity = severityRaw === 'crucial'
    ? 1
    : severityRaw === 'major'
      ? 0.85
      : severityRaw === 'moderate'
        ? 0.6
        : clamp(raw.severity, 0, 1, 0.55);

  const chapterNumber = Number.isFinite(Number(raw.chapter))
    ? Number(raw.chapter)
    : Number.isFinite(Number(raw.chapterIndex))
      ? Number(raw.chapterIndex)
      : Number.isFinite(Number(incident.startChapter))
        ? Number(incident.startChapter)
        : 1;
  const eventId = raw.id || `evt_ai_${randomUUID()}`;

  return {
    id: eventId,
    title: normalizeWhitespace(raw.title || raw.name || raw.description || eventId),
    description: normalizeWhitespace(raw.description || raw.summary || ''),
    severity: mappedSeverity,
    chapterIndex: Math.max(0, chapterNumber - 1),
    chapterNumber,
    incidentId: incident.id || null,
    tags: toArray(raw.tags).map((x) => normalizeWhitespace(x)).filter(Boolean),
    characters: toArray(raw.characters).map((x) => normalizeWhitespace(x)).filter(Boolean),
    confidence: clamp(raw.confidence, 0, 1, 0.65),
    evidence: toArray(raw.evidence).map((x) => normalizeWhitespace(x)).filter(Boolean),
    causalLinks: {
      causes: toArray(raw.causesEventIds || raw.causes).map((x) => String(x).trim()).filter(Boolean),
      causedBy: toArray(raw.causedByEventIds || raw.causedBy).map((x) => String(x).trim()).filter(Boolean),
    },
  };
}

function normalizeAiLocation(raw = {}, incident = {}) {
  const name = normalizeWhitespace(raw.name || raw.location || raw.locationHint || '');
  if (!name) return null;

  return {
    id: raw.id || `loc_ai_${randomUUID()}`,
    name,
    aliases: toArray(raw.aliases).map((x) => normalizeWhitespace(x)).filter(Boolean),
    incidentIds: incident?.id ? [incident.id] : [],
    eventIds: toArray(raw.eventIds).map((x) => String(x).trim()).filter(Boolean),
    confidence: clamp(raw.confidence ?? raw.importance, 0, 1, 0.55),
    evidence: toArray(raw.evidence).map((x) => normalizeWhitespace(x)).filter(Boolean),
    importance: clamp(raw.importance, 0, 1, 0.5),
  };
}

function dedupeById(list = []) {
  const map = new Map();
  for (const item of list || []) {
    if (!item || typeof item !== 'object') continue;
    const key = String(item.id || '').trim();
    if (!key) continue;
    if (!map.has(key)) {
      map.set(key, item);
      continue;
    }
    map.set(key, { ...map.get(key), ...item });
  }
  return [...map.values()];
}

function normalizeRiskList(risks = []) {
  return toArray(risks)
    .filter((risk) => risk && typeof risk === 'object')
    .map((risk) => normalizeConsistencyRisk({
      ...risk,
      id: risk.id || `risk_ai_${randomUUID()}`,
    }));
}

// [FIX] Tính key pool size từ options để dùng làm concurrency cho Pass B
function resolveKeyPoolSize(options = {}) {
  const keys = [...new Set(
    (Array.isArray(options.apiKeys) ? options.apiKeys : [options.apiKey])
      .flat()
      .map((k) => String(k || '').trim())
      .filter(Boolean),
  )];
  return Math.max(1, keys.length);
}

export async function runIncidentAnalysisJob({
  corpusId,
  payload = {},
  options = {},
  signal,
  onProgress = () => { },
} = {}) {
  if (!corpusId) {
    const error = new Error('Missing corpusId for incident analysis job.');
    error.code = 'INVALID_INPUT';
    throw error;
  }

  const normalizedPayload = {
    chapters: toArray(payload.chapters),
    incidents: toArray(payload.incidents),
    events: toArray(payload.events),
    locations: toArray(payload.locations),
    consistencyRisks: toArray(payload.consistencyRisks),
  };

  emitProgress(onProgress, 'segmentation', 0.05, 'Running base incident pipeline');

  const heuristicResult = runIncidentAnalysis(corpusId, normalizedPayload, options);
  const aiOptions = {
    ...DEFAULT_AI_OPTIONS,
    ...toObject(options.ai),
  };

  if (!canUseAiPipeline({ chapters: normalizedPayload.chapters, options, aiOptions })) {
    return {
      ...heuristicResult,
      aiApplied: false,
      aiSteps: [],
    };
  }

  const aiSteps = [];
  let incidents = heuristicResult.incidents;
  let events = heuristicResult.events;
  let locations = heuristicResult.locations;
  let consistencyRisks = heuristicResult.consistencyRisks;
  let coherenceAdvice = null;

  try {
    emitProgress(onProgress, 'segmentation_ai', 0.15, 'Calling AI for incident segmentation');
    const segmentationContext = collectSegmentationContext(
      normalizedPayload.chapters,
      aiOptions.maxSegmentationWords,
    );

    if (segmentationContext.text) {
      const segmentationPrompt = buildSegmentationPrompt(
        { text: segmentationContext.text },
        {
          chapterCount: segmentationContext.chapterCount,
          mode: options.mode || 'balanced',
        },
      );
      const segmentation = await callStepJson({
        prompt: segmentationPrompt,
        inputText: segmentationContext.text,
        options,
        signal,
      });

      const aiIncidents = normalizeSegmentationIncidents(segmentation?.incidents);
      if (aiIncidents.length > 0) {
        incidents = aiIncidents;
        aiSteps.push('segmentation');
      }
    }

    emitProgress(onProgress, 'deep_analysis_ai', 0.35, 'Calling AI for per-incident deep analysis');

    const deepEvents = [];
    const deepLocations = [];
    const selectedIncidents = incidents.slice(0, aiOptions.maxIncidents);

    // [FIX] Đổi từ sequential for loop sang parallel batched theo key pool size.
    // Mỗi batch chạy song song tối đa keyPoolSize incident cùng lúc.
    // Incident fail trong batch bị skip silently (fallback heuristic vẫn còn).
    const keyPoolSize = resolveKeyPoolSize(options);
    const incidentConcurrency = Math.min(keyPoolSize, selectedIncidents.length);

    const processOneIncident = async (incident, globalIndex) => {
      const context = collectIncidentContext(
        normalizedPayload.chapters,
        incident,
        aiOptions.perIncidentMaxWords,
      );
      if (!context.text) {
        return { events: [], locations: [] };
      }

      const progress = 0.35 + ((globalIndex + 1) / Math.max(1, selectedIncidents.length)) * 0.25;
      emitProgress(
        onProgress,
        'deep_analysis_ai',
        progress,
        `Analyzing incident ${globalIndex + 1}/${selectedIncidents.length}`,
      );

      const prompt = buildIncidentAnalysisPrompt(incident, context);
      const analysis = await callStepJson({
        prompt,
        inputText: context.text,
        options,
        signal,
      });

      const incidentEvents = toArray(analysis?.events)
        .map((rawEvent) => normalizeAiEvent(rawEvent, incident));
      const incidentLocations = toArray(analysis?.locations)
        .map((rawLocation) => normalizeAiLocation(rawLocation, incident))
        .filter(Boolean);

      return { events: incidentEvents, locations: incidentLocations };
    };

    for (
      let batchStart = 0;
      batchStart < selectedIncidents.length;
      batchStart += incidentConcurrency
    ) {
      const batchSlice = selectedIncidents.slice(batchStart, batchStart + incidentConcurrency);

      const settled = await Promise.allSettled(
        batchSlice.map((incident, batchIndex) =>
          processOneIncident(incident, batchStart + batchIndex),
        ),
      );

      for (const result of settled) {
        if (result.status === 'fulfilled') {
          deepEvents.push(...result.value.events);
          deepLocations.push(...result.value.locations);
        }
        // rejected: skip silently, heuristic result vẫn là fallback
      }
    }

    if (deepEvents.length > 0 || deepLocations.length > 0) {
      events = dedupeById([...events, ...deepEvents]);
      locations = dedupeById([...locations, ...deepLocations]);
      aiSteps.push('deep_analysis');
    }

    emitProgress(onProgress, 'consistency_ai', 0.68, 'Calling AI for consistency risk suggestions');
    const consistencyPrompt = buildConsistencyCheckPrompt({
      incidentCount: incidents.length,
      eventCount: events.length,
      locationCount: locations.length,
      context: [
        `Incidents: ${incidents.length}`,
        `Events: ${events.length}`,
        `Locations: ${locations.length}`,
      ].join('\n'),
    });

    const consistencyResponse = await callStepJson({
      prompt: consistencyPrompt,
      inputText: JSON.stringify({ incidents, events, locations }),
      options,
      signal,
    });
    const aiRisks = normalizeRiskList(consistencyResponse?.risks || consistencyResponse?.consistencyRisks);

    if (aiRisks.length > 0) {
      consistencyRisks = dedupeById([...consistencyRisks, ...aiRisks]);
      aiSteps.push('consistency_check');
    }

    emitProgress(onProgress, 'coherence_ai', 0.8, 'Calling AI for coherence suggestions');
    const coherencePrompt = buildCoherencePrompt({
      incidentCount: incidents.length,
      eventCount: events.length,
      locationCount: locations.length,
      summary: 'Review overlaps, split candidates and timeline anomalies.',
    });

    coherenceAdvice = await callStepJson({
      prompt: coherencePrompt,
      inputText: JSON.stringify({ incidents, events, locations }),
      options,
      signal,
    });
    if (coherenceAdvice && typeof coherenceAdvice === 'object') {
      aiSteps.push('coherence');
    }

    emitProgress(onProgress, 'rerun_pipeline', 0.88, 'Rebuilding final artifacts with AI-enriched payload');
    const rerun = runIncidentAnalysis(corpusId, {
      chapters: normalizedPayload.chapters,
      incidents,
      events,
      locations,
      consistencyRisks,
    }, options);

    return {
      ...rerun,
      aiApplied: aiSteps.length > 0,
      aiSteps,
      aiMeta: {
        coherenceAdvice,
      },
    };
  } catch (error) {
    return {
      ...heuristicResult,
      aiApplied: aiSteps.length > 0,
      aiSteps,
      aiError: error?.message || 'Unknown AI incident pipeline error',
    };
  }
}
