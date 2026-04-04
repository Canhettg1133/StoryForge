# PHASE 1: Backend Job Queue System

## Mục tiêu

Xây dựng hệ thống job queue để AI phân tích truyện chạy **nền**, không block UI. User có thể đóng tab, job vẫn chạy và thông báo khi hoàn thành.

---

## 1. File Structure

```
src/
├── services/
│   └── jobs/
│       ├── server.js           # Express server riêng cho jobs
│       ├── jobQueue.js         # Core queue logic
│       ├── jobTypes/
│       │   ├── corpusAnalysis.js   # Analysis job
│       │   └── fileParsing.js      # Parsing job
│       ├── workers/
│       │   └── index.js        # Worker process
│       └── db/
│           ├── schema.js       # SQLite schema
│           └── queries.js      # DB queries
│
├── stores/
│   └── jobStore.js            # Zustand store cho frontend
│
├── services/
│   └── api/
│       └── jobsApi.js         # API client (gọi từ frontend)
│
src-tauri/
├── src/
│   ├── commands/
│   │   └── jobs.rs            # Tauri commands
│   └── main.rs
```

---

## 2. Database Schema (SQLite)

```sql
-- jobs table
CREATE TABLE jobs (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,           -- 'corpus_analysis', 'file_parsing'
    status TEXT NOT NULL DEFAULT 'pending',  -- pending | running | completed | failed | cancelled
    progress INTEGER DEFAULT 0,    -- 0-100
    progress_message TEXT,         -- "Analyzing chapter 3/10..."
    
    -- Input data
    input_data TEXT NOT NULL,      -- JSON: { corpusId, options, ... }
    
    -- Output data (sau khi hoàn thành)
    output_data TEXT,              -- JSON: { result, errors, ... }
    
    -- Error handling
    error_message TEXT,
    error_stack TEXT,
    
    -- Metadata
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    started_at INTEGER,
    completed_at INTEGER,
    
    -- Priority & concurrency
    priority INTEGER DEFAULT 0,
    worker_id TEXT                 -- Worker đang xử lý
);

-- Job steps (sub-tasks)
CREATE TABLE job_steps (
    id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL,
    step_name TEXT NOT NULL,
    status TEXT DEFAULT 'pending',  -- pending | running | completed | failed
    progress INTEGER DEFAULT 0,
    message TEXT,
    FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
);

-- Job dependencies
CREATE TABLE job_dependencies (
    id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL,
    depends_on_job_id TEXT NOT NULL,
    FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE,
    FOREIGN KEY (depends_on_job_id) REFERENCES jobs(id) ON DELETE CASCADE
);
```

---

## 3. API Endpoints

### 3.1 Create Job
```
POST /api/jobs
Content-Type: application/json

Request:
{
    "type": "corpus_analysis",
    "inputData": {
        "corpusId": "uuid",
        "options": {
            "layers": ["events", "characters", "worldbuilding"],
            "priority": "normal"
        }
    },
    "dependsOn": ["job-uuid-1"]  // optional
}

Response:
{
    "id": "job-uuid",
    "status": "pending",
    "createdAt": 1234567890
}
```

### 3.2 Get Job Status
```
GET /api/jobs/:id

Response:
{
    "id": "job-uuid",
    "type": "corpus_analysis",
    "status": "running",
    "progress": 45,
    "progressMessage": "Analyzing chapter 5/12",
    "steps": [
        { "name": "parse_chapters", "status": "completed", "progress": 100 },
        { "name": "extract_characters", "status": "running", "progress": 50 },
        { "name": "analyze_events", "status": "pending", "progress": 0 }
    ],
    "createdAt": 1234567890,
    "startedAt": 1234568000,
    "outputData": null
}
```

### 3.3 List Jobs
```
GET /api/jobs
GET /api/jobs?status=running
GET /api/jobs?type=corpus_analysis
GET /api/jobs?limit=20&offset=0

Response:
{
    "jobs": [...],
    "total": 45,
    "limit": 20,
    "offset": 0
}
```

### 3.4 Cancel Job
```
DELETE /api/jobs/:id

Response:
{
    "id": "job-uuid",
    "status": "cancelled"
}
```

### 3.5 Get Job Progress (SSE)
```
GET /api/jobs/:id/progress
Content-Type: text/event-stream

Event types:
- progress: { "progress": 45, "message": "..." }
- step_complete: { "step": "extract_characters" }
- error: { "message": "...", "stack": "..." }
- complete: { "outputData": {...} }
- cancelled
```

