import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import db from '../../../services/db/database';
import useArcGenStore from '../../../stores/arcGenerationStore';
import {
  deriveMacroArcContractJson,
  getSuggestedMacroMilestoneCount,
} from '../utils/storyBibleHelpers';

export default function useStoryBibleMacroArcs({
  currentProject,
  title,
  synopsis,
  ultimateGoal,
  genrePrimary,
  targetLength,
}) {
  const [macroArcs, setMacroArcs] = useState([]);
  const [aiIdeaInput, setAiIdeaInput] = useState('');
  const [aiMilestoneCount, setAiMilestoneCount] = useState(5);
  const [aiMilestoneRequirements, setAiMilestoneRequirements] = useState('');
  const [showAiSuggest, setShowAiSuggest] = useState(false);
  const [aiMilestoneRevisionPrompt, setAiMilestoneRevisionPrompt] = useState('');
  const [editableMilestoneSuggestions, setEditableMilestoneSuggestions] = useState([]);
  const [selectedMilestoneIdxs, setSelectedMilestoneIdxs] = useState(new Set());
  const [selectedMilestonePresets, setSelectedMilestonePresets] = useState(() => new Set());
  const macroArcsRef = useRef([]);
  const macroArcSaveTimerRef = useRef(null);

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

  useEffect(() => {
    macroArcsRef.current = macroArcs;
  }, [macroArcs]);

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
    setAiMilestoneRevisionPrompt('');
    setEditableMilestoneSuggestions([]);
    setSelectedMilestoneIdxs(new Set());
    setSelectedMilestonePresets(new Set());
  }, [suggestedMilestoneCount]);

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
    });
    setSelectedMilestoneIdxs(new Set());
  }, [
    aiIdeaInput,
    aiMilestoneCount,
    buildMilestoneRequirements,
    currentProject,
    generateMacroMilestones,
    genrePrimary,
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
    });
  }, [
    aiIdeaInput,
    aiMilestoneCount,
    aiMilestoneRevisionPrompt,
    buildMilestoneRequirements,
    currentProject,
    editableMilestoneSuggestions,
    genrePrimary,
    macroMilestoneSuggestions,
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
