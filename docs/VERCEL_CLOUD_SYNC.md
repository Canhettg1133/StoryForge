# Vercel and Supabase Cloud Sync

StoryForge is local-first: project data remains in IndexedDB, while optional cloud backups use `public.cloud_snapshots` through Supabase Auth and Row Level Security.

## Required Vercel variables

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` for trusted Vercel API routes only
- `VITE_ENABLE_CLOUD_SYNC=true` when the Cloud Sync UI should be available

Do not configure `VITE_CLOUD_SYNC_BASE_URL` or `STORYFORGE_DATABASE_URL`. They belonged to the retired unauthenticated `/api/cloud` implementation.

## Database setup

Run `docs/supabase-cloud-sync.sql`, followed by:

1. Deploy the matching client validation and wait for Vercel Production to be `Ready`.
2. `docs/supabase-access-control/011_cloud_snapshot_guardrails.sql`
3. `docs/supabase-access-control/012_validate_cloud_snapshot_guardrails.sql` outside peak hours.

RLS restricts every select/insert/update/delete to `auth.uid() = user_id`. The client keeps uploads sequential and uses a multi-tab lock, cooldown, timeout, and progressive backoff.

## Google OAuth redirect

Set the production Vercel origin in Supabase `Authentication -> URL Configuration`. Add preview wildcard URLs only when preview login is required. The Google OAuth callback remains the Supabase callback URL:

```text
https://<project-ref>.supabase.co/auth/v1/callback
```

## Retired endpoint

`/api/cloud` now returns `410 CLOUD_SYNC_LEGACY_RETIRED`. It must not be re-enabled or redirected to the authenticated Supabase tables because the old workspace/access-key protocol is not compatible with Supabase user ownership.

Do not remove the repository's `pg` dependency when the legacy route is cleaned up. `src/services/storage/postgres/client.js` still uses it for a separate backend storage path.
