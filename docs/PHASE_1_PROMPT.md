# PROMPT: Implement Phase 1 - Job Queue System

> Archival note (2026-04-06): This document records the original plan. The current runtime has been migrated to a PostgreSQL-only backend, so SQLite references below are historical only.

## Project Context
- App: StoryForge - Writing tool for fanfiction writers
- Tech: Tauri (Rust) + React + Express backend (Node.js)
- Goal: Background job processing for AI story analysis

---

## Task
Implement **Phase 1: Backend Job Queue System** - cho phép AI phân tích truyện chạy nền, không block UI. User đóng tab vẫn chạy.

---

## Required Files to Create

### Backend (Express + SQLite)
```
src/services/jobs/
├── config.js           # Config: port 3847, concurrency, retry settings
├── server.js           # Express server entry point
├── jobQueue.js         # Core queue logic (priority, concurrency, retry)
├── db/
│   ├── schema.js       # SQLite: jobs, job_steps, job_dependencies tables
│   └── queries.js      # CRUD queries
├── workers/
│   └── index.js        # Worker class (poll queue, process job)
├── jobTypes/
│   ├── corpusAnalysis.js  # Placeholder handler ( stubs OK for Phase 1)
│   └── fileParsing.js     # Placeholder handler (stubs OK)
└── routes/
    └── jobs.js         # Routes: POST/GET/DELETE /api/jobs
```

### Frontend (React + Zustand)
```
src/stores/
└── jobStore.js        # Zustand store: createJob, subscribeToJob, cancelJob

src/services/api/
└── jobsApi.js         # API client gọi backend
```

### Tauri (Rust)
```
src-tauri/src/commands/
└── jobs.rs            # Tauri commands: start_job_server, submit_job, get_status, cancel_job

src-tauri/src/main.rs  # Register commands
```

---

## Database Schema (SQLite)

```sql
CREATE TABLE jobs (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,           -- 'corpus_analysis', 'file_parsing'
    status TEXT DEFAULT 'pending', -- pending|running|completed|failed|cancelled
    progress INTEGER DEFAULT 0,    -- 0-100
    progress_message TEXT,
    input_data TEXT NOT NULL,     -- JSON
    output_data TEXT,
    error_message TEXT,
    error_stack TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    started_at INTEGER,
    completed_at INTEGER,
    priority INTEGER DEFAULT 0,
    worker_id TEXT
);

CREATE TABLE job_steps (
    id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL,
    step_name TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    progress INTEGER DEFAULT 0,
    message TEXT,
    FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
);

CREATE TABLE job_dependencies (
    id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL,
    depends_on_job_id TEXT NOT NULL
);
```

---

## API Endpoints

| Method | Endpoint | Mô tả |
|--------|----------|--------|
| POST | /api/jobs | Tạo job mới |
| GET | /api/jobs/:id | Lấy trạng thái job |
| GET | /api/jobs | List jobs (filter: ?status=running, ?type=xxx, ?limit=20&offset=0) |
| DELETE | /api/jobs/:id | Cancel job |
| GET | /api/jobs/:id/progress | SSE stream (event: progress, step_complete, error, complete, cancelled) |

### Request/Response Examples

**POST /api/jobs**
```json
// Request
{ "type": "corpus_analysis", "inputData": { "corpusId": "uuid", "options": {} }, "dependsOn": [] }

// Response
{ "id": "job-uuid", "status": "pending", "createdAt": 1234567890 }
```

**GET /api/jobs/:id**
```json
{ "id": "job-uuid", "type": "corpus_analysis", "status": "running", "progress": 45, "progressMessage": "...", "steps": [...], "createdAt": 123, "startedAt": 124, "outputData": null }
```

---

## Queue Logic Requirements

- **Concurrency**: Max 2 jobs cùng lúc, max 1 analysis cùng lúc
- **Priority**: LOW=0, NORMAL=1, HIGH=2, CRITICAL=3
- **Retry**: Max 3 retries với exponential backoff [1s, 5s, 30s]
- **Retry on**: ECONNRESET, ETIMEDOUT, AI_RATE_LIMIT, AI_SERVICE_UNAVAILABLE
- **No retry**: INVALID_INPUT, FILE_NOT_FOUND, UNAUTHORIZED

---

## Worker Flow

```
Worker.start() → loop:
  1. getNextJob() → poll DB for pending job (priority order)
  2. Nếu có job → processJob(job):
     - Update status = 'running'
     - Execute handler (corpusAnalysis / fileParsing)
     - Progress callback → send SSE
     - On success: status = 'completed'
     - On error: retry logic hoặc status = 'failed'
  3. Nếu không có job → sleep 1s rồi lặp lại
```

---

## Zustand Store (Frontend)

```javascript
// State
jobs: {},           // { [jobId]: jobData }
activeJobs: [],     // IDs đang chạy
jobHistory: [],     // IDs đã xong (recent)

// Actions
createJob(type, inputData)      // Tạo job + subscribe SSE
subscribeToJob(jobId)           // SSE connection + handle updates
handleJobUpdate(jobId, data)    // Update store khi có SSE event
handleJobComplete(jobId)        // Show notification + cleanup
cancelJob(jobId)                // Gọi DELETE API

// Persist: jobHistory vào localStorage
```

---

## Tauri Commands (Rust)

```rust
#[tauri::command] async fn start_job_server() -> Result<(), String>
#[tauri::command] async fn submit_analysis_job(corpus_id: String, options: Value) -> Result<String, String>
#[tauri::command] async fn get_job_status(job_id: String) -> Result<Value, String>
#[tauri::command] async fn cancel_job(job_id: String) -> Result<(), String>
```

Commands gọi Express backend ở localhost:3847 (hoặc port configurable).

---

## Config (src/services/jobs/config.js)

```javascript
export const JOB_CONFIG = {
    PORT: 3847,
    MAX_CONCURRENT_JOBS: 2,
    MAX_CONCURRENT_ANALYSIS: 1,
    MAX_QUEUE_SIZE: 100,
    MAX_RETRIES: 3,
    RETRY_DELAYS: [1000, 5000, 30000],
    SSE_RECONNECT_DELAY: 5000,
    KEEP_COMPLETED_JOBS_DAYS: 7,
    KEEP_FAILED_JOBS_DAYS: 30,
    API_TIMEOUT: 30000,
};
```

---

## Implementation Order

1. **Database**: SQLite schema + queries
2. **Server**: Express setup + routes
3. **Queue**: Job queue logic + worker
4. **SSE**: Progress streaming endpoint
5. **Frontend**: Zustand store + API client
6. **Tauri**: Rust commands wiring

---

## Notes
- Job handlers (corpusAnalysis, fileParsing) chỉ cần placeholder/stub cho Phase 1
- SSE dùng Server-Sent Events (không cần WebSocket)
- Frontend có thể gọi API trực tiếp (không cần qua Tauri) nếu CORS allow
- Tauri commands là optional cho Phase 1 nếu frontend gọi API trực tiếp

---

## Test Checklist
- [ ] POST /api/jobs → Returns job ID
- [ ] GET /api/jobs/:id → Returns correct progress
- [ ] GET /api/jobs → List jobs with pagination
- [ ] DELETE /api/jobs/:id → Status = cancelled
- [ ] SSE /api/jobs/:id/progress → Sends events
- [ ] Concurrency → Only max jobs run at once
- [ ] Zustand store → Updates on SSE events
