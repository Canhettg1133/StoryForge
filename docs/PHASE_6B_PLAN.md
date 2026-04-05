# PHASE 6B: Hybrid Incident-First - Pipeline & Implementation

## Tá»•ng quan

Phase nĂ y cover **Pipeline Implementation** (Steps 1-6), **ConsistencyRisk System**, **Frontend Changes**, vĂ  **API Endpoints**.

> **Äiá»u kiá»‡n tiĂªn quyáº¿t:** Äá»c [PHASE_6A_PLAN.md](./PHASE_6A_PLAN.md) trÆ°á»›c Ä‘á»ƒ hiá»ƒu Data Models, Database Schema, vĂ  Rules.

---

## 1. File Structure

```
src/
â”œâ”€â”€ services/
â”‚   â””â”€â”€ analysis/
â”‚       â”œâ”€â”€ models/                    # PHASE 6A
â”‚       â”‚   â”œâ”€â”€ incident.js
â”‚       â”‚   â”œâ”€â”€ event.js
â”‚       â”‚   â”œâ”€â”€ location.js
â”‚       â”‚   â”œâ”€â”€ consistencyRisk.js
â”‚       â”‚   â””â”€â”€ reviewQueue.js
â”‚       â”‚
â”‚       â”œâ”€â”€ pipeline/                  # NEW - Incident-First Pipeline
â”‚       â”‚   â”œâ”€â”€ incidentAnalyzer.js    # Main orchestrator
â”‚       â”‚   â”œâ”€â”€ globalSegmentation.js  # Step 1: Identify incidents
â”‚       â”‚   â”œâ”€â”€ boundaryRefine.js      # Step 2: Refine boundaries
â”‚       â”‚   â”œâ”€â”€ deepIncidentAnalysis.js # Step 3: Analyze per incident
â”‚       â”‚   â”œâ”€â”€ coherencePass.js       # Step 4: Global coherence
â”‚       â”‚   â”œâ”€â”€ scoringEngine.js       # Step 5: Score & rank
â”‚       â”‚   â”œâ”€â”€ reviewQueueBuilder.js  # Step 6: Build review queue
â”‚       â”‚   â””â”€â”€ modes.js              # Run mode configs
â”‚       â”‚
â”‚       â”œâ”€â”€ consistency/                # NEW - Consistency checking
â”‚       â”‚   â”œâ”€â”€ consistencyChecker.js  # Main checker
â”‚       â”‚   â”œâ”€â”€ timelineValidator.js  # Timeline conflicts
â”‚       â”‚   â”œâ”€â”€ stateValidator.js     # State contradictions
â”‚       â”‚   â”œâ”€â”€ causalValidator.js     # Causal chain validator
â”‚       â”‚   â””â”€â”€ spanValidator.js       # Span anomaly detector
â”‚       â”‚
â”‚       â”œâ”€â”€ grounding/                  # Má»Ÿ rá»™ng tá»« hiá»‡n táº¡i
â”‚       â”‚   â”œâ”€â”€ enhancedGrounding.js   # Ground events to chapters
â”‚       â”‚   â””â”€â”€ incidentGrounding.js  # Ground incidents
â”‚       â”‚
â”‚       â”œâ”€â”€ jobs/                       # Job integration
â”‚       â”‚   â”œâ”€â”€ incidentAnalysisJob.js # Job type cho incident analysis
â”‚       â”‚   â””â”€â”€ coherenceJob.js        # Job type cho coherence pass
â”‚       â”‚
â”‚       â””â”€â”€ prompts/                    # Prompts má»›i
â”‚           â”œâ”€â”€ incidentSegmentationPrompt.js
â”‚           â”œâ”€â”€ incidentAnalysisPrompt.js
â”‚           â”œâ”€â”€ coherencePrompt.js
â”‚           â””â”€â”€ consistencyCheckPrompt.js
```

---

## 2. Step 1: Global Segmentation

### 2.1 Entry Point

```javascript
// src/services/analysis/pipeline/globalSegmentation.js

/**
 * Global Segmentation - Step 1 cá»§a Incident-First Pipeline
 * 
 * Má»¥c tiĂªu: AI Ä‘á»c ngá»¯ cáº£nh lá»›n (hoáº·c compressed context),
 * tráº£ vá» danh sĂ¡ch incidents vá»›i:
 * - title
 * - type (major_plot_point | subplot | pov_thread)
 * - start/end (theo chapter index)
 * - confidence
 * - evidence
 */

export async function globalSegmentation(corpus, options = {}) {
  const {
    mode = 'balanced', // 'fast' | 'balanced' | 'deep'
    maxContextWords = 500000,
    minConfidence = 0.50,
  } = options;
  
  // 1. Load chapters
  const chapters = await loadChapters(corpus.id);
  
  // 2. Build context
  let context;
  if (mode === 'fast') {
    // Fast: chá»‰ load chapter titles + first 500 words má»—i chapter
    context = buildCompressedContext(chapters, { maxWords: 50000 });
  } else if (mode === 'balanced') {
    // Balanced: load more context
    context = buildCompressedContext(chapters, { maxWords: maxContextWords / 2 });
  } else {
    // Deep: load full context
    context = buildFullContext(chapters, { maxWords: maxContextWords });
  }
  
  // 3. Build prompt
  const prompt = buildSegmentationPrompt(context, {
    chapterCount: chapters.length,
    mode,
  });
  
  // 4. Call AI
  const response = await callAI(prompt, {
    model: options.model || 'gemini-3.1-pro',
    temperature: 0.3,
    maxOutputTokens: 32768,
  });
  
  // 5. Parse incidents
  let incidents = parseIncidentsFromResponse(response);
  
  // 6. Filter by confidence
  incidents = incidents.filter(i => i.confidence >= minConfidence);
  
  // 7. Validate and enrich
  incidents = await enrichIncidents(incidents, chapters, options);
  
  return {
    incidents,
    mode,
    contextWords: context.wordCount,
    processingTime: Date.now() - startTime,
  };
}
```

