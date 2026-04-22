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
    progressLines.push('Truyen du kien dai ' + targetLength + ' chuong. Hien tai: chuong ' + (currentChapterIndex + 1) + ' (' + progressPercent + '%).');
    if (milestones && milestones.length > 0) {
      var nextMs = milestones.find(function(m) { return m.percent > progressPercent; });
      if (nextMs) {
        progressLines.push('Cot moc ke tiep (' + nextMs.percent + '%): "' + nextMs.description + '".');
      }
    }
    parts.push('[TIEN DO]\n' + progressLines.join('\n'));
  }

  // Macro Arc
  if (currentMacroArc) {
    var macroLines = [];
    macroLines.push('Cot moc lon hien tai: ' + currentMacroArc.title);
    if (currentMacroArc.description) {
      macroLines.push('Mo ta: ' + currentMacroArc.description);
    }
    if (currentMacroArc.chapter_from && currentMacroArc.chapter_to) {
      macroLines.push('Pham vi: Chuong ' + currentMacroArc.chapter_from + ' den Chuong ' + currentMacroArc.chapter_to);
    }
    if (currentMacroArc.emotional_peak) {
      macroLines.push('Cam xuc can dat khi ket thuc: ' + currentMacroArc.emotional_peak);
    }
    parts.push('[COT MOC LON]\n' + macroLines.join('\n'));
  }

  // Arc
  if (currentArc) {
    var arcLines = [];
    arcLines.push('Hoi truyen hien tai: ' + (currentArc.title || '(chua dat ten)'));
    if (currentArc.goal) {
      arcLines.push('Muc tieu hoi nay: ' + currentArc.goal);
    }
    if (currentArc.chapter_start && currentArc.chapter_end) {
      arcLines.push('Pham vi: Chuong ' + currentArc.chapter_start + ' den Chuong ' + currentArc.chapter_end);
    }
    if (currentArc.power_level_start || currentArc.power_level_end) {
      arcLines.push('Cap do suc manh: ' + (currentArc.power_level_start || '?') + ' \u2192 ' + (currentArc.power_level_end || '?'));
    }
    parts.push('[HOI TRUYEN HIEN TAI]\n' + arcLines.join('\n'));
  }

  // Unified constraints (single source of truth - no duplication)
  var constraints = [];
  if (currentMacroArc && currentMacroArc.chapter_to && targetLength > 0) {
    var remainingInMacro = currentMacroArc.chapter_to - (currentChapterIndex + 1);
    if (remainingInMacro > 0) {
      constraints.push('Con ' + remainingInMacro + ' chuong nua moi ket thuc cot moc "' + currentMacroArc.title + '".');
    }
  }
  if (currentArc && currentArc.chapter_end) {
    var remainingInArc = currentArc.chapter_end - (currentChapterIndex + 1);
    if (remainingInArc > 0) {
      constraints.push('Con ' + remainingInArc + ' chuong nua moi ket thuc hoi nay.');
    }
  }
  if (ultimateGoal) {
    constraints.push('Muc tieu cuoi cung cua bo truyen: "' + ultimateGoal + '" \u2014 chua den luc dat duoc.');
  }

  if (constraints.length > 0) {
    parts.push('[RANG BUOC TIEN DO]\n' + constraints.map(function(c) { return '- ' + c; }).join('\n'));
  }

  if (parts.length === 0) return '';

  return '[CHIEN LUOC & TIEN DO]\n' + parts.join('\n\n');
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
    if (currentChapterOutline.title) cur.push('Tieu de: ' + currentChapterOutline.title);
    if (currentChapterOutline.summary) cur.push('Noi dung can viet: ' + currentChapterOutline.summary);
    if (currentChapterOutline.purpose) cur.push('Purpose: ' + currentChapterOutline.purpose);
    if (currentChapterOutline.featuredCharacters && currentChapterOutline.featuredCharacters.length > 0) {
      cur.push('Nhan vat bat buoc bam sat: ' + currentChapterOutline.featuredCharacters.join(', '));
    }
    if (currentChapterOutline.primaryLocation) {
      cur.push('Dia diem chinh: ' + currentChapterOutline.primaryLocation);
    }
    if (currentChapterOutline.threadTitles && currentChapterOutline.threadTitles.length > 0) {
      cur.push('Tuyen truyen phai day: ' + currentChapterOutline.threadTitles.join(', '));
    }
    if (currentChapterOutline.requiredFactions && currentChapterOutline.requiredFactions.length > 0) {
      cur.push('The luc can xuat hien: ' + currentChapterOutline.requiredFactions.join(', '));
    }
    if (currentChapterOutline.requiredObjects && currentChapterOutline.requiredObjects.length > 0) {
      cur.push('Vat pham can xuat hien: ' + currentChapterOutline.requiredObjects.join(', '));
    }
    if (currentChapterOutline.keyEvents && currentChapterOutline.keyEvents.length > 0) {
      cur.push(
        'Su kien bat buoc xay ra:\n' +
        currentChapterOutline.keyEvents.map(function (e) { return '- ' + e; }).join('\n')
      );
    }
    parts.push('[NHIEM VU CHUONG NAY - BAM SAT, KHONG LAC SANG CHUONG KHAC]\n' + cur.join('\n'));
  }

  if (chapterBlueprintContext) {
    const whitelistLines = [];
    const blueprintCharacters = Array.isArray(chapterBlueprintContext.featured_characters)
      ? chapterBlueprintContext.featured_characters
      : [];
    if (blueprintCharacters.length > 0) {
      whitelistLines.push('Nhan vat uu tien: ' + blueprintCharacters.join(', '));
    }
    if (chapterBlueprintContext.primary_location) {
      whitelistLines.push('Dia diem uu tien: ' + chapterBlueprintContext.primary_location);
    }
    if (Array.isArray(chapterBlueprintContext.required_factions) && chapterBlueprintContext.required_factions.length > 0) {
      whitelistLines.push('The luc duoc phep/nen su dung: ' + chapterBlueprintContext.required_factions.join(', '));
    }
    if (Array.isArray(chapterBlueprintContext.required_objects) && chapterBlueprintContext.required_objects.length > 0) {
      whitelistLines.push('Vat pham duoc phep/nen su dung: ' + chapterBlueprintContext.required_objects.join(', '));
    }
    if (Array.isArray(chapterBlueprintContext.required_terms) && chapterBlueprintContext.required_terms.length > 0) {
      whitelistLines.push('Thuat ngu nen bam sat: ' + chapterBlueprintContext.required_terms.join(', '));
    }
    if (whitelistLines.length > 0) {
      whitelistLines.push('Chi duoc dung entity ngoai danh sach neu summary chuong hoac canon dang co bat buoc phai goi toi.');
      whitelistLines.push('Khong tu y them nhan vat, dia diem, vat pham, the luc, hay thuat ngu moi neu chapter blueprint va canon chua cho phep ro rang.');
      parts.push('[WHITELIST CHO CHUONG NAY - UU TIEN DUNG DUNG ENTITY DA DUOC CHI DINH]\n' + whitelistLines.join('\n'));
    }
  }

  if (upcomingChapters && upcomingChapters.length > 0) {
    const fence = upcomingChapters
      .map(function (c, i) {
        return '- Chuong tiep theo ' + (i + 1) + ': "' + c.title + '"' + (c.summary ? ' - ' + c.summary : '');
      })
      .join('\n');
    parts.push('[CAC CHUONG TIEP THEO - TUYET DOI KHONG VIET TRUOC NOI DUNG NAY]\n' + fence);
  }

  if (parts.length === 0) return '';
  return '\n[DAN Y TRUYEN]\n' + parts.join('\n\n');
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
    parts.push('Loi chan truoc khi viet:\n' + blockingIssues.map(function (issue) {
      return '- ' + issue.message;
    }).join('\n'));
  }
  if (warnings.length > 0) {
    parts.push('Canh bao anti-hallucination:\n' + warnings.map(function (issue) {
      return '- ' + issue.message;
    }).join('\n'));
  }

  return '\n[KIEM TRA TRUOC KHI VIET]\n' + parts.join('\n\n');
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
    const title = item.title || ('Chuong ' + chapterNumber);
    const summary = item.summary || item.purpose || '(chua co tom tat)';
    return chapterNumber + '. ' + title + ' - ' + summary;
  });
  return header ? header + '\n' + lines.join('\n') : lines.join('\n');
}