---

## 4. Core Queue Logic (jobQueue.js)

### 4.1 Job Lifecycle States

```
                    ┌─────────────┐
                    │   pending   │ ◄─── Được tạo, chờ worker
                    └──────┬──────┘
                           │
              ┌────────────┼────────────┐
              │            │            │
              ▼            ▼            ▼
        ┌──────────┐ ┌──────────┐ ┌──────────┐
        │ running  │ │ cancelled│ │ failed   │
        └────┬─────┘ └──────────┘ └────┬─────┘
             │                        │
             │      ┌──────────┐       │
             ├─────►│completed │◄──────┘
             │      └──────────┘
             │           ▲
             │           │ (after all retries)
             └───────────┘
                   (final)
```

### 4.2 Concurrency Control

```javascript
// Config
MAX_CONCURRENT_JOBS = 2;        // Tối đa 2 job cùng chạy
MAX_CONCURRENT_ANALYSIS = 1;   // Chỉ 1 analysis cùng lúc (nặng)
MAX_QUEUE_SIZE = 100;          // Tối đa 100 job trong queue

// Priority levels
PRIORITY = {
    LOW: 0,
    NORMAL: 1,
    HIGH: 2,
    CRITICAL: 3
};
```

### 4.3 Retry Logic

```javascript
// Config
MAX_RETRIES = 3;
RETRY_DELAYS = [1000, 5000, 30000]; // Exponential backoff (ms)

// Retry conditions
RETRY_ON_ERRORS = [
    'ECONNRESET',
    'ETIMEDOUT',
    'AI_RATE_LIMIT',
    'AI_SERVICE_UNAVAILABLE'
];

// Never retry
NO_RETRY_ERRORS = [
    'INVALID_INPUT',
    'FILE_NOT_FOUND',
    'UNAUTHORIZED'
];
```

### 4.4 Worker Assignment

```javascript
// Worker pool
WORKERS = [
    { id: 'worker-1', status: 'idle', currentJob: null },
    { id: 'worker-2', status: 'idle', currentJob: null }
];

// Auto-assign when job available and worker idle
function assignJobToWorker(job, worker) {
    job.status = 'running';
    job.worker_id = worker.id;
    job.started_at = Date.now();
    worker.status = 'busy';
    worker.currentJob = job.id;
}
```

---

## 5. Worker Implementation

### 5.1 Worker Process

```javascript
// workers/index.js
class JobWorker {
    constructor(workerId) {
        this.workerId = workerId;
        this.isProcessing = false;
        this.currentJob = null;
    }

    async start() {
        // Main loop
        while (true) {
            const job = await this.getNextJob();
            if (job) {
                await this.processJob(job);
            } else {
                // Wait before next poll
                await this.sleep(1000);
            }
        }
    }

    async processJob(job) {
        this.isProcessing = true;
        this.currentJob = job;

        try {
            // Update status
            await db.updateJob(job.id, { status: 'running', worker_id: this.workerId });

            // Get appropriate handler
            const handler = this.getHandler(job.type);
            
            // Process with progress updates
            await handler(job, (progress, message) => {
                this.sendProgress(job.id, progress, message);
            });

            // Mark complete
            await db.updateJob(job.id, {
                status: 'completed',
                completed_at: Date.now(),
                progress: 100
            });

            // Notify via WebSocket
            this.notifyComplete(job.id);

        } catch (error) {
            await this.handleError(job, error);
        } finally {
            this.isProcessing = false;
            this.currentJob = null;
        }
    }
}
```

### 5.2 Corpus Analysis Handler

```javascript
// jobTypes/corpusAnalysis.js
async function processCorpusAnalysisJob(job, onProgress) {
    const { corpusId, options } = job.inputData;
    const corpus = await db.getCorpus(corpusId);
    const chapters = await db.getChapters(corpusId);

    const steps = [
        { name: 'parse_chapters', weight: 10 },
        { name: 'extract_characters', weight: 20 },
        { name: 'extract_events', weight: 30 },
        { name: 'analyze_worldbuilding', weight: 20 },
        { name: 'analyze_relationships', weight: 10 },
        { name: 'analyze_craft', weight: 10 }
    ];

    let completedWeight = 0;

    for (const step of steps) {
        onProgress(completedWeight, `Starting ${step.name}...`);
        
        // Create step record
        await db.createStep(job.id, step.name);

        // Execute step
        const result = await executeStep(step.name, corpus, chapters, options, (subProgress) => {
            const stepProgress = completedWeight + (step.weight * subProgress / 100);
            onProgress(stepProgress, `${step.name}: ${subProgress}%`);
        });

        await db.updateStep(job.id, step.name, { status: 'completed', progress: 100 });
        completedWeight += step.weight;
    }

    return { analysisComplete: true };
}
```

