# PHASE 3: Analysis Engine - AI Extract Insights

## Mục tiêu

Trích xuất FULL insights từ truyện đã upload trong Phase 2 bằng AI.
Sử dụng **1M context** của Gemini 3 Pro để phân tích trực tiếp thay vì hierarchical.

---

## Key Innovation: Context-Based Analysis

### Tại sao không dùng Hierarchical nữa?

| Approach | Vấn đề |
|----------|---------|
| Hierarchical | Mỗi level đều có thể MẤT context khi ghép lại |
| Hierarchical | Output bị cắt ở mỗi level (65k limit) |
| Hierarchical | Nhiều API calls hơn |

### Giải pháp: Context-Based với Session

```
Tận dụng 1M context của Gemini 3 Pro
Input: 750k words (~1M tokens)
Output: 65k tokens → Chunk thành nhiều parts

Chunk 1 (500k words)
    ↓
Gemini 3 Pro (1M context)
    ↓
Output Part 1 (65k tokens) → Lưu
    ↓
"Continue" → Session giữ nguyên
    ↓
Output Part 2 (65k tokens) → Lưu
    ↓
"Continue" → Session giữ nguyên
    ↓
Output Part 3 (65k tokens) → Lưu
    ↓
Ghép: Part 1 + 2 + 3 = Full analysis
```

---

## 1. File Structure

```
src/
├── pages/
│   └── Lab/
│       └── CorpusLab/
│           ├── components/
│           │   ├── AnalysisPanel.jsx     # Panel chạy analysis
│           │   ├── AnalysisConfig.jsx    # Cấu hình: model, chunk size
│           │   ├── AnalysisProgress.jsx  # Progress bar + status
│           │   └── ResultsPreview.jsx   # Xem trước kết quả
│           └── hooks/
│               └── useCorpusAnalysis.js  # Analysis logic
│
├── services/
│   ├── analysis/
│   │   ├── index.js                     # Entry point
│   │   ├── sessionAnalyzer.js           # Context-based với session
│   │   ├── structuralAnalyzer.js        # L1: Rule-based
│   │   ├── deepAnalyzer.js             # L2-L6: AI-powered
│   │   ├── outputChunker.js            # Chunk 65k output
│   │   └── prompts/
│   │       ├── analysisPrompts.js      # All analysis prompts
│   │       └── templates.js            # Output templates
│   │
│   └── ai/
│       ├── sessionClient.js            # AI client với session support
│       └── analysisConfig.js           # Model configs
│
└── stores/
    └── analysisStore.js               # Zustand store cho analysis
```

---

## 2. AI Configuration

### 2.1 Integration với Existing System

```javascript
// Import từ hệ thống có sẵn
import modelRouter, { PROVIDERS } from '../ai/router.js';
import keyManager from '../ai/keyManager.js';
```

### 2.2 Context-Based Model Selection

**QUAN TRỌNG:** Gemini output max = 65k tokens, không phụ thuộc input context!

| Model | Input Context | Output Max | Chi phí |
|-------|--------------|------------|---------|
| Gemini 2.5 Flash | 32k tokens (~25k words) | 8k tokens | Rẻ |
| Gemini 3.1 Flash | 64k tokens (~50k words) | 65k tokens | Trung bình |
| **Gemini 3 Pro** | **1M tokens (~750k words)** | **65k tokens** | Đắt |

```javascript
// src/services/analysis/analysisConfig.js
export const ANALYSIS_CONFIG = {
    provider: PROVIDERS.GEMINI_PROXY,
    
    models: {
        // Context-based: Dùng 1M context nhưng output vẫn 65k
        context_pro: 'gemini-3.1-pro-high-真流-[星星公益站-CLI渠道]',
        
        // Fallback: 64k context
        context_flash: 'gemini-3.1-pro-low-真流-[星星公益站-CLI渠道]',
        
        // Quick: 32k context (cho test hoặc file nhỏ)
        quick: 'gemini-2.5-flash-真流-[星星公益站-CLI渠道]',
    },
    
    // Session settings
    session: {
        maxOutputPerChunk: 65536,  // 65k tokens max output
        estimatedWordsPerOutput: 45000,  // ~65k tokens × 0.7
        continuePrompt: 'Tiếp tục phân tích từ đoạn trước. Gửi tiếp phần tiếp theo của JSON output.',
        partsPerChunk: 3,  // 3 × 65k = ~195k tokens output cho mỗi input chunk
    },
    
    // Processing
    maxConcurrent: 6,           // Tối đa 6 chunks song song
    temperature: 0.2,          // Thấp để consistency cao
    maxOutputTokens: 65536,    // MAX - không thể vượt quá
};
```

