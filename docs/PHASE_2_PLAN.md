# PHASE 2: Corpus Lab - Upload & Parse

## Mục tiêu

Upload truyện (TXT, EPUB, PDF, DOCX), parse thành chapters, sẵn sàng cho Phase 3 phân tích.

---

## 1. File Structure

```
src/
├── pages/
│   └── Lab/
│       └── CorpusLab/
│           ├── CorpusLab.jsx          # Main page
│           ├── components/
│           │   ├── UploadDropzone.jsx  # Drag & drop upload
│           │   ├── FilePreview.jsx    # Preview sau parse
│           │   ├── MetadataEditor.jsx # Edit title, author, fandom
│           │   ├── ChapterList.jsx    # Danh sách chapters
│           │   └── CorpusCard.jsx     # Card trong corpus list
│           └── hooks/
│               └── useCorpusUpload.js  # Upload logic
│
├── services/
│   └── corpus/
│       ├── parser/
│       │   ├── index.js              # Parser entry point
│       │   ├── txtParser.js          # TXT parser
│       │   ├── epubParser.js         # EPUB parser
│       │   ├── pdfParser.js          # PDF parser
│       │   └── docxParser.js        # DOCX parser
│       ├── chunker.js               # Chunking engine
│       ├── detector/
│       │   ├── fandomDetector.js     # Auto-detect fandom
│       │   └── chapterDetector.js   # Detect chapter markers
│       └── corpusService.js         # Corpus CRUD
│
├── stores/
│   └── corpusStore.js              # Zustand store cho corpus
│
src-tauri/
├── src/
│   ├── commands/
│   │   └── corpus.rs               # Tauri commands
│   └── main.rs
```

---

## 2. File Parsing

### 2.1 TXT Parser

```javascript
// Supported patterns
const CHAPTER_PATTERNS = [
    /^(chương|chapter|ch)\s*(\d+|[IVXLCDM]+)/i,
    /^(part|pt)\s*(\d+)/i,
    /^\[\s*(\d+)\s*\]\s*[-–—]\s*/,
    /^\d+\.\s+/,
    /^={3,}.*={3,}$/,  // === Chapter Name ===
];

function parseTxt(rawText) {
    const chapters = [];
    const lines = rawText.split('\n');
    
    // Detect chapter markers
    let currentChapter = { title: '', content: [], startLine: 0 };
    
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const isChapterMarker = CHAPTER_PATTERNS.some(p => p.test(line));
        
        if (isChapterMarker && currentChapter.content.length > 0) {
            // Save previous chapter
            chapters.push({
                title: currentChapter.title || `Chapter ${chapters.length + 1}`,
                content: currentChapter.content.join('\n'),
                startLine: currentChapter.startLine,
                endLine: i - 1
            });
            // Start new chapter
            currentChapter = { title: line.trim(), content: [], startLine: i };
        } else {
            currentChapter.content.push(line);
        }
    }
    
    // Push last chapter
    if (currentChapter.content.length > 0) {
        chapters.push({
            title: currentChapter.title || `Chapter ${chapters.length + 1}`,
            content: currentChapter.content.join('\n'),
            startLine: currentChapter.startLine,
            endLine: lines.length - 1
        });
    }
    
    return chapters;
}
```

### 2.2 EPUB Parser

```javascript
// Dùng epub.js hoặc node-ebook
import ePub from 'epubjs';

async function parseEpub(fileBuffer) {
    const book = ePub(fileBuffer);
    await book.ready;
    
    const metadata = await book.loaded.metadata;
    const spine = book.spine;
    const chapters = [];
    
    for (const item of spine.items) {
        const doc = await book.load(item.href);
        const text = extractText(doc);
        
        chapters.push({
            title: item.idref || `Chapter ${chapters.length + 1}`,
            content: text,
            href: item.href
        });
    }
    
    return {
        metadata: {
            title: metadata.title,
            author: metadata.creator,
            language: metadata.language
        },
        chapters
    };
}
```

### 2.3 PDF Parser

```javascript
// Dùng pdf-parse
import pdf from 'pdf-parse';

async function parsePdf(fileBuffer) {
    const data = await pdf(fileBuffer);
    
    // PDF thường không có chapter markers
    // Split theo trang hoặc chunk size cố định
    const pages = data.pages;
    const chapters = [];
    
    let currentChapter = { pages: [], content: '' };
    
    for (let i = 0; i < pages.length; i++) {
        currentChapter.content += pages[i].text + '\n\n';
        
        // Tạo chapter mỗi N pages (configurable)
        if ((i + 1) % 10 === 0 || i === pages.length - 1) {
            chapters.push({
                title: `Part ${chapters.length + 1} (Pages ${i - 9}-${i + 1})`,
                content: currentChapter.content.trim(),
                startPage: i - 9,
                endPage: i + 1
            });
            currentChapter = { pages: [], content: '' };
        }
    }
    
    return chapters;
}
```