---

## 6. Frontend Integration

### 6.1 JobStore (Zustand)

```javascript
// stores/jobStore.js
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { jobsApi } from '../services/api/jobsApi';

export const useJobStore = create(
    persist(
        (set, get) => ({
            // State
            jobs: {},              // { [jobId]: jobData }
            activeJobs: [],        // IDs of running jobs
            jobHistory: [],        // Recent completed jobs
            eventSource: null,     // SSE connection

            // Actions
            createJob: async (type, inputData) => {
                const job = await jobsApi.create(type, inputData);
                set(state => ({
                    jobs: { ...state.jobs, [job.id]: job },
                    activeJobs: [...state.activeJobs, job.id]
                }));
                get().subscribeToJob(job.id);
                return job;
            },

            subscribeToJob: (jobId) => {
                const es = jobsApi.subscribeProgress(jobId);
                es.onmessage = (event) => {
                    const data = JSON.parse(event.data);
                    get().handleJobUpdate(jobId, data);
                };
                es.onerror = () => {
                    // Reconnect after delay
                    setTimeout(() => get().subscribeToJob(jobId), 5000);
                };
            },

            handleJobUpdate: (jobId, data) => {
                set(state => ({
                    jobs: {
                        ...state.jobs,
                        [jobId]: { ...state.jobs[jobId], ...data }
                    }
                }));

                if (data.type === 'complete') {
                    get().handleJobComplete(jobId);
                }
            },

            handleJobComplete: (jobId) => {
                // Show notification
                if (Notification.permission === 'granted') {
                    new Notification('Job Complete', {
                        body: `Analysis finished: ${get().jobs[jobId]?.progressMessage}`
                    });
                }

                set(state => ({
                    activeJobs: state.activeJobs.filter(id => id !== jobId),
                    jobHistory: [jobId, ...state.jobHistory].slice(0, 50)
                }));
            },

            cancelJob: async (jobId) => {
                await jobsApi.cancel(jobId);
                set(state => ({
                    activeJobs: state.activeJobs.filter(id => id !== jobId)
                }));
            },

            clearHistory: () => set({ jobHistory: [] })
        }),
        {
            name: 'job-storage',
            partialize: (state) => ({ jobHistory: state.jobHistory })
        }
    )
);
```

### 6.2 IndexedDB Persistence

```javascript
// services/db/indexedDB.js
// Lưu job state để offline-ready

const DB_NAME = 'storyforge-jobs';
const STORE_NAME = 'jobs';

async function saveJobToIndexedDB(job) {
    const db = await openDB();
    await db.put(STORE_NAME, job);
}

async function getJobFromIndexedDB(jobId) {
    const db = await openDB();
    return db.get(STORE_NAME, jobId);
}

async function getAllJobsFromIndexedDB() {
    const db = await openDB();
    return db.getAll(STORE_NAME);
}
```

---

## 7. Tauri Integration

### 7.1 Rust Commands

```rust
// src-tauri/src/commands/jobs.rs

#[tauri::command]
async fn start_job_server(app: AppHandle) -> Result<(), String> {
    // Spawn job server as separate process/thread
    // Port: 3847 (configurable)
}

#[tauri::command]
async fn submit_analysis_job(
    app: AppHandle,
    corpus_id: String,
    options: AnalysisOptions
) -> Result<String, String> {
    // Gọi API local để tạo job
    let client = reqwest::Client::new();
    let response = client
        .post("http://localhost:3847/api/jobs")
        .json(&body)
        .send()
        .await?;
}

#[tauri::command]
async fn get_job_status(job_id: String) -> Result<JobStatus, String> {
    let client = reqwest::Client::new();
    let response = client
        .get(&format!("http://localhost:3847/api/jobs/{}", job_id))
        .send()
        .await?;
}

#[tauri::command]
async fn cancel_job(job_id: String) -> Result<(), String> {
    let client = reqwest::Client::new();
    client
        .delete(&format!("http://localhost:3847/api/jobs/{}", job_id))
        .send()
        .await?;
}
```

### 7.2 Main.rs Registration