export function formatStoryProgressBudget(storyProgressBudget) {
  if (!storyProgressBudget) return '';
  const parts = [];
  if (Number.isFinite(Number(storyProgressBudget.currentChapterCount))) {
    parts.push('So chuong da co hien tai: ' + storyProgressBudget.currentChapterCount);
  }
  if (Number.isFinite(Number(storyProgressBudget.batchStartChapter)) && Number.isFinite(Number(storyProgressBudget.batchEndChapter))) {
    parts.push('Dot nay tao tu Chuong ' + storyProgressBudget.batchStartChapter + ' den Chuong ' + storyProgressBudget.batchEndChapter);
  }
  if (Number.isFinite(Number(storyProgressBudget.fromPercent)) && Number.isFinite(Number(storyProgressBudget.toPercent))) {
    parts.push('Pham vi tien do batch nay: ' + storyProgressBudget.fromPercent + '% -> ' + storyProgressBudget.toPercent + '%');
  }
  if (storyProgressBudget.mainPlotMaxStep != null) {
    parts.push('Main plot progress toi da: +' + storyProgressBudget.mainPlotMaxStep + ' nac');
  }
  if (storyProgressBudget.romanceMaxStep != null) {
    parts.push('Romance progress toi da: +' + storyProgressBudget.romanceMaxStep + ' nac');
  }
  if (storyProgressBudget.mysteryRevealAllowance) {
    parts.push('Muc do reveal bi an: ' + storyProgressBudget.mysteryRevealAllowance);
  }
  if (storyProgressBudget.powerProgressionCap) {
    parts.push('Gioi han power progression: ' + storyProgressBudget.powerProgressionCap);
  }
  if (storyProgressBudget.requiredBeatMix) {
    parts.push('Beat mix bat buoc: ' + storyProgressBudget.requiredBeatMix);
  }
  if (storyProgressBudget.remainingInMacro != null) {
    parts.push('So chuong con lai truoc khi ket thuc macro arc: ' + storyProgressBudget.remainingInMacro);
  }
  if (Number.isFinite(Number(storyProgressBudget.macroStartChapter)) && Number.isFinite(Number(storyProgressBudget.macroEndChapter)) && Number(storyProgressBudget.macroEndChapter) > 0) {
    parts.push('Pham vi macro arc dang khoa: Chuong ' + storyProgressBudget.macroStartChapter + ' -> Chuong ' + storyProgressBudget.macroEndChapter);
  }
  if (Number.isFinite(Number(storyProgressBudget.batchMacroOverlapCount)) && Number(storyProgressBudget.batchMacroOverlapCount) > 0) {
    parts.push('Batch nay di qua ' + storyProgressBudget.batchMacroOverlapCount + '/' + storyProgressBudget.macroSpan + ' chuong cua macro arc (' + storyProgressBudget.macroCoveragePercent + '%)');
  }
  if (storyProgressBudget.chaptersRemainingAfterBatchInMacro != null) {
    parts.push('Sau batch nay van con ' + storyProgressBudget.chaptersRemainingAfterBatchInMacro + ' chuong nua moi toi cuoi macro arc');
  }
  if (storyProgressBudget.macroProgressCap) {
    parts.push('Gioi han rieng cua macro arc: ' + storyProgressBudget.macroProgressCap);
  }
  if (storyProgressBudget.nextMilestone?.label || storyProgressBudget.nextMilestone?.title) {
    const label = storyProgressBudget.nextMilestone.label || storyProgressBudget.nextMilestone.title;
    const percent = storyProgressBudget.nextMilestone.percent != null ? ' (' + storyProgressBudget.nextMilestone.percent + '%)' : '';
    parts.push('Cot moc tiep theo: ' + label + percent);
  }
  return parts.join('\n');
}

