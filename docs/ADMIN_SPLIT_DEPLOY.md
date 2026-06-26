# StoryForge Admin split deploy

## Local

User app:

```bash
npm run dev
```

Admin app:

```bash
npm run dev:admin
```

Admin API Worker:

```bash
npx wrangler dev --config apps/admin-api-worker/wrangler.toml --port 8788
```

Set these values for the admin app:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_ADMIN_API_BASE_URL`

Set these values for the admin Worker:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` with `wrangler secret put SUPABASE_SERVICE_ROLE_KEY`
- `ADMIN_ALLOWED_ORIGINS` with exact admin origins only

## Supabase schema

Admin API now uses the canonical VIP/access schema:

- `profiles`
- `plans`
- `user_plans`
- `features`
- `plan_features`
- `user_entitlement_overrides`
- `consent_versions`
- `admin_audit_logs`
- `usage_events`
- `access_versions`

Run these files in order:

```bash
docs/supabase-access-control/001_access_control_schema.sql
docs/supabase-access-control/002_access_control_seed.sql
docs/supabase-access-control/003_access_control_v2_sync_and_union_plans.sql
docs/supabase-access-control/004_add_gemini_direct_feature.sql
docs/supabase-access-control/005_site_settings.sql
```

Existing production databases that already ran `001`, `002`, and `003` only need to run `004_add_gemini_direct_feature.sql` and `005_site_settings.sql` before or alongside the code deploy. `004` adds `provider.gemini_direct` to the VIP/lifetime access catalog. `005` adds the system announcement setting used by the public app and Admin API.

The Worker verifies the Supabase user token first, resolves admin role from `profiles.system_role`, rejects non-admin mutations, and writes audit logs for sensitive changes.

## Deploy targets

- User app: Vercel, current root Vite app.
- Admin frontend: Cloudflare Pages or Workers Static Assets from `apps/admin`.
- Admin API: Cloudflare Worker from `apps/admin-api-worker`.
- AI Studio relay: existing Worker in `relay-worker`.

Admin frontend build settings:

- Build command: `npm run build:admin`
- Output directory: `apps/admin/dist`
- Root directory: repo root, or `apps/admin` with command `npm run build`

Do not deploy the repo-root `dist` folder as the admin frontend. That folder is
for the main user app and will show the wrong menu/pages for the admin URL.

## First admin bootstrap

The Admin API resolves access from `profiles.system_role`. A user with the
default `user` role will receive `403 ADMIN_PERMISSION_DENIED` from `/me` even
after Google login succeeds.

After the owner account has logged in once, promote exactly that profile:

```sql
update public.profiles
set system_role = 'owner', status = 'active'
where lower(email) = lower('owner@example.com');
```

Then verify at least one privileged profile exists:

```sql
select email, system_role, status
from public.profiles
where system_role in ('support', 'admin', 'owner');
```

## Production env checklist

User app on Vercel:

- `VITE_PROXY_URL`
- `VITE_AI_STUDIO_RELAY_URL`
- `VITE_AI_STUDIO_CONNECTOR_URL`
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_CLOUD_SYNC_BASE_URL=/api/cloud`
- `VITE_SHOW_LABS=false` unless the jobs/corpus backend is deployed.
- `VITE_SHOW_WRITING_DEBUG=false`
- `VITE_JOB_SERVER_URL` only when Labs/Job UI are enabled in production.

Admin app on Cloudflare:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_ADMIN_API_BASE_URL`

Admin API Worker:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` as a Worker secret.
- `ADMIN_ALLOWED_ORIGINS` with the exact admin frontend origin, for example `https://admin.example.com`.
  For the current Workers Static Assets deploy, include `https://storyforge-admin.canhettg113.workers.dev`.

Relay Worker:

- Keep `ALLOWED_ORIGINS` limited to the deployed user/admin origins and the required AI Studio origins.

## Checks

```bash
npm test
npm run test:admin
npm run build
npm run build:admin
npm run worker:admin:dry-run
```
