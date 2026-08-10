-- Additive Cloud Sync R2 metadata schema.
-- Apply before deploying the Cloud Sync Worker. This migration deliberately
-- leaves public.cloud_snapshots and its existing RLS policies untouched.

begin;

create extension if not exists pgcrypto;

create table if not exists public.cloud_snapshot_manifests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  scope text not null check (scope in ('project', 'chat', 'prompt_bundle')),
  item_slug text not null check (char_length(item_slug) between 1 and 256),
  item_title text not null default '' check (char_length(item_title) <= 256),
  payload_version integer not null default 1 check (payload_version > 0),
  source_updated_at bigint not null default 0 check (source_updated_at >= 0),
  size_bytes integer not null check (size_bytes between 0 and 67108864),
  metadata jsonb not null default '{}'::jsonb check (octet_length(metadata::text) <= 65536),
  payload_sha256 text not null check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  object_key text not null,
  revision_id uuid not null default gen_random_uuid(),
  r2_etag text,
  r2_version text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, scope, item_slug),
  unique (object_key)
);

create table if not exists public.cloud_snapshot_uploads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  write_id uuid not null,
  snapshot_id uuid not null,
  scope text not null check (scope in ('project', 'chat', 'prompt_bundle')),
  item_slug text not null check (char_length(item_slug) between 1 and 256),
  item_title text not null default '' check (char_length(item_title) <= 256),
  payload_version integer not null check (payload_version > 0),
  source_updated_at bigint not null default 0 check (source_updated_at >= 0),
  size_bytes integer not null check (size_bytes between 0 and 67108864),
  payload_sha256 text not null check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  metadata jsonb not null default '{}'::jsonb check (octet_length(metadata::text) <= 65536),
  expected_revision_id uuid,
  reserved_bytes bigint not null default 0 check (reserved_bytes >= 0),
  reserves_new_snapshot boolean not null default false,
  object_key text,
  status text not null default 'pending' check (status in ('pending', 'committed', 'aborted', 'expired')),
  result_manifest jsonb,
  expires_at timestamptz not null default (now() + interval '30 minutes'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, write_id)
);

create table if not exists public.cloud_snapshot_object_gc (
  id bigserial primary key,
  user_id uuid,
  object_key text not null unique,
  reason_code text not null default 'MANIFEST_DELETED',
  status text not null default 'pending' check (status in ('pending', 'processing', 'failed', 'completed')),
  attempts integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz not null default now(),
  last_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.cloud_snapshot_tombstones (
  user_id uuid not null references auth.users(id) on delete cascade,
  scope text not null check (scope in ('project', 'chat', 'prompt_bundle')),
  item_slug text not null check (char_length(item_slug) between 1 and 256),
  deleted_source_updated_at bigint not null default 0,
  deleted_revision_id uuid,
  deleted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, scope, item_slug)
);

create index if not exists idx_cloud_snapshot_manifests_user_updated
  on public.cloud_snapshot_manifests (user_id, updated_at desc);
create index if not exists idx_cloud_snapshot_uploads_user_pending
  on public.cloud_snapshot_uploads (user_id, expires_at)
  where status = 'pending';
create index if not exists idx_cloud_snapshot_object_gc_due
  on public.cloud_snapshot_object_gc (status, next_attempt_at, id)
  where status in ('pending', 'failed');

alter table public.cloud_snapshot_manifests enable row level security;
alter table public.cloud_snapshot_uploads enable row level security;
alter table public.cloud_snapshot_object_gc enable row level security;
alter table public.cloud_snapshot_tombstones enable row level security;

revoke all on table public.cloud_snapshot_manifests from anon, authenticated;
revoke all on table public.cloud_snapshot_uploads from anon, authenticated;
revoke all on table public.cloud_snapshot_object_gc from anon, authenticated;
revoke all on table public.cloud_snapshot_tombstones from anon, authenticated;
revoke all on sequence public.cloud_snapshot_object_gc_id_seq from anon, authenticated;

create or replace function public.cloud_sync_touch_legacy_snapshot()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  new.updated_at := statement_timestamp();
  return new;
end;
$$;

revoke all on function public.cloud_sync_touch_legacy_snapshot() from public, anon, authenticated;

drop trigger if exists cloud_sync_touch_legacy_snapshot on public.cloud_snapshots;
create trigger cloud_sync_touch_legacy_snapshot
before insert or update on public.cloud_snapshots
for each row execute function public.cloud_sync_touch_legacy_snapshot();

create or replace function public.cloud_sync_revive_legacy_snapshot()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  -- A real legacy writer that runs after a tombstone must be eligible for the
  -- next delta backfill. The quota trigger uses the same per-user advisory
  -- lock as Worker RPCs, so this cannot race a Worker commit for that user.
  delete from public.cloud_snapshot_tombstones
  where user_id = new.user_id and scope = new.scope and item_slug = new.item_slug;
  return new;
end;
$$;

revoke all on function public.cloud_sync_revive_legacy_snapshot() from public, anon, authenticated;

drop trigger if exists cloud_sync_revive_legacy_snapshot on public.cloud_snapshots;
create trigger cloud_sync_revive_legacy_snapshot
after insert or update on public.cloud_snapshots
for each row execute function public.cloud_sync_revive_legacy_snapshot();