---

## 3. Context-Based Session Analyzer

### 3.1 Core Concept

**Vấn đề:** Gemini output max = 65k tokens, không phụ thuộc input context!
**Giải pháp:** Chunk output như chunk input, dùng "continue" để lấy phần tiếp theo

```
┌─────────────────────────────────────────────────────────────────┐
│  Context-Based Analysis với Session                              │
│                                                                 │
│  Input: 500k words (≈ 750k tokens)                             │
│  Model: Gemini 3.1 Pro High (1M context)                       │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ Session Start                                            │   │
│  │ Prompt: Phân tích đoạn text sau, trả JSON              │   │
│  │ Text: [500k words]                                      │   │
│  └─────────────────────────────────────────────────────────┘   │
│                         ↓                                      │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ Output Part 1: 65k tokens                               │   │
│  │ { "characters": [...], "part": 1, "hasMore": true }     │   │
│  └─────────────────────────────────────────────────────────┘   │
│                         ↓                                      │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ Continue: "Tiếp tục phần tiếp theo"                    │   │
│  │ Session giữ nguyên context (1M)                        │   │
│  └─────────────────────────────────────────────────────────┘   │
│                         ↓                                      │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ Output Part 2: 65k tokens                               │   │
│  │ { "part": 2, "events": [...], "hasMore": true }       │   │
│  └─────────────────────────────────────────────────────────┘   │
│                         ↓                                      │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ Continue: "Tiếp tục phần tiếp theo"                    │   │
│  └─────────────────────────────────────────────────────────┘   │
│                         ↓                                      │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ Output Part 3: 65k tokens                               │   │
│  │ { "part": 3, "worldbuilding": [...], "complete": true }│   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  Ghép: Part 1 + 2 + 3 → Full JSON Analysis                    │
└─────────────────────────────────────────────────────────────────┘
```

### 3.2 Session Client Implementation

