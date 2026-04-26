const READINESS_STATUS = {
  NOT_READY: 'not_ready',
  WEAK: 'weak',
  USABLE: 'usable',
  STRONG: 'strong',
};

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function hasText(value) {
  return String(value || '').trim().length > 0;
}

function clampScore(value) {
  return Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
}

function getCoverageScore(pack = {}, corpus = {}) {
  const chapterCount = Math.max(0, Number(corpus?.chapterCount || pack?.metadata?.chapterCount || 0));
  const chapterCanonCount = asArray(pack.chapterCanon).length;
  if (!chapterCount) return chapterCanonCount > 0 ? 12 : 0;
  const ratio = Math.min(1, chapterCanonCount / Math.max(1, chapterCount));
  if (ratio >= 0.35) return 20;
  if (ratio >= 0.18) return 16;
  if (ratio >= 0.08) return 11;
  if (ratio > 0) return 6;
  return 0;
}

function summarizeChapterCoverage(coverageItems = [], corpus = {}, pack = {}) {
  const chapterCount = Math.max(0, Number(corpus?.chapterCount || pack?.metadata?.chapterCount || 0));
  const items = asArray(coverageItems);
  const scoutDone = items.filter((item) => item?.scoutDone && !item?.scoutSynthetic).length;
  const scoutSynthetic = items.filter((item) => item?.scoutSynthetic).length;
  const digestDone = items.filter((item) => item?.digestDone).length;
  const deepDone = items.filter((item) => item?.deepDone).length;
  const failed = items.filter((item) => item?.status === 'error' || hasText(item?.failedReason)).length;
  return {
    chapterCount,
    scoutDone,
    scoutSynthetic,
    digestDone,
    deepDone,
    failed,
    missing: Math.max(0, chapterCount - scoutDone - scoutSynthetic),
  };
}