export function buildMacroArcContractLayer(taskType, macroArcContract) {
  if (!macroArcContract) return '';
  if (![TASK_TYPES.ARC_OUTLINE, TASK_TYPES.ARC_CHAPTER_DRAFT, TASK_TYPES.OUTLINE].includes(taskType)) {
    return '';
  }
  return formatMacroArcContract(macroArcContract, {
    header: '[HOP DONG DAI CUC BAT BUOC]',
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
      ? 'khong vuot tier lon trong chuong nay'
      : 'co the nhich nhe neu day la chuong sat cot moc',
    requiredBeatMix: 'uu tien buildup / consequence / setup neu cot moc lon con xa',
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
    parts.push('[STORY PROGRESS BUDGET - CHUONG NAY]\n' + budgetText);
  }

  if (chapterText || Number.isFinite(Number(chapterSceneCount))) {
    const chapterLines = [];
    chapterLines.push('So canh dang co trong chuong: ' + (Number(chapterSceneCount) || 0));
    chapterLines.push(chapterText
      ? 'Chuong hien tai da co van ban. Hay uu tien doi chieu beat da viet truoc khi de xuat beat moi.'
      : 'Chuong hien tai chua co van ban. Neu da co dan y, hay xuat phat tu dan y do; neu chua co dan y, moi lap dan y cho chinh chuong nay.');
    parts.push('[TRANG THAI CHUONG HIEN TAI]\n' + chapterLines.join('\n'));
  }

  if (currentChapterOutline?.keyEvents?.length > 0) {
    const coverageLines = currentChapterOutline.keyEvents.map((eventText) => {
      const coverage = classifyOutlineBeatCoverage(eventText, chapterText);
      const matched = coverage.matchedKeywords.length > 0
        ? ' | tu khoa trung: ' + coverage.matchedKeywords.join(', ')
        : '';
      const statusLabel = coverage.status === 'covered'
        ? 'co kha nang da viet'
        : coverage.status === 'maybe'
          ? 'co tin hieu mot phan'
          : 'chua thay dau hieu ro';
      return '- ' + statusLabel + ': ' + eventText + matched;
    });

    parts.push(
      '[DOI CHIEU DAN Y VA NOI DUNG DA VIET - HEURISTIC, CHI DUNG DE DOI CHIEU]\n'
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
    const emotional = item?.emotional_peak ? '\nCam xuc dich: ' + item.emotional_peak : '';
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
    return number + '. ' + (item?.title || 'Cot moc') + chapterRange + '\nMo ta: ' + (item?.description || '') + emotional + contractText;
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
      'Doan van ket thuc chuong truoc (viet tiep TU DAY, KHONG lap lai, KHONG mo dau lai tu dau):\n' +
      '"""\n' + bridgeBuffer + '\n"""'
    );
  }

  if (emotionalState) {
    const stateParts = [];
    if (emotionalState.mood) stateParts.push('Trang thai cam xuc: ' + emotionalState.mood);
    if (emotionalState.activeConflict) stateParts.push('Xung dot dang mo: ' + emotionalState.activeConflict);
    if (emotionalState.lastAction) stateParts.push('Hanh dong cuoi: ' + emotionalState.lastAction);
    if (tensionLevel != null) stateParts.push('Muc do cang thang: ' + tensionLevel + '/10');
    if (stateParts.length > 0) {
      parts.push('Trang thai nhan vat khi ket thuc chuong truoc:\n' + stateParts.join('\n'));
    }
  }

  if (parts.length === 0) return '';

  return '\n[DIEM NOI MACH TRUYEN - BAT BUOC DOC TRUOC KHI VIET]\n' + parts.join('\n\n');
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

  lines.push('[LINH HON TAC GIA]');
  lines.push('');
  lines.push('VAI TRO CUA BAN: Ban la ' + role + '.');
  lines.push('');
  lines.push('TRIET LY VIET (BAT BUOC INTERNALIZE):');
  lines.push('1. Viet bang cam xuc, khong phai thong tin.');
  lines.push('   SAI: "Canh gioi han dot pha len Truc Co ky."');
  lines.push('   DUNG: "Linh hai trong nguoi han bot nhien vo vun - roi tai sinh, manh liet hon gap boi."');
  lines.push('2. Moi canh PHAI thay doi trang thai nhan vat. Truoc canh: nhan vat muon/so/nghi gi? Sau canh: con nguyen ven khong?');
  lines.push('3. Doc gia CAM truoc, HIEU sau. Khong bao gio giai thich truoc khi de doc gia trai nghiem.');
  lines.push('4. Moi cau phai "lam mot viec": mo ta, day chuyen, tiet lo, HOAC gay cam xuc. Cau khong lam duoc gi thi cat.');

    // Only add emotional goals for FULL_WRITING tasks.
  if (isFullWriting) {
    lines.push('');
    lines.push('MUC TIEU CAM XUC CHUONG NAY:');

    const hookEmotion = currentChapterOutline?.summary
      ? 'Cuon hut doc gia ngay lap tuc qua: ' + currentChapterOutline.summary.substring(0, 80)
      : 'Tao hook manh me ngay dong dau tien - doc gia phai muon doc tiep';
    const peakEmotion = currentMacroArc?.emotional_peak
      ? currentMacroArc.emotional_peak
      : 'Day len muc cam xuc cao nhat co the trong canh nay';
    const cliffhanger = 'De lai it nhat mot cau hoi chua duoc tra loi - doc gia phai muon sang chuong sau';

    lines.push('- DAU CHUONG (hook): ' + hookEmotion);
    lines.push('- DINH DIEM (peak): ' + peakEmotion);
    lines.push('- CUOI CHUONG (cliffhanger): ' + cliffhanger);
  } else {
    // STYLE_ONLY: remind the model not to alter story direction.
    lines.push('');
    lines.push('LUU Y QUAN TRONG (STYLE_ONLY MODE):');
    lines.push('Ban dang lam viec voi text DA CO SAN. KHONG duoc thay doi huong cam xuc hay cot truyen.');
    lines.push('Chi nang cap van phong, nhip dieu, tu ngu theo Style DNA ben duoi.');
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
[VAN PHONG DNA - HAN VIET / SANGTACVIET STYLE]

1. TU DIEN BAT BUOC DUNG - KHONG DUOC THUAN VIET HOA:
Xung ho: nguoi, han, nang, lao, tieu tu, dao huu, huynh, de, ty, muoi, lao phu
Trang thai: bang bac, lanh mang, tham thuy, u am, hung hon, kinh nguoi, uy ap
Hanh dong: thi trien, van chuyen, dot pha, ngung ket, tan loan, thu liem, tung hoanh
Tu luyen: linh khi, dan dien, kinh mach, canh gioi, thien tu, linh hai, thien hoa
Cam thach: van phan, thien ha vo dich, kinh thien dong dia, khung bo, bat kha tu nghi
Cam xuc: lanh nhan bang quan, khe nhech moi, anh mat ben nhu kiem

2. CAU TRUC CAU DAC TRUNG (DAO NGU TRUNG QUOC):
DUNG: "Han anh mat ben trong loe len mot tia lanh mang."
SAI:  "Trong mat han loe len anh nhin lanh le."
DUNG: "Linh khi bang bac, han ngoi ket gia, tam than sac ben nhu kiem."
SAI:  "Han ngoi ket gia, linh khi toa ra va tam than rat sac ben."
DUNG: "Dao huu nay... thuc su khien lao kinh so."
SAI:  "Nguoi nay thuc su khien ong ta so hai."

3. NHIP DIEU THEO TINH HUONG:
Hanh dong nhanh: cau 5-8 chu, lien tiep, moi cau = 1 hanh dong ro rang.
  VD: "Han xuat thu. Kiem quang loe len. Dich nhan chua kip phan ung."
Cam xuc / noi tam: cau dai, nhieu menh de, cham rai suy tu.
  VD: "Han dung do, nhin vao hu khong ma trong long lai day len mot cam giac ky la..."
Cao trao CONG THUC: 3 cau ngan + 1 cau dai bung no.
  VD: "Linh khi rung chuyen. Dai dia run ray. Khong gian meo mo. Va roi - trong tieng gao thet kinh thien cua thien dia, canh gioi han vo toang!"

4. CONG THUC SANG DIEM (BAT BUOC NAM VUNG):
Va mat (humiliation -> reversal):
  Setup: ke dich kieu ngao + cong khai si nhuc truoc dong nguoi.
  Twist: nhan vat chinh tiet lo bi an / suc manh that su.
  Payoff: 1 cau thoai ngan, lanh, chinh xac den tan nhan.
  Phan ung: dam dong kinh ngac -> im lang -> xon xao.
Dot pha canh gioi:
  Giai doan 1: co the dau don / linh hai sap vo.
  Giai doan 2: diem bung vo - mo ta vat ly cuc ky chi tiet.
  Giai doan 3: su yen tinh sau bao - nhan vat nhan ra minh da khac.
Tiet lo bi mat: de doc gia nhan ra TRUOC nhan vat (dramatic irony) HOAC cung luc (shock).

5. CAM KY TUYET DOI:
- KHONG giai thich he thong nhu nguoi dan truyen: "Truc Co ky la canh gioi thu 2..."
- KHONG de nhan vat binh than truoc dieu phi thuong
- KHONG ket thuc canh ma khong co he qua cam xuc
- KHONG dung ngoac don () tru mau sac pham cap: (luc), (lam), (tu), (hoang), (xich), (chanh), (hac), (bach), (thai sac)
- KHONG viet "Han nghi:" - thay bang gian tiep noi tam`;
  }

  // Thuan Viet
  return `
[VAN PHONG DNA - THUAN VIET]

1. NGUYEN TAC GOC:
Moi thu phai nghe nhu nguoi Viet thuc su nghi va cam.
Khong cung nhac, khong dich may, khong Han hoa.
Tu nao nguoi binh thuong khong noi thi thay bang tu tu nhien hon.

2. NHIP DIEU VA CAU TRUC:
Hanh dong: cau ngan, dong tu manh, KHONG trang tu thua.
  DUNG: "Anh chay. Tim dap loan. Hoi tho can."
  SAI:  "Anh vo cung voi va chay rat nhanh."
Noi tam: cau dai hon, chay tu nhien nhu dong y thuc.
  DUNG: "Co khong hieu tai sao minh lai dung lai o day - chi biet rang neu buoc them mot buoc nua, co dieu gi do se vinh vien thay doi."
Doi thoai: ngan, that, co tinh cach tung nguoi - khong ai noi dai hon 2 cau neu khong can.

3. MOI TRUONG VA GIAC QUAN:
Mo ta = 5 giac quan, KHONG phai buc tranh.
Mui, am thanh, ket cau, nhiet do TRUOC ve ngoai.
  DUNG: "Khong khi am va tanh cua mua sap den"
  SAI:  "Bau troi xam xit"
Chi tiet cu the > tong quat:
  DUNG: "Cai ban go som bong tron son o goc trai"
  SAI:  "Can phong cu ky"

4. XU LY CAM XUC:
KHONG bao gio viet cam xuc truc tiep: "Co rat buon."
THAY BANG hanh dong the hien cam xuc:
  "Co ngoi xuong san. Khong khoc. Chi nhin vao buc tuong trang cho den khi mat mo di."
Cung bac cam xuc = thay doi vat ly: nhip tho, nhiet do, trong luong co the.

5. CAM KY:
- KHONG dung: nguoi, han (? anh ay, ong ta, y, ga...), nang (? co ay, chi ay)
- KHONG cau truc dao ngu kieu Trung Quoc
- KHONG ket thuc canh bang tong ket nhu nguoi ke chuyen
- KHONG mieu ta cam xuc bang tinh tu: "buon", "vui", "so" - chi hanh dong`;
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

  const lines = ['\n[CHONG VAN PHONG AI - TU/CUM CAM DUNG]'];
  lines.push('Cac cum tu sau la DAU HIEU AI - KHONG DUOC DUNG:');
  picked.forEach(e => lines.push('  X "' + e.bad + '"  ->  V ' + e.good));
  lines.push('Neu thay minh sap viet bat ky cum nao o tren thi dung lai, viet cach khac.');
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

  const lines = ['[MAU VAN PHONG - DOC VA CAM NHAN TRUOC KHI VIET]'];
  lines.push('Day la giong van va nhip dieu can dat - hoc phong cach, KHONG copy tu ngu:');
  lines.push('');
  samples.forEach(s => lines.push('- "' + s.replace(/"/g, '\"') + '"'));
  lines.push('');
  lines.push('Viet theo CAM GIAC nay. Khong copy tu ngu, chi can nhip dieu tuong tu.');
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
  lines.push('[NHIEM VU TOI THUONG - UU TIEN CAO NHAT]');

  if (instruction) {
    lines.push('>>> ' + instruction + ' <<<');
  } else {
    lines.push(isFullWriting
      ? '>>> Viet tiep tu diem nay, giu nguyen mach truyen va day manh cam xuc <<< '
      : '>>> Nang cap van phong theo Style DNA, giu nguyen noi dung va cam xuc goc <<<');
  }

  if (isFullWriting) {
    lines.push('');
    lines.push('DAM BAO 3 DIEU SAU THE HIEN RO TRONG BAI VIET:');
    lines.push('- Dong dau tien phai tao cam xuc manh, cuon doc gia vao ngay lap tuc.');
    lines.push('- Nhan vat chinh phai THAY DOI qua canh nay (cam xuc, nhan thuc, hoac vi the).');
    lines.push('- Cuoi canh de lai tinh huong mo hoac cau hoi khien doc gia muon sang chuong tiep.');
    lines.push('');
    lines.push('CU THE HOA - KHONG VIET TRUU TUONG:');
    lines.push('- Thoi gian: KHONG "gan day", "lau lam" -> viet "3 ngay truoc", "nua thang", "tu sang den gio"');
    lines.push('- So luong: KHONG "nhieu nguoi" -> viet "nam ba nguoi", "ca tram ke", "vai chuc ten"');
    lines.push('- Cam giac: KHONG "rat dau", "vo cung lo lang" -> viet hanh dong: "han cong nguoi lai", "tay nam chat den trang bech"');
    lines.push('- Canh vat: KHONG "can phong rat lon" -> viet 1 chi tiet: "tran nha cao gap 3 lan nguoi dung", "vach da am am nuoc"');
  } else {
    // EXPAND / REWRITE
    lines.push('');
    lines.push('Giu nguyen su kien, huong di, va cam xuc goc cua doan van.');
    lines.push('Chi nang cap: nhip dieu cau, tu ngu, cau truc theo Style DNA da cho.');
  }

  return lines.join('\n');
}
