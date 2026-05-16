import { TASK_TYPES } from '../router';
import { compileMacroArcContract, formatMacroArcContract } from '../macroArcContract';
import {
  AUTHOR_ROLE_TABLE,
  MOOD_BOARD_DEFAULTS,
  ANTI_AI_BLACKLIST,
} from '../../../utils/constants';
import {
  WRITING_TASKS_FOR_BRIDGE,
  FULL_WRITING_TASKS,
  STYLE_ONLY_TASKS,
} from './taskSets';

// =============================================
// Layer 0: Grand Strategy (Phase 9)
// Inject before every other layer so the AI sees the story map first.
//
// Why Layer 0 comes first:
// - LLM attention is strongest near the start and end of the prompt.
// - Grand Strategy at the top reduces drift on long contexts.
//
// Only inject when:
// 1. This is a writing task.
// 2. currentArc or currentMacroArc exists.
// =============================================

/**
 * Build Layer 0 - Grand Strategy & Pacing (merged).
 * Combines old Layer 0 (Grand Strategy) + old Layer 4.5 (Pacing Control)
 * into a single unified layer. Deduplicates "don't resolve early" constraints.
 *
 * Triggers when any of these exist: macroArc, arc, or pacing info.
 *
 * @param {string}      taskType
 * @param {object|null} currentMacroArc
 * @param {object|null} currentArc
 * @param {string}      ultimateGoal
 * @param {number}      targetLength
 * @param {number}      currentChapterIndex
 * @param {Array}       milestones
 * @returns {string}
 */
export function buildGrandStrategyLayer(
  taskType,
  currentMacroArc,
  currentArc,
  ultimateGoal,
  targetLength,
  currentChapterIndex,
  milestones
) {
  if (!WRITING_TASKS_FOR_BRIDGE.has(taskType) && taskType !== TASK_TYPES.OUTLINE) return '';

  var hasArcInfo = currentMacroArc || currentArc;
  var hasPacingInfo = targetLength > 0 && ultimateGoal;
  if (!hasArcInfo && !hasPacingInfo) return '';

  var parts = [];

  // Progress overview (merged from old Layer 4.5)
  if (hasPacingInfo) {
    var progressPercent = Math.round((currentChapterIndex / targetLength) * 100);
    var progressLines = [];
    progressLines.push('Truyện dự kiến dài ' + targetLength + ' chương. Hiện tại: chương ' + (currentChapterIndex + 1) + ' (' + progressPercent + '%).');
    if (milestones && milestones.length > 0) {
      var nextMs = milestones.find(function(m) { return m.percent > progressPercent; });
      if (nextMs) {
        progressLines.push('Cột mốc kế tiếp (' + nextMs.percent + '%): "' + nextMs.description + '".');
      }
    }
    parts.push('[TIẾN ĐỘ]\n' + progressLines.join('\n'));
  }

  // Macro Arc
  if (currentMacroArc) {
    var macroLines = [];
    macroLines.push('Cột mốc lớn hiện tại: ' + currentMacroArc.title);
    if (currentMacroArc.description) {
      macroLines.push('Mô tả: ' + currentMacroArc.description);
    }
    if (currentMacroArc.chapter_from && currentMacroArc.chapter_to) {
      macroLines.push('Phạm vi: Chương ' + currentMacroArc.chapter_from + ' đến Chương ' + currentMacroArc.chapter_to);
    }
    if (currentMacroArc.emotional_peak) {
      macroLines.push('Cảm xúc cần đạt khi kết thúc: ' + currentMacroArc.emotional_peak);
    }
    parts.push('[CỘT MỐC LỚN]\n' + macroLines.join('\n'));
  }

  // Arc
  if (currentArc) {
    var arcLines = [];
    arcLines.push('Hồi truyện hiện tại: ' + (currentArc.title || '(chưa đặt tên)'));
    if (currentArc.goal) {
      arcLines.push('Mục tiêu hồi này: ' + currentArc.goal);
    }
    if (currentArc.chapter_start && currentArc.chapter_end) {
      arcLines.push('Phạm vi: Chương ' + currentArc.chapter_start + ' đến Chương ' + currentArc.chapter_end);
    }
    if (currentArc.power_level_start || currentArc.power_level_end) {
      arcLines.push('Cấp độ sức mạnh: ' + (currentArc.power_level_start || '?') + ' \u2192 ' + (currentArc.power_level_end || '?'));
    }
    parts.push('[HỒI TRUYỆN HIỆN TẠI]\n' + arcLines.join('\n'));
  }

  // Unified constraints (single source of truth - no duplication)
  var constraints = [];
  if (currentMacroArc && currentMacroArc.chapter_to && targetLength > 0) {
    var remainingInMacro = currentMacroArc.chapter_to - (currentChapterIndex + 1);
    if (remainingInMacro > 0) {
      constraints.push('Còn ' + remainingInMacro + ' chương nữa mới kết thúc cột mốc "' + currentMacroArc.title + '".');
    }
  }
  if (currentArc && currentArc.chapter_end) {
    var remainingInArc = currentArc.chapter_end - (currentChapterIndex + 1);
    if (remainingInArc > 0) {
      constraints.push('Còn ' + remainingInArc + ' chương nữa mới kết thúc hồi này.');
    }
  }
  if (ultimateGoal) {
    constraints.push('Mục tiêu cuối cùng của bộ truyện: "' + ultimateGoal + '" \u2014 chưa đến lúc đạt được.');
  }

  if (constraints.length > 0) {
    parts.push('[RÀNG BUỘC TIẾN ĐỘ]\n' + constraints.map(function(c) { return '- ' + c; }).join('\n'));
  }

  if (parts.length === 0) return '';

  return '[CHIẾN LƯỢC & TIẾN ĐỘ]\n' + parts.join('\n\n');
}

// =============================================
// Layer 4.2: Chapter Outline (Phase 8)
// =============================================

/**
 * Build Layer 4.2 - Chapter Outline Context.
 * Only inject for writing tasks.
 */