### 2.4 DOCX Parser

```javascript
// Dùng mammoth.js
import mammoth from 'mammoth';

async function parseDocx(fileBuffer) {
    const result = await mammoth.extractRawText({ arrayBuffer: fileBuffer });
    const rawText = result.value;
    
    // DOCX có thể dùng heading styles để detect chapters
    const { value: htmlResult } = await mammoth.convertToHtml({ arrayBuffer: fileBuffer });
    
    // Parse headings
    const headingPattern = /<h([1-6])[^>]*>(.*?)<\/h\1>/gi;
    const chapters = [];
    let lastHeadingIndex = 0;
    let match;
    
    while ((match = headingPattern.exec(htmlResult)) !== null) {
        const headingLevel = parseInt(match[1]);
        const headingText = match[2].trim();
        
        // Extract content between this heading and next
        const contentStart = match.index + match[0].length;
        const contentEnd = headingPattern.lastIndex;
        const content = htmlResult.slice(contentStart, contentEnd);
        const plainText = stripHtml(content);
        
        if (plainText.trim().length > 100) {
            chapters.push({
                title: headingText || `Chapter ${chapters.length + 1}`,
                content: plainText.trim(),
                headingLevel
            });
        }
    }
    
    return chapters;
}
```

---

## 3. Chunking Engine

```javascript
// src/services/corpus/chunker.js

const DEFAULT_CHUNK_SIZE = 750;  // từ
const CHUNK_OVERLAP = 100;        // từ overlap

function createChunks(chapter, options = {}) {
    const {
        chunkSize = DEFAULT_CHUNK_SIZE,
        overlap = CHUNK_OVERLAP,
        preserveParagraphs = true
    } = options;
    
    const paragraphs = chapter.content.split(/\n\s*\n/);
    const chunks = [];
    let currentChunk = { words: [], paragraphs: [] };
    let wordCount = 0;
    
    for (const paragraph of paragraphs) {
        const paragraphWords = paragraph.split(/\s+/).filter(w => w.length > 0);
        
        // Nếu paragraph quá lớn, split tiếp
        if (paragraphWords.length > chunkSize) {
            // Flush current chunk first
            if (currentChunk.words.length > 0) {
                chunks.push(createChunkObject(currentChunk, chapter, chunks.length));
            }
            
            // Split paragraph into sentences
            const sentences = paragraph.split(/(?<=[.!?])\s+/);
            currentChunk = { words: [], paragraphs: [] };
            
            for (const sentence of sentences) {
                const sentenceWords = sentence.split(/\s+/);
                if (wordCount + sentenceWords.length > chunkSize) {
                    // Save current chunk
                    chunks.push(createChunkObject(currentChunk, chapter, chunks.length));
                    
                    // Start new chunk with overlap
                    const overlapWords = currentChunk.words.slice(-overlap);
                    currentChunk = { words: overlapWords, paragraphs: [] };
                    wordCount = overlapWords.length;
                }
                currentChunk.words.push(...sentenceWords);
                currentChunk.paragraphs.push(sentence);
                wordCount += sentenceWords.length;
            }
        } else if (wordCount + paragraphWords.length > chunkSize) {
            // Save current chunk
            chunks.push(createChunkObject(currentChunk, chapter, chunks.length));
            
            // Start new chunk with overlap
            const overlapWords = currentChunk.words.slice(-overlap);
            currentChunk = { words: overlapWords, paragraphs: [paragraph] };
            wordCount = overlapWords.length;
        } else {
            currentChunk.words.push(...paragraphWords);
            currentChunk.paragraphs.push(paragraph);
            wordCount += paragraphWords.length;
        }
    }
    
    // Push last chunk
    if (currentChunk.words.length > 0) {
        chunks.push(createChunkObject(currentChunk, chapter, chunks.length));
    }
    
    return chunks;
}

function createChunkObject(chunkData, chapter, index) {
    return {
        id: `${chapter.id}_chunk_${index}`,
        chapterId: chapter.id,
        chapterTitle: chapter.title,
        index,
        text: chunkData.paragraphs.join('\n\n'),
        wordCount: chunkData.words.length,
        startWord: chunkData.words[0],
        endWord: chunkData.words[chunkData.words.length - 1]
    };
}
```

