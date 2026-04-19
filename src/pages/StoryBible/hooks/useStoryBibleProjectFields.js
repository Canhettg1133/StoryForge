import { useCallback, useEffect, useMemo, useState } from 'react';
import { GENRE_TO_PRONOUN_STYLE, PRONOUN_STYLE_PRESETS } from '../../../utils/constants';
import { getSuggestedMacroMilestoneCount } from '../utils/storyBibleHelpers';

function useAutoSave(value, saveFn, delay = 800) {
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setSaved(false);
    const timer = setTimeout(() => {
      if (value !== undefined) {
        saveFn(value);
        setSaved(true);
        setTimeout(() => setSaved(false), 1500);
      }
    }, delay);
    return () => clearTimeout(timer);
  }, [delay, saveFn, value]);

  return saved;
}

export default function useStoryBibleProjectFields({ currentProject, updateProjectSettings }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [genrePrimary, setGenrePrimary] = useState('fantasy');
  const [tone, setTone] = useState('');
  const [povMode, setPovMode] = useState('third_limited');
  const [pronounStyle, setPronounStyle] = useState('hien_dai');
  const [synopsis, setSynopsis] = useState('');
  const [storyStructure, setStoryStructure] = useState('');
  const [aiStrictness, setAiStrictness] = useState('balanced');
  const [nsfwMode, setNsfwMode] = useState(false);
  const [superNsfwMode, setSuperNsfwMode] = useState(false);
  const [targetLength, setTargetLength] = useState(0);
  const [targetLengthType, setTargetLengthType] = useState('unset');
  const [ultimateGoal, setUltimateGoal] = useState('');
  const [milestonesInfo, setMilestonesInfo] = useState([]);

  useEffect(() => {
    if (!currentProject) return;
    setTitle(currentProject.title || '');
    setDescription(currentProject.description || '');
    setGenrePrimary(currentProject.genre_primary || 'fantasy');
    setTone(currentProject.tone || '');
    setPovMode(currentProject.pov_mode || 'third_limited');
    setPronounStyle(currentProject.pronoun_style || GENRE_TO_PRONOUN_STYLE[currentProject.genre_primary] || 'hien_dai');
    setSynopsis(currentProject.synopsis || '');
    setStoryStructure(currentProject.story_structure || '');
    setAiStrictness(currentProject.ai_strictness || 'balanced');
    setNsfwMode(currentProject.nsfw_mode || false);
    setSuperNsfwMode(currentProject.super_nsfw_mode || false);
    setTargetLength(currentProject.target_length || 0);
    setTargetLengthType(currentProject.target_length_type || 'unset');
    setUltimateGoal(currentProject.ultimate_goal || '');
    try {
      setMilestonesInfo(JSON.parse(currentProject.milestones || '[]'));
    } catch (error) {
      setMilestonesInfo([]);
    }
  }, [currentProject]);

  const save = useCallback((data) => updateProjectSettings(data), [updateProjectSettings]);

  const titleSaved = useAutoSave(title, (value) => save({ title: value }));
  const descSaved = useAutoSave(description, (value) => save({ description: value }));
  const synopsisSaved = useAutoSave(synopsis, (value) => save({ synopsis: value }));
  const ultimateGoalSaved = useAutoSave(ultimateGoal, (value) => save({ ultimate_goal: value }));
  const targetLengthSaved = useAutoSave(targetLength, (value) => save({ target_length: Number(value) || 0 }));
  const milestonesSaved = useAutoSave(milestonesInfo, (value) => save({ milestones: JSON.stringify(value) }), 1500);

  const currentPronoun = useMemo(
    () => PRONOUN_STYLE_PRESETS.find((preset) => preset.value === pronounStyle),
    [pronounStyle]
  );
  const suggestedMilestoneCount = useMemo(
    () => getSuggestedMacroMilestoneCount(targetLength),
    [targetLength]
  );

  const handleTargetLengthTypeChange = useCallback((value) => {
    setTargetLengthType(value);
    let newLength = targetLength;
    if (value === 'short') newLength = 50;
    else if (value === 'medium') newLength = 150;
    else if (value === 'long') newLength = 400;
    else if (value === 'epic') newLength = 800;
    setTargetLength(newLength);
    save({ target_length_type: value, target_length: newLength });
  }, [save, targetLength]);

  const addMilestone = useCallback(() => {
    setMilestonesInfo((prev) => [...prev, { percent: 50, description: '' }]);
  }, []);

  const updateMilestone = useCallback((index, field, value) => {
    setMilestonesInfo((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  }, []);

  const removeMilestone = useCallback((index) => {
    setMilestonesInfo((prev) => prev.filter((_, itemIndex) => itemIndex !== index));
  }, []);

  const handleGenreChange = useCallback((value) => {
    setGenrePrimary(value);
    const nextPronounStyle = GENRE_TO_PRONOUN_STYLE[value] || 'hien_dai';
    setPronounStyle(nextPronounStyle);
    save({ genre_primary: value, pronoun_style: nextPronounStyle });
  }, [save]);

  const handleToneChange = useCallback((value) => {
    setTone(value);
    save({ tone: value });
  }, [save]);

  const handlePovChange = useCallback((value) => {
    setPovMode(value);
    save({ pov_mode: value });
  }, [save]);

  const handlePronounChange = useCallback((value) => {
    setPronounStyle(value);
    save({ pronoun_style: value });
  }, [save]);

  const handleStructureChange = useCallback((value) => {
    setStoryStructure(value);
    save({ story_structure: value });
  }, [save]);

  const handleStrictnessChange = useCallback((value) => {
    setAiStrictness(value);
    save({ ai_strictness: value });
  }, [save]);

  return {
    title,
    setTitle,
    description,
    setDescription,
    genrePrimary,
    tone,
    povMode,
    pronounStyle,
    synopsis,
    setSynopsis,
    storyStructure,
    aiStrictness,
    nsfwMode,
    setNsfwMode,
    superNsfwMode,
    setSuperNsfwMode,
    targetLength,
    setTargetLength,
    targetLengthType,
    ultimateGoal,
    setUltimateGoal,
    milestonesInfo,
    titleSaved,
    descSaved,
    synopsisSaved,
    ultimateGoalSaved,
    targetLengthSaved,
    milestonesSaved,
    currentPronoun,
    suggestedMilestoneCount,
    save,
    handleTargetLengthTypeChange,
    addMilestone,
    updateMilestone,
    removeMilestone,
    handleGenreChange,
    handleToneChange,
    handlePovChange,
    handlePronounChange,
    handleStructureChange,
    handleStrictnessChange,
  };
}
