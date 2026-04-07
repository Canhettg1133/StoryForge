import { jobRepository } from '../repositories/jobRepository.js';
import { analysisRepository } from '../../analysis/repositories/analysisRepository.js';
import { persistIncidentFirstArtifacts } from '../../analysis/incidentFirstPersistence.js';
import { splitLayerResults } from '../../analysis/outputChunker.js';
import { buildReviewQueue } from '../../analysis/pipeline/reviewQueueBuilder.js';
import { buildStoryGraph } from '../../analysis/v2/storyGraph.js';
import {
  buildAnalysisWindows,
  buildCanonicalEntities,
  buildGraphProjections,
  buildIncidentBeats,
  buildIncidentMap,
  buildRerunManifest,
  materializeWindowResults,
} from '../../analysis/v3/artifactBuilder.js';
import {
  beatToLegacyEvent,
  buildAnalysisRunManifest,
  buildEventsLayer,
  buildIncidentMapPayload,
  buildPassStatus,
  buildScopedRerunPreview,
  buildWindowResults,
  clamp,
  ensureArrayOfStrings,
  ensureBeatsWithContext,
  extractSourceEvents,
  inferRelatedIncidentIds,
  inferRerunScope,
  inferSuggestedAction,
  mapCanonicalToKnowledge,
  mergeBeatsForScope,
  mergeCanonicalSections,
  mergeIncidentMetadata,
  mergeMentionsForKinds,
  mergeReviewStatuses,
  parseJsonField,
  toArray,
  toLegacyIncident,
  toObject,
  toStoredArtifact,
  throwIfCancelled,
} from '../../analysis/v3/scopedRerun.js';

async function getDependencyOutputs(jobIds = []) {
  const outputs = [];
  for (const jobId of ensureArrayOfStrings(jobIds)) {
    const job = await jobRepository.getJobByIdAsync(jobId);
    if (job?.outputData) {
      outputs.push(job.outputData);
    }
  }
  return outputs;
}

function getStageKey(job = {}) {
  const inputData = job.inputData || {};
  switch (job.type) {
    case 'analysis_window':
      return `window:${inputData.windowId}`;
    case 'incident_reducer':
      return 'reducer';
    case 'incident_worker':
      return `incident:${inputData.incidentId}`;
    case 'character_canonicalizer':
      return 'character_canonicalizer';
    case 'world_canonicalizer':
      return 'world_canonicalizer';
    case 'graph_projection':
      return 'graph_projection';
    case 'review_intelligence':
      return 'review_intelligence';
    default:
      return inputData.stageKey || job.type || 'stage';
  }
}

async function beginStage(job, signal) {
  throwIfCancelled(signal);
  const sessionId = job?.inputData?.sessionId;
  const lockToken = job?.inputData?.lockToken;
  const stageKey = getStageKey(job);
  if (!sessionId) {
    return { session: null, checkpoint: null, stageKey };
  }

  const [session, checkpoint] = await Promise.all([
    analysisRepository.getExecutionSessionByIdAsync(sessionId),
    analysisRepository.getExecutionStageOutputAsync(sessionId, stageKey),
  ]);

  if (!session) {
    const error = new Error('Execution session not found.');
    error.code = 'INVALID_INPUT';
    throw error;
  }

  if (lockToken && session.lockToken !== lockToken) {
    const error = new Error('Execution lock token mismatch.');
    error.code = 'INVALID_INPUT';
    throw error;
  }

  if (checkpoint?.status === 'completed' && ['pending', 'running', 'completed'].includes(session.status)) {
    return { session, checkpoint, stageKey };
  }

  if (!['pending', 'running'].includes(session.status)) {
    const error = new Error(`Execution session is ${session.status}.`);
    error.code = 'INVALID_INPUT';
    throw error;
  }

  await analysisRepository.touchExecutionSession(sessionId, {
    status: 'running',
    currentStageKey: stageKey,
    currentJobId: job.id,
  });

  return { session, checkpoint, stageKey };
}