---

## 4. Fandom Detector

```javascript
// src/services/corpus/detector/fandomDetector.js

const KNOWN_FANDOMS = {
    'naruto': {
        patterns: [/uzumaki\s+naruto/, /sasuke/, /kakashi/, /sakura/, /konoha/, /chakra/, /jutsu/],
        aliases: ['Naruto', 'Naruto Shippuden', 'Boruto']
    },
    'harry_potter': {
        patterns: [/harry\s+potter/, /voldemort/, /hogwarts/, /muggle/, /quidditch/, /azkaban/],
        aliases: ['Harry Potter', 'HP', 'Harry Potter fandom']
    },
    'one_piece': {
        patterns: [/luffy/, /zoro/, /sanji/, /whitebeard/, /devil\s+fruit/, /yonko/],
        aliases: ['One Piece', 'OP']
    },
    'dragon_ball': {
        patterns: [/goku/, /vegeta/, /kamehameha/, /super\s+saiyan/, /ki/],
        aliases: ['Dragon Ball', 'DBZ', 'Dragon Ball Super']
    },
    'marvel': {
        patterns: [/avenger/, /iron\s+man/, /thor/, /hulk/, /spider-?man/],
        aliases: ['Marvel', 'MCU', 'Marvel Cinematic Universe']
    },
    'dc': {
        patterns: [/batman/, /superman/, /wonder\s+woman/, /flash/, /aquaman/],
        aliases: ['DC', 'DC Comics', 'DCEU']
    },
    'attack_on_titan': {
        patterns: [/eren/, /mikasa/, /titan/, /scout/, /wall\s+rosa?/],
        aliases: ['Attack on Titan', 'Shingeki no Kyojin', 'AoT']
    },
    'my_hero_academia': {
        patterns: [/midoriya/, /all\s+might/, /quirk/, /ua\s+high/, /hero\s+academia/],
        aliases: ['My Hero Academia', 'Boku no Hero Academia', 'MHA', 'BNHA']
    },
    'demon_slayer': {
        patterns: [/tanjiro/, /nezuko/, /muzan/, /hashira/, /breathing\s+style/],
        aliases: ['Demon Slayer', 'Kimetsu no Yaiba', 'KnY']
    },
    'genshin_impact': {
        patterns: [/teyvat/, /archon/, /vision/, /fatui/, /mc\?|\bTraveler\b/],
        aliases: ['Genshin Impact', 'Genshin']
    }
};

function detectFandom(text, threshold = 2) {
    const lowerText = text.toLowerCase();
    const scores = {};
    
    for (const [fandomKey, fandom] of Object.entries(KNOWN_FANDOMS)) {
        let score = 0;
        for (const pattern of fandom.patterns) {
            if (pattern.test(lowerText)) {
                score++;
            }
        }
        if (score >= threshold) {
            scores[fandomKey] = {
                score,
                matchedPatterns: fandom.patterns.filter(p => p.test(lowerText)).length,
                aliases: fandom.aliases
            };
        }
    }
    
    // Sort by score
    const sorted = Object.entries(scores)
        .sort((a, b) => b[1].score - a[1].score)
        .map(([key, data]) => ({ key, ...data }));
    
    return sorted;
}

// Usage
function getAutoDetectSuggestion(text) {
    const detected = detectFandom(text);
    if (detected.length > 0) {
        return {
            fandom: detected[0].key,
            confidence: detected[0].score / detected[0].matchedPatterns,
            alternatives: detected.slice(1, 4)
        };
    }
    return null;
}
```

---

## 5. Database Schema

