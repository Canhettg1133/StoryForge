export { selectPresetDeepChapterIndexes } from '../../../services/labLite/presetSelection.js';

export const WORKFLOW_TABS = [
  { id: 'import', label: 'Nạp liệu' },
  { id: 'scout', label: 'Quét nhanh' },
  { id: 'deep', label: 'Phân tích sâu' },
  { id: 'canon-pack', label: 'Canon Pack' },
  { id: 'materialize', label: 'Đưa vào Story Bible' },
];

export const ANALYSIS_MODES = [
  {
    value: 'fast',
    label: 'Phân tích nhanh',
    detail: 'Tự chạy Scout sau khi nạp để tìm chương đáng chú ý.',
  },
  {
    value: 'complete',
    label: 'Phân tích đầy đủ',
    detail: 'Tự chạy Scout, arc, phân tích phần cần thiết và dựng Canon Pack.',
  },
  {
    value: 'deep',
    label: 'Phân tích sâu',
    detail: 'Tự ưu tiên arc, reveal, quan hệ và chương rủi ro cao trước khi dựng Canon Pack.',
  },
];

export const INGEST_TYPES = [
  { value: 'source_story', label: 'Truyện gốc' },
  { value: 'new_chapters', label: 'Chương mới' },
  { value: 'scene_patch', label: 'Cảnh riêng cần nạp vào canon' },
  { value: 'lore_note', label: 'Lore / thiết lập' },
  { value: 'adult_scene', label: 'Cảnh 18+' },
  { value: 'translation_reference', label: 'Bản dịch / tham chiếu dịch' },
];

export const SCOUT_GOALS = [
  { value: 'story_bible', label: 'Tạo Story Bible' },
  { value: 'fanfic', label: 'Viết đồng nhân' },
  { value: 'continue_after_ending', label: 'Viết tiếp sau ending' },
  { value: 'adult_context', label: 'Nạp liệu trưởng thành / 18+' },
];

export const SCOUT_FILTERS = [
  { value: 'all', label: 'Tất cả' },
  { value: 'deep_load', label: 'Nên nạp sâu' },
  { value: 'reveal', label: 'Có reveal' },
  { value: 'relationship_shift', label: 'Quan hệ đổi' },
  { value: 'worldbuilding', label: 'Worldbuilding' },
  { value: 'sensitive', label: 'Nhạy cảm' },
];

export const DEEP_PRESETS = [
  { value: 'ai_recommended', label: 'AI tự chọn phần quan trọng' },
  { value: 'important_arcs', label: 'Arc quan trọng' },
  { value: 'signals', label: 'Reveal / worldbuilding / quan hệ' },
  { value: 'adult_sensitive', label: 'Cảnh 18+ / nhạy cảm' },
  { value: 'range', label: 'Khoảng chương' },
  { value: 'character', label: 'Nhân vật xuất hiện' },
  { value: 'missing_digest', label: 'Mọi chương còn thiếu digest' },
];

export const PACK_VIEW_TABS = [
  { id: 'overview', label: 'Tổng quan' },
  { id: 'characters', label: 'Nhân vật' },
  { id: 'relationships', label: 'Quan hệ' },
  { id: 'timeline', label: 'Timeline' },
  { id: 'style', label: 'Style' },
  { id: 'restrictions', label: 'Cấm phá canon' },
  { id: 'gaps', label: 'Vùng trống' },
  { id: 'adult', label: '18+' },
];

const RECOMMENDATION_LABELS = {
  skip: 'Bỏ qua',
  light_load: 'Nạp nhẹ',
  deep_load: 'Nạp sâu',
};

const PRIORITY_LABELS = {
  low: 'Thấp',
  medium: 'Vừa',
  high: 'Cao',
  critical: 'Rất cao',
};

const MATERIALIZE_DOMAIN_LABELS = {
  character: 'Nhân vật',
  relationship: 'Quan hệ',
  location: 'Địa điểm & thuật ngữ',
  object: 'Địa điểm & thuật ngữ',
  world_term: 'Địa điểm & thuật ngữ',
  faction: 'Địa điểm & thuật ngữ',
  timeline: 'Timeline',
  canon_fact: 'Quy tắc canon',
  chapter_meta: 'Tóm tắt chương',
  style_pack: 'Style',
};

const MATERIALIZE_ACTION_LABELS = {
  create: 'Thêm mới',
  update: 'Cập nhật',
  skip: 'Bỏ qua',
  needs_review: 'Cần xem lại',
  conflict: 'Cần xem lại',
};