async function completeStage(job, stageKey, payload, { releaseSession = false, artifactRevision = null } = {}) {
  const sessionId = job?.inputData?.sessionId;
  if (!sessionId) {
    return;
  }

  await analysisRepository.upsertExecutionStageOutput({
    sessionId,
    corpusId: job.inputData?.corpusId,
    analysisId: job.inputData?.analysisId,
    stageKey,
    jobId: job.id,
    status: 'completed',
    payload,
  });

  if (releaseSession) {
    await analysisRepository.updateExecutionSession(sessionId, {
      status: 'completed',
      currentStageKey: null,
      currentJobId: null,
      targetArtifactRevision: artifactRevision ?? undefined,
      completedAt: Date.now(),
      releasedAt: Date.now(),
    });
    return;
  }

  await analysisRepository.touchExecutionSession(sessionId, {
    status: 'pending',
    currentStageKey: stageKey,
    currentJobId: null,
  });
}

async function loadContext(analysisId) {
  const [analysis, artifact] = await Promise.all([
    analysisRepository.getAnalysisByIdAsync(analysisId),
    analysisRepository.getAnalysisArtifactByAnalysisAsync(analysisId),
  ]);

  if (!analysis || !artifact) {
    const error = new Error('Analysis artifact not found for decomposed rerun job.');
    error.code = 'INVALID_INPUT';
    throw error;
  }

  const sourceResult = parseJsonField(analysis.finalResult, {});
  return {
    analysis,
    artifact,
    sourceResult,
    canonicalCorpus: artifact.canonicalCorpus || toObject(sourceResult.canonical_corpus) || {},
    incidents: mergeIncidentMetadata(toArray(artifact.incidents), toArray(sourceResult.incidents)),
    sourceEvents: extractSourceEvents(sourceResult),
    beats: ensureBeatsWithContext(
      toArray(artifact.incidentBeats).length
        ? toArray(artifact.incidentBeats)
        : buildIncidentBeats(extractSourceEvents(sourceResult), toArray(artifact.incidents)),
      extractSourceEvents(sourceResult),
    ),
    canonicalEntities: {
      characters: toArray(artifact.canonicalEntities?.characters),
      locations: toArray(artifact.canonicalEntities?.locations),
      objects: toArray(artifact.canonicalEntities?.objects),
      terms: toArray(artifact.canonicalEntities?.terms),
      worldProfile: toObject(artifact.canonicalEntities?.worldProfile || artifact.canonicalEntities?.world_profile),
    },
    entityMentions: toArray(artifact.entityMentions),
    reviewQueue: toArray(artifact.reviewQueue),
  };
}

async function persistArtifactState({
  corpusId,
  analysisId,
  sourceResult,
  storedResult,
  currentPhase,
}) {
  await persistIncidentFirstArtifacts({
    corpusId,
    analysisId,
    result: storedResult,
  });

  const layerResults = splitLayerResults({
    ...sourceResult,
    ...storedResult,
  });

  await analysisRepository.updateAnalysis(analysisId, {
    finalResult: JSON.stringify({
      ...sourceResult,
      ...storedResult,
    }),
    resultL1: layerResults.resultL1,
    resultL2: layerResults.resultL2,
    resultL3: layerResults.resultL3,
    resultL4: layerResults.resultL4,
    resultL5: layerResults.resultL5,
    resultL6: layerResults.resultL6,
    analysisRunManifest: JSON.stringify(storedResult.analysis_run_manifest || null),
    passStatus: JSON.stringify(storedResult.pass_status || null),
    degradedRunReport: JSON.stringify(storedResult.degraded_run_report || null),
    graphSummary: JSON.stringify(storedResult.graph_summary || null),
    artifactVersion: 'v3',
    currentPhase,
    errorMessage: null,
  });
}

function mergeIncidentOutputs(baseBeats = [], outputs = []) {
  let merged = [...baseBeats];
  for (const output of outputs) {
    merged = mergeBeatsForScope(
      merged,
      toArray(output.beats),
      output.incidentId ? [output.incidentId] : toArray(output.incidentIds),
    );
  }
  return merged;
}