### 2.2 Segmentation Prompt

```javascript
// src/services/analysis/prompts/incidentSegmentationPrompt.js

export function buildSegmentationPrompt(context, options) {
  return `
Báº¡n lĂ  chuyĂªn gia phĂ¢n tĂ­ch truyá»‡n. Nhiá»‡m vá»¥: XĂC Äá»NH CĂC INCIDENTS (sá»± kiá»‡n lá»›n) trong truyá»‡n.

Äá»NH NGHÄ¨A INCIDENT:
- Incident = Ä‘Æ¡n vá»‹ ká»ƒ chuyá»‡n Cáº¤P CAO, khĂ´ng pháº£i má»i sá»± kiá»‡n nhá»
- Incident lĂ  Ä‘iá»ƒm nĂºt thay Ä‘á»•i cá»‘t truyá»‡n, cĂ³ thá»ƒ bao gá»“m nhiá»u sá»± kiá»‡n con
- VĂ­ dá»¥: "Cuá»™c chiáº¿n Hogwarts", "Chuyáº¿n Ä‘i Ä‘áº§u tiĂªn", "Cuá»™c ly hĂ´n"

PHĂ‚N LOáº I INCIDENT:
- major_plot_point: Äiá»ƒm nĂºt cá»‘t truyá»‡n chĂ­nh, áº£nh hÆ°á»Ÿng toĂ n bá»™ truyá»‡n
- subplot: CĂ¢u chuyá»‡n phá»¥, cĂ³ thá»ƒ chá»“ng láº¥n timeline
- pov_thread: POV lane riĂªng (vĂ­ dá»¥: GoT - chapter cá»§a Tyrion vs Daenerys)

QUY Táº®C BOUNDARY:
- DĂ¹ng chapter INDEX (0-based) cho start/end, KHĂ”NG dĂ¹ng offset kĂ½ tá»±
- Má»—i incident pháº£i cĂ³: title, type, startChapter, endChapter, confidence, evidence
- Náº¿u chÆ°a cháº¯c biĂªn, Ä‘Ă¡nh dáº¥u uncertainStart hoáº·c uncertainEnd = true
- Báº®T BUá»˜C cĂ³ boundaryNote giáº£i thĂ­ch

OUTPUT FORMAT (JSON):
{
  "incidents": [
    {
      "title": "TĂªn incident (ngáº¯n gá»n, cĂ³ Ă½ nghÄ©a)",
      "type": "major_plot_point | subplot | pov_thread",
      "startChapter": 0,  // 0-based index
      "endChapter": 5,    // 0-based index, inclusive
      "confidence": 0.9,  // 0-1
      "uncertainStart": false,
      "uncertainEnd": false,
      "boundaryNote": "Giáº£i thĂ­ch táº¡i sao chá»n boundary nĂ y",
      "evidence": ["snippet 1 tá»« text gá»‘c", "snippet 2"],
      "description": "MĂ´ táº£ ngáº¯n incident"
    }
  ],
  "analysis": {
    "totalIncidents": 10,
    "majorPlotPoints": 3,
    "subplots": 5,
    "povThreads": 2
  }
}

CONTEXT (${options.chapterCount} chapters):
${context.text}

HĂ£y phĂ¢n tĂ­ch context vĂ  tráº£ vá» JSON.`;
}
```

---

## 3. Step 2: Boundary Refine

### 3.1 Entry Point

```javascript
// src/services/analysis/pipeline/boundaryRefine.js

/**
 * Boundary Refine - Step 2 cá»§a Incident-First Pipeline
 * 
 * Má»¥c tiĂªu: Cáº£i thiá»‡n boundary cá»§a incidents báº±ng:
 * 1. Lexical overlap giá»¯a cĂ¡c chapter biĂªn
 * 2. BM25 scoring cho semantic similarity
 * 3. ÄĂ¡nh dáº¥u uncertain boundaries
 */

export async function refineBoundaries(incidents, chapters, options = {}) {
  const refinedIncidents = [];
  
  for (const incident of incidents) {
    const refined = await refineIncidentBoundary(incident, chapters, options);
    refinedIncidents.push(refined);
  }
  
  return refinedIncidents;
}

async function refineIncidentBoundary(incident, chapters, options = {}) {
  const { 
    overlapThreshold = 0.3,
    bm25Threshold = 0.4,
  } = options;
  
  // Get boundary chapters
  const startChapter = chapters[incident.startChapter];
  const endChapter = chapters[incident.endChapter];
  
  // Calculate lexical overlap
  const startOverlap = calculateLexicalOverlap(
    startChapter.content,
    getNextChapterContent(chapters, incident.startChapter)
  );
  
  const endOverlap = calculateLexicalOverlap(
    endChapter.content,
    getPrevChapterContent(chapters, incident.endChapter)
  );
  
  // Calculate BM25 similarity
  const startBM25 = await calculateBM25(
    startChapter.content,
    getChunkSample(chapters, incident.startChapter + 1, 5)
  );
  
  const endBM25 = await calculateBM25(
    endChapter.content,
    getChunkSample(chapters, incident.endChapter - 5, 5)
  );
  
  // Update uncertainty flags
  let uncertainStart = incident.uncertainStart;
  let uncertainEnd = incident.uncertainEnd;
  let boundaryNote = incident.boundaryNote || '';
  
  if (startOverlap < overlapThreshold || startBM25 < bm25Threshold) {
    uncertainStart = true;
    boundaryNote += `\n[UNCERTAIN_START] Low overlap (${startOverlap.toFixed(2)}) and BM25 (${startBM25.toFixed(2)})`;
  }
  
  if (endOverlap < overlapThreshold || endBM25 < bm25Threshold) {
    uncertainEnd = true;
    boundaryNote += `\n[UNCERTAIN_END] Low overlap (${endOverlap.toFixed(2)}) and BM25 (${endBM25.toFixed(2)})`;
  }
  
  // Calculate active span
  const activeSpan = incident.endChapter - incident.startChapter + 1;
  
  return {
    ...incident,
    uncertainStart,
    uncertainEnd,
    boundaryNote,
    activeSpan,
    overlapScores: { start: startOverlap, end: endOverlap },
    bm25Scores: { start: startBM25, end: endBM25 },
  };
}

function calculateLexicalOverlap(text1, text2) {
  const words1 = new Set(tokenize(text1));
  const words2 = new Set(tokenize(text2));
  
  const intersection = [...words1].filter(w => words2.has(w)).length;
  const union = new Set([...words1, ...words2]).size;
  
  return intersection / union;
}
```