const MATERIALIZE_GROUP_ORDER = [
  'Nhân vật',
  'Quan hệ',
  'Địa điểm & thuật ngữ',
  'Timeline',
  'Quy tắc canon',
  'Tóm tắt chương',
  'Style',
];

export function formatNumber(value) {
  return Number(value || 0).toLocaleString('en-US');
}

export function getRecommendationLabel(value) {
  return RECOMMENDATION_LABELS[value] || value || '';
}

export function getPriorityLabel(value) {
  return PRIORITY_LABELS[value] || value || '';
}

export function getReadinessLabel(status) {
  if (status === 'strong') return 'Mạnh';
  if (status === 'usable') return 'Đủ dùng';
  if (status === 'weak') return 'Yếu';
  return 'Chưa sẵn sàng';
}

export function getSignalLabel(signal) {
  switch (signal) {
    case 'new_character': return 'Nhân vật mới';
    case 'relationship_shift': return 'Đổi quan hệ';
    case 'worldbuilding': return 'Worldbuilding';
    case 'reveal': return 'Reveal';
    case 'state_change': return 'Đổi trạng thái';
    case 'adult_sensitive': return 'Trưởng thành';
    case 'sensitive_or_relationship_heavy': return 'Nhạy cảm/quan hệ';
    case 'ending_hook': return 'Hook cuối';
    default: return signal;
  }
}

export function resultMatchesFilter(result, filter) {
  if (filter === 'all') return true;
  if (filter === 'deep_load') return result.recommendation === 'deep_load';
  if (filter === 'sensitive') {
    return result.detectedSignals?.some((signal) => signal === 'adult_sensitive' || signal === 'sensitive_or_relationship_heavy');
  }
  return result.detectedSignals?.includes(filter);
}

export function summarizeCoverage(chapterCoverage = [], chapterCount = 0) {
  const total = Math.max(0, Number(chapterCount || chapterCoverage.length || 0));
  const realScout = chapterCoverage.filter((item) => item.scoutDone && !item.scoutSynthetic).length;
  const syntheticScout = chapterCoverage.filter((item) => item.scoutSynthetic).length;
  const digestDone = chapterCoverage.filter((item) => item.digestDone).length;
  const deepDone = chapterCoverage.filter((item) => item.deepDone).length;
  const failed = chapterCoverage.filter((item) => item.status === 'error' || item.failedReason).length;
  const missing = Math.max(0, total - realScout - syntheticScout);
  return { total, realScout, syntheticScout, digestDone, deepDone, failed, missing };
}

export function buildCoverageMap(chapterCoverage = []) {
  return new Map((chapterCoverage || []).map((entry) => [Number(entry.chapterIndex), entry]));
}

export function buildChapterCoverageBadges(coverage = null) {
  if (!coverage) return [{ label: 'Thiếu scout', tone: 'warning' }];
  const badges = [];
  if (coverage.scoutSynthetic) badges.push({ label: 'Fallback', tone: 'warning' });
  if (!coverage.scoutDone && !coverage.scoutSynthetic) badges.push({ label: 'Thiếu scout', tone: 'warning' });
  if (!coverage.digestDone) badges.push({ label: 'Thiếu digest', tone: 'warning' });
  if (!coverage.deepDone) badges.push({ label: 'Thiếu deep', tone: 'neutral' });
  if (coverage.status === 'error' || coverage.failedReason) badges.push({ label: 'Lỗi', tone: 'error' });
  return badges;
}

export function chapterMatchesCoverageFilter(chapter, coverage, filter) {
  if (!filter || filter === 'all') return true;
  if (filter === 'missing_scout') return !coverage?.scoutDone && !coverage?.scoutSynthetic;
  if (filter === 'missing_digest') return !coverage?.digestDone;
  if (filter === 'missing_deep') return !coverage?.deepDone;
  if (filter === 'fallback') return Boolean(coverage?.scoutSynthetic);
  if (filter === 'error') return coverage?.status === 'error' || Boolean(coverage?.failedReason);
  return true;
}

export function formatChapterDisplayTitle(chapter = {}) {
  const index = Number(chapter.index || chapter.chapterIndex || 0);
  const title = String(chapter.title || '').trim();
  if (!index) return title || 'Chương chưa rõ';
  const prefixPattern = new RegExp(`^(?:chương|chuong|chapter|ch\\.?|#)\\s*${index}\\s*[:.\\-–—]?\\s*`, 'iu');
  if (!title) return `Chương ${index}`;
  if (prefixPattern.test(title)) {
    const rest = title.replace(prefixPattern, '').trim();
    return rest ? `Chương ${index}: ${rest}` : `Chương ${index}`;
  }
  return `Chương ${index}: ${title}`;
}

