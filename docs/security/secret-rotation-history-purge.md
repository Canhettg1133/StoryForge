# Secret Rotation And Git History Purge

Use this runbook when a key, token, database, WAL/SHM file, screenshot, or
other sensitive artifact is committed or shared.

## Immediate response

1. Revoke or rotate the exposed key in the provider dashboard.
2. Create a replacement key with least required permissions.
3. Update Vercel, Cloudflare Workers, Supabase, and local `.env` values.
4. Redeploy services that depend on the key.
5. Confirm the old key fails and the new key works.

## Repo cleanup

This pass removes tracked local SQLite files from the index and ignores:

- `data/**/*.sqlite*`
- `data/**/*.db*`
- `data/**/*.sqlite-wal`
- `data/**/*.sqlite-shm`

If the repo was ever pushed or shared, remove the old blobs from history. Use
one controlled maintenance window because this rewrites commit hashes.

```bash
git filter-repo --path data/ --path public/guide/gemini-proxy/07-key-management-create-keys.png --invert-paths
```

Alternative with BFG:

```bash
bfg --delete-folders data --delete-files 07-key-management-create-keys.png
git reflog expire --expire=now --all
git gc --prune=now --aggressive
```

After purge:

1. Force-push only after coordinating with all collaborators.
2. Ask collaborators to reclone or hard reset to the rewritten branch.
3. Purge CDN/build cache for public assets.
4. Run a secret scanner against the rewritten repository.
5. Keep the incident note with date, exposed paths, rotated providers, and verification result.