---

## 4. Step 3: Deep Per Incident Analysis

### 4.1 Entry Point

```javascript
// src/services/analysis/pipeline/deepIncidentAnalysis.js

/**
 * Deep Per Incident - Step 3 cá»§a Incident-First Pipeline
 * 
 * CHáº Y SONG SONG cĂ¡c incidents
 */

export async function analyzeIncidents(incidents, chapters, options = {}) {
  const {
    maxConcurrency = 3,
    perIncidentMaxWords = 100000,
  } = options;
  
  // Semaphore for concurrency control
  const semaphore = new Semaphore(maxConcurrency);
  
  // Analyze all incidents in parallel
  const promises = incidents.map(incident => 
    semaphore.acquire(() => analyzeSingleIncident(incident, chapters, options))
  );
  
  const results = await Promise.all(promises);
  
  return {
    incidents: results.map(r => r.incident),
    events: results.flatMap(r => r.events),
    locations: results.flatMap(r => r.locations),
    causalLinks: results.flatMap(r => r.causalLinks),
  };
}

async function analyzeSingleIncident(incident, chapters, options) {
  // 1. Get incident context
  const incidentContext = getIncidentContext(chapters, incident, {
    maxWords: options.perIncidentMaxWords || 100000,
    includeBoundary: 1,
  });
  
  // 2. Build deep analysis prompt
  const prompt = buildIncidentAnalysisPrompt(incident, incidentContext);
  
  // 3. Call AI
  const response = await callAI(prompt, {
    model: options.model || 'gemini-3.1-pro',
    temperature: 0.2,
    maxOutputTokens: 24576,
  });
  
  // 4. Parse response
  const analysis = parseIncidentAnalysis(response);
  
  // 5. Create event objects
  const events = analysis.events.map(e => createEvent(e, incident, options));
  
  // 6. Create/update location objects
  const locations = await createLocations(analysis.locations, incident, options);
  
  // 7. Create causal links
  const causalLinks = createCausalLinks(events, analysis.causalChains);
  
  // 8. Ground events to specific chapters
  const groundedEvents = await groundEvents(events, incidentContext.chapters, options);
  
  return {
    incident: {
      ...incident,
      status: 'completed',
      analyzedAt: Date.now(),
      containedEvents: groundedEvents.map(e => e.id),
      relatedLocations: locations.map(l => l.id),
    },
    events: groundedEvents,
    locations,
    causalLinks,
  };
}
```

### 4.2 Incident Analysis Prompt

```javascript
// src/services/analysis/prompts/incidentAnalysisPrompt.js

export function buildIncidentAnalysisPrompt(incident, context) {
  return `
Báº¡n lĂ  chuyĂªn gia phĂ¢n tĂ­ch truyá»‡n. Nhiá»‡m vá»¥: PHĂ‚N TĂCH CHI TIáº¾T má»™t INCIDENT.

INCIDENT ÄANG PHĂ‚N TĂCH:
- Title: ${incident.title}
- Type: ${incident.type}
- Chapters: ${incident.startChapter} - ${incident.endChapter}
- Confidence: ${incident.confidence}
- Description: ${incident.description}

Äá»NH NGHÄ¨A EVENT:
- Event = sá»± kiá»‡n/cáº£nh cá»¥ thá»ƒ trong incident
- Event cĂ³ thá»ƒ thuá»™c nhiá»u incident (dĂ¹ng linkRole: secondary)
- Event pháº£i cĂ³: title, description, chapter, severity, causalLinks

OUTPUT FORMAT (JSON):
{
  "events": [
    {
      "title": "TĂªn event",
      "description": "MĂ´ táº£ chi tiáº¿t event",
      "chapter": 3,  // 0-based, relative to incident start
      "severity": 0.8,  // 0-1
      "tags": ["angst", "character_development"],
      "characters": ["Char A", "Char B"],
      "causesEventIds": ["evt-1"],
      "causedByEventIds": [],
      "locationHint": "MĂ´ táº£ Ä‘á»‹a Ä‘iá»ƒm",
      "confidence": 0.9,
      "evidence": ["snippet"]
    }
  ],
  "locations": [
    {
      "name": "TĂªn Ä‘á»‹a Ä‘iá»ƒm",
      "aliases": ["alias1", "alias2"],
      "firstMentionChapter": 1,
      "importance": 0.8,
      "evidence": ["snippet"]
    }
  ],
  "climaxAnchor": {
    "eventId": "evt-3",
    "description": "Äá»‰nh Ä‘iá»ƒm cá»§a incident"
  }
}

CONTEXT (${context.chapters.length} chapters):
${context.text}

HĂ£y phĂ¢n tĂ­ch vĂ  tráº£ vá» JSON.`;
}
```

---

## 5. Step 4: Global Coherence Pass