```sql
-- corpuses table
CREATE TABLE corpuses (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    author TEXT,
    source_file TEXT,
    file_type TEXT,              -- 'txt', 'epub', 'pdf', 'docx'
    fandom TEXT,
    is_canon_fanfic TEXT,        -- 'canon', 'fanfic', 'both', null
    rating TEXT,                 -- 'general', 'teen', 'mature', 'explicit'
    language TEXT DEFAULT 'en',
    word_count INTEGER DEFAULT 0,
    chapter_count INTEGER DEFAULT 0,
    status TEXT DEFAULT 'uploaded',  -- 'uploaded', 'parsed', 'analyzing', 'analyzed'
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

-- chapters table
CREATE TABLE chapters (
    id TEXT PRIMARY KEY,
    corpus_id TEXT NOT NULL,
    index INTEGER NOT NULL,      -- Thứ tự trong truyện
    title TEXT,
    content TEXT NOT NULL,       -- Raw text
    word_count INTEGER DEFAULT 0,
    start_line INTEGER,         -- Line number trong file gốc
    end_line INTEGER,
    FOREIGN KEY (corpus_id) REFERENCES corpuses(id) ON DELETE CASCADE
);

-- chunks table
CREATE TABLE chunks (
    id TEXT PRIMARY KEY,
    chapter_id TEXT NOT NULL,
    corpus_id TEXT NOT NULL,
    index INTEGER NOT NULL,
    text TEXT NOT NULL,
    word_count INTEGER DEFAULT 0,
    start_word TEXT,
    end_word TEXT,
    FOREIGN KEY (chapter_id) REFERENCES chapters(id) ON DELETE CASCADE,
    FOREIGN KEY (corpus_id) REFERENCES corpuses(id) ON DELETE CASCADE
);

-- FTS for full-text search
CREATE VIRTUAL TABLE chunks_fts USING fts5(
    text,
    content='chunks',
    content_rowid='rowid'
);
```

---

## 6. API Endpoints

### 6.1 Upload File
```
POST /api/corpus/upload
Content-Type: multipart/form-data

Form data:
- file: File object
- metadata: { title, author, fandom, isCanonFanfic, rating }

Response:
{
    "id": "corpus-uuid",
    "title": "...",
    "status": "parsed",
    "chapterCount": 15,
    "wordCount": 50000
}
```

### 6.2 Get Corpus
```
GET /api/corpus/:id

Response:
{
    "id": "...",
    "metadata": {...},
    "chapters": [...],
    "status": "parsed"
}
```

### 6.3 List Corpuses
```
GET /api/corpus
GET /api/corpus?fandom=naruto
GET /api/corpus?status=analyzed
GET /api/corpus?limit=20&offset=0

Response:
{
    "corpuses": [...],
    "total": 25
}
```

### 6.4 Update Metadata
```
PATCH /api/corpus/:id
Content-Type: application/json

{
    "title": "New Title",
    "fandom": "naruto",
    "isCanonFanfic": "fanfic",
    "rating": "mature"
}

Response:
{ "id": "...", "updated": true }
```

### 6.5 Delete Corpus
```
DELETE /api/corpus/:id

Response:
{ "success": true }
```

### 6.6 Get Chapter Content
```
GET /api/corpus/:id/chapters/:chapterId

Response:
{
    "id": "...",
    "title": "Chapter 1",
    "content": "...",
    "chunks": [...]
}
```

---

## 7. Frontend Components

### 7.1 UploadDropzone

```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│              📁 Drag & Drop files here                     │
│              or click to browse                            │
│                                                             │
│              Supported: .txt, .epub, .pdf, .docx          │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

```jsx
// States: idle, dragging, uploading, processing, error
// Events: onFileSelect, onUploadComplete
// Progress bar during upload
```

### 7.2 FilePreview

```
┌─────────────────────────────────────────────────────────────┐
│  ✅ Parsed successfully!                                   │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  📖 15 chapters detected                                   │
│  📝 52,340 words                                           │
│  📁 Source: naruto_chapters.txt                           │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐  │
│  │ Chapter 1: The Boy Who Dreamed                       │  │
│  │ Chapter 2: The Nine-Tails                           │  │
│  │ Chapter 3: Forging Friends                           │  │
│  │ ...                                                  │  │
│  │ Chapter 15: [Not Detected - 1 page only]            │  │
│  └─────────────────────────────────────────────────────┘  │
│                                                             │
│  [Edit Metadata]                        [Continue →]       │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 7.3 MetadataEditor

```
┌─────────────────────────────────────────────────────────────┐
│  📝 Edit Metadata                                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Title:     [____________________________]                 │
│  Author:    [____________________________]                 │
│                                                             │
│  Fandom:    [🔍 Auto-detected: Naruto ▼]                  │
│             ├─ Naruto (85% confidence)                    │
│             ├─ Bleach (15%)                                │
│             └─ Other...                                   │
│                                                             │
│  Type:      ○ Canon   ● Fanfic   ○ Both                  │
│  Rating:    [Teen ▼]                                       │
│                                                             │
│  [Save]  [Cancel]                                          │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 7.4 CorpusList

```
┌─────────────────────────────────────────────────────────────┐
│  📚 My Corpuses                         [+ Upload New]    │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  [🔍 Search...                    ] [Fandom ▼] [Status ▼] │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐  │
│  │ 📖 Naruto: The Beginning          [Analyzing...]  │  │
│  │    Naruto • 15 chapters • 52k words • Fanfic      │  │
│  │    ████████░░░░  68%                              │  │
│  └─────────────────────────────────────────────────────┘  │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐  │
│  │ 📖 Harry Potter & The Stone       ✅ Analyzed     │  │
│  │    Harry Potter • 22 chapters • 78k words • Canon │  │
│  │    [View Analysis] [Analyze Again]                 │  │
│  └─────────────────────────────────────────────────────┘  │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐  │
│  │ 📖 One Piece: Grand Line Journey    ⏳ Parsed      │  │
│  │    One Piece • 10 chapters • 35k words • Fanfic   │  │
│  │    [Start Analysis] [Edit] [Delete]               │  │
│  └─────────────────────────────────────────────────────┘  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 7.5 ChapterList

