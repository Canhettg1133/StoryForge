# PHASE 6A: Hybrid Incident-First - Design & Models

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

### 3.2 events Table (Mở rộng)

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

## 4. Three Run Modes

### 4.1 Mode Configuration

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

### 4.2 Mode Selection Guidelines

| Mode | Khi nào dùng | Speed | Quality |
|------|---------------|-------|---------|
| **Fast** | Test/prototype, file nhỏ < 50k words | ⭐⭐⭐⭐⭐ | ⭐ |
| **Balanced** | Mặc định, production use | ⭐⭐⭐ | ⭐⭐⭐ |
| **Deep** | Phân tích quan trọng, file lớn > 200k words | ⭐ | ⭐⭐⭐⭐⭐ |

### 4.3 Confidence Thresholds by Mode

```javascript
// Mode-specific thresholds for auto-accept

const THRESHOLDS = {
  fast: {
    incident: 0.90,  // Rất cao để bù cho quality thấp hơn
    event: 0.85,
    location: 0.90,
  },
  balanced: {
    incident: 0.85,
    event: 0.75,
    location: 0.80,
  },
  deep: {
    incident: 0.80,   // Thấp hơn vì sẽ có review kỹ
    event: 0.70,
    location: 0.75,
  },
};
```

---

## 5. Confidence & Scoring Rules

### 5.1 Auto-Accept Rules

```javascript
// Quy tắc tự động accept

const AUTO_ACCEPT_RULES = {
  incident: {
    minConfidence: 0.85,
    requiresEvidence: true,
    requiresValidBoundary: true,
  },
  event: {
    minConfidence: 0.75,
    requiresChapter: true,    // Phải có chapter index hợp lệ
    requiresChunk: false,
  },
  location: {
    minConfidence: 0.80,
    requiresEvidence: true,
    requiresName: true,
  },
};

// Luôn cần review nếu:
function needsReview(item) {
  if (!item.evidence || item.evidence.length === 0) return true;
  if (item.confidence < AUTO_ACCEPT_RULES[item.type].minConfidence) return true;
  if (item.uncertainStart || item.uncertainEnd) return true;
  return false;
}
```

### 5.2 ConsistencyRisk Penalty Matrix

| Conflict Type | Severity | Penalty | Force P0 | Ví dụ |
|---------------|----------|---------|----------|--------|
| Timeline inversion | HARD | +0.40 | ✅ | Event A gây B nhưng B xảy ra trước |
| State contradiction | HARD | +0.40 | ✅ | "Chết" rồi lại "sống" trong 5 chương |
| Impossible co-location | HARD | +0.40 | ✅ | Ở London và Tokyo cùng lúc |
| Missing prerequisite | MEDIUM | +0.25 | ❌ | Cần item A nhưng A không tồn tại |
| Duplicate anchors conflict | MEDIUM | +0.25 | ❌ | 2 incident cùng climax nhưng outcome khác |
| POV continuity break | MEDIUM | +0.25 | ❌ | POV Tyrion → POV Daenerys không có bridge |
| Entity collision | SOFT | +0.15 | ❌ | "Voldemort" và "Lorden Mold" cùng người? |
| Span anomaly | SOFT | +0.15 | ❌ | Incident 50 chương nhưng chỉ 2 events |
| Evidence mismatch | SOFT | +0.15 | ❌ | Confidence 90% nhưng evidence rất yếu |

### 5.3 Priority Score Formula

```javascript
/**
 * Priority Score = 0.30*impact + 0.25*(1-confidence) + 0.20*consistencyRisk 
 *                + 0.15*boundaryAmbiguity + 0.10*missingEvidence
 */

function calculatePriorityScore(item, consistencyRisks) {
  // Get relevant consistency risks
  const relevantRisks = getRelevantRisks(item, consistencyRisks);
  const consistencyRisk = relevantRisks.reduce((sum, r) => 
    sum + CONFLICT_SEVERITY[r.severity].penalty, 0
  );
  
  // Boundary ambiguity
  const boundaryAmbiguity = (item.uncertainStart ? 0.5 : 0) + 
                           (item.uncertainEnd ? 0.5 : 0);
  
  // Missing evidence
  const missingEvidence = item.evidence && item.evidence.length > 0 ? 0 : 1;
  
  // Impact (normalized)
  const impact = (item.majorScore || item.impactScore || 5) / 10;
  
  // Calculate
  const score = 
    0.30 * impact +
    0.25 * (1 - (item.confidence || 0)) +
    0.20 * Math.min(1, consistencyRisk) +
    0.15 * Math.min(1, boundaryAmbiguity / 2) +
    0.10 * missingEvidence;
  
  return Math.round(score * 100) / 100;
}

// Priority assignment
function assignPriority(score, hasHardConflict) {
  if (score >= 0.75 || hasHardConflict) return 'P0';
  if (score >= 0.50) return 'P1';
  return 'P2';
}
```

