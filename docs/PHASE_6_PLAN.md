# PHASE 6: Hybrid Incident-First Analysis Pipeline

## Tổng quan

Thay thế pipeline phân tích hiện tại (chunk-by-chunk → event) bằng **Incident-First** approach - phân tích theo sự kiện lớn trước, event nhỏ là lớp con.

**Điểm khác biệt cốt lõi:**
- Cũ: Chunk → Event (bottom-up, rời rạc, thiếu nhìn toàn cục)
- Mới: Incident → Event (top-down, có ngữ cảnh, có coherence)

---

## 1. Mục tiêu triển khai

### 1.1 Core Objectives

```
1. Global Segmentation - AI đọc ngữ cảnh lớn, trả incident list
2. Boundary Refine - Soát biên bằng lexical/BM25
3. Deep Per Incident - Chạy song song từng incident
4. Global Coherence Pass - Merge/split, chuẩn hóa entity
5. Scoring + Review Queue - Chấm confidence, phân P0/P1/P2
6. Incident-First Viewer - Hiển thị theo incident + location
```

### 1.2 So sánh với Pipeline hiện tại

| Aspect | Hiện tại (Phase 3) | Mới (Incident-First) |
|--------|---------------------|-----------------------|
| Unit | Chunk | Incident |
| Output | Event rời rạc | Incident tree với events con |
| Global view | Không | Có (Coherence Pass) |
| Consistency | Không | Có (ConsistencyRisk) |
| Review | Thủ công | Priority queue (P0/P1/P2) |
| Speed | Nhanh/bình thường | Có thể chậm hơn |

---

## 2. Data Model Mới

### 2.1 Incident Schema

```javascript
// src/services/analysis/models/incident.js

export const INCIDENT_TYPES = {
  MAJOR_PLOT_POINT: 'major_plot_point',   // Điểm nút cốt truyện
  SUBPLOT: 'subplot',                      // Câu chuyện phụ
  POV_THREAD: 'pov_thread',               // POV lane (GoT style)
};

export const INCIDENT_STATUS = {
  PENDING: 'pending',
  ANALYZING: 'analyzing',
  COMPLETED: 'completed',
  MERGED: 'merged',
  SPLIT: 'split',
  NEEDS_REVIEW: 'needs_review',
};

export const INCIDENT_CONFIDENCE = {
  AUTO_ACCEPT: 0.85,
  NEEDS_REVIEW: 0.70,
  LOW: 0.50,
};

export const incidentSchema = {
  id: 'string (uuid)',
  corpusId: 'string (uuid)',
  analysisId: 'string (uuid)',
  
  // Core
  title: 'string',
  type: 'INCIDENT_TYPES',
  description: 'string',
  
  // Boundaries - dùng chapter/chunk, KHÔNG dùng offset
  startChapterId: 'string',
  startChunkId: 'string',
  endChapterId: 'string', 
  endChunkId: 'string',
  chapterRange: '[startIndex, endIndex]',
  chunkRange: '[startIndex, endIndex]',
  
  // Anchors
  startAnchor: {
    chapterId: 'string',
    chunkId: 'string',
    position: 'string', // "chapter_start" | "chapter_middle" | "chapter_end"
  },
  activeSpan: 'number', // số chapter trong incident
  climaxAnchor: {
    chapterId: 'string',
    chunkId: 'string',
    position: 'string',
    confidence: 'number',
  },
  endAnchor: {
    chapterId: 'string',
    chunkId: 'string',
    position: 'string',
  },
  boundaryNote: 'string', // BẮT BUỘC - giải thích biên
  
  // Uncertainty tracking
  uncertainStart: 'boolean',
  uncertainEnd: 'boolean',
  
  // Confidence & Evidence
  confidence: 'number (0-1)',
  evidence: 'string[]', // snippets từ text gốc
  
  // Containment
  containedEvents: 'string[] (event ids)',
  subIncidentIds: 'string[] (incident ids nếu split)',
  
  // Relations
  relatedIncidents: 'string[] (incident ids)',
  relatedLocations: 'string[] (location ids)',
  causalPredecessors: 'string[] (incident ids)',
  causalSuccessors: 'string[] (incident ids)',
  
  // Scoring
  majorScore: 'number (0-10)',
  impactScore: 'number (0-10)',
  
  // Status
  status: 'INCIDENT_STATUS',
  reviewStatus: '"auto_accepted" | "needs_review"',
  priority: 'null | "P0" | "P1" | "P2"',
  
  // Timestamps
  createdAt: 'timestamp',
  analyzedAt: 'timestamp',
  reviewedAt: 'timestamp',
};
```

### 2.2 Event Schema (Mở rộng)

```javascript
// src/services/analysis/models/event.js

export const EVENT_INCIDENT_LINK_ROLE = {
  PRIMARY: 'primary',    // Thuộc incident này là chính
  SECONDARY: 'secondary', // Thuộc incident này là phụ (có thể multi-incident)
};

export const EVENT_STATUS = {
  PENDING: 'pending',
  GROUNDED: 'grounded',
  REVIEWED: 'reviewed',
  REJECTED: 'rejected',
};

export const eventSchema = {
  id: 'string (uuid)',
  corpusId: 'string (uuid)',
  analysisId: 'string (uuid)',
  
  // Core
  title: 'string',
  description: 'string',
  severity: 'number (0-1)',
  tags: 'string[]',
  
  // Chapter/Chunk grounding - BẮT BUỘC
  chapterId: 'string',
  chapterIndex: 'number',
  chunkId: 'string',
  chunkIndex: 'number',
  
  // Incident Link - ĐIỂM MỚI
  incidentId: 'string', // incident cha
  linkRole: 'EVENT_INCIDENT_LINK_ROLE',
  secondaryIncidentIds: 'string[]', // có thể thuộc nhiều incident
  
  // Location Link
  locationLink: {
    locationId: 'string',
    locationName: 'string',
    confidence: 'number (0-1)',
    evidence: 'string[]',
    snippet: 'string',
  },
  
  // Causal Links
  causalLinks: {
    causes: 'string[] (event ids)',
    causedBy: 'string[] (event ids)',
  },
  
  // Quality
  confidence: 'number (0-1)',
  evidence: 'string[]',
  qualityProxy: 'number (0-100)',
  
  // Review
  reviewStatus: '"auto_accepted" | "needs_review"',
  needsReview: 'boolean',
  annotation: 'string',
  
  // Timestamps
  createdAt: 'timestamp',
  groundedAt: 'timestamp',
  reviewedAt: 'timestamp',
};
```

