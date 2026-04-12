# Vercel Cloud Sync

StoryForge hien tai chay theo kieu local-first:

- Du lieu viet truyen va codex nam trong IndexedDB (Dexie) tren trinh duyet.
- Cloud Sync la lop backup/restore theo snapshot toan project.
- Backend web la Vercel Function `api/cloud.js`.

## Bien moi truong

- `STORYFORGE_DATABASE_URL`
- hoac `POSTGRES_URL`
- hoac `DATABASE_URL`
- hoac `SUPABASE_DB_URL`

Frontend:

- `VITE_SHOW_LABS=false`
- `VITE_SHOW_ROADMAP_PAGES=false`
- `VITE_SHOW_JOB_UI=false`
- `VITE_ENABLE_CLOUD_SYNC=true`
- `VITE_CLOUD_SYNC_BASE_URL=/api/cloud`

## Cac buoc deploy

1. Tren Vercel, gan mot Postgres integration tu Marketplace.
2. Bao dam project co env URL cho Postgres.
3. Deploy app.
4. Vao `Settings -> Cloud Sync`.
5. Nhap `workspace slug` va `access key`.
6. Backup local project len cloud.
7. Khi can, restore snapshot cloud thanh project moi trong may.

## Gioi han hien tai

- Chua co auth day du; `access key` la lop bao ve toi thieu.
- Restore tao project moi, khong ghi de len project local cu.
- Snapshot lon hon khoang 4 MB se bi tu choi boi function hien tai.