```javascript
// src/services/analysis/pipeline/coherencePass.js

/**
 * Global Coherence Pass - Step 4 cá»§a Incident-First Pipeline
 * 
 * Má»¥c tiĂªu:
 * 1. Merge incidents trĂ¹ng láº·p/chá»“ng láº¥n
 * 2. Split incidents chá»©a 2 cá»¥m event khĂ´ng liĂªn thĂ´ng
 * 3. Chuáº©n hĂ³a tĂªn nhĂ¢n váº­t/Ä‘á»‹a Ä‘iá»ƒm
 * 4. Sá»­a thá»© tá»± timeline
 * 5. Cháº¥m láº¡i major/minor score toĂ n cá»¥c
 */

export async function coherencePass(incidents, events, locations, options = {}) {
  const { mode = 'balanced' } = options;
  
  // 1. Calculate merge/split scores
  const mergeScores = calculateMergeScores(incidents);
  const splitScores = calculateSplitScores(incidents, events);
  
  // 2. Auto-merge or suggest-merge
  const mergedIncidents = await processMerges(incidents, mergeScores, options);
  
  // 3. Auto-split or suggest-split
  const splitIncidents = await processSplits(mergedIncidents, splitScores, events, options);
  
  // 4. Normalize entities
  const normalizedLocations = normalizeLocations(locations, splitIncidents);
  
  // 5. Fix timeline order
  const orderedIncidents = fixTimelineOrder(splitIncidents, events);
  
  // 6. Recalculate major/minor scores
  const scoredIncidents = recalculateScores(orderedIncidents, events, { mode });
  
  // 7. Update event-incident links if needed
  const updatedEvents = updateEventLinks(events, scoredIncidents);
  
  return {
    incidents: scoredIncidents,
    events: updatedEvents,
    locations: normalizedLocations,
    changes: {
      merged: incidents.length - scoredIncidents.length,
      split: splitIncidents.length - mergedIncidents.length,
      normalized: normalizedLocations.length - locations.length,
    },
  };
}

// Merge: auto >= 0.82, suggest 0.70-0.82, no < 0.70
// Hard no-merge: conflict timeline/POV lane + no causal bridge

function calculateMergeScores(incidents) {
  const scores = [];
  
  for (let i = 0; i < incidents.length; i++) {
    for (let j = i + 1; j < incidents.length; j++) {
      const score = calculatePairMergeScore(incidents[i], incidents[j]);
      
      if (score >= 0.70) {
        scores.push({
          incident1: incidents[i].id,
          incident2: incidents[j].id,
          score,
          type: score >= 0.82 ? 'auto' : 'suggest',
        });
      }
    }
  }
  
  return scores.sort((a, b) => b.score - a.score);
}

function calculatePairMergeScore(inc1, inc2) {
  let score = 0;
  let factors = 0;
  
  // Factor 1: Timeline overlap (30%)
  const overlap = calculateChapterOverlap(inc1, inc2);
  score += overlap * 0.30;
  factors++;
  
  // Factor 2: Title similarity (25%)
  const titleSim = calculateTitleSimilarity(inc1.title, inc2.title);
  score += titleSim * 0.25;
  factors++;
  
  // Factor 3: Shared events (25%)
  const sharedEvents = inc1.containedEvents.filter(e => inc2.containedEvents.includes(e));
  const eventSim = sharedEvents.length / Math.max(inc1.containedEvents.length, inc2.containedEvents.length);
  score += eventSim * 0.25;
  factors++;
  
  // Factor 4: Same location (10%)
  const sameLocation = inc1.relatedLocations.some(l => inc2.relatedLocations.includes(l));
  if (sameLocation) score += 0.10;
  factors++;
  
  // Factor 5: Causal link (10%)
  const causalLink = inc1.causalSuccessors.includes(inc2.id) || inc2.causalSuccessors.includes(inc1.id);
  if (causalLink) score += 0.10;
  factors++;
  
  return score / factors;
}
```

---

## 6. Step 5: Scoring Engine

```javascript
// src/services/analysis/pipeline/scoringEngine.js

/**
 * Scoring Engine - Step 5 cá»§a Incident-First Pipeline
 */

export async function scoreItems(incidents, events, locations, consistencyRisks) {
  // 1. Score incidents
  const scoredIncidents = incidents.map(incident => {
    const score = calculateIncidentScore(incident, events, consistencyRisks);
    return {
      ...incident,
      confidence: score.confidence,
      majorScore: score.majorScore,
      impactScore: score.impactScore,
      needsReview: score.needsReview,
    };
  });
  
  // 2. Score events
  const scoredEvents = events.map(event => {
    const score = calculateEventScore(event);
    return {
      ...event,
      confidence: score.confidence,
      qualityProxy: score.qualityProxy,
      needsReview: score.needsReview,
    };
  });
  
  // 3. Score locations
  const scoredLocations = locations.map(location => {
    const score = calculateLocationScore(location);
    return {
      ...location,
      confidence: score.confidence,
      needsReview: score.needsReview,
    };
  });
  
  return { scoredIncidents, scoredEvents, scoredLocations };
}

// Confidence thresholds:
// Incident: >= 0.85 + evidence â†’ auto-accept
// Event: >= 0.75 + valid chapter/chunk â†’ auto-accept
// Location: >= 0.80 + evidence snippet â†’ auto-accept
// Thiáº¿u evidence â†’ luĂ´n needs_review

function calculateIncidentScore(incident, events, consistencyRisks) {
  let confidence = incident.confidence || 0.5;
  let majorScore = 0;
  let impactScore = 0;
  
  // Boost from contained events
  const containedEvents = events.filter(e => e.incidentId === incident.id);
  if (containedEvents.length > 0) {
    const avgSeverity = containedEvents.reduce((sum, e) => sum + e.severity, 0) / containedEvents.length;
    confidence += avgSeverity * 0.1;
    majorScore = Math.min(10, containedEvents.filter(e => e.severity >= 0.8).length * 2);
  }
  
  // Impact from type
  if (incident.type === 'major_plot_point') {
    impactScore += 3;
    confidence += 0.1;
  }
  
  // Check evidence
  const hasEvidence = incident.evidence && incident.evidence.length > 0;
  if (!hasEvidence) {
    confidence -= 0.2;
  }
  
  // Check consistency risks
  const relevantRisks = consistencyRisks.filter(r => 
    r.involvedIncidents.includes(incident.id)
  );
  for (const risk of relevantRisks) {
    confidence -= CONFLICT_SEVERITY[risk.severity].penalty;
  }
  
  confidence = Math.min(1, Math.max(0, confidence));
  
  const needsReview = !hasEvidence || confidence < 0.85 || relevantRisks.length > 0;
  
  return {
    confidence: Math.round(confidence * 100) / 100,
    majorScore: Math.round(majorScore * 10) / 10,
    impactScore: Math.round(impactScore * 10) / 10,
    needsReview,
  };
}
```

