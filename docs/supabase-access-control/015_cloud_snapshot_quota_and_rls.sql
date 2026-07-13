begin;

drop policy if exists "cloud_snapshots_select_own" on public.cloud_snapshots;
drop policy if exists "cloud_snapshots_insert_own" on public.cloud_snapshots;
drop policy if exists "cloud_snapshots_update_own" on public.cloud_snapshots;
drop policy if exists "cloud_snapshots_delete_own" on public.cloud_snapshots;

create policy "cloud_snapshots_select_own"
  on public.cloud_snapshots
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "cloud_snapshots_insert_own"
  on public.cloud_snapshots
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "cloud_snapshots_update_own"
  on public.cloud_snapshots
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "cloud_snapshots_delete_own"
  on public.cloud_snapshots
  for delete
  to authenticated
  using ((select auth.uid()) = user_id);

create or replace function public.enforce_cloud_snapshot_user_quota()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  existing_count bigint;
  existing_bytes bigint;
begin
  perform pg_advisory_xact_lock(hashtextextended(new.user_id::text, 0));

  if tg_op = 'UPDATE' then
    select count(*), coalesce(sum(size_bytes), 0)
      into existing_count, existing_bytes
    from public.cloud_snapshots
    where user_id = new.user_id
      and id <> old.id;
  else
    select count(*), coalesce(sum(size_bytes), 0)
      into existing_count, existing_bytes
    from public.cloud_snapshots
    where user_id = new.user_id;
  end if;

  if existing_count + 1 > 200 or existing_bytes + new.size_bytes > 268435456 then
    raise exception 'cloud_snapshot_quota_exceeded'
      using errcode = 'P0001',
        detail = 'Cloud Sync is limited to 200 snapshots and 256 MiB per user.';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_cloud_snapshot_user_quota() from public;
revoke all on function public.enforce_cloud_snapshot_user_quota() from anon;
revoke all on function public.enforce_cloud_snapshot_user_quota() from authenticated;

drop trigger if exists cloud_snapshots_enforce_user_quota on public.cloud_snapshots;
create trigger cloud_snapshots_enforce_user_quota
before insert or update on public.cloud_snapshots
for each row execute function public.enforce_cloud_snapshot_user_quota();

create index if not exists idx_cloud_snapshots_user_scope_updated
  on public.cloud_snapshots (user_id, scope, updated_at desc);

commit;