export function summarizeParserPreflight(corpus = {}) {
  const diagnostics = corpus?.parseDiagnostics || {};
  const rejectedCount = Array.isArray(diagnostics.rejectedBoundaries) ? diagnostics.rejectedBoundaries.length : 0;
  const acceptedCount = Array.isArray(diagnostics.acceptedBoundaries) ? diagnostics.acceptedBoundaries.length : 0;
  const candidateCount = Array.isArray(diagnostics.headingCandidates) ? diagnostics.headingCandidates.length : 0;
  const chapterCount = Number(corpus?.chapterCount || 0);
  const tokens = Number(corpus?.totalEstimatedTokens || 0);
  const warnings = [];
  if (rejectedCount > 0) warnings.push(`Có ${formatNumber(rejectedCount)} ranh giới bị loại. Nên kiểm tra cách tách chương nếu số chương lệch.`);
  if (candidateCount > 0 && acceptedCount > 0 && Math.abs(candidateCount - acceptedCount) > Math.max(8, acceptedCount * 0.15)) {
    warnings.push('Parser thấy nhiều tiêu đề nghi vấn hơn số ranh giới được nhận.');
  }
  if (chapterCount === 1 && tokens > 150_000) warnings.push('File rất dài nhưng chỉ có 1 chương. Có thể cần chỉnh cách tách chương.');

  const suggestedMode = chapterCount >= 700 || tokens >= 1_200_000
    ? 'deep'
    : chapterCount >= 40 || tokens >= 120_000
      ? 'complete'
      : 'fast';

  return {
    stats: [
      { label: 'Chương', value: formatNumber(chapterCount) },
      { label: 'Token ước tính', value: formatNumber(tokens) },
      { label: 'Ứng viên tiêu đề', value: formatNumber(candidateCount) },
      { label: 'Ranh giới đã nhận', value: formatNumber(acceptedCount) },
    ],
    warnings,
    suggestedMode,
  };
}

export function getMaterializeActionLabel(action) {
  return MATERIALIZE_ACTION_LABELS[action] || action || '';
}

export function getMaterializeDomainLabel(type) {
  return MATERIALIZE_DOMAIN_LABELS[type] || 'Khác';
}

function describeMaterializeSource(action = {}) {
  const source = action.source || {};
  if (source.name) return source.name;
  if (source.title) return source.title;
  if (source.characterA || source.characterB) return [source.characterA, source.characterB].filter(Boolean).join(' / ');
  if (source.event) return source.event;
  if (source.description) return source.description;
  return action.reason || 'Mục cần duyệt';
}

export function groupMaterializationActions(actions = []) {
  const groups = new Map();
  (actions || []).forEach((action) => {
    const label = getMaterializeDomainLabel(action.type);
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push({
      id: action.id,
      type: action.type,
      title: describeMaterializeSource(action),
      actionLabel: getMaterializeActionLabel(action.action),
      selectable: ['create', 'update'].includes(action.action),
      selectedByDefault: ['create', 'update'].includes(action.action),
      reason: action.reason || '',
      hasDiff: Boolean(action.existing && action.payload),
      before: action.existing || null,
      after: action.payload || null,
    });
  });

  return [...groups.entries()]
    .map(([label, items]) => ({ label, items }))
    .sort((left, right) => {
      const leftIndex = MATERIALIZE_GROUP_ORDER.indexOf(left.label);
      const rightIndex = MATERIALIZE_GROUP_ORDER.indexOf(right.label);
      return (leftIndex === -1 ? 999 : leftIndex) - (rightIndex === -1 ? 999 : rightIndex);
    });
}

export function isStepRunning(state) {
  return ['running', 'building', 'planning', 'applying', 'reading', 'saving'].includes(state?.status);
}

