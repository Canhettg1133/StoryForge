import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import db from '../../../services/db/database';
import useArcGenStore from '../../../stores/arcGenerationStore';
import {
  deriveMacroArcContractJson,
  getSuggestedMacroMilestoneCount,
} from '../utils/storyBibleHelpers';

function toPositiveInt(value) {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? Math.floor(num) : 0;
}

function getMacroCoverageEnd(macroArcs = []) {
  return macroArcs.reduce((max, item) => Math.max(max, toPositiveInt(item?.chapter_to)), 0);
}

function getMacroOverlapCount(macroArcs = [], start = 1, end = start) {
  return macroArcs.filter((item) => {
    const from = toPositiveInt(item?.chapter_from);
    const to = toPositiveInt(item?.chapter_to);
    if (!from || !to || to < from) return false;
    return Math.max(from, start) <= Math.min(to, end);
  }).length;
}

function syncMilestoneChapterPlans(previous = [], milestoneCount = 0) {
  const safeCount = Math.max(1, Number(milestoneCount) || 1);
  return Array.from({ length: safeCount }, (_, index) => ({
    chapter_from: previous[index]?.chapter_from || '',
    chapter_to: previous[index]?.chapter_to || '',
  }));
}

function normalizeManualMilestonePlan(item, scope) {
  const rawFrom = toPositiveInt(item?.chapter_from);
  const rawTo = toPositiveInt(item?.chapter_to);
  if (!rawFrom && !rawTo) return null;
  if (!rawFrom || !rawTo) {
    return {
      chapter_from: rawFrom || 0,
      chapter_to: rawTo || 0,
      isIncomplete: true,
    };
  }
  const chapter_from = Math.min(scope.end, Math.max(scope.start, rawFrom));
  const chapter_to = Math.max(chapter_from, Math.min(scope.end, rawTo));
  return {
    chapter_from,
    chapter_to,
    isIncomplete: false,
  };
}

function countUncoveredScopeChapters(scope, plans = []) {
  if (!scope?.start || !scope?.end || scope.end < scope.start) return 0;
  const covered = new Set();
  plans.forEach((item) => {
    if (!item || item.isIncomplete) return;
    for (let chapter = item.chapter_from; chapter <= item.chapter_to; chapter += 1) {
      covered.add(chapter);
    }
  });
  return Math.max(0, scope.span - covered.size);
}

function buildPlanningScopeDefaults({ targetLength, chaptersCount, macroArcs }) {
  const hasExplicitTargetLength = toPositiveInt(targetLength) > 0;
  const safeTarget = Math.max(
    hasExplicitTargetLength ? toPositiveInt(targetLength) : 0,
    toPositiveInt(chaptersCount),
    getMacroCoverageEnd(macroArcs),
    1
  );
  const existingCoverageEnd = Math.max(getMacroCoverageEnd(macroArcs), toPositiveInt(chaptersCount));
  const defaultStart = Math.min(Math.max(1, existingCoverageEnd + 1), safeTarget);
  return {
    hasExplicitTargetLength,
    safeTarget,
    defaultStart,
    defaultEnd: safeTarget,
  };
}

function normalizePlanningScope({ start, end, defaults }) {
  const dynamicUpperBound = defaults.hasExplicitTargetLength
    ? defaults.safeTarget
    : Math.max(
      defaults.safeTarget,
      Math.max(1, toPositiveInt(start) || 0),
      Math.max(1, toPositiveInt(end) || 0)
    );
  const safeStart = Math.min(
    dynamicUpperBound,
    Math.max(1, toPositiveInt(start) || defaults.defaultStart)
  );
  const requestedEnd = toPositiveInt(end) || defaults.defaultEnd;
  const safeEnd = Math.max(
    safeStart,
    Math.min(dynamicUpperBound, requestedEnd)
  );
  return {
    start: safeStart,
    end: safeEnd,
    span: safeEnd - safeStart + 1,
  };
}