---

## 7. Step 6: Review Queue Builder

```javascript
// src/services/analysis/pipeline/reviewQueueBuilder.js

/**
 * Review Queue Builder - Step 6 cá»§a Incident-First Pipeline
 * 
 * Priority formula:
 * priorityScore = 0.30*impact + 0.25*(1-confidence) + 0.20*consistencyRisk 
 *               + 0.15*boundaryAmbiguity + 0.10*missingEvidence
 */

export async function buildReviewQueue(incidents, events, locations, consistencyRisks, options = {}) {
  const queue = [];
  
  // 1. Add incidents needing review
  for (const incident of incidents) {
    if (incident.needsReview || incident.reviewStatus === 'needs_review') {
      const priority = calculateIncidentPriority(incident, consistencyRisks);
      queue.push({
        itemType: 'incident',
        itemId: incident.id,
        ...priority,
      });
    }
  }
  
  // 2. Add events needing review
  for (const event of events) {
    if (event.needsReview) {
      const priority = calculateEventPriority(event);
      queue.push({
        itemType: 'event',
        itemId: event.id,
        ...priority,
      });
    }
  }
  
  // 3. Add locations needing review
  for (const location of locations) {
    if (location.needsReview || location.confidence < 0.80) {
      const priority = calculateLocationPriority(location);
      queue.push({
        itemType: 'location',
        itemId: location.id,
        ...priority,
      });
    }
  }
  
  // 4. Add consistency risks
  for (const risk of consistencyRisks) {
    if (!risk.resolved) {
      queue.push({
        itemType: 'consistency_risk',
        itemId: risk.id,
        ...calculateConsistencyRiskPriority(risk),
      });
    }
  }
  
  // 5. Sort by priority
  queue.sort((a, b) => b.priorityScore - a.priorityScore);
  
  // 6. Assign P0/P1/P2
  const assigned = queue.map((item, index) => {
    let priority;
    if (item.priorityScore >= 0.75 || item.hasHardConflict) {
      priority = 'P0';
    } else if (item.priorityScore >= 0.50) {
      priority = 'P1';
    } else {
      priority = 'P2';
    }
    
    return {
      ...item,
      priority,
      rank: index + 1,
    };
  });
  
  return assigned;
}
```

---

## 8. ConsistencyRisk System

### 8.1 Main Consistency Checker

```javascript
// src/services/analysis/consistency/consistencyChecker.js

/**
 * Main consistency checker
 * 
 * Detects 10 types of conflicts:
 * 
 * HARD (+0.40 penalty):
 * - timeline_inversion
 * - state_contradiction
 * - impossible_co_location
 * 
 * MEDIUM (+0.25 penalty):
 * - missing_prerequisite
 * - duplicate_anchors_conflict
 * - pov_continuity_break
 * 
 * SOFT (+0.15 penalty):
 * - entity_collision
 * - span_anomaly
 * - evidence_mismatch
 */

export async function checkConsistency(incidents, events, locations, options = {}) {
  const risks = [];
  
  // 1. Timeline inversion check
  const timelineRisks = await checkTimelineInversion(incidents, events);
  risks.push(...timelineRisks);
  
  // 2. State contradiction check
  const stateRisks = checkStateContradictions(events);
  risks.push(...stateRisks);
  
  // 3. Impossible co-location check
  const coLocationRisks = checkImpossibleCoLocation(events, incidents);
  risks.push(...coLocationRisks);
  
  // 4. Missing prerequisite check
  const prereqRisks = checkMissingPrerequisites(events);
  risks.push(...prereqRisks);
  
  // 5. Duplicate anchors check
  const anchorRisks = checkDuplicateAnchors(incidents);
  risks.push(...anchorRisks);
  
  // 6. POV continuity check
  const povRisks = checkPOVContinuity(incidents);
  risks.push(...povRisks);
  
  // 7. Entity collision check
  const entityRisks = checkEntityCollisions(locations);
  risks.push(...entityRisks);
  
  // 8. Span anomaly check
  const spanRisks = checkSpanAnomalies(incidents, events);
  risks.push(...spanRisks);
  
  // 9. Evidence mismatch check
  const evidenceRisks = checkEvidenceMismatch(incidents, events);
  risks.push(...evidenceRisks);
  
  return risks;
}
```

### 8.2 Timeline Inversion Check

```javascript
// src/services/analysis/consistency/timelineValidator.js

// Timeline Inversion: Event A gĂ¢y ra Event B nhÆ°ng B xáº£y ra trÆ°á»›c A

async function checkTimelineInversion(incidents, events) {
  const risks = [];
  
  for (const event of events) {
    if (!event.causalLinks || !event.causalLinks.causes) continue;
    
    for (const causeId of event.causalLinks.causes) {
      const causeEvent = events.find(e => e.id === causeId);
      if (!causeEvent) continue;
      
      // Check if cause is after effect
      if (causeEvent.chapterIndex > event.chapterIndex) {
        risks.push({
          id: generateId(),
          type: 'timeline_inversion',
          severity: 'hard',
          description: `Event "${causeEvent.title}" Ä‘Æ°á»£c cho lĂ  gĂ¢y ra "${event.title}" nhÆ°ng xáº£y ra SAU (Ch.${causeEvent.chapterIndex} > Ch.${event.chapterIndex})`,
          details: {
            causeEvent: { id: causeEvent.id, chapter: causeEvent.chapterIndex },
            effectEvent: { id: event.id, chapter: event.chapterIndex },
          },
          involvedEvents: [causeEvent.id, event.id],
          evidence: [
            `Cause: ${causeEvent.description}`,
            `Effect: ${event.description}`,
          ],
          chapterRange: [Math.min(causeEvent.chapterIndex, event.chapterIndex), Math.max(causeEvent.chapterIndex, event.chapterIndex)],
        });
      }
    }
  }
  
  return risks;
}
```

