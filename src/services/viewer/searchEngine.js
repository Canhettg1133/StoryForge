/**
 * Search Engine - Advanced search cho events
 * Hỗ trợ full-text, boolean operators, phrase search, fuzzy matching
 */

/**
 * Search events with advanced query parsing
 */
export function searchEvents(events, query, options = {}) {
  const {
    searchIn = ['description', 'annotation'],
    filters = {},
    fuzzy = true,
    caseSensitive = false,
  } = options;

  if (!query || !query.trim()) {
    return applyFilters(events, filters);
  }

  // 1. Parse query
  const parsedQuery = parseQuery(query);

  // 2. Filter by criteria + text match
  let results = events.filter(event => {
    // Text search
    let textMatch = true;
    if (parsedQuery.text) {
      textMatch = searchIn.some(field => {
        const text = field === 'annotation'
          ? (event.annotation?.note || '')
          : (event[field] || '');
        return matchText(text, parsedQuery, { fuzzy, caseSensitive });
      });
    }

    // NOT terms - exclude
    if (parsedQuery.notTerms.length > 0) {
      const notMatch = parsedQuery.notTerms.some(term => {
        return searchIn.some(field => {
          const text = field === 'annotation'
            ? (event.annotation?.note || '')
            : (event[field] || '');
          return matchText(text, { terms: [term], quoted: [] }, { fuzzy, caseSensitive });
        });
      });
      if (notMatch) return false;
    }

    // Additional filters
    if (!passFilters(event, filters)) return false;

    return textMatch;
  });

  // 3. Score and sort by relevance
  results = results.map(event => ({
    ...event,
    relevance: calculateRelevance(event, parsedQuery),
    highlights: getHighlights(event, parsedQuery, searchIn),
  }));

  results.sort((a, b) => b.relevance - a.relevance);

  return results;
}

/**
 * Parse query string into structured parts
 */
function parseQuery(query) {
  const raw = String(query || '').trim();

  // Extract quoted phrases
  const quoted = [];
  let text = raw.replace(/"([^"]+)"/g, (_, phrase) => {
    quoted.push(phrase.trim());
    return '';
  });

  // Split by AND/OR operators
  const andTerms = text.split(/\s+AND\s+/i).filter(t => t.trim());
  const orTerms = text.split(/\s+OR\s+/i).filter(t => t.trim());

  // Remaining terms (without operators)
  let cleanText = text;
  for (const term of andTerms) cleanText = cleanText.replace(term, '');
  for (const term of orTerms) cleanText = cleanText.replace(term, '');
  const terms = cleanText.split(/\s+/).filter(t => t.length > 0);

  // Extract NOT terms
  const notTerms = [];
  const remaining = [];
  for (const term of terms) {
    if (term.startsWith('-') || term.startsWith('!')) {
      notTerms.push(term.slice(1));
    } else {
      remaining.push(term);
    }
  }

  return {
    quoted,
    terms: remaining,
    andTerms,
    orTerms,
    notTerms,
    text: remaining.join(' '),
  };
}

/**
 * Match text against parsed query
 */
function matchText(text, parsedQuery, options = {}) {
  const { fuzzy = true, caseSensitive = false } = options;
  if (!text) return false;

  const source = caseSensitive ? text : text.toLowerCase();

  // Check quoted phrases (must appear literally)
  for (const phrase of (parsedQuery.quoted || [])) {
    const search = caseSensitive ? phrase : phrase.toLowerCase();
    if (!source.includes(search)) return false;
  }

  // Check AND terms (all must appear)
  for (const term of (parsedQuery.andTerms || [])) {
    const search = caseSensitive ? term : term.toLowerCase();
    if (!source.includes(search)) return false;
  }

  // Check OR terms (at least one must appear)
  if ((parsedQuery.orTerms || []).length > 0) {
    const orMatch = (parsedQuery.orTerms || []).some(term => {
      const search = caseSensitive ? term : term.toLowerCase();
      return source.includes(search);
    });
    if (!orMatch) return false;
  }

  // Check regular terms
  for (const term of (parsedQuery.terms || [])) {
    const search = caseSensitive ? term : term.toLowerCase();

    if (fuzzy) {
      // Fuzzy match - check if term appears or is close enough
      if (!fuzzyMatch(source, search)) return false;
    } else {
      if (!source.includes(search)) return false;
    }
  }

  return true;
}

/**
 * Fuzzy match - check if text contains term or similar
 */
function fuzzyMatch(text, term) {
  if (text.includes(term)) return true;

  // Levenshtein-based fuzzy matching for short terms
  if (term.length <= 3) {
    return text.includes(term);
  }

  // Check if any word in text is within edit distance of term
  const words = text.split(/\s+/);
  for (const word of words) {
    if (levenshteinDistance(word, term) <= Math.floor(term.length / 4)) {
      return true;
    }
  }

  return false;
}

/**
 * Levenshtein distance between two strings
 */
function levenshteinDistance(a, b) {
  const m = a.length;
  const n = b.length;

  if (m === 0) return n;
  if (n === 0) return m;

  const dp = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost,
      );
    }
  }

  return dp[m][n];
}

/**
 * Calculate relevance score for an event
 */
