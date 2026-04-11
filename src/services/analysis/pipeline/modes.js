export const RUN_MODES = {
  FAST_PREVIEW: {
    id: 'fast_preview',
    aliases: ['fast'],
    name: 'Fast Preview',
    description: 'Skip heavy global context and boundary refinement for speed.',
    segmentationContext: 'compressed',
    maxSegmentationWords: 50000,
    boundaryRefine: false,
    deepAnalysisConcurrency: 5,
    perIncidentMaxWords: 50000,
    coherencePass: 'light',
    autoMergeThreshold: 0.85,
    scoringDetail: 'basic',
    reviewQueueBuild: false,
  },
  BALANCED: {
    id: 'balanced',
    aliases: [],
    name: 'Balanced',
    description: 'Default mode with boundary refine, moderate coherence and review queue.',
    segmentationContext: 'compressed',
    maxSegmentationWords: 200000,
    boundaryRefine: true,
    overlapThreshold: 0.3,
    deepAnalysisConcurrency: 3,
    perIncidentMaxWords: 100000,
    coherencePass: 'light',
    autoMergeThreshold: 0.82,
    scoringDetail: 'detailed',
    reviewQueueBuild: true,
  },
  DEEP: {
    id: 'deep',
    aliases: [],
    name: 'Deep',
    description: 'Most thorough mode with full coherence, strict review and lower auto-accept thresholds.',
    segmentationContext: 'full',
    maxSegmentationWords: 500000,
    boundaryRefine: true,
    overlapThreshold: 0.4,
    bm25Refinement: true,
    deepAnalysisConcurrency: 2,
    perIncidentMaxWords: 150000,
    multiplePasses: true,
    coherencePass: 'full',
    autoMergeThreshold: 0.82,
    suggestMergeThreshold: 0.7,
    scoringDetail: 'full',
    reviewQueueBuild: true,
    strictThreshold: true,
  },
  FULL_CORPUS_1M: {
    id: 'full_corpus_1m',
    aliases: ['incident_only_1m'],
    name: 'Full Corpus 1M',
    description: 'Full-corpus incident map, parallel deep analysis, then knowledge consolidation.',
    segmentationContext: 'full_corpus',
    maxSegmentationWords: 900000,
    useAiGlobalPass: true,
    useAiDeepPass: true,
    useAiKnowledgePass: true,
    deepAnalysisConcurrency: 'key_pool',
    perIncidentMaxWords: 900000,
    maxIncidentsGlobalPass: 130,
    boundaryRefine: false,
    coherencePass: 'none',
    autoMergeThreshold: 0.8,
    scoringDetail: 'full',
    reviewQueueBuild: false,
    skipMinorEvents: true,
    evidenceOnDemand: true,
  },
  LEGACY: {
    id: 'legacy',
    aliases: [],
    name: 'Legacy',
    description: 'Legacy incident-first heuristic pipeline with optional AI step pipeline.',
    segmentationContext: 'compressed',
    maxSegmentationWords: 200000,
    boundaryRefine: true,
    overlapThreshold: 0.3,
    deepAnalysisConcurrency: 3,
    perIncidentMaxWords: 100000,
    coherencePass: 'light',
    autoMergeThreshold: 0.82,
    scoringDetail: 'detailed',
    reviewQueueBuild: true,
    useLegacyPipeline: true,
  },
};

export const MODE_AUTO_ACCEPT_THRESHOLDS = {
  fast_preview: {
    incident: 0.9,
    event: 0.85,
    location: 0.9,
  },
  balanced: {
    incident: 0.85,
    event: 0.75,
    location: 0.8,
  },
  deep: {
    incident: 0.8,
    event: 0.7,
    location: 0.75,
  },
  full_corpus_1m: {
    incident: 0.75,
    event: 0.65,
    location: 0.7,
  },
  legacy: {
    incident: 0.85,
    event: 0.75,
    location: 0.8,
  },
};

export function getRunMode(mode) {
  const normalized = String(mode || '').toLowerCase();
  const allModes = Object.values(RUN_MODES);
  return allModes.find((item) => item.id === normalized || item.aliases?.includes(normalized)) || RUN_MODES.BALANCED;
}

export function listRunModes() {
  return Object.values(RUN_MODES);
}

export function getModeThresholds(mode) {
  const selected = getRunMode(mode);
  return MODE_AUTO_ACCEPT_THRESHOLDS[selected.id] || MODE_AUTO_ACCEPT_THRESHOLDS.balanced;
}