```javascript
// src/services/analysis/sessionClient.js

import { GoogleGenerativeAI } from '@google/generative-ai';

/**
 * Session-based AI client cho phân tích lớn
 * 
 * Key insight:
 * - Gemini 3.1 Pro có 1M context
 * - Output max vẫn là 65k tokens
 * - Dùng continue prompt để lấy output tiếp theo trong cùng session
 */

class SessionAnalyzer {
    constructor(apiKey, model = 'gemini-3.1-pro-high-真流-[星星公益站-CLI渠道]') {
        this.genAI = new GoogleGenerativeAI(apiKey);
        this.model = model;
        this.history = [];  // Conversation history for session
    }
    
    /**
     * Start a new analysis session với full text
     */
    async startSession(text, systemPrompt) {
        const genModel = this.genAI.getGenerativeModel({
            model: this.model,
            systemInstruction: systemPrompt,
        });
        
        this.history = [
            { role: 'user', parts: [{ text }] }
        ];
        
        const result = await genModel.generateContent({
            contents: this.history,
            generationConfig: {
                maxOutputTokens: 65536,  // MAX
                temperature: 0.2,
                topP: 0.95,
                topK: 40,
            },
            safetySettings: [
                { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
                { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
                { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
                { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
            ],
        });
        
        const response = result.response;
        
        this.history.push({
            role: 'model',
            parts: [{ text: response.text() }]
        });
        
        return {
            text: response.text(),
            finishReason: response.finishReason(),
            usageMetadata: response.usageMetadata,
        };
    }
    
    /**
     * Continue session để lấy output tiếp theo
     */
    async continueSession(continuePrompt = null) {
        if (this.history.length === 0) {
            throw new Error('No active session. Call startSession first.');
        }
        
        const genModel = this.genAI.getGenerativeModel({
            model: this.model,
        });
        
        const prompt = continuePrompt || 'Tiếp tục phân tích từ đoạn trước. Gửi tiếp phần tiếp theo của JSON output.';
        
        this.history.push({
            role: 'user',
            parts: [{ text: prompt }]
        });
        
        const result = await genModel.generateContent({
            contents: this.history,
            generationConfig: {
                maxOutputTokens: 65536,
                temperature: 0.2,
                topP: 0.95,
            },
        });
        
        const response = result.response;
        
        this.history.push({
            role: 'model',
            parts: [{ text: response.text() }]
        });
        
        return {
            text: response.text(),
            finishReason: response.finishReason(),
            usageMetadata: response.usageMetadata,
        };
    }
    
    /**
     * End session và clear history
     */
    endSession() {
        this.history = [];
    }
}

/**
 * Analyze với automatic continuation
 * Output > 65k → Tự động continue cho đến khi xong
 */
async function analyzeWithSession(text, systemPrompt, options = {}) {
    const {
        apiKey,
        model = ANALYSIS_CONFIG.models.context_pro,
        maxParts = 5,
        onProgress = () => {},
    } = options;
    
    const client = new SessionAnalyzer(apiKey, model);
    const parts = [];
    
    try {
        // Start session
        onProgress({ part: 1, status: 'starting' });
        let result = await client.startSession(text, systemPrompt);
        parts.push(result.text);
        
        // Check if more content expected
        let hasMore = checkHasMore(result.text);
        
        let partNum = 2;
        while (hasMore && partNum <= maxParts) {
            onProgress({ part: partNum, status: 'continuing' });
            result = await client.continueSession();
            parts.push(result.text);
            
            hasMore = checkHasMore(result.text);
            partNum++;
        }
        
        // Merge all parts into single JSON
        const merged = mergeParts(parts);
        
        return {
            success: true,
            parts: parts.length,
            data: merged,
            tokenUsage: result.usageMetadata,
        };
        
    } finally {
        client.endSession();
    }
}

/**
 * Check if response indicates more content to come
 */
function checkHasMore(text) {
    try {
        const json = JSON.parse(text);
        if (json.complete === true || json.hasMore === false || json.done === true) {
            return false;
        }
        if (json.hasMore === true || json.continue === true) {
            return true;
        }
    } catch {
        const lower = text.toLowerCase();
        if (lower.includes('"complete": true') || 
            lower.includes('"hasMore": false') ||
            lower.includes('***end***') ||
            lower.includes('[END]')) {
            return false;
        }
    }
    return text.length > 50000;
}

/**
 * Merge multiple parts into single JSON object
 */
function mergeParts(parts) {
    const objects = parts.map(part => {
        try {
            return JSON.parse(part);
        } catch {
            return extractJSON(part);
        }
    }).filter(Boolean);
    
    return deepMerge(objects);
}

function deepMerge(objects) {
    const result = {};
    for (const obj of objects) {
        for (const key in obj) {
            if (Array.isArray(result[key]) && Array.isArray(obj[key])) {
                result[key] = [...result[key], ...obj[key]];
            } else if (typeof result[key] === 'object' && typeof obj[key] === 'object') {
                result[key] = deepMerge([result[key], obj[key]]);
            } else {
                result[key] = obj[key];
            }
        }
    }
    return result;
}
```

### 3.3 Context Size Calculator

```javascript
// src/services/analysis/chunkCalculator.js

/**
 * Tính toán chunk size dựa trên context limit
 * 
 * Gemini 3.1 Pro High: 1M tokens context
 * - Input text: ~750k words
 * - System prompt: ~2k tokens
 * - Output buffer: ~48k tokens
 * 
 * Thực tế nên dùng: 500k words input để có buffer cho output
 */

export const CONTEXT_CALCULATOR = {
    tokensPerWord: 1.5,  // Rough estimate for Vietnamese/English mix
    
    models: {
        'gemini-3.1-pro-high': {
            contextLimit: 1000000,
            inputBuffer: 100000,
            effectiveInput: 900000,
        },
        'gemini-3.1-pro-low': {
            contextLimit: 64000,
            inputBuffer: 5000,
            effectiveInput: 59000,
        },
        'gemini-2.5-flash': {
            contextLimit: 32000,
            inputBuffer: 2000,
            effectiveInput: 30000,
        },
    },
    
    getOptimalChunkSize(modelId) {
        const model = this.models[modelId] || this.models['gemini-2.5-flash'];
        const words = Math.floor(model.effectiveInput / this.tokensPerWord);
        return { words, tokens: model.effectiveInput };
    },
    
    estimateChunks(fileWordCount, modelId) {
        const optimal = this.getOptimalChunkSize(modelId);
        return Math.ceil(fileWordCount / optimal.words);
    },
    
    estimateTime(chunkCount, partsPerChunk = 3) {
        const totalOutputs = chunkCount * partsPerChunk;
        const secondsPerOutput = 10;
        const totalSeconds = totalOutputs * secondsPerOutput;
        
        if (totalSeconds < 60) return `${totalSeconds} seconds`;
        if (totalSeconds < 3600) return `${Math.ceil(totalSeconds / 60)} minutes`;
        return `${Math.ceil(totalSeconds / 3600)} hours`;
    },
};
```

