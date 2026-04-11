/**
 * Comparison Engine - Compare 2 corpora analysis results
 * Side-by-side comparison, pattern matching, similarity analysis
 */

import { flattenEvents, getEventStats } from './analysisParser.js';

/**
 * Compare two corpora analysis results
 */
export async function compareCorpora(corpusA, corpusB, options = {}) {
  const {
    similarityThreshold = 0.6,
    matchByDescription = true,
    matchByTags = true,
    matchBySeverity = true,
  } = options;

  // Parse events from both corpora
  const eventsA = flattenEvents(corpusA.analysis?.events || corpusA.events || {});
  const eventsB = flattenEvents(corpusB.analysis?.events || corpusB.events || {});

  // Extract patterns
  const patternsA = extractPatterns(eventsA);
  const patternsB = extractPatterns(eventsB);

  // Find similar patterns
  const similarities = [];
  for (const patternA of patternsA) {
    for (const patternB of patternsB) {
      const similarity = calculatePatternSimilarity(patternA, patternB, options);
      if (similarity >= similarityThreshold) {
        similarities.push({
          patternA,
          patternB,
          similarity,
          corpusA: findEventByPattern(eventsA, patternA),
          corpusB: findEventByPattern(eventsB, patternB),
        });
      }
    }
  }

  // Sort by similarity (highest first)
  similarities.sort((a, b) => b.similarity - a.similarity);

  // Find unique patterns
  const matchedPatternKeysA = new Set(similarities.map(s => s.patternA.key));
  const matchedPatternKeysB = new Set(similarities.map(s => s.patternB.key));

  const uniqueA = patternsA
    .filter(p => !matchedPatternKeysA.has(p.key))
    .map(p => ({
      pattern: p,
      event: findEventByPattern(eventsA, p),
    }));

  const uniqueB = patternsB
    .filter(p => !matchedPatternKeysB.has(p.key))
    .map(p => ({
      pattern: p,
      event: findEventByPattern(eventsB, p),
    }));

  // Find partial matches (lower similarity)
  const partials = [];
  for (const patternA of patternsA) {
    for (const patternB of patternsB) {
      if (similarities.some(s => s.patternA.key === patternA.key && s.patternB.key === patternB.key)) {
        continue;
      }
      const similarity = calculatePatternSimilarity(patternA, patternB, options);
      if (similarity >= 0.35 && similarity < similarityThreshold) {
        partials.push({
          patternA,
          patternB,
          similarity,
          corpusA: findEventByPattern(eventsA, patternA),
          corpusB: findEventByPattern(eventsB, patternB),
        });
      }
    }
  }

  partials.sort((a, b) => b.similarity - a.similarity);

  // Calculate statistics
  const statsA = getEventStats(corpusA.analysis?.events || corpusA.events || {});
  const statsB = getEventStats(corpusB.analysis?.events || corpusB.events || {});

  const comparisonStats = {
    corpusA: {
      ...statsA,
      title: corpusA.title || corpusA.name || 'Corpus A',
      fandom: corpusA.fandom || '',
    },
    corpusB: {
      ...statsB,
      title: corpusB.title || corpusB.name || 'Corpus B',
      fandom: corpusB.fandom || '',
    },
    similarity: {
      totalSimilar: similarities.length,
      totalUniqueA: uniqueA.length,
      totalUniqueB: uniqueB.length,
      totalPartial: partials.length,
      similarityScore: calculateOverallSimilarity(similarities, patternsA, patternsB),
    },
  };

  return {
    similarities,
    uniqueA,
    uniqueB,
    partials,
    stats: comparisonStats,
  };
}

/**
 * Extract meaningful patterns from events
 */
function extractPatterns(events) {
  const patterns = [];

  for (const event of events) {
    const pattern = {
      key: generatePatternKey(event),
      tags: normalizePatternTags(event.tags || []),
      severity: event.severity,
      hasAngst: false,
      hasRomance: false,
      hasAction: false,
      hasHurtComfort: false,
      isKeyMoment: event.severity === 'crucial' || event.severity === 'major',
      intensity: event.emotionalIntensity || 5,
      chapter: event.chapter,
      description: (event.description || '').toLowerCase(),
      descriptionWords: tokenize(event.description || ''),
    };

    // Tag-based pattern detection
    const tagSet = new Set(pattern.tags);
    pattern.hasAngst = tagSet.has('angst') || hasKeyword(event.description, ['death', 'betrayal', 'pain', 'suffering', 'loss']);
    pattern.hasRomance = tagSet.has('romance') || tagSet.has('shipping') || tagSet.has('fluff') ||
      hasKeyword(event.description, ['kiss', 'love', 'confess', 'romantic', 'date']);
    pattern.hasAction = tagSet.has('action') || tagSet.has('battle') || hasKeyword(event.description, ['fight', 'battle', 'chase', 'escape']);
    pattern.hasHurtComfort = tagSet.has('hurt_comfort') || tagSet.has('comfort');

    patterns.push(pattern);
  }

  return patterns;
}