### 2.3 Location Schema (Mở rộng)

```javascript
// src/services/analysis/models/location.js

export const locationSchema = {
  id: 'string (uuid)',
  corpusId: 'string (uuid)',
  analysisId: 'string (uuid)',
  
  // Core
  name: 'string',
  normalized: 'string', // lowercase, stripped
  aliases: 'string[]',
  
  // Occurrence
  mentionCount: 'number',
  chapterSpread: '[startIndex, endIndex]',
  chapterStart: 'number',
  chapterEnd: 'number',
  
  // Importance
  importance: 'number (0-1)',
  isMajor: 'boolean',
  
  // Tokens & Evidence
  tokens: 'string[]', // extracted location mentions
  evidence: 'string[]', // snippets
  
  // Incident Link
  incidentIds: 'string[]', // các incident liên quan
  eventIds: 'string[]', // các event xảy ra ở đây
  
  // Confidence
  confidence: 'number (0-1)',
  evidenceStrength: 'number (0-1)',
  
  // Review
  reviewStatus: '"auto_accepted" | "needs_review"',
  
  // Timestamps
  createdAt: 'timestamp',
  reviewedAt: 'timestamp',
};
```

### 2.4 ConsistencyRisk Schema

```javascript
// src/services/analysis/models/consistencyRisk.js

export const CONFLICT_TYPES = {
  // Hard conflicts - +0.40 penalty
  TIMELINE_INVERSION: 'timeline_inversion',
  STATE_CONTRADICTION: 'state_contradiction',
  IMPOSSIBLE_CO_LOCATION: 'impossible_co_location',
  
  // Medium conflicts - +0.25 penalty
  MISSING_PREREQUISITE: 'missing_prerequisite',
  DUPLICATE_ANCHORS_CONFLICT: 'duplicate_anchors_conflict',
  POV_CONTINUITY_BREAK: 'pov_continuity_break',
  
  // Soft conflicts - +0.15 penalty
  ENTITY_COLLISION: 'entity_collision',
  SPAN_ANOMALY: 'span_anomaly',
  EVIDENCE_MISMATCH: 'evidence_mismatch',
};

export const CONFLICT_SEVERITY = {
  HARD: { penalty: 0.40, forceP0: true },
  MEDIUM: { penalty: 0.25, forceP0: false },
  SOFT: { penalty: 0.15, forceP0: false },
};

export const consistencyRiskSchema = {
  id: 'string (uuid)',
  corpusId: 'string (uuid)',
  analysisId: 'string (uuid)',
  
  // Conflict type
  type: 'CONFLICT_TYPES',
  severity: '"hard" | "medium" | "soft"',
  
  // Description
  description: 'string',
  details: 'object', // type-specific details
  
  // Involved entities
  involvedIncidents: 'string[]',
  involvedEvents: 'string[]',
  involvedLocations: 'string[]',
  
  // Evidence
  evidence: 'string[]',
  chapterRange: '[start, end]',
  
  // Resolution
  resolved: 'boolean',
  resolution: 'string',
  resolvedAt: 'timestamp',
  
  // Timestamps
  detectedAt: 'timestamp',
};
```

### 2.5 Review Queue Schema

```javascript
// src/services/analysis/models/reviewQueue.js

export const PRIORITY = {
  P0: 'P0', // >= 0.75 hoặc hard conflict
  P1: 'P1', // 0.50 - 0.74
  P2: 'P2', // < 0.50
};

export const REVIEW_ITEM_TYPES = {
  INCIDENT: 'incident',
  EVENT: 'event',
  LOCATION: 'location',
  CONSISTENCY_RISK: 'consistency_risk',
};

export const reviewQueueSchema = {
  id: 'string (uuid)',
  corpusId: 'string (uuid)',
  analysisId: 'string (uuid)',
  
  // Item reference
  itemType: 'REVIEW_ITEM_TYPES',
  itemId: 'string',
  
  // Priority
  priority: 'PRIORITY',
  priorityScore: 'number (0-1)',
  
  // Score breakdown
  scoreBreakdown: {
    impact: 'number',
    confidenceDeficit: 'number',
    consistencyRisk: 'number',
    boundaryAmbiguity: 'number',
    missingEvidence: 'number',
  },
  
  // Reason
  reason: 'string[]', // các lý do cần review
  suggestions: 'string[]', // gợi ý sửa
  
  // Status
  status: '"pending" | "in_review" | "resolved" | "ignored"',
  reviewedBy: 'string', // user id
  reviewedAt: 'timestamp',
  resolution: 'string',
  
  // Timestamps
  createdAt: 'timestamp',
};
```

---

## 3. Database Schema

### 3.1 incidents Table