### 8.3 State Contradiction Check

```javascript
// src/services/analysis/consistency/stateValidator.js

// State Contradiction: Character state inconsistent within span

function checkStateContradictions(events) {
  const risks = [];
  
  // Group events by character
  const eventsByCharacter = {};
  for (const event of events) {
    if (event.characters) {
      for (const char of event.characters) {
        if (!eventsByCharacter[char]) eventsByCharacter[char] = [];
        eventsByCharacter[char].push(event);
      }
    }
  }
  
  // Check for state contradictions
  for (const [character, charEvents] of Object.entries(eventsByCharacter)) {
    charEvents.sort((a, b) => a.chapterIndex - b.chapterIndex);
    
    for (let i = 0; i < charEvents.length - 1; i++) {
      for (let j = i + 1; j < charEvents.length; j++) {
        if (charEvents[j].chapterIndex - charEvents[i].chapterIndex > 5) break;
        
        const contradiction = detectStateContradiction(charEvents[i], charEvents[j], character);
        if (contradiction) {
          risks.push({
            id: generateId(),
            type: 'state_contradiction',
            severity: 'hard',
            description: contradiction.description,
            details: contradiction.details,
            involvedEvents: [charEvents[i].id, charEvents[j].id],
            evidence: [charEvents[i].description, charEvents[j].description],
            chapterRange: [charEvents[i].chapterIndex, charEvents[j].chapterIndex],
          });
        }
      }
    }
  }
  
  return risks;
}
```

---

## 9. Main Pipeline Orchestrator

```javascript
// src/services/analysis/pipeline/incidentAnalyzer.js

/**
 * IncidentAnalyzer - Main entry point cho Incident-First Pipeline
 */

import { globalSegmentation } from './globalSegmentation.js';
import { refineBoundaries } from './boundaryRefine.js';
import { analyzeIncidents } from './deepIncidentAnalysis.js';
import { coherencePass } from './coherencePass.js';
import { scoreItems } from './scoringEngine.js';
import { buildReviewQueue } from './reviewQueueBuilder.js';
import { checkConsistency } from '../consistency/consistencyChecker.js';
import { RUN_MODES } from './modes.js';

export class IncidentAnalyzer {
  constructor(corpusId, options = {}) {
    this.corpusId = corpusId;
    this.options = {
      mode: 'balanced',
      model: 'gemini-3.1-pro',
      ...options,
    };
    this.modeConfig = RUN_MODES[this.options.mode];
    
    this.incidents = [];
    this.events = [];
    this.locations = [];
    this.consistencyRisks = [];
    this.reviewQueue = [];
    
    this.progress = { phase: 'idle', progress: 0, message: '' };
    this.onProgress = options.onProgress || (() => {});
  }
  
  async run() {
    const startTime = Date.now();
    
    try {
      // Phase 1: Global Segmentation
      await this.step('segmentation', async () => {
        const result = await globalSegmentation(this.corpusId, {
          ...this.options,
          mode: this.modeConfig.segmentationContext,
          maxContextWords: this.modeConfig.maxSegmentationWords,
        });
        this.incidents = result.incidents;
      });
      
      // Phase 2: Boundary Refine
      if (this.modeConfig.boundaryRefine) {
        await this.step('boundary_refine', async () => {
          this.incidents = await refineBoundaries(this.incidents, this.chapters, {
            overlapThreshold: this.modeConfig.overlapThreshold,
            useBM25: this.modeConfig.bm25Refinement,
          });
        });
      }
      
      // Phase 3: Deep Per Incident Analysis
      await this.step('deep_analysis', async () => {
        const result = await analyzeIncidents(this.incidents, this.chapters, {
          ...this.options,
          maxConcurrency: this.modeConfig.deepAnalysisConcurrency,
          perIncidentMaxWords: this.modeConfig.perIncidentMaxWords,
        });
        this.incidents = result.incidents;
        this.events = result.events;
        this.locations = result.locations;
      });
      
      // Phase 4: Consistency Check
      await this.step('consistency_check', async () => {
        this.consistencyRisks = await checkConsistency(
          this.incidents, 
          this.events, 
          this.locations,
          this.options
        );
      });
      
      // Phase 5: Global Coherence Pass
      await this.step('coherence', async () => {
        const result = await coherencePass(
          this.incidents, 
          this.events, 
          this.locations,
          { mode: this.modeConfig.coherencePass }
        );
        this.incidents = result.incidents;
        this.events = result.events;
        this.locations = result.locations;
      });
      
      // Phase 6: Scoring
      await this.step('scoring', async () => {
        const { scoredIncidents, scoredEvents, scoredLocations } = await scoreItems(
          this.incidents,
          this.events,
          this.locations,
          this.consistencyRisks
        );
        this.incidents = scoredIncidents;
        this.events = scoredEvents;
        this.locations = scoredLocations;
      });
      
      // Phase 7: Review Queue
      if (this.modeConfig.reviewQueueBuild) {
        await this.step('review_queue', async () => {
          this.reviewQueue = await buildReviewQueue(
            this.incidents,
            this.events,
            this.locations,
            this.consistencyRisks,
            this.options
          );
        });
      }
      
      // Save to database
      await this.saveResults();
      
      return {
        success: true,
        incidents: this.incidents,
        events: this.events,
        locations: this.locations,
        consistencyRisks: this.consistencyRisks,
        reviewQueue: this.reviewQueue,
        processingTime: Date.now() - startTime,
      };
      
    } catch (error) {
      return {
        success: false,
        error: error.message,
        partialResults: { incidents: this.incidents, events: this.events },
      };
    }
  }
  
  async step(phase, fn) {
    this.progress = { phase, progress: 0, message: `Starting ${phase}...` };
    this.onProgress(this.progress);
    
    try {
      await fn();
      this.progress.progress = 1;
      this.progress.message = `Completed ${phase}`;
      this.onProgress(this.progress);
    } catch (error) {
      this.progress.phase = `${phase}_error`;
      this.progress.message = error.message;
      this.onProgress(this.progress);
      throw error;
    }
  }
  
  async saveResults() {
    for (const incident of this.incidents) await db.incidents.upsert(incident);
    for (const event of this.events) await db.analysisEvents.upsert(event);
    for (const location of this.locations) await db.locations.upsert(location);
    for (const risk of this.consistencyRisks) await db.consistencyRisks.upsert(risk);
    for (const item of this.reviewQueue) await db.reviewQueue.upsert(item);
  }
}

// Convenience function
export async function runIncidentAnalysis(corpusId, options = {}) {
  const analyzer = new IncidentAnalyzer(corpusId, options);
  return analyzer.run();
}
```

