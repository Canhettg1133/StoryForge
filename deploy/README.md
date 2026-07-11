# StoryForge Deploy Checklist

Muc tieu: deploy nhanh StoryForge sang Vercel account moi, dung GitHub `main`, Supabase cu, va it thao tac nhat.

Voi dot security rollout hien tai, bat buoc lam theo `docs/SECURITY_DEPLOY_HANDOFF.md` truoc tai lieu nay.

## Trang thai hien tai

- GitHub repo: `Canhettg1133/StoryForge`
- Branch deploy: `main`
- Framework: `Vite`
- Root Directory: `./`
- Build Command: `npm run build`
- Output Directory: `dist`
- Install Command: `npm install`
- Supabase project ref: `mjeuajnswqyuerztsncz`
- Supabase dashboard: `https://supabase.com/dashboard/project/mjeuajnswqyuerztsncz`
- Cloud Sync: Supabase Auth/RLS table `public.cloud_snapshots`

## File env dung de import vao Vercel

Dung file local nay:

```text
deploy/vercel.env.production.local
```

File nay can co cac bien production sau:

```env
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
VITE_ENABLE_CLOUD_SYNC
VITE_SHOW_LABS
VITE_SHOW_JOB_UI
VITE_SHOW_WRITING_DEBUG
```

Khong commit file env nay. Thu muc `deploy/.gitignore` da chan `*.local`, `*.env`, va `*.env.*`.

## Cach deploy nhanh tren Vercel UI

1. Vao Vercel account moi.
2. New Project.
3. Import GitHub repo `Canhettg1133/StoryForge`.
4. Chon Team/account moi.
5. Project name: `story-forge`.
6. Framework Preset: `Vite`.
7. Root Directory: `./`.
8. Mo `Build and Output Settings`, dat:

```text
Build Command: npm run build
Output Directory: dist
Install Command: npm install
```

9. Mo `Environment Variables`.
10. Bam `Import .env`.
11. Dan noi dung file `deploy/vercel.env.production.local`.
12. Environment: chon `Production and Preview`.
13. Kiem tra co `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`; khong import `VERCEL_*`, `TURBO_*`, `NX_DAEMON`, `STORYFORGE_DATABASE_URL` hoac `VITE_CLOUD_SYNC_BASE_URL`.
14. Bam `Deploy`.

## Sau khi deploy xong

Lay URL moi dang:

```text
https://story-forge-xxxxx.vercel.app
```

Sau do can cap nhat 2 noi:

### 1. Supabase Auth Redirect URLs

Vao Supabase dashboard:

```text
Authentication -> URL Configuration
```

Them URL production moi vao redirect allow-list:

```text
https://story-forge-xxxxx.vercel.app
```

Neu can preview deploy login duoc, them wildcard theo slug Vercel moi:

```text
https://*-<new-vercel-team-or-account-slug>.vercel.app/**
```

Site URL nen dat thanh URL production moi neu muon account moi la production chinh.

### 2. Cloudflare Worker CORS

Can them URL Vercel moi vao:

```text
relay-worker/wrangler.toml
```

Bien can sua:

```text
ALLOWED_ORIGINS
```

Neu deploy admin rieng, them admin origin vao:

```text
apps/admin-api-worker/wrangler.toml
```

Truoc khi deploy Admin API Worker co chuc nang thong bao he thong, chay migration:

```text
docs/supabase-access-control/005_site_settings.sql
```

Sau khi sua va migration xong, chay:

```powershell
npm run worker:relay:dry-run
npm run worker:admin:dry-run
npx wrangler deploy --config relay-worker/wrangler.toml
npx wrangler deploy --config apps/admin-api-worker/wrangler.toml
```

## Kiem tra sau deploy

Mo URL moi va kiem tra:

1. App load duoc dashboard/login.
2. Supabase Google login quay ve dung domain moi.
3. Cloud Sync dang nhap bang Supabase va chi hien snapshot cua user hien tai.
4. VIP/access API khong bao thieu Supabase admin config.
5. AI proxy/translator khong bi CORS khi goi qua domain moi.

## Lenh local da xac minh

```powershell
npm run build
npm run build:admin
npm run worker:admin:dry-run
npm run worker:relay:dry-run
npm run test:admin
npx vercel build --prod
```

Build production se dung som neu thieu `VITE_SUPABASE_URL` hoac `VITE_SUPABASE_ANON_KEY`.
