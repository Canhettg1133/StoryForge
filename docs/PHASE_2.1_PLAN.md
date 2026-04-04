# PHASE 2.1: Chunk Optimization Tool

## Mục tiêu

Cho phép **re-chunk** các corpus đã upload để tối ưu cho Phase 3 (context-based analysis).

---

## 1. Tính năng chính

```
┌─────────────────────────────────────────────────────────────────┐
│  Phase 2.1: Chunk Optimizer                                     │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ Corpus đã có: 2000 chunks × 750 words                  │   │
│  │                                                             │   │
│  │ Chunk Size: [500000     ] words ← Nhập thủ công         │   │
│  │                    ↓                                      │   │
│  │ Preview: ~20 chunks mới × 500k words ≈ 1M context      │   │
│  │                                                             │   │
│  │ Parallel: [6         ] chunks cùng lúc ← Nhập thủ công  │   │
│  │                                                             │   │
│  │ [Preview] [Re-chunk] [Cancel]                            │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

---

## 2. File Structure

```
src/
├── pages/
│   └── Lab/
│       └── CorpusLab/
│           ├── components/
│           │   ├── ChunkOptimizer.jsx     # Main UI
│           │   ├── ChunkConfigPanel.jsx   # Config options
│           │   ├── ChunkPreview.jsx       # Preview before re-chunk
│           │   └── RechunkProgress.jsx    # Progress bar
│           └── hooks/
│               └── useCorpusRechunk.js    # Re-chunk logic
│
├── services/
│   └── corpus/
│       ├── rechunker.js                 # Re-chunking engine
│       └── chunkCalculator.js           # Estimate chunks, time
```

---

## 3. Chunk Calculator

```javascript
// src/services/corpus/chunkCalculator.js

/**
 * Tính toán chunks dựa trên context limit
 * 
 * Gemini 3.1 Pro High: 1M tokens context
 * Output max: 65k tokens
 * 
 * Nên dùng: 500k words input để có buffer cho output
 */

export const CONTEXT_LIMITS = {
    // Gemini 3.1 Pro High
    'gemini-3.1-pro-high': {
        inputTokens: 1000000,      // 1M tokens
        inputWords: 666666,       // ~666k words (1.5 tokens/word)
        recommendedInput: 500000,   // Conservative: 500k words
        outputTokens: 65384,      // 65k tokens
        partsNeeded: 3,            // 3 × 65k = 195k output
    },
    // Gemini 2.5 Flash
    'gemini-2.5-flash': {
        inputTokens: 32000,
        inputWords: 21333,
        recommendedInput: 15000,
        outputTokens: 8192,
        partsNeeded: 4,
    },
};

export const CHUNK_PRESETS = {
    // Nhanh: Dùng với Gemini 2.5 Flash
    fast: {
        label: 'Fast (2.5 Flash)',
        words: 15000,
        description: '15k words/chunk, dùng cho model nhỏ',
        model: 'gemini-2.5-flash',
    },
    
    // Cân bằng: Dùng với Gemini 3.1 Flash
    balanced: {
        label: 'Balanced (3.1 Flash)',
        words: 40000,
        description: '40k words/chunk, 64k context model',
        model: 'gemini-3.1-pro-low',
    },
    
    // Tối ưu: Dùng với Gemini 3.1 Pro High
    optimal: {
        label: 'Optimal (3.1 Pro High)',
        words: 500000,
        description: '500k words/chunk, tận dụng 1M context',
        model: 'gemini-3.1-pro-high',
    },
    
    // Custom: User tự nhập
    custom: {
        label: 'Custom',
        words: null,
        description: 'Nhập số words thủ công',
        model: null,
    },
};

/**
 * Tính toán số chunks mới từ corpus
 */
export function calculateNewChunks(corpusWordCount, chunkSizeWords) {
    const chunkCount = Math.ceil(corpusWordCount / chunkSizeWords);
    return {
        originalChunks: null,  // Đã có từ Phase 2
        newChunks: chunkCount,
        wordsPerChunk: chunkSizeWords,
        corpusWordCount,
        efficiency: chunkSizeWords / corpusWordCount * 100,
    };
}

/**
 * Ước tính thời gian phân tích
 */
