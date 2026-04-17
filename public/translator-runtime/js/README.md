# Novel Translator Pro - Modular JavaScript

## Cấu trúc thư mục

```
js/
├── app.js                      # Entry point - Global vars, init, API key management
├── README.md                   # Documentation này
│
├── gemini/                     # Gemini Cloud API
│   ├── api.js                  # translateChunk, cleanGeminiResponse
│   └── model-rotation.js       # Model/key rotation, quota, health tracking
│
├── local-ai/                   # Local AI APIs
│   └── ollama.js               # Ollama integration
│
├── translation/                # Translation Engine
│   ├── chunker.js              # Text splitting logic
│   ├── retry.js                # Retry with backoff
│   └── engine.js               # Main translation loop
│
├── ui/                         # UI Components
│   ├── progress.js             # Progress updates, toast, download
│   ├── file-handler.js         # File upload, drag-drop
│   ├── settings.js             # Settings load/save, templates
│   └── controls.js             # Pause, cancel controls
│
└── history/                    # Translation History
    └── history.js              # History CRUD, import/export
```

## Thứ tự load (quan trọng!)

```html
<!-- 1. Main App (Global variables, init) -->
<script src="js/app.js"></script>

<!-- 2. Gemini API -->
<script src="js/gemini/model-rotation.js"></script>
<script src="js/gemini/api.js"></script>

<!-- 3. Translation Engine -->
<script src="js/translation/chunker.js"></script>
<script src="js/translation/retry.js"></script>
<script src="js/translation/engine.js"></script>

<!-- 4. UI Components -->
<script src="js/ui/progress.js"></script>
<script src="js/ui/file-handler.js"></script>
<script src="js/ui/settings.js"></script>
<script src="js/ui/controls.js"></script>

<!-- 5. History -->
<script src="js/history/history.js"></script>

<!-- 6. Local AI (Ollama) -->
<script src="js/local-ai/ollama.js"></script>
```

## Global Variables (app.js)

- `apiKeys[]` - Danh sách API keys
- `translationHistory[]` - Lịch sử dịch
- `PROMPT_TEMPLATES{}` - Các template prompt
- `GEMINI_MODELS[]` - Danh sách models
- `isTranslating`, `isPaused`, `cancelRequested` - Trạng thái
- `modelKeyHealthMap{}`, `keyHealthMap{}` - Health tracking

## Modules

### gemini/model-rotation.js
- Smart model/key rotation
- Quota tracking
- Rate limiting
- Key health management

### gemini/api.js
- `translateChunk()` - Gọi Gemini API
- `cleanGeminiResponse()` - Clean response

### translation/chunker.js
- `splitTextIntoChunks()` - Chia text thành chunks

### translation/retry.js
- `translateChunkWithRetry()` - Retry logic
- `translateLargeChunkBySplitting()` - Split large chunks

### translation/engine.js
- `startTranslation()` - Main translation loop

### ui/progress.js
- `updateProgress()`, `updateProgressStats()`
- `showToast()`, `sleep()`, `formatTime()`
- `copyResult()`, `downloadResult()`, `downloadPartial()`

### ui/file-handler.js
- File upload, drag-drop handlers
- `processFile()`, `showFileInfo()`

### ui/settings.js
- `saveSettings()`, `loadSettings()`
- `updateStats()`, `setPromptTemplate()`

### ui/controls.js
- `togglePause()`, `waitWhilePaused()`
- `confirmCancel()`, `executeCancel()`

### history/history.js
- CRUD operations cho translation history
- Import/export history

### local-ai/ollama.js
- Ollama Local API integration
- `translateWithOllama()`
- Model listing, connection testing
