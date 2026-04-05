import { randomUUID } from 'node:crypto';

function toNumber(value, fallback = null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function unique(values = []) {
  return [...new Set((values || []).filter(Boolean))];
}

function normalizeIncident(raw = {}, index = 0, chapterCount = null) {
  const startChapter = toNumber(
    raw.startChapter
    ?? raw.chapterStart
    ?? raw.chapterStartIndex
    ?? raw.chapterRange?.[0],
    null,
  );
  const endChapter = toNumber(
    raw.endChapter
    ?? raw.chapterEnd
    ?? raw.chapterEndIndex
    ?? raw.chapterRange?.[1],
    startChapter,
  );

  const minChapter = startChapter == null ? null : Math.max(0, startChapter);
  const maxBound = chapterCount == null ? Number.MAX_SAFE_INTEGER : Math.max(0, chapterCount - 1);
  const safeStart = minChapter == null ? null : Math.min(minChapter, maxBound);
  const safeEnd = endChapter == null
    ? safeStart
    : Math.min(Math.max(safeStart ?? 0, endChapter), maxBound);

  return {
    id: raw.id || `inc_${randomUUID()}`,
    title: String(raw.title || raw.name || raw.description || `Incident ${index + 1}`).trim(),
    type: String(raw.type || 'subplot'),
    startChapter: safeStart,
    endChapter: safeEnd,
    confidence: Math.max(0, Math.min(1, Number(raw.confidence ?? 0.5) || 0.5)),
    uncertainStart: Boolean(raw.uncertainStart),
    uncertainEnd: Boolean(raw.uncertainEnd),
    boundaryNote: String(raw.boundaryNote || '').trim(),
    evidence: Array.isArray(raw.evidence)
      ? raw.evidence.map((item) => String(item || '').trim()).filter(Boolean)
      : [],
    description: String(raw.description || '').trim(),
    containedEvents: unique(raw.containedEvents || raw.eventIds || []),
  };
}

function collectContextWords(chapters = []) {
  return (chapters || []).reduce((sum, chapter) => {
    const content = String(chapter?.content || chapter?.text || '');
    if (!content.trim()) return sum;
    return sum + content.trim().split(/\s+/u).length;
  }, 0);
}

function deriveIncidentsFromEvents(events = [], chapterCount = null) {
  const grouped = new Map();

  for (const event of events || []) {
    const chapter = toNumber(event?.chapterIndex ?? event?.chapter, null);
    const key = String(event?.incidentId || '').trim() || `ch_${Math.floor(Math.max(0, chapter ?? 0) / 4)}`;

    const current = grouped.get(key) || {
      id: key.startsWith('inc_') ? key : `inc_${randomUUID()}`,
      title: '',
      type: 'subplot',
      chapterMin: null,
      chapterMax: null,
      evidence: [],
      eventIds: [],
      severitySamples: [],
    };

    const eventTitle = String(event?.title || event?.description || '').trim();
    if (!current.title && eventTitle) {
      current.title = eventTitle.slice(0, 90);
    }

    if (chapter != null) {
      current.chapterMin = current.chapterMin == null ? chapter : Math.min(current.chapterMin, chapter);
      current.chapterMax = current.chapterMax == null ? chapter : Math.max(current.chapterMax, chapter);
    }

    if (event?.id) {
      current.eventIds.push(String(event.id));
    }

    if (event?.evidence?.[0]) {
      current.evidence.push(String(event.evidence[0]));
    }

    const severity = Number(event?.severity);
    if (Number.isFinite(severity)) {
      current.severitySamples.push(Math.max(0, Math.min(1, severity)));
    }

    grouped.set(key, current);
  }

  return [...grouped.values()].map((item, idx) => {
    const confidence = item.severitySamples.length
      ? item.severitySamples.reduce((sum, value) => sum + value, 0) / item.severitySamples.length
      : 0.62;

    return normalizeIncident({
      id: item.id,
      title: item.title || `Incident ${idx + 1}`,
      type: item.eventIds.length >= 8 ? 'major_plot_point' : 'subplot',
      startChapter: item.chapterMin,
      endChapter: item.chapterMax ?? item.chapterMin,
      confidence,
      boundaryNote: 'Incident generated from clustered events.',
      evidence: unique(item.evidence).slice(0, 6),
      containedEvents: unique(item.eventIds),
    }, idx, chapterCount);
  });
}

export function globalSegmentation(input = {}, options = {}) {
  const startTime = Date.now();
  const mode = String(options.mode || 'balanced');
  const minConfidence = Number.isFinite(Number(options.minConfidence))
    ? Number(options.minConfidence)
    : 0.5;

  const chapters = Array.isArray(input?.chapters) ? input.chapters : [];
  const chapterCount = chapters.length > 0 ? chapters.length : null;

  const sourceIncidents = Array.isArray(input?.incidents) ? input.incidents : [];
  const sourceEvents = Array.isArray(input?.events) ? input.events : [];

  const initialIncidents = sourceIncidents.length > 0
    ? sourceIncidents.map((item, index) => normalizeIncident(item, index, chapterCount))
    : deriveIncidentsFromEvents(sourceEvents, chapterCount);

  const incidents = initialIncidents
    .filter((incident) => incident.confidence >= minConfidence)
    .sort((a, b) => {
      const startDiff = (a.startChapter ?? Number.MAX_SAFE_INTEGER) - (b.startChapter ?? Number.MAX_SAFE_INTEGER);
      if (startDiff !== 0) return startDiff;
      return (b.confidence || 0) - (a.confidence || 0);
    });

  return {
    incidents,
    mode,
    contextWords: collectContextWords(chapters),
    processingTime: Date.now() - startTime,
  };
}