export function estimateAnalysisTime(chunkCount, partsPerChunk, parallelChunks) {
    const timePerPart = 10;  // seconds per 65k output
    const partsPerChunk = partsPerChunk || 3;
    
    const totalOutputs = chunkCount * partsPerChunk;
    const batches = Math.ceil(totalOutputs / parallelChunks);
    const totalSeconds = batches * timePerPart;
    
    return {
        totalOutputs,
        batches,
        estimatedSeconds: totalSeconds,
        estimatedMinutes: Math.ceil(totalSeconds / 60),
        estimatedHours: (totalSeconds / 3600).toFixed(1),
    };
}

/**
 * Validate chunk size
 */
export function validateChunkSize(words, model) {
    const limits = CONTEXT_LIMITS[model] || CONTEXT_LIMITS['gemini-3.1-pro-high'];
    
    if (words < 1000) {
        return { valid: false, warning: 'Chunk quá nhỏ, có thể miss details' };
    }
    
    if (words > limits.inputWords) {
        return { 
            valid: false, 
            warning: `Chunk lớn hơn context limit (${limits.inputWords} words)` 
        };
    }
    
    if (words > limits.recommendedInput) {
        return { 
            valid: true, 
            warning: 'Chunk gần đạt limit, có thể bị cắt' 
        };
    }
    
    return { valid: true, warning: null };
}
```

---

## 4. Re-chunker Engine

```javascript
// src/services/corpus/rechunker.js

import { calculateNewChunks, CONTEXT_LIMITS } from './chunkCalculator.js';

/**
 * Re-chunk một corpus đã có với chunk size mới
 */

export async function rechunkCorpus(corpusId, options = {}) {
    const {
        chunkSizeWords = 500000,
        preserveParagraphs = true,
        onProgress = () => {},
    } = options;
    
    // 1. Get corpus info
    const corpus = await corpusService.getCorpus(corpusId);
    const chapters = await corpusService.getChapters(corpusId);
    
    // 2. Concatenate all content
    let fullText = '';
    let chapterPositions = [];
    
    for (const chapter of chapters) {
        chapterPositions.push({
            chapterId: chapter.id,
            startPosition: fullText.length,
            originalChapterId: chapter.id,
        });
        fullText += '\n\n' + chapter.content;
    }
    
    onProgress({ phase: 'preparing', progress: 0 });
    
    // 3. Split into new chunks
    const newChunks = splitIntoChunks(fullText, {
        chunkSize: chunkSizeWords,
        preserveParagraphs,
        chapterPositions,
    });
    
    onProgress({ phase: 'splitting', progress: 0.3 });
    
    // 4. Delete old chunks (optional, keep for backup)
    // await chunkService.deleteChunksByCorpus(corpusId);
    
    // 5. Save new chunks
    const savedChunks = await chunkService.saveChunks(corpusId, newChunks);
    
    onProgress({ phase: 'saving', progress: 0.8 });
    
    // 6. Update corpus metadata
    await corpusService.updateCorpus(corpusId, {
        chunkSizeUsed: chunkSizeWords,
        chunkCount: newChunks.length,
        lastRechunkedAt: Date.now(),
    });
    
    onProgress({ phase: 'completed', progress: 1 });
    
    return {
        originalChunkCount: corpus.chunkCount,
        newChunkCount: newChunks.length,
        chunkSizeUsed: chunkSizeWords,
        savedChunks,
    };
}

/**
 * Split text into chunks
 */
function splitIntoChunks(text, options) {
    const { chunkSize, preserveParagraphs, chapterPositions } = options;
    
    if (preserveParagraphs) {
        return splitByParagraphs(text, chunkSize, chapterPositions);
    } else {
        return splitByWords(text, chunkSize);
    }
}

/**
 * Split preserving paragraph boundaries
 */
