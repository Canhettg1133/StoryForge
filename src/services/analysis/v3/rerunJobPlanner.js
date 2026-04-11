import { JOB_PRIORITY, JOB_TYPES } from '../../jobs/config.js';
import { buildScopedRerunPreview, ensureArrayOfStrings, toArray } from './scopedRerun.js';

function intersects(left = [], right = []) {
  const rightSet = new Set(ensureArrayOfStrings(right));
  return ensureArrayOfStrings(left).some((value) => rightSet.has(value));
}

function resolveWindowIds(artifact, phase, requestedWindowIds = []) {
  const explicit = ensureArrayOfStrings(requestedWindowIds);
  if (explicit.length > 0) {
    return explicit;
  }
  if (phase === 'window' || phase === 'reducer') {
    return toArray(artifact?.analysisWindows).map((window) => window.windowId).filter(Boolean);
  }
  return [];
}

function resolveIncidentIds(artifact, phase, requestedIncidentIds = [], windowIds = []) {
  const explicit = ensureArrayOfStrings(requestedIncidentIds);
  if (explicit.length > 0) {
    return explicit;
  }

  if (windowIds.length > 0) {
    const impacted = toArray(artifact?.incidents)
      .filter((incident) => intersects(incident?.lineage?.supporting_window_ids, windowIds))
      .map((incident) => incident.id)
      .filter(Boolean);
    if (impacted.length > 0) {
      return impacted;
    }
  }

  if (phase === 'incident' || phase === 'window' || phase === 'reducer') {
    return toArray(artifact?.incidents).map((incident) => incident.id).filter(Boolean);
  }

  return [];
}

function resolveCanonicalizerKinds(phase, requestedKinds = [], incidentIds = []) {
  const explicit = ensureArrayOfStrings(requestedKinds);
  if (explicit.length > 0) {
    return explicit;
  }

  if (phase === 'character_canonicalizer') {
    return ['character'];
  }
  if (phase === 'world_canonicalizer') {
    return ['location', 'object', 'term', 'world'];
  }
  if (phase === 'incident' || phase === 'window' || phase === 'reducer' || incidentIds.length > 0) {
    return ['character', 'location', 'object', 'term', 'world'];
  }
  return [];
}

function buildTitle(prefix, phase, itemId = '') {
  const suffix = itemId ? ` - ${itemId}` : '';
  return `${prefix} - ${phase}${suffix}`;
}