### 3.4 Performance Comparison

| File Size | Words | Chunks | Hierarchical Time | Context-Based Time | Speedup |
|-----------|-------|--------|-------------------|-------------------|---------|
| 100k | 100,000 | 1 | ~5 min | ~30s | 10x |
| 500k | 500,000 | 1 | ~15 min | ~30s | 30x |
| 1M | 1,000,000 | 2 | ~30 min | ~1 min | 30x |
| 5M | 5,000,000 | 10 | ~2.5 hours | ~5 min | 30x |
| 10M | 10,000,000 | 20 | ~5 hours | ~10 min | 30x |

**→ Context-based Nhanh hơn 30 lần!**

---

## 4. Analysis Layers (Single Comprehensive Prompt)

### 4.1 Why Combined Prompt?

Với Context-based approach, ta gửi 500k words vào 1 session.
→ Dùng **1 prompt tổng hợp** cho tất cả layers thay vì nhiều passes.

```
Input: 500k words
       ↓
┌─────────────────────────────────────────────────────────┐
│  Session với System Prompt tổng hợp:                  │
│  "Phân tích đoạn text, trả JSON bao gồm:           │
│   - L1: characters, ships, tropes, metadata           │
│   - L2: events (canon/fanon, rarity)                │
│   - L3: worldbuilding (setting, powers)              │
│   - L4: characters (personality, motivation, arc)     │
│   - L5: relationships (ships, plot holes)           │
│   - L6: craft (style, emotional, pacing)"          │
└─────────────────────────────────────────────────────────┘
       ↓
Output Part 1 (65k) → L1, L2, L3
       ↓
Continue → Output Part 2 (65k) → L4, L5, L6
       ↓
Continue → Output Part 3 (65k) → Summary, Cross-references
       ↓
Merge Parts → Full JSON
```

### 4.2 Comprehensive System Prompt

```javascript
// src/services/analysis/prompts/comprehensivePrompt.js

export const COMPREHENSIVE_PROMPT = `
Bạn là chuyên gia phân tích truyện. Nhiệm vụ: PHÂN TÍCH TOÀN DIỆN đoạn text được cung cấp.

YÊU CẦU OUTPUT:
1. Trả JSON hợp lệ, không giải thích thêm
2. Nếu output dài, thêm "hasMore": true vào cuối JSON
3. Khi được yêu cầu tiếp tục, gửi tiếp phần còn lại với marker "hasMore": true/false
4. Đánh dấu RARE events/elements vì chúng có giá trị cao cho viết lách