```sql
-- incidents table
CREATE TABLE incidents (
    id TEXT PRIMARY KEY,
    corpus_id TEXT NOT NULL,
    analysis_id TEXT NOT NULL,
    
    -- Core
    title TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('major_plot_point', 'subplot', 'pov_thread')),
    description TEXT,
    
    -- Boundaries (chapter-based)
    start_chapter_id TEXT,
    start_chunk_id TEXT,
    end_chapter_id TEXT,
    end_chunk_id TEXT,
    chapter_start_index INTEGER,
    chapter_end_index INTEGER,
    chunk_start_index INTEGER,
    chunk_end_index INTEGER,
    
    -- Anchors
    start_anchor TEXT,  -- JSON: {chapterId, chunkId, position}
    active_span INTEGER,
    climax_anchor TEXT,  -- JSON: {chapterId, chunkId, position, confidence}
    end_anchor TEXT,     -- JSON: {chapterId, chunkId, position}
    boundary_note TEXT,
    
    -- Uncertainty
    uncertain_start INTEGER DEFAULT 0,
    uncertain_end INTEGER DEFAULT 0,
    
    -- Confidence
    confidence REAL DEFAULT 0,
    evidence TEXT,  -- JSON array
    
    -- Scoring
    major_score REAL DEFAULT 0,
    impact_score REAL DEFAULT 0,
    
    -- Status
    status TEXT DEFAULT 'pending',
    review_status TEXT DEFAULT 'needs_review',
    priority TEXT,
    
    -- Timestamps
    created_at INTEGER DEFAULT (strftime('%s', 'now')),
    analyzed_at INTEGER,
    reviewed_at INTEGER,
    
    FOREIGN KEY (corpus_id) REFERENCES corpuses(id),
    FOREIGN KEY (analysis_id) REFERENCES corpus_analyses(id)
);

-- Indexes
CREATE INDEX idx_incidents_corpus ON incidents(corpus_id);
CREATE INDEX idx_incidents_analysis ON incidents(analysis_id);
CREATE INDEX idx_incidents_type ON incidents(type);
CREATE INDEX idx_incidents_chapter_range ON incidents(chapter_start_index, chapter_end_index);
CREATE INDEX idx_incidents_confidence ON incidents(confidence);
CREATE INDEX idx_incidents_priority ON incidents(priority);
CREATE INDEX idx_incidents_review_status ON incidents(review_status);
```

### 3.2 events (Mở rộng)

```sql
-- Thêm columns vào bảng events hiện có hoặc tạo bảng mới
-- Giả sử bảng analysis_events

CREATE TABLE analysis_events (
    id TEXT PRIMARY KEY,
    corpus_id TEXT NOT NULL,
    analysis_id TEXT NOT NULL,
    
    -- Core
    title TEXT NOT NULL,
    description TEXT,
    severity REAL DEFAULT 0,
    tags TEXT,  -- JSON array
    
    -- Grounding
    chapter_id TEXT,
    chapter_index INTEGER,
    chunk_id TEXT,
    chunk_index INTEGER,
    
    -- Incident Link - NEW
    incident_id TEXT,
    link_role TEXT DEFAULT 'primary' CHECK (link_role IN ('primary', 'secondary')),
    secondary_incident_ids TEXT,  -- JSON array
    
    -- Location Link
    location_link TEXT,  -- JSON: {locationId, confidence, evidence, snippet}
    
    -- Causal Links
    causal_links TEXT,  -- JSON: {causes: [], causedBy: []}
    
    -- Confidence
    confidence REAL DEFAULT 0,
    evidence TEXT,  -- JSON array
    quality_proxy INTEGER DEFAULT 0,
    
    -- Review
    review_status TEXT DEFAULT 'needs_review',
    needs_review INTEGER DEFAULT 1,
    annotation TEXT,
    
    -- Timestamps
    created_at INTEGER DEFAULT (strftime('%s', 'now')),
    grounded_at INTEGER,
    reviewed_at INTEGER,
    
    FOREIGN KEY (corpus_id) REFERENCES corpuses(id),
    FOREIGN KEY (analysis_id) REFERENCES corpus_analyses(id),
    FOREIGN KEY (incident_id) REFERENCES incidents(id)
);

CREATE INDEX idx_events_incident ON analysis_events(incident_id);
CREATE INDEX idx_events_chapter ON analysis_events(chapter_index);
CREATE INDEX idx_events_confidence ON analysis_events(confidence);
CREATE INDEX idx_events_review_status ON analysis_events(review_status);
```

### 3.3 locations Table (Mở rộng)

```sql
-- Thêm columns cho incident linking
ALTER TABLE locations ADD COLUMN incident_ids TEXT;  -- JSON array
ALTER TABLE locations ADD COLUMN importance REAL DEFAULT 0;
ALTER TABLE locations ADD COLUMN is_major INTEGER DEFAULT 0;
```

### 3.4 consistency_risks Table

```sql
CREATE TABLE consistency_risks (
    id TEXT PRIMARY KEY,
    corpus_id TEXT NOT NULL,
    analysis_id TEXT NOT NULL,
    
    -- Conflict
    type TEXT NOT NULL,
    severity TEXT NOT NULL CHECK (severity IN ('hard', 'medium', 'soft')),
    description TEXT,
    details TEXT,  -- JSON for type-specific data
    
    -- Involved entities
    involved_incidents TEXT,  -- JSON array
    involved_events TEXT,     -- JSON array
    involved_locations TEXT,   -- JSON array
    
    -- Evidence
    evidence TEXT,  -- JSON array
    chapter_start INTEGER,
    chapter_end INTEGER,
    
    -- Resolution
    resolved INTEGER DEFAULT 0,
    resolution TEXT,
    resolved_at INTEGER,
    
    -- Timestamps
    detected_at INTEGER DEFAULT (strftime('%s', 'now')),
    
    FOREIGN KEY (corpus_id) REFERENCES corpuses(id),
    FOREIGN KEY (analysis_id) REFERENCES corpus_analyses(id)
);

CREATE INDEX idx_consistency_corpus ON consistency_risks(corpus_id);
CREATE INDEX idx_consistency_type ON consistency_risks(type);
CREATE INDEX idx_consistency_severity ON consistency_risks(severity);
CREATE INDEX idx_consistency_resolved ON consistency_risks(resolved);
```