export function buildScopedRerunJobPlan({
  artifact,
  corpusId,
  analysisId,
  phase = 'incident',
  windowIds = [],
  incidentIds = [],
  canonicalizerKinds = [],
  reason = null,
  keyCount = 1,
} = {}) {
  const normalizedPhase = String(phase || 'incident').trim() || 'incident';
  const plannedWindowIds = resolveWindowIds(artifact, normalizedPhase, windowIds);
  const plannedIncidentIds = resolveIncidentIds(artifact, normalizedPhase, incidentIds, plannedWindowIds);
  const plannedCanonicalizerKinds = resolveCanonicalizerKinds(
    normalizedPhase,
    canonicalizerKinds,
    plannedIncidentIds,
  );
  const preview = buildScopedRerunPreview({
    artifact,
    phase: normalizedPhase,
    windowIds: plannedWindowIds,
    incidentIds: plannedIncidentIds,
    canonicalizerKinds: plannedCanonicalizerKinds,
    reason,
    keyCount,
  });

  const jobs = [];

  for (const windowId of plannedWindowIds) {
    jobs.push({
      key: `window:${windowId}`,
      type: JOB_TYPES.ANALYSIS_WINDOW,
      dependsOn: [],
      priority: JOB_PRIORITY.HIGH,
      inputData: {
        title: buildTitle('Window job', normalizedPhase, windowId),
        corpusId,
        analysisId,
        phase: normalizedPhase,
        windowId,
        reason,
        executionPlan: preview.executionPlan,
      },
    });
  }

  const reducerNeeded = plannedWindowIds.length > 0 || normalizedPhase === 'reducer';
  if (reducerNeeded) {
    jobs.push({
      key: 'reducer',
      type: JOB_TYPES.INCIDENT_REDUCER,
      dependsOn: jobs.filter((job) => job.type === JOB_TYPES.ANALYSIS_WINDOW).map((job) => job.key),
      priority: JOB_PRIORITY.HIGH,
      inputData: {
        title: buildTitle('Reducer job', normalizedPhase),
        corpusId,
        analysisId,
        phase: normalizedPhase,
        windowIds: plannedWindowIds,
        incidentIds: plannedIncidentIds,
        reason,
        executionPlan: preview.executionPlan,
      },
    });
  }

  const incidentWorkerNeeded = plannedIncidentIds.length > 0
    && (
      normalizedPhase === 'incident'
      || normalizedPhase === 'window'
      || normalizedPhase === 'reducer'
      || preview.invalidation.passIds.includes('pass_b')
    );
  if (incidentWorkerNeeded) {
    for (const incidentId of plannedIncidentIds) {
      jobs.push({
        key: `incident:${incidentId}`,
        type: JOB_TYPES.INCIDENT_WORKER,
        dependsOn: reducerNeeded ? ['reducer'] : [],
        priority: JOB_PRIORITY.NORMAL,
        inputData: {
          title: buildTitle('Incident worker', normalizedPhase, incidentId),
          corpusId,
          analysisId,
          phase: normalizedPhase,
          incidentId,
          reason,
          executionPlan: preview.executionPlan,
        },
      });
    }
  }

  const canonicalizerDependencies = jobs
    .filter((job) => job.type === JOB_TYPES.INCIDENT_WORKER)
    .map((job) => job.key);
  const canonicalizerFallbackDeps = reducerNeeded ? ['reducer'] : [];

  if (plannedCanonicalizerKinds.includes('character')) {
    jobs.push({
      key: 'character_canonicalizer',
      type: JOB_TYPES.CHARACTER_CANONICALIZER,
      dependsOn: canonicalizerDependencies.length ? canonicalizerDependencies : canonicalizerFallbackDeps,
      priority: JOB_PRIORITY.NORMAL,
      inputData: {
        title: buildTitle('Character canonicalizer', normalizedPhase),
        corpusId,
        analysisId,
        phase: normalizedPhase,
        incidentIds: plannedIncidentIds,
        reason,
        executionPlan: preview.executionPlan,
      },
    });
  }

  if (plannedCanonicalizerKinds.some((kind) => ['location', 'object', 'term', 'world'].includes(kind))) {
    jobs.push({
      key: 'world_canonicalizer',
      type: JOB_TYPES.WORLD_CANONICALIZER,
      dependsOn: canonicalizerDependencies.length ? canonicalizerDependencies : canonicalizerFallbackDeps,
      priority: JOB_PRIORITY.NORMAL,
      inputData: {
        title: buildTitle('World canonicalizer', normalizedPhase),
        corpusId,
        analysisId,
        phase: normalizedPhase,
        incidentIds: plannedIncidentIds,
        reason,
        executionPlan: preview.executionPlan,
      },
    });
  }

  const graphDependsOn = jobs
    .filter((job) => [
      JOB_TYPES.CHARACTER_CANONICALIZER,
      JOB_TYPES.WORLD_CANONICALIZER,
    ].includes(job.type))
    .map((job) => job.key);
  const graphFallbackDeps = canonicalizerDependencies.length
    ? canonicalizerDependencies
    : (reducerNeeded ? ['reducer'] : []);

  jobs.push({
    key: 'graph_projection',
    type: JOB_TYPES.GRAPH_PROJECTION,
    dependsOn: graphDependsOn.length ? graphDependsOn : graphFallbackDeps,
    priority: JOB_PRIORITY.NORMAL,
    inputData: {
      title: buildTitle('Graph projection', normalizedPhase),
      corpusId,
      analysisId,
      phase: normalizedPhase,
      incidentIds: plannedIncidentIds,
      reason,
      executionPlan: preview.executionPlan,
    },
  });

  jobs.push({
    key: 'review_intelligence',
    type: JOB_TYPES.REVIEW_INTELLIGENCE,
    dependsOn: ['graph_projection'],
    priority: JOB_PRIORITY.NORMAL,
    inputData: {
      title: buildTitle('Review intelligence', normalizedPhase),
      corpusId,
      analysisId,
      phase: normalizedPhase,
      windowIds: plannedWindowIds,
      incidentIds: plannedIncidentIds,
      canonicalizerKinds: plannedCanonicalizerKinds,
      reason,
      executionPlan: preview.executionPlan,
      preview,
      stageJobKeys: {
        reducer: reducerNeeded ? 'reducer' : null,
        incidentWorkers: jobs.filter((job) => job.type === JOB_TYPES.INCIDENT_WORKER).map((job) => job.key),
        characterCanonicalizer: jobs.find((job) => job.type === JOB_TYPES.CHARACTER_CANONICALIZER)?.key || null,
        worldCanonicalizer: jobs.find((job) => job.type === JOB_TYPES.WORLD_CANONICALIZER)?.key || null,
        graphProjection: 'graph_projection',
      },
    },
  });

  return {
    preview,
    jobs,
  };
}

export default {
  buildScopedRerunJobPlan,
};
