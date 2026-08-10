# Cloud Sync R2 rollout runbook

This runbook moves only the `project`, `chat`, and `prompt_bundle` Cloud Sync payloads. It does not change Story Mirror or the `storyforge-story-mirror` bucket.

## Locked architecture

- Worker: `apps/cloud-sync-worker`, deployed separately as `storyforge-cloud-sync`.
- Private Standard R2 bucket: `storyforge-cloud-sync`, binding `CLOUD_SYNC_BUCKET`; never enable `r2.dev` or public access.
- Supabase retains Auth, quota reservations, revisions, manifests, tombstones, and GC outbox.
- The browser receives no object key, R2 ETag/version, service-role key, or R2 credential.
- Object keys are immutable: `users/{userId}/snapshots/{scope}/{snapshotId}/{sha256}.json`.
- Limits remain 64 MiB per snapshot, 200 snapshots and 256 MiB per user, three pending uploads per user.

## Required secrets and variables

Worker secrets (use `wrangler secret put`; never prefix with `VITE_`):

- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_PUBLISHABLE_KEY`

Worker variables in `wrangler.toml`:

- `SUPABASE_URL` for this exact StoryForge deployment
- `CLOUD_SYNC_ALLOWED_ORIGINS` as an exact comma-separated allowlist; `*` makes the Worker fail closed
- `CLOUD_SYNC_MODE=test-only|active|read-only`
- `CLOUD_SYNC_TEST_USER_IDS` while mode is `test-only`

Client build variables:

- `VITE_CLOUD_SYNC_API_URL`
- `VITE_CLOUD_SYNC_STORAGE_MODE=hybrid` during migration
- `VITE_CLOUD_SYNC_STORAGE_MODE=r2-only` only after final reconciliation

Virid, Kohl, standby/fallback, and Cloudflare primary must each keep their own validated `VITE_SUPABASE_URL` and publishable/anon key. Never copy a key from another deployment.

All clients that use this single Cloud Sync Worker must nevertheless resolve to the same intended Supabase project ref as the Worker's `SUPABASE_URL`; the Worker verifies that exact JWT issuer and stores manifests in that exact project. If any deployment points at a different Supabase project, stop the rollout instead of copying credentials or accepting foreign issuers.

## Stage A: additive preparation

1. Run targeted tests and `npm run test:cloud-sync-postgres` against an isolated local PostgreSQL database.
2. Apply `docs/supabase-access-control/018_cloud_sync_r2_manifests.sql`. Do not alter or drop `public.cloud_snapshots`.
3. Create the private bucket and verify public development URLs are disabled.
4. Set Worker secrets and one dedicated test user ID.
5. Keep `CLOUD_SYNC_MODE=test-only`, then run `npm run worker:cloud-sync:dry-run` and deploy the Worker.
6. Use an HTTP script and the dedicated test account for: health, list, upload synthetic JSON, download, local SHA-256 comparison, delete, and GC verification. Delete all synthetic data afterward.
7. Do not run browser, production large-payload, or real-draft smoke tests.

HTTP smoke/performance command:

```text
CLOUD_SYNC_API_URL=<worker> CLOUD_SYNC_TEST_ACCESS_TOKEN=<short-lived-token> CLOUDFLARE_ACCOUNT_ID=<account> R2_ACCESS_KEY_ID=<bucket-read-key> R2_SECRET_ACCESS_KEY=<bucket-read-secret> npm run smoke:cloud-sync-r2 -- --confirm-gc
CLOUD_SYNC_API_URL=<worker> CLOUD_SYNC_TEST_ACCESS_TOKEN=<short-lived-token> npm run smoke:cloud-sync-r2 -- --performance
```

`--confirm-gc` polls R2 HEAD without printing the object key and fails if the synthetic object survives the 10-minute cron plus one-minute allowance. Use an R2 token scoped only to read this bucket for that check and revoke it afterward. `--local-load` unlocks 1 KiB, 1 MiB, 23,590,216-byte, and 64 MiB payloads, and refuses every non-local URL.

Stop if the database is at or above 475 MB, any checksum differs, GC/pending grows without clearing, 5xx is at least 1%, or list uses more than the single RPC contract.

## Stage B: backfill

The migrator reads one legacy row at a time, keeps at most one payload in memory, writes no draft payload to disk, and never logs title, slug, metadata, object key, or content.

Required local-only environment:

```text
CLOUD_SYNC_MIGRATION_DATABASE_URL
CLOUDFLARE_ACCOUNT_ID
R2_ACCESS_KEY_ID
R2_SECRET_ACCESS_KEY
CLOUD_SYNC_R2_BUCKET=storyforge-cloud-sync
CLOUD_SYNC_EXPECTED_MIN_USERS=56
CLOUD_SYNC_EXPECTED_SCOPE_COUNT=3
```

Commands:

```text
npm run migrate:cloud-sync-r2 -- --dry-run
npm run migrate:cloud-sync-r2 -- --checkpoint <local-ignored-path>
npm run migrate:cloud-sync-r2 -- --resume --checkpoint <same-local-ignored-path>
```

Use an R2 token scoped only to object read/write for this bucket and revoke it immediately after migration. A deterministic key, R2 HEAD size/checksum, and `cloud_sync_backfill_manifest` make retries safe. Tombstones and newer R2 manifests win; an object created by the current run is deleted when the database rejects it as stale/tombstoned.

Run the read-only reconciliation with the same local-only database/R2 variables:

```text
npm run reconcile:cloud-sync-r2
```

The command reports metrics only. It fails if a legacy identity lacks a matching size/SHA or winning tombstone, an R2 object fails HEAD verification, object/manifest totals differ, pending/GC is nonzero, or database size reaches 475 MB.

## Stage C: hybrid cutover

1. Change the Worker from `test-only` to `active` only after the dedicated smoke is clean.
2. Build and deploy `hybrid` in this order: standby/fallback, Virid, Kohl, Cloudflare primary.
3. New writes go only to R2. Reads prefer R2 and use legacy only when the single list RPC says an identity has neither manifest nor winning tombstone.
4. Monitor for 24 hours. Do not revoke legacy writes early.
5. After the clean 24-hour window, apply `019_cloud_sync_freeze_legacy_writes.sql`, run a delta backfill, then reconcile.

Reconciliation must prove:

- each legacy identity has matching manifest size/SHA or a winning tombstone;
- no expired pending upload remains;
- GC backlog is zero;
- sum of R2 object bytes equals sum of manifest `size_bytes`;
- all three scopes and all users are covered, with a two-user cross-read check returning 404.

Only after this evidence may clients switch to `r2-only`. Keep the verified hybrid artifact as the rollback target.

## Rollback

- Before any R2 write, the previous client/Worker can be restored.
- After R2 accepts writes, roll back only to the verified hybrid artifact. Never roll back to a direct-Supabase-only writer, which would hide newer R2 data.
- During a Worker incident, set `CLOUD_SYNC_MODE=read-only`; preserve local data and retries. Do not resume payload writes to Supabase.
- Do not drop the additive schema during an incident. Physical object deletion remains GC-only.

## Seven-day legacy retention and removal

Keep `public.cloud_snapshots` for seven full days after the `r2-only` cutover. Record database size and reconciliation daily. Before removal, create an encrypted table-only dump outside the repository and record its checksum.

After the seven-day gate passes, set the two explicit approval/cutover session variables documented in `020_cloud_sync_drop_legacy_after_7d.sql`, then apply that guarded migration. It rechecks the retention window, reconciliation, pending uploads, and GC before dropping the entire `public.cloud_snapshots` table. Do not use row-by-row `DELETE`, empty payload updates, or `VACUUM FULL`. Confirm the expected physical size reduction, keep the encrypted dump for seven additional days, then remove it through the approved recoverable deletion procedure. Tombstones expire in bounded cron batches only after the legacy table has been removed and each tombstone is at least 30 days old.
