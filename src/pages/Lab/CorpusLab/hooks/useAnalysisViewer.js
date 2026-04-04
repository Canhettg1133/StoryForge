/**
 * useAnalysisViewer - Main hook for AnalysisViewer page
 * Manages state, parsing, filtering, search, selection
 * Integrated with database layer for annotations, usage, saved searches
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import useCorpusStore from '../../../../stores/corpusStore';
import useAnalysisStore from '../../../../stores/analysisStore';
import {
  parseAnalysisResults,
  flattenEvents,
  buildMindMap,
  buildCharacterGraph,
  buildTimeline,
  getEventStats,
  AUTO_ACCEPT_QUALITY_THRESHOLD,
  AUTO_ACCEPT_CHAPTER_CONFIDENCE_THRESHOLD,
} from '../../../../services/viewer/analysisParser.js';
import { searchEvents } from '../../../../services/viewer/searchEngine.js';
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
  getEventLinksForCorpus,
  saveSearch,
  deleteSavedSearch,
  getSavedSearches,
  addToSearchHistory,
  getSearchHistory,
  clearSearchHistory,
  recordExport,
} from '../../../../services/viewer/viewerDbService.js';

const EMPTY_ARRAY = Object.freeze([]);

export const DEFAULT_FILTERS = {
  severity: 'all',
  rarity: 'all',
  canonFanon: 'all',
  tag: 'all',
  location: 'all',
  character: 'all',
  ship: 'all',
  minIntensity: 1,
  maxIntensity: 10,
  chapterMin: null,
  chapterMax: null,
  reviewStatus: 'all',
  hasAnnotation: false,
  starred: false,
  _type: 'all',
};

export const VIEW_MODES = ['incidents', 'list', 'mindmap', 'timeline', 'graph', 'compare'];

export default function useAnalysisViewer({ corpusId, analysisId }) {
  // Core state
  const [view, setView] = useState('incidents');
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [compareCorpusId, setCompareCorpusId] = useState(null);
  const [editingEvent, setEditingEvent] = useState(null);
  const [annotatingEvent, setAnnotatingEvent] = useState(null);
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [linkModalEvent, setLinkModalEvent] = useState(null);
  const [adaptPanelOpen, setAdaptPanelOpen] = useState(false);
  const [savingAnnotation, setSavingAnnotation] = useState(false);

  // Database state
  const [annotationMap, setAnnotationMap] = useState({});
  const [usageCountMap, setUsageCountMap] = useState({});
  const [linkedEvents, setLinkedEvents] = useState([]);
  const [savedSearches, setSavedSearches] = useState([]);
  const [searchHistory, setSearchHistory] = useState([]);
  const [dbLoading, setDbLoading] = useState(false);
  const [dbError, setDbError] = useState(null);

  const initializedRef = useRef(false);

  // Stores
  const corpus = useCorpusStore((state) => state.corpuses[corpusId]);
  const analyses = useAnalysisStore((state) => state.analyses);
  const analysisIdsForCorpus = useAnalysisStore(
    (state) => state.analysisIdsByCorpus[corpusId] ?? EMPTY_ARRAY,
  );
  const loadAnalyses = useAnalysisStore((state) => state.loadAnalyses);

  // Get the analysis object
  const analysis = useMemo(() => {
    if (analysisId && analyses[analysisId]) {
      return analyses[analysisId];
    }

    if (!analysisIdsForCorpus.length) {
      return null;
    }

    const candidates = analysisIdsForCorpus
      .map((id) => analyses[id])
      .filter(Boolean)
      .sort((a, b) => Number(b.completedAt || b.createdAt || 0) - Number(a.completedAt || a.createdAt || 0));

    return candidates[0] || null;
  }, [analysisId, analyses, analysisIdsForCorpus]);

  // Parse analysis results
  const parsed = useMemo(() => {
    const rawPayload = analysis?.result ?? analysis?.finalResult ?? null;
    if (!rawPayload) return null;

    try {
      const raw = typeof rawPayload === 'string'
        ? JSON.parse(rawPayload)
        : rawPayload;

      return parseAnalysisResults(raw);
    } catch (e) {
      console.warn('Failed to parse analysis results:', e);
      return null;
    }
  }, [analysis]);

  // Flatten all events
  const allEvents = useMemo(() => {
    if (!parsed?.events) return [];
    return flattenEvents(parsed.events);
  }, [parsed]);

  // Inject annotations and usage into events
  const allEventsWithAnnotations = useMemo(() => {
    return allEvents.map((event) => ({
      ...event,
      annotation: annotationMap[event.id] || null,
      usageCount: usageCountMap[event.id] || 0,
    }));
  }, [allEvents, annotationMap, usageCountMap]);

  // Character graph data
  const characterGraph = useMemo(() => {
    if (!parsed) return { nodes: [], edges: [] };
    return buildCharacterGraph(parsed.characterProfiles || [], parsed.relationships || []);
  }, [parsed]);

  // Timeline data
  const timelineData = useMemo(() => {
    return buildTimeline(allEventsWithAnnotations);
  }, [allEventsWithAnnotations]);

  const locations = useMemo(() => {
    return Array.isArray(parsed?.locations) ? parsed.locations : [];
  }, [parsed]);

  const incidentClusters = useMemo(() => {
    const parsedIncidents = Array.isArray(parsed?.incidents) ? parsed.incidents : [];
    if (parsedIncidents.length > 0) {
      return parsedIncidents;
    }
    return buildIncidentFallback(allEventsWithAnnotations);
  }, [parsed, allEventsWithAnnotations]);

  // Statistics
  const stats = useMemo(() => {
    if (!parsed?.events) return null;
    return getEventStats(parsed.events);
  }, [parsed]);

  const qualityStats = useMemo(() => {
    const total = allEvents.length;
    const missingChapter = allEvents.filter(
      (event) => !(Number.isFinite(Number(event.chapter)) && Number(event.chapter) > 0),
    ).length;
    const lowQuality = allEvents.filter(
      (event) => Number(event.quality?.score || 0) < AUTO_ACCEPT_QUALITY_THRESHOLD,
    ).length;
    const autoAccepted = allEvents.filter(
      (event) => event.reviewStatus === 'auto_accepted',
    ).length;
    const needsReview = allEvents.filter(
      (event) => event.reviewStatus === 'needs_review' || event.needsReview,
    ).length;

    return {
      total,
      missingChapter,
      missingChapterRate: total > 0 ? (missingChapter / total) : 0,
      lowQuality,
      lowQualityRate: total > 0 ? (lowQuality / total) : 0,
      autoAccepted,
      autoAcceptedRate: total > 0 ? (autoAccepted / total) : 0,
      needsReview,
      needsReviewRate: total > 0 ? (needsReview / total) : 0,
    };
  }, [allEvents]);

  // All available tags
  const allTags = useMemo(() => {
    const tagSet = new Set();
    for (const event of allEvents) {
      for (const tag of (event.tags || [])) {
        tagSet.add(tag);
      }
    }
    return [...tagSet].sort();
  }, [allEvents]);

  // All available characters
  const allCharacters = useMemo(() => {
    const charSet = new Set();
    for (const event of allEvents) {
      for (const char of (event.characters || [])) {
        charSet.add(char);
      }
    }
    return [...charSet].sort();
  }, [allEvents]);

  // All available ships
  const allShips = useMemo(() => {
    const shipSet = new Set();
    for (const event of allEvents) {
      for (const ship of (event.ships || [])) {
        shipSet.add(ship);
      }
    }
    return [...shipSet].sort();
  }, [allEvents]);

  const allLocations = useMemo(() => {
    const map = new Map();
    for (const location of locations) {
      if (!location?.name) continue;
      map.set(location.id || location.name, location.name);
    }
    for (const event of allEvents) {
      const name = event.locationLink?.locationName || event.primaryLocationName;
      const id = event.locationLink?.locationId || name;
      if (!name || !id) continue;
      map.set(id, name);
    }
    return [...map.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [allEvents, locations]);

  // Search results
  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return null;
    return searchEvents(allEventsWithAnnotations, searchQuery, {
      searchIn: ['description', 'annotation'],
      filters,
    });
  }, [allEventsWithAnnotations, searchQuery, filters]);

  // Filtered + searched events
  const displayEvents = useMemo(() => {
    if (searchResults) return searchResults;

    return allEventsWithAnnotations.filter(event => {
      const chapterValue = Number.isFinite(Number(event.chapter)) ? Number(event.chapter) : null;
      const intensityValue = Number.isFinite(Number(event.emotionalIntensity))
        ? Number(event.emotionalIntensity)
        : null;
      if (filters.severity !== 'all' && event.severity !== filters.severity) return false;
      if (filters.rarity !== 'all' && event.rarity?.score !== filters.rarity) return false;
      if (filters.canonFanon !== 'all' && event.canonOrFanon?.type !== filters.canonFanon) return false;
      if (filters.tag !== 'all' && !(event.tags || []).includes(filters.tag)) return false;
      if (filters.location !== 'all') {
        const eventLocationId = event.locationLink?.locationId || event.primaryLocationId || event.primaryLocationName;
        if (eventLocationId !== filters.location) return false;
      }
      if (filters.character !== 'all' && !(event.characters || []).includes(filters.character)) return false;
      if (filters.ship !== 'all' && !(event.ships || []).includes(filters.ship)) return false;
      if (filters.minIntensity > 1 && intensityValue != null && intensityValue < filters.minIntensity) return false;
      if (filters.maxIntensity < 10 && intensityValue != null && intensityValue > filters.maxIntensity) return false;
      if (filters.chapterMin && (chapterValue == null || chapterValue < filters.chapterMin)) return false;
      if (filters.chapterMax && (chapterValue == null || chapterValue > filters.chapterMax)) return false;
      if (filters.reviewStatus !== 'all' && event.reviewStatus !== filters.reviewStatus) return false;
      if (filters.hasAnnotation && !event.annotation?.note) return false;
      if (filters.starred && !event.annotation?.starred) return false;
      if (filters._type !== 'all' && event._type !== filters._type) return false;
      return true;
    });
  }, [allEventsWithAnnotations, filters, searchResults]);

  const displayIncidents = useMemo(() => {
    if (!incidentClusters.length) return [];
    if (!displayEvents.length) return [];

    const displayIdSet = new Set(displayEvents.map((item) => item.id));
    return incidentClusters
      .map((incident) => {
        const eventIds = Array.isArray(incident.eventIds) ? incident.eventIds : [];
        const matchedIds = eventIds.filter((id) => displayIdSet.has(id));
        if (matchedIds.length === 0) {
          return null;
        }

        return {
          ...incident,
          filteredEventIds: matchedIds,
          filteredEventCount: matchedIds.length,
        };
      })
      .filter(Boolean);
  }, [incidentClusters, displayEvents]);

  // Selected items
  const selectedItems = useMemo(() => {
    return displayEvents.filter(e => selectedIds.has(e.id));
  }, [displayEvents, selectedIds]);

  // Mind map data
  const mindMapData = useMemo(() => {
    return buildMindMap(displayEvents);
  }, [displayEvents]);

  // Quick select counters (based on currently displayed events)
  const quickSelectCounts = useMemo(() => {
    let rare = 0;
    let crucial = 0;
    let angst = 0;
    let canon = 0;
    let fanon = 0;
    let highIntensity = 0;
    let autoAccepted = 0;
    let needsReview = 0;
    let annotated = 0;
    let starred = 0;

    for (const event of displayEvents) {
      if (event.rarity?.score === 'rare') rare += 1;
      if (event.severity === 'crucial') crucial += 1;
      if ((event.tags || []).includes('angst')) angst += 1;
      if (event.canonOrFanon?.type === 'canon') canon += 1;
      if (event.canonOrFanon?.type === 'fanon') fanon += 1;
      if ((event.emotionalIntensity || 0) >= 8) highIntensity += 1;
      if (event.reviewStatus === 'auto_accepted') autoAccepted += 1;
      if (event.reviewStatus === 'needs_review' || event.needsReview) needsReview += 1;
      if (event.annotation?.note) annotated += 1;
      if (event.annotation?.starred) starred += 1;
    }

    return {
      rare,
      crucial,
      angst,
      canon,
      fanon,
      highIntensity,
      autoAccepted,
      needsReview,
      annotated,
      starred,
    };
  }, [displayEvents]);

  // Load database data when corpus changes
  const loadDbData = useCallback(async () => {
    if (!corpusId) return;

    setDbLoading(true);
    setDbError(null);

    try {
      const [annMap, usgMap, links, searches, history] = await Promise.all([
        getAnnotationMap(corpusId),
        getUsageCountMap(corpusId),
        getEventLinksForCorpus(corpusId),
        getSavedSearches(corpusId),
        getSearchHistory(corpusId),
      ]);

      setAnnotationMap(annMap);
      setUsageCountMap(usgMap);
      setLinkedEvents(links);
      setSavedSearches(searches);
      setSearchHistory(history);
      initializedRef.current = true;
    } catch (err) {
      setDbError(err.message);
    } finally {
      setDbLoading(false);
    }
  }, [corpusId]);

  useEffect(() => {
    loadDbData();
  }, [loadDbData]);

  // Load analyses when corpusId changes (for direct viewer navigation)
  useEffect(() => {
    if (!corpusId) return;
    loadAnalyses(corpusId).catch(() => {});
  }, [corpusId, loadAnalyses]);

  // Add search to history on query change
  const prevQueryRef = useRef('');
  useEffect(() => {
    if (searchQuery && searchQuery !== prevQueryRef.current && searchQuery.trim()) {
      addToSearchHistory(corpusId, searchQuery, filters).catch(() => {});
    }
    prevQueryRef.current = searchQuery;
  }, [searchQuery, corpusId, filters]);

  // Toggle selection
  const toggleSelection = useCallback((eventId) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(eventId)) {
        next.delete(eventId);
      } else {
        next.add(eventId);
      }
      return next;
    });
  }, []);

  // Select all
  const selectAll = useCallback(() => {
    setSelectedIds(new Set(displayEvents.map(e => e.id)));
  }, [displayEvents]);

  // Clear selection
  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  // Quick select helpers
  const quickSelect = useCallback((type, value) => {
    const matches = displayEvents.filter(e => {
      switch (type) {
        case 'severity': return e.severity === value;
        case 'rarity': return e.rarity?.score === value;
        case 'tag': return (e.tags || []).includes(value);
        case 'canonFanon': return e.canonOrFanon?.type === value;
        case 'intensity': return e.emotionalIntensity >= value;
        case 'reviewStatus': return e.reviewStatus === value;
        case 'starred': return e.annotation?.starred;
        case 'hasAnnotation': return Boolean(e.annotation?.note);
        default: return false;
      }
    });

    const matchIds = matches.map((event) => event.id);
    const matchedCount = matchIds.length;
    const addedCount = matchIds.reduce(
      (count, id) => count + (selectedIds.has(id) ? 0 : 1),
      0,
    );

    setSelectedIds(prev => {
      const next = new Set(prev);
      for (const id of matchIds) {
        next.add(id);
      }
      return next;
    });

    return {
      type,
      value,
      matchedCount,
      addedCount,
      unchangedCount: matchedCount - addedCount,
    };
  }, [displayEvents, selectedIds]);

  // Filter actions
  const resetFilters = useCallback(() => {
    setFilters(DEFAULT_FILTERS);
  }, []);

  const updateFilter = useCallback((key, value) => {
    setFilters(prev => ({ ...prev, [key]: value }));
  }, []);

  // Edit event
  const handleEditEvent = useCallback((event) => {
    setEditingEvent(event);
  }, []);

  const handleSaveEvent = useCallback((updatedEvent) => {
    setEditingEvent(null);
  }, []);

  // Annotate event
  const handleAddAnnotation = useCallback((event) => {
    setAnnotatingEvent(event);
  }, []);

  const handleSaveAnnotation = useCallback(async (annotationData) => {
    if (!corpusId || !annotatingEvent) return;

    setSavingAnnotation(true);
    try {
      await saveAnnotation(corpusId, annotatingEvent.id, annotationData);
      // Reload annotation map
      const annMap = await getAnnotationMap(corpusId);
      setAnnotationMap(annMap);
      setAnnotatingEvent(null);
    } catch (err) {
      setDbError(err.message);
    } finally {
      setSavingAnnotation(false);
    }
  }, [corpusId, annotatingEvent]);

  const handleToggleStar = useCallback(async (eventId) => {
    if (!corpusId) return;
    try {
      const newStarred = await toggleAnnotationStar(corpusId, eventId);
      setAnnotationMap(prev => {
        const existing = prev[eventId];
        if (!existing) return prev;
        return {
          ...prev,
          [eventId]: { ...existing, starred: newStarred, updated_at: Date.now() },
        };
      });
    } catch (err) {
      setDbError(err.message);
    }
  }, [corpusId]);

  // Usage tracking
  const handleTrackUsage = useCallback(async (eventId, action = 'export') => {
    if (!corpusId) return;
    try {
      const newCount = await trackEventUsage(corpusId, eventId, action);
      setUsageCountMap(prev => ({ ...prev, [eventId]: newCount }));
    } catch (err) {
      setDbError(err.message);
    }
  }, [corpusId]);

  // Saved searches
  const handleSaveCurrentSearch = useCallback(async (name) => {
    if (!corpusId || !name?.trim()) return;
    try {
      await saveSearch({ corpusId, name: name.trim(), query: searchQuery, filters });
      const searches = await getSavedSearches(corpusId);
      setSavedSearches(searches);
    } catch (err) {
      setDbError(err.message);
    }
  }, [corpusId, searchQuery, filters]);

  const handleDeleteSavedSearch = useCallback(async (id) => {
    try {
      await deleteSavedSearch(id);
      setSavedSearches(prev => prev.filter(s => s.id !== id));
    } catch (err) {
      setDbError(err.message);
    }
  }, []);

  const handleLoadSavedSearch = useCallback((saved) => {
    setSearchQuery(saved.query || '');
    if (saved.filters) {
      const parsedFilters = typeof saved.filters === 'string'
        ? JSON.parse(saved.filters)
        : saved.filters;
      setFilters({ ...DEFAULT_FILTERS, ...(parsedFilters || {}) });
    }
  }, []);

  const handleClearHistory = useCallback(async () => {
    if (!corpusId) return;
    try {
      await clearSearchHistory(corpusId);
      setSearchHistory([]);
    } catch (err) {
      setDbError(err.message);
    }
  }, [corpusId]);

  // Export with record
  const handleExport = useCallback(async (format) => {
    if (selectedIds.size === 0) return;

    // Record export to database
    try {
      await recordExport(corpusId, [...selectedIds], format);
      await batchTrackUsage(corpusId, [...selectedIds], `export_${format}`);
      const usgMap = await getUsageCountMap(corpusId);
      setUsageCountMap(usgMap);
    } catch (err) {
      setDbError(err.message);
    }

    setExportModalOpen(true);
  }, [corpusId, selectedIds]);

  // Project linking
  const handleLinkToProject = useCallback(async ({ eventId, projectId, chapterId, sceneId, notes }) => {
    if (!corpusId) return;
    try {
      await linkEventToProject(eventId, corpusId, projectId, chapterId, sceneId, notes);
      const links = await getEventLinksForCorpus(corpusId);
      setLinkedEvents(links);
      setLinkModalEvent(null);
    } catch (err) {
      setDbError(err.message);
    }
  }, [corpusId]);

  const handleUnlinkFromProject = useCallback(async (eventId, projectId) => {
    try {
      await unlinkEventFromProject(eventId, projectId);
      setLinkedEvents(prev => prev.filter(
        l => !(l.event_id === eventId && l.project_id === projectId)
      ));
    } catch (err) {
      setDbError(err.message);
    }
  }, []);

  return {
    // Data
    corpus,
    analysis,
    parsed,
    allEvents: allEventsWithAnnotations,
    displayEvents,
    selectedItems,
    searchResults,
    characterGraph,
    timelineData,
    locations,
    incidentClusters: displayIncidents,
    stats,
    qualityStats,
    autoAcceptThreshold: AUTO_ACCEPT_QUALITY_THRESHOLD,
    confidenceThreshold: AUTO_ACCEPT_CHAPTER_CONFIDENCE_THRESHOLD,
    mindMapData,

    // Metadata
    allTags,
    allLocations,
    allCharacters,
    allShips,
    quickSelectCounts,

    // UI State
    view,
    setView,
    filters,
    setFilters,
    searchQuery,
    setSearchQuery,
    selectedIds,
    compareCorpusId,
    setCompareCorpusId,
    editingEvent,
    annotatingEvent,
    exportModalOpen,
    linkModalEvent,
    setLinkModalEvent,
    adaptPanelOpen,
    setAdaptPanelOpen,
    savingAnnotation,

    // Database state
    annotationMap,
    usageCountMap,
    linkedEvents,
    savedSearches,
    searchHistory,
    dbLoading,
    dbError,

    // Actions
    toggleSelection,
    selectAll,
    clearSelection,
    quickSelect,
    resetFilters,
    updateFilter,
    handleEditEvent,
    handleSaveEvent,
    handleAddAnnotation,
    handleSaveAnnotation,
    handleToggleStar,
    handleExport,
    setExportModalOpen,
    setEditingEvent,
    setAnnotatingEvent,
    handleSaveCurrentSearch,
    handleDeleteSavedSearch,
    handleLoadSavedSearch,
    handleClearHistory,
    handleTrackUsage,
    handleLinkToProject,
    handleUnlinkFromProject,
    clearDbError: () => setDbError(null),

    // Count helpers
    displayCount: displayEvents.length,
    totalCount: allEvents.length,
    selectedCount: selectedIds.size,
    searchResultCount: searchResults?.length ?? null,
  };
}

function buildIncidentFallback(events = []) {
  if (!Array.isArray(events) || events.length === 0) {
    return [];
  }

  const buckets = new Map();

  for (const event of events) {
    const locationName = event.locationLink?.locationName || event.primaryLocationName || 'Chưa xác định địa điểm';
    const locationId = event.locationLink?.locationId || event.primaryLocationId || 'unknown';
    const chapter = Number.isFinite(Number(event.chapter)) ? Number(event.chapter) : 0;
    const chapterBucket = chapter > 0 ? Math.floor((chapter - 1) / 2) : 0;
    const key = `${locationId}|${chapterBucket}`;

    const existing = buckets.get(key) || {
      id: `incident_fallback_${locationId}_${chapterBucket}`,
      title: `${locationName} - Cụm sự kiện`,
      location: {
        id: locationId !== 'unknown' ? locationId : null,
        name: locationName,
        confidence: Number(event.locationLink?.confidence || 0),
        isMajor: Boolean(event.locationLink?.isMajorLocation),
      },
      chapterStart: chapter > 0 ? chapter : null,
      chapterEnd: chapter > 0 ? chapter : null,
      confidence: 0,
      eventIds: [],
      eventCount: 0,
      subeventCount: 0,
      anchorEventId: null,
      anchorEventDescription: '',
      evidenceSnippet: '',
      tags: [],
    };

    existing.eventIds.push(event.id);
    existing.eventCount += 1;
    existing.subeventCount = Math.max(0, existing.eventCount - 1);
    existing.confidence += Number(event.locationLink?.confidence || 0);

    if (chapter > 0) {
      existing.chapterStart = existing.chapterStart == null ? chapter : Math.min(existing.chapterStart, chapter);
      existing.chapterEnd = existing.chapterEnd == null ? chapter : Math.max(existing.chapterEnd, chapter);
    }

    if (!existing.anchorEventId || Number(event.quality?.score || 0) > Number(existing.anchorQuality || 0)) {
      existing.anchorEventId = event.id;
      existing.anchorEventDescription = event.description || '';
      existing.evidenceSnippet = event.locationLink?.evidenceSnippet || event.grounding?.evidenceSnippet || '';
      existing.anchorQuality = Number(event.quality?.score || 0);
      existing.title = `${locationName} - ${(event.description || 'Sự kiện').slice(0, 80)}`;
    }

    const newTags = Array.isArray(event.tags) ? event.tags : [];
    existing.tags = [...new Set([...existing.tags, ...newTags])].slice(0, 10);

    buckets.set(key, existing);
  }

  return [...buckets.values()]
    .map((item) => ({
      ...item,
      confidence: item.eventCount > 0 ? item.confidence / item.eventCount : 0,
      eventIds: [...new Set(item.eventIds)],
      eventCount: [...new Set(item.eventIds)].length,
    }))
    .sort((a, b) => Number(b.confidence || 0) - Number(a.confidence || 0));
}