FORMAT JSON OUTPUT:
{
  "meta": {
    "part": 1,
    "hasMore": true,
    "chunkStart": 0,
    "chunkEnd": 500000
  },
  
  // ========== L1: STRUCTURAL ==========
  "structural": {
    "characters": [
      {
        "name": "Tên nhân vật",
        "mentions": 523,
        "firstMention": "context...",
        "role": "main|supporting|minor"
      }
    ],
    "ships": [
      {
        "char1": "Char A",
        "char2": "Char B",
        "type": "romantic|slash|friendship|enemies",
        "mentions": 89,
        "development": "slow_build|fast_burn|instalove"
      }
    ],
    "tropes": [
      { "trope": "enemies_to_lovers", "instances": 3, "quality": "rare|good|common" },
      { "trope": "hurt_comfort", "instances": 5, "quality": "good" }
    ],
    "metadata": {
      "wordCount": 500000,
      "pov": "first|third|multiple",
      "tense": "past|present",
      "rating": "G|PG-13|T|M",
      "estimatedChapters": 50
    }
  },
  
  // ========== L2: EVENTS ==========
  "events": {
    "majorEvents": [
      {
        "id": "evt-1",
        "description": "Mô tả sự kiện",
        "severity": "crucial|major|moderate|minor",
        "chapter": "Ch.1-3",
        "canonOrFanon": {
          "type": "canon|fanon|both",
          "reasoning": "Giải thích tại sao"
        },
        "rarity": {
          "score": "rare|common_but_good|common",
          "reasoning": "Tại sao hiếm/hay/phổ biến"
        },
        "tags": ["angst", "hurt_comfort", "character_development"],
        "emotionalIntensity": 8,
        "insertability": 9  // Điểm cho thấy có thể dùng (1-10)
      }
    ],
    "minorEvents": [...],
    "plotTwists": [...],
    "cliffhangers": [...]
  },
  
  // ========== L3: WORLD-BUILDING ==========
  "worldbuilding": {
    "setting": {
      "primaryLocation": "Mô tả địa điểm chính",
      "locations": ["loc1", "loc2"],
      "culture": ["custom1", "custom2"],
      "politics": "Mô tả chính trị",
      "history": ["event1", "event2"]
    },
    "powers": {
      "abilities": ["ability1", "ability2"],
      "hierarchy": "Mô tả hệ thống cấp bậc",
      "limitations": ["limit1"],
      "canonPowers": ["cp1"],  // Từ nguyên tác
      "fanonPowers": ["fp1"],   // Tự tạo
      "originalAbilities": ["oa1"]  // Đặc biệt valuable!
    },
    "magicSystem": {
      "name": "Tên hệ thống",
      "rules": ["rule1"],
      "costs": ["cost1"],
      "isOriginal": true
    }
  },
  
  // ========== L4: CHARACTERS ==========
  "characters": {
    "char-1": {
      "name": "Tên",
      "personality": {
        "traits": ["trait1"],
        "voicePatterns": ["pattern1"],
        "behaviorUnderStress": "Mô tả"
      },
      "motivation": {
        "coreDesire": "Điều họ muốn",
        "deepestFear": "Nỗi sợ",
        "whatDrives": "Động lực chính",
        "whatHoldsBack": "Rào cản"
      },
      "arc": {
        "startState": "Trạng thái ban đầu",
        "endState": "Trạng thái cuối",
        "transformationMoments": ["m1", "m2"],
        "stages": [
          { "stage": "early", "description": "..." },
          { "stage": "mid", "description": "..." },
          { "stage": "late", "description": "..." }
        ]
      },
      "isOriginal": false,  // true nếu là nhân vật OC
      "insertability": 8
    }
  },
  
  // ========== L5: RELATIONSHIPS ==========
  "relationships": {
    "ships": [
      {
        "type": "enemies_to_lovers",
        "characters": ["A", "B"],
        "dynamic": "Mô tả dynamic",
        "intimacyProgression": {
          "early": "distant",
          "mid": "warming",
          "late": "intimate"
        },
        "conflictPatterns": ["pattern1"],
        "keyScenes": ["Ch.3", "Ch.7", "Ch.15"],
        "isRareDynamic": true  // Nếu dynamic hiếm, đánh dấu!
      }
    ],
    "plotHoles": [
      {
        "description": "Mô tả lỗ hổng",
        "chapter": "Ch.5",
        "suggestedFix": "Cách lấp"
      }
    ],
    "unresolvedThreads": ["thread1", "thread2"]
  },
  
  // ========== L6: CRAFT ==========
  "craft": {
    "style": {
      "sentenceLengthAvg": 15,
      "dialogueRatio": 0.3,
      "pov": "third",
      "tense": "past",
      "narrativeVoice": "Mô tả giọng văn",
      "voiceSamples": ["Sample 1", "Sample 2"]
    },
    "emotional": {
      "painfulMoments": [
        { "chapter": "Ch.3", "description": "...", "intensity": 8 }
      ],
      "happyMoments": [...],
      "emotionalPattern": "Pain → Win → Bigger Pain → Resolution",
      "isAngsty": true,
      "isFluffy": false
    },
    "pacing": {
      "arcStructure": {
        "setup": "Ch.1-3",
        "conflict": "Ch.4-10",
        "resolution": "Ch.11-15"
      },
      "chapterPacing": [
        { "chapter": "Ch.1", "pacing": "slow", "focus": "setup" }
      ],
      "isSlowBurn": true,
      "isPlotHeavy": false
    },
    "dialogueTechniques": {
      "conflictPatterns": ["pattern1"],
      "bondingPatterns": ["pattern1"],
      "revealTechniques": ["technique1"]
    }
  },
  
  // ========== SUMMARY (Part cuối) ==========
  "summary": {
    "rarityScore": 7.5,  // Điểm độ hiếm/tính unique tổng thể (1-10)
    "keyTakeaways": ["point1", "point2"],
    "mostInsertableEvents": ["evt-1", "evt-5"],  // Events dễ adapt nhất
    "mostInsertableCharacters": ["char-2"],        // Characters dễ adapt nhất
    "warnings": ["warning1"],
    "genre": "Fantasy|Romance|Angst|Action",
    "targetAudience": "Fic hay cho audience nào"
  }
}
`;
```