```
┌─────────────────────────────────────────────────────────────┐
│  📖 Naruto: The Beginning                     [Analyze →]  │
├─────────────────────────────────────────────────────────────┤
│  [All] [Ch. 1-5] [Ch. 6-10] [Ch. 11-15]                  │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ☑ Chapter 1: The Boy Who Dreamed (3,450 words)          │
│  ☑ Chapter 2: The Nine-Tails (3,200 words)               │
│  ☑ Chapter 3: Forging Friends (3,800 words)               │
│  ☐ Chapter 4: [Not detected] (1 page, 500 words)          │
│  ☑ Chapter 5: The Final Exam (4,100 words)                │
│  ...                                                       │
│                                                             │
│  Selected: 14/15 chapters                                  │
│  Total words: ~51,840                                     │
│                                                             │
│  [Select All] [Deselect All]           [Start Analysis]   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 8. Zustand Store

```javascript
// stores/corpusStore.js
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export const useCorpusStore = create(
    persist(
        (set, get) => ({
            // State
            corpuses: {},              // { [corpusId]: corpusData }
            currentCorpus: null,      // Currently viewed corpus
            uploadState: 'idle',     // idle | uploading | processing | error
            uploadProgress: 0,
            uploadError: null,
            
            // Filters
            filters: {
                fandom: null,
                status: null,
                search: ''
            },
            
            // Actions
            uploadCorpus: async (file, metadata) => {
                set({ uploadState: 'uploading', uploadProgress: 0 });
                
                const formData = new FormData();
                formData.append('file', file);
                formData.append('metadata', JSON.stringify(metadata));
                
                try {
                    const response = await fetch('/api/corpus/upload', {
                        method: 'POST',
                        body: formData
                    });
                    
                    const corpus = await response.json();
                    
                    set(state => ({
                        corpuses: { ...state.corpuses, [corpus.id]: corpus },
                        currentCorpus: corpus.id,
                        uploadState: 'idle',
                        uploadProgress: 100
                    }));
                    
                    return corpus;
                } catch (error) {
                    set({ uploadState: 'error', uploadError: error.message });
                    throw error;
                }
            },
            
            getCorpus: async (corpusId) => {
                const response = await fetch(`/api/corpus/${corpusId}`);
                const corpus = await response.json();
                set(state => ({
                    corpuses: { ...state.corpuses, [corpusId]: corpus },
                    currentCorpus: corpusId
                }));
                return corpus;
            },
            
            listCorpuses: async (filters = {}) => {
                const params = new URLSearchParams(filters);
                const response = await fetch(`/api/corpus?${params}`);
                const data = await response.json();
                return data;
            },
            
            updateMetadata: async (corpusId, metadata) => {
                const response = await fetch(`/api/corpus/${corpusId}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(metadata)
                });
                const updated = await response.json();
                set(state => ({
                    corpuses: {
                        ...state.corpuses,
                        [corpusId]: { ...state.corpuses[corpusId], ...updated }
                    }
                }));
                return updated;
            },
            
            deleteCorpus: async (corpusId) => {
                await fetch(`/api/corpus/${corpusId}`, { method: 'DELETE' });
                set(state => {
                    const { [corpusId]: _, ...rest } = state.corpuses;
                    return {
                        corpuses: rest,
                        currentCorpus: state.currentCorpus === corpusId ? null : state.currentCorpus
                    };
                });
            },
            
            setFilters: (filters) => set(state => ({
                filters: { ...state.filters, ...filters }
            })),
            
            resetUpload: () => set({
                uploadState: 'idle',
                uploadProgress: 0,
                uploadError: null
            })
        }),
        {
            name: 'corpus-storage',
            partialize: (state) => ({
                // Only persist filters, not corpuses (they're in DB)
                filters: state.filters
            })
        }
    )
);
```

---

## 9. Tauri Integration

```rust
// src-tauri/src/commands/corpus.rs

#[tauri::command]
async fn read_file_content(path: String) -> Result<String, String> {
    // Đọc file từ filesystem
    std::fs::read_to_string(&path)
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_file_metadata(path: String) -> Result<FileMetadata, String> {
    let metadata = std::fs::metadata(&path)
        .map_err(|e| e.to_string())?;
    
    Ok(FileMetadata {
        size: metadata.len(),
        modified: metadata.modified()
            .map(|t| t.duration_since(UNIX_EPOCH).unwrap().as_secs())
            .unwrap_or(0),
        extension: Path::new(&path)
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_string()
    })
}
```

---

## 10. Implementation Order

### Step 1: Backend Setup
- [ ] Database schema
- [ ] Basic API routes
- [ ] Corpus CRUD operations

### Step 2: File Parsers
- [ ] TXT parser (priority - phổ biến nhất)
- [ ] EPUB parser
- [ ] PDF parser
- [ ] DOCX parser

### Step 3: Chunking Engine
- [ ] Basic chunking logic
- [ ] Paragraph preservation
- [ ] Overlap handling

### Step 4: Fandom Detector
- [ ] Pattern database
- [ ] Confidence scoring
- [ ] Auto-suggestion UI

### Step 5: Frontend Components
- [ ] UploadDropzone
- [ ] FilePreview
- [ ] MetadataEditor
- [ ] ChapterList
- [ ] CorpusCard
- [ ] CorpusList page

### Step 6: Integration
- [ ] Zustand store
- [ ] Tauri commands
- [ ] Error handling
- [ ] Loading states

---

## 11. Dependencies

```json
{
    "dependencies": {
        "epubjs": "^0.3.93",
        "pdf-parse": "^1.1.1",
        "mammoth": "^1.6.0"
    }
}
```

---

## 12. Testing Checklist

- [ ] Upload TXT file → Chapters extracted correctly
- [ ] Upload EPUB file → Metadata + chapters extracted
- [ ] Upload PDF file → Pages grouped into chapters
- [ ] Upload DOCX file → Headings used as chapter markers
- [ ] Chapter list displays correctly
- [ ] Metadata editor updates corpus
- [ ] Fandom auto-detect suggests correct fandom
- [ ] Corpus list shows all corpuses with filters
- [ ] Delete corpus removes all related data
- [ ] Large file (500k+ words) handles without crash
- [ ] Invalid file type shows error message

---

## 13. AI Configuration (Dùng cho Phase 3+)

### 13.1 Integration với Existing AI System

Dự án đã có sẵn hệ thống AI mạnh tại `src/services/ai/`:

```javascript
// Import từ router + keyManager
import modelRouter, { PROVIDERS, DIRECT_MODELS, PROXY_MODELS } from '../router.js';
import keyManager from '../keyManager.js';
```

**Cấu hình trong corpus analysis:**

```javascript
// src/services/corpus/analysisConfig.js
export const CORPUS_ANALYSIS_CONFIG = {
    provider: PROVIDERS.GEMINI_PROXY,  // Hoặc GEMINI_DIRECT, OLLAMA
    
    // Model selection
    models: {
        // Phase 1: Fast structural analysis
        structural: {
            fast: 'gemini-2.5-flash-真流-[星星公益站-CLI渠道]',
            balanced: 'gemini-3-flash-high-真流-[星星公益站-CLI渠道]',
            best: 'gemini-2.5-pro-真流-[星星公益站-CLI渠道]',
        },
        // Phase 2: Deep AI analysis
        deep: {
            fast: 'gemini-2.5-pro-真流-[星星公益站-CLI渠道]',
            balanced: 'gemini-3.1-pro-high-真流-[星星公益站-CLI渠道]',
            best: 'gemini-3.1-pro-high-真流-[星星公益站-CLI渠道]',
        },
        // Phase 3: Summary/aggregate
        summarize: {
            fast: 'gemini-2.5-flash-真流-[星星公益站-CLI渠道]',
            balanced: 'gemini-3-flash-high-真流-[星星公益站-CLI渠道]',
            best: 'gemini-2.5-pro-真流-[星星公益站-CLI渠道]',
        }
    },
    
    // Batching
    batchSize: 10,         // Chunks per batch (proxy có thể cao hơn)
    maxRetries: 3,
    retryDelay: 2000,
    
    // Context window
    contextWindow: {
        gemini_2_5: 32000,
        gemini_3_1: 64000,
        gemini_3_pro: 1000000,  // 1M context!
    }
};
```

### 13.2 Key Management & Parallel Processing

```javascript
// src/services/corpus/parallelProcessor.js

/**
 * QUAN TRỌNG về Consistency:
 * - MỖI CHUNK CHỈ PROCESS 1 LẦN (không 1 chunk × nhiều keys)
 * - Multiple keys dùng để process N CHUNKS SONG SONG
 * - Dùng temperature thấp (0.1-0.3) để giảm randomness
 */

export const PARALLEL_CONFIG = {
    maxConcurrent: 6,        // Tối đa 6 chunks song song
    maxKeysUsed: 6,          // Dùng tối đa 6 API keys
    chunkPerKey: 1,         // Mỗi key xử lý 1 chunk tại 1 thời điểm
    
    // Temperature thấp để consistency cao hơn
    temperature: 0.2,        // 0 = deterministic, 1 = creative
    topP: 0.95,
    topK: 40,
    
    // Retry logic
    maxRetries: 3,
    retryDelay: [1000, 3000, 10000],  // exponential backoff
};

// Parallel processor với multiple keys
async function processChunksParallel(chunks, analysisConfig, onProgress) {
    const keys = keyManager.getKeys(analysisConfig.provider);
    const availableKeys = keys.filter(k => !keyManager.isRateLimited(k.key));
    
    if (availableKeys.length === 0) {
        throw new Error('No available API keys');
    }
    
    // Semaphore để giới hạn concurrent requests
    const semaphore = new Semaphore(PARALLEL_CONFIG.maxConcurrent);
    const results = new Map();
    let completed = 0;
    
    const tasks = chunks.map((chunk, index) => async () => {
        await semaphore.acquire();
        try {
            // Lấy key ngẫu nhiên từ available keys
            const key = availableKeys[index % availableKeys.length];
            
            const result = await analyzeChunk(chunk, {
                ...analysisConfig,
                temperature: PARALLEL_CONFIG.temperature,
                apiKey: key.key,
            });
            
            results.set(index, result);
            completed++;
            onProgress?.(completed / chunks.length);
            
            return result;
        } catch (error) {
            if (error.includes('rate limit')) {
                keyManager.markRateLimited(key.key);
                // Retry với key khác
                const newKey = availableKeys.find(k => !keyManager.isRateLimited(k.key));
                if (newKey) {
                    return analyzeChunk(chunk, { ...analysisConfig, apiKey: newKey.key });
                }
            }
            throw error;
        } finally {
            semaphore.release();
        }
    });
    
    // Execute all tasks (sẽ tự giới hạn concurrent)
    await Promise.all(tasks.map(task => task()));
    
    // Sort results theo thứ tự chunk
    return Array.from(results.entries())
        .sort((a, b) => a[0] - b[0])
        .map(([_, result]) => result);
}
```

### 13.3 Chunk Size Configuration

```javascript
// User có thể cấu hình trước khi analyze

export const CHUNK_CONFIGS = {
    // Fast: Nhiều chunks, nhanh nhưng có thể miss details
    fast: {
        chunkWords: 500,
        overlapWords: 50,
    },
    
    // Balanced (recommended): Đủ chi tiết, tốc độ OK
    balanced: {
        chunkWords: 750,
        overlapWords: 100,
    },
    
    // Thorough: Ít chunks hơn, phân tích kỹ hơn
    thorough: {
        chunkWords: 1500,
        overlapWords: 200,
    },
    
    // Custom: User tự chọn
    custom: {
        chunkWords: null,      // User nhập số
        overlapWords: null,
    }
};

// Ví dụ:
const config = CHUNK_CONFIGS.balanced;
// 10MB file ≈ 1.5M words
// 1.5M / 750 = 2000 chunks
// 2000 chunks / 6 parallel = ~333 batches
// Mỗi batch ~10s → ~55 phút cho 10MB
```

### 13.4 Results Storage Schema

```javascript
// Database: corpus_analyses table
CREATE TABLE corpus_analyses (
    id TEXT PRIMARY KEY,
    corpus_id TEXT NOT NULL,
    chunk_config TEXT NOT NULL,      // JSON: { chunkWords, overlapWords }
    analysis_config TEXT NOT NULL,   // JSON: { provider, model, temperature }
    status TEXT DEFAULT 'pending',   // pending | processing | completed | failed
    
    // Results
    analysis_result TEXT,            // JSON: Full analysis output
    
    // Counts
    total_chunks INTEGER,
    processed_chunks INTEGER DEFAULT 0,
    failed_chunks INTEGER DEFAULT 0,
    
    // Meta
    started_at INTEGER,
    completed_at INTEGER,
    error_message TEXT,
    
    FOREIGN KEY (corpus_id) REFERENCES corpuses(id)
);

// chunk_results table (optional, cho debug)
CREATE TABLE chunk_results (
    id TEXT PRIMARY KEY,
    analysis_id TEXT NOT NULL,
    chunk_index INTEGER NOT NULL,
    chapter_id TEXT,
    input_tokens INTEGER,
    output_tokens INTEGER,
    processing_time_ms INTEGER,
    result TEXT,                     // JSON response
    error TEXT,
    
    FOREIGN KEY (analysis_id) REFERENCES corpus_analyses(id)
);
```

### 13.5 Analysis Result Format

```javascript
// Output structure sau khi analyze xong
{
    corpus_id: "corpus-uuid",
    analyzed_at: 1704067200000,
    config: {
        chunkWords: 750,
        overlapWords: 100,
        provider: "gemini_proxy",
        model: "gemini-2.5-pro-真流-[星星公益站-CLI渠道]",
        temperature: 0.2,
    },
    
    // L1: Structural (rule-based)
    l1: {
        characters: [
            { name: "Naruto", mentions: 523, firstMention: "..." },
            { name: "Sasuke", mentions: 412, ... }
        ],
        ships: [
            { char1: "Naruto", char2: "Sasuke", mentions: 89 },
            { char1: "Naruto", char2: "Sakura", mentions: 45 }
        ],
        tropes: [
            { trope: "enemies_to_lovers", instances: 3 },
            { trope: "hurt_comfort", instances: 5 }
        ],
        metadata: {
            wordCount: 152340,
            chapterCount: 15,
            pov: "third",
            tense: "past"
        }
    },
    
    // L2-L6: Deep Analysis
    l2_events: {
        major_events: [
            {
                id: "event-1",
                description: "Sasuke leaves Konoha",
                severity: "major",
                chapter: 3,
                canon_or_fanon: "canon",
                rarity: "common_but_good",
                tags: ["angst", "character_development"]
            }
        ],
        minor_events: [...]
    },
    
    l3_worldbuilding: {
        setting: { geography: [...], culture: [...], politics: {} },
        powers: { abilities: [...], hierarchy: {}, limitations: [...] },
        canonVsFanon: { canon_powers: [...], fanon_powers: [...] }
    },
    
    l4_characters: {
        "Naruto": {
            personality: { traits: [...], voice_patterns: [...] },
            motivation: { core_desire: "...", deepest_fear: "..." },
            arc: { start_state: "...", end_state: "...", stages: [...] }
        }
    },
    
    l5_relationships: {
        ships: [
            {
                type: "enemies_to_lovers",
                characters: ["Naruto", "Sasuke"],
                progression: "Ch.1(0%) → Ch.15(85%)",
                key_scenes: ["Ch.3", "Ch.7", "Ch.15"]
            }
        ],
        plot_holes: [
            { description: "...", chapter: 5, suggested_fix: "..." }
        ]
    },
    
    l6_craft: {
        style: { sentence_length_avg: 15, dialogue_ratio: 0.3, ... },
        emotional: { painful_moments: [...], happy_moments: [...] },
        pacing: { arc_structure: {...} }
    },
    
    // Summary stats
    stats: {
        total_events: 45,
        total_characters: 28,
        total_ships: 12,
        processing_time_ms: 3300000,  // 55 phút
        api_calls: 221
    }
}
```

### 13.6 Hierarchical Analysis Strategy

```
File 10MB (2000 chunks × 750 words)
           ↓
┌─────────────────────────────────────────┐
│  LEVEL 0: Individual Chunks              │
│  2000 chunks → 10/batch → 200 summaries │
│  (Model: flash, fast)                   │
└─────────────────────────────────────────┘
           ↓
┌─────────────────────────────────────────┐
│  LEVEL 1: Grouped Summaries              │
│  200 summaries → group 10 → 20 groups   │
│  (Model: flash, balanced)               │
└─────────────────────────────────────────┘
           ↓
┌─────────────────────────────────────────┐
│  LEVEL 2: Final Analysis                │
│  20 group-summaries → 1 comprehensive   │
│  (Model: pro, best)                     │
└─────────────────────────────────────────┘
```

### 13.4 Dependencies

```json
{
    "dependencies": {
        "epubjs": "^0.3.93",
        "pdf-parse": "^1.1.1",
        "mammoth": "^1.6.0",
        "@google/generativeai": "^0.21.0"
    }
}
```