export function evaluateCanonPackReadiness(pack = {}, corpus = {}, analysisState = {}) {
  const missing = [];
  const nextActions = [];
  let score = 0;

  const characterCount = asArray(pack.characterCanon).length;
  const relationshipCount = asArray(pack.relationshipCanon).length;
  const styleObservations = asArray(pack.styleCanon?.observations).length;
  const hasStyleText = hasText(pack.styleCanon?.tone) || hasText(pack.styleCanon?.pacing) || hasText(pack.styleCanon?.voice);
  const restrictionCount = asArray(pack.canonRestrictions).length + asArray(pack.globalCanon?.hardRestrictions).length;
  const creativeGapCount = asArray(pack.creativeGaps).length;
  const hasGlobal = hasText(pack.globalCanon?.summary);
  const completedDeepCount = asArray(analysisState.deepAnalysisItems).filter((item) => item?.status === 'complete').length;
  const chapterCoverage = summarizeChapterCoverage(analysisState.chapterCoverage, corpus, pack);
  const adultAllowed = Boolean(analysisState.allowAdultCanon);
  const adultEnabled = Boolean(pack.adultCanon?.enabled);
  const adultNoteCount = asArray(pack.adultCanon?.notes).length;

  if (hasGlobal) score += 12;
  else {
    missing.push('global_summary');
    nextActions.push('Dựng Canon Pack sau khi có ít nhất một lượt phân tích sâu.');
  }

  if (characterCount >= 8) score += 18;
  else if (characterCount >= 3) score += 13;
  else if (characterCount > 0) score += 7;
  else {
    missing.push('character_canon');
    nextActions.push('Chạy phân tích sâu các arc/chương có nhân vật chính.');
  }

  if (relationshipCount >= 6) score += 14;
  else if (relationshipCount > 0) score += 9;
  else {
    missing.push('relationship_canon');
    nextActions.push('Chọn preset quan hệ đổi hoặc arc nhân vật để bổ sung Relationship Canon.');
  }

  if (styleObservations >= 4 || hasStyleText) score += 12;
  else if (styleObservations > 0) score += 7;
  else {
    missing.push('style_canon');
    nextActions.push('Phân tích sâu vài chương đại diện để lấy giọng văn và nhịp kể.');
  }

  if (restrictionCount >= 3) score += 12;
  else if (restrictionCount > 0) score += 7;
  else {
    missing.push('canon_restrictions');
    nextActions.push('Bổ sung điều cấm phá canon từ reveal/timeline/world rule quan trọng.');
  }

  const coverageScore = getCoverageScore(pack, corpus);
  score += coverageScore;
  if (coverageScore < 11) {
    missing.push('coverage');
    nextActions.push('Dùng Deep Selection Planner để tăng độ phủ chương/arc trọng tâm.');
  }

  if (creativeGapCount > 0) score += 6;
  else {
    missing.push('creative_gaps');
    nextActions.push('Tạo vùng trống sáng tạo để biết nên viết đồng nhân ở đâu.');
  }

  if (completedDeepCount > 0 || asArray(pack.chapterCanon).length > 0) score += 6;
  else {
    missing.push('deep_analysis');
    nextActions.push('Chạy ít nhất một lượt phân tích sâu trước khi dùng để viết.');
  }

  if (adultAllowed && adultEnabled && adultNoteCount === 0) {
    missing.push('adult_context');
    nextActions.push('Nạp hoặc phân tích cảnh trưởng thành để tạo Adult Canon riêng.');
  } else if (adultAllowed && adultEnabled && adultNoteCount > 0) {
    score += 4;
  }

  const normalizedScore = clampScore(score);
  const status = normalizedScore >= 82
    ? READINESS_STATUS.STRONG
    : normalizedScore >= 60
      ? READINESS_STATUS.USABLE
      : normalizedScore >= 35
        ? READINESS_STATUS.WEAK
        : READINESS_STATUS.NOT_READY;

  if (nextActions.length === 0) {
    nextActions.push(status === READINESS_STATUS.STRONG
      ? 'Mở editor và dùng Canon Pack này làm ngữ cảnh viết.'
      : 'Canon Pack đã đủ dùng; có thể liên kết project hoặc bổ sung thêm vùng trống sáng tạo.');
  }

  return {
    score: normalizedScore,
    status,
    missing: [...new Set(missing)],
    nextActions: [...new Set(nextActions)],
    coverage: {
      chapterCanonCount: asArray(pack.chapterCanon).length,
      chapterCount: Math.max(0, Number(corpus?.chapterCount || pack?.metadata?.chapterCount || 0)),
      completedDeepCount,
      scoutDone: chapterCoverage.scoutDone,
      scoutSynthetic: chapterCoverage.scoutSynthetic,
      digestDone: chapterCoverage.digestDone,
      deepDone: chapterCoverage.deepDone,
      failed: chapterCoverage.failed,
      missing: chapterCoverage.missing,
    },
  };
}

export function buildCanonPackWriteTargets(pack = {}, { allowAdultCanon = false } = {}) {
  const targets = [];

  asArray(pack.creativeGaps).slice(0, 8).forEach((gap, index) => {
    targets.push({
      id: `creative_gap_${index + 1}`,
      type: 'creative_gap',
      title: `Khai thác vùng trống ${index + 1}`,
      description: String(gap || ''),
    });
  });

  asArray(pack.arcCanon)
    .filter((arc) => ['high', 'critical'].includes(arc?.importance))
    .slice(0, 8)
    .forEach((arc) => {
      targets.push({
        id: `arc_${arc.id || arc.chapterStart || targets.length}`,
        type: 'arc',
        title: arc.title || `Arc chương ${arc.chapterStart}-${arc.chapterEnd}`,
        description: arc.whyLoad || arc.summary || '',
        chapterStart: arc.chapterStart,
        chapterEnd: arc.chapterEnd,
      });
    });

  if (allowAdultCanon && pack.adultCanon?.enabled) {
    asArray(pack.adultCanon?.notes).slice(0, 6).forEach((note, index) => {
      const text = typeof note === 'string'
        ? note
        : note.targetHint || note.dynamic || note.tone || note.evidence || JSON.stringify(note);
      targets.push({
        id: `adult_scene_${index + 1}`,
        type: 'adult_scene',
        title: `Cảnh trưởng thành gợi ý ${index + 1}`,
        description: String(text || ''),
        detailsHidden: pack.adultCanon?.detailsHidden !== false,
      });
    });
  }

  return targets;
}