---

## 10. Frontend Changes

### 10.1 AnalysisViewer - Incident-First Mode

```jsx
// src/pages/Lab/CorpusLab/AnalysisViewer.jsx (modifications)

export function AnalysisViewer({ corpusId }) {
  const [view, setView] = useState('incidents'); // Default changed to 'incidents'
  const [reviewFilter, setReviewFilter] = useState('all');
  
  // Get review queue stats
  const reviewStats = useMemo(() => {
    if (!analysis?.reviewQueue) return null;
    return {
      total: analysis.reviewQueue.length,
      P0: analysis.reviewQueue.filter(i => i.priority === 'P0').length,
      P1: analysis.reviewQueue.filter(i => i.priority === 'P1').length,
      P2: analysis.reviewQueue.filter(i => i.priority === 'P2').length,
    };
  }, [analysis]);
  
  return (
    <div className="analysis-viewer">
      <header>
        <h2>{corpus.title} - Incident-First Analysis</h2>
        <span className="mode-badge">{analysis.mode || 'balanced'}</span>
        
        {reviewStats && (
          <div className="review-stats">
            <span className="stat P0">â ï¸ P0: {reviewStats.P0}</span>
            <span className="stat P1">đŸ“‹ P1: {reviewStats.P1}</span>
            <span className="stat P2">đŸ“ P2: {reviewStats.P2}</span>
          </div>
        )}
      </header>
      
      <ViewToggle 
        view={view} 
        onChange={setView}
        options={[
          { id: 'incidents', label: 'đŸ“ Incidents', icon: 'đŸ“' },
          { id: 'events', label: 'đŸ“– Events', icon: 'đŸ“–' },
          { id: 'review', label: 'đŸ” Review Queue', icon: 'đŸ”' },
          { id: 'timeline', label: 'đŸ“… Timeline', icon: 'đŸ“…' },
          { id: 'locations', label: 'đŸ° Locations', icon: 'đŸ°' },
        ]}
      />
      
      {view === 'incidents' && (
        <IncidentListView
          incidents={analysis.incidents}
          events={analysis.events}
          onIncidentClick={handleIncidentClick}
        />
      )}
      
      {view === 'review' && (
        <ReviewQueueView
          items={analysis.reviewQueue}
          filter={reviewFilter}
          onFilterChange={setReviewFilter}
          onResolve={handleResolveReview}
        />
      )}
    </div>
  );
}
```

### 10.2 IncidentListView Component

```jsx
// src/pages/Lab/CorpusLab/components/IncidentListView.jsx

export function IncidentListView({ incidents, events, onIncidentClick }) {
  const [sortBy, setSortBy] = useState('chapter');
  const [filterType, setFilterType] = useState('all');
  const [expandedIncidents, setExpandedIncidents] = useState(new Set());
  
  const displayIncidents = useMemo(() => {
    let filtered = incidents;
    if (filterType !== 'all') {
      filtered = filtered.filter(i => i.type === filterType);
    }
    return filtered.sort((a, b) => {
      switch (sortBy) {
        case 'chapter': return a.startChapter - b.startChapter;
        case 'confidence': return b.confidence - a.confidence;
        case 'severity': return (b.majorScore || 0) - (a.majorScore || 0);
        default: return 0;
      }
    });
  }, [incidents, sortBy, filterType]);
  
  return (
    <div className="incident-list-view">
      <div className="filters">
        <select value={filterType} onChange={e => setFilterType(e.target.value)}>
          <option value="all">Táº¥t cáº£ types</option>
          <option value="major_plot_point">â­ Major Plot Points</option>
          <option value="subplot">đŸ“– Subplots</option>
          <option value="pov_thread">đŸ‘ï¸ POV Threads</option>
        </select>
        <select value={sortBy} onChange={e => setSortBy(e.target.value)}>
          <option value="chapter">Theo Chapter</option>
          <option value="confidence">Theo Confidence</option>
          <option value="severity">Theo Severity</option>
        </select>
      </div>
      
      <div className="incident-list">
        {displayIncidents.map(incident => (
          <IncidentCard
            key={incident.id}
            incident={incident}
            events={events.filter(e => e.incidentId === incident.id)}
            expanded={expandedIncidents.has(incident.id)}
            onToggle={() => toggleExpand(incident.id)}
            onClick={() => onIncidentClick(incident)}
          />
        ))}
      </div>
    </div>
  );
}
```

### 10.3 ReviewQueueView Component

```jsx
// src/pages/Lab/CorpusLab/components/ReviewQueueView.jsx

export function ReviewQueueView({ items, filter, onFilterChange, onResolve }) {
  const filteredItems = useMemo(() => {
    if (filter === 'all') return items;
    if (filter === 'needs_review') return items.filter(i => i.status === 'pending');
    return items.filter(i => i.priority === filter);
  }, [items, filter]);
  
  return (
    <div className="review-queue-view">
      <div className="filters">
        <button className={filter === 'all' ? 'active' : ''} onClick={() => onFilterChange('all')}>
          Táº¥t cáº£ ({items.length})
        </button>
        <button className={`priority P0 ${filter === 'P0' ? 'active' : ''}`} onClick={() => onFilterChange('P0')}>
          â ï¸ P0 ({items.filter(i => i.priority === 'P0').length})
        </button>
        <button className={`priority P1 ${filter === 'P1' ? 'active' : ''}`} onClick={() => onFilterChange('P1')}>
          đŸ“‹ P1 ({items.filter(i => i.priority === 'P1').length})
        </button>
        <button className={`priority P2 ${filter === 'P2' ? 'active' : ''}`} onClick={() => onFilterChange('P2')}>
          đŸ“ P2 ({items.filter(i => i.priority === 'P2').length})
        </button>
      </div>
      
      <div className="queue-list">
        {filteredItems.map((item, index) => (
          <ReviewQueueCard key={item.id} item={item} rank={index + 1} onResolve={onResolve} />
        ))}
      </div>
    </div>
  );
}
```

