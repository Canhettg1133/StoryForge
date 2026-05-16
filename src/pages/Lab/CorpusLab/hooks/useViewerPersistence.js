/**
 * useViewerPersistence - Hook to connect database layer to AnalysisViewer state
 * Loads annotations, usage, saved searches, and handles all DB write operations
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  saveAnnotation,
  deleteAnnotation,
  toggleAnnotationStar,
  trackEventUsage,
  batchTrackUsage,
  getAnnotationMap,
  getUsageCountMap,
  linkEventToProject,
  unlinkEventFromProject,
  getEventsLinkedToProject,
  getProjectsLinkedToEvent,
  getEventLinksForCorpus,
  saveSearch,
  deleteSavedSearch,
  getSavedSearches,
  addToSearchHistory,
  getSearchHistory,
  clearSearchHistory,
  recordExport,
  getSavedSearches as getSavedSearchesDB,
} from '../../services/viewer/viewerDbService.js';

export default function useViewerPersistence({ corpusId, displayEvents = [] }) {
  // Annotations state
  const [annotationMap, setAnnotationMap] = useState({});
  const [usageCountMap, setUsageCountMap] = useState({});
  const [linkedEvents, setLinkedEvents] = useState([]);
  const [savedSearches, setSavedSearches] = useState([]);
  const [searchHistory, setSearchHistory] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const initializedRef = useRef(false);

  // Load all data on corpus change
  useEffect(() => {
    if (!corpusId) return;

    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const [annMap, usgMap, links, searches, history] = await Promise.all([
          getAnnotationMap(corpusId),
          getUsageCountMap(corpusId),
          getEventLinksForCorpus(corpusId),
          getSavedSearchesDB(corpusId),
          getSearchHistory(corpusId),
        ]);

        setAnnotationMap(annMap);
        setUsageCountMap(usgMap);
        setLinkedEvents(links);
        setSavedSearches(searches);
        setSearchHistory(history);
        initializedRef.current = true;
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [corpusId]);

  // Inject annotations into events
  const eventsWithAnnotations = useMemo(() => {
    return displayEvents.map((event) => ({
      ...event,
      annotation: annotationMap[event.id] || null,
      usageCount: usageCountMap[event.id] || 0,
    }));
  }, [displayEvents, annotationMap, usageCountMap]);

  // ─── Annotation actions ───────────────────────────────────────────────────

  const handleSaveAnnotation = useCallback(async (eventId, data) => {
    try {
      await saveAnnotation(corpusId, eventId, data);
      setAnnotationMap((prev) => ({
        ...prev,
        [eventId]: {
          ...(prev[eventId] || {}),
          event_id: eventId,
          corpus_id: corpusId,
          note: data.note ?? '',
          customTags: data.customTags || [],
          custom_tags: data.customTags || [],
          starred: data.starred || false,
          linkedProjectIds: data.linkedProjectIds || [],
          linked_project_ids: data.linkedProjectIds || [],
          updated_at: Date.now(),
        },
      }));
    } catch (err) {
      setError(err.message);
    }
  }, [corpusId]);

  const handleDeleteAnnotation = useCallback(async (eventId) => {
    try {
      await deleteAnnotation(corpusId, eventId);
      setAnnotationMap((prev) => {
        const next = { ...prev };
        delete next[eventId];
        return next;
      });
    } catch (err) {
      setError(err.message);
    }
  }, [corpusId]);

  const handleToggleStar = useCallback(async (eventId) => {
    try {
      const newStarred = await toggleAnnotationStar(corpusId, eventId);
      setAnnotationMap((prev) => {
        const existing = prev[eventId];
        if (!existing) return prev;
        return {
          ...prev,
          [eventId]: { ...existing, starred: newStarred, updated_at: Date.now() },
        };
      });
      return newStarred;
    } catch (err) {
      setError(err.message);
      return null;
    }
  }, [corpusId]);

  // ─── Usage tracking ─────────────────────────────────────────────────────

  const handleTrackUsage = useCallback(async (eventId, action = 'export') => {
    try {
      const newCount = await trackEventUsage(corpusId, eventId, action);
      setUsageCountMap((prev) => ({
        ...prev,
        [eventId]: newCount,
      }));
      return newCount;
    } catch (err) {
      setError(err.message);
      return null;
    }
  }, [corpusId]);

  const handleBatchTrackUsage = useCallback(async (eventIds, action = 'export') => {
    try {
      await batchTrackUsage(corpusId, eventIds, action);
      const updatedMap = await getUsageCountMap(corpusId);
      setUsageCountMap(updatedMap);
    } catch (err) {
      setError(err.message);
    }
  }, [corpusId]);

  // ─── Search history ──────────────────────────────────────────────────────

  const handleAddToHistory = useCallback(async (query, filters = {}) => {
    try {
      await addToSearchHistory(corpusId, query, filters);
      const history = await getSearchHistory(corpusId);
      setSearchHistory(history);
    } catch (err) {
      setError(err.message);
    }
  }, [corpusId]);

  const handleClearHistory = useCallback(async () => {
    try {
      await clearSearchHistory(corpusId);
      setSearchHistory([]);
    } catch (err) {
      setError(err.message);
    }
  }, [corpusId]);

  const handleSaveSearch = useCallback(async (name, query, filters = {}) => {
    try {
      await saveSearch({ corpusId, name, query, filters });
      const searches = await getSavedSearchesDB(corpusId);
      setSavedSearches(searches);
    } catch (err) {
      setError(err.message);
    }
  }, [corpusId]);

  const handleDeleteSavedSearch = useCallback(async (id) => {
    try {
      await deleteSavedSearch(id);
      setSavedSearches((prev) => prev.filter((s) => s.id !== id));
    } catch (err) {
      setError(err.message);
    }
  }, []);

  // ─── Project linking ─────────────────────────────────────────────────────

  const handleLinkToProject = useCallback(async (eventId, projectId, chapterId = null, sceneId = null, notes = '') => {
    try {
      await linkEventToProject(eventId, corpusId, projectId, chapterId, sceneId, notes);
      const links = await getEventLinksForCorpus(corpusId);
      setLinkedEvents(links);
    } catch (err) {
      setError(err.message);
    }
  }, [corpusId]);

  const handleUnlinkFromProject = useCallback(async (eventId, projectId) => {
    try {
      await unlinkEventFromProject(eventId, projectId);
      setLinkedEvents((prev) =>
        prev.filter((l) => !(l.event_id === eventId && l.project_id === projectId))
      );
    } catch (err) {
      setError(err.message);
    }
  }, []);

  const handleRecordExport = useCallback(async (eventIds, format, options = {}) => {
    try {
      await recordExport(corpusId, eventIds, format, options);
      // Also track usage
      await handleBatchTrackUsage(eventIds, `export_${format}`);
    } catch (err) {
      setError(err.message);
    }
  }, [corpusId, handleBatchTrackUsage]);

  // ─── Get linked projects for specific events ─────────────────────────────

  const getLinkedProjectsForEvent = useCallback(async (eventId) => {
    try {
      return await getProjectsLinkedToEvent(eventId);
    } catch {
      return [];
    }
  }, []);

  const getLinkedProjectsForEvents = useCallback(async (eventIds) => {
    try {
      const results = {};
      for (const id of eventIds) {
        results[id] = await getProjectsLinkedToEvent(id);
      }
      return results;
    } catch {
      return {};
    }
  }, []);

  return {
    // Data
    eventsWithAnnotations,
    annotationMap,
    usageCountMap,
    linkedEvents,
    savedSearches,
    searchHistory,
    loading,
    error,

    // Actions
    handleSaveAnnotation,
    handleDeleteAnnotation,
    handleToggleStar,
    handleTrackUsage,
    handleBatchTrackUsage,
    handleAddToHistory,
    handleClearHistory,
    handleSaveSearch,
    handleDeleteSavedSearch,
    handleLinkToProject,
    handleUnlinkFromProject,
    handleRecordExport,
    getLinkedProjectsForEvent,
    getLinkedProjectsForEvents,
    clearError: () => setError(null),
  };
}
