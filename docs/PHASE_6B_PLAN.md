# PHASE 6B: Hybrid Incident-First - Pipeline & Implementation

## Tổng quan

Phase này cover **Pipeline Implementation** (Steps 1-6), **ConsistencyRisk System**, **Frontend Changes**, và **API Endpoints**.

> **Điều kiện tiên quyết:** Đọc [PHASE_6A_PLAN.md](./PHASE_6A_PLAN.md) trước để hiểu Data Models, Database Schema, và Rules.

---

## 1. File Structure

```
src/
├── services/
│   └── analysis/
│       ├── models/                    # PHASE 6A
│       │   ├── incident.js
│       │   ├── event.js
│       │   ├── location.js
│       │   ├── consistencyRisk.js
│       │   └── reviewQueue.js
│       │
│       ├── pipeline/                  # NEW - Incident-First Pipeline
│       │   ├── incidentAnalyzer.js    # Main orchestrator
│       │   ├── globalSegmentation.js  # Step 1: Identify incidents
│       │   ├── boundaryRefine.js      # Step 2: Refine boundaries
│       │   ├── deepIncidentAnalysis.js # Step 3: Analyze per incident
│       │   ├── coherencePass.js       # Step 4: Global coherence
│       │   ├── scoringEngine.js       # Step 5: Score & rank
│       │   ├── reviewQueueBuilder.js  # Step 6: Build review queue
│       │   └── modes.js              # Run mode configs
│       │
│       ├── consistency/                # NEW - Consistency checking
│       │   ├── consistencyChecker.js  # Main checker
│       │   ├── timelineValidator.js  # Timeline conflicts
│       │   ├── stateValidator.js     # State contradictions
│       │   ├── causalValidator.js     # Causal chain validator
│       │   └── spanValidator.js       # Span anomaly detector
│       │
│       ├── grounding/                  # Mở rộng từ hiện tại
│       │   ├── enhancedGrounding.js   # Ground events to chapters
│       │   └── incidentGrounding.js  # Ground incidents
│       │
│       ├── jobs/                       # Job integration
│       │   ├── incidentAnalysisJob.js # Job type cho incident analysis
│       │   └── coherenceJob.js        # Job type cho coherence pass
│       │
│       └── prompts/                    # Prompts mới
│           ├── incidentSegmentationPrompt.js
│           ├── incidentAnalysisPrompt.js
│           ├── coherencePrompt.js
│           └── consistencyCheckPrompt.js
```

---

## 2. Step 1: Global Segmentation

### 2.1 Entry Point

```javascript
// src/services/analysis/pipeline/globalSegmentation.js

/**
 * Global Segmentation - Step 1 của Incident-First Pipeline
 * 
 * Mục tiêu: AI đọc ngữ cảnh lớn (hoặc compressed context),
 * trả về danh sách incidents với:
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
    // Fast: chỉ load chapter titles + first 500 words mỗi chapter
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
Bạn là chuyên gia phân tích truyện. Nhiệm vụ: XÁC ĐỊNH CÁC INCIDENTS (sự kiện lớn) trong truyện.

ĐỊNH NGHĨA INCIDENT:
- Incident = đơn vị kể chuyện CẤP CAO, không phải mọi sự kiện nhỏ
- Incident là điểm nút thay đổi cốt truyện, có thể bao gồm nhiều sự kiện con
- Ví dụ: "Cuộc chiến Hogwarts", "Chuyến đi đầu tiên", "Cuộc ly hôn"

PHÂN LOẠI INCIDENT:
- major_plot_point: Điểm nút cốt truyện chính, ảnh hưởng toàn bộ truyện
- subplot: Câu chuyện phụ, có thể chồng lấn timeline
- pov_thread: POV lane riêng (ví dụ: GoT - chapter của Tyrion vs Daenerys)

QUY TẮC BOUNDARY:
- Dùng chapter INDEX (0-based) cho start/end, KHÔNG dùng offset ký tự
- Mỗi incident phải có: title, type, startChapter, endChapter, confidence, evidence
- Nếu chưa chắc biên, đánh dấu uncertainStart hoặc uncertainEnd = true
- BẮT BUỘC có boundaryNote giải thích

OUTPUT FORMAT (JSON):
{
  "incidents": [
    {
      "title": "Tên incident (ngắn gọn, có ý nghĩa)",
      "type": "major_plot_point | subplot | pov_thread",
      "startChapter": 0,  // 0-based index
      "endChapter": 5,    // 0-based index, inclusive
      "confidence": 0.9,  // 0-1
      "uncertainStart": false,
      "uncertainEnd": false,
      "boundaryNote": "Giải thích tại sao chọn boundary này",
      "evidence": ["snippet 1 từ text gốc", "snippet 2"],
      "description": "Mô tả ngắn incident"
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

Hãy phân tích context và trả về JSON.`;
}
```

---

## 3. Step 2: Boundary Refine

### 3.1 Entry Point

```javascript
// src/services/analysis/pipeline/boundaryRefine.js