function splitByParagraphs(text, chunkSize, chapterPositions) {
    const paragraphs = text.split(/\n\s*\n/);
    const chunks = [];
    
    let currentChunk = {
        text: '',
        wordCount: 0,
        startPosition: 0,
        chapters: [],
    };
    
    for (const paragraph of paragraphs) {
        const paragraphWords = paragraph.split(/\s+/).filter(w => w.length > 0).length;
        
        // Check which chapter this paragraph belongs to
        const paragraphPos = currentChunk.startPosition + currentChunk.text.length;
        const chapter = findChapterAtPosition(paragraphPos, chapterPositions);
        
        // If adding this paragraph exceeds chunk size
        if (currentChunk.wordCount + paragraphWords > chunkSize) {
            // Save current chunk
            if (currentChunk.text.length > 0) {
                chunks.push({
                    text: currentChunk.text.trim(),
                    wordCount: currentChunk.wordCount,
                    startPosition: currentChunk.startPosition,
                    chapters: [...new Set(currentChunk.chapters)],
                });
            }
            
            // Start new chunk
            currentChunk = {
                text: paragraph + '\n\n',
                wordCount: paragraphWords,
                startPosition: paragraphPos,
                chapters: [chapter?.chapterId],
            };
        } else {
            // Add to current chunk
            currentChunk.text += paragraph + '\n\n';
            currentChunk.wordCount += paragraphWords;
            if (chapter && !currentChunk.chapters.includes(chapter.chapterId)) {
                currentChunk.chapters.push(chapter.chapterId);
            }
        }
    }
    
    // Push last chunk
    if (currentChunk.text.length > 0) {
        chunks.push({
            text: currentChunk.text.trim(),
            wordCount: currentChunk.wordCount,
            startPosition: currentChunk.startPosition,
            chapters: [...new Set(currentChunk.chapters)],
        });
    }
    
    return chunks;
}

/**
 * Split by words (simple, no paragraph preservation)
 */
function splitByWords(text, chunkSize) {
    const words = text.split(/\s+/);
    const chunks = [];
    
    for (let i = 0; i < words.length; i += chunkSize) {
        const chunkWords = words.slice(i, i + chunkSize);
        chunks.push({
            text: chunkWords.join(' '),
            wordCount: chunkWords.length,
            startPosition: i,
            chapters: [],  // Will be determined later
        });
    }
    
    return chunks;
}

/**
 * Find which chapter a position belongs to
 */
function findChapterAtPosition(position, chapterPositions) {
    for (let i = chapterPositions.length - 1; i >= 0; i--) {
        if (position >= chapterPositions[i].startPosition) {
            return chapterPositions[i];
        }
    }
    return chapterPositions[0];
}
```

---

## 5. UI Components

### 5.1 ChunkOptimizer (Main Component)

```jsx
// src/pages/Lab/CorpusLab/components/ChunkOptimizer.jsx

export function ChunkOptimizer({ corpus }) {
    const [config, setConfig] = useState({
        preset: 'optimal',
        customWords: 500000,
        parallelChunks: 6,
        model: 'gemini-3.1-pro-high',
    });
    
    const [preview, setPreview] = useState(null);
    const [isProcessing, setIsProcessing] = useState(false);
    
    // Calculate preview
    useEffect(() => {
        const chunkSize = config.preset === 'custom' 
            ? config.customWords 
            : CHUNK_PRESETS[config.preset].words;
        
        const newChunks = calculateNewChunks(corpus.wordCount, chunkSize);
        const time = estimateAnalysisTime(
            newChunks.newChunks, 
            3,  // parts per chunk
            config.parallelChunks
        );
        
        setPreview({ ...newChunks, ...time });
    }, [config, corpus.wordCount]);
    
    // Handle re-chunk
    const handleRechunk = async () => {
        setIsProcessing(true);
        
        const chunkSize = config.preset === 'custom' 
            ? config.customWords 
            : CHUNK_PRESETS[config.preset].words;
        
        try {
            await rechunkCorpus(corpus.id, {
                chunkSizeWords: chunkSize,
            });
            
            toast.success('Re-chunk thành công!');
            // Refresh corpus data
            onCorpusUpdated();
        } catch (error) {
            toast.error('Lỗi: ' + error.message);
        } finally {
            setIsProcessing(false);
        }
    };
    
    return (
        <div className="chunk-optimizer">
            <h3>Chunk Optimizer</h3>
            <p>Corpus hiện tại: {corpus.chunkCount} chunks × {corpus.chunkSize || 750} words</p>
            
            <ChunkConfigPanel
                config={config}
                onChange={setConfig}
            />
            
            {preview && <ChunkPreview preview={preview} />}
            
            <div className="actions">
                <button onClick={handleRechunk} disabled={isProcessing}>
                    {isProcessing ? 'Đang xử lý...' : 'Re-chunk'}
                </button>
            </div>
        </div>
    );
}
```

### 5.2 ChunkConfigPanel

```jsx
// src/pages/Lab/CorpusLab/components/ChunkConfigPanel.jsx

