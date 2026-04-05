export const RUN_MODES = {
  FAST: {
    id: 'fast',
    name: 'Fast',
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
    suggestMergeThreshold: 0.70,
    scoringDetail: 'full',
    reviewQueueBuild: true,
    strictThreshold: true,
  },
  // [NEW] Mode dùng toàn bộ context 1M: Pass A global → Pass B parallel per incident → Pass C knowledge
  INCIDENT_ONLY_1M: {
    id: 'incident_only_1m',
    name: 'Incident Only (1M)',
    description: 'Full-corpus global pass to extract major incidents, then parallel deep analysis per incident using full key pool. Minor events hidden by default.',
    // Context
    segmentationContext: 'full_corpus',
    maxSegmentationWords: 900000,
    // AI passes
    useAiGlobalPass: true,          // Pass A: toàn corpus → danh sách incident lớn
    useAiDeepPass: true,            // Pass B: per incident song song theo key pool
    useAiKnowledgePass: true,       // Pass C: consolidate knowledge từ incident output
    // Concurrency: dynamic theo key pool, không hardcode
    deepAnalysisConcurrency: 'key_pool',
    perIncidentMaxWords: 900000,
    // Max incidents Pass A có thể trả về trong 65K output budget
    // (~500 token/incident → tối đa ~130 incident)
    maxIncidentsGlobalPass: 130,
    // Heuristic pipeline
    boundaryRefine: false,          // AI Pass A đã handle boundary
    coherencePass: 'none',
    autoMergeThreshold: 0.80,
    scoringDetail: 'full',
    reviewQueueBuild: false,
    // UI behavior
    skipMinorEvents: true,          // event nhỏ ẩn mặc định ở màn chính
    evidenceOnDemand: true,         // chỉ load event khi user bấm "chi tiết"
  },
};

export const MODE_AUTO_ACCEPT_THRESHOLDS = {
  fast: {
    incident: 0.90,
    event: 0.85,
    location: 0.90,
  },
  balanced: {
    incident: 0.85,
    event: 0.75,
    location: 0.80,
  },
  deep: {
    incident: 0.80,
    event: 0.70,
    location: 0.75,
  },
  // [NEW]
  incident_only_1m: {
    incident: 0.75,
    event: 0.65,
    location: 0.70,
  },
};

export function getRunMode(mode) {
  const normalized = String(mode || '').toLowerCase();
  const allModes = Object.values(RUN_MODES);
  return allModes.find((item) => item.id === normalized) || RUN_MODES.BALANCED;
}

export function listRunModes() {
  return Object.values(RUN_MODES);
}

export function getModeThresholds(mode) {
  const selected = getRunMode(mode);
  return MODE_AUTO_ACCEPT_THRESHOLDS[selected.id] || MODE_AUTO_ACCEPT_THRESHOLDS.balanced;
}
