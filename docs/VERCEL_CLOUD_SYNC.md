# Vercel and Supabase Cloud Sync

StoryForge is local-first: project data remains in IndexedDB. New Cloud Sync payloads are written to the private Cloudflare R2 bucket through the dedicated Cloud Sync Worker; Supabase Auth and small manifest/quota RPCs remain authoritative. During the seven-day hybrid window, unmigrated rows can still be read from `public.cloud_snapshots`.

## Required Vercel variables

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` for trusted Vercel API routes only
- `VITE_ENABLE_CLOUD_SYNC=true` when the Cloud Sync UI should be available
- `VITE_CLOUD_SYNC_API_URL=https://<cloud-sync-worker>` to enable the R2 path
- `VITE_CLOUD_SYNC_STORAGE_MODE=hybrid` during migration, then `r2-only` only after reconciliation passes
- `VITE_ENABLE_CLOUD_SNAPSHOT_V2=true` to write complete schema-8 project snapshots; set `false` only as a temporary writer rollback
- `VITE_ENABLE_STORY_BUNDLE=true` to expose local `.storyforge` import/export (this feature does not use Supabase)

Do not configure `VITE_CLOUD_SYNC_BASE_URL` or `STORYFORGE_DATABASE_URL`. They belonged to the retired unauthenticated `/api/cloud` implementation.

## Database setup

Existing installations first keep `docs/supabase-cloud-sync.sql` and the prior guardrails, then apply the additive R2 migration:

1. Deploy the matching client validation and wait for Vercel Production to be `Ready`.
2. `docs/supabase-access-control/011_cloud_snapshot_guardrails.sql`
3. `docs/supabase-access-control/012_validate_cloud_snapshot_guardrails.sql` outside peak hours.
4. `docs/supabase-access-control/015_cloud_snapshot_quota_and_rls.sql` to enforce the 200 snapshot / 256 MiB per-user quota and optimized RLS policies.
5. `docs/supabase-access-control/018_cloud_sync_r2_manifests.sql` before enabling the R2 Worker.

The four R2 metadata/outbox tables have RLS enabled and no direct `anon`/`authenticated` privileges. Only the dedicated Worker calls fixed-search-path, service-role-only RPCs. The client keeps uploads sequential and uses a multi-tab lock, cooldown, timeout, exact SHA-256, and progressive backoff.

The complete staged rollout, smoke, reconciliation, rollback, and seven-day deletion gate are in `docs/CLOUD_SYNC_R2_RUNBOOK.md`.

## Google OAuth redirect

Set the production Vercel origin in Supabase `Authentication -> URL Configuration`. Add preview wildcard URLs only when preview login is required. The Google OAuth callback remains the Supabase callback URL:

```text
https://<project-ref>.supabase.co/auth/v1/callback
```

## Retired endpoint

`/api/cloud` now returns `410 CLOUD_SYNC_LEGACY_RETIRED`. It must not be re-enabled or redirected to the authenticated Supabase tables because the old workspace/access-key protocol is not compatible with Supabase user ownership.

Do not remove the repository's `pg` dependency when the legacy route is cleaned up. `src/services/storage/postgres/client.js` still uses it for a separate backend storage path.
