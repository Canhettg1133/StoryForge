-- Run only after hybrid clients have been healthy for 24 hours.
-- This preserves legacy SELECT fallback while preventing old clients from
-- creating payload rows that are invisible to R2-only clients.

begin;

drop policy if exists "cloud_snapshots_insert_own" on public.cloud_snapshots;
drop policy if exists "cloud_snapshots_update_own" on public.cloud_snapshots;
drop policy if exists "cloud_snapshots_delete_own" on public.cloud_snapshots;

revoke insert, update, delete on table public.cloud_snapshots from authenticated;
grant select on table public.cloud_snapshots to authenticated;

commit;