export function buildChapterOutlineLayer(taskType, currentChapterOutline, chapterBlueprintContext, upcomingChapters) {
  if (!WRITING_TASKS_FOR_BRIDGE.has(taskType) && taskType !== TASK_TYPES.PLOT_SUGGEST && taskType !== TASK_TYPES.OUTLINE) return '';
  if (!currentChapterOutline && (!upcomingChapters || upcomingChapters.length === 0)) return '';

  const parts = [];

  if (currentChapterOutline && (
    currentChapterOutline.title
    || currentChapterOutline.summary
    || currentChapterOutline.purpose
    || currentChapterOutline.primaryLocation
  )) {
    const cur = [];
    if (currentChapterOutline.title) cur.push('Tiêu đề: ' + currentChapterOutline.title);
    if (currentChapterOutline.summary) cur.push('Nội dung cần viết: ' + currentChapterOutline.summary);
    if (currentChapterOutline.purpose) cur.push('Purpose: ' + currentChapterOutline.purpose);
    if (currentChapterOutline.openingState) {
      cur.push('Trạng thái mở chương / điểm xuất phát: ' + currentChapterOutline.openingState);
    }
    if (currentChapterOutline.handoffFromPrevious) {
      cur.push('Cầu nhân quả từ chương trước: ' + currentChapterOutline.handoffFromPrevious);
    }
    if (currentChapterOutline.endingState) {
      cur.push('Trạng thái kết chương dự kiến: ' + currentChapterOutline.endingState);
    }
    if (currentChapterOutline.stateDelta) {
      cur.push('State delta / thay đổi Character Live Canon dự kiến: ' + currentChapterOutline.stateDelta);
    }
    if (currentChapterOutline.featuredCharacters && currentChapterOutline.featuredCharacters.length > 0) {
      cur.push('Nhân vật bắt buộc bám sát: ' + currentChapterOutline.featuredCharacters.join(', '));
    }
    if (currentChapterOutline.primaryLocation) {
      cur.push('Địa điểm chính: ' + currentChapterOutline.primaryLocation);
    }
    if (currentChapterOutline.threadTitles && currentChapterOutline.threadTitles.length > 0) {
      cur.push('Tuyến truyện phải đẩy: ' + currentChapterOutline.threadTitles.join(', '));
    }
    if (currentChapterOutline.requiredFactions && currentChapterOutline.requiredFactions.length > 0) {
      cur.push('Thế lực cần xuất hiện: ' + currentChapterOutline.requiredFactions.join(', '));
    }
    if (currentChapterOutline.requiredObjects && currentChapterOutline.requiredObjects.length > 0) {
      cur.push('Vật phẩm cần xuất hiện: ' + currentChapterOutline.requiredObjects.join(', '));
    }
    if (currentChapterOutline.keyEvents && currentChapterOutline.keyEvents.length > 0) {
      cur.push(
        'Sự kiện bắt buộc xảy ra:\n' +
        currentChapterOutline.keyEvents.map(function (e) { return '- ' + e; }).join('\n')
      );
    }
    parts.push('[NHIỆM VỤ CHƯƠNG NÀY - BÁM SÁT, KHÔNG LẠC SANG CHƯƠNG KHÁC]\n' + cur.join('\n'));
  }

  if (chapterBlueprintContext) {
    const whitelistLines = [];
    const blueprintCharacters = Array.isArray(chapterBlueprintContext.featured_characters)
      ? chapterBlueprintContext.featured_characters
      : [];
    if (blueprintCharacters.length > 0) {
      whitelistLines.push('Nhân vật ưu tiên: ' + blueprintCharacters.join(', '));
    }
    if (chapterBlueprintContext.primary_location) {
      whitelistLines.push('Địa điểm ưu tiên: ' + chapterBlueprintContext.primary_location);
    }
    if (Array.isArray(chapterBlueprintContext.required_factions) && chapterBlueprintContext.required_factions.length > 0) {
      whitelistLines.push('Thế lực được phép/nên sử dụng: ' + chapterBlueprintContext.required_factions.join(', '));
    }
    if (Array.isArray(chapterBlueprintContext.required_objects) && chapterBlueprintContext.required_objects.length > 0) {
      whitelistLines.push('Vật phẩm được phép/nên sử dụng: ' + chapterBlueprintContext.required_objects.join(', '));
    }
    if (Array.isArray(chapterBlueprintContext.required_terms) && chapterBlueprintContext.required_terms.length > 0) {
      whitelistLines.push('Thuật ngữ nên bám sát: ' + chapterBlueprintContext.required_terms.join(', '));
    }
    if (whitelistLines.length > 0) {
      whitelistLines.push('Chỉ được dùng entity ngoài danh sách nếu summary chương hoặc canon đang có bắt buộc phải gọi tới.');
      whitelistLines.push('Không tự ý thêm nhân vật, địa điểm, vật phẩm, thế lực, hay thuật ngữ mới nếu chapter blueprint và canon chưa cho phép rõ ràng.');
      parts.push('[WHITELIST CHO CHƯƠNG NÀY - ƯU TIÊN DÙNG ĐÚNG ENTITY ĐÃ ĐƯỢC CHỈ ĐỊNH]\n' + whitelistLines.join('\n'));
    }
  }

  if (upcomingChapters && upcomingChapters.length > 0) {
    const fence = upcomingChapters
      .map(function (c, i) {
        return '- Chương tiếp theo ' + (i + 1) + ': "' + c.title + '"' + (c.summary ? ' - ' + c.summary : '');
      })
      .join('\n');
    parts.push('[CÁC CHƯƠNG TIẾP THEO - TUYỆT ĐỐI KHÔNG VIẾT TRƯỚC NỘI DUNG NÀY]\n' + fence);
  }

  if (parts.length === 0) return '';
  return '\n[DÀN Ý TRUYỆN]\n' + parts.join('\n\n');
}