### 3.5 review_queue Table

```sql
CREATE TABLE review_queue (
    id TEXT PRIMARY KEY,
    corpus_id TEXT NOT NULL,
    analysis_id TEXT NOT NULL,
    
    -- Item
    item_type TEXT NOT NULL CHECK (item_type IN ('incident', 'event', 'location', 'consistency_risk')),
    item_id TEXT NOT NULL,
    
    -- Priority
    priority TEXT NOT NULL CHECK (priority IN ('P0', 'P1', 'P2')),
    priority_score REAL DEFAULT 0,
    
    -- Score breakdown
    score_breakdown TEXT,  -- JSON
    
    -- Content
    reason TEXT,       -- JSON array
    suggestions TEXT,  -- JSON array
    
    -- Status
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'in_review', 'resolved', 'ignored')),
    reviewed_by TEXT,
    reviewed_at INTEGER,
    resolution TEXT,
    
    -- Timestamps
    created_at INTEGER DEFAULT (strftime('%s', 'now')),
    
    FOREIGN KEY (corpus_id) REFERENCES corpuses(id),
    FOREIGN KEY (analysis_id) REFERENCES corpus_analyses(id)
);

CREATE INDEX idx_review_corpus ON review_queue(corpus_id);
CREATE INDEX idx_review_priority ON review_queue(priority);
CREATE INDEX idx_review_status ON review_queue(status);
CREATE INDEX idx_review_item ON review_queue(item_type, item_id);
```

---

## 4. Pipeline Implementation

### 4.1 File Structure

```
src/
├── services/
│   └── analysis/
│       ├── models/                    # NEW
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
│       │   └── reviewQueueBuilder.js  # Step 6: Build review queue
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
│       │   └── coherenceJob.js         # Job type cho coherence pass
│       │
│       └── prompts/                    # Prompts mới
│           ├── incidentSegmentationPrompt.js
│           ├── incidentAnalysisPrompt.js
│           ├── coherencePrompt.js
│           └── consistencyCheckPrompt.js
```

### 4.2 Step 1: Global Segmentation

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
 * 
 * Algorithm:
 * 1. Load full text (hoặc compressed summary)
 * 2. Gọi AI với incidentSegmentationPrompt
 * 3. Parse response thành incident objects
 * 4. Validate boundaries
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

