import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { syncDraftMap } from '../utils/storyBibleHelpers';

export default function useStoryBibleDrafts({
  currentProjectId,
  characters,
  locations,
  objects,
  worldTerms,
  canonFacts,
  createCanonFact,
  updateCanonFact,
  deleteCanonFact,
  updateCharacter,
  updateLocation,
  updateObject,
  updateWorldTerm,
}) {
  const [characterDrafts, setCharacterDrafts] = useState({});
  const [locationDrafts, setLocationDrafts] = useState({});
  const [objectDrafts, setObjectDrafts] = useState({});
  const [worldTermDrafts, setWorldTermDrafts] = useState({});
  const [canonFactDrafts, setCanonFactDrafts] = useState({});
  const characterSaveTimersRef = useRef({});
  const locationSaveTimersRef = useRef({});
  const objectSaveTimersRef = useRef({});
  const worldTermSaveTimersRef = useRef({});
  const canonFactSaveTimersRef = useRef({});

  useEffect(() => {
    setCharacterDrafts((previousDrafts) => syncDraftMap(previousDrafts, characters, (item) => ({
      role: item.role || 'supporting',
      name: item.name || '',
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
    setLocationDrafts((previousDrafts) => syncDraftMap(previousDrafts, locations, (item) => ({
      name: item.name || '',
      description: item.description || '',
      details: item.details || '',
    })));
  }, [locations]);

  useEffect(() => {
    setObjectDrafts((previousDrafts) => syncDraftMap(previousDrafts, objects, (item) => ({
      name: item.name || '',
      description: item.description || '',
      properties: item.properties || '',
      owner_character_id: item.owner_character_id || '',
    })));
  }, [objects]);

  useEffect(() => {
    setWorldTermDrafts((previousDrafts) => syncDraftMap(previousDrafts, worldTerms, (item) => ({
      name: item.name || '',
      definition: item.definition || '',
      category: item.category || 'other',
    })));
  }, [worldTerms]);

  useEffect(() => {
    setCanonFactDrafts((previousDrafts) => syncDraftMap(previousDrafts, canonFacts, (item) => ({
      fact_type: item.fact_type || 'fact',
      description: item.description || '',
    })));
  }, [canonFacts]);

  useEffect(() => () => {
    [
      characterSaveTimersRef,
      locationSaveTimersRef,
      objectSaveTimersRef,
      worldTermSaveTimersRef,
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
    setCharacterDrafts((prev) => ({
      ...prev,
      [id]: {
        ...(prev[id] || {}),
        [field]: value,
      },
    }));
    scheduleDraftPersist(characterSaveTimersRef, id, () => updateCharacter(id, { [field]: value }));
  }, [scheduleDraftPersist, updateCharacter]);

  const handleLocationDraftChange = useCallback((id, field, value) => {
    setLocationDrafts((prev) => ({
      ...prev,
      [id]: {
        ...(prev[id] || {}),
        [field]: value,
      },
    }));
    scheduleDraftPersist(locationSaveTimersRef, id, () => updateLocation(id, { [field]: value }));
  }, [scheduleDraftPersist, updateLocation]);

  const handleObjectDraftChange = useCallback((id, field, value) => {
    setObjectDrafts((prev) => ({
      ...prev,
      [id]: {
        ...(prev[id] || {}),
        [field]: value,
      },
    }));
    scheduleDraftPersist(objectSaveTimersRef, id, () => updateObject(id, { [field]: value }));
  }, [scheduleDraftPersist, updateObject]);

  const handleWorldTermDraftChange = useCallback((id, field, value) => {
    setWorldTermDrafts((prev) => ({
      ...prev,
      [id]: {
        ...(prev[id] || {}),
        [field]: value,
      },
    }));
    scheduleDraftPersist(worldTermSaveTimersRef, id, () => updateWorldTerm(id, { [field]: value }));
  }, [scheduleDraftPersist, updateWorldTerm]);

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
    locationDrafts,
    objectDrafts,
    worldTermDrafts,
    canonFactDrafts,
    activeCanonFacts,
    deprecatedCanonFacts,
    handleCharacterDraftChange,
    handleLocationDraftChange,
    handleObjectDraftChange,
    handleWorldTermDraftChange,
    handleCanonFactDraftChange,
    handleAddCanonFact,
    handleArchiveCanonFact,
    handleRestoreCanonFact,
    handleDeleteCanonFactPermanent,
  };
}