---

## 11. API Endpoints

### 11.1 Incident Analysis API

```javascript
// POST /api/corpus/:id/incident-analysis
// Start incident-first analysis

Request:
{
  mode: 'fast' | 'balanced' | 'deep',
  model: 'gemini-3.1-pro',
}

Response:
{
  id: "analysis-uuid",
  corpusId: "corpus-uuid",
  status: "processing",
  mode: "balanced",
  estimatedTime: "15 minutes",
}

// GET /api/corpus/:id/incidents
// Get all incidents for corpus

Response:
{
  incidents: [...],
  total: 15,
}

// GET /api/corpus/:id/incidents/:incidentId
// Get incident detail with events

Response:
{
  incident: { ... },
  events: [...],
  locations: [...],
  consistencyRisks: [...],
}

// PATCH /api/corpus/:id/incidents/:incidentId
// Update incident (for review)

Request:
{
  title: "...",
  boundaryNote: "...",
  reviewStatus: "auto_accepted" | "needs_review",
  priority: "P0" | "P1" | "P2",
}

// GET /api/corpus/:id/review-queue
// Get review queue

Query:
?filter=all|P0|P1|P2|needs_review
&limit=20&offset=0

Response:
{
  items: [...],
  stats: { P0: 5, P1: 10, P2: 20 },
  total: 35,
}

// PATCH /api/corpus/:id/review-queue/:itemId
// Resolve review item

Request:
{
  status: 'resolved' | 'ignored',
  resolution: 'Accepted as-is' | 'Merged with...' | 'Edited: ...',
}
```

---

## 12. Implementation Phases

### Phase 6.1: Data Models & Database
- [x] Create incident model
- [x] Create consistencyRisk model  
- [x] Create reviewQueue model
- [x] Add columns to events table
- [x] Create new database tables
- [x] Update DB queries

### Phase 6.2: Pipeline Core
- [x] Implement globalSegmentation
- [x] Implement boundaryRefine
- [x] Implement deepIncidentAnalysis
- [x] Implement coherencePass
- [x] Implement scoringEngine
- [x] Implement reviewQueueBuilder

### Phase 6.3: Consistency System
- [x] Implement consistencyChecker
- [x] Implement timelineValidator
- [x] Implement stateValidator
- [x] Implement causalValidator
- [x] Implement spanValidator

### Phase 6.4: Frontend
- [x] Update AnalysisViewer for incident-first
- [x] Create IncidentListView
- [x] Create IncidentCard
- [x] Create ReviewQueueView
- [x] Create ReviewQueueCard
- [x] Update filters and sorting

### Phase 6.5: Integration
- [x] Connect pipeline to job system
- [x] Add SSE progress updates
- [x] Connect to existing stores
- [x] Add review resolution actions

### Phase 6.6: Ops & Maintenance
- [x] Add backup automation script (`scripts/backup-corpus-db.js`)
- [x] Add backfill automation module (`src/services/analysis/maintenance/backfillAutomation.js`)
- [x] Add one-command maintenance runner (`scripts/phase6-maintenance.js`)
- [x] Keep migration compatibility wrapper (`scripts/migrate-incident-first.js`)
- [x] Add dedicated unit/integration/e2e tests for maintenance flow

---

## 13. Migration Strategy

### Tá»« Pipeline cÅ© sang Incident-First

1. **Giá»¯ nguyĂªn dá»¯ liá»‡u cÅ©**
   - Events cÅ© váº«n lÆ°u trong báº£ng
   - Táº¡o báº£ng má»›i cho incidents

2. **Backup trÆ°á»›c khi migrate**
   ```sql
   -- Backup events
   CREATE TABLE events_backup AS SELECT * FROM analysis_events;
   ```

3. **Cháº¡y incident analysis cho corpus Ä‘Ă£ cĂ³**
   - Táº¡o API endpoint Ä‘á»ƒ re-analyze
   - UI: "Analyze with Incident-First"

4. **Timeline:**
   - Phase 6.1-6.3: 2-3 tuáº§n
   - Phase 6.4-6.5: 1-2 tuáº§n
   - Testing: 1 tuáº§n

---

## 14. Testing Checklist

### Unit Tests
- [x] Test incident parsing
- [x] Test boundary calculation
- [x] Test merge/split algorithms
- [x] Test scoring engine
- [x] Test consistency checks
- [x] Test backup utility create/prune behavior

### Integration Tests
- [x] Test full pipeline with small corpus
- [x] Test pipeline with different modes
- [x] Test review queue building
- [x] Test database operations
- [x] Test backfill automation persists incidents/events/locations

### E2E Tests
- [x] Test user flow: upload -> analyze -> review
- [x] Test incident detail view
- [x] Test review queue resolution
- [x] Test viewer performance with large corpus
- [x] Test maintenance script (backup + backfill) end-to-end

---

## 15. Ops Automation Update (2026-04-05)

### Automation Commands

```bash
# Backup corpus DB (+ WAL/SHM sidecars if present)
npm run backup:corpus -- --db data/storyforge-corpus.sqlite --keep-last 20

# Backfill incident-first artifacts from existing corpus_analyses.final_result
npm run backfill:incident-first -- --force

# One command: backup + backfill
npm run phase6:maintenance -- --force
```
