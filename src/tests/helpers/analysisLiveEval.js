import { ANALYSIS_PROVIDERS, resolveAnalysisConfig } from '../../services/analysis/analysisConfig.js';

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function toObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function normalizeText(value) {
  return String(value || '').replace(/\s+/gu, ' ').trim();
}

function parseList(value) {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.map((item) => normalizeText(item)).filter(Boolean);
  }
  return String(value)
    .split(/[\n,;]+/u)
    .map((item) => item.trim())
    .filter(Boolean);
}

function unique(items = []) {
  return [...new Set(items.filter(Boolean))];
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function countRatio(numerator, denominator) {
  if (!denominator) return 1;
  return numerator / denominator;
}

function formatDuration(ms) {
  const totalMs = Math.max(0, Number(ms) || 0);
  const seconds = Math.floor(totalMs / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;

  if (hours > 0) return `${hours}h ${minutes}m ${remainder}s`;
  if (minutes > 0) return `${minutes}m ${remainder}s`;
  return `${remainder}s`;
}

function getAnalysisPassStatus(detail = {}) {
  return toObject(detail.passStatus || detail.result?.pass_status || detail.result?.passStatus);
}

function getAnalysisManifest(detail = {}) {
  return toObject(detail.manifest || detail.result?.analysis_run_manifest || detail.result?.analysisRunManifest);
}

function getResultRoot(detail = {}, artifactPayload = {}) {
  const detailResult = toObject(detail.result);
  const artifact = toObject(artifactPayload.artifact);
  return Object.keys(detailResult).length > 0 ? detailResult : artifact;
}

function getKnowledge(result = {}) {
  const source = toObject(result.knowledge);
  return {
    characters: toArray(source.characters).length ? toArray(source.characters) : toArray(result.characters?.profiles),
    locations: toArray(source.locations).length ? toArray(source.locations) : toArray(result.worldbuilding?.locations || result.locations),
    objects: toArray(source.objects).length ? toArray(source.objects) : toArray(result.worldbuilding?.objects || result.objects),
    terms: toArray(source.terms).length ? toArray(source.terms) : toArray(result.worldbuilding?.terms || result.terms),
  };
}

function getEvents(result = {}) {
  const eventsLayer = toObject(result.events);
  return [
    ...toArray(eventsLayer.majorEvents || eventsLayer.major || []),
    ...toArray(eventsLayer.minorEvents || eventsLayer.minor || []),
    ...toArray(eventsLayer.plotTwists || eventsLayer.twists || []),
    ...toArray(eventsLayer.cliffhangers || []),
  ];
}

function getIncidents(result = {}, incidentsPayload = {}) {
  if (toArray(incidentsPayload.incidents).length > 0) {
    return toArray(incidentsPayload.incidents);
  }
  return toArray(result.incidents);
}

function hasWorldSeed(worldSeed = {}) {
  const source = toObject(worldSeed);
  return Boolean(
    normalizeText(source.world_name || source.worldName || '')
    || normalizeText(source.world_description || source.worldDescription || '')
    || toArray(source.world_rules || source.worldRules).length
    || toArray(source.primary_locations || source.primaryLocations).length
  );
}

function hasStyleSeed(styleSeed = {}) {
  const source = toObject(styleSeed);
  return Boolean(
    normalizeText(source.pov)
    || normalizeText(source.tense)
    || toArray(source.tone).length
    || toArray(source.style_signals || source.styleSignals).length
    || normalizeText(source.dialogue_density || source.dialogueDensity)
  );
}

function hasCraft(craft = {}) {
  const source = toObject(craft);
  const style = toObject(source.style);
  return Boolean(
    Object.keys(style).length
    && (
      normalizeText(style.pov)
      || normalizeText(style.tense)
      || toArray(style.tone).length
      || toArray(style.styleSignals).length
    )
  );
}

function extractPhaseDurations(detail = {}) {
  const passStatus = getAnalysisPassStatus(detail);
  const durations = {};

  for (const [passId, pass] of Object.entries(passStatus)) {
    const startedAt = toNumber(pass?.startedAt, 0);
    const completedAt = toNumber(pass?.completedAt, 0);
    durations[passId] = {
      status: normalizeText(pass?.status || 'unknown') || 'unknown',
      startedAt: startedAt || null,
      completedAt: completedAt || null,
      elapsedMs: startedAt && completedAt ? Math.max(0, completedAt - startedAt) : null,
    };
  }

  return durations;
}

function computeDuplicateIncidentRatio(incidents = []) {
  if (!incidents.length) return 0;
  const seen = new Map();
  let duplicateCount = 0;

  for (const incident of incidents) {
    const title = normalizeText(incident.title || incident.description || '').toLowerCase();
    const start = toNumber(incident.chapterStart ?? incident.startChapter, null);
    const end = toNumber(incident.chapterEnd ?? incident.endChapter, start);
    const key = `${title}|${start}|${end}`;
    seen.set(key, (seen.get(key) || 0) + 1);
  }

  for (const count of seen.values()) {
    if (count > 1) duplicateCount += count - 1;
  }

  return duplicateCount / incidents.length;
}

function computeNestedIncidentRatio(incidents = []) {
  if (incidents.length <= 1) return 0;
  let nested = 0;

  for (let index = 0; index < incidents.length; index += 1) {
    const current = incidents[index];
    const start = toNumber(current.chapterStart ?? current.startChapter, null);
    const end = toNumber(current.chapterEnd ?? current.endChapter, start);
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;

    const isNested = incidents.some((other, otherIndex) => {
      if (otherIndex === index) return false;
      const otherStart = toNumber(other.chapterStart ?? other.startChapter, null);
      const otherEnd = toNumber(other.chapterEnd ?? other.endChapter, otherStart);
      if (!Number.isFinite(otherStart) || !Number.isFinite(otherEnd)) return false;
      return start >= otherStart && end <= otherEnd && (start !== otherStart || end !== otherEnd);
    });

    if (isNested) nested += 1;
  }

  return nested / incidents.length;
}

function computeOverlyBroadIncidentRatio(incidents = [], chapterCount = 1) {
  if (!incidents.length || chapterCount <= 1) return 0;
  const threshold = Math.max(4, Math.ceil(chapterCount * 0.6));
  const broad = incidents.filter((incident) => {
    const start = toNumber(incident.chapterStart ?? incident.startChapter, null);
    const end = toNumber(incident.chapterEnd ?? incident.endChapter, start);
    if (!Number.isFinite(start) || !Number.isFinite(end)) return false;
    return (Math.abs(end - start) + 1) >= threshold;
  });
  return broad.length / incidents.length;
}

function getDefaultExpectations() {
  return {
    label: 'Live analysis fixture',
    defaultRunMode: 'full_corpus_1m',
    structural: {
      minIncidents: 1,
      incidentCountRange: [1, 80],
      minCanonicalCharacters: 2,
      minCanonicalLocations: 1,
      minCanonicalObjectsOrTerms: 1,
      minIncidentEvidenceRatio: 0.5,
      minBeatEvidenceRatio: 0.3,
      minBeatChapterRatio: 0.9,
    },
    warnings: {
      minCoverageRatio: 0.6,
      minStyleSignalCount: 2,
      maxOneChapterIncidentRatio: 0.8,
      maxDuplicateIncidentRatio: 0.35,
      maxNestedIncidentRatio: 0.65,
      maxOverlyBroadIncidentRatio: 0.5,
      maxConfidenceOneRatio: 0.75,
      maxReviewQueueTotal: 50,
    },
  };
}

export function mergeExpectations(input = {}) {
  const defaults = getDefaultExpectations();
  return {
    ...defaults,
    ...toObject(input),
    structural: {
      ...defaults.structural,
      ...toObject(input.structural),
    },
    warnings: {
      ...defaults.warnings,
      ...toObject(input.warnings),
    },
  };
}

export function resolveLiveAnalysisConfig(env = process.env) {
  const provider = normalizeText(env.STORYFORGE_ANALYSIS_TEST_PROVIDER || ANALYSIS_PROVIDERS.GEMINI_PROXY)
    || ANALYSIS_PROVIDERS.GEMINI_PROXY;

  const overrideKeys = unique([
    ...parseList(env.STORYFORGE_ANALYSIS_TEST_API_KEYS),
    ...parseList(env.STORYFORGE_ANALYSIS_TEST_API_KEY),
  ]);

  const fallbackKeys = provider === ANALYSIS_PROVIDERS.GEMINI_DIRECT
    ? unique([
      ...parseList(env.STORYFORGE_GEMINI_DIRECT_API_KEYS),
      ...parseList(env.STORYFORGE_GEMINI_DIRECT_API_KEY),
      ...parseList(env.GEMINI_API_KEY),
    ])
    : unique([
      ...parseList(env.STORYFORGE_GEMINI_PROXY_KEYS),
      ...parseList(env.STORYFORGE_GEMINI_PROXY_KEY),
      ...parseList(env.STORYFORGE_PROXY_API_KEY),
      ...parseList(env.GEMINI_PROXY_API_KEY),
      ...parseList(env.GEMINI_API_KEY),
    ]);

  const requestedModel = normalizeText(env.STORYFORGE_ANALYSIS_TEST_MODEL || '');
  const runMode = normalizeText(env.STORYFORGE_ANALYSIS_TEST_RUN_MODE || 'full_corpus_1m') || 'full_corpus_1m';
  const proxyUrl = normalizeText(
    env.STORYFORGE_ANALYSIS_TEST_PROXY_URL
    || env.STORYFORGE_GEMINI_PROXY_URL
    || env.STORYFORGE_PROXY_URL
    || env.PROXY_URL,
  ) || null;
  const directUrl = normalizeText(
    env.STORYFORGE_ANALYSIS_TEST_DIRECT_URL
    || env.STORYFORGE_GEMINI_DIRECT_URL
    || env.GEMINI_DIRECT_URL,
  ) || null;

  const resolved = resolveAnalysisConfig({
    provider,
    model: requestedModel,
    runMode,
    maxParts: toNumber(env.STORYFORGE_ANALYSIS_TEST_MAX_PARTS, undefined),
    chunkSize: toNumber(env.STORYFORGE_ANALYSIS_TEST_CHUNK_SIZE, undefined),
  });

  return {
    ...resolved,
    provider,
    apiKeys: overrideKeys.length > 0 ? overrideKeys : fallbackKeys,
    proxyUrl,
    directUrl,
  };
}

export function validateLiveAnalysisConfig(config = {}, env = process.env) {
  const errors = [];
  const source = toObject(config);

  if (!normalizeText(env.DATABASE_URL || '')) errors.push('DATABASE_URL is required for live backend evaluation.');
  if (!normalizeText(source.provider || '')) errors.push('Analysis provider is required.');
  if (!normalizeText(source.model || '')) errors.push('Analysis model is required.');
  if (!toArray(source.apiKeys).length) errors.push('At least one API key is required for live backend evaluation.');
  if (source.provider === ANALYSIS_PROVIDERS.GEMINI_PROXY && !normalizeText(source.proxyUrl || '')) {
    errors.push('Proxy URL is required for gemini_proxy live evaluation.');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export function evaluateAnalysisOutput({
  detail = {},
  artifactPayload = {},
  windowsPayload = {},
  graphPayload = {},
  incidentsPayload = {},
  reviewQueuePayload = {},
  expectations = {},
  startedAt = null,
  completedAt = null,
} = {}) {
  const mergedExpectations = mergeExpectations(expectations);
  const result = getResultRoot(detail, artifactPayload);
  const manifest = getAnalysisManifest(detail);
  const passStatus = getAnalysisPassStatus(detail);
  const artifact = toObject(artifactPayload.artifact);
  const knowledge = getKnowledge(result);
  const incidents = getIncidents(result, incidentsPayload);
  const events = getEvents(result);
  const coverageAudit = toObject(result.coverage_audit);
  const craft = toObject(result.craft);
  const styleSeed = toObject(result.style_seed);
  const worldSeed = toObject(result.world_seed);
  const graph = toObject(graphPayload.graph);
  const windows = toArray(windowsPayload.windows);
  const reviewStats = toObject(reviewQueuePayload.stats);
  const relationships = toArray(result.relationships);
  const chapterCount = toNumber(
    artifact.canonical_corpus?.chapterCount
    || artifact.canonicalCorpus?.chapterCount
    || detail.result?.canonical_corpus?.chapterCount
    || 0,
    0,
  );
  const analysisStartedAt = toNumber(startedAt || detail.startedAt || manifest.startedAt, 0);
  const analysisCompletedAt = toNumber(completedAt || detail.completedAt || manifest.completedAt, 0);
  const elapsedMs = analysisStartedAt && analysisCompletedAt ? Math.max(0, analysisCompletedAt - analysisStartedAt) : null;

  const incidentEvidenceRatio = countRatio(
    incidents.filter((item) => toArray(item.evidence).length > 0).length,
    incidents.length,
  );
  const beatChapterRatio = countRatio(
    events.filter((item) => Number.isFinite(Number(item.chapter))).length,
    events.length,
  );
  const beatEvidenceRatio = countRatio(
    events.filter((item) => toArray(item.evidence).length > 0 || normalizeText(item.evidenceSnippet || '')).length,
    events.length,
  );
  const oneChapterIncidentRatio = countRatio(
    incidents.filter((item) => toNumber(item.chapterStart ?? item.startChapter, null) === toNumber(item.chapterEnd ?? item.endChapter, null)).length,
    incidents.length,
  );
  const confidenceOneRatio = countRatio(
    incidents.filter((item) => toNumber(item.confidence, 0) >= 0.999).length,
    incidents.length,
  );
  const duplicateIncidentRatio = computeDuplicateIncidentRatio(incidents);
  const nestedIncidentRatio = computeNestedIncidentRatio(incidents);
  const overlyBroadIncidentRatio = computeOverlyBroadIncidentRatio(incidents, chapterCount);

  const counts = {
    incidents: incidents.length,
    beats: Math.max(toNumber(windowsPayload.beatCount, 0), events.length),
    characters: knowledge.characters.length,
    locations: knowledge.locations.length,
    objects: knowledge.objects.length,
    terms: knowledge.terms.length,
    relationships: relationships.length,
    windows: windows.length,
    reviewQueueTotal: toNumber(reviewQueuePayload.total, toNumber(reviewStats.total, 0)),
    graphNodes: toArray(graph.nodes).length,
    graphEdges: toArray(graph.edges).length,
  };

  const coverage = {
    observedCount: toObject(coverageAudit.observedCount),
    returnedCount: toObject(coverageAudit.returnedCount),
    ratios: toObject(coverageAudit.coverage),
    complete: coverageAudit.complete === true,
    recallApplied: Boolean(result.meta?.aiSteps?.some((step) => normalizeText(step?.fallback || step?.reason).toLowerCase() === 'local_recall')),
  };

  const style = {
    pov: normalizeText(styleSeed.pov || craft.style?.pov || ''),
    toneCount: toArray(styleSeed.tone || craft.style?.tone).length,
    styleSignalCount: toArray(craft.style?.styleSignals).length,
    evidenceCount: toNumber(craft.style?.evidenceCount, 0),
    hasPacing: Object.keys(toObject(craft.pacing)).length > 0,
    hasDialogueProfile: Object.keys(toObject(craft.dialogueTechniques)).length > 0,
  };

  const hardFailures = [];
  const warnings = [];
  const passFailures = Object.entries(passStatus)
    .filter(([, pass]) => normalizeText(pass?.status || '').toLowerCase() === 'failed')
    .map(([passId]) => passId);

  if (normalizeText(detail.status || '').toLowerCase() !== 'completed') hardFailures.push('Analysis did not complete successfully.');
  if (normalizeText(artifactPayload.artifactVersion || artifact.artifact_version || '').toLowerCase() !== 'v3') hardFailures.push('Artifact version is not v3.');
  if (counts.incidents === 0) hardFailures.push('No incidents were returned.');
  if (!hasWorldSeed(worldSeed)) hardFailures.push('world_seed is empty.');
  if (!hasStyleSeed(styleSeed)) hardFailures.push('style_seed is empty.');
  if (!hasCraft(craft)) hardFailures.push('craft/style is empty.');
  if (Object.keys(coverageAudit).length === 0) hardFailures.push('coverage_audit is missing.');
  if (passFailures.length > 0) hardFailures.push(`Pass failures detected: ${passFailures.join(', ')}`);

  const range = toArray(mergedExpectations.structural.incidentCountRange);
  const incidentRangeMin = toNumber(range[0], mergedExpectations.structural.minIncidents);
  const incidentRangeMax = toNumber(range[1], Number.MAX_SAFE_INTEGER);
  const minObjectsOrTerms = Math.max(0, toNumber(mergedExpectations.structural.minCanonicalObjectsOrTerms, 1));

  if (counts.incidents < incidentRangeMin || counts.incidents > incidentRangeMax) warnings.push(`Incident count ${counts.incidents} is outside expected range ${incidentRangeMin}-${incidentRangeMax}.`);
  if (counts.characters < toNumber(mergedExpectations.structural.minCanonicalCharacters, 2)) warnings.push(`Canonical characters too low: ${counts.characters}.`);
  if (counts.locations < toNumber(mergedExpectations.structural.minCanonicalLocations, 1)) warnings.push(`Canonical locations too low: ${counts.locations}.`);
  if ((counts.objects + counts.terms) < minObjectsOrTerms) warnings.push(`Canonical objects/terms too low: ${counts.objects + counts.terms}.`);
  if (incidentEvidenceRatio < toNumber(mergedExpectations.structural.minIncidentEvidenceRatio, 0.5)) warnings.push(`Incident evidence ratio too low: ${incidentEvidenceRatio.toFixed(2)}.`);
  if (beatEvidenceRatio < toNumber(mergedExpectations.structural.minBeatEvidenceRatio, 0.3)) warnings.push(`Beat evidence ratio too low: ${beatEvidenceRatio.toFixed(2)}.`);
  if (beatChapterRatio < toNumber(mergedExpectations.structural.minBeatChapterRatio, 0.9)) warnings.push(`Beat chapter coverage too low: ${beatChapterRatio.toFixed(2)}.`);
  if (oneChapterIncidentRatio > toNumber(mergedExpectations.warnings.maxOneChapterIncidentRatio, 0.8)) warnings.push(`Too many one-chapter incidents: ${oneChapterIncidentRatio.toFixed(2)}.`);
  if (duplicateIncidentRatio > toNumber(mergedExpectations.warnings.maxDuplicateIncidentRatio, 0.35)) warnings.push(`Duplicate incident ratio too high: ${duplicateIncidentRatio.toFixed(2)}.`);
  if (nestedIncidentRatio > toNumber(mergedExpectations.warnings.maxNestedIncidentRatio, 0.65)) warnings.push(`Nested incident suspicion ratio too high: ${nestedIncidentRatio.toFixed(2)}.`);
  if (overlyBroadIncidentRatio > toNumber(mergedExpectations.warnings.maxOverlyBroadIncidentRatio, 0.5)) warnings.push(`Overly broad incident ratio too high: ${overlyBroadIncidentRatio.toFixed(2)}.`);
  if (confidenceOneRatio > toNumber(mergedExpectations.warnings.maxConfidenceOneRatio, 0.75)) warnings.push(`Confidence 1.0 ratio too high: ${confidenceOneRatio.toFixed(2)}.`);
  if (style.styleSignalCount < toNumber(mergedExpectations.warnings.minStyleSignalCount, 2)) warnings.push(`Style signal count too low: ${style.styleSignalCount}.`);
  if (counts.reviewQueueTotal > toNumber(mergedExpectations.warnings.maxReviewQueueTotal, 50)) warnings.push(`Review queue unexpectedly large: ${counts.reviewQueueTotal}.`);

  for (const [kind, value] of Object.entries(coverage.ratios)) {
    if (toNumber(value, 1) < toNumber(mergedExpectations.warnings.minCoverageRatio, 0.6)) {
      warnings.push(`Coverage for ${kind} is low: ${toNumber(value, 0).toFixed(2)}.`);
    }
  }

  const verdict = hardFailures.length > 0 ? 'fail' : warnings.length > 0 ? 'pass_with_warnings' : 'pass';

  return {
    verdict,
    label: mergedExpectations.label,
    generatedAt: Date.now(),
    analysis: {
      id: detail.id || null,
      corpusId: detail.corpusId || null,
      status: detail.status || null,
      runMode: manifest.runMode || result.meta?.runMode || mergedExpectations.defaultRunMode,
      provider: detail.provider || null,
      model: detail.model || null,
    },
    timing: {
      startedAt: analysisStartedAt || null,
      completedAt: analysisCompletedAt || null,
      elapsedMs,
      elapsedLabel: elapsedMs == null ? 'unknown' : formatDuration(elapsedMs),
      phases: extractPhaseDurations(detail),
    },
    counts,
    coverage,
    quality: {
      grounding: {
        incidentEvidenceRatio,
        beatEvidenceRatio,
        beatChapterRatio,
      },
      incidents: {
        oneChapterIncidentRatio,
        duplicateIncidentRatio,
        nestedIncidentRatio,
        overlyBroadIncidentRatio,
        confidenceOneRatio,
      },
      style,
    },
    hardFailures,
    warnings,
  };
}

export function renderEvaluationMarkdown(report = {}) {
  const source = toObject(report);
  const lines = [
    `# Live Analysis Eval - ${source.label || 'fixture'}`,
    '',
    `- Verdict: ${source.verdict || 'unknown'}`,
    `- Analysis ID: ${source.analysis?.id || 'n/a'}`,
    `- Corpus ID: ${source.analysis?.corpusId || 'n/a'}`,
    `- Run mode: ${source.analysis?.runMode || 'n/a'}`,
    `- Provider/model: ${source.analysis?.provider || 'n/a'} / ${source.analysis?.model || 'n/a'}`,
    `- Elapsed: ${source.timing?.elapsedLabel || 'unknown'}`,
    '',
    '## Counts',
    '',
    `- Incidents: ${source.counts?.incidents ?? 0}`,
    `- Beats: ${source.counts?.beats ?? 0}`,
    `- Characters: ${source.counts?.characters ?? 0}`,
    `- Locations: ${source.counts?.locations ?? 0}`,
    `- Objects: ${source.counts?.objects ?? 0}`,
    `- Terms: ${source.counts?.terms ?? 0}`,
    `- Relationships: ${source.counts?.relationships ?? 0}`,
    `- Review queue: ${source.counts?.reviewQueueTotal ?? 0}`,
    '',
    '## Coverage',
    '',
  ];

  for (const [kind, value] of Object.entries(toObject(source.coverage?.ratios))) {
    lines.push(`- ${kind}: ${toNumber(value, 0).toFixed(2)}`);
  }

  lines.push('', '## Warnings', '');
  if (toArray(source.warnings).length === 0) {
    lines.push('- None');
  } else {
    for (const warning of source.warnings) lines.push(`- ${warning}`);
  }

  lines.push('', '## Hard Failures', '');
  if (toArray(source.hardFailures).length === 0) {
    lines.push('- None');
  } else {
    for (const failure of source.hardFailures) lines.push(`- ${failure}`);
  }

  return `${lines.join('\n')}\n`;
}

export function renderEvaluationSummary(report = {}) {
  const source = toObject(report);
  return [
    `verdict=${source.verdict || 'unknown'}`,
    `elapsed=${source.timing?.elapsedLabel || 'unknown'}`,
    `incidents=${source.counts?.incidents ?? 0}`,
    `beats=${source.counts?.beats ?? 0}`,
    `characters=${source.counts?.characters ?? 0}`,
    `locations=${source.counts?.locations ?? 0}`,
    `objects=${source.counts?.objects ?? 0}`,
    `terms=${source.counts?.terms ?? 0}`,
    `relationships=${source.counts?.relationships ?? 0}`,
    `warnings=${toArray(source.warnings).length}`,
    `hard_failures=${toArray(source.hardFailures).length}`,
  ].join('\n');
}