---

## 6. Merge/Split Rules

### 6.1 Merge Rules

```javascript
// Khi nào nên merge incidents?

const MERGE_THRESHOLDS = {
  auto: 0.82,      // Tự động merge
  suggest: 0.70,   // Gợi ý merge (user quyết định)
  no: 0.70,        // Không merge
};

// Hard no-merge conditions:
// 1. Conflict timeline (2 incident chồng lấn nhưng không causal link)
// 2. Khác POV lane và không có bridge
// 3. Outcome mâu thuẫn (cùng climax anchor nhưng kết quả khác)

function shouldMerge(inc1, inc2, causalBridges) {
  const score = calculateMergeScore(inc1, inc2, causalBridges);
  
  // Hard no-merge check
  if (hasHardNoMergeConditions(inc1, inc2)) {
    return { decision: 'hard_no', reason: 'Conflict timeline/POV lane' };
  }
  
  if (score >= MERGE_THRESHOLDS.auto) {
    return { decision: 'auto_merge', score };
  }
  
  if (score >= MERGE_THRESHOLDS.suggest) {
    return { decision: 'suggest_merge', score };
  }
  
  return { decision: 'no_merge', score };
}

// Merge score factors
function calculateMergeScore(inc1, inc2, causalBridges) {
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
  
  // Factor 5: Causal bridge (10%)
  const hasBridge = causalBridges.some(b => 
    (b.from === inc1.id && b.to === inc2.id) ||
    (b.from === inc2.id && b.to === inc1.id)
  );
  if (hasBridge) score += 0.10;
  factors++;
  
  return score / factors;
}
```

### 6.2 Split Rules

```javascript
// Khi nào nên split incident?

// Split khi:
// 1. Incident chứa 2+ cụm event không liên thông về nhân-quả
// 2. Có clear break point trong narrative
// 3. Các event clusters thuộc về different plot lines

function findSplitPoints(incident, events) {
  const incidentEvents = events.filter(e => e.incidentId === incident.id);
  
  // Build causal graph
  const causalGraph = buildCausalGraph(incidentEvents);
  
  // Find connected components
  const components = findConnectedComponents(causalGraph);
  
  if (components.length > 1) {
    // Found clusters that are not causally connected
    return {
      shouldSplit: true,
      clusters: components,
      splitScore: 1 - (1 / components.length),
    };
  }
  
  return { shouldSplit: false };
}

// Split score
function calculateSplitScore(incident, events) {
  const clusters = findEventClusters(events);
  
  // High density but spanning many chapters = anomaly
  const density = events.length / incident.activeSpan;
  
  if (density < 0.5 && incident.activeSpan > 10) {
    // Low density over long span = might need split
    return {
      shouldSplit: 'suggest',
      score: 1 - density,
      reason: 'Low event density over long span',
    };
  }
  
  return { shouldSplit: false };
}
```

---

## 7. Quick Reference Card

### 7.1 Incident Definition

```
INCIDENT = đơn vị kể chuyện CẤP CAO
├── major_plot_point: Điểm nút cốt truyện chính
├── subplot: Câu chuyện phụ
└── pov_thread: POV lane riêng (GoT style)

Event có thể thuộc nhiều incident:
├── PRIMARY: thuộc incident này là chính
└── SECONDARY: thuộc incident này là phụ
```

### 7.2 Confidence Thresholds

```
Incident auto-accept: >= 0.85 + evidence
Event auto-accept: >= 0.75 + chapter hợp lệ
Location auto-accept: >= 0.80 + evidence
⚠️ Thiếu evidence → LUÔN cần review
```

### 7.3 Priority Assignment

```
P0: score >= 0.75 HOẶC có hard conflict
P1: 0.50 <= score < 0.75
P2: score < 0.50
```

### 7.4 10 Consistency Risks

```
HARD (+0.40, force P0):
├─ Timeline inversion
├─ State contradiction  
└─ Impossible co-location

MEDIUM (+0.25):
├─ Missing prerequisite
├─ Duplicate anchors conflict
└─ POV continuity break

SOFT (+0.15):
├─ Entity collision
├─ Span anomaly
└─ Evidence mismatch
```
