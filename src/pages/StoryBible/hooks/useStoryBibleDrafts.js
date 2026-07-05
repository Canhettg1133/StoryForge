import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { syncDraftMap } from '../utils/storyBibleHelpers';

export default function useStoryBibleDrafts({
  currentProjectId,
  characters,
  canonFacts,
  createCanonFact,
  updateCanonFact,
  deleteCanonFact,
  updateCharacter,
}) {
  const [characterDrafts, setCharacterDrafts] = useState({});
  const [canonFactDrafts, setCanonFactDrafts] = useState({});
  const characterSaveTimersRef = useRef({});
  const canonFactSaveTimersRef = useRef({});

  useEffect(() => {
    setCharacterDrafts((previousDrafts) => syncDraftMap(previousDrafts, characters, (item) => ({
      role: item.role || 'supporting',
      name: item.name || '',
      specific_role: item.specific_role || '',
      specific_role_locked: Boolean(item.specific_role_locked && String(item.specific_role || '').trim()),
      age: item.age || '',
      appearance: item.appearance || '',
      personality: item.personality || '',
      personality_tags: item.personality_tags || '',
      current_status: item.current_status || '',
      goals: item.goals || '',
      flaws: item.flaws || '',
      pronouns_self: item.pronouns_self || '',
      pronouns_other: item.pronouns_other || '',
    })));
  }, [characters]);

  useEffect(() => {
    setCanonFactDrafts((previousDrafts) => syncDraftMap(previousDrafts, canonFacts, (item) => ({
      fact_type: item.fact_type || 'fact',
      description: item.description || '',
    })));
  }, [canonFacts]);

  useEffect(() => () => {
    [
      characterSaveTimersRef,
      canonFactSaveTimersRef,
    ].forEach((ref) => {
      Object.values(ref.current || {}).forEach((timer) => clearTimeout(timer));
    });
  }, []);

  const scheduleDraftPersist = useCallback((timersRef, id, fn, delay = 350) => {
    if (timersRef.current[id]) {
      clearTimeout(timersRef.current[id]);
    }
    timersRef.current[id] = setTimeout(async () => {
      try {
        await fn();
      } finally {
        delete timersRef.current[id];
      }
    }, delay);
  }, []);

  const handleCharacterDraftChange = useCallback((id, field, value) => {
    const currentDraft = characterDrafts[id] || {};
    const patch = { [field]: value };
    if (field === 'specific_role') {
      const previousRole = String(currentDraft.specific_role || '').trim();
      const nextRole = String(value || '').trim();
      patch.specific_role = value;
      patch.specific_role_locked = nextRole
        ? (previousRole ? Boolean(currentDraft.specific_role_locked) : true)
        : false;
    }
    if (field === 'specific_role_locked') {
      const specificRole = String(currentDraft.specific_role || '').trim();
      patch.specific_role_locked = Boolean(value && specificRole);
    }
    setCharacterDrafts((prev) => {
      const previousDraft = prev[id] || {};
      const nextDraft = {
        ...previousDraft,
        ...patch,
      };
      return {
        ...prev,
        [id]: nextDraft,
      };
    });
    scheduleDraftPersist(characterSaveTimersRef, id, () => updateCharacter(id, patch));
  }, [characterDrafts, scheduleDraftPersist, updateCharacter]);

  const handleCanonFactDraftChange = useCallback((id, field, value) => {
    setCanonFactDrafts((prev) => ({
      ...prev,
      [id]: {
        ...(prev[id] || {}),
        [field]: value,
      },
    }));
    scheduleDraftPersist(canonFactSaveTimersRef, id, () => updateCanonFact(id, { [field]: value }));
  }, [scheduleDraftPersist, updateCanonFact]);

  const handleAddCanonFact = useCallback(() => {
    if (!currentProjectId) return;
    createCanonFact({
      project_id: currentProjectId,
      description: '',
      fact_type: 'fact',
      status: 'active',
    });
  }, [createCanonFact, currentProjectId]);

  const handleArchiveCanonFact = useCallback((id) => {
    updateCanonFact(id, { status: 'deprecated' });
  }, [updateCanonFact]);

  const handleRestoreCanonFact = useCallback((id) => {
    updateCanonFact(id, { status: 'active' });
  }, [updateCanonFact]);

  const handleDeleteCanonFactPermanent = useCallback((id) => {
    deleteCanonFact(id);
  }, [deleteCanonFact]);

  const activeCanonFacts = useMemo(() => canonFacts.filter((fact) => fact.status === 'active'), [canonFacts]);
  const deprecatedCanonFacts = useMemo(() => canonFacts.filter((fact) => fact.status === 'deprecated'), [canonFacts]);

  return {
    characterDrafts,
    canonFactDrafts,
    activeCanonFacts,
    deprecatedCanonFacts,
    handleCharacterDraftChange,
    handleCanonFactDraftChange,
    handleAddCanonFact,
    handleArchiveCanonFact,
    handleRestoreCanonFact,
    handleDeleteCanonFactPermanent,
  };
}