export function buildPreWriteValidationLayer(taskType, preWriteValidation) {
  if (!WRITING_TASKS_FOR_BRIDGE.has(taskType)) return '';
  if (!preWriteValidation || typeof preWriteValidation !== 'object') return '';

  const blockingIssues = Array.isArray(preWriteValidation.blockingIssues)
    ? preWriteValidation.blockingIssues.filter(Boolean)
    : [];
  const warnings = Array.isArray(preWriteValidation.warnings)
    ? preWriteValidation.warnings.filter(Boolean)
    : [];

  if (blockingIssues.length === 0 && warnings.length === 0) {
    return '';
  }

  const parts = [];
  if (blockingIssues.length > 0) {
    parts.push('Lỗi chặn trước khi viết:\n' + blockingIssues.map(function (issue) {
      return '- ' + issue.message;
    }).join('\n'));
  }
  if (warnings.length > 0) {
    parts.push('Cảnh báo anti-hallucination:\n' + warnings.map(function (issue) {
      return '- ' + issue.message;
    }).join('\n'));
  }

  return '\n[KIỂM TRA TRƯỚC KHI VIẾT]\n' + parts.join('\n\n');
}

export function formatChapterBriefList(briefs, options) {
  const list = Array.isArray(briefs) ? briefs.filter(Boolean) : [];
  if (list.length === 0) return '';
  const limit = options?.limit || list.length;
  const header = options?.header || '';
  const lines = list.slice(-limit).map(function (item, index) {
    const chapterNumber = Number.isFinite(Number(item.chapterNumber))
      ? Number(item.chapterNumber)
      : index + 1;
    const title = item.title || ('Chương ' + chapterNumber);
    const summary = item.summary || item.purpose || '(chưa có tóm tắt)';
    return chapterNumber + '. ' + title + ' - ' + summary;
  });
  return header ? header + '\n' + lines.join('\n') : lines.join('\n');
}

export function formatStoryProgressBudget(storyProgressBudget) {
  if (!storyProgressBudget) return '';
  const parts = [];
  if (Number.isFinite(Number(storyProgressBudget.currentChapterCount))) {
    parts.push('Số chương đã có hiện tại: ' + storyProgressBudget.currentChapterCount);
  }
  if (Number.isFinite(Number(storyProgressBudget.batchStartChapter)) && Number.isFinite(Number(storyProgressBudget.batchEndChapter))) {
    parts.push('Đợt này tạo từ Chương ' + storyProgressBudget.batchStartChapter + ' đến Chương ' + storyProgressBudget.batchEndChapter);
  }
  if (Number.isFinite(Number(storyProgressBudget.fromPercent)) && Number.isFinite(Number(storyProgressBudget.toPercent))) {
    parts.push('Phạm vi tiến độ batch này: ' + storyProgressBudget.fromPercent + '% -> ' + storyProgressBudget.toPercent + '%');
  }
  if (storyProgressBudget.mainPlotMaxStep != null) {
    parts.push('Main plot progress tối đa: +' + storyProgressBudget.mainPlotMaxStep + ' nấc');
  }
  if (storyProgressBudget.romanceMaxStep != null) {
    parts.push('Romance progress tối đa: +' + storyProgressBudget.romanceMaxStep + ' nấc');
  }
  if (storyProgressBudget.mysteryRevealAllowance) {
    parts.push('Mức độ reveal bí ẩn: ' + storyProgressBudget.mysteryRevealAllowance);
  }
  if (storyProgressBudget.powerProgressionCap) {
    parts.push('Giới hạn power progression: ' + storyProgressBudget.powerProgressionCap);
  }
  if (storyProgressBudget.requiredBeatMix) {
    parts.push('Beat mix bắt buộc: ' + storyProgressBudget.requiredBeatMix);
  }
  if (storyProgressBudget.remainingInMacro != null) {
    parts.push('Số chương còn lại trước khi kết thúc macro arc: ' + storyProgressBudget.remainingInMacro);
  }
  if (Number.isFinite(Number(storyProgressBudget.macroStartChapter)) && Number.isFinite(Number(storyProgressBudget.macroEndChapter)) && Number(storyProgressBudget.macroEndChapter) > 0) {
    parts.push('Phạm vi macro arc đang khóa: Chương ' + storyProgressBudget.macroStartChapter + ' -> Chương ' + storyProgressBudget.macroEndChapter);
  }
  if (Number.isFinite(Number(storyProgressBudget.batchMacroOverlapCount)) && Number(storyProgressBudget.batchMacroOverlapCount) > 0) {
    parts.push('Batch này đi qua ' + storyProgressBudget.batchMacroOverlapCount + '/' + storyProgressBudget.macroSpan + ' chương của macro arc (' + storyProgressBudget.macroCoveragePercent + '%)');
  }
  if (storyProgressBudget.chaptersRemainingAfterBatchInMacro != null) {
    parts.push('Sau batch này vẫn còn ' + storyProgressBudget.chaptersRemainingAfterBatchInMacro + ' chương nữa mới tới cuối macro arc');
  }
  if (storyProgressBudget.macroProgressCap) {
    parts.push('Giới hạn riêng của macro arc: ' + storyProgressBudget.macroProgressCap);
  }
  if (storyProgressBudget.nextMilestone?.label || storyProgressBudget.nextMilestone?.title) {
    const label = storyProgressBudget.nextMilestone.label || storyProgressBudget.nextMilestone.title;
    const percent = storyProgressBudget.nextMilestone.percent != null ? ' (' + storyProgressBudget.nextMilestone.percent + '%)' : '';
    parts.push('Cột mốc tiếp theo: ' + label + percent);
  }
  return parts.join('\n');
}

export function buildMacroArcContractLayer(taskType, macroArcContract) {
  if (!macroArcContract) return '';
  if (![TASK_TYPES.ARC_OUTLINE, TASK_TYPES.ARC_CHAPTER_DRAFT, TASK_TYPES.OUTLINE].includes(taskType)) {
    return '';
  }
  return formatMacroArcContract(macroArcContract, {
    header: '[HỢP ĐỒNG ĐẠI CỤC BẮT BUỘC]',
  });
}