function buildSegmentationPrompt(context, options) {
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

### 4.3 Step 2: Boundary Refine

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

async function refineIncidentBoundary(incident, chapters, options) {
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

### 4.4 Step 3: Deep Per Incident Analysis

```javascript
// src/services/analysis/pipeline/deepIncidentAnalysis.js

/**
 * Deep Per Incident - Step 3 của Incident-First Pipeline
 * 
 * Mục tiêu: Với mỗi incident, gọi AI để trích xuất:
 * - Các event trong incident (sub-events)
 * - Nhân-quả links
 * - Nhân vật tham gia
 * - Địa điểm
 * - Độ quan trọng
 * 
 * CHẠY SONG SONG các incidents
 */

export async function analyzeIncidents(incidents, chapters, options = {}) {
  const {
    maxConcurrency = 3,
    perIncidentMaxWords = 100000, // ~75k tokens
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
  // 1. Get incident context (all chapters in range)
  const incidentContext = getIncidentContext(chapters, incident, {
    maxWords: options.perIncidentMaxWords || 100000,
    includeBoundary: 1, // Include 1 chapter before/after
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

function buildIncidentAnalysisPrompt(incident, context) {
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
      "severity": 0.8,  // 0-1, độ quan trọng
      "tags": ["angst", "character_development"],
      "characters": ["Char A", "Char B"],
      "causesEventIds": ["evt-1"],  // event nào gây ra event này
      "causedByEventIds": [],  // event nào gây ra event này
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

### 4.5 Step 4: Global Coherence Pass

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
  
  // 4. Normalize entities across all incidents
  const normalizedLocations = normalizeLocations(locations, splitIncidents);
  
  // 5. Fix timeline order
  const orderedIncidents = fixTimelineOrder(splitIncidents, events);
  
  // 6. Recalculate major/minor scores
  const scoredIncidents = recalculateScores(orderedIncidents, events, {
    mode,
  });
  
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

// Merge rules:
// Auto-merge: mergeScore >= 0.82
// Suggest-merge: 0.70 <= mergeScore < 0.82
// No-merge: < 0.70
// Hard no-merge: conflict timeline/POV lane và không causal bridge

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
  
  // Factor 1: Timeline overlap
  const overlap = calculateChapterOverlap(inc1, inc2);
  score += overlap * 0.30;
  factors++;
  
  // Factor 2: Title similarity
  const titleSim = calculateTitleSimilarity(inc1.title, inc2.title);
  score += titleSim * 0.25;
  factors++;
  
  // Factor 3: Shared events
  const sharedEvents = inc1.containedEvents.filter(e => inc2.containedEvents.includes(e));
  const eventSim = sharedEvents.length / Math.max(inc1.containedEvents.length, inc2.containedEvents.length);
  score += eventSim * 0.25;
  factors++;
  
  // Factor 4: Same location
  const sameLocation = inc1.relatedLocations.some(l => inc2.relatedLocations.includes(l));
  if (sameLocation) score += 0.10;
  factors++;
  
  // Factor 5: Causal link
  const causalLink = inc1.causalSuccessors.includes(inc2.id) || inc2.causalSuccessors.includes(inc1.id);
  if (causalLink) score += 0.10;
  factors++;
  
  return score / factors;
}

// Split rules:
// Split when 1 incident contains 2+ event clusters not causally connected

function calculateSplitScores(incidents, events) {
  const scores = [];
  
  for (const incident of incidents) {
    const incidentEvents = events.filter(e => e.incidentId === incident.id);
    const clusters = findEventClusters(incidentEvents);
    
    if (clusters.length > 1) {
      scores.push({
        incidentId: incident.id,
        clusters,
        score: 1 - (1 / clusters.length), // More clusters = higher split score
        type: 'suggest',
      });
    }
  }
  
  return scores;
}
```

### 4.6 Step 5: Scoring Engine

```javascript
// src/services/analysis/pipeline/scoringEngine.js

/**
 * Scoring Engine - Step 5 của Incident-First Pipeline
 * 
 * Chấm điểm confidence và quality cho incidents, events, locations
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
  
  // Cap at 1.0
  confidence = Math.min(1, Math.max(0, confidence));
  
  // Determine needsReview
  const needsReview = !hasEvidence || confidence < 0.85 || relevantRisks.length > 0;
  
  return {
    confidence: Math.round(confidence * 100) / 100,
    majorScore: Math.round(majorScore * 10) / 10,
    impactScore: Math.round(impactScore * 10) / 10,
    needsReview,
  };
}

function calculateEventScore(event) {
  let confidence = 0.5;
  let qualityProxy = 50;
  
  // Chapter/Chunk grounding
  if (event.chapterIndex !== undefined && event.chapterIndex !== null) {
    confidence += 0.2;
    qualityProxy += 20;
  }
  
  // Evidence
  if (event.evidence && event.evidence.length > 0) {
    confidence += 0.2;
    qualityProxy += 20;
  }
  
  // Severity
  if (event.severity) {
    confidence += event.severity * 0.1;
    qualityProxy += event.severity * 10;
  }
  
  // Causal links
  if (event.causalLinks && (event.causalLinks.causes.length > 0 || event.causalLinks.causedBy.length > 0)) {
    confidence += 0.1;
    qualityProxy += 10;
  }
  
  confidence = Math.min(1, Math.max(0, confidence));
  qualityProxy = Math.min(100, Math.max(0, qualityProxy));
  
  return {
    confidence: Math.round(confidence * 100) / 100,
    qualityProxy: Math.round(qualityProxy),
    needsReview: confidence < 0.75 || !event.evidence || event.evidence.length === 0,
  };
}
```

### 4.7 Step 6: Review Queue Builder

```javascript
// src/services/analysis/pipeline/reviewQueueBuilder.js

/**
 * Review Queue Builder - Step 6 của Incident-First Pipeline
 * 
 * Xây dựng hàng đợi duyệt với priority scoring
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

function calculateIncidentPriority(incident, consistencyRisks) {
  const relevantRisks = consistencyRisks.filter(r => 
    r.involvedIncidents.includes(incident.id)
  );
  
  const hasHardConflict = relevantRisks.some(r => r.severity === 'hard');
  const consistencyRisk = relevantRisks.reduce((sum, r) => 
    sum + CONFLICT_SEVERITY[r.severity].penalty, 0
  );
  
  const boundaryAmbiguity = (incident.uncertainStart ? 0.5 : 0) + 
                           (incident.uncertainEnd ? 0.5 : 0);
  
  const missingEvidence = incident.evidence && incident.evidence.length > 0 ? 0 : 1;
  
  const priorityScore = 
    0.30 * (incident.impactScore / 10) +
    0.25 * (1 - (incident.confidence || 0)) +
    0.20 * Math.min(1, consistencyRisk) +
    0.15 * Math.min(1, boundaryAmbiguity / 2) +
    0.10 * missingEvidence;
  
  const reasons = [];
  if (incident.uncertainStart) reasons.push('Uncertain start boundary');
  if (incident.uncertainEnd) reasons.push('Uncertain end boundary');
  if (!incident.evidence || incident.evidence.length === 0) reasons.push('Missing evidence');
  if (relevantRisks.length > 0) reasons.push(`${relevantRisks.length} consistency risk(s)`);
  
  return {
    priorityScore: Math.round(priorityScore * 100) / 100,
    hasHardConflict,
    scoreBreakdown: {
      impact: incident.impactScore / 10,
      confidenceDeficit: 1 - (incident.confidence || 0),
      consistencyRisk: Math.min(1, consistencyRisk),
      boundaryAmbiguity: Math.min(1, boundaryAmbiguity / 2),
      missingEvidence,
    },
    reason: reasons,
    suggestions: generateIncidentSuggestions(incident, relevantRisks),
  };
}
```

---

## 5. ConsistencyRisk System

### 5.1 Consistency Checker

```javascript
// src/services/analysis/consistency/consistencyChecker.js

/**
 * Main consistency checker
 * 
 * Detects 10 types of conflicts:
 * 
 * HARD (+0.40 penalty):
 * - timeline_inversion: nguyên nhân nằm sau kết quả
 * - state_contradiction: trạng thái nhân vật tự mâu thuẫn
 * - impossible_co_location: nhân vật ở 2 nơi không thể di chuyển
 * 
 * MEDIUM (+0.25 penalty):
 * - missing_prerequisite: event cần điều kiện không tồn tại
 * - duplicate_anchors_conflict: 2 incident cùng anchor khác outcome
 * - pov_continuity_break: POV lane nhảy không cầu nối
 * 
 * SOFT (+0.15 penalty):
 * - entity_collision: cùng tên nhưng role khác hẳn
 * - span_anomaly: incident quá dài/dài mà density thấp
 * - evidence_mismatch: confidence cao nhưng evidence yếu
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
    // Sort by chapter
    charEvents.sort((a, b) => a.chapterIndex - b.chapterIndex);
    
    // Look for contradictory states
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

// Impossible Co-location: Character in 2 places simultaneously
function checkImpossibleCoLocation(events, incidents) {
  const risks = [];
  
  // Build location timeline per character
  const charLocations = buildCharacterLocationTimeline(events);
  
  for (const [character, timeline] of Object.entries(charLocations)) {
    // Check for impossible movements
    for (let i = 0; i < timeline.length - 1; i++) {
      const curr = timeline[i];
      const next = timeline[i + 1];
      
      if (curr.chapterIndex === next.chapterIndex) {
        // Same chapter but different location
        if (curr.locationId !== next.locationId) {
          const distance = calculateLocationDistance(curr.locationName, next.locationName);
          if (distance === 'impossible') {
            risks.push({
              id: generateId(),
              type: 'impossible_co_location',
              severity: 'hard',
              description: `"${character}" không thể ở cả "${curr.locationName}" và "${next.locationName}" cùng lúc`,
              details: { character, locations: [curr, next] },
              involvedEvents: [curr.eventId, next.eventId],
              evidence: [curr.description, next.description],
              chapterRange: [curr.chapterIndex, next.chapterIndex],
            });
          }
        }
      }
    }
  }
  
  return risks;
}
```

---

## 6. Three Run Modes

### 6.1 Mode Configuration

```javascript
// src/services/analysis/pipeline/modes.js

export const RUN_MODES = {
  FAST: {
    id: 'fast',
    name: 'Fast',
    description: 'Bỏ bước 1M context, dùng local + gộp nhanh',
    
    // Segmentation
    segmentationContext: 'compressed', // 'compressed' | 'full' | '1m'
    maxSegmentationWords: 50000,
    
    // Boundary refine
    boundaryRefine: false, // Skip boundary refinement
    
    // Deep analysis
    deepAnalysisConcurrency: 5,
    perIncidentMaxWords: 50000,
    
    // Coherence
    coherencePass: 'light', // 'none' | 'light' | 'full'
    autoMergeThreshold: 0.85,
    
    // Scoring
    scoringDetail: 'basic', // 'basic' | 'detailed'
    
    // Review
    reviewQueueBuild: false, // Skip review queue
  },
  
  BALANCED: {
    id: 'balanced',
    name: 'Balanced (Khuyên dùng)',
    description: 'Segmentation nén + deep incident + coherence vừa',
    
    // Segmentation
    segmentationContext: 'compressed',
    maxSegmentationWords: 200000,
    
    // Boundary refine
    boundaryRefine: true,
    overlapThreshold: 0.3,
    
    // Deep analysis
    deepAnalysisConcurrency: 3,
    perIncidentMaxWords: 100000,
    
    // Coherence
    coherencePass: 'light',
    autoMergeThreshold: 0.82,
    
    // Scoring
    scoringDetail: 'detailed',
    
    // Review
    reviewQueueBuild: true,
  },
  
  DEEP: {
    id: 'deep',
    name: 'Deep',
    description: 'Segmentation đầy đủ + coherence kỹ + review nghiêm ngặt',
    
    // Segmentation
    segmentationContext: 'full', // Try 1M context if available
    maxSegmentationWords: 500000,
    
    // Boundary refine
    boundaryRefine: true,
    overlapThreshold: 0.4,
    bm25Refinement: true,
    
    // Deep analysis
    deepAnalysisConcurrency: 2, // Slower but more thorough
    perIncidentMaxWords: 150000,
    multiplePasses: true, // Run analysis twice with different prompts
    
    // Coherence
    coherencePass: 'full',
    autoMergeThreshold: 0.82,
    suggestMergeThreshold: 0.70,
    
    // Scoring
    scoringDetail: 'full',
    
    // Review
    reviewQueueBuild: true,
    strictThreshold: true, // Higher standards for auto-accept
  },
};
```

---

## 7. Main Pipeline Orchestrator

### 7.1 Incident Analyzer Entry Point

```javascript
// src/services/analysis/pipeline/incidentAnalyzer.js

/**
 * IncidentAnalyzer - Main entry point cho Incident-First Pipeline
 * 
 * Sử dụng:
 * ```javascript
 * const result = await IncidentAnalyzer.run(corpusId, {
 *   mode: 'balanced',
 *   model: 'gemini-3.1-pro',
 * });
 * ```
 */

import { globalSegmentation } from './globalSegmentation.js';
import { refineBoundaries } from './boundaryRefine.js';
import { analyzeIncidents } from './deepIncidentAnalysis.js';
import { coherencePass } from './coherencePass.js';
import { scoreItems } from './scoringEngine.js';
import { buildReviewQueue } from './reviewQueueBuilder.js';
import { checkConsistency } from '../consistency/consistencyChecker.js';
import { runConsistencyJobs } from '../consistency/timelineValidator.js';
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
    
    this.progress = {
      phase: 'idle',
      progress: 0,
      message: '',
    };
    
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
        
        // Run consistency validation jobs
        await runConsistencyJobs(this.consistencyRisks, this.options);
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
        partialResults: {
          incidents: this.incidents,
          events: this.events,
        },
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
    // Save incidents
    for (const incident of this.incidents) {
      await db.incidents.upsert(incident);
    }
    
    // Save events
    for (const event of this.events) {
      await db.analysisEvents.upsert(event);
    }
    
    // Save locations
    for (const location of this.locations) {
      await db.locations.upsert(location);
    }
    
    // Save consistency risks
    for (const risk of this.consistencyRisks) {
      await db.consistencyRisks.upsert(risk);
    }
    
    // Save review queue
    for (const item of this.reviewQueue) {
      await db.reviewQueue.upsert(item);
    }
  }
}

// Convenience function
export async function runIncidentAnalysis(corpusId, options = {}) {
  const analyzer = new IncidentAnalyzer(corpusId, options);
  return analyzer.run();
}
```

---

## 8. Frontend Changes

### 8.1 AnalysisViewer - Incident-First Mode

```jsx
// src/pages/Lab/CorpusLab/AnalysisViewer.jsx (modifications)

export function AnalysisViewer({ corpusId }) {
  const [view, setView] = useState('incidents'); // Default changed to 'incidents'
  const [reviewFilter, setReviewFilter] = useState('all'); // 'all' | 'needs_review' | 'P0' | 'P1' | 'P2'
  
  // ... existing code ...
  
  // New: Get review queue stats
  const reviewStats = useMemo(() => {
    if (!analysis?.reviewQueue) return null;
    return {
      total: analysis.reviewQueue.length,
      P0: analysis.reviewQueue.filter(i => i.priority === 'P0').length,
      P1: analysis.reviewQueue.filter(i => i.priority === 'P1').length,
      P2: analysis.reviewQueue.filter(i => i.priority === 'P2').length,
      incidents: analysis.reviewQueue.filter(i => i.itemType === 'incident').length,
      events: analysis.reviewQueue.filter(i => i.itemType === 'event').length,
    };
  }, [analysis]);
  
  return (
    <div className="analysis-viewer">
      {/* Header */}
      <header>
        <h2>{corpus.title} - Incident-First Analysis</h2>
        
        {/* Mode indicator */}
        <span className="mode-badge">{analysis.mode || 'balanced'}</span>
        
        {/* Review queue stats */}
        {reviewStats && (
          <div className="review-stats">
            <span className="stat P0">⚠️ P0: {reviewStats.P0}</span>
            <span className="stat P1">📋 P1: {reviewStats.P1}</span>
            <span className="stat P2">📝 P2: {reviewStats.P2}</span>
            <span className="stat total">Tổng: {reviewStats.total}</span>
          </div>
        )}
      </header>
      
      {/* View Toggle - Incident-first default */}
      <ViewToggle 
        view={view} 
        onChange={setView}
        options={[
          { id: 'incidents', label: '📍 Incidents', icon: '📍' },
          { id: 'events', label: '📖 Events', icon: '📖' },
          { id: 'review', label: '🔍 Review Queue', icon: '🔍' },
          { id: 'timeline', label: '📅 Timeline', icon: '📅' },
          { id: 'mindmap', label: '🗺️ Mind Map', icon: '🗺️' },
          { id: 'locations', label: '🏰 Locations', icon: '🏰' },
        ]}
      />
      
      {/* Main content */}
      <main>
        {view === 'incidents' && (
          <IncidentListView
            incidents={analysis.incidents}
            events={analysis.events}
            onIncidentClick={handleIncidentClick}
            onReviewIncident={handleReviewIncident}
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
        
        {/* ... other views ... */}
      </main>
      
      {/* Incident Detail Panel */}
      {selectedIncident && (
        <IncidentDetailPanel
          incident={selectedIncident}
          events={events.filter(e => e.incidentId === selectedIncident.id)}
          locations={locations.filter(l => 
            selectedIncident.relatedLocations.includes(l.id)
          )}
          onClose={() => setSelectedIncident(null)}
          onEdit={handleEditIncident}
        />
      )}
    </div>
  );
}
```

### 8.2 IncidentListView Component

```jsx
// src/pages/Lab/CorpusLab/components/IncidentListView.jsx

export function IncidentListView({ incidents, events, onIncidentClick }) {
  const [sortBy, setSortBy] = useState('chapter'); // 'chapter' | 'confidence' | 'severity'
  const [filterType, setFilterType] = useState('all'); // 'all' | 'major_plot_point' | 'subplot' | 'pov_thread'
  const [expandedIncidents, setExpandedIncidents] = useState(new Set());
  
  // Sort and filter
  const displayIncidents = useMemo(() => {
    let filtered = incidents;
    
    if (filterType !== 'all') {
      filtered = filtered.filter(i => i.type === filterType);
    }
    
    return filtered.sort((a, b) => {
      switch (sortBy) {
        case 'chapter':
          return a.startChapter - b.startChapter;
        case 'confidence':
          return b.confidence - a.confidence;
        case 'severity':
          return (b.majorScore || 0) - (a.majorScore || 0);
        default:
          return 0;
      }
    });
  }, [incidents, sortBy, filterType]);
  
  return (
    <div className="incident-list-view">
      {/* Filters */}
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
      
      {/* Incident cards */}
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

function IncidentCard({ incident, events, expanded, onToggle, onClick }) {
  const typeColors = {
    major_plot_point: '#FFD700', // Gold
    subplot: '#4169E1',         // Royal Blue
    pov_thread: '#9932CC',       // Purple
  };
  
  const typeIcons = {
    major_plot_point: '⭐',
    subplot: '📖',
    pov_thread: '👁️',
  };
  
  return (
    <div 
      className={`incident-card ${incident.reviewStatus === 'needs_review' ? 'needs-review' : ''}`}
      style={{ borderLeftColor: typeColors[incident.type] }}
    >
      {/* Header */}
      <div className="card-header" onClick={onClick}>
        <span className="type-icon">{typeIcons[incident.type]}</span>
        <span className="title">{incident.title}</span>
        
        <div className="meta">
          <span className="chapters">
            Ch.{incident.startChapter + 1} - {incident.endChapter + 1}
          </span>
          <span className={`confidence ${incident.confidence >= 0.85 ? 'high' : 'low'}`}>
            {Math.round(incident.confidence * 100)}%
          </span>
          <span className="events-count">
            {events.length} events
          </span>
        </div>
      </div>
      
      {/* Expand toggle */}
      <button className="expand-btn" onClick={onToggle}>
        {expanded ? '▼' : '▶'}
      </button>
      
      {/* Expanded content */}
      {expanded && (
        <div className="card-content">
          <p className="description">{incident.description}</p>
          
          {/* Events */}
          <div className="events-section">
            <h4>Events ({events.length})</h4>
            <div className="events-mini-list">
              {events.slice(0, 5).map(event => (
                <div key={event.id} className="event-mini">
                  <span className="event-title">{event.title}</span>
                  <span className="event-chapter">Ch.{event.chapterIndex + 1}</span>
                </div>
              ))}
              {events.length > 5 && (
                <span className="more-events">+{events.length - 5} more</span>
              )}
            </div>
          </div>
          
          {/* Boundary note */}
          {incident.boundaryNote && (
            <div className="boundary-note">
              <strong>Boundary:</strong> {incident.boundaryNote}
            </div>
          )}
          
          {/* Evidence */}
          {incident.evidence && incident.evidence.length > 0 && (
            <div className="evidence">
              <strong>Evidence:</strong>
              <ul>
                {incident.evidence.slice(0, 3).map((e, i) => (
                  <li key={i}>"{e.substring(0, 100)}..."</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
      
      {/* Review badge */}
      {incident.reviewStatus === 'needs_review' && (
        <span className="review-badge">Cần duyệt</span>
      )}
    </div>
  );
}
```

### 8.3 ReviewQueueView Component

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
      {/* Filters */}
      <div className="filters">
        <button 
          className={filter === 'all' ? 'active' : ''}
          onClick={() => onFilterChange('all')}
        >
          Tất cả ({items.length})
        </button>
        <button 
          className={filter === 'needs_review' ? 'active' : ''}
          onClick={() => onFilterChange('needs_review')}
        >
          Cần duyệt
        </button>
        <button 
          className={`priority P0 ${filter === 'P0' ? 'active' : ''}`}
          onClick={() => onFilterChange('P0')}
        >
          ⚠️ P0 ({items.filter(i => i.priority === 'P0').length})
        </button>
        <button 
          className={`priority P1 ${filter === 'P1' ? 'active' : ''}`}
          onClick={() => onFilterChange('P1')}
        >
          📋 P1 ({items.filter(i => i.priority === 'P1').length})
        </button>
        <button 
          className={`priority P2 ${filter === 'P2' ? 'active' : ''}`}
          onClick={() => onFilterChange('P2')}
        >
          📝 P2 ({items.filter(i => i.priority === 'P2').length})
        </button>
      </div>
      
      {/* Queue items */}
      <div className="queue-list">
        {filteredItems.map((item, index) => (
          <ReviewQueueCard
            key={item.id}
            item={item}
            rank={index + 1}
            onResolve={onResolve}
          />
        ))}
      </div>
    </div>
  );
}