create or replace function public.cloud_sync_manifest_json(p_manifest public.cloud_snapshot_manifests)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select jsonb_build_object(
    'id', p_manifest.id,
    'scope', p_manifest.scope,
    'itemSlug', p_manifest.item_slug,
    'itemTitle', p_manifest.item_title,
    'payloadVersion', p_manifest.payload_version,
    'sourceUpdatedAt', p_manifest.source_updated_at,
    'sizeBytes', p_manifest.size_bytes,
    'metadata', p_manifest.metadata,
    'payloadSha256', p_manifest.payload_sha256,
    'revisionId', p_manifest.revision_id,
    'createdAt', p_manifest.created_at,
    'updatedAt', p_manifest.updated_at
  );
$$;

revoke all on function public.cloud_sync_manifest_json(public.cloud_snapshot_manifests) from public, anon, authenticated;
grant execute on function public.cloud_sync_manifest_json(public.cloud_snapshot_manifests) to service_role;

create or replace function public.cloud_sync_enqueue_manifest_gc()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  -- During an auth.users cascade the parent row is already gone. Tombstones
  -- are unnecessary for a deleted account, but GC must still be enqueued.
  if exists (select 1 from auth.users where id = old.user_id) then
    insert into public.cloud_snapshot_tombstones (
      user_id, scope, item_slug, deleted_source_updated_at, deleted_revision_id, deleted_at, updated_at
    ) values (
      old.user_id, old.scope, old.item_slug, old.source_updated_at, old.revision_id, now(), now()
    )
    on conflict (user_id, scope, item_slug) do update set
      deleted_source_updated_at = greatest(
        public.cloud_snapshot_tombstones.deleted_source_updated_at,
        excluded.deleted_source_updated_at
      ),
      deleted_revision_id = excluded.deleted_revision_id,
      deleted_at = greatest(public.cloud_snapshot_tombstones.deleted_at, excluded.deleted_at),
      updated_at = now();
  end if;

  insert into public.cloud_snapshot_object_gc (user_id, object_key, reason_code)
  values (old.user_id, old.object_key, 'MANIFEST_DELETED')
  on conflict (object_key) do update set
    status = 'pending',
    next_attempt_at = now(),
    deleted_at = null,
    updated_at = now();
  return old;
end;
$$;

revoke all on function public.cloud_sync_enqueue_manifest_gc() from public, anon, authenticated;

drop trigger if exists cloud_sync_enqueue_manifest_gc on public.cloud_snapshot_manifests;
create trigger cloud_sync_enqueue_manifest_gc
after delete on public.cloud_snapshot_manifests
for each row execute function public.cloud_sync_enqueue_manifest_gc();

create or replace function public.cloud_sync_enqueue_upload_gc()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if old.object_key is not null
     and not exists (
       select 1 from public.cloud_snapshot_manifests m where m.object_key = old.object_key
     ) then
    insert into public.cloud_snapshot_object_gc (user_id, object_key, reason_code)
    values (old.user_id, old.object_key, 'UPLOAD_DELETED')
    on conflict (object_key) do update set
      status = case
        when public.cloud_snapshot_object_gc.status = 'completed' then 'completed'
        else 'pending'
      end,
      next_attempt_at = case
        when public.cloud_snapshot_object_gc.status = 'completed'
          then public.cloud_snapshot_object_gc.next_attempt_at
        else now()
      end,
      deleted_at = case
        when public.cloud_snapshot_object_gc.status = 'completed'
          then public.cloud_snapshot_object_gc.deleted_at
        else null
      end,
      updated_at = now();
  end if;
  return old;
end;
$$;

revoke all on function public.cloud_sync_enqueue_upload_gc() from public, anon, authenticated;

drop trigger if exists cloud_sync_enqueue_upload_gc on public.cloud_snapshot_uploads;
create trigger cloud_sync_enqueue_upload_gc
after delete on public.cloud_snapshot_uploads
for each row execute function public.cloud_sync_enqueue_upload_gc();

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
        select *
        from public.cloud_snapshot_manifests
        where user_id = p_user_id
        order by updated_at desc
        limit least(greatest(coalesce(p_limit, 200), 1), 200)
      ) m
    ),
    'tombstones', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'scope', t.scope,
        'itemSlug', t.item_slug,
        'deletedAt', t.deleted_at
      ) order by t.deleted_at desc), '[]'::jsonb)
      from (
        select scope, item_slug, deleted_at
        from public.cloud_snapshot_tombstones
        where user_id = p_user_id and deleted_at > now() - interval '30 days'
        order by deleted_at desc
        limit least(greatest(coalesce(p_limit, 200), 1), 200)
      ) t
    ),
    'legacyItems', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', legacy.id,
        'scope', legacy.scope,
        'itemSlug', legacy.item_slug,
        'itemTitle', legacy.item_title,
        'payloadVersion', legacy.payload_version,
        'sourceUpdatedAt', legacy.source_updated_at,
        'sizeBytes', legacy.size_bytes,
        'metadata', legacy.metadata,
        'payloadSha256', null,
        'revisionId', null,
        'createdAt', legacy.created_at,
        'updatedAt', legacy.updated_at
      ) order by legacy.updated_at desc), '[]'::jsonb)
      from (
        select l.id, l.scope, l.item_slug, l.item_title, l.payload_version,
               l.source_updated_at, l.size_bytes, l.metadata, l.created_at, l.updated_at
        from public.cloud_snapshots l
        where l.user_id = p_user_id
          and not exists (
            select 1 from public.cloud_snapshot_manifests m
            where m.user_id = l.user_id and m.scope = l.scope and m.item_slug = l.item_slug
          )
          and not exists (
            select 1 from public.cloud_snapshot_tombstones t
            where t.user_id = l.user_id and t.scope = l.scope and t.item_slug = l.item_slug
              and t.deleted_at >= l.updated_at
          )
        order by l.updated_at desc
        limit greatest(
          least(greatest(coalesce(p_limit, 200), 1), 200)
          - least(
              (select count(*) from public.cloud_snapshot_manifests m2 where m2.user_id = p_user_id),
              least(greatest(coalesce(p_limit, 200), 1), 200)
            ),
          0
        )
      ) legacy
    )
  );