export function ChunkConfigPanel({ config, onChange }) {
    return (
        <div className="chunk-config-panel">
            <label>
                Preset:
                <select
                    value={config.preset}
                    onChange={e => {
                        const preset = e.target.value;
                        const model = CHUNK_PRESETS[preset]?.model || null;
                        onChange({ ...config, preset, model });
                    }}
                >
                    <option value="fast">Fast (15k words) - Gemini 2.5 Flash</option>
                    <option value="balanced">Balanced (40k words) - Gemini 3.1 Flash</option>
                    <option value="optimal">Optimal (500k words) - Gemini 3.1 Pro High</option>
                    <option value="custom">Custom...</option>
                </select>
            </label>
            
            {config.preset === 'custom' && (
                <label>
                    Chunk Size (words):
                    <input
                        type="number"
                        value={config.customWords}
                        onChange={e => onChange({ 
                            ...config, 
                            customWords: parseInt(e.target.value) || 10000 
                        })}
                        min={1000}
                        max={1000000}
                        step={1000}
                    />
                    <span className="hint">
                        1M tokens ≈ 666k words (Gemini 3.1 Pro High)
                    </span>
                </label>
            )}
            
            <label>
                Parallel Chunks:
                <input
                    type="number"
                    value={config.parallelChunks}
                    onChange={e => onChange({ 
                        ...config, 
                        parallelChunks: parseInt(e.target.value) || 1 
                    })}
                    min={1}
                    max={20}
                />
                <span className="hint">
                    Số chunks xử lý cùng lúc (cần nhiều API keys)
                </span>
            </label>
            
            <label>
                Model:
                <select
                    value={config.model}
                    onChange={e => onChange({ ...config, model: e.target.value })}
                >
                    <option value="gemini-3.1-pro-high">
                        Gemini 3.1 Pro High (1M context, 65k output)
                    </option>
                    <option value="gemini-3.1-pro-low">
                        Gemini 3.1 Pro Low (64k context, 65k output)
                    </option>
                    <option value="gemini-2.5-flash">
                        Gemini 2.5 Flash (32k context, 8k output)
                    </option>
                </select>
            </label>
            
            {/* Validation warning */}
            {config.preset === 'custom' && (
                <ValidationWarning
                    words={config.customWords}
                    model={config.model}
                />
            )}
        </div>
    );
}

function ValidationWarning({ words, model }) {
    const validation = validateChunkSize(words, model);
    
    if (!validation.warning) return null;
    
    return (
        <div className={`validation-warning ${validation.valid ? 'warning' : 'error'}`}>
            ⚠️ {validation.warning}
        </div>
    );
}
```

### 5.3 ChunkPreview

```jsx
// src/pages/Lab/CorpusLab/components/ChunkPreview.jsx

export function ChunkPreview({ preview }) {
    return (
        <div className="chunk-preview">
            <h4>Preview</h4>
            
            <div className="stats">
                <div className="stat">
                    <span className="label">Corpus Size:</span>
                    <span className="value">{preview.corpusWordCount?.toLocaleString()} words</span>
                </div>
                
                <div className="stat">
                    <span className="label">New Chunk Size:</span>
                    <span className="value">{preview.wordsPerChunk?.toLocaleString()} words</span>
                </div>
                
                <div className="stat highlight">
                    <span className="label">New Chunk Count:</span>
                    <span className="value">{preview.newChunks} chunks</span>
                </div>
                
                <div className="stat">
                    <span className="label">Total Outputs:</span>
                    <span className="value">{preview.totalOutputs} × 65k</span>
                </div>
                
                <div className="stat">
                    <span className="label">Parallel Batches:</span>
                    <span className="value">{preview.batches}</span>
                </div>
                
                <div className="stat highlight">
                    <span className="label">Est. Time:</span>
                    <span className="value">
                        {preview.estimatedMinutes < 60 
                            ? `~${preview.estimatedMinutes} minutes`
                            : `~${preview.estimatedHours} hours`
                        }
                    </span>
                </div>
            </div>
            
            <div className="efficiency-bar">
                <span>Efficiency:</span>
                <div className="bar">
                    <div 
                        className="fill" 
                        style={{ width: `${preview.efficiency}%` }}
                    />
                </div>
                <span>{preview.efficiency?.toFixed(1)}%</span>
            </div>
        </div>
    );
}
```

---

## 6. Integration với Corpus Detail Page

```jsx
// Trong CorpusDetail.jsx hoặc CorpusLab.jsx

