-- DESTRUCTIVE FINALIZATION. Do not run during initial rollout.
-- Preconditions outside SQL: encrypted table-only dump stored outside the
-- repository, dump checksum recorded, read-only reconciliation passed, and
-- the verified hybrid artifact retained for rollback.
--
-- In the same psql session, explicitly set:
--   set storyforge.cloud_sync_legacy_drop_approved = 'after-7-day-reconciliation';
--   set storyforge.cloud_sync_r2_cutover_at = '2026-08-10T00:00:00Z';

begin;

do $$
declare
  approval text := current_setting('storyforge.cloud_sync_legacy_drop_approved', true);
  cutover_text text := current_setting('storyforge.cloud_sync_r2_cutover_at', true);
begin
  if approval is distinct from 'after-7-day-reconciliation' then
    raise exception 'cloud_sync_legacy_drop_not_approved';
  end if;
  if cutover_text is null or now() < cutover_text::timestamptz + interval '7 days' then
    raise exception 'cloud_sync_legacy_retention_window_incomplete';
  end if;
  if exists (select 1 from public.cloud_snapshot_uploads where status = 'pending') then
    raise exception 'cloud_sync_pending_uploads_not_empty';
  end if;
  if exists (select 1 from public.cloud_snapshot_object_gc where status <> 'completed') then
    raise exception 'cloud_sync_gc_backlog_not_empty';
  end if;
  if exists (
    select 1
    from public.cloud_snapshots legacy
    left join public.cloud_snapshot_manifests manifest
      on manifest.user_id = legacy.user_id
      and manifest.scope = legacy.scope
      and manifest.item_slug = legacy.item_slug
    left join public.cloud_snapshot_tombstones tombstone
      on tombstone.user_id = legacy.user_id
      and tombstone.scope = legacy.scope
      and tombstone.item_slug = legacy.item_slug
    where not (
      manifest.size_bytes = octet_length(legacy.payload_text)
      and manifest.payload_sha256 = encode(digest(convert_to(legacy.payload_text, 'UTF8'), 'sha256'), 'hex')
    )
    and not (tombstone.deleted_at >= legacy.updated_at)
  ) then
    raise exception 'cloud_sync_legacy_reconciliation_incomplete';
  end if;
end;
$$;

drop function public.cloud_sync_list_snapshots(uuid, integer);
drop function public.cloud_sync_delete_snapshot(uuid, uuid);
drop function public.cloud_sync_backfill_manifest(
  uuid, uuid, text, text, text, integer, bigint, integer, text, jsonb,
  text, timestamptz, timestamptz
);

drop table public.cloud_snapshots;
drop function if exists public.enforce_cloud_snapshot_user_quota();
drop function if exists public.cloud_sync_touch_legacy_snapshot();
drop function if exists public.cloud_sync_revive_legacy_snapshot();

create or replace function public.cloud_sync_list_snapshots(p_user_id uuid, p_limit integer default 200)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select jsonb_build_object(
    'items', (
      select coalesce(jsonb_agg(public.cloud_sync_manifest_json(m) order by m.updated_at desc), '[]'::jsonb)
      from (
        select * from public.cloud_snapshot_manifests
        where user_id = p_user_id
        order by updated_at desc
        limit least(greatest(coalesce(p_limit, 200), 1), 200)
      ) m
    ),
    'tombstones', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'scope', t.scope, 'itemSlug', t.item_slug, 'deletedAt', t.deleted_at
      ) order by t.deleted_at desc), '[]'::jsonb)
      from (
        select scope, item_slug, deleted_at
        from public.cloud_snapshot_tombstones
        where user_id = p_user_id and deleted_at > now() - interval '30 days'
        order by deleted_at desc
        limit least(greatest(coalesce(p_limit, 200), 1), 200)
      ) t
    ),
    'legacyItems', '[]'::jsonb
  );
$$;

revoke all on function public.cloud_sync_list_snapshots(uuid, integer) from public, anon, authenticated;
grant execute on function public.cloud_sync_list_snapshots(uuid, integer) to service_role;

create or replace function public.cloud_sync_delete_snapshot(p_user_id uuid, p_snapshot_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  deleted_count integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));
  delete from public.cloud_snapshot_manifests
  where id = p_snapshot_id and user_id = p_user_id;
  get diagnostics deleted_count = row_count;
  if deleted_count = 0 then
    raise exception 'cloud_sync_snapshot_not_found' using errcode = 'P0001';
  end if;
  return jsonb_build_object('deleted', true);
end;
$$;

revoke all on function public.cloud_sync_delete_snapshot(uuid, uuid) from public, anon, authenticated;
grant execute on function public.cloud_sync_delete_snapshot(uuid, uuid) to service_role;

commit;
