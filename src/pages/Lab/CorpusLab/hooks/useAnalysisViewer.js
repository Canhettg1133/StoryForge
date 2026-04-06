/**
 * useAnalysisViewer - Main hook for AnalysisViewer page
 * Manages state, parsing, filtering, search, selection
 * Integrated with database layer for annotations, usage, saved searches
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import useCorpusStore from '../../../../stores/corpusStore';
import useAnalysisStore from '../../../../stores/analysisStore';
import { corpusApi } from '../../../../services/api/corpusApi.js';
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
import { buildStoryGraph } from '../../../../services/analysis/v2/storyGraph.js';
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

export const VIEW_MODES = ['knowledge', 'incidents', 'list', 'review', 'mindmap', 'timeline', 'graph', 'compare'];

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
  const [incidentRecords, setIncidentRecords] = useState([]);
  const [reviewQueueItems, setReviewQueueItems] = useState([]);
  const [reviewQueueStats, setReviewQueueStats] = useState({
    total: 0,
    P0: 0,
    P1: 0,
    P2: 0,
    pending: 0,
  });

  const initializedRef = useRef(false);

  // Stores
  const corpus = useCorpusStore((state) => state.corpuses[corpusId]);
  const analyses = useAnalysisStore((state) => state.analyses);
  const analysisIdsByCorpus = useAnalysisStore((state) => state.analysisIdsByCorpus);
  const loadAnalyses = useAnalysisStore((state) => state.loadAnalyses);

  const analysisIdsForCorpus = useMemo(() => {
    if (!corpusId) return EMPTY_ARRAY;
    const ids = analysisIdsByCorpus?.[corpusId];
    return Array.isArray(ids) ? ids : EMPTY_ARRAY;
  }, [analysisIdsByCorpus, corpusId]);

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

  const storyGraph = useMemo(() => {
    const rawPayload = analysis?.result ?? analysis?.finalResult ?? null;
    if (rawPayload) {
      try {
        const raw = typeof rawPayload === 'string'
          ? JSON.parse(rawPayload)
          : rawPayload;
        if (raw.story_graph || raw.storyGraph) {
          return raw.story_graph || raw.storyGraph || null;
        }
      } catch {
        return null;
      }
    }

    if (!parsed) {
      return null;
    }

    const fallbackEvents = flattenEvents(parsed.events || {});
    return buildStoryGraph({
      incidents: Array.isArray(parsed.incidents) ? parsed.incidents : [],
      events: fallbackEvents,
      knowledge: {
        characters: Array.isArray(parsed.characterProfiles) ? parsed.characterProfiles : [],
        locations: Array.isArray(parsed.locations) ? parsed.locations : [],
        objects: Array.isArray(parsed.objects) ? parsed.objects : [],
        terms: Array.isArray(parsed.terms) ? parsed.terms : [],
      },
      relationships: Array.isArray(parsed.relationships) ? parsed.relationships : [],
    });
  }, [analysis, parsed]);

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
    const characterNameSet = new Set(allCharacters.map((item) => normalizeLooseText(item)).filter(Boolean));
    for (const location of locations) {
      if (!location?.name) continue;
      if (!isReasonableEntityLabel(location.name)) continue;
      map.set(location.id || location.name, location.name);
    }
    for (const incident of incidentClusters) {
      const name = incident?.location?.name;
      const id = incident?.location?.id || name;
      if (!name || !id) continue;
      if (!isLikelyLocationName(name, characterNameSet)) continue;
      map.set(id, name);
    }
    return [...map.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [allCharacters, incidentClusters, locations]);

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

  const incidents = useMemo(() => {
    if (incidentRecords.length > 0) {
      return incidentRecords.map((incident) => ({
        ...incident,
        startChapter: incident.chapterStartIndex ?? incident.startChapter ?? incident.chapterRange?.[0] ?? null,
        endChapter: incident.chapterEndIndex ?? incident.endChapter ?? incident.chapterRange?.[1] ?? null,
        eventCount: Array.isArray(incident.containedEvents)
          ? incident.containedEvents.length
          : 0,
      }));
    }

    return displayIncidents.map((incident) => ({
      ...incident,
      startChapter: incident.chapterStart ?? null,
      endChapter: incident.chapterEnd ?? null,
      containedEvents: incident.filteredEventIds || incident.eventIds || [],
      eventCount: incident.filteredEventCount || incident.eventCount || 0,
      reviewStatus: incident.reviewStatus || 'needs_review',
      priority: incident.priority || null,
    }));
  }, [displayIncidents, incidentRecords]);

  // Selected items
  const selectedItems = useMemo(() => {
    return displayEvents.filter(e => selectedIds.has(e.id));
  }, [displayEvents, selectedIds]);

  const eventById = useMemo(() => {
    const map = new Map();
    for (const event of allEventsWithAnnotations) {
      if (!event?.id) continue;
      map.set(event.id, event);
    }
    return map;
  }, [allEventsWithAnnotations]);

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

  const loadIncidentFirstData = useCallback(async () => {
    if (!corpusId) return;

    const targetAnalysisId = analysis?.id || null;

    try {
      const [incidentResp, reviewResp] = await Promise.all([
        corpusApi.listIncidents(corpusId, targetAnalysisId ? { analysisId: targetAnalysisId } : {}),
        corpusApi.getReviewQueue(corpusId, targetAnalysisId ? { analysisId: targetAnalysisId, limit: 200 } : { limit: 200 }),
      ]);

      setIncidentRecords(Array.isArray(incidentResp?.incidents) ? incidentResp.incidents : []);
      setReviewQueueItems(Array.isArray(reviewResp?.items) ? reviewResp.items : []);
      setReviewQueueStats(reviewResp?.stats || {
        total: 0,
        P0: 0,
        P1: 0,
        P2: 0,
        pending: 0,
      });
    } catch (err) {
      setDbError(err?.message || 'Không thể tải dữ liệu incident-first.');
    }
  }, [analysis?.id, corpusId]);

  useEffect(() => {
    loadDbData();
  }, [loadDbData]);

  useEffect(() => {
    loadIncidentFirstData();
  }, [loadIncidentFirstData]);

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
  const handleLinkToProject = useCallback(async ({ eventId, projectId, chapterId, sceneId, notes, eventPayload }) => {
    if (!corpusId) return;
    try {
      const payload = eventPayload || eventById.get(eventId) || null;
      await linkEventToProject(eventId, corpusId, projectId, chapterId, sceneId, notes, payload);
      const links = await getEventLinksForCorpus(corpusId);
      setLinkedEvents(links);
      setLinkModalEvent(null);
    } catch (err) {
      setDbError(err.message);
    }
  }, [corpusId, eventById]);

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

  const handleResolveReview = useCallback(async (itemId, payload = {}) => {
    if (!corpusId || !itemId) return null;

    try {
      const response = await corpusApi.updateReviewQueueItem(corpusId, itemId, payload);
      const updated = response?.item;
      if (!updated) return null;

      setReviewQueueItems((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
      setReviewQueueStats((prev) => ({
        ...prev,
        pending: Math.max(0, prev.pending - (updated.status === 'resolved' || updated.status === 'ignored' ? 1 : 0)),
      }));
      return updated;
    } catch (err) {
      setDbError(err?.message || 'Không thể cập nhật review item.');
      throw err;
    }
  }, [corpusId]);

  const handleUpdateIncident = useCallback(async (incidentId, updates = {}) => {
    if (!corpusId || !incidentId) return null;

    try {
      const response = await corpusApi.updateIncident(corpusId, incidentId, updates);
      const updated = response?.incident;
      if (!updated) return null;

      setIncidentRecords((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
      return updated;
    } catch (err) {
      setDbError(err?.message || 'Không thể cập nhật incident.');
      throw err;
    }
  }, [corpusId]);

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
    incidents,
    reviewQueue: reviewQueueItems,
    reviewQueueStats,
    storyGraph,
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
    handleResolveReview,
    handleUpdateIncident,
    refreshIncidentFirstData: loadIncidentFirstData,
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

  const characterNameSet = new Set(
    events.flatMap((event) => (Array.isArray(event?.characters) ? event.characters : []))
      .map((item) => normalizeLooseText(item))
      .filter(Boolean),
  );

  const normalizedEvents = events
    .filter((event) => event?.id && isMeaningfulEventDescription(event?.description || ''))
    .map((event) => ({
      ...event,
      chapterSafe: Number.isFinite(Number(event.chapter)) ? Number(event.chapter) : 0,
      locationNameSafe: resolveCleanLocationName(
        event.locationLink?.locationName || event.primaryLocationName || '',
        characterNameSet,
      ) || 'Không rõ địa điểm',
      locationIdSafe: event.locationLink?.locationId
        || event.primaryLocationId
        || resolveCleanLocationName(event.locationLink?.locationName || event.primaryLocationName || '', characterNameSet)
        || 'unknown',
    }));

  const groupedByLocation = new Map();
  for (const event of normalizedEvents) {
    const key = String(event.locationIdSafe || 'unknown');
    const list = groupedByLocation.get(key) || [];
    list.push(event);
    groupedByLocation.set(key, list);
  }

  const incidents = [];
  for (const [locationKey, locationEventsRaw] of groupedByLocation.entries()) {
    const locationEvents = [...locationEventsRaw]
      .sort((a, b) => Number(a.chapterSafe || 0) - Number(b.chapterSafe || 0));

    const segments = splitIncidentSegments(locationEvents);
    for (const segment of segments) {
      if (segment.length === 0) continue;
      const anchor = pickAnchorEvent(segment);
      if (!anchor) continue;

      const chapters = segment
        .map((item) => item.chapterSafe)
        .filter((value) => Number.isFinite(Number(value)) && Number(value) > 0);
      const chapterStart = chapters.length ? Math.min(...chapters) : null;
      const chapterEnd = chapters.length ? Math.max(...chapters) : null;

      const eventIds = [...new Set(segment.map((item) => item.id).filter(Boolean))];
      const majorLikeCount = segment.filter((item) => isMajorLikeEvent(item)).length;
      const confidence = Math.max(
        0.45,
        Math.min(0.95, (majorLikeCount / Math.max(1, segment.length)) * 0.55 + 0.35),
      );

      incidents.push({
        id: `incident_fallback_${String(locationKey)}_${String(chapterStart || 0)}_${String(eventIds.length)}`,
        title: buildFallbackIncidentTitle(anchor),
        type: inferIncidentType(anchor),
        location: {
          id: locationKey !== 'unknown' ? locationKey : null,
          name: anchor.locationNameSafe || 'Không rõ địa điểm',
          confidence: Number(anchor.locationLink?.confidence || 0),
          isMajor: Boolean(anchor.locationLink?.isMajorLocation),
        },
        chapterStart,
        chapterEnd,
        confidence,
        eventIds,
        eventCount: eventIds.length,
        subeventCount: Math.max(0, eventIds.length - 1),
        anchorEventId: anchor.id || null,
        anchorEventDescription: anchor.description || '',
        evidenceSnippet: anchor.locationLink?.evidenceSnippet || anchor.grounding?.evidenceSnippet || '',
        tags: [...new Set(segment.flatMap((item) => Array.isArray(item.tags) ? item.tags : []))].slice(0, 10),
      });
    }
  }

  const openingAnchor = pickOpeningIncidentAnchor(normalizedEvents);
  if (openingAnchor) {
    const exists = incidents.some((incident) => incident.anchorEventId === openingAnchor.id);
    if (!exists) {
      incidents.unshift({
        id: `incident_opening_${openingAnchor.id}`,
        title: buildFallbackIncidentTitle(openingAnchor, 'Sự kiện mở đầu'),
        type: 'major_plot_point',
        location: {
          id: openingAnchor.locationIdSafe !== 'unknown' ? openingAnchor.locationIdSafe : null,
          name: openingAnchor.locationNameSafe || 'Không rõ địa điểm',
          confidence: Number(openingAnchor.locationLink?.confidence || 0),
          isMajor: true,
        },
        chapterStart: openingAnchor.chapterSafe || null,
        chapterEnd: openingAnchor.chapterSafe || null,
        confidence: 0.92,
        eventIds: [openingAnchor.id],
        eventCount: 1,
        subeventCount: 0,
        anchorEventId: openingAnchor.id,
        anchorEventDescription: openingAnchor.description || '',
        evidenceSnippet: openingAnchor.locationLink?.evidenceSnippet || openingAnchor.grounding?.evidenceSnippet || '',
        tags: Array.isArray(openingAnchor.tags) ? openingAnchor.tags.slice(0, 8) : [],
      });
    }
  }

  return incidents
    .filter((item) => item.eventCount > 0)
    .sort((a, b) => {
      const chapterA = Number.isFinite(Number(a.chapterStart)) ? Number(a.chapterStart) : Number.MAX_SAFE_INTEGER;
      const chapterB = Number.isFinite(Number(b.chapterStart)) ? Number(b.chapterStart) : Number.MAX_SAFE_INTEGER;
      if (chapterA !== chapterB) return chapterA - chapterB;
      return Number(b.confidence || 0) - Number(a.confidence || 0);
    });
}

function normalizeText(value) {
  return String(value || '').replace(/\s+/gu, ' ').trim();
}

function normalizeLooseText(value) {
  return normalizeText(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '');
}

function isMeaningfulEventDescription(text) {
  const normalized = normalizeText(text);
  return normalized.length >= 14;
}

function resolveCleanLocationName(value, characterNameSet = new Set()) {
  const name = normalizeText(value);
  if (!name) return '';
  if (!isLikelyLocationName(name, characterNameSet)) return '';
  return name;
}

function isLikelyLocationName(name, characterNameSet = new Set()) {
  const normalized = normalizeLooseText(name);
  if (!normalized) return false;
  if (characterNameSet.has(normalized)) return false;
  if (normalized.length > 84) return false;
  if (/[.!?]/u.test(normalized)) return false;

  const tokens = normalized.split(/\s+/u).filter(Boolean);
  if (tokens.length < 1 || tokens.length > 8) return false;

  const locationHints = new Set([
    'nha', 'tro', 'thanh', 'pho', 'quan', 'huyen', 'xa', 'thon', 'lang',
    'truong', 'vien', 'toa', 'lau', 'duong', 'ngo', 'hem',
    'nui', 'rung', 'song', 'ho', 'dao', 'dong', 'hang',
    'khu', 'vung', 'den', 'chua', 'dinh', 'cung', 'thap', 'dien',
    'nghia', 'trang', 'cau', 'ben', 'cang', 'bien',
  ]);
  const noiseTokens = new Set([
    'hoan', 'toan', 'khong', 'co', 'nghe', 'nhung', 'nguoi', 'khac',
    'xong', 'roi', 'truoc', 'sau', 'thi', 'la', 'ma',
  ]);

  const hintCount = tokens.reduce((count, token) => count + (locationHints.has(token) ? 1 : 0), 0);
  const noiseCount = tokens.reduce((count, token) => count + (noiseTokens.has(token) ? 1 : 0), 0);

  if (noiseCount >= 2 && hintCount <= 1) return false;
  if (tokens.length >= 4 && hintCount === 0) return false;
  return hintCount > 0 || tokens.length <= 2;
}

function buildFallbackIncidentTitle(anchor = {}, fallback = 'Sự kiện lớn') {
  const description = truncateIncidentTitle(anchor.description || fallback);
  const locationName = normalizeText(anchor.locationNameSafe || '');
  if (!locationName || locationName === 'Không rõ địa điểm') {
    return description;
  }
  return `${locationName} - ${description}`;
}

function isReasonableEntityLabel(name) {
  const normalized = normalizeText(name);
  if (!normalized) return false;
  if (normalized.length > 84) return false;
  if (/[.!?]/u.test(normalized)) return false;
  const words = normalized.split(/\s+/u).filter(Boolean);
  if (words.length > 10) return false;
  return true;
}

function splitIncidentSegments(events = []) {
  if (!events.length) return [];
  const segments = [];
  let current = [];

  for (const event of events) {
    if (!current.length) {
      current.push(event);
      continue;
    }

    const previous = current[current.length - 1];
    const chapterGap = Math.abs(Number(event.chapterSafe || 0) - Number(previous.chapterSafe || 0));
    const triggerSplit = chapterGap >= 4 || isStrongBoundaryEvent(event);
    if (triggerSplit && current.length > 0) {
      segments.push(current);
      current = [event];
    } else {
      current.push(event);
    }
  }

  if (current.length > 0) {
    segments.push(current);
  }
  return segments;
}

function isMajorLikeEvent(event = {}) {
  const severity = String(event.severity || '').toLowerCase();
  if (severity === 'crucial' || severity === 'major') return true;
  return Number(event.quality?.score || 0) >= 80;
}

function isStrongBoundaryEvent(event = {}) {
  const text = normalizeLooseText(event.description || '');
  if (!text) return false;
  const boundaryKeywords = [
    'bi dich chuyen', 'dich chuyen den', 'bat dau tham hiem', 'mo cua',
    'buoc vao', 'lan dau den', 'xuất hien o', 'xuat hien o', 'vao nha tro',
  ];
  return boundaryKeywords.some((keyword) => text.includes(keyword));
}

function pickAnchorEvent(events = []) {
  if (!events.length) return null;
  return [...events].sort((a, b) => {
    const severityRank = { crucial: 4, major: 3, moderate: 2, minor: 1 };
    const rankA = severityRank[String(a.severity || '').toLowerCase()] || 0;
    const rankB = severityRank[String(b.severity || '').toLowerCase()] || 0;
    if (rankA !== rankB) return rankB - rankA;

    const qualityA = Number(a.quality?.score || 0);
    const qualityB = Number(b.quality?.score || 0);
    if (qualityA !== qualityB) return qualityB - qualityA;

    return Number(a.chapterSafe || 0) - Number(b.chapterSafe || 0);
  })[0];
}

function pickOpeningIncidentAnchor(events = []) {
  if (!events.length) return null;
  const sorted = [...events].sort((a, b) => Number(a.chapterSafe || 0) - Number(b.chapterSafe || 0));
  const openingWindow = sorted.filter((item) => Number(item.chapterSafe || 0) <= 2);
  const candidates = openingWindow.filter((item) => {
    const text = normalizeLooseText(item.description || '');
    return (
      isMajorLikeEvent(item)
      || text.includes('dich chuyen')
      || text.includes('nha tro')
      || text.includes('bat dau')
    );
  });
  return candidates[0] || null;
}

function inferIncidentType(anchor = {}) {
  const text = normalizeLooseText(anchor.description || '');
  if (text.includes('dich chuyen') || text.includes('bat dau') || text.includes('tham hiem')) {
    return 'major_plot_point';
  }
  const severity = String(anchor.severity || '').toLowerCase();
  if (severity === 'crucial' || severity === 'major') {
    return 'major_plot_point';
  }
  return 'subplot';
}

function truncateIncidentTitle(text, maxLength = 80) {
  const normalized = normalizeText(text);
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1)}…`;
}