export default function useStoryBibleMacroArcs({
  currentProject,
  title,
  synopsis,
  ultimateGoal,
  genrePrimary,
  targetLength,
  chaptersCount,
}) {
  const [macroArcs, setMacroArcs] = useState([]);
  const [aiIdeaInput, setAiIdeaInput] = useState('');
  const [aiMilestoneCount, setAiMilestoneCount] = useState(5);
  const [aiMilestoneRequirements, setAiMilestoneRequirements] = useState('');
  const [aiMilestoneChapterPlans, setAiMilestoneChapterPlans] = useState(() => syncMilestoneChapterPlans([], 5));
  const [planningScopeStart, setPlanningScopeStartState] = useState(1);
  const [planningScopeEnd, setPlanningScopeEndState] = useState(1);
  const [showAiSuggest, setShowAiSuggest] = useState(false);
  const [aiMilestoneRevisionPrompt, setAiMilestoneRevisionPrompt] = useState('');
  const [editableMilestoneSuggestions, setEditableMilestoneSuggestions] = useState([]);
  const [selectedMilestoneIdxs, setSelectedMilestoneIdxs] = useState(new Set());
  const [selectedMilestonePresets, setSelectedMilestonePresets] = useState(() => new Set());
  const macroArcsRef = useRef([]);
  const macroArcSaveTimerRef = useRef(null);
  const planningScopeDefaultsRef = useRef({ safeTarget: 1, defaultStart: 1, defaultEnd: 1, hasExplicitTargetLength: false });

  const {
    isSuggestingMilestones,
    isRevisingMilestones,
    macroMilestoneSuggestions,
    analyzingMacroContractKeys,
    generateMacroMilestones,
    reviseMacroMilestones,
    saveMacroMilestones,
    analyzeMacroContract,
  } = useArcGenStore();

  const suggestedMilestoneCount = useMemo(
    () => getSuggestedMacroMilestoneCount(targetLength),
    [targetLength]
  );
  const planningScopeDefaults = useMemo(
    () => buildPlanningScopeDefaults({ targetLength, chaptersCount, macroArcs }),
    [chaptersCount, macroArcs, targetLength]
  );
  const effectivePlanningScope = useMemo(
    () => normalizePlanningScope({
      start: planningScopeStart,
      end: planningScopeEnd,
      defaults: planningScopeDefaults,
    }),
    [planningScopeDefaults, planningScopeEnd, planningScopeStart]
  );
  const normalizedMilestoneChapterPlans = useMemo(
    () => syncMilestoneChapterPlans(aiMilestoneChapterPlans, aiMilestoneCount),
    [aiMilestoneChapterPlans, aiMilestoneCount]
  );
  const manualMilestoneChapterPlans = useMemo(
    () => normalizedMilestoneChapterPlans.map((item) => normalizeManualMilestonePlan(item, effectivePlanningScope)),
    [effectivePlanningScope, normalizedMilestoneChapterPlans]
  );
  const autoMilestoneCount = useMemo(
    () => manualMilestoneChapterPlans.filter((item) => !item).length,
    [manualMilestoneChapterPlans]
  );
  const uncoveredScopeChapters = useMemo(
    () => countUncoveredScopeChapters(effectivePlanningScope, manualMilestoneChapterPlans),
    [effectivePlanningScope, manualMilestoneChapterPlans]
  );
  const planningScopeOverlapCount = useMemo(
    () => getMacroOverlapCount(macroArcs, effectivePlanningScope.start, effectivePlanningScope.end),
    [effectivePlanningScope.end, effectivePlanningScope.start, macroArcs]
  );

  const planningScopeWarnings = useMemo(() => {
    const warnings = [];

    if (!planningScopeDefaults.hasExplicitTargetLength) {
      warnings.push({
        level: 'warning',
        code: 'missing-target-length',
        message: 'Bạn chưa đặt độ dài toàn truyện. Phạm vi hiện tại chỉ đang dùng mốc tạm, nên AI khó ước lượng nhịp tổng thể của toàn bộ tác phẩm.',
      });
    }

    if (effectivePlanningScope.start <= chaptersCount && chaptersCount > 0) {
      warnings.push({
        level: 'warning',
        code: 'overlaps-written-chapters',
        message: `Phạm vi đang chạm vào chương đã có (${chaptersCount} chương). AI có thể tái hoạch định cả đoạn đã viết, không chỉ phần tiếp theo.`,
      });
    }

    if (effectivePlanningScope.start > chaptersCount + 1) {
      warnings.push({
        level: 'info',
        code: 'gap-before-scope',
        message: `Đang bỏ trống từ chương ${chaptersCount + 1} đến ${effectivePlanningScope.start - 1}. Điều này hợp lệ, nhưng bạn nên chắc đây là chủ ý lập kế hoạch cho một đoạn giữa truyện.`,
      });
    }

    if (aiMilestoneCount > effectivePlanningScope.span) {
      warnings.push({
        level: 'warning',
        code: 'too-many-milestones-for-scope',
        message: `Bạn đang yêu cầu ${aiMilestoneCount} cột mốc cho phạm vi chỉ có ${effectivePlanningScope.span} chương. AI dễ chia mốc quá dày và làm mất nhịp.`,
      });
    }

    if (planningScopeOverlapCount > 0) {
      warnings.push({
        level: 'warning',
        code: 'overlaps-existing-macro-arcs',
        message: `Phạm vi này đang chồng lên ${planningScopeOverlapCount} đại cục đã có. Nếu tiếp tục, bạn nên coi đây là tái quy hoạch đoạn cũ chứ không phải tạo mới hoàn toàn.`,
      });
    }

    const incompletePlanCount = manualMilestoneChapterPlans.filter((item) => item?.isIncomplete).length;
    if (incompletePlanCount > 0) {
      warnings.push({
        level: 'warning',
        code: 'incomplete-milestone-ranges',
        message: `Có ${incompletePlanCount} cột mốc đang nhập dở phạm vi riêng. Muốn khóa riêng từng cột mốc thì phải nhập đủ cả "từ" và "đến"; nếu không hãy để trống hẳn để hệ thống tự chia.`,
      });
    }

    const fixedPlans = manualMilestoneChapterPlans
      .map((item, index) => (item ? { ...item, index } : null))
      .filter((item) => item && !item.isIncomplete);
    for (let index = 1; index < fixedPlans.length; index += 1) {
      const previous = fixedPlans[index - 1];
      const current = fixedPlans[index];
      if (current.chapter_from <= previous.chapter_to) {
        warnings.push({
          level: 'warning',
          code: 'overlapping-manual-milestone-ranges',
          message: `Phạm vi riêng của cột mốc ${previous.index + 1} và ${current.index + 1} đang chồng nhau. AI sẽ khó hiểu thứ tự leo thang nếu bạn giữ hai đoạn này đè lên nhau.`,
        });
        break;
      }
    }

    if (autoMilestoneCount > 0 && uncoveredScopeChapters === 0) {
      warnings.push({
        level: 'warning',
        code: 'no-room-for-auto-milestones',
        message: `Bạn đã khóa tay kín toàn bộ phạm vi ${effectivePlanningScope.start}-${effectivePlanningScope.end}, nhưng vẫn còn ${autoMilestoneCount} cột mốc để AI tự chia. Hãy nới bớt các mốc khóa tay hoặc giảm số cột mốc.`,
      });
    } else if (autoMilestoneCount > 0 && uncoveredScopeChapters < autoMilestoneCount) {
      warnings.push({
        level: 'warning',
        code: 'tight-room-for-auto-milestones',
        message: `Chỉ còn ${uncoveredScopeChapters} chương trống cho ${autoMilestoneCount} cột mốc tự động. AI vẫn có thể chia, nhưng nhịp sẽ rất dày và dễ gượng.`,
      });
    }

    return warnings;
  }, [
    aiMilestoneCount,
    autoMilestoneCount,
    chaptersCount,
    effectivePlanningScope.end,
    effectivePlanningScope.span,
    effectivePlanningScope.start,
    manualMilestoneChapterPlans,
    planningScopeDefaults.hasExplicitTargetLength,
    planningScopeOverlapCount,
    uncoveredScopeChapters,
  ]);

  const hasBlockingMilestonePlanIssue = useMemo(
    () => planningScopeWarnings.some((warning) => [
      'incomplete-milestone-ranges',
      'no-room-for-auto-milestones',
      'too-many-milestones-for-scope',
      'overlapping-manual-milestone-ranges',
    ].includes(warning.code)),
    [planningScopeWarnings]
  );

  useEffect(() => {
    macroArcsRef.current = macroArcs;
  }, [macroArcs]);

  useEffect(() => {
    setAiMilestoneChapterPlans((prev) => syncMilestoneChapterPlans(prev, aiMilestoneCount));
  }, [aiMilestoneCount]);

  useEffect(() => {
    if (!currentProject?.id) {
      setMacroArcs([]);
      return;
    }
    setAiMilestoneCount(getSuggestedMacroMilestoneCount(currentProject.target_length || 0));
    db.macro_arcs
      .where('project_id').equals(currentProject.id)
      .sortBy('order_index')
      .then(setMacroArcs)
      .catch(() => setMacroArcs([]));
  }, [currentProject]);

  useEffect(() => {
    const previousDefaults = planningScopeDefaultsRef.current;
    const nextDefaults = planningScopeDefaults;
    const previousScope = normalizePlanningScope({
      start: planningScopeStart,
      end: planningScopeEnd,
      defaults: previousDefaults,
    });

    const shouldFollowDefaults =
      previousScope.start === previousDefaults.defaultStart &&
      previousScope.end === previousDefaults.defaultEnd;

    if (shouldFollowDefaults) {
      setPlanningScopeStartState(nextDefaults.defaultStart);
      setPlanningScopeEndState(nextDefaults.defaultEnd);
    } else {
      const clamped = normalizePlanningScope({
        start: planningScopeStart,
        end: planningScopeEnd,
        defaults: nextDefaults,
      });
      if (clamped.start !== planningScopeStart) setPlanningScopeStartState(clamped.start);
      if (clamped.end !== planningScopeEnd) setPlanningScopeEndState(clamped.end);
    }

    planningScopeDefaultsRef.current = nextDefaults;
  }, [planningScopeDefaults, planningScopeEnd, planningScopeStart]);

  useEffect(() => {
    if (macroMilestoneSuggestions?.milestones?.length > 0) {
      setEditableMilestoneSuggestions(macroMilestoneSuggestions.milestones.map((item, index) => ({
        order: item.order || index + 1,
        title: item.title || '',
        description: item.description || '',
        chapter_from: item.chapter_from || 0,
        chapter_to: item.chapter_to || 0,
        emotional_peak: item.emotional_peak || '',
        contract_json: item.contract_json || '',
      })));
      setSelectedMilestoneIdxs(new Set(macroMilestoneSuggestions.milestones.map((_, index) => index)));
    } else {
      setEditableMilestoneSuggestions([]);
    }
  }, [macroMilestoneSuggestions]);

  useEffect(() => () => {
    if (macroArcSaveTimerRef.current) {
      clearTimeout(macroArcSaveTimerRef.current);
    }
  }, []);

  const buildMilestoneRequirements = useCallback((presets = []) => {
    const presetLines = presets.map((preset) => preset.text);
    return [...presetLines, aiMilestoneRequirements.trim()]
      .filter(Boolean)
      .join('\n');
  }, [aiMilestoneRequirements]);

  const resetAiSuggestPanel = useCallback(() => {
    setShowAiSuggest(false);
    setAiIdeaInput('');
    setAiMilestoneCount(suggestedMilestoneCount);
    setAiMilestoneRequirements('');
    setAiMilestoneChapterPlans(syncMilestoneChapterPlans([], suggestedMilestoneCount));
    setPlanningScopeStartState(planningScopeDefaults.defaultStart);
    setPlanningScopeEndState(planningScopeDefaults.defaultEnd);
    setAiMilestoneRevisionPrompt('');
    setEditableMilestoneSuggestions([]);
    setSelectedMilestoneIdxs(new Set());
    setSelectedMilestonePresets(new Set());
  }, [planningScopeDefaults.defaultEnd, planningScopeDefaults.defaultStart, suggestedMilestoneCount]);

  const setPlanningScopeStart = useCallback((value) => {
    setPlanningScopeStartState((prev) => normalizePlanningScope({
      start: value,
      end: planningScopeEnd || prev,
      defaults: planningScopeDefaultsRef.current,
    }).start);
    setPlanningScopeEndState((prev) => normalizePlanningScope({
      start: value,
      end: prev,
      defaults: planningScopeDefaultsRef.current,
    }).end);
  }, [planningScopeEnd]);

  const setPlanningScopeEnd = useCallback((value) => {
    setPlanningScopeEndState(normalizePlanningScope({
      start: planningScopeStart,
      end: value,
      defaults: planningScopeDefaultsRef.current,
    }).end);
  }, [planningScopeStart]);

  const useDefaultPlanningScope = useCallback(() => {
    setPlanningScopeStartState(planningScopeDefaults.defaultStart);
    setPlanningScopeEndState(planningScopeDefaults.defaultEnd);
  }, [planningScopeDefaults.defaultEnd, planningScopeDefaults.defaultStart]);

  const useWholeStoryPlanningScope = useCallback(() => {
    setPlanningScopeStartState(1);
    setPlanningScopeEndState(planningScopeDefaults.safeTarget);
  }, [planningScopeDefaults.safeTarget]);

  const handleUpdateMilestoneChapterPlan = useCallback((index, field, value) => {
    setAiMilestoneChapterPlans((prev) => {
      const next = syncMilestoneChapterPlans(prev, aiMilestoneCount);
      next[index] = {
        ...next[index],
        [field]: value,
      };
      return next;
    });
  }, [aiMilestoneCount]);

  const resetMilestoneChapterPlans = useCallback(() => {
    setAiMilestoneChapterPlans(syncMilestoneChapterPlans([], aiMilestoneCount));
  }, [aiMilestoneCount]);

  const handleGenerateMilestones = useCallback(async (macroAiPresets) => {
    if (!currentProject) return;
    const selectedPresetModels = macroAiPresets.filter((preset) => selectedMilestonePresets.has(preset.id));
    const combinedRequirements = buildMilestoneRequirements(selectedPresetModels);
    const contextIdea = [
      aiIdeaInput,
      title ? `Tên truyện: ${title}` : '',
      synopsis ? `Cốt truyện: ${synopsis}` : '',
      ultimateGoal ? `Đích đến: ${ultimateGoal}` : '',
    ].filter(Boolean).join('\n');

    await generateMacroMilestones({
      projectId: currentProject.id,
      authorIdea: contextIdea,
      genre: genrePrimary,
      milestoneCount: aiMilestoneCount,
      requirements: combinedRequirements,
      planningScopeStart: effectivePlanningScope.start,
      planningScopeEnd: effectivePlanningScope.end,
      macroMilestoneChapterPlans: manualMilestoneChapterPlans,
    });
    setSelectedMilestoneIdxs(new Set());
  }, [
    aiIdeaInput,
    aiMilestoneCount,
    buildMilestoneRequirements,
    currentProject,
    effectivePlanningScope.end,
    effectivePlanningScope.start,
    generateMacroMilestones,
    genrePrimary,
    manualMilestoneChapterPlans,
    selectedMilestonePresets,
    synopsis,
    title,
    ultimateGoal,
  ]);

  const handleSaveMilestones = useCallback(async () => {
    if (!currentProject || !editableMilestoneSuggestions.length) return;
    const selected = editableMilestoneSuggestions
      .filter((_, index) => selectedMilestoneIdxs.has(index))
      .map((item, index) => ({
        ...item,
        order: index + 1,
      }));
    if (selected.length === 0) return;
    await saveMacroMilestones(currentProject.id, selected);
    const updated = await db.macro_arcs
      .where('project_id').equals(currentProject.id)
      .sortBy('order_index');
    setMacroArcs(updated);
    resetAiSuggestPanel();
  }, [currentProject, editableMilestoneSuggestions, resetAiSuggestPanel, saveMacroMilestones, selectedMilestoneIdxs]);

  const handleUpdateEditableMilestone = useCallback((index, field, value) => {
    setEditableMilestoneSuggestions((prev) => prev.map((item, itemIndex) => (
      itemIndex === index ? { ...item, [field]: value } : item
    )));
  }, []);

  const getEditableMilestoneAnalyzeKey = useCallback((index) => `editable-macro-${index}`, []);
  const getSavedMacroArcAnalyzeKey = useCallback((id) => `saved-macro-${id}`, []);

  const handleAnalyzeEditableMilestone = useCallback(async (index, milestone) => {
    if (!currentProject || !milestone) return;
    const analyzed = await analyzeMacroContract({
      projectId: currentProject.id,
      macroArc: milestone,
      key: getEditableMilestoneAnalyzeKey(index),
    });
    if (!analyzed?.contract_json) return;
    setEditableMilestoneSuggestions((prev) => prev.map((item, itemIndex) => (
      itemIndex === index ? { ...item, contract_json: analyzed.contract_json } : item
    )));
  }, [analyzeMacroContract, currentProject, getEditableMilestoneAnalyzeKey]);

  const handleAnalyzeSavedMacroArc = useCallback(async (macroArc) => {
    if (!currentProject || !macroArc?.id) return;
    const analyzed = await analyzeMacroContract({
      projectId: currentProject.id,
      macroArc,
      key: getSavedMacroArcAnalyzeKey(macroArc.id),
    });
    if (!analyzed?.contract_json) return;
    setMacroArcs((prev) => prev.map((item) => (
      item.id === macroArc.id ? { ...item, contract_json: analyzed.contract_json } : item
    )));
    try {
      await db.macro_arcs.update(macroArc.id, {
        contract_json: analyzed.contract_json,
      });
    } catch (error) {
      console.error('[StoryBible] analyze saved macro arc error:', error);
    }
  }, [analyzeMacroContract, currentProject, getSavedMacroArcAnalyzeKey]);

  const handleRemoveEditableMilestone = useCallback((index) => {
    setEditableMilestoneSuggestions((prev) => prev.filter((_, itemIndex) => itemIndex !== index));
    setSelectedMilestoneIdxs((prev) => {
      const next = new Set();
      [...prev].forEach((value) => {
        if (value === index) return;
        next.add(value > index ? value - 1 : value);
      });
      return next;
    });
  }, []);

  const handleToggleEditableMilestoneSelection = useCallback((index) => {
    setSelectedMilestoneIdxs((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }, []);

  const handleAddEditableMilestone = useCallback(() => {
    setEditableMilestoneSuggestions((prev) => ([
      ...prev,
      {
        order: prev.length + 1,
        title: `Cột mốc ${prev.length + 1}`,
        description: '',
        chapter_from: 0,
        chapter_to: 0,
        emotional_peak: '',
        contract_json: '',
      },
    ]));
  }, []);

  const handleReviseMilestones = useCallback(async (macroAiPresets) => {
    if (!currentProject) return;
    const sourceMilestones = editableMilestoneSuggestions.length > 0
      ? editableMilestoneSuggestions
      : (macroMilestoneSuggestions?.milestones || []);
    if (sourceMilestones.length === 0) return;
    const selectedPresetModels = macroAiPresets.filter((preset) => selectedMilestonePresets.has(preset.id));
    const combinedRequirements = buildMilestoneRequirements(selectedPresetModels);
    const contextIdea = [
      aiIdeaInput,
      combinedRequirements,
      aiMilestoneRevisionPrompt,
      title ? `Tên truyện: ${title}` : '',
      synopsis ? `Cốt truyện: ${synopsis}` : '',
      ultimateGoal ? `Đích đến: ${ultimateGoal}` : '',
    ].filter(Boolean).join('\n');

    await reviseMacroMilestones({
      projectId: currentProject.id,
      authorIdea: contextIdea,
      genre: genrePrimary,
      existingMilestones: sourceMilestones,
      milestoneCount: aiMilestoneCount,
      requirements: combinedRequirements,
      planningScopeStart: effectivePlanningScope.start,
      planningScopeEnd: effectivePlanningScope.end,
      macroMilestoneChapterPlans: manualMilestoneChapterPlans,
    });
  }, [
    aiIdeaInput,
    aiMilestoneCount,
    aiMilestoneRevisionPrompt,
    buildMilestoneRequirements,
    currentProject,
    editableMilestoneSuggestions,
    effectivePlanningScope.end,
    effectivePlanningScope.start,
    genrePrimary,
    macroMilestoneSuggestions,
    manualMilestoneChapterPlans,
    reviseMacroMilestones,
    selectedMilestonePresets,
    synopsis,
    title,
    ultimateGoal,
  ]);

  const toggleMilestonePreset = useCallback((presetId) => {
    setSelectedMilestonePresets((prev) => {
      const next = new Set(prev);
      if (next.has(presetId)) next.delete(presetId);
      else next.add(presetId);
      return next;
    });
  }, []);

  const handleAddMacroArc = useCallback(async () => {
    if (!currentProject) return;
    const existingCount = macroArcs.length;
    const newMacroArc = {
      project_id: currentProject.id,
      order_index: existingCount,
      title: `Cột mốc ${existingCount + 1}`,
      description: '',
      chapter_from: 0,
      chapter_to: 0,
      emotional_peak: '',
      contract_json: '',
    };
    try {
      const id = await db.macro_arcs.add(newMacroArc);
      setMacroArcs((prev) => [...prev, { ...newMacroArc, id }]);
    } catch (error) {
      console.error('[StoryBible] addMacroArc error:', error);
    }
  }, [currentProject, macroArcs.length]);

  const handleUpdateMacroArc = useCallback((id, field, value) => {
    setMacroArcs((prev) => prev.map((macroArc) => (
      macroArc.id === id ? { ...macroArc, [field]: value } : macroArc
    )));
    if (macroArcSaveTimerRef.current) {
      clearTimeout(macroArcSaveTimerRef.current);
    }
    macroArcSaveTimerRef.current = setTimeout(async () => {
      try {
        const latestMacroArc = macroArcsRef.current.find((item) => item.id === id);
        const macroArcForSave = latestMacroArc
          ? { ...latestMacroArc, [field]: value }
          : { id, [field]: value };
        const contractJson = deriveMacroArcContractJson(macroArcForSave);
        await db.macro_arcs.update(id, {
          [field]: value,
          contract_json: contractJson,
        });
      } catch (error) {
        console.error('[StoryBible] updateMacroArc error:', error);
      }
    }, 600);
  }, []);

  const handleDeleteMacroArc = useCallback(async (id) => {
    try {
      await db.macro_arcs.delete(id);
      setMacroArcs((prev) => prev.filter((macroArc) => macroArc.id !== id));
    } catch (error) {
      console.error('[StoryBible] deleteMacroArc error:', error);
    }
  }, []);

  return {
    macroArcs,
    aiIdeaInput,
    setAiIdeaInput,
    aiMilestoneCount,
    setAiMilestoneCount,
    aiMilestoneRequirements,
    setAiMilestoneRequirements,
    aiMilestoneChapterPlans: normalizedMilestoneChapterPlans,
    handleUpdateMilestoneChapterPlan,
    resetMilestoneChapterPlans,
    planningScopeStart,
    setPlanningScopeStart,
    planningScopeEnd,
    setPlanningScopeEnd,
    planningScopeSpan: effectivePlanningScope.span,
    planningScopeTargetLength: planningScopeDefaults.safeTarget,
    planningScopeHasExplicitTargetLength: planningScopeDefaults.hasExplicitTargetLength,
    planningScopeDefaultsToWholeStory: effectivePlanningScope.start === 1 && effectivePlanningScope.end === planningScopeDefaults.safeTarget,
    planningScopeWarnings,
    uncoveredScopeChapters,
    autoMilestoneCount,
    hasBlockingMilestonePlanIssue,
    useDefaultPlanningScope,
    useWholeStoryPlanningScope,
    showAiSuggest,
    setShowAiSuggest,
    aiMilestoneRevisionPrompt,
    setAiMilestoneRevisionPrompt,
    editableMilestoneSuggestions,
    selectedMilestoneIdxs,
    setSelectedMilestoneIdxs,
    selectedMilestonePresets,
    suggestedMilestoneCount,
    isSuggestingMilestones,
    isRevisingMilestones,
    analyzingMacroContractKeys,
    getEditableMilestoneAnalyzeKey,
    getSavedMacroArcAnalyzeKey,
    handleGenerateMilestones,
    handleSaveMilestones,
    handleUpdateEditableMilestone,
    handleAnalyzeEditableMilestone,
    handleAnalyzeSavedMacroArc,
    handleRemoveEditableMilestone,
    handleToggleEditableMilestoneSelection,
    handleAddEditableMilestone,
    handleReviseMilestones,
    toggleMilestonePreset,
    resetAiSuggestPanel,
    handleAddMacroArc,
    handleUpdateMacroArc,
    handleDeleteMacroArc,
  };
}