export function getStepStatus({
  stepId,
  currentCorpus,
  coverageSummary,
  scoutResults,
  arcs,
  deepAnalysisItems,
  latestPack,
  readiness,
  materializationPlan,
  importState,
  scoutState,
  arcState,
  deepState,
  canonPackState,
  materializeState,
  presetRunState,
}) {
  if (presetRunState?.status === 'running' && presetRunState.step === stepId) return presetRunState.label || 'đang chạy';
  if (stepId === 'import') {
    if (isStepRunning(importState)) return 'đang nạp file';
    return currentCorpus ? `${formatNumber(currentCorpus.chapterCount)} chương đã nạp` : 'chưa có dữ liệu';
  }
  if (stepId === 'scout') {
    if (isStepRunning(scoutState) || isStepRunning(arcState)) return 'đang quét';
    if (!currentCorpus) return 'chưa bắt đầu';
    if (coverageSummary?.missing > 0) return `Thiếu Scout ${formatNumber(coverageSummary.missing)} chương`;
    if (scoutResults.length > 0 && arcs.length > 0) return 'đủ để chọn phần sâu';
    return 'cần quét nhanh';
  }
  if (stepId === 'deep') {
    if (isStepRunning(deepState)) return 'đang phân tích sâu';
    if (!currentCorpus) return 'chưa bắt đầu';
    if (deepAnalysisItems.some((item) => item.status === 'complete')) return `Đã có ${formatNumber(deepAnalysisItems.filter((item) => item.status === 'complete').length)} kết quả`;
    return arcs.length > 0 || scoutResults.length > 0 ? 'cần chọn phần quan trọng' : 'chưa bắt đầu';
  }
  if (stepId === 'canon-pack') {
    if (isStepRunning(canonPackState)) return 'đang dựng pack';
    if (latestPack) return `Canon Pack đủ ${formatNumber(readiness?.score)}%`;
    return deepAnalysisItems.some((item) => item.status === 'complete') ? 'có thể dựng pack' : 'chưa bắt đầu';
  }
  if (isStepRunning(materializeState)) return 'đang ghi Story Bible';
  if (materializationPlan) return 'đang chờ duyệt';
  return latestPack ? 'sẵn sàng dùng để viết' : 'chưa bắt đầu';
}

export function getNextAction({
  currentCorpus,
  coverageSummary,
  scoutResults,
  arcs,
  deepPlan,
  deepAnalysisItems,
  latestPack,
  readiness,
  materializationPlan,
  currentProject,
}) {
  if (!currentCorpus) return { step: 'import', action: 'open', title: 'Nạp truyện hoặc cảnh cần phân tích', detail: 'Chọn preset rồi kéo thả TXT, MD hoặc DOCX.' };
  if (coverageSummary?.missing > 0 || scoutResults.length === 0) {
    return { step: 'scout', action: 'runScoutMissing', title: 'Quét các chương còn thiếu', detail: `Còn ${formatNumber(coverageSummary?.missing || currentCorpus.chapterCount)} chương chưa có Scout thật.` };
  }
  if (coverageSummary?.failed > 0) {
    return { step: 'scout', action: 'retryScoutFailures', title: 'Chạy lại lỗi Scout', detail: `${formatNumber(coverageSummary.failed)} chương đang lỗi.` };
  }
  if (arcs.length === 0) return { step: 'scout', action: 'runArcMapper', title: 'Tạo bản đồ arc', detail: 'Gom chương thành mạch truyện để chọn phần cần đọc sâu.' };
  if (!deepPlan?.selectedCount && !deepAnalysisItems.some((item) => item.status === 'complete')) {
    return { step: 'deep', action: 'applyDeepPlanner', title: 'Để AI tự chọn phần quan trọng', detail: 'Dùng kết quả Scout và arc để chọn chương cần phân tích sâu.' };
  }
  if (!deepAnalysisItems.some((item) => item.status === 'complete')) {
    return { step: 'deep', action: 'runDeepAnalysis', title: 'Chạy phân tích sâu', detail: `${formatNumber(deepPlan.selectedCount || 0)} chương đã được chọn.` };
  }
  if (!latestPack) return { step: 'canon-pack', action: 'buildCanonPack', title: 'Dựng Canon Pack', detail: 'Gộp Scout, arc và phân tích sâu thành bộ nhớ dùng để viết.' };
  if (!['usable', 'strong'].includes(readiness?.status)) {
    return { step: 'canon-pack', action: 'runDeepMissing', title: 'Bổ sung phần còn thiếu', detail: readiness?.nextActions?.[0] || 'Chạy thêm phân tích sâu cho dữ liệu trọng tâm.' };
  }
  if (currentProject?.source_canon_pack_id === latestPack.id) return { step: 'materialize', action: 'openEditor', title: 'Mở editor với Canon Pack', detail: 'Dự án này đã liên kết Canon Pack.' };
  if (materializationPlan) return { step: 'materialize', action: 'open', title: 'Duyệt trước khi ghi Story Bible', detail: 'Chọn mục thật sự muốn thêm hoặc cập nhật.' };
  return { step: 'canon-pack', action: 'useCanonPack', title: 'Dùng Canon Pack để viết', detail: 'Liên kết pack với dự án hoặc tạo dự án đồng nhân mới.' };
}
