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
- `VITE_SUPABASE_URL=https://your-project.supabase.co`
- `VITE_SUPABASE_ANON_KEY=your-supabase-anon-key`
- `VITE_CLOUD_SYNC_BASE_URL=/api/cloud`

## Supabase Google OAuth redirect

Neu dang nhap Google tren localhost duoc nhung tren Vercel lai quay ve `http://localhost:3000/?code=...`, hay sua trong Supabase Dashboard:

1. Vao `Authentication -> URL Configuration`.
2. Dat `Site URL` thanh URL production, vi du `https://story-forge-virid.vercel.app`.
3. Them `Redirect URLs`:
   - `https://story-forge-virid.vercel.app`
   - `http://localhost:3000`
   - `https://*-<team-or-account-slug>.vercel.app/**` neu can Vercel preview deployment
4. Vao `Authentication -> Providers -> Google`.
5. Trong Google Cloud OAuth client, `Authorized redirect URI` phai la callback cua Supabase:
   - `https://<your-project-ref>.supabase.co/auth/v1/callback`

App mac dinh gui `redirectTo` ve domain goc hien tai, vi vay cau hinh tren chi can allow-list domain goc. Truoc khi nhay sang Google, app luu route Cloud Sync hien tai trong sessionStorage; sau khi Supabase tra ve `?code=...` o domain goc, app se tu dieu huong lai Cloud Sync.

Neu muon ep callback ve path rieng, co the dat them `VITE_CLOUD_AUTH_REDIRECT_URL`, nhung URL do phai nam trong Supabase Redirect URLs.

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