function ReviewQueueCard({ item, rank, onResolve }) {
  const priorityColors = {
    P0: '#FF4444',
    P1: '#FFA500',
    P2: '#44AA44',
  };
  
  return (
    <div 
      className="review-card"
      style={{ borderLeftColor: priorityColors[item.priority] }}
    >
      {/* Rank and Priority */}
      <div className="card-header">
        <span className="rank">#{rank}</span>
        <span 
          className={`priority-badge ${item.priority}`}
          style={{ backgroundColor: priorityColors[item.priority] }}
        >
          {item.priority}
        </span>
        <span className="item-type">{item.itemType}</span>
      </div>
      
      {/* Score breakdown */}
      <div className="score-breakdown">
        <div className="score-bar">
          <div 
            className="score-fill"
            style={{ 
              width: `${item.priorityScore * 100}%`,
              backgroundColor: priorityColors[item.priority],
            }}
          />
        </div>
        <span className="score-value">{Math.round(item.priorityScore * 100)}%</span>
      </div>
      
      {/* Score components */}
      <div className="score-components">
        {item.scoreBreakdown && (
          <>
            <span title="Impact">📊 {Math.round(item.scoreBreakdown.impact * 100)}%</span>
            <span title="Confidence deficit">📉 {Math.round(item.scoreBreakdown.confidenceDeficit * 100)}%</span>
            <span title="Consistency risk">⚠️ {Math.round(item.scoreBreakdown.consistencyRisk * 100)}%</span>
            <span title="Boundary ambiguity">❓ {Math.round(item.scoreBreakdown.boundaryAmbiguity * 100)}%</span>
          </>
        )}
      </div>
      
      {/* Reasons */}
      <div className="reasons">
        {item.reason.map((r, i) => (
          <span key={i} className="reason-tag">{r}</span>
        ))}
      </div>
      
      {/* Suggestions */}
      {item.suggestions && item.suggestions.length > 0 && (
        <div className="suggestions">
          <strong>Gợi ý:</strong>
          <ul>
            {item.suggestions.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </div>
      )}
      
      {/* Actions */}
      <div className="actions">
        <button className="btn-accept" onClick={() => onResolve(item, 'accept')}>
          ✓ Accept
        </button>
        <button className="btn-edit" onClick={() => onResolve(item, 'edit')}>
          ✏️ Edit
        </button>
        <button className="btn-ignore" onClick={() => onResolve(item, 'ignore')}>
          🚫 Ignore
        </button>
      </div>
    </div>
  );
}
```

---

## 9. API Endpoints

### 9.1 Incident Analysis API

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
  incidents: [
    {
      id: "incident-uuid",
      title: "Cuộc chiến Hogwarts",
      type: "major_plot_point",
      chapterStart: 34,
      chapterEnd: 38,
      confidence: 0.92,
      containedEvents: [...],
      reviewStatus: "auto_accepted",
    }
  ],
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

## 10. Implementation Phases

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

## 11. Migration Strategy

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

## 12. Testing Checklist

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