function mergeCanonicalOutputs(baseEntities, baseMentions, outputs = []) {
  let canonicalEntities = { ...baseEntities };
  let entityMentions = [...baseMentions];

  for (const output of outputs) {
    const kind = output.kind;
    if (kind === 'character') {
      canonicalEntities = mergeCanonicalSections(canonicalEntities, {
        characters: toArray(output.entities),
      }, ['character']);
      entityMentions = mergeMentionsForKinds(entityMentions, toArray(output.mentions), ['character']);
    }
    if (kind === 'world') {
      canonicalEntities = mergeCanonicalSections(canonicalEntities, {
        locations: toArray(output.locations),
        objects: toArray(output.objects),
        terms: toArray(output.terms),
        worldProfile: toObject(output.worldProfile),
      }, ['location', 'object', 'term', 'world']);
      entityMentions = mergeMentionsForKinds(entityMentions, toArray(output.mentions), ['location', 'object', 'term']);
    }
  }

  return { canonicalEntities, entityMentions };
}

function buildReviewItems({
  corpusId,
  analysisId,
  incidents,
  beats,
  canonicalEntities,
  consistencyRisks,
  storyGraph,
  previousReviewQueue,
}) {
  const beatCountByIncident = beats.reduce((acc, beat) => {
    const key = String(beat.incidentId || '');
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const incidentById = new Map(incidents.map((incident) => [incident.id, incident]));
  const reviewQueueBase = buildReviewQueue(
    incidents.map((incident) => toLegacyIncident(incident, beatCountByIncident[incident.id] || 0)),
    beats.map((beat) => beatToLegacyEvent(beat, incidentById)),
    toArray(canonicalEntities.locations),
    consistencyRisks,
    {
      corpusId,
      analysisId,
      graph: storyGraph,
    },
  ).map((item) => ({
    ...item,
    sourcePhase: item.sourcePhase || 'pass_g',
    rerunScope: item.rerunScope || inferRerunScope(item),
    relatedWindowIds: item.relatedWindowIds || [],
    relatedIncidentIds: item.relatedIncidentIds || inferRelatedIncidentIds(item, incidents),
    suggestedAction: item.suggestedAction || inferSuggestedAction(item),
  }));

  return mergeReviewStatuses(previousReviewQueue, reviewQueueBase);
}

export async function processAnalysisWindowJob(job, onProgress, { signal } = {}) {
  const { checkpoint, stageKey } = await beginStage(job, signal);
  if (checkpoint?.status === 'completed') {
    return checkpoint.payload || {};
  }
  const { analysisId, windowId } = job.inputData || {};
  const context = await loadContext(analysisId);

  await onProgress(25, `Window ${windowId}: rebuilding local extraction`, {
    step: {
      name: 'window_local_extraction',
      status: 'running',
      progress: 40,
      message: `Rebuilding ${windowId}`,
    },
  });

  const windowsBase = buildAnalysisWindows(
    toArray(context.canonicalCorpus.chapters),
    toObject(context.sourceResult.meta),
  );
  const materialized = materializeWindowResults(windowsBase, context.incidents);
  const window = materialized.windows.find((item) => item.windowId === windowId);
  const carryPackets = materialized.carryPackets.filter((item) => item.sourceWindowId === windowId);

  if (!window) {
    const error = new Error(`Window ${windowId} not found.`);
    error.code = 'INVALID_INPUT';
    throw error;
  }

  await onProgress(100, `Window ${windowId}: completed`, {
    event: 'step_complete',
    step: {
      name: 'window_local_extraction',
      status: 'completed',
      progress: 100,
      message: `Window ${windowId} completed`,
    },
  });

  const payload = {
    analysisId,
    windowId,
    window,
    carryPackets,
    incidentIds: toArray(window.incidents).map((incident) => incident.id).filter(Boolean),
  };
  await completeStage(job, stageKey, payload);
  return payload;
}

export async function processIncidentReducerJob(job, onProgress, { signal } = {}) {
  const { checkpoint, stageKey } = await beginStage(job, signal);
  if (checkpoint?.status === 'completed') {
    return checkpoint.payload || {};
  }
  const { analysisId, corpusId, phase, windowIds = [], reason = null, preview = null, dependencyJobIds = [] } = job.inputData || {};
  const context = await loadContext(analysisId);
  const previewPayload = preview || buildScopedRerunPreview({
    artifact: context.artifact,
    phase,
    windowIds,
    reason,
  });
  const dependencyOutputs = await getDependencyOutputs(dependencyJobIds);

  await onProgress(35, 'Reducer: merging window outputs', {
    step: {
      name: 'window_reducer',
      status: 'running',
      progress: 40,
      message: 'Combining window outputs into canonical incident map',
    },
  });

  const windowsBase = buildAnalysisWindows(
    toArray(context.canonicalCorpus.chapters),
    toObject(context.sourceResult.meta),
  );
  const materialized = materializeWindowResults(windowsBase, context.incidents);
  const windowById = new Map(materialized.windows.map((item) => [item.windowId, item]));
  const carryByWindowId = new Map();
  for (const packet of materialized.carryPackets) {
    const list = carryByWindowId.get(packet.sourceWindowId) || [];
    list.push(packet);
    carryByWindowId.set(packet.sourceWindowId, list);
  }

  for (const output of dependencyOutputs) {
    if (output?.windowId && output.window) {
      windowById.set(output.windowId, output.window);
      carryByWindowId.set(output.windowId, toArray(output.carryPackets));
    }
  }

  const analysisWindows = [...windowById.values()].sort((left, right) => (left.windowOrder || 0) - (right.windowOrder || 0));
  const carryPackets = [...carryByWindowId.values()].flatMap((items) => items);
  const incidentMap = buildIncidentMap(context.incidents, analysisWindows, carryPackets);
  const incidents = mergeIncidentMetadata(incidentMap.incidents, context.incidents);
  const passStatus = buildPassStatus(
    context.sourceResult.pass_status || context.artifact.passStatus || {},
    ['pass_a'],
    'completed',
    null,
    previewPayload.rerunRequest,
  );
  const analysisRunManifest = buildAnalysisRunManifest(
    context.sourceResult.analysis_run_manifest || context.analysis.analysisRunManifest || {},
    previewPayload,
    previewPayload.executionPlan,
    reason,
  );
  const storedResult = toStoredArtifact({
    ...context.sourceResult,
    canonical_corpus: context.canonicalCorpus,
    analysis_windows: analysisWindows,
    window_results: buildWindowResults(analysisWindows),
    carry_packets: carryPackets,
    incident_map: buildIncidentMapPayload(incidents, analysisWindows, carryPackets),
    incidents,
    pass_status: passStatus,
    analysis_run_manifest: analysisRunManifest,
    meta: {
      ...toObject(context.sourceResult.meta),
      lastReducerRunAt: Date.now(),
    },
  });

  await persistArtifactState({
    corpusId,
    analysisId,
    sourceResult: context.sourceResult,
    storedResult,
    currentPhase: 'incident_reducer',
  });

  await onProgress(100, 'Reducer completed', {
    event: 'step_complete',
    step: {
      name: 'window_reducer',
      status: 'completed',
      progress: 100,
      message: 'Reducer completed',
    },
  });

  const payload = {
    analysisId,
    incidentIds: incidents
      .filter((incident) => (
        ensureArrayOfStrings(incident.lineage?.supporting_window_ids)
          .some((id) => ensureArrayOfStrings(windowIds).includes(id))
      ))
      .map((incident) => incident.id),
    windowIds,
    passStatus,
  };
  await completeStage(job, stageKey, payload);
  return payload;
}

export async function processIncidentWorkerJob(job, onProgress, { signal } = {}) {
  const { checkpoint, stageKey } = await beginStage(job, signal);
  if (checkpoint?.status === 'completed') {
    return checkpoint.payload || {};
  }
  const { analysisId, incidentId } = job.inputData || {};
  const context = await loadContext(analysisId);

  await onProgress(40, `Incident ${incidentId}: rebuilding beats`, {
    step: {
      name: 'incident_worker',
      status: 'running',
      progress: 50,
      message: `Refreshing beats for ${incidentId}`,
    },
  });

  const rebuiltBeats = ensureBeatsWithContext(
    buildIncidentBeats(context.sourceEvents, context.incidents),
    context.sourceEvents,
  ).filter((beat) => beat.incidentId === incidentId);

  await onProgress(100, `Incident ${incidentId}: completed`, {
    event: 'step_complete',
    step: {
      name: 'incident_worker',
      status: 'completed',
      progress: 100,
      message: `Incident ${incidentId} completed`,
    },
  });

  const payload = {
    analysisId,
    incidentId,
    beats: rebuiltBeats,
    beatCount: rebuiltBeats.length,
  };
  await completeStage(job, stageKey, payload);
  return payload;
}

export async function processCharacterCanonicalizerJob(job, onProgress, { signal } = {}) {
  const { checkpoint, stageKey } = await beginStage(job, signal);
  if (checkpoint?.status === 'completed') {
    return checkpoint.payload || {};
  }
  const { analysisId, dependencyJobIds = [] } = job.inputData || {};
  const context = await loadContext(analysisId);
  const incidentOutputs = await getDependencyOutputs(dependencyJobIds);
  const beats = mergeIncidentOutputs(context.beats, incidentOutputs);

  await onProgress(55, 'Character canonicalizer running', {
    step: {
      name: 'character_canonicalizer',
      status: 'running',
      progress: 55,
      message: 'Refreshing canonical characters',
    },
  });

  const rebuilt = buildCanonicalEntities(
    mapCanonicalToKnowledge(context.canonicalEntities),
    context.incidents,
    beats,
  );

  await onProgress(100, 'Character canonicalizer completed', {
    event: 'step_complete',
    step: {
      name: 'character_canonicalizer',
      status: 'completed',
      progress: 100,
      message: 'Character canonicalizer completed',
    },
  });

  const payload = {
    analysisId,
    kind: 'character',
    entities: toArray(rebuilt.canonicalEntities.characters),
    mentions: toArray(rebuilt.mentions).filter((mention) => mention.entityKind === 'character'),
  };
  await completeStage(job, stageKey, payload);
  return payload;
}

export async function processWorldCanonicalizerJob(job, onProgress, { signal } = {}) {
  const { checkpoint, stageKey } = await beginStage(job, signal);
  if (checkpoint?.status === 'completed') {
    return checkpoint.payload || {};
  }
  const { analysisId, dependencyJobIds = [] } = job.inputData || {};
  const context = await loadContext(analysisId);
  const incidentOutputs = await getDependencyOutputs(dependencyJobIds);
  const beats = mergeIncidentOutputs(context.beats, incidentOutputs);

  await onProgress(55, 'World canonicalizer running', {
    step: {
      name: 'world_canonicalizer',
      status: 'running',
      progress: 55,
      message: 'Refreshing canonical world entities',
    },
  });

  const rebuilt = buildCanonicalEntities(
    mapCanonicalToKnowledge(context.canonicalEntities),
    context.incidents,
    beats,
  );

  await onProgress(100, 'World canonicalizer completed', {
    event: 'step_complete',
    step: {
      name: 'world_canonicalizer',
      status: 'completed',
      progress: 100,
      message: 'World canonicalizer completed',
    },
  });

  const payload = {
    analysisId,
    kind: 'world',
    locations: toArray(rebuilt.canonicalEntities.locations),
    objects: toArray(rebuilt.canonicalEntities.objects),
    terms: toArray(rebuilt.canonicalEntities.terms),
    worldProfile: toObject(rebuilt.canonicalEntities.worldProfile || rebuilt.canonicalEntities.world_profile),
    mentions: toArray(rebuilt.mentions).filter((mention) => ['location', 'object', 'term'].includes(mention.entityKind)),
  };
  await completeStage(job, stageKey, payload);
  return payload;
}

export async function processGraphProjectionJob(job, onProgress, { signal } = {}) {
  const { checkpoint, stageKey } = await beginStage(job, signal);
  if (checkpoint?.status === 'completed') {
    return checkpoint.payload || {};
  }
  const {
    analysisId,
    incidentDependencyJobIds = [],
    canonicalizerDependencyJobIds = [],
  } = job.inputData || {};
  const context = await loadContext(analysisId);
  const incidentOutputs = await getDependencyOutputs(incidentDependencyJobIds);
  const canonicalizerOutputs = await getDependencyOutputs(canonicalizerDependencyJobIds);
  const beats = mergeIncidentOutputs(context.beats, incidentOutputs);
  const mergedCanonical = mergeCanonicalOutputs(
    context.canonicalEntities,
    context.entityMentions,
    canonicalizerOutputs,
  );

  await onProgress(65, 'Graph projection running', {
    step: {
      name: 'graph_projection',
      status: 'running',
      progress: 65,
      message: 'Refreshing graph projections',
    },
  });

  const incidentById = new Map(context.incidents.map((incident) => [incident.id, incident]));
  const graph = buildStoryGraph({
    incidents: context.incidents,
    events: beats.map((beat) => beatToLegacyEvent(beat, incidentById)),
    knowledge: mapCanonicalToKnowledge(mergedCanonical.canonicalEntities),
    relationships: toArray(context.sourceResult.relationships?.ships),
  });
  const graphProjections = buildGraphProjections(graph);

  await onProgress(100, 'Graph projection completed', {
    event: 'step_complete',
    step: {
      name: 'graph_projection',
      status: 'completed',
      progress: 100,
      message: 'Graph projection completed',
    },
  });

  const payload = {
    analysisId,
    graph,
    graphProjections,
    summary: graph.summary,
  };
  await completeStage(job, stageKey, payload);
  return payload;
}

export async function processReviewIntelligenceJob(job, onProgress, { signal } = {}) {
  const { checkpoint, stageKey, session } = await beginStage(job, signal);
  if (checkpoint?.status === 'completed') {
    return checkpoint.payload || {};
  }
  const {
    analysisId,
    corpusId,
    phase,
    windowIds = [],
    incidentIds = [],
    canonicalizerKinds = [],
    reason = null,
    preview = null,
    incidentDependencyJobIds = [],
    canonicalizerDependencyJobIds = [],
    graphDependencyJobIds = [],
  } = job.inputData || {};
  const context = await loadContext(analysisId);
  const previewPayload = preview || buildScopedRerunPreview({
    artifact: context.artifact,
    phase,
    windowIds,
    incidentIds,
    canonicalizerKinds,
    reason,
  });
  const incidentOutputs = await getDependencyOutputs(incidentDependencyJobIds);
  const canonicalizerOutputs = await getDependencyOutputs(canonicalizerDependencyJobIds);
  const graphOutputs = await getDependencyOutputs(graphDependencyJobIds);
  const beats = mergeIncidentOutputs(context.beats, incidentOutputs);
  const mergedCanonical = mergeCanonicalOutputs(
    context.canonicalEntities,
    context.entityMentions,
    canonicalizerOutputs,
  );
  const graphOutput = graphOutputs.at(-1) || {};
  const storyGraph = graphOutput.graph || buildStoryGraph({
    incidents: context.incidents,
    events: beats.map((beat) => beatToLegacyEvent(beat, new Map(context.incidents.map((incident) => [incident.id, incident])))),
    knowledge: mapCanonicalToKnowledge(mergedCanonical.canonicalEntities),
    relationships: toArray(context.sourceResult.relationships?.ships),
  });
  const graphProjections = graphOutput.graphProjections || buildGraphProjections(storyGraph);

  await onProgress(78, 'Review intelligence running', {
    step: {
      name: 'review_intelligence',
      status: 'running',
      progress: 75,
      message: 'Refreshing review queue and final artifact',
    },
  });

  const reviewQueue = buildReviewItems({
    corpusId,
    analysisId,
    incidents: context.incidents,
    beats,
    canonicalEntities: mergedCanonical.canonicalEntities,
    consistencyRisks: toArray(context.sourceResult.consistencyRisks || context.sourceResult.consistency_risks),
    storyGraph,
    previousReviewQueue: context.reviewQueue,
  });
  const passStatus = buildPassStatus(
    context.sourceResult.pass_status || context.artifact.passStatus || {},
    previewPayload.invalidation.passIds,
    'completed',
    null,
    previewPayload.rerunRequest,
  );
  const rerunManifest = buildRerunManifest({
    windows: toArray(context.artifact.analysisWindows),
    incidents: context.incidents,
    reviewQueue,
    passStatus,
  });
  const analysisRunManifest = buildAnalysisRunManifest(
    context.sourceResult.analysis_run_manifest || context.analysis.analysisRunManifest || {},
    previewPayload,
    previewPayload.executionPlan,
    reason,
  );
  if (
    Number(context.analysis.artifactRevision || 0) !== Number(session?.baselineArtifactRevision || context.analysis.artifactRevision || 0)
  ) {
    const error = new Error('Artifact revision changed during rerun session.');
    error.code = 'INVALID_INPUT';
    throw error;
  }

  const nextArtifactRevision = Number(session?.targetArtifactRevision || context.analysis.artifactRevision || 0) || 1;
  const storedResult = toStoredArtifact({
    ...context.sourceResult,
    incidents: context.incidents,
    incident_beats: beats,
    entity_mentions: mergedCanonical.entityMentions,
    canonical_entities: mergedCanonical.canonicalEntities,
    graph_projections: graphProjections,
    story_graph: {
      nodes: toArray(storyGraph.nodes),
      edges: toArray(storyGraph.edges),
      summary: toObject(storyGraph.summary),
    },
    graph_summary: toObject(storyGraph.summary),
    review_queue: reviewQueue,
    reviewQueue,
    rerun_manifest: rerunManifest,
    analysis_run_manifest: analysisRunManifest,
    pass_status: passStatus,
    knowledge: mapCanonicalToKnowledge(mergedCanonical.canonicalEntities),
    events: buildEventsLayer(
      context.sourceEvents.length
        ? context.sourceEvents
        : beats.map((beat) => beatToLegacyEvent(beat, new Map(context.incidents.map((incident) => [incident.id, incident])))),
      mergedCanonical.canonicalEntities.locations,
    ),
    meta: {
      ...toObject(context.sourceResult.meta),
      artifactVersion: 'v3',
      lastRerun: {
        phase: previewPayload.phase,
        requestedAt: Date.now(),
        reason: previewPayload.rerunRequest.reason,
        executionPlan: previewPayload.executionPlan,
      },
    },
  });

  await persistArtifactState({
    corpusId,
    analysisId,
    sourceResult: context.sourceResult,
    storedResult,
    currentPhase: 'completed',
  });
  await analysisRepository.persistGraph(
    analysisId,
    corpusId,
    storedResult.graph_projections,
    storedResult.pass_status,
  );
  await analysisRepository.updateAnalysis(analysisId, {
    artifactRevision: nextArtifactRevision,
    completedAt: Date.now(),
  });

  await onProgress(100, 'Review intelligence completed', {
    event: 'step_complete',
    step: {
      name: 'review_intelligence',
      status: 'completed',
      progress: 100,
      message: 'Review intelligence completed',
    },
  });

  const payload = {
    analysisId,
    corpusId,
    reviewQueueCount: reviewQueue.length,
    artifactVersion: 'v3',
    phase: previewPayload.phase,
  };
  await completeStage(job, stageKey, payload, {
    releaseSession: true,
    artifactRevision: nextArtifactRevision,
  });
  return payload;
}

export default {
  processAnalysisWindowJob,
  processIncidentReducerJob,
  processIncidentWorkerJob,
  processCharacterCanonicalizerJob,
  processWorldCanonicalizerJob,
  processGraphProjectionJob,
  processReviewIntelligenceJob,
};