```rust
// src-tauri/src/main.rs
mod commands;
mod jobs;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            commands::jobs::start_job_server,
            commands::jobs::submit_analysis_job,
            commands::jobs::get_job_status,
            commands::jobs::cancel_job,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

---

## 8. UI Components (Frontend)

### 8.1 Job Progress Panel

```
┌─────────────────────────────────────────────────────────────┐
│  📋 JOB QUEUE                                    [Clear]  │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────────────────────────────────────────────┐  │
│  │ 🔄 Analyzing "Naruto Fanfic Collection"             │  │
│  │    ████████████░░░░░░░░  58%                        │  │
│  │    Extracting events: 78%                          │  │
│  │    [Cancel]                                        │  │
│  └─────────────────────────────────────────────────────┘  │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐  │
│  │ ⏳ Parsing "One Piece Chapters"                    │  │
│  │    Waiting in queue (2/3)                          │  │
│  │    [Cancel]                                        │  │
│  └─────────────────────────────────────────────────────┘  │
│                                                             │
│  ──────────────────────────────────────────────────────── │
│                                                             │
│  Completed (Recent)                                         │
│  ✓ "Harry Potter Analysis" - 2 min ago                     │
│  ✓ "Naruto Character Profile" - 5 min ago                  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 8.2 Notification Toast

```
┌─────────────────────────────────────────────────────────────┐
│  🔔 Job Complete!                                          │
│     "Naruto Fanfic Analysis" finished successfully          │
│     [View Results]  [Dismiss]                              │
└─────────────────────────────────────────────────────────────┘
```

---

## 9. Implementation Order

### Step 1: Database & Server Setup
- [ ] Create SQLite database schema
- [ ] Setup Express server with routes
- [ ] Implement basic CRUD operations

### Step 2: Queue Logic
- [ ] Implement job queue with priority
- [ ] Add concurrency control
- [ ] Implement retry logic

### Step 3: Worker System
- [ ] Create worker process
- [ ] Implement job handlers
- [ ] Add progress tracking

### Step 4: Real-time Updates
- [ ] Setup WebSocket/SSE for progress
- [ ] Implement SSE endpoint
- [ ] Add reconnection logic

### Step 5: Frontend Integration
- [ ] Create Zustand JobStore
- [ ] Implement IndexedDB persistence
- [ ] Build UI components
- [ ] Add notifications

### Step 6: Tauri Integration
- [ ] Create Rust commands
- [ ] Wire up Tauri handlers
- [ ] Test desktop flow

---

## 10. Testing Checklist

- [ ] Create job → Returns job ID
- [ ] Get job status → Returns correct progress
- [ ] List jobs → Returns all jobs with pagination
- [ ] Cancel job → Job status changes to cancelled
- [ ] Progress updates → SSE sends updates
- [ ] Reconnection → SSE reconnects after disconnect
- [ ] Notification → Browser notification appears
- [ ] Persistence → Jobs persist after page refresh
- [ ] Background running → Job continues after tab close
- [ ] Concurrency → Only max jobs run at once
- [ ] Retry → Failed job retries with backoff

---

## 11. Configuration

```javascript
// src/services/jobs/config.js
export const JOB_CONFIG = {
    // Server
    PORT: 3847,
    
    // Concurrency
    MAX_CONCURRENT_JOBS: 2,
    MAX_CONCURRENT_ANALYSIS: 1,
    MAX_QUEUE_SIZE: 100,
    
    // Retry
    MAX_RETRIES: 3,
    RETRY_DELAYS: [1000, 5000, 30000],
    
    // SSE
    SSE_RECONNECT_DELAY: 5000,
    
    // Cleanup
    KEEP_COMPLETED_JOBS_DAYS: 7,
    KEEP_FAILED_JOBS_DAYS: 30,
    
    // API
    API_TIMEOUT: 30000,
};
```

---

## 12. Error Handling

| Error Type | Behavior |
|------------|----------|
| AI Rate Limit | Retry with backoff |
| AI Service Down | Retry with backoff |
| Invalid Input | Fail immediately, no retry |
| File Not Found | Fail immediately, no retry |
| Network Error | Retry with backoff |
| Worker Crash | Auto-restart, job remains "running" until timeout |

---

## 13. Future Enhancements (Out of Scope for Phase 1)

- [ ] Job scheduling (run at specific time)
- [ ] Job templates (reusable job configurations)
- [ ] Webhook notifications (for external integrations)
- [ ] Job categories/folders
- [ ] Batch operations (run multiple jobs together)