$$;

revoke all on function public.cloud_sync_list_snapshots(uuid, integer) from public, anon, authenticated;
grant execute on function public.cloud_sync_list_snapshots(uuid, integer) to service_role;

create or replace function public.cloud_sync_open_upload(
  p_user_id uuid,
  p_write_id uuid,
  p_scope text,
  p_item_slug text,
  p_item_title text,
  p_payload_version integer,
  p_source_updated_at bigint,
  p_size_bytes integer,
  p_payload_sha256 text,
  p_metadata jsonb,
  p_expected_revision_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  existing_upload public.cloud_snapshot_uploads%rowtype;
  existing_manifest public.cloud_snapshot_manifests%rowtype;
  updated_manifest public.cloud_snapshot_manifests%rowtype;
  created_upload public.cloud_snapshot_uploads%rowtype;
  existing_snapshot_count bigint;
  existing_snapshot_bytes bigint;
  active_upload_count bigint;
  active_reserved_bytes bigint;
  active_reserved_count bigint;
  reservation_bytes bigint;
  reservation_count boolean;
  next_revision uuid;
  target_snapshot_id uuid;
  legacy_identity_size integer;
begin
  if p_scope not in ('project', 'chat', 'prompt_bundle')
     or char_length(coalesce(p_item_slug, '')) not between 1 and 256
     or char_length(coalesce(p_item_title, '')) > 256
     or p_payload_version < 1
     or p_source_updated_at < 0
     or p_size_bytes not between 0 and 67108864
     or p_payload_sha256 !~ '^[0-9a-f]{64}$'
     or octet_length(coalesce(p_metadata, '{}'::jsonb)::text) > 65536 then
    raise exception 'cloud_sync_invalid_upload' using errcode = 'P0001';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  select * into existing_upload
  from public.cloud_snapshot_uploads
  where user_id = p_user_id and write_id = p_write_id;

  if found then
    if existing_upload.scope <> p_scope
       or existing_upload.item_slug <> p_item_slug
       or existing_upload.item_title <> p_item_title
       or existing_upload.payload_version <> p_payload_version
       or existing_upload.source_updated_at <> p_source_updated_at
       or existing_upload.size_bytes <> p_size_bytes
       or existing_upload.payload_sha256 <> p_payload_sha256
       or existing_upload.metadata is distinct from coalesce(p_metadata, '{}'::jsonb)
       or existing_upload.expected_revision_id is distinct from p_expected_revision_id then
      raise exception 'cloud_sync_write_conflict' using errcode = 'P0001';
    end if;
    if existing_upload.status = 'committed' then
      return jsonb_build_object(
        'uploadId', existing_upload.id,
        'snapshotId', existing_upload.snapshot_id,
        'uploadRequired', false,
        'manifest', existing_upload.result_manifest
      );
    end if;
    if existing_upload.status = 'pending' and existing_upload.expires_at > now() then
      return jsonb_build_object(
        'uploadId', existing_upload.id,
        'snapshotId', existing_upload.snapshot_id,
        'uploadRequired', true,
        'expiresAt', existing_upload.expires_at
      );
    end if;
    raise exception 'cloud_sync_upload_expired' using errcode = 'P0001';
  end if;

  select * into existing_manifest
  from public.cloud_snapshot_manifests
  where user_id = p_user_id and scope = p_scope and item_slug = p_item_slug
  for update;

  if existing_manifest.id is null and p_expected_revision_id is not null then
    raise exception 'cloud_sync_revision_conflict' using errcode = 'P0001';
  end if;
  if existing_manifest.id is not null
     and p_expected_revision_id is distinct from existing_manifest.revision_id then
    raise exception 'cloud_sync_revision_conflict' using errcode = 'P0001';
  end if;

  if to_regclass('public.cloud_snapshots') is not null then
    select l.size_bytes into legacy_identity_size
    from public.cloud_snapshots l
    where l.user_id = p_user_id and l.scope = p_scope and l.item_slug = p_item_slug
      and not exists (
        select 1 from public.cloud_snapshot_tombstones t
        where t.user_id = l.user_id and t.scope = l.scope and t.item_slug = l.item_slug
          and t.deleted_at >= l.updated_at
      )
    limit 1;
  end if;

  if existing_manifest.id is not null and existing_manifest.payload_sha256 = p_payload_sha256 then
    if existing_manifest.size_bytes is distinct from p_size_bytes then
      raise exception 'cloud_sync_invalid_upload' using errcode = 'P0001';
    end if;
    next_revision := case
      when existing_manifest.item_title is distinct from p_item_title
        or existing_manifest.payload_version is distinct from p_payload_version
        or existing_manifest.source_updated_at is distinct from p_source_updated_at
        or existing_manifest.metadata is distinct from coalesce(p_metadata, '{}'::jsonb)
      then gen_random_uuid()
      else existing_manifest.revision_id
    end;

    update public.cloud_snapshot_manifests set
      item_title = p_item_title,
      payload_version = p_payload_version,
      source_updated_at = p_source_updated_at,
      metadata = coalesce(p_metadata, '{}'::jsonb),
      revision_id = next_revision,
      updated_at = case when revision_id = next_revision then updated_at else now() end
    where id = existing_manifest.id
    returning * into updated_manifest;

    insert into public.cloud_snapshot_uploads (
      user_id, write_id, snapshot_id, scope, item_slug, item_title, payload_version,
      source_updated_at, size_bytes, payload_sha256, metadata, expected_revision_id,
      object_key, status, result_manifest, expires_at
    ) values (
      p_user_id, p_write_id, updated_manifest.id, p_scope, p_item_slug, p_item_title,
      p_payload_version, p_source_updated_at, p_size_bytes, p_payload_sha256,
      coalesce(p_metadata, '{}'::jsonb), p_expected_revision_id, updated_manifest.object_key,
      'committed', public.cloud_sync_manifest_json(updated_manifest), now() + interval '30 minutes'
    ) returning * into created_upload;

    return jsonb_build_object(
      'uploadId', created_upload.id,
      'snapshotId', updated_manifest.id,
      'uploadRequired', false,
      'manifest', public.cloud_sync_manifest_json(updated_manifest)
    );
  end if;

  if exists (
    select 1 from public.cloud_snapshot_uploads
    where user_id = p_user_id and scope = p_scope and item_slug = p_item_slug
      and status = 'pending' and expires_at > now()
  ) then
    raise exception 'cloud_sync_write_conflict' using errcode = 'P0001';
  end if;

  if to_regclass('public.cloud_snapshots') is not null then
    select count(*), coalesce(sum(size_bytes), 0)
    into existing_snapshot_count, existing_snapshot_bytes
    from (
      select m.size_bytes
      from public.cloud_snapshot_manifests m
      where m.user_id = p_user_id
      union all
      select l.size_bytes
      from public.cloud_snapshots l
      where l.user_id = p_user_id
        and not exists (
          select 1 from public.cloud_snapshot_manifests m
          where m.user_id = l.user_id and m.scope = l.scope and m.item_slug = l.item_slug
        )
        and not exists (
          select 1 from public.cloud_snapshot_tombstones t
          where t.user_id = l.user_id and t.scope = l.scope and t.item_slug = l.item_slug
            and t.deleted_at >= l.updated_at
        )
    ) logical_snapshots;
  else
    select count(*), coalesce(sum(size_bytes), 0)
    into existing_snapshot_count, existing_snapshot_bytes
    from public.cloud_snapshot_manifests
    where user_id = p_user_id;
  end if;

  select count(*), coalesce(sum(reserved_bytes), 0),
         coalesce(sum(case when reserves_new_snapshot then 1 else 0 end), 0)
  into active_upload_count, active_reserved_bytes, active_reserved_count
  from public.cloud_snapshot_uploads
  where user_id = p_user_id and status = 'pending' and expires_at > now();

  if active_upload_count >= 3 then
    raise exception 'cloud_sync_pending_limit' using errcode = 'P0001';
  end if;

  reservation_bytes := greatest(
    p_size_bytes - coalesce(existing_manifest.size_bytes, legacy_identity_size, 0),
    0
  );
  reservation_count := existing_manifest.id is null and legacy_identity_size is null;
  target_snapshot_id := coalesce(existing_manifest.id, gen_random_uuid());

  if (existing_snapshot_count >= 200 and reservation_count)
     or existing_snapshot_count + active_reserved_count
       + (case when reservation_count then 1 else 0 end) > 200
     or existing_snapshot_bytes + active_reserved_bytes + reservation_bytes > 268435456 then
    raise exception 'cloud_sync_quota_exceeded' using errcode = 'P0001';
  end if;

  insert into public.cloud_snapshot_uploads (
    user_id, write_id, snapshot_id, scope, item_slug, item_title, payload_version,
    source_updated_at, size_bytes, payload_sha256, metadata, expected_revision_id,
    reserved_bytes, reserves_new_snapshot, object_key, expires_at
  ) values (
    p_user_id, p_write_id, target_snapshot_id, p_scope,
    p_item_slug, p_item_title, p_payload_version, p_source_updated_at, p_size_bytes,
    p_payload_sha256, coalesce(p_metadata, '{}'::jsonb), p_expected_revision_id,
    reservation_bytes, reservation_count,
    format(
      'users/%s/snapshots/%s/%s/%s.json',
      p_user_id, p_scope, target_snapshot_id, p_payload_sha256
    ),
    now() + interval '30 minutes'
  ) returning * into created_upload;

  return jsonb_build_object(
    'uploadId', created_upload.id,
    'snapshotId', created_upload.snapshot_id,
    'uploadRequired', true,
    'expiresAt', created_upload.expires_at
  );
end;
$$;

revoke all on function public.cloud_sync_open_upload(uuid, uuid, text, text, text, integer, bigint, integer, text, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.cloud_sync_open_upload(uuid, uuid, text, text, text, integer, bigint, integer, text, jsonb, uuid) to service_role;

create or replace function public.cloud_sync_get_upload(p_user_id uuid, p_upload_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  upload_row public.cloud_snapshot_uploads%rowtype;
begin
  select * into upload_row
  from public.cloud_snapshot_uploads
  where id = p_upload_id and user_id = p_user_id;
  if not found then return null; end if;
  if upload_row.status = 'pending' and upload_row.expires_at <= now() then
    raise exception 'cloud_sync_upload_expired' using errcode = 'P0001';
  end if;
  return jsonb_build_object(
    'uploadId', upload_row.id,
    'snapshotId', upload_row.snapshot_id,
    'scope', upload_row.scope,
    'sizeBytes', upload_row.size_bytes,
    'payloadSha256', upload_row.payload_sha256,
    'status', upload_row.status,
    'manifest', upload_row.result_manifest
  );
end;
$$;

revoke all on function public.cloud_sync_get_upload(uuid, uuid) from public, anon, authenticated;
grant execute on function public.cloud_sync_get_upload(uuid, uuid) to service_role;

create or replace function public.cloud_sync_commit_upload(
  p_user_id uuid,
  p_upload_id uuid,
  p_object_key text,
  p_r2_etag text default null,
  p_r2_version text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  upload_row public.cloud_snapshot_uploads%rowtype;
  current_manifest public.cloud_snapshot_manifests%rowtype;
  committed_manifest public.cloud_snapshot_manifests%rowtype;
  old_object_key text;
  expected_key text;
  legacy_source_updated_at bigint;
  legacy_updated_at timestamptz;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));
  select * into upload_row
  from public.cloud_snapshot_uploads
  where id = p_upload_id and user_id = p_user_id
  for update;
  if not found then raise exception 'cloud_sync_upload_not_found' using errcode = 'P0001'; end if;
  if upload_row.status = 'committed' then return upload_row.result_manifest; end if;
  if upload_row.status <> 'pending' or upload_row.expires_at <= now() then
    raise exception 'cloud_sync_upload_expired' using errcode = 'P0001';
  end if;

  expected_key := format(
    'users/%s/snapshots/%s/%s/%s.json',
    p_user_id, upload_row.scope, upload_row.snapshot_id, upload_row.payload_sha256
  );
  if p_object_key is distinct from expected_key then
    raise exception 'cloud_sync_invalid_object_key' using errcode = 'P0001';
  end if;

  select * into current_manifest
  from public.cloud_snapshot_manifests
  where user_id = p_user_id and scope = upload_row.scope and item_slug = upload_row.item_slug
  for update;

  if current_manifest.id is null and upload_row.expected_revision_id is not null then
    raise exception 'cloud_sync_revision_conflict' using errcode = 'P0001';
  end if;
  if current_manifest.id is not null
     and upload_row.expected_revision_id is distinct from current_manifest.revision_id then
    raise exception 'cloud_sync_revision_conflict' using errcode = 'P0001';
  end if;
  old_object_key := current_manifest.object_key;

  insert into public.cloud_snapshot_manifests (
    id, user_id, scope, item_slug, item_title, payload_version, source_updated_at,
    size_bytes, metadata, payload_sha256, object_key, revision_id, r2_etag, r2_version
  ) values (
    upload_row.snapshot_id, p_user_id, upload_row.scope, upload_row.item_slug,
    upload_row.item_title, upload_row.payload_version, upload_row.source_updated_at,
    upload_row.size_bytes, upload_row.metadata, upload_row.payload_sha256, p_object_key,
    gen_random_uuid(), p_r2_etag, p_r2_version
  )
  on conflict (user_id, scope, item_slug) do update set
    item_title = excluded.item_title,
    payload_version = excluded.payload_version,
    source_updated_at = excluded.source_updated_at,
    size_bytes = excluded.size_bytes,
    metadata = excluded.metadata,
    payload_sha256 = excluded.payload_sha256,
    object_key = excluded.object_key,
    revision_id = excluded.revision_id,
    r2_etag = excluded.r2_etag,
    r2_version = excluded.r2_version,
    updated_at = now()
  returning * into committed_manifest;

  if old_object_key is not null and old_object_key <> committed_manifest.object_key then
    insert into public.cloud_snapshot_object_gc (user_id, object_key, reason_code)
    values (p_user_id, old_object_key, 'OBJECT_REPLACED')
    on conflict (object_key) do update set
      status = 'pending', next_attempt_at = now(), deleted_at = null, updated_at = now();
  end if;

  if to_regclass('public.cloud_snapshots') is not null then
    select source_updated_at, updated_at
    into legacy_source_updated_at, legacy_updated_at
    from public.cloud_snapshots
    where user_id = p_user_id
      and scope = upload_row.scope
      and item_slug = upload_row.item_slug
    limit 1;
  end if;

  if legacy_updated_at is not null then
    insert into public.cloud_snapshot_tombstones (
      user_id, scope, item_slug, deleted_source_updated_at,
      deleted_revision_id, deleted_at, updated_at
    ) values (
      p_user_id, upload_row.scope, upload_row.item_slug,
      legacy_source_updated_at, committed_manifest.revision_id,
      greatest(statement_timestamp(), legacy_updated_at), statement_timestamp()
    )
    on conflict (user_id, scope, item_slug) do update set
      deleted_source_updated_at = greatest(
        public.cloud_snapshot_tombstones.deleted_source_updated_at,
        excluded.deleted_source_updated_at
      ),
      deleted_revision_id = excluded.deleted_revision_id,
      deleted_at = greatest(public.cloud_snapshot_tombstones.deleted_at, excluded.deleted_at),
      updated_at = statement_timestamp();
  else
    delete from public.cloud_snapshot_tombstones
    where user_id = p_user_id and scope = upload_row.scope and item_slug = upload_row.item_slug;
  end if;

  update public.cloud_snapshot_uploads set
    object_key = p_object_key,
    status = 'committed',
    result_manifest = public.cloud_sync_manifest_json(committed_manifest),
    updated_at = now()
  where id = upload_row.id;

  return public.cloud_sync_manifest_json(committed_manifest);
end;
$$;

revoke all on function public.cloud_sync_commit_upload(uuid, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.cloud_sync_commit_upload(uuid, uuid, text, text, text) to service_role;

create or replace function public.cloud_sync_abort_upload(
  p_user_id uuid,
  p_upload_id uuid,
  p_object_key text,
  p_reason_code text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  upload_row public.cloud_snapshot_uploads%rowtype;
  can_delete boolean := false;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));
  select * into upload_row from public.cloud_snapshot_uploads
  where id = p_upload_id and user_id = p_user_id for update;
  if not found then return jsonb_build_object('deleteObject', false); end if;

  if upload_row.status = 'pending'
     and p_object_key = upload_row.object_key
     and not exists (select 1 from public.cloud_snapshot_manifests where object_key = p_object_key) then
    update public.cloud_snapshot_uploads set status = 'aborted', updated_at = now()
    where id = upload_row.id;
    insert into public.cloud_snapshot_object_gc (user_id, object_key, reason_code)
    values (p_user_id, p_object_key, left(coalesce(p_reason_code, 'UPLOAD_ABORTED'), 128))
    on conflict (object_key) do update set
      status = 'pending', next_attempt_at = now(), deleted_at = null, updated_at = now();
    can_delete := true;
  end if;
  return jsonb_build_object('deleteObject', can_delete);
end;
$$;

revoke all on function public.cloud_sync_abort_upload(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.cloud_sync_abort_upload(uuid, uuid, text, text) to service_role;

create or replace function public.cloud_sync_get_snapshot(p_user_id uuid, p_snapshot_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select public.cloud_sync_manifest_json(m) || jsonb_build_object('objectKey', m.object_key)
  from public.cloud_snapshot_manifests m
  where m.id = p_snapshot_id and m.user_id = p_user_id;
$$;

revoke all on function public.cloud_sync_get_snapshot(uuid, uuid) from public, anon, authenticated;
grant execute on function public.cloud_sync_get_snapshot(uuid, uuid) to service_role;

create or replace function public.cloud_sync_delete_snapshot(p_user_id uuid, p_snapshot_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  deleted_count integer;
  legacy_row public.cloud_snapshots%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));
  delete from public.cloud_snapshot_manifests
  where id = p_snapshot_id and user_id = p_user_id;
  get diagnostics deleted_count = row_count;
  if deleted_count = 0 then
    select * into legacy_row
    from public.cloud_snapshots
    where id = p_snapshot_id and user_id = p_user_id
    for update;
    if not found then
      raise exception 'cloud_sync_snapshot_not_found' using errcode = 'P0001';
    end if;
    -- A stale hybrid list may still carry the legacy row id after another tab
    -- has committed the same logical identity to R2. Delete that manifest in
    -- the same user-locked transaction so the snapshot cannot reappear.
    delete from public.cloud_snapshot_manifests
    where user_id = p_user_id
      and scope = legacy_row.scope
      and item_slug = legacy_row.item_slug;
    insert into public.cloud_snapshot_tombstones (
      user_id, scope, item_slug, deleted_source_updated_at, deleted_at, updated_at
    ) values (
      legacy_row.user_id, legacy_row.scope, legacy_row.item_slug,
      legacy_row.source_updated_at, now(), now()
    )
    on conflict (user_id, scope, item_slug) do update set
      deleted_source_updated_at = greatest(
        public.cloud_snapshot_tombstones.deleted_source_updated_at,
        excluded.deleted_source_updated_at
      ),
      deleted_at = greatest(public.cloud_snapshot_tombstones.deleted_at, excluded.deleted_at),
      updated_at = now();
    delete from public.cloud_snapshots where id = legacy_row.id and user_id = p_user_id;
  end if;
  return jsonb_build_object('deleted', true);
end;
$$;

revoke all on function public.cloud_sync_delete_snapshot(uuid, uuid) from public, anon, authenticated;
grant execute on function public.cloud_sync_delete_snapshot(uuid, uuid) to service_role;

create or replace function public.cloud_sync_cleanup_expired_uploads(p_limit integer default 50)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  upload_row public.cloud_snapshot_uploads%rowtype;
  cleaned integer := 0;
  pruned_uploads integer := 0;
  pruned_gc integer := 0;
  pruned_tombstones integer := 0;
begin
  for upload_row in
    select * from public.cloud_snapshot_uploads
    where status = 'pending' and expires_at <= now()
    order by expires_at
    limit least(greatest(coalesce(p_limit, 50), 1), 100)
    for update skip locked
  loop
    update public.cloud_snapshot_uploads set status = 'expired', updated_at = now()
    where id = upload_row.id;
    if upload_row.object_key is not null
       and not exists (select 1 from public.cloud_snapshot_manifests where object_key = upload_row.object_key) then
      insert into public.cloud_snapshot_object_gc (user_id, object_key, reason_code)
      values (upload_row.user_id, upload_row.object_key, 'UPLOAD_EXPIRED')
      on conflict (object_key) do update set
        status = 'pending', next_attempt_at = now(), deleted_at = null, updated_at = now();
    end if;
    cleaned := cleaned + 1;
  end loop;

  delete from public.cloud_snapshot_uploads
  where id in (
    select id from public.cloud_snapshot_uploads
    where status in ('committed', 'aborted', 'expired')
      and updated_at < now() - interval '1 day'
    order by updated_at
    limit least(greatest(coalesce(p_limit, 50), 1), 100)
  );
  get diagnostics pruned_uploads = row_count;

  delete from public.cloud_snapshot_object_gc
  where id in (
    select id from public.cloud_snapshot_object_gc
    where status = 'completed' and deleted_at < now() - interval '7 days'
    order by deleted_at
    limit least(greatest(coalesce(p_limit, 50), 1), 100)
  );
  get diagnostics pruned_gc = row_count;

  if to_regclass('public.cloud_snapshots') is null then
    delete from public.cloud_snapshot_tombstones
    where (user_id, scope, item_slug) in (
      select user_id, scope, item_slug
      from public.cloud_snapshot_tombstones
      where deleted_at < now() - interval '30 days'
      order by deleted_at
      limit least(greatest(coalesce(p_limit, 50), 1), 100)
    );
    get diagnostics pruned_tombstones = row_count;
  end if;

  return jsonb_build_object(
    'cleaned', cleaned,
    'prunedUploads', pruned_uploads,
    'prunedGc', pruned_gc,
    'prunedTombstones', pruned_tombstones
  );
end;
$$;

revoke all on function public.cloud_sync_cleanup_expired_uploads(integer) from public, anon, authenticated;
grant execute on function public.cloud_sync_cleanup_expired_uploads(integer) to service_role;

create or replace function public.cloud_sync_claim_gc(p_limit integer default 50)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  result jsonb;
begin
  with claimed as (
    select id
    from public.cloud_snapshot_object_gc
    where (status in ('pending', 'failed') and next_attempt_at <= now())
       or (status = 'processing' and updated_at <= now() - interval '15 minutes')
    order by id
    limit least(greatest(coalesce(p_limit, 50), 1), 100)
    for update skip locked
  ), updated as (
    update public.cloud_snapshot_object_gc gc set
      status = 'processing', attempts = attempts + 1, updated_at = now()
    from claimed
    where gc.id = claimed.id
    returning gc.id, gc.object_key
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'objectKey', object_key)), '[]'::jsonb)
  into result from updated;
  return result;
end;
$$;

revoke all on function public.cloud_sync_claim_gc(integer) from public, anon, authenticated;
grant execute on function public.cloud_sync_claim_gc(integer) to service_role;

create or replace function public.cloud_sync_complete_gc(p_gc_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  update public.cloud_snapshot_object_gc set
    status = 'completed', deleted_at = now(), last_error_code = null, updated_at = now()
  where id = p_gc_id and status = 'processing';
  return jsonb_build_object('completed', found);
end;
$$;

revoke all on function public.cloud_sync_complete_gc(bigint) from public, anon, authenticated;
grant execute on function public.cloud_sync_complete_gc(bigint) to service_role;

create or replace function public.cloud_sync_fail_gc(p_gc_id bigint, p_error_code text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  update public.cloud_snapshot_object_gc set
    status = 'failed',
    last_error_code = left(coalesce(p_error_code, 'R2_DELETE_FAILED'), 128),
    next_attempt_at = now() + make_interval(secs => least(3600, greatest(60, attempts * 60))),
    updated_at = now()
  where id = p_gc_id and status = 'processing';
  return jsonb_build_object('failed', found);
end;
$$;

revoke all on function public.cloud_sync_fail_gc(bigint, text) from public, anon, authenticated;
grant execute on function public.cloud_sync_fail_gc(bigint, text) to service_role;

create or replace function public.cloud_sync_backfill_manifest(
  p_user_id uuid,
  p_snapshot_id uuid,
  p_scope text,
  p_item_slug text,
  p_item_title text,
  p_payload_version integer,
  p_source_updated_at bigint,
  p_size_bytes integer,
  p_payload_sha256 text,
  p_metadata jsonb,
  p_object_key text,
  p_legacy_created_at timestamptz,
  p_legacy_updated_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  existing_manifest public.cloud_snapshot_manifests%rowtype;
  tombstone public.cloud_snapshot_tombstones%rowtype;
  inserted_manifest public.cloud_snapshot_manifests%rowtype;
  expected_key text;
  target_snapshot_id uuid;
  old_object_key text;
  existing_snapshot_count bigint;
  existing_snapshot_bytes bigint;
  active_reserved_bytes bigint;
  active_reserved_count bigint;
  existing_identity_size integer;
  reservation_count boolean;
begin
  if p_scope not in ('project', 'chat', 'prompt_bundle')
     or char_length(coalesce(p_item_slug, '')) not between 1 and 256
     or char_length(coalesce(p_item_title, '')) > 256
     or p_payload_version < 1
     or p_source_updated_at < 0
     or p_size_bytes not between 0 and 67108864
     or p_payload_sha256 !~ '^[0-9a-f]{64}$'
     or octet_length(coalesce(p_metadata, '{}'::jsonb)::text) > 65536
     or p_legacy_updated_at is null then
    raise exception 'cloud_sync_invalid_backfill' using errcode = 'P0001';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));
  select * into tombstone from public.cloud_snapshot_tombstones
  where user_id = p_user_id and scope = p_scope and item_slug = p_item_slug;
  if tombstone.user_id is not null and tombstone.deleted_at >= p_legacy_updated_at then
    return jsonb_build_object('status', 'tombstoned');
  end if;

  select * into existing_manifest from public.cloud_snapshot_manifests
  where user_id = p_user_id and scope = p_scope and item_slug = p_item_slug
  for update;
  if existing_manifest.id is not null and existing_manifest.updated_at >= p_legacy_updated_at then
    return jsonb_build_object('status', 'newer_manifest');
  end if;

  if exists (
    select 1 from public.cloud_snapshot_uploads
    where user_id = p_user_id and scope = p_scope and item_slug = p_item_slug
      and status = 'pending' and expires_at > now()
  ) then
    return jsonb_build_object('status', 'pending_upload');
  end if;

  target_snapshot_id := coalesce(existing_manifest.id, p_snapshot_id);
  expected_key := format(
    'users/%s/snapshots/%s/%s/%s.json',
    p_user_id, p_scope, target_snapshot_id, p_payload_sha256
  );
  if p_object_key <> expected_key then
    raise exception 'cloud_sync_invalid_backfill_object_key' using errcode = 'P0001';
  end if;
  old_object_key := existing_manifest.object_key;

  select l.size_bytes into existing_identity_size
  from public.cloud_snapshots l
  where l.user_id = p_user_id and l.scope = p_scope and l.item_slug = p_item_slug
  limit 1;
  existing_identity_size := coalesce(existing_manifest.size_bytes, existing_identity_size);
  reservation_count := existing_manifest.id is null and existing_identity_size is null;

  select count(*), coalesce(sum(size_bytes), 0)
  into existing_snapshot_count, existing_snapshot_bytes
  from (
    select m.size_bytes
    from public.cloud_snapshot_manifests m
    where m.user_id = p_user_id
    union all
    select l.size_bytes
    from public.cloud_snapshots l
    where l.user_id = p_user_id
      and not exists (
        select 1 from public.cloud_snapshot_manifests m
        where m.user_id = l.user_id and m.scope = l.scope and m.item_slug = l.item_slug
      )
      and not exists (
        select 1 from public.cloud_snapshot_tombstones t
        where t.user_id = l.user_id and t.scope = l.scope and t.item_slug = l.item_slug
          and t.deleted_at >= l.updated_at
      )
  ) logical_snapshots;

  select coalesce(sum(reserved_bytes), 0),
         coalesce(sum(case when reserves_new_snapshot then 1 else 0 end), 0)
  into active_reserved_bytes, active_reserved_count
  from public.cloud_snapshot_uploads
  where user_id = p_user_id and status = 'pending' and expires_at > now();

  if existing_snapshot_count + active_reserved_count
       + (case when reservation_count then 1 else 0 end) > 200
     or existing_snapshot_bytes - coalesce(existing_identity_size, 0) + p_size_bytes
       + active_reserved_bytes > 268435456 then
    raise exception 'cloud_sync_quota_exceeded' using errcode = 'P0001';
  end if;

  insert into public.cloud_snapshot_manifests (
    id, user_id, scope, item_slug, item_title, payload_version, source_updated_at,
    size_bytes, metadata, payload_sha256, object_key, revision_id, created_at, updated_at
  ) values (
    target_snapshot_id, p_user_id, p_scope, p_item_slug, p_item_title, p_payload_version,
    p_source_updated_at, p_size_bytes, coalesce(p_metadata, '{}'::jsonb), p_payload_sha256,
    p_object_key, gen_random_uuid(), coalesce(p_legacy_created_at, now()),
    coalesce(p_legacy_updated_at, now())
  )
  on conflict (user_id, scope, item_slug) do update set
    item_title = excluded.item_title,
    payload_version = excluded.payload_version,
    source_updated_at = excluded.source_updated_at,
    size_bytes = excluded.size_bytes,
    metadata = excluded.metadata,
    payload_sha256 = excluded.payload_sha256,
    object_key = excluded.object_key,
    revision_id = excluded.revision_id,
    updated_at = excluded.updated_at
  returning * into inserted_manifest;

  if old_object_key is not null and old_object_key <> inserted_manifest.object_key then
    insert into public.cloud_snapshot_object_gc (user_id, object_key, reason_code)
    values (p_user_id, old_object_key, 'BACKFILL_REPLACED')
    on conflict (object_key) do update set
      status = 'pending', next_attempt_at = now(), deleted_at = null, updated_at = now();
  end if;

  delete from public.cloud_snapshot_tombstones
  where user_id = p_user_id and scope = p_scope and item_slug = p_item_slug;
  return jsonb_build_object('status', 'backfilled', 'manifest', public.cloud_sync_manifest_json(inserted_manifest));
end;
$$;

revoke all on function public.cloud_sync_backfill_manifest(uuid, uuid, text, text, text, integer, bigint, integer, text, jsonb, text, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.cloud_sync_backfill_manifest(uuid, uuid, text, text, text, integer, bigint, integer, text, jsonb, text, timestamptz, timestamptz) to service_role;

commit;
