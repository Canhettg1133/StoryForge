# 08 - Tech Stack & Build Timeline

## Current Tech Stack

### Option A: Web App

| Thanh phan | Cong nghe | Ghi chu |
|-----------|-----------|---------|
| Frontend | Vite + React | UI chinh cua ung dung |
| Editor | Tiptap | Rich text editor |
| Frontend local storage | IndexedDB (Dexie) + localStorage | Luu du lieu editor, codex, UI state o may nguoi dung |
| Backend runtime storage | PostgreSQL | Source of truth cho jobs, corpus, analyses, review queue, project snapshots |
| AI calls | Fetch + streaming APIs | Ho tro proxy/direct/local providers |
| Export | EPUB, DOCX, PDF, Markdown, Plain text | Phuc vu xuat ban va chia se |
| Deploy | Frontend + jobs server + PostgreSQL | Jobs/analysis backend can `DATABASE_URL` |

### Option B: Desktop App

| Thanh phan | Cong nghe | Ghi chu |
|-----------|-----------|---------|
| Framework | Electron + React hoac Tauri | Co the tan dung UI hien tai |
| Editor | Tiptap | Giong web app |
| Loi the | Local-first UX | Van can PostgreSQL neu muon chay backend jobs/analysis day du |

## Current Architecture Note

- Frontend van su dung Dexie/IndexedDB cho local authoring data.
- Backend jobs, analysis, corpus snapshots, project snapshots da la Postgres-only.
- Jobs server khong con fallback SQLite va se fail-fast neu thieu `DATABASE_URL`.

## Build Timeline

Xem roadmap tong the tai [07-mvp-roadmap.md](./07-mvp-roadmap.md).

## Notes

- Proxy AI van co the duoc dat rieng, nhung backend jobs/analysis hien la mot runtime rieng voi PostgreSQL.
- Neu chi dung editor local, frontend co the chay doc lap.
- Neu dung corpus analysis, incident analysis, review queue, hoac jobs streaming, can chay jobs server cung PostgreSQL.