function generatePatternKey(event) {
  const parts = [
    event.severity || 'unknown',
    ...(event.tags || []).slice(0, 3).sort(),
    event.chapter || '0',
  ];
  return parts.join('|');
}

function normalizePatternTags(tags) {
  return tags
    .map(t => String(t).toLowerCase().trim().replace(/\s+/g, '_'))
    .filter(Boolean);
}

function tokenize(text) {
  return new Set(
    String(text || '')
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(t => t.length > 2)
  );
}

function hasKeyword(text, keywords) {
  const lower = String(text || '').toLowerCase();
  return keywords.some(k => lower.includes(k));
}

/**
 * Calculate similarity between two patterns
 */
function calculatePatternSimilarity(patternA, patternB, options = {}) {
  const { matchByDescription = true, matchByTags = true, matchBySeverity = true } = options;

  let score = 0;
  let weights = 0;

  // Severity match (high weight)
  if (matchBySeverity) {
    weights += 0.15;
    if (patternA.severity === patternB.severity) {
      score += 0.15;
    } else if (patternA.isKeyMoment && patternB.isKeyMoment) {
      score += 0.1;
    }
  }

  // Tag overlap (high weight)
  if (matchByTags) {
    weights += 0.35;
    const tagsA = new Set(patternA.tags);
    const tagsB = new Set(patternB.tags);
    const intersection = [...tagsA].filter(t => tagsB.has(t)).length;
    const union = new Set([...tagsA, ...tagsB]).size;
    if (union > 0) {
      score += 0.35 * (intersection / union);
    }
  }

  // Description similarity (medium weight)
  if (matchByDescription) {
    weights += 0.3;
    const wordsA = patternA.descriptionWords;
    const wordsB = patternB.descriptionWords;
    const intersection = [...wordsA].filter(w => wordsB.has(w)).length;
    const union = new Set([...wordsA, ...wordsB]).size;
    if (union > 0) {
      score += 0.3 * (intersection / union);
    }
  }

  // Genre/tag pattern match (extra weight)
  weights += 0.2;
  let genreScore = 0;
  let genreChecks = 0;

  for (const genre of ['hasAngst', 'hasRomance', 'hasAction', 'hasHurtComfort']) {
    if (patternA[genre] || patternB[genre]) {
      genreChecks++;
      if (patternA[genre] === patternB[genre]) {
        genreScore++;
      }
    }
  }

  if (genreChecks > 0) {
    score += 0.2 * (genreScore / genreChecks);
  } else {
    weights += 0.2; // Give full weight if no genre signals
  }

  return weights > 0 ? score / weights : 0;
}

function findEventByPattern(events, pattern) {
  return events.find(e => generatePatternKey(e) === pattern.key) || null;
}

function calculateOverallSimilarity(similarities, patternsA, patternsB) {
  if (!patternsA.length || !patternsB.length) return 0;

  const maxPossible = Math.min(patternsA.length, patternsB.length);
  const similaritySum = similarities.reduce((sum, s) => sum + s.similarity, 0);
  const avgSimilarity = similarities.length ? similaritySum / similarities.length : 0;

  const coverageA = similarities.length / patternsA.length;
  const coverageB = similarities.length / patternsB.length;
  const coverage = (coverageA + coverageB) / 2;

  return Math.round(avgSimilarity * 0.6 * coverage * 100) / 100;
}

/**
 * Find trope equivalents between two corpora
 */