/**
 * Boundary Refine - Step 2 của Incident-First Pipeline
 * 
 * Mục tiêu: Cải thiện boundary của incidents bằng:
 * 1. Lexical overlap giữa các chapter biên
 * 2. BM25 scoring cho semantic similarity
 * 3. Đánh dấu uncertain boundaries
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
 * Deep Per Incident - Step 3 của Incident-First Pipeline
 * 
 * CHẠY SONG SONG các incidents
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
Bạn là chuyên gia phân tích truyện. Nhiệm vụ: PHÂN TÍCH CHI TIẾT một INCIDENT.

INCIDENT ĐANG PHÂN TÍCH:
- Title: ${incident.title}
- Type: ${incident.type}
- Chapters: ${incident.startChapter} - ${incident.endChapter}
- Confidence: ${incident.confidence}
- Description: ${incident.description}

ĐỊNH NGHĨA EVENT:
- Event = sự kiện/cảnh cụ thể trong incident
- Event có thể thuộc nhiều incident (dùng linkRole: secondary)
- Event phải có: title, description, chapter, severity, causalLinks

OUTPUT FORMAT (JSON):
{
  "events": [
    {
      "title": "Tên event",
      "description": "Mô tả chi tiết event",
      "chapter": 3,  // 0-based, relative to incident start
      "severity": 0.8,  // 0-1
      "tags": ["angst", "character_development"],
      "characters": ["Char A", "Char B"],
      "causesEventIds": ["evt-1"],
      "causedByEventIds": [],
      "locationHint": "Mô tả địa điểm",
      "confidence": 0.9,
      "evidence": ["snippet"]
    }
  ],
  "locations": [
    {
      "name": "Tên địa điểm",
      "aliases": ["alias1", "alias2"],
      "firstMentionChapter": 1,
      "importance": 0.8,
      "evidence": ["snippet"]
    }
  ],
  "climaxAnchor": {
    "eventId": "evt-3",
    "description": "Đỉnh điểm của incident"
  }
}

CONTEXT (${context.chapters.length} chapters):
${context.text}

Hãy phân tích và trả về JSON.`;
}
```

---

## 5. Step 4: Global Coherence Pass

```javascript
// src/services/analysis/pipeline/coherencePass.js

/**
 * Global Coherence Pass - Step 4 của Incident-First Pipeline
 * 
 * Mục tiêu:
 * 1. Merge incidents trùng lặp/chồng lấn
 * 2. Split incidents chứa 2 cụm event không liên thông
 * 3. Chuẩn hóa tên nhân vật/địa điểm
 * 4. Sửa thứ tự timeline
 * 5. Chấm lại major/minor score toàn cục
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
 * Scoring Engine - Step 5 của Incident-First Pipeline
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
// Incident: >= 0.85 + evidence → auto-accept
// Event: >= 0.75 + valid chapter/chunk → auto-accept
// Location: >= 0.80 + evidence snippet → auto-accept
// Thiếu evidence → luôn needs_review

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
 * Review Queue Builder - Step 6 của Incident-First Pipeline
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

// Timeline Inversion: Event A gây ra Event B nhưng B xảy ra trước A

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
          description: `Event "${causeEvent.title}" được cho là gây ra "${event.title}" nhưng xảy ra SAU (Ch.${causeEvent.chapterIndex} > Ch.${event.chapterIndex})`,
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
            <span className="stat P0">⚠️ P0: {reviewStats.P0}</span>
            <span className="stat P1">📋 P1: {reviewStats.P1}</span>
            <span className="stat P2">📝 P2: {reviewStats.P2}</span>
          </div>
        )}
      </header>
      
      <ViewToggle 
        view={view} 
        onChange={setView}
        options={[
          { id: 'incidents', label: '📍 Incidents', icon: '📍' },
          { id: 'events', label: '📖 Events', icon: '📖' },
          { id: 'review', label: '🔍 Review Queue', icon: '🔍' },
          { id: 'timeline', label: '📅 Timeline', icon: '📅' },
          { id: 'locations', label: '🏰 Locations', icon: '🏰' },
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
          <option value="all">Tất cả types</option>
          <option value="major_plot_point">⭐ Major Plot Points</option>
          <option value="subplot">📖 Subplots</option>
          <option value="pov_thread">👁️ POV Threads</option>
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
          Tất cả ({items.length})
        </button>
        <button className={`priority P0 ${filter === 'P0' ? 'active' : ''}`} onClick={() => onFilterChange('P0')}>
          ⚠️ P0 ({items.filter(i => i.priority === 'P0').length})
        </button>
        <button className={`priority P1 ${filter === 'P1' ? 'active' : ''}`} onClick={() => onFilterChange('P1')}>
          📋 P1 ({items.filter(i => i.priority === 'P1').length})
        </button>
        <button className={`priority P2 ${filter === 'P2' ? 'active' : ''}`} onClick={() => onFilterChange('P2')}>
          📝 P2 ({items.filter(i => i.priority === 'P2').length})
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
- [ ] Create incident model
- [ ] Create consistencyRisk model  
- [ ] Create reviewQueue model
- [ ] Add columns to events table
- [ ] Create new database tables
- [ ] Update DB queries

### Phase 6.2: Pipeline Core
- [ ] Implement globalSegmentation
- [ ] Implement boundaryRefine
- [ ] Implement deepIncidentAnalysis
- [ ] Implement coherencePass
- [ ] Implement scoringEngine
- [ ] Implement reviewQueueBuilder

### Phase 6.3: Consistency System
- [ ] Implement consistencyChecker
- [ ] Implement timelineValidator
- [ ] Implement stateValidator
- [ ] Implement causalValidator
- [ ] Implement spanValidator

### Phase 6.4: Frontend
- [ ] Update AnalysisViewer for incident-first
- [ ] Create IncidentListView
- [ ] Create IncidentCard
- [ ] Create ReviewQueueView
- [ ] Create ReviewQueueCard
- [ ] Update filters and sorting

### Phase 6.5: Integration
- [ ] Connect pipeline to job system
- [ ] Add SSE progress updates
- [ ] Connect to existing stores
- [ ] Add review resolution actions

---

## 13. Migration Strategy

### Từ Pipeline cũ sang Incident-First

1. **Giữ nguyên dữ liệu cũ**
   - Events cũ vẫn lưu trong bảng
   - Tạo bảng mới cho incidents

2. **Backup trước khi migrate**
   ```sql
   -- Backup events
   CREATE TABLE events_backup AS SELECT * FROM analysis_events;
   ```

3. **Chạy incident analysis cho corpus đã có**
   - Tạo API endpoint để re-analyze
   - UI: "Analyze with Incident-First"

4. **Timeline:**
   - Phase 6.1-6.3: 2-3 tuần
   - Phase 6.4-6.5: 1-2 tuần
   - Testing: 1 tuần

---

## 14. Testing Checklist

### Unit Tests
- [ ] Test incident parsing
- [ ] Test boundary calculation
- [ ] Test merge/split algorithms
- [ ] Test scoring engine
- [ ] Test consistency checks

### Integration Tests
- [ ] Test full pipeline with small corpus
- [ ] Test pipeline with different modes
- [ ] Test review queue building
- [ ] Test database operations

### E2E Tests
- [ ] Test user flow: upload → analyze → review
- [ ] Test incident detail view
- [ ] Test review queue resolution
- [ ] Test viewer performance with large corpus