function CorpusDetail({ corpus }) {
    return (
        <div className="corpus-detail">
            <CorpusHeader corpus={corpus} />
            
            {/* Existing sections */}
            <ChapterList chapters={chapters} />
            <MetadataEditor corpus={corpus} />
            
            {/* NEW: Chunk Optimizer Section */}
            <Section title="Chunk Optimization">
                <ChunkOptimizer 
                    corpus={corpus}
                    onCorpusUpdated={() => refetchCorpus()}
                />
            </Section>
            
            {/* Existing: Start Analysis */}
            <Section title="Analysis">
                <AnalysisPanel corpus={corpus} />
            </Section>
        </div>
    );
}
```

---

## 7. Database Updates

```sql
-- Thêm fields vào corpuses table
ALTER TABLE corpuses ADD COLUMN chunk_size_used INTEGER;
ALTER TABLE corpuses ADD COLUMN chunk_count INTEGER;
ALTER TABLE corpuses ADD COLUMN last_rechunked_at INTEGER;

-- chunks table - thêm index cho chunk position
CREATE INDEX idx_chunks_corpus_position ON chunks(corpus_id, start_position);
```

---

## 8. API Endpoints

```javascript
// POST /api/corpus/:id/rechunk
// Re-chunk a corpus

Request:
{
    chunkSizeWords: 500000,    // required
    preserveParagraphs: true, // optional, default true
}

Response:
{
    success: true,
    originalChunkCount: 2000,
    newChunkCount: 20,
    chunkSizeUsed: 500000,
    savedAt: 1704067200000,
}

// GET /api/corpus/:id/chunk-preview
// Preview new chunk count without actually re-chunking

Request:
{
    chunkSizeWords: 500000,
}

Response:
{
    corpusWordCount: 1500000,
    newChunkCount: 3,
    estimatedTime: "30 seconds",
}
```

---

## 9. Tính năng nâng cao

### 9.1 Batch Re-chunk

```javascript
// Re-chunk nhiều corpuses cùng lúc
async function batchRechunk(corpusIds, chunkSizeWords) {
    const results = [];
    
    for (const corpusId of corpusIds) {
        const result = await rechunkCorpus(corpusId, { chunkSizeWords });
        results.push(result);
    }
    
    return results;
}
```

### 9.2 Re-chunk History

```javascript
// Lưu lịch sử re-chunk để có thể rollback
CREATE TABLE rechunk_history (
    id TEXT PRIMARY KEY,
    corpus_id TEXT NOT NULL,
    previous_chunk_count INTEGER,
    new_chunk_count INTEGER,
    chunk_size_used INTEGER,
    created_at INTEGER DEFAULT (strftime('%s', 'now')),
    FOREIGN KEY (corpus_id) REFERENCES corpuses(id)
);
```

### 9.3 Auto-optimize

```javascript
// Tự động chọn chunk size tốt nhất cho corpus
function autoOptimizeChunkSize(corpusWordCount, availableModels) {
    // Chọn model mạnh nhất có sẵn
    const model = availableModels.includes('gemini-3.1-pro-high') 
        ? 'gemini-3.1-pro-high' 
        : 'gemini-2.5-flash';
    
    const limits = CONTEXT_LIMITS[model];
    
    // Chunk size = recommended input (có buffer)
    return limits.recommendedInput;
}
```

---

## 10. User Flow

```
┌─────────────────────────────────────────────────────────────────┐
│  User uploads corpus (Phase 2)                                  │
│  → 2000 chunks × 750 words                                     │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  User vào Corpus Detail page                                    │
│  → Thấy "Chunk Optimization" section                           │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  User chọn preset HOẶC nhập custom chunk size                  │
│  → Thấy preview: chunks mới, thời gian ước tính               │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  User click "Re-chunk"                                          │
│  → Progress bar hiện                                           │
│  → Chunks được tạo lại                                        │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  User thấy thông báo thành công                                │
│  → Tiếp tục với Phase 3 Analysis                              │
└─────────────────────────────────────────────────────────────────┘
```

---

## 11. Checklist

- [ ] ChunkCalculator với presets
- [ ] Re-chunker engine
- [ ] ChunkOptimizer component
- [ ] ChunkConfigPanel với custom input
- [ ] ChunkPreview component
- [ ] Validation warnings
- [ ] API endpoints (rechunk, preview)
- [ ] Database updates
- [ ] Integration vào Corpus Detail
- [ ] Progress bar cho re-chunk
- [ ] Re-chunk history (optional)
- [ ] Batch re-chunk (optional)
