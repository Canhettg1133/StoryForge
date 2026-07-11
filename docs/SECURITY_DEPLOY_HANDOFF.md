# Security deploy handoff

This file is the deployment contract for the current security changes. The
code may be prepared locally, but deployment must remain staged and reversible.

## Scope exclusions

- Do not deploy or change Zalo components.
- Do not deploy or change AI Studio Relay/Connector components.
- Run the Story Mirror Worker dry-run only. Do not deploy it unless a reviewed
  Story Mirror diff is present.

## Non-negotiable rules

1. Never force-push `main`.
2. Fetch `origin` and require local `HEAD` to still match `origin/main` before
   committing. If the remote moved, integrate it and rerun every gate.
3. Never commit tokens, database URLs, service-role keys, `.env.local`, Vercel
   metadata, or Supabase credentials.
4. Keep these Vercel Production variables:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
5. Do not remove `pg` from `package.json`. The non-legacy Postgres storage
   client still imports it from `src/services/storage/postgres/client.js`.
6. Do not run large-payload load tests against production Supabase.
7. Do not deploy the repo-root `dist` folder to Admin Pages. Admin Pages must
   receive `apps/admin/dist` only.

## Required local gates

Run from the repository root:

```powershell
npm test
npm run build
npm run build:admin
npm run worker:admin:dry-run
npx wrangler deploy --config apps/story-mirror-worker/wrangler.toml --dry-run
npm audit --omit=dev
git diff --check
git status --short
```

Before the user and admin builds, verify the required variables exist without
printing their values. The user build requires `VITE_SUPABASE_URL` and
`VITE_SUPABASE_ANON_KEY`. The admin build also requires
`VITE_ADMIN_API_BASE_URL` and it must target
`https://storyforge-admin-api.canhettg113.workers.dev`.

For the final Vercel artifact, pull Production variables into an ignored file,
verify the required variable names, then run:

```powershell
vercel build --prod
```

This is the Linux/Node 24/Vercel Functions/build-environment gate.

## CSP rollout and custom proxy compatibility

The current `vercel.json` intentionally keeps the strict policy in
`Content-Security-Policy-Report-Only`. The enforced CSP contains only the
baseline `frame-ancestors`, `object-src`, and `base-uri` protections.

Do not copy the strict policy into the enforced header in this deployment.
First deploy a preview and manually verify:

- Custom Proxy with a real remote `https://` endpoint.
- Gemini Proxy AG with its configured HTTPS endpoint.
- Custom Proxy model listing and connection test.
- Ollama through `http://localhost:*` or `http://127.0.0.1:*`.
- Translator buttons, key import/export, Enter-to-add, drag/drop, history,
  resume, and downloads.
- Browser console and network tab for CSP, CORS, mixed-content, and 4xx/5xx
  failures.

The report-only `connect-src` permits all `https:` and `wss:` destinations plus
HTTP/WS loopback for local services. A remote plain-HTTP proxy is not a safe
production target on an HTTPS page and may also be blocked by browser mixed
content rules independently of CSP.

Only after the preview is clean should strict CSP enforcement be a separate,
reviewed commit. A CSP rollback must not roll back the Translator XSS fix.

## Supabase production order

Confirm the project ref and host are exactly:

```text
mjeuajnswqyuerztsncz
https://mjeuajnswqyuerztsncz.supabase.co
```

Then use this order:

1. Run a read-only preflight for function signatures, owners, current ACLs,
   Cloud Sync row counts, and guardrail violations.
2. Apply `docs/supabase-access-control/010_lock_down_security_definer_rpc.sql`.
3. Run `docs/supabase-access-control/verify_010_security_definer_acl.sql`.
   Every `acl_matches` result must be `true`.
4. Probe the read-only admin ranking RPC through the service-role Admin API.
   Browser roles must remain denied. Never restore `PUBLIC` execute access.
5. Deploy the user client and wait until Vercel Production is `Ready`.
6. Apply `docs/supabase-access-control/011_cloud_snapshot_guardrails.sql`.
   It uses `NOT VALID`: new writes are checked without first scanning every
   existing payload.
7. Apply `docs/supabase-access-control/012_validate_cloud_snapshot_guardrails.sql`
   outside peak hours. Respect its lock and statement timeouts.

The client keeps Cloud Sync imports sequential with concurrency `1`, validates
all import items before the first database request, and lists existing metadata
without downloading every existing payload.

## Vercel production order

1. Confirm the linked project is `story-forge` and the owner is correct.
2. Confirm the three required Supabase variables are present in Production.
3. Run all gates, including `vercel build --prod`.
4. Commit with Anh Dat's configured Git identity.
5. Push directly to `origin/main` without force.
6. Poll the Git-linked deployment for that exact commit until `Ready`.
7. Verify the production alias `https://story-forge-virid.vercel.app` points to
   that deployment.

If Git Integration does not create a deployment or reports an author/permission
problem, keep the GitHub commit and use the logged-in Vercel owner account:

```powershell
vercel build --prod
vercel deploy --prebuilt --prod
```

After the production tombstone responds with HTTP `410` and code
`CLOUD_SYNC_LEGACY_RETIRED`, remove these two legacy variables from Vercel
Production only:

- `STORYFORGE_DATABASE_URL`
- `VITE_CLOUD_SYNC_BASE_URL`

Do not remove the Supabase variables. Do not delete `cloudSyncClient.js`, the
legacy table, or other compatibility code until at least seven days of evidence
show no consumer. The `pg` dependency must remain because other backend code
uses it.

## Admin Cloudflare order

Admin deployment happens only after migration `010` and its ACL verification:

1. Run `npm run build:admin` from the repository root.
2. Run `npm run worker:admin:dry-run`.
3. Confirm the Worker secret `SUPABASE_SERVICE_ROLE_KEY` and the
   `STORY_MIRROR_BUCKET` R2 binding exist.
4. Deploy only `apps/admin-api-worker/wrangler.toml`.
5. Upload only `apps/admin/dist` to the Cloudflare Pages project
   `storyforge-admin`, branch `main`, and attach the Git commit SHA.
6. Verify unauthenticated requests return `401` or `403`, never
   `ADMIN_ENV_MISSING`.
7. Verify an admin can read usage rankings and update the announcement, and
   that the audit log is written.
8. Verify CORS accepts only the configured Admin Pages origin.

## Rollback boundaries

- User web failure: roll the Vercel production alias back to the prior Ready
  deployment.
- CSP-only failure: restore the report-only rollout; do not revert XSS fixes.
- Admin Pages failure: roll back to the previous Pages deployment.
- Admin Worker failure: roll back the Worker version; do not alter secrets or
  R2 data.
- ACL failure: fix only the `service_role` grant/config. Never grant the admin
  RPCs back to `PUBLIC`, `anon`, or `authenticated`.

Git-history secret cleanup is a separate maintenance operation after production
is stable. Rotate credentials first, freeze pushes, create an encrypted mirror,
rewrite every ref, rescan, coordinate the force-push, and require collaborators
to reclone.