### 4.3 Prompt cho từng Part

```javascript
// System prompt cho Part 1 (L1, L2, L3)
const PROMPT_PART_1 = `
Phân tích đoạn text sau. Trả JSON bao gồm:
- L1: characters, ships, tropes, metadata
- L2: events (major, minor, twists, cliffhangers)
- L3: worldbuilding (setting, powers, magic system)

Đánh dấu RARE events/elements với "rarity": "rare".
`;

// Continue prompt cho Part 2 (L4, L5)
const PROMPT_PART_2 = `
Tiếp tục phân tích. Phần này bao gồm:
- L4: Character profiles (personality, motivation, arc)
- L5: Relationships (ships, plot holes, unresolved threads)

Đánh dấu INSERTABLE elements (dễ adapt vào truyện khác).
`;

// Continue prompt cho Part 3 (L6, Summary)
const PROMPT_PART_3 = `
Hoàn thành phân tích. Phần cuối bao gồm:
- L6: Craft patterns (style, emotional, pacing)
- Summary: Rarity score, key takeaways, most insertable elements

Thêm trường "complete": true vào cuối JSON.
`;
```

---

## 6. Database Schema

### 6.1 corpus_analyses Table

```sql
CREATE TABLE corpus_analyses (
    id TEXT PRIMARY KEY,
    corpus_id TEXT NOT NULL,
    
    -- Config used
    chunk_size INTEGER DEFAULT 750,
    chunk_overlap INTEGER DEFAULT 100,
    provider TEXT DEFAULT 'gemini_proxy',
    model TEXT,
    temperature REAL DEFAULT 0.2,
    
    -- Status
    status TEXT DEFAULT 'pending',  -- pending | processing | completed | failed
    
    -- Level status
    level_0_status TEXT DEFAULT 'pending',
    level_1_status TEXT DEFAULT 'pending',
    level_2_status TEXT DEFAULT 'pending',
    
    -- Results
    result_l1 TEXT,   -- JSON: structural analysis
    result_l2 TEXT,   -- JSON: events
    result_l3 TEXT,   -- JSON: worldbuilding
    result_l4 TEXT,   -- JSON: characters
    result_l5 TEXT,   -- JSON: relationships
    result_l6 TEXT,   -- JSON: craft
    final_result TEXT, -- JSON: combined
    
    -- Progress
    total_chunks INTEGER DEFAULT 0,
    processed_chunks INTEGER DEFAULT 0,
    
    -- Error
    error_message TEXT,
    
    -- Timestamps
    created_at INTEGER DEFAULT (strftime('%s', 'now')),
    started_at INTEGER,
    completed_at INTEGER,
    
    FOREIGN KEY (corpus_id) REFERENCES corpuses(id)
);

-- Index for fast lookups
CREATE INDEX idx_analyses_corpus ON corpus_analyses(corpus_id);
CREATE INDEX idx_analyses_status ON corpus_analyses(status);
```

### 6.2 chunk_results Table (Optional, Debug)

```sql
CREATE TABLE chunk_results (
    id TEXT PRIMARY KEY,
    analysis_id TEXT NOT NULL,
    chunk_index INTEGER NOT NULL,
    chapter_id TEXT,
    
    -- Timing
    processing_time_ms INTEGER,
    
    -- Tokens
    input_tokens INTEGER,
    output_tokens INTEGER,
    
    -- Result
    result TEXT,  -- JSON response
    error TEXT,
    
    -- Timestamps
    started_at INTEGER,
    completed_at INTEGER,
    
    FOREIGN KEY (analysis_id) REFERENCES corpus_analyses(id)
);

CREATE INDEX idx_chunk_results_analysis ON chunk_results(analysis_id);
```

---

## 7. API Endpoints

### 7.1 Analysis API