function calculateRelevance(event, parsedQuery) {
  let score = 0;

  // Exact phrase matches get highest score
  for (const phrase of (parsedQuery.quoted || [])) {
    const desc = (event.description || '').toLowerCase();
    const phraseLower = phrase.toLowerCase();
    if (desc === phraseLower) {
      score += 100;
    } else if (desc.includes(phraseLower)) {
      score += 50;
    }
  }

  // AND terms
  score += (parsedQuery.andTerms || []).length * 20;

  // Regular terms
  const desc = (event.description || '').toLowerCase();
  for (const term of (parsedQuery.terms || [])) {
    const termLower = term.toLowerCase();
    if (desc.includes(termLower)) {
      score += 10;
      // Bonus for word boundary matches
      const regex = new RegExp(`\\b${escapeRegex(termLower)}\\b`, 'i');
      if (regex.test(desc)) {
        score += 15;
      }
    }
  }

  // Severity bonus
  if (event.severity === 'crucial') score += 5;
  if (event.severity === 'major') score += 3;

  // Starred annotation bonus
  if (event.annotation?.starred) score += 2;

  return score;
}

/**
 * Get highlight ranges for matched text
 */
function getHighlights(event, parsedQuery, searchIn) {
  const highlights = [];

  for (const field of searchIn) {
    const text = field === 'annotation'
      ? (event.annotation?.note || '')
      : (event[field] || '');
    if (!text) continue;

    const textLower = text.toLowerCase();

    // Highlight quoted phrases
    for (const phrase of (parsedQuery.quoted || [])) {
      const phraseLower = phrase.toLowerCase();
      let start = 0;
      while (true) {
        const idx = textLower.indexOf(phraseLower, start);
        if (idx === -1) break;
        highlights.push({ field, start: idx, end: idx + phrase.length, text: phrase });
        start = idx + 1;
      }
    }

    // Highlight terms
    for (const term of (parsedQuery.terms || [])) {
      const termLower = term.toLowerCase();
      let start = 0;
      while (true) {
        const idx = textLower.indexOf(termLower, start);
        if (idx === -1) break;
        // Only highlight word boundary matches for short terms
        if (term.length > 3) {
          highlights.push({ field, start: idx, end: idx + term.length, text: term });
        } else {
          const before = idx === 0 || /\s/.test(text[idx - 1]);
          const after = (idx + term.length >= text.length) || /\s/.test(text[idx + term.length]);
          if (before && after) {
            highlights.push({ field, start: idx, end: idx + term.length, text: term });
          }
        }
        start = idx + 1;
      }
    }
  }

  return highlights;
}

/**
 * Apply filters without text search
 */
function applyFilters(events, filters) {
  if (!filters || Object.keys(filters).length === 0) return events;

  return events.filter(event => passFilters(event, filters));
}

/**
 * Check if event passes filter criteria
 */
function passFilters(event, filters) {
  if (!filters) return true;

  const chapterValue = Number.isFinite(Number(event.chapter)) ? Number(event.chapter) : null;
  const intensityValue = Number.isFinite(Number(event.emotionalIntensity))
    ? Number(event.emotionalIntensity)
    : null;

  if (filters.severity && filters.severity !== 'all' && event.severity !== filters.severity) return false;
  if (filters.rarity && filters.rarity !== 'all' && event.rarity?.score !== filters.rarity) return false;
  if (filters.canonFanon && filters.canonFanon !== 'all' && event.canonOrFanon?.type !== filters.canonFanon) return false;
  if (filters.tag && filters.tag !== 'all' && !(event.tags || []).includes(filters.tag)) return false;
  if (filters.location && filters.location !== 'all') {
    const eventLocationId = event.locationLink?.locationId || event.primaryLocationId || event.primaryLocationName;
    if (eventLocationId !== filters.location) return false;
  }
  if (filters.character && filters.character !== 'all' && !(event.characters || []).includes(filters.character)) return false;
  if (filters.ship && filters.ship !== 'all' && !(event.ships || []).includes(filters.ship)) return false;
  if (filters.minIntensity > 1 && intensityValue != null && intensityValue < filters.minIntensity) return false;
  if (filters.maxIntensity && filters.maxIntensity < 10 && intensityValue != null && intensityValue > filters.maxIntensity) return false;
  if (filters.chapterMin && (chapterValue == null || chapterValue < filters.chapterMin)) return false;
  if (filters.chapterMax && (chapterValue == null || chapterValue > filters.chapterMax)) return false;
  if (filters.reviewStatus && filters.reviewStatus !== 'all' && event.reviewStatus !== filters.reviewStatus) return false;
  if (filters.hasAnnotation && !event.annotation?.note) return false;
  if (filters.starred && !event.annotation?.starred) return false;
  if (filters._type && filters._type !== 'all' && event._type !== filters._type) return false;

  return true;
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Build a filter summary string
 */
export function buildFilterSummary(filters) {
  const parts = [];
  if (!filters) return '';

  if (filters.severity && filters.severity !== 'all') parts.push(`Severity: ${filters.severity}`);
  if (filters.rarity && filters.rarity !== 'all') parts.push(`Rarity: ${filters.rarity}`);
  if (filters.canonFanon && filters.canonFanon !== 'all') parts.push(`Type: ${filters.canonFanon}`);
  if (filters.tag && filters.tag !== 'all') parts.push(`Tag: ${filters.tag}`);
  if (filters.location && filters.location !== 'all') parts.push(`Location: ${filters.location}`);
  if (filters.character && filters.character !== 'all') parts.push(`Char: ${filters.character}`);
  if (filters.ship && filters.ship !== 'all') parts.push(`Ship: ${filters.ship}`);
  if (filters.reviewStatus && filters.reviewStatus !== 'all') parts.push(`Review: ${filters.reviewStatus}`);
  if (filters.minIntensity) parts.push(`Intensity: ${filters.minIntensity}+`);
  if (filters.hasAnnotation) parts.push('Has annotation');
  if (filters.starred) parts.push('Starred');

  return parts.join(' | ');
}