export function findTropeEquivalents(corpusA, corpusB) {
  const knownTropes = [
    { hp: 'rival_meeting', naruto: 'rival_encounter', label: 'Rival Meeting' },
    { hp: 'secret_relationship', naruto: 'hidden_feelings', label: 'Secret Relationship' },
    { hp: 'training_arc', naruto: 'training_arc', label: 'Training Arc' },
    { hp: 'betrayal_reveal', naruto: 'betrayal', label: 'Betrayal Reveal' },
    { hp: 'first_kiss', naruto: 'first_kiss', label: 'First Kiss' },
    { hp: 'forbidden_love', naruto: 'forbidden_love', label: 'Forbidden Love' },
    { hp: 'hurt_comfort', naruto: 'hurt_comfort', label: 'Hurt/Comfort' },
    { hp: 'enemy_to_lover', naruto: 'rival_to_ally', label: 'Enemy to Lover' },
    { hp: 'time_skip', naruto: 'timeskip', label: 'Time Skip' },
    { hp: 'final_battle', naruto: 'final_battle', label: 'Final Battle' },
  ];

  const eventsA = flattenEvents(corpusA.analysis?.events || corpusA.events || {});
  const eventsB = flattenEvents(corpusB.analysis?.events || corpusB.events || {});

  const equivalents = [];

  for (const trope of knownTropes) {
    const matchA = eventsA.find(e =>
      e.tags?.some(t => t.includes(trope.hp)) ||
      e.description?.toLowerCase().includes(trope.hp.replace(/_/g, ' '))
    );
    const matchB = eventsB.find(e =>
      e.tags?.some(t => t.includes(trope.naruto)) ||
      e.description?.toLowerCase().includes(trope.naruto.replace(/_/g, ' '))
    );

    equivalents.push({
      trope: trope.label,
      corpusA: matchA ? { found: true, event: matchA } : { found: false },
      corpusB: matchB ? { found: true, event: matchB } : { found: false },
      status: matchA && matchB ? 'both' : matchA ? 'a_only' : matchB ? 'b_only' : 'neither',
    });
  }

  return equivalents;
}

/**
 * Generate AI adaptation suggestions (placeholder - calls AI service)
 */
export async function suggestAdaptations(event, targetFandom, aiService) {
  const prompt = `Adapt this event from one fandom to ${targetFandom}:

Event: ${event.description}
Severity: ${event.severity}
Chapter: ${event.chapter}
Tags: ${(event.tags || []).join(', ')}
Canon/Fanon: ${event.canonOrFanon?.type || 'canon'}
Emotional Intensity: ${event.emotionalIntensity || 5}/10
Characters: ${(event.characters || []).join(', ')}

Provide:
1. Equivalent event in ${targetFandom}
2. Any warnings/cautions about adaptation
3. Key adaptation notes (character equivalents, setting changes needed)
4. Suggested intensity rating for the adapted version`;

  try {
    const response = await aiService.generate(prompt);
    return parseAdaptationResponse(response);
  } catch (error) {
    return {
      success: false,
      equivalent: null,
      cautions: ['AI service unavailable'],
      notes: [],
      suggestedIntensity: event.emotionalIntensity || 5,
    };
  }
}

function parseAdaptationResponse(response) {
  try {
    // Try to parse as JSON
    if (typeof response === 'string') {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
    }
    return {
      success: true,
      equivalent: response.equivalent || response.description || String(response),
      cautions: response.cautions || [],
      notes: response.notes || [],
      suggestedIntensity: response.suggestedIntensity || 5,
    };
  } catch {
    return {
      success: true,
      equivalent: String(response),
      cautions: [],
      notes: [],
      suggestedIntensity: 5,
    };
  }
}

/**
 * Get comparison summary text
 */
export function getComparisonSummary(comparison) {
  const { stats } = comparison;
  const { similarity } = stats;

  const lines = [];

  lines.push(`## So sánh: ${stats.corpusA.title} vs ${stats.corpusB.title}`);
  lines.push('');

  lines.push('### Thống kê');
  lines.push(`- ${stats.corpusA.title}: ${stats.corpusA.total} events | ${stats.corpusA.canonCount} canon | ${stats.corpusA.fanonCount} fanon`);
  lines.push(`- ${stats.corpusB.title}: ${stats.corpusB.total} events | ${stats.corpusB.canonCount} canon | ${stats.corpusB.fanonCount} fanon`);
  lines.push('');

  lines.push('### Độ tương đồng');
  lines.push(`- Điểm tương đồng: ${similarity.similarityScore}`);
  lines.push(`- Pattern giống nhau: ${similarity.totalSimilar}`);
  lines.push(`- Chỉ có ở A: ${similarity.totalUniqueA}`);
  lines.push(`- Chỉ có ở B: ${similarity.totalUniqueB}`);
  lines.push('');

  if (comparison.similarities.length > 0) {
    lines.push('### Pattern giống nhau');
    for (const sim of comparison.similarities.slice(0, 5)) {
      lines.push(`- ${sim.patternA.description.slice(0, 60)}... ≈ ${sim.patternB.description.slice(0, 60)}... (${Math.round(sim.similarity * 100)}%)`);
    }
  }

  return lines.join('\n');
}