```javascript
// POST /api/corpus/:id/analyze
// Start analysis job

Request:
{
    chunkSize: 750,        // optional, default 750
    chunkOverlap: 100,    // optional, default 100
    provider: 'gemini_proxy',
    model: 'gemini-2.5-pro-真流-[星星公益站-CLI渠道]',
    layers: ['l1', 'l2', 'l3', 'l4', 'l5', 'l6'],  // which layers to run
}

Response:
{
    id: "analysis-uuid",
    corpusId: "corpus-uuid",
    status: "processing",
    config: { ... },
    estimatedTime: "45 minutes"  // based on chunk count
}
```

### 7.2 Progress Stream

```javascript
// GET /api/corpus/:id/analysis/:analysisId/stream
// SSE stream for progress

// Events:
{ type: 'progress', phase: 'level_0', progress: 0.45, chunksProcessed: 900, totalChunks: 2000 }
{ type: 'progress', phase: 'level_1', progress: 0.1 }
{ type: 'error', message: 'Rate limited, retrying...' }
{ type: 'completed', result: { ... } }
```

### 7.3 Get Analysis Results

```javascript
// GET /api/corpus/:id/analysis/:analysisId
// Get full analysis results

// GET /api/corpus/:id/analysis/:analysisId/layer/:layer
// Get specific layer (l1, l2, l3, l4, l5, l6)
```

---

## 8. Frontend Components

### 8.1 AnalysisPanel

```jsx
// src/pages/Lab/CorpusLab/components/AnalysisPanel.jsx

export function AnalysisPanel({ corpus }) {
    const { analyses, startAnalysis, cancelAnalysis } = useAnalysis(corpus.id);
    
    const [config, setConfig] = useState({
        chunkSize: 750,
        provider: 'gemini_proxy',
        model: 'gemini-2.5-pro-真流-[星星公益站-CLI渠道]',
        layers: ['l1', 'l2', 'l3', 'l4', 'l5', 'l6'],
    });
    
    const activeAnalysis = analyses.find(a => a.status === 'processing');
    
    return (
        <div className="analysis-panel">
            <h3>Phân tích Corpus</h3>
            
            {!activeAnalysis ? (
                <AnalysisConfig
                    config={config}
                    onChange={setConfig}
                    chunkCount={corpus.chunkCount}
                />
            ) : (
                <AnalysisProgress analysis={activeAnalysis} />
            )}
            
            {activeAnalysis ? (
                <button onClick={() => cancelAnalysis(activeAnalysis.id)}>
                    Hủy
                </button>
            ) : (
                <button onClick={() => startAnalysis(corpus.id, config)}>
                    Bắt đầu phân tích
                </button>
            )}
        </div>
    );
}
```

### 8.2 AnalysisConfig

```jsx
function AnalysisConfig({ config, onChange, chunkCount }) {
    return (
        <div className="analysis-config">
            <label>
                Chunk Size (từ):
                <select
                    value={config.chunkSize}
                    onChange={e => onChange({ ...config, chunkSize: +e.target.value })}
                >
                    <option value={500}>Fast (500 từ) - Nhiều chunks</option>
                    <option value={750}>Balanced (750 từ) - Đề xuất</option>
                    <option value={1500}>Thorough (1500 từ) - Ít chunks</option>
                </select>
            </label>
            
            <label>
                Model:
                <select
                    value={config.model}
                    onChange={e => onChange({ ...config, model: e.target.value })}
                >
                    <option value="gemini-2.5-pro-真流-[星星公益站-CLI渠道]">
                        2.5 Pro (Nhanh)
                    </option>
                    <option value="gemini-3.1-pro-high-真流-[星星公益站-CLI渠道]">
                        3.1 Pro High (Chất lượng cao)
                    </option>
                </select>
            </label>
            
            <div className="estimate">
                <p>Ước tính: ~{Math.ceil(chunkCount / config.chunkSize)} chunks</p>
                <p>Thời gian: ~{Math.ceil(chunkCount / 6)} phút</p>
            </div>
            
            <LayersSelector
                selected={config.layers}
                onChange={layers => onChange({ ...config, layers })}
            />
        </div>
    );
}
```

### 8.3 AnalysisProgress

