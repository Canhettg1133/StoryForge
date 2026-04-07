function toCount(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function uniqueStrings(values = []) {
  return [...new Set(
    (Array.isArray(values) ? values : [])
      .map((value) => String(value || '').trim())
      .filter(Boolean),
  )];
}

const PHASE_STEP_MAP = {
  window: [
    { id: 'load_scope', label: 'Load windows + artifact', group: 'bootstrap' },
    { id: 'phase_a_windows', label: 'Rebuild analysis windows', group: 'phase_a' },
    { id: 'phase_a_reducer', label: 'Reduce carry packets + incident map', group: 'phase_a' },
    { id: 'phase_d_graph', label: 'Rebuild graph projections', group: 'phase_d' },
    { id: 'phase_e_review', label: 'Refresh review intelligence', group: 'phase_e' },
    { id: 'persist_scope', label: 'Persist artifact + projections', group: 'persist' },
  ],
  reducer: [
    { id: 'load_scope', label: 'Load windows + artifact', group: 'bootstrap' },
    { id: 'phase_a_reducer', label: 'Reduce carry packets + incident map', group: 'phase_a' },
    { id: 'phase_d_graph', label: 'Rebuild graph projections', group: 'phase_d' },
    { id: 'phase_e_review', label: 'Refresh review intelligence', group: 'phase_e' },
    { id: 'persist_scope', label: 'Persist artifact + projections', group: 'persist' },
  ],
  incident: [
    { id: 'load_scope', label: 'Load incidents + artifact', group: 'bootstrap' },
    { id: 'phase_b_workers', label: 'Rebuild incident beats', group: 'phase_b' },
    { id: 'phase_c_entities', label: 'Refresh canonical entities', group: 'phase_c' },
    { id: 'phase_d_graph', label: 'Rebuild graph projections', group: 'phase_d' },
    { id: 'phase_e_review', label: 'Refresh review intelligence', group: 'phase_e' },
    { id: 'persist_scope', label: 'Persist artifact + projections', group: 'persist' },
  ],
  character_canonicalizer: [
    { id: 'load_scope', label: 'Load artifact + entity mentions', group: 'bootstrap' },
    { id: 'phase_c_characters', label: 'Rebuild character canonicalizer', group: 'phase_c' },
    { id: 'phase_d_graph', label: 'Rebuild graph projections', group: 'phase_d' },
    { id: 'phase_e_review', label: 'Refresh review intelligence', group: 'phase_e' },
    { id: 'persist_scope', label: 'Persist artifact + projections', group: 'persist' },
  ],
  world_canonicalizer: [
    { id: 'load_scope', label: 'Load artifact + entity mentions', group: 'bootstrap' },
    { id: 'phase_c_world', label: 'Rebuild world canonicalizer', group: 'phase_c' },
    { id: 'phase_d_graph', label: 'Rebuild graph projections', group: 'phase_d' },
    { id: 'phase_e_review', label: 'Refresh review intelligence', group: 'phase_e' },
    { id: 'persist_scope', label: 'Persist artifact + projections', group: 'persist' },
  ],
  graph_projection: [
    { id: 'load_scope', label: 'Load artifact + canonical state', group: 'bootstrap' },
    { id: 'phase_d_graph', label: 'Rebuild graph projections', group: 'phase_d' },
    { id: 'phase_e_review', label: 'Refresh review intelligence', group: 'phase_e' },
    { id: 'persist_scope', label: 'Persist artifact + projections', group: 'persist' },
  ],
};

function buildLanes({ keyCount, phase, incidentCount, windowCount }) {
  if (keyCount <= 1) {
    return [
      {
        laneId: 'lane_1',
        strategy: 'serial',
        description: 'Run producer/worker/canonical phases sequentially on one key.',
        assignedGroups: ['bootstrap', 'phase_a', 'phase_b', 'phase_c', 'phase_d', 'phase_e', 'persist'],
      },
    ];
  }

  if (keyCount === 2) {
    return [
      {
        laneId: 'lane_a',
        strategy: 'producer',
        description: phase === 'window' || phase === 'reducer'
          ? `Keep window/reducer flow active for ${windowCount} window scope(s).`
          : 'Keep upstream rebuild active while downstream waits for fresh scope outputs.',
        assignedGroups: ['bootstrap', 'phase_a'],
      },
      {
        laneId: 'lane_b',
        strategy: 'worker',
        description: phase === 'incident'
          ? `Consume ${incidentCount} incident scope(s) as soon as they are ready.`
          : 'Drain downstream phases after producer output stabilizes.',
        assignedGroups: ['phase_b', 'phase_c', 'phase_d', 'phase_e', 'persist'],
      },
    ];
  }

  return [
    {
      laneId: 'lane_a',
      strategy: 'producer',
      description: `Reserve one lane for upstream window/reducer work across ${windowCount} window scope(s).`,
      assignedGroups: ['bootstrap', 'phase_a'],
    },
    {
      laneId: 'lane_b_pool',
      strategy: 'incident_worker_pool',
      description: `Fan out incident work across ${Math.max(1, keyCount - 1)} lane(s) for ${incidentCount} incident scope(s).`,
      assignedGroups: ['phase_b'],
    },
    {
      laneId: 'lane_c_pool',
      strategy: 'dynamic_canonicalizer',
      description: 'Move freed lanes into character/world canonicalizers, then graph/review projections.',
      assignedGroups: ['phase_c', 'phase_d', 'phase_e', 'persist'],
    },
  ];
}

export function buildNarrativeExecutionPlan({
  phase = 'incident',
  keyCount = 1,
  windowIds = [],
  incidentIds = [],
  canonicalizerKinds = [],
} = {}) {
  const normalizedPhase = String(phase || 'incident').trim() || 'incident';
  const safeKeyCount = Math.max(1, toCount(keyCount, 1));
  const scopedWindowIds = uniqueStrings(windowIds);
  const scopedIncidentIds = uniqueStrings(incidentIds);
  const scopedCanonicalizerKinds = uniqueStrings(canonicalizerKinds);
  const baseSteps = PHASE_STEP_MAP[normalizedPhase] || PHASE_STEP_MAP.incident;
  const windowCount = scopedWindowIds.length || (normalizedPhase === 'window' ? 1 : 0);
  const incidentCount = scopedIncidentIds.length || (normalizedPhase === 'incident' ? 1 : 0);

  return {
    phase: normalizedPhase,
    keyCount: safeKeyCount,
    policy: safeKeyCount <= 1
      ? 'single_key_serial'
      : safeKeyCount === 2
        ? 'dual_key_producer_worker'
        : 'multi_key_dynamic_pool',
    scopes: {
      windowIds: scopedWindowIds,
      incidentIds: scopedIncidentIds,
      canonicalizerKinds: scopedCanonicalizerKinds,
    },
    lanes: buildLanes({
      keyCount: safeKeyCount,
      phase: normalizedPhase,
      incidentCount,
      windowCount,
    }),
    steps: baseSteps.map((step, index) => ({
      ...step,
      order: index + 1,
      status: 'pending',
    })),
  };
}

export default {
  buildNarrativeExecutionPlan,
};