const OUTLINE_PROGRESS_STOPWORDS = new Set([
  'va', 'voi', 'cua', 'cho', 'khi', 'sau', 'truoc', 'trong', 'tren', 'duoi',
  'mot', 'nhung', 'cac', 'nay', 'kia', 'roi', 'da', 'se', 'dang', 'la',
  'bi', 'duoc', 'tu', 'den', 'hay', 'neu', 'thi', 'ma', 'tai', 'nhan', 'vat',
  'chuong', 'canh', 'beat', 'plot', 'thread', 'noi', 'dung',
]);

function normalizePlanningText(value = '') {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractPlanningKeywords(value = '') {
  const normalized = normalizePlanningText(value);
  if (!normalized) return [];
  return normalized
    .split(' ')
    .filter((word) => word.length >= 3 && !OUTLINE_PROGRESS_STOPWORDS.has(word))
    .filter((word, index, array) => array.indexOf(word) === index);
}

function classifyOutlineBeatCoverage(beatText, chapterText) {
  const normalizedBeat = normalizePlanningText(beatText);
  const normalizedChapter = normalizePlanningText(chapterText);

  if (!normalizedBeat || !normalizedChapter) {
    return { status: 'pending', matchedKeywords: [] };
  }

  if (normalizedBeat.length >= 12 && normalizedChapter.includes(normalizedBeat)) {
    return { status: 'covered', matchedKeywords: [] };
  }

  const keywords = extractPlanningKeywords(beatText).slice(0, 8);
  const matchedKeywords = keywords.filter((keyword) => normalizedChapter.includes(keyword));

  if (matchedKeywords.length >= Math.min(3, Math.max(2, Math.ceil(keywords.length * 0.5)))) {
    return { status: 'covered', matchedKeywords };
  }

  if (matchedKeywords.length >= 2 || (matchedKeywords.length === 1 && keywords.length === 1)) {
    return { status: 'maybe', matchedKeywords };
  }

  return { status: 'pending', matchedKeywords };
}

export function buildSingleChapterOutlineBudget({
  targetLength = 0,
  currentChapterIndex = 0,
  currentMacroArc = null,
  milestones = [],
}) {
  const safeTarget = Number(targetLength) || 0;
  if (safeTarget <= 0) return null;

  const currentCount = Math.max(0, Number(currentChapterIndex) || 0);
  const currentChapterNumber = currentCount + 1;
  const fromPercent = Number(((currentCount / safeTarget) * 100).toFixed(1));
  const toPercent = Number((((currentCount + 1) / safeTarget) * 100).toFixed(1));
  const nextMilestone = Array.isArray(milestones)
    ? milestones.find((item) => Number(item?.percent) > toPercent) || null
    : null;
  const remainingInMacro = currentMacroArc?.chapter_to
    ? Math.max(0, Number(currentMacroArc.chapter_to) - currentChapterNumber)
    : null;

  return {
    fromPercent,
    toPercent,
    currentChapterCount: currentCount,
    targetLength: safeTarget,
    batchCount: 1,
    mainPlotMaxStep: 1,
    romanceMaxStep: 1,
    mysteryRevealAllowance: nextMilestone && Number(nextMilestone.percent) - toPercent > 5
      ? '0-1 minor reveal'
      : '1 minor reveal',
    powerProgressionCap: remainingInMacro != null && remainingInMacro > 0
      ? 'không vượt tier lớn trong chương này'
      : 'có thể nhích nhẹ nếu đây là chương sát cột mốc',
    requiredBeatMix: 'ưu tiên buildup / consequence / setup nếu cột mốc lớn còn xa',
    nextMilestone,
    remainingInMacro,
  };
}

export function buildOutlinePlannerLayer(
  taskType,
  currentChapterOutline,
  chapterText,
  chapterSceneCount,
  storyProgressBudget,
  targetLength,
  currentChapterIndex,
  currentMacroArc,
  milestones
) {
  if (taskType !== TASK_TYPES.OUTLINE) return '';

  const parts = [];
  const effectiveBudget = storyProgressBudget || buildSingleChapterOutlineBudget({
    targetLength,
    currentChapterIndex,
    currentMacroArc,
    milestones,
  });
  const budgetText = formatStoryProgressBudget(effectiveBudget);

  if (budgetText) {
    parts.push('[STORY PROGRESS BUDGET - CHƯƠNG NÀY]\n' + budgetText);
  }

  if (chapterText || Number.isFinite(Number(chapterSceneCount))) {
    const chapterLines = [];
    chapterLines.push('Số cảnh đang có trong chương: ' + (Number(chapterSceneCount) || 0));
    chapterLines.push(chapterText
      ? 'Chương hiện tại đã có văn bản. Hãy ưu tiên đối chiếu beat đã viết trước khi đề xuất beat mới.'
      : 'Chương hiện tại chưa có văn bản. Nếu đã có dàn ý, hãy xuất phát từ dàn ý đó; nếu chưa có dàn ý, mới lập dàn ý cho chính chương này.');
    parts.push('[TRẠNG THÁI CHƯƠNG HIỆN TẠI]\n' + chapterLines.join('\n'));
  }

  if (currentChapterOutline?.keyEvents?.length > 0) {
    const coverageLines = currentChapterOutline.keyEvents.map((eventText) => {
      const coverage = classifyOutlineBeatCoverage(eventText, chapterText);
      const matched = coverage.matchedKeywords.length > 0
        ? ' | từ khóa trùng: ' + coverage.matchedKeywords.join(', ')
        : '';
      const statusLabel = coverage.status === 'covered'
        ? 'có khả năng đã viết'
        : coverage.status === 'maybe'
          ? 'có tín hiệu một phần'
          : 'chưa thấy dấu hiệu rõ';
      return '- ' + statusLabel + ': ' + eventText + matched;
    });

    parts.push(
      '[ĐỐI CHIẾU DÀN Ý VÀ NỘI DUNG ĐÃ VIẾT - HEURISTIC, CHỈ DÙNG ĐỂ ĐỐI CHIẾU]\n'
      + coverageLines.join('\n')
    );
  }

  if (parts.length === 0) return '';
  return '\n[OUTLINE GUARDRAILS]\n' + parts.join('\n\n');
}

export function formatMacroMilestoneList(milestones) {
  const list = Array.isArray(milestones) ? milestones.filter(Boolean) : [];
  if (list.length === 0) return '';
  return list.map(function (item, index) {
    const number = Number.isFinite(Number(item?.order)) ? Number(item.order) : index + 1;
    const chapterRange = item?.chapter_from || item?.chapter_to
      ? ' [Ch.' + (item?.chapter_from || '?') + '-' + (item?.chapter_to || '?') + ']'
      : '';
    const emotional = item?.emotional_peak ? '\nCảm xúc đích: ' + item.emotional_peak : '';
    const contract = compileMacroArcContract(item);
    const contractBits = [];
    if (contract?.objectives?.length > 0) {
      contractBits.push('Objectives: ' + contract.objectives.map(function (objective) { return objective.id + ' ' + objective.text; }).join(' | '));
    }
    if (contract?.targetStates?.length > 0) {
      contractBits.push('Target states: ' + contract.targetStates.map(function (state) { return state.character + ' (' + state.state + ')'; }).join(' | '));
    }
    if (contract?.forbiddenOutcomes?.length > 0) {
      contractBits.push('Forbidden: ' + contract.forbiddenOutcomes.join(' | '));
    }
    if (contract?.chapterAnchors?.length > 0) {
      contractBits.push('Chapter anchors: ' + contract.chapterAnchors.map(function (anchor) {
        return anchor.id + ' @Ch.' + anchor.targetChapter + ' [' + (anchor.strictness || 'hard') + '] ' + anchor.requirementText;
      }).join(' | '));
    }
    const contractText = contractBits.length > 0 ? '\nContract: ' + contractBits.join('\n') : '';
    return number + '. ' + (item?.title || 'Cột mốc') + chapterRange + '\nMô tả: ' + (item?.description || '') + emotional + contractText;
  }).join('\n\n');
}

// =============================================
// Layer 5.5: Bridge Memory (Phase 7)
// =============================================

/**
 * Build Layer 5.5 Bridge Memory block.
 * Return an empty string when there is no data or the task is not a writing task.
 */
export function buildBridgeMemoryLayer(taskType, bridgeBuffer, emotionalState, tensionLevel) {
  if (!WRITING_TASKS_FOR_BRIDGE.has(taskType)) return '';
  if (!bridgeBuffer && !emotionalState) return '';

  const parts = [];

  if (bridgeBuffer) {
    parts.push(
      'Đoạn văn kết thúc chương trước (viết tiếp TỪ ĐÂY, KHÔNG lặp lại, KHÔNG mở đầu lại từ đầu):\n' +
      '"""\n' + bridgeBuffer + '\n"""'
    );
  }

  if (emotionalState) {
    const stateParts = [];
    if (emotionalState.mood) stateParts.push('Trạng thái cảm xúc: ' + emotionalState.mood);
    if (emotionalState.activeConflict) stateParts.push('Xung đột đang mở: ' + emotionalState.activeConflict);
    if (emotionalState.lastAction) stateParts.push('Hành động cuối: ' + emotionalState.lastAction);
    if (tensionLevel != null) stateParts.push('Mức độ căng thẳng: ' + tensionLevel + '/10');
    if (stateParts.length > 0) {
      parts.push('Trạng thái nhân vật khi kết thúc chương trước:\n' + stateParts.join('\n'));
    }
  }

  if (parts.length === 0) return '';

  return '\n[ĐIỂM NỐI MẠCH TRUYỆN - BẮT BUỘC ĐỌC TRƯỚC KHI VIẾT]\n' + parts.join('\n\n');
}


// =============================================
// Layer 0.5: Author DNA
//
// Inject before System Identity so the AI internalizes author role first.
//
// - FULL_WRITING tasks: full role + philosophy + emotional goals.
// - STYLE_ONLY tasks: role + philosophy only, without changing story direction.
// =============================================

/**
 * Pick the author role by chapter stage.
 */
function getAuthorRole(writingStyle, chapterIndex, targetLength) {
  const roles = AUTHOR_ROLE_TABLE[writingStyle] || AUTHOR_ROLE_TABLE['thuan_viet'];
  const pct = targetLength > 0 ? (chapterIndex / targetLength) * 100 : 50;
  if (pct <= 20) return roles[0];
  if (pct <= 70) return roles[1];
  if (pct <= 90) return roles[2];
  return roles[3];
}

/**
 * Build Layer 0.5 - Author DNA.
 * @param {string} taskType
 * @param {string} writingStyle - 'han_viet' | 'thuan_viet'
 * @param {number} chapterIndex
 * @param {number} targetLength
 * @param {object|null} currentChapterOutline
 * @param {object|null} currentMacroArc
 * @returns {string}
 */
export function buildAuthorDNALayer(taskType, writingStyle, chapterIndex, targetLength, currentChapterOutline, currentMacroArc) {
  const isFullWriting = FULL_WRITING_TASKS.has(taskType);
  const isStyleOnly = STYLE_ONLY_TASKS.has(taskType);
  if (!isFullWriting && !isStyleOnly) return '';

  const role = getAuthorRole(writingStyle || 'thuan_viet', chapterIndex, targetLength);
  const lines = [];

  lines.push('[LINH HỒN TÁC GIẢ]');
  lines.push('');
  lines.push('VAI TRÒ CỦA BẠN: Bạn là ' + role + '.');
  lines.push('');
  lines.push('TRIẾT LÝ VIẾT (BẮT BUỘC INTERNALIZE):');
  lines.push('1. Viết bằng cảm xúc, không phải thông tin.');
  lines.push('   SAI: "Cảnh giới hắn đột phá lên Trúc Cơ kỳ."');
  lines.push('   ĐÚNG: "Linh hải trong người hắn bỗng nhiên vỡ vụn - rồi tái sinh, mãnh liệt hơn gấp bội."');
  lines.push('2. Mỗi cảnh PHẢI thay đổi trạng thái nhân vật. Trước cảnh: nhân vật muốn/sợ/nghĩ gì? Sau cảnh: còn nguyên vẹn không?');
  lines.push('3. Độc giả CẢM trước, HIỂU sau. Không bao giờ giải thích trước khi để độc giả trải nghiệm.');
  lines.push('4. Mỗi câu phải "làm một việc": mô tả, đẩy chuyển, tiết lộ, HOẶC gây cảm xúc. Câu không làm được gì thì cắt.');

    // Only add emotional goals for FULL_WRITING tasks.
  if (isFullWriting) {
    lines.push('');
    lines.push('MỤC TIÊU CẢM XÚC CHƯƠNG NÀY:');

    const hookEmotion = currentChapterOutline?.summary
      ? 'Cuốn hút độc giả ngay lập tức qua: ' + currentChapterOutline.summary.substring(0, 80)
      : 'Tạo hook mạnh mẽ ngay dòng đầu tiên - độc giả phải muốn đọc tiếp';
    const peakEmotion = currentMacroArc?.emotional_peak
      ? currentMacroArc.emotional_peak
      : 'Đẩy lên mức cảm xúc cao nhất có thể trong cảnh này';
    const cliffhanger = 'Để lại ít nhất một câu hỏi chưa được trả lời - độc giả phải muốn sang chương sau';

    lines.push('- ĐẦU CHƯƠNG (hook): ' + hookEmotion);
    lines.push('- ĐỈNH ĐIỂM (peak): ' + peakEmotion);
    lines.push('- CUỐI CHƯƠNG (cliffhanger): ' + cliffhanger);
  } else {
    // STYLE_ONLY: remind the model not to alter story direction.
    lines.push('');
    lines.push('LƯU Ý QUAN TRỌNG (STYLE_ONLY MODE):');
    lines.push('Bạn đang làm việc với text ĐÃ CÓ SẴN. KHÔNG được thay đổi hướng cảm xúc hay cốt truyện.');
    lines.push('Chỉ nâng cấp văn phong, nhịp điệu, từ ngữ theo Style DNA bên dưới.');
  }

  return lines.join('\n');
}

// =============================================
// Layer 7: Style DNA
//
// Replaces the old "Style Pack" placeholder.
// Han-Viet and Thuan-Viet are intentionally different styles.
// Inject for all writing tasks (FULL + STYLE_ONLY).
// =============================================

/**
 * Build Layer 7 - Style DNA.
 * @param {string} taskType
 * @param {string} writingStyle - 'han_viet' | 'thuan_viet'
 * @returns {string}
 */
export function buildStyleDNALayer(taskType, writingStyle) {
  if (!WRITING_TASKS_FOR_BRIDGE.has(taskType)) return '';

  if (writingStyle === 'han_viet') {
    return `
[VĂN PHONG DNA - HÁN VIỆT / SANGTACVIET STYLE]

1. TỪ ĐIỂN BẮT BUỘC DÙNG - KHÔNG ĐƯỢC THUẦN VIỆT HÓA:
Xưng hô: ngươi, hắn, nàng, lão, tiểu tử, đạo hữu, huynh, đệ, tỷ, muội, lão phu
Trạng thái: bàng bạc, lãnh mang, thâm thúy, u ám, hung hồn, kinh người, uy áp
Hành động: thi triển, vận chuyển, đột phá, ngưng kết, tán loạn, thu liễm, tung hoành
Tu luyện: linh khí, đan điền, kinh mạch, cảnh giới, thiên tư, linh hải, thiên hỏa
Cảm thán: vạn phần, thiên hạ vô địch, kinh thiên động địa, khủng bố, bất khả tư nghị
Cảm xúc: lạnh nhạt bàng quan, khẽ nhếch môi, ánh mắt bén như kiếm

2. CẤU TRÚC CÂU ĐẶC TRƯNG (ĐẢO NGỮ TRUNG QUỐC):
ĐÚNG: "Hắn ánh mắt bên trong lóe lên một tia lãnh mang."
SAI:  "Trong mắt hắn lóe lên ánh nhìn lạnh lẽo."
ĐÚNG: "Linh khí bàng bạc, hắn ngồi kết già, tâm thần sắc bén như kiếm."
SAI:  "Hắn ngồi kết già, linh khí tỏa ra và tâm thần rất sắc bén."
ĐÚNG: "Đạo hữu này... thực sự khiến lão kinh sợ."
SAI:  "Người này thực sự khiến ông ta sợ hãi."

3. NHỊP ĐIỆU THEO TÌNH HUỐNG:
Hành động nhanh: câu 5-8 chữ, liên tiếp, mỗi câu = 1 hành động rõ ràng.
  VD: "Hắn xuất thủ. Kiếm quang lóe lên. Địch nhân chưa kịp phản ứng."
Cảm xúc / nội tâm: câu dài, nhiều mệnh đề, chậm rãi suy tư.
  VD: "Hắn đứng đó, nhìn vào hư không mà trong lòng lại dấy lên một cảm giác kỳ lạ..."
Cao trào CÔNG THỨC: 3 câu ngắn + 1 câu dài bùng nổ.
  VD: "Linh khí rung chuyển. Đại địa run rẩy. Không gian méo mó. Và rồi - trong tiếng gào thét kinh thiên của thiên địa, cảnh giới hắn vỡ toang!"

4. CÔNG THỨC SÁNG ĐIỂM (BẮT BUỘC NẮM VỮNG):
Vả mặt (humiliation -> reversal):
  Setup: kẻ địch kiêu ngạo + công khai sỉ nhục trước đám đông.
  Twist: nhân vật chính tiết lộ bí ẩn / sức mạnh thật sự.
  Payoff: 1 câu thoại ngắn, lạnh, chính xác đến tàn nhẫn.
  Phản ứng: đám đông kinh ngạc -> im lặng -> xôn xao.
Đột phá cảnh giới:
  Giai đoạn 1: cơ thể đau đớn / linh hải sắp vỡ.
  Giai đoạn 2: điểm bùng vỡ - mô tả vật lý cực kỳ chi tiết.
  Giai đoạn 3: sự yên tĩnh sau bão - nhân vật nhận ra mình đã khác.
Tiết lộ bí mật: để độc giả nhận ra TRƯỚC nhân vật (dramatic irony) HOẶC cùng lúc (shock).

5. CẤM KỴ TUYỆT ĐỐI:
- KHÔNG giải thích hệ thống như người dẫn truyện: "Trúc Cơ kỳ là cảnh giới thứ 2..."
- KHÔNG để nhân vật bình thản trước điều phi thường
- KHÔNG kết thúc cảnh mà không có hệ quả cảm xúc
- KHÔNG dùng ngoặc đơn () trừ màu sắc phẩm cấp: (lục), (lam), (tử), (hoàng), (xích), (chánh), (hắc), (bạch), (thải sắc)
- KHÔNG viết "Hắn nghĩ:" - thay bằng gián tiếp nội tâm`;
  }

  // Thuan Viet
  return `
[VĂN PHONG DNA - THUẦN VIỆT]

1. NGUYÊN TẮC GỐC:
Mọi thứ phải nghe như người Việt thực sự nghĩ và cảm.
Không cứng nhắc, không dịch máy, không Hán hóa.
Từ nào người bình thường không nói thì thay bằng từ tự nhiên hơn.

2. NHỊP ĐIỆU VÀ CẤU TRÚC:
Hành động: câu ngắn, động từ mạnh, KHÔNG trạng từ thừa.
  ĐÚNG: "Anh chạy. Tim đập loạn. Hơi thở cạn."
  SAI:  "Anh vô cùng vội và chạy rất nhanh."
Nội tâm: câu dài hơn, chảy tự nhiên như dòng ý thức.
  ĐÚNG: "Cô không hiểu tại sao mình lại dừng lại ở đây - chỉ biết rằng nếu bước thêm một bước nữa, có điều gì đó sẽ vĩnh viễn thay đổi."
Đối thoại: ngắn, thật, có tính cách từng người - không ai nói dài hơn 2 câu nếu không cần.

3. MÔI TRƯỜNG VÀ GIÁC QUAN:
Mô tả = 5 giác quan, KHÔNG phải bức tranh.
Mùi, âm thanh, kết cấu, nhiệt độ TRƯỚC vẻ ngoài.
  ĐÚNG: "Không khí ẩm và tanh của mưa sắp đến"
  SAI:  "Bầu trời xám xịt"
Chi tiết cụ thể > tổng quát:
  ĐÚNG: "Cái bàn gỗ sờn bóng tróc sơn ở góc trái"
  SAI:  "Căn phòng cũ kỹ"

4. XỬ LÝ CẢM XÚC:
KHÔNG bao giờ viết cảm xúc trực tiếp: "Cô rất buồn."
THAY BẰNG hành động thể hiện cảm xúc:
  "Cô ngồi xuống sàn. Không khóc. Chỉ nhìn vào bức tường trắng cho đến khi mắt mờ đi."
Cung bậc cảm xúc = thay đổi vật lý: nhịp thở, nhiệt độ, trọng lượng cơ thể.

5. CẤM KỴ:
- KHÔNG dùng: ngươi, hắn (→ anh ấy, ông ta, y, gã...), nàng (→ cô ấy, chị ấy)
- KHÔNG cấu trúc đảo ngữ kiểu Trung Quốc
- KHÔNG kết thúc cảnh bằng tổng kết như người kể chuyện
- KHÔNG miêu tả cảm xúc bằng tính từ: "buồn", "vui", "sợ" - chỉ hành động`;
}

/**
 * Pick random N entries from an array (partial Fisher-Yates shuffle).
 * Does not mutate the source array.
 */
function pickRandom(arr, n) {
  if (!arr || arr.length === 0) return [];
  const copy = arr.slice();
  const count = Math.min(n, copy.length);
  for (let i = copy.length - 1; i > copy.length - 1 - count && i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(-count);
}

/**
 * Build Anti-AI Blacklist block.
 * Randomly pick 12 entries from the pool (style-specific + common).
 * Keeps the prompt fresh so the model does not overfit one fixed list.
 */
export function buildAntiAIBlock(writingStyle) {
  const styleEntries = ANTI_AI_BLACKLIST[writingStyle] || ANTI_AI_BLACKLIST.thuan_viet;
  const commonEntries = ANTI_AI_BLACKLIST.common || [];
  const pool = [...styleEntries, ...commonEntries];
  const picked = pickRandom(pool, 12);
  if (picked.length === 0) return '';

  const lines = ['\n[CHỐNG VĂN PHONG AI - TỪ/CỤM CẤM DÙNG]'];
  lines.push('Các cụm từ sau là DẤU HIỆU AI - KHÔNG ĐƯỢC DÙNG:');
  picked.forEach(e => lines.push('  X "' + e.bad + '"  ->  V ' + e.good));
  lines.push('Nếu thấy mình sắp viết bất kỳ cụm nào ở trên thì dừng lại, viết cách khác.');
  return lines.join('\n');
}

// =============================================
// Layer 7.5: Mood Board
//
// Inject 2-3 sample sentences that capture the target voice.
// Priority: best sentences from the author's bridgeBuffer, then genre defaults.
// =============================================

/**
 * Extract the best rhythm samples from the buffer.
 * Scoring favors punctuation rhythm over raw sentence length.
 */
function extractMoodSamples(text, maxSamples) {
  if (!text || text.length < 30) return [];
  var sentences = text
    .replace(/<[^>]*>/g, ' ')
    .split(/(?<=[.!?…])\s+/)
    .map(function(s) { return s.trim(); })
    .filter(function(s) { return s.length > 30 && s.length < 300; });

  if (sentences.length === 0) return [];

  // Multi-factor scoring: rhythm > length
  var scored = sentences.map(function(s) {
    var score = 0;
    // Punctuation diversity = rhythm complexity (commas, dashes, semicolons)
    var punctCount = (s.match(/[,;:\u2014\u2013\u2026]/g) || []).length;
    score += punctCount * 15;
    // Moderate length is ideal (80-200 chars)
    if (s.length >= 80 && s.length <= 200) score += 20;
    else if (s.length > 200) score += 5;
    else score += 2;
    // Penalize dialogue starts; dialogue is usually a weak mood sample.
    if (/^[\u201C\u201D"'\u2018\u2019\u00AB\u00BB\u2015\u2014\u2013-]/.test(s)) score -= 30;
    // Penalize very short sentences (likely stage directions)
    if (s.length < 50) score -= 10;
    // Bonus for sensory/emotional words (Vietnamese)
    var sensory = ['nghe', 'nhin', 'mui', 'nong', 'lanh', 'am', 'toi', 'sang', 'run', 'dau', 'tho'];
    sensory.forEach(function(w) { if (s.toLowerCase().includes(w)) score += 5; });
    return { text: s, score: score };
  });

  return scored
    .sort(function(a, b) { return b.score - a.score; })
    .slice(0, maxSamples)
    .map(function(item) { return item.text; });
}

/**
 * Build Layer 7.5 - Mood Board.
 * @param {string} taskType
 * @param {string} genreKey
 * @param {string} bridgeBuffer - prose carried from the previous chapter
 * @param {string} selectedText - selected text for EXPAND/REWRITE
 * @returns {string}
 */
export function buildMoodBoardLayer(taskType, genreKey, bridgeBuffer, selectedText) {
  if (!WRITING_TASKS_FOR_BRIDGE.has(taskType)) return '';

  const sourceText = FULL_WRITING_TASKS.has(taskType)
    ? bridgeBuffer
    : (selectedText || bridgeBuffer); // EXPAND/REWRITE uses the active text block.

  const authorSamples = extractMoodSamples(sourceText, 2);
  const defaultSamples = (MOOD_BOARD_DEFAULTS[genreKey] || MOOD_BOARD_DEFAULTS['do_thi'] || []).slice(0, 2);

  // Prefer author-written sentences first, then fallback defaults.
  // If sourceText exists but is too weak, do not inject defaults and skew the tone.
  const samples = authorSamples.length >= 1
    ? authorSamples.slice(0, 2)
    : ((!sourceText || sourceText.trim() === '') ? defaultSamples : []);

  if (samples.length === 0) return '';

  const lines = ['[MẪU VĂN PHONG - ĐỌC VÀ CẢM NHẬN TRƯỚC KHI VIẾT]'];
  lines.push('Đây là giọng văn và nhịp điệu cần đạt - học phong cách, KHÔNG copy từ ngữ:');
  lines.push('');
  samples.forEach(s => lines.push('- "' + s.replace(/"/g, '\"') + '"'));
  lines.push('');
  lines.push('Viết theo CẢM GIÁC này. Không copy từ ngữ, chỉ cần nhịp điệu tương tự.');
  return lines.join('\n');
}

// =============================================
// Layer 9: Priority Anchor (Double Sandwich)
//
// Put this at the end of userContent so the prompt is anchored at both ends.
// Grand Strategy at the top + Priority Anchor at the end = double anchor.
//
// FULL uses a self-check checklist.
// STYLE reminds the model not to alter content.
// =============================================

/**
 * Build Layer 9 - Priority Anchor.
 * Appends to the end of userContent, not systemParts.
 * @param {string} taskType
 * @param {string} userPrompt
 * @returns {string}
 */
export function buildPriorityAnchorLayer(taskType, userPrompt) {
  if (!WRITING_TASKS_FOR_BRIDGE.has(taskType)) return '';

  const instruction = (userPrompt || '').trim();
  const isFullWriting = FULL_WRITING_TASKS.has(taskType);

  const lines = ['---'];
  lines.push('[NHIỆM VỤ TỐI THƯỢNG - ƯU TIÊN CAO NHẤT]');

  if (instruction) {
    lines.push('>>> ' + instruction + ' <<<');
  } else {
    lines.push(isFullWriting
      ? '>>> Viết tiếp từ điểm này, giữ nguyên mạch truyện và đẩy mạnh cảm xúc <<< '
      : '>>> Nâng cấp văn phong theo Style DNA, giữ nguyên nội dung và cảm xúc gốc <<<');
  }

  if (isFullWriting) {
    lines.push('');
    lines.push('ĐẢM BẢO 3 ĐIỀU SAU THỂ HIỆN RÕ TRONG BÀI VIẾT:');
    lines.push('- Dòng đầu tiên phải tạo cảm xúc mạnh, cuốn độc giả vào ngay lập tức.');
    lines.push('- Nhân vật chính phải THAY ĐỔI qua cảnh này (cảm xúc, nhận thức, hoặc vị thế).');
    lines.push('- Cuối cảnh để lại tình huống mở hoặc câu hỏi khiến độc giả muốn sang chương tiếp.');
    lines.push('');
    lines.push('CỤ THỂ HÓA - KHÔNG VIẾT TRỪU TƯỢNG:');
    lines.push('- Thời gian: KHÔNG "gần đây", "lâu lắm" -> viết "3 ngày trước", "nửa tháng", "từ sáng đến giờ"');
    lines.push('- Số lượng: KHÔNG "nhiều người" -> viết "năm ba người", "cả trăm kẻ", "vài chục tên"');
    lines.push('- Cảm giác: KHÔNG "rất đau", "vô cùng lo lắng" -> viết hành động: "hắn cong người lại", "tay nắm chặt đến trắng bệch"');
    lines.push('- Cảnh vật: KHÔNG "căn phòng rất lớn" -> viết 1 chi tiết: "trần nhà cao gấp 3 lần người đứng", "vách đá ẩm ẩm nước"');
  } else {
    // EXPAND / REWRITE
    lines.push('');
    lines.push('Giữ nguyên sự kiện, hướng đi, và cảm xúc gốc của đoạn văn.');
    lines.push('Chỉ nâng cấp: nhịp điệu câu, từ ngữ, cấu trúc theo Style DNA đã cho.');
  }

  return lines.join('\n');
}