```jsx
function AnalysisProgress({ analysis }) {
    const [progress, setProgress] = useState(null);
    
    useEffect(() => {
        const eventSource = new EventSource(
            `/api/corpus/${analysis.corpusId}/analysis/${analysis.id}/stream`
        );
        
        eventSource.onmessage = (event) => {
            const data = JSON.parse(event.data);
            if (data.type === 'progress') {
                setProgress(data);
            } else if (data.type === 'completed') {
                eventSource.close();
                // Refresh analysis
            }
        };
        
        return () => eventSource.close();
    }, [analysis.id]);
    
    return (
        <div className="analysis-progress">
            <div className="phase">
                Phase: {progress?.phase || analysis.status}
            </div>
            
            <div className="progress-bar">
                <div
                    className="progress-fill"
                    style={{ width: `${(progress?.progress || 0) * 100}%` }}
                />
            </div>
            
            <div className="stats">
                {progress?.chunksProcessed && (
                    <span>Chunks: {progress.chunksProcessed}/{progress.totalChunks}</span>
                )}
                {progress?.apiCalls && (
                    <span>API calls: {progress.apiCalls}</span>
                )}
            </div>
        </div>
    );
}
```

---

## 9. Zustand Store

```javascript
// src/stores/analysisStore.js

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export const useAnalysisStore = create(
    persist(
        (set, get) => ({
            // Current analyses (in memory)
            analyses: [],
            
            // Get analysis by ID
            getAnalysis: (id) => get().analyses.find(a => a.id === id),
            
            // Start new analysis
            startAnalysis: async (corpusId, config) => {
                const response = await fetch(`/api/corpus/${corpusId}/analyze`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(config),
                });
                
                const analysis = await response.json();
                set(state => ({
                    analyses: [...state.analyses, analysis],
                }));
                
                return analysis;
            },
            
            // Update analysis progress
            updateProgress: (id, progress) => {
                set(state => ({
                    analyses: state.analyses.map(a =>
                        a.id === id ? { ...a, ...progress } : a
                    ),
                }));
            },
            
            // Complete analysis
            completeAnalysis: (id, result) => {
                set(state => ({
                    analyses: state.analyses.map(a =>
                        a.id === id ? { ...a, status: 'completed', result } : a
                    ),
                }));
            },
            
            // Cancel analysis
            cancelAnalysis: async (id) => {
                await fetch(`/api/corpus/analysis/${id}`, { method: 'DELETE' });
                set(state => ({
                    analyses: state.analyses.filter(a => a.id !== id),
                }));
            },
        }),
        {
            name: 'sf-analysis-store',
            partialize: (state) => ({
                // Only persist completed analyses
                analyses: state.analyses.filter(a => a.status === 'completed'),
            }),
        }
    )
);
```

---

## 10. Error Handling

```javascript
// Retry logic với exponential backoff
async function analyzeWithRetry(chunk, config, retries = 3) {
    const delays = [1000, 3000, 10000];
    
    for (let i = 0; i < retries; i++) {
        try {
            return await analyzeChunk(chunk, config);
        } catch (error) {
            if (error.includes('rate limit')) {
                keyManager.markRateLimited(config.apiKey);
                // Get new key
                const newKey = keyManager.getNextKey(config.provider);
                if (!newKey) {
                    // Wait for any key to become available
                    await sleep(delays[i]);
                    continue;
                }
                config.apiKey = newKey;
            }
            
            if (i === retries - 1) throw error;
            await sleep(delays[i]);
        }
    }
}

// Error types and handling
const ERROR_TYPES = {
    RATE_LIMIT: {
        retry: true,
        waitMs: 60000,
        message: 'API rate limited. Waiting...',
    },
    TIMEOUT: {
        retry: true,
        waitMs: 5000,
        message: 'Request timeout. Retrying...',
    },
    INVALID_RESPONSE: {
        retry: false,
        message: 'Invalid response from API. Check logs.',
    },
    QUOTA_EXCEEDED: {
        retry: false,
        message: 'API quota exceeded for today.',
    },
};
```

---

## 11. Testing Checklist

- [ ] Start analysis → Progress updates correctly
- [ ] Cancel analysis → Job stops
- [ ] Rate limit → Auto-retry with different key
- [ ] All keys rate limited → Shows appropriate error
- [ ] Analysis completes → Results saved to database
- [ ] SSE stream → Real-time progress in UI
- [ ] Resume after page reload → Analysis state restored
- [ ] Large file (10MB+) → Handles without crash
- [ ] Invalid config → Shows validation error
- [ ] Analysis L1 only → Runs fast
- [ ] Analysis L1-L6 → Takes appropriate time
- [ ] Results match expected JSON schema
