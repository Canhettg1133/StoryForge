begin;

insert into public.features(key, name, description, category, active)
values (
  'ai_chat.supreme',
  'Chat Tối Thượng',
  'Cho phép sử dụng chế độ Chat Tối Thượng với prompt bảo mật phía server.',
  'ai',
  true
)
on conflict (key) do update
set
  name = excluded.name,
  description = excluded.description,
  category = excluded.category,
  active = excluded.active,
  updated_at = now();

create table if not exists public.secure_prompt_heads (
  prompt_key text primary key,
  draft_version_id uuid,
  published_version_id uuid,
  enabled boolean not null default false,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint secure_prompt_heads_key_check check (prompt_key = 'supreme_chat')
);

create table if not exists public.secure_prompt_versions (
  id uuid primary key,
  prompt_key text not null references public.secure_prompt_heads(prompt_key) on delete restrict,
  revision bigint not null,
  ciphertext text not null,
  iv text not null,
  encryption_key_version integer not null,
  content_hash text not null,
  content_length integer not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint secure_prompt_versions_revision_unique unique (prompt_key, revision),
  constraint secure_prompt_versions_prompt_id_unique unique (prompt_key, id),
  constraint secure_prompt_versions_content_length_check check (content_length between 1 and 60000),
  constraint secure_prompt_versions_key_version_check check (encryption_key_version >= 1),
  constraint secure_prompt_versions_ciphertext_check check (char_length(ciphertext) between 1 and 400000),
  constraint secure_prompt_versions_iv_check check (char_length(iv) between 16 and 64)
);

create table if not exists public.supreme_chat_rate_limits (
  subject_hash text primary key,
  request_count integer not null default 0,
  window_started_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint supreme_chat_rate_limits_subject_check
    check (subject_hash ~ '^[0-9a-f]{64}$'),
  constraint supreme_chat_rate_limits_count_check
    check (request_count >= 0)
);

create index if not exists idx_supreme_chat_rate_limits_updated
  on public.supreme_chat_rate_limits(updated_at);

alter table public.secure_prompt_heads
  drop constraint if exists secure_prompt_heads_draft_version_fk;
alter table public.secure_prompt_heads
  add constraint secure_prompt_heads_draft_version_fk
  foreign key (prompt_key, draft_version_id)
  references public.secure_prompt_versions(prompt_key, id)
  deferrable initially deferred;

alter table public.secure_prompt_heads
  drop constraint if exists secure_prompt_heads_published_version_fk;
alter table public.secure_prompt_heads
  add constraint secure_prompt_heads_published_version_fk
  foreign key (prompt_key, published_version_id)
  references public.secure_prompt_versions(prompt_key, id)
  deferrable initially deferred;

insert into public.secure_prompt_heads(prompt_key)
values ('supreme_chat')
on conflict (prompt_key) do nothing;

alter table public.admin_audit_logs
  add column if not exists request_id text not null default '';

create or replace function public.prevent_secure_prompt_version_mutation()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  raise exception 'SECURE_PROMPT_VERSION_IMMUTABLE' using errcode = 'P0001';
end;
$$;

drop trigger if exists secure_prompt_versions_prevent_update on public.secure_prompt_versions;
create trigger secure_prompt_versions_prevent_update
before update on public.secure_prompt_versions
for each row execute function public.prevent_secure_prompt_version_mutation();

create or replace function public.prevent_active_secure_prompt_version_delete()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if exists (
    select 1
    from public.secure_prompt_heads
    where draft_version_id = old.id or published_version_id = old.id
  ) then
    raise exception 'SECURE_PROMPT_VERSION_ACTIVE' using errcode = 'P0001';
  end if;
  return old;
end;
$$;

drop trigger if exists secure_prompt_versions_prevent_active_delete on public.secure_prompt_versions;
create trigger secure_prompt_versions_prevent_active_delete
before delete on public.secure_prompt_versions
for each row execute function public.prevent_active_secure_prompt_version_delete();

create or replace function public.save_secure_prompt_draft(
  p_prompt_key text,
  p_version_id uuid,
  p_ciphertext text,
  p_iv text,
  p_encryption_key_version integer,
  p_content_hash text,
  p_content_length integer,
  p_expected_draft_revision bigint,
  p_updated_by uuid,
  p_request_id text,
  p_ip_address text,
  p_user_agent text
)
returns setof public.secure_prompt_versions
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_head public.secure_prompt_heads%rowtype;
  v_current_version public.secure_prompt_versions%rowtype;
  v_current_revision bigint := 0;
  v_next_revision bigint;
begin
  if p_prompt_key is distinct from 'supreme_chat' then
    raise exception 'SECURE_PROMPT_KEY_UNSUPPORTED' using errcode = 'P0001';
  end if;
  if p_content_length not between 1 and 60000 then
    raise exception 'SECURE_PROMPT_CONTENT_LENGTH_INVALID' using errcode = 'P0001';
  end if;

  select * into v_head
  from public.secure_prompt_heads
  where prompt_key = p_prompt_key
  for update;

  if not found then
    raise exception 'SECURE_PROMPT_HEAD_MISSING' using errcode = 'P0001';
  end if;

  if v_head.draft_version_id is not null then
    select * into v_current_version
    from public.secure_prompt_versions
    where id = v_head.draft_version_id;
    v_current_revision := v_current_version.revision;
  end if;

  if coalesce(p_expected_draft_revision, -1) <> v_current_revision then
    raise exception 'SECURE_PROMPT_DRAFT_REVISION_CONFLICT' using errcode = 'P0001';
  end if;

  select coalesce(max(revision), 0) + 1 into v_next_revision
  from public.secure_prompt_versions
  where prompt_key = p_prompt_key;

  insert into public.secure_prompt_versions(
    id,
    prompt_key,
    revision,
    ciphertext,
    iv,
    encryption_key_version,
    content_hash,
    content_length,
    created_by
  )
  values (
    p_version_id,
    p_prompt_key,
    v_next_revision,
    p_ciphertext,
    p_iv,
    p_encryption_key_version,
    p_content_hash,
    p_content_length,
    p_updated_by
  );

  update public.secure_prompt_heads
  set
    draft_version_id = p_version_id,
    updated_by = p_updated_by,
    updated_at = now()
  where prompt_key = p_prompt_key;

  insert into public.admin_audit_logs(
    actor_user_id,
    action,
    before_json,
    after_json,
    actor_snapshot,
    action_summary,
    change_summary,
    resource_label,
    ip_address,
    user_agent,
    request_id
  )
  values (
    p_updated_by,
    'secure_prompt.draft.save',
    jsonb_build_object(
      'promptKey', p_prompt_key,
      'revision', v_current_revision,
      'contentHash', coalesce(v_current_version.content_hash, ''),
      'contentLength', coalesce(v_current_version.content_length, 0),
      'enabled', v_head.enabled
    ),
    jsonb_build_object(
      'promptKey', p_prompt_key,
      'revision', v_next_revision,
      'contentHash', p_content_hash,
      'contentLength', p_content_length,
      'enabled', v_head.enabled
    ),
    jsonb_build_object('userId', p_updated_by),
    'Lưu bản nháp prompt Tối Thượng',
    format('Revision %s → %s', v_current_revision, v_next_revision),
    'Prompt Tối Thượng',
    left(coalesce(p_ip_address, ''), 200),
    left(coalesce(p_user_agent, ''), 500),
    left(coalesce(p_request_id, ''), 120)
  );

  return query
  select *
  from public.secure_prompt_versions
  where id = p_version_id;
end;
$$;

create or replace function public.publish_secure_prompt_version(
  p_prompt_key text,
  p_version_id uuid,
  p_expected_published_revision bigint,
  p_updated_by uuid,
  p_audit_action text,
  p_request_id text,
  p_ip_address text,
  p_user_agent text
)
returns setof public.secure_prompt_heads
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_head public.secure_prompt_heads%rowtype;
  v_current_version public.secure_prompt_versions%rowtype;
  v_target_version public.secure_prompt_versions%rowtype;
  v_current_revision bigint := 0;
begin
  if p_audit_action not in ('secure_prompt.publish', 'secure_prompt.rollback') then
    raise exception 'SECURE_PROMPT_AUDIT_ACTION_INVALID' using errcode = 'P0001';
  end if;

  select * into v_head
  from public.secure_prompt_heads
  where prompt_key = p_prompt_key
  for update;

  if not found or p_prompt_key is distinct from 'supreme_chat' then
    raise exception 'SECURE_PROMPT_HEAD_MISSING' using errcode = 'P0001';
  end if;

  if v_head.published_version_id is not null then
    select * into v_current_version
    from public.secure_prompt_versions
    where id = v_head.published_version_id;
    v_current_revision := v_current_version.revision;
  end if;

  if coalesce(p_expected_published_revision, -1) <> v_current_revision then
    raise exception 'SECURE_PROMPT_PUBLISHED_REVISION_CONFLICT' using errcode = 'P0001';
  end if;

  select * into v_target_version
  from public.secure_prompt_versions
  where id = p_version_id and prompt_key = p_prompt_key and content_length > 0;
  if not found then
    raise exception 'SECURE_PROMPT_VERSION_NOT_FOUND' using errcode = 'P0001';
  end if;

  update public.secure_prompt_heads
  set
    published_version_id = p_version_id,
    enabled = true,
    updated_by = p_updated_by,
    updated_at = now()
  where prompt_key = p_prompt_key;

  insert into public.admin_audit_logs(
    actor_user_id,
    action,
    before_json,
    after_json,
    actor_snapshot,
    action_summary,
    change_summary,
    resource_label,
    ip_address,
    user_agent,
    request_id
  )
  values (
    p_updated_by,
    p_audit_action,
    jsonb_build_object(
      'promptKey', p_prompt_key,
      'revision', v_current_revision,
      'contentHash', coalesce(v_current_version.content_hash, ''),
      'contentLength', coalesce(v_current_version.content_length, 0),
      'enabled', v_head.enabled
    ),
    jsonb_build_object(
      'promptKey', p_prompt_key,
      'revision', v_target_version.revision,
      'contentHash', v_target_version.content_hash,
      'contentLength', v_target_version.content_length,
      'enabled', true
    ),
    jsonb_build_object('userId', p_updated_by),
    case
      when p_audit_action = 'secure_prompt.rollback' then 'Khôi phục prompt Tối Thượng'
      else 'Xuất bản prompt Tối Thượng'
    end,
    format('Revision %s → %s', v_current_revision, v_target_version.revision),
    'Prompt Tối Thượng',
    left(coalesce(p_ip_address, ''), 200),
    left(coalesce(p_user_agent, ''), 500),
    left(coalesce(p_request_id, ''), 120)
  );

  return query
  select *
  from public.secure_prompt_heads
  where prompt_key = p_prompt_key;
end;
$$;

create or replace function public.disable_secure_prompt(
  p_prompt_key text,
  p_updated_by uuid,
  p_request_id text,
  p_ip_address text,
  p_user_agent text
)
returns setof public.secure_prompt_heads
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_head public.secure_prompt_heads%rowtype;
  v_current_version public.secure_prompt_versions%rowtype;
begin
  if p_prompt_key is distinct from 'supreme_chat' then
    raise exception 'SECURE_PROMPT_KEY_UNSUPPORTED' using errcode = 'P0001';
  end if;

  select * into v_head
  from public.secure_prompt_heads
  where prompt_key = p_prompt_key
  for update;
  if not found then
    raise exception 'SECURE_PROMPT_HEAD_MISSING' using errcode = 'P0001';
  end if;

  if v_head.published_version_id is not null then
    select * into v_current_version
    from public.secure_prompt_versions
    where id = v_head.published_version_id;
  end if;

  update public.secure_prompt_heads
  set enabled = false, updated_by = p_updated_by, updated_at = now()
  where prompt_key = p_prompt_key;

  insert into public.admin_audit_logs(
    actor_user_id,
    action,
    before_json,
    after_json,
    actor_snapshot,
    action_summary,
    change_summary,
    resource_label,
    ip_address,
    user_agent,
    request_id
  )
  values (
    p_updated_by,
    'secure_prompt.disable',
    jsonb_build_object(
      'promptKey', p_prompt_key,
      'revision', coalesce(v_current_version.revision, 0),
      'contentHash', coalesce(v_current_version.content_hash, ''),
      'contentLength', coalesce(v_current_version.content_length, 0),
      'enabled', v_head.enabled
    ),
    jsonb_build_object(
      'promptKey', p_prompt_key,
      'revision', coalesce(v_current_version.revision, 0),
      'contentHash', coalesce(v_current_version.content_hash, ''),
      'contentLength', coalesce(v_current_version.content_length, 0),
      'enabled', false
    ),
    jsonb_build_object('userId', p_updated_by),
    'Tắt runtime prompt Tối Thượng',
    'Runtime: bật → tắt',
    'Prompt Tối Thượng',
    left(coalesce(p_ip_address, ''), 200),
    left(coalesce(p_user_agent, ''), 500),
    left(coalesce(p_request_id, ''), 120)
  );

  return query
  select *
  from public.secure_prompt_heads
  where prompt_key = p_prompt_key;
end;
$$;

create or replace function public.get_published_secure_prompt(
  p_prompt_key text
)
returns table (
  id uuid,
  prompt_key text,
  ciphertext text,
  iv text,
  encryption_key_version integer,
  enabled boolean
)
language sql
security definer
set search_path = pg_catalog, public
as $$
  select
    v.id,
    h.prompt_key,
    v.ciphertext,
    v.iv,
    v.encryption_key_version,
    h.enabled
  from public.secure_prompt_heads h
  left join public.secure_prompt_versions v
    on v.id = h.published_version_id
   and v.prompt_key = h.prompt_key
  where h.prompt_key = p_prompt_key
    and p_prompt_key = 'supreme_chat'
  limit 1;
$$;

create or replace function public.check_supreme_chat_rate_limit(
  p_subject_hashes text[],
  p_limit integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_subject_hash text;
  v_request_count integer;
  v_allowed boolean := true;
begin
  if cardinality(p_subject_hashes) not between 1 and 2
    or p_limit not between 1 and 1000
    or p_window_seconds not between 10 and 3600
  then
    raise exception 'SUPREME_RATE_LIMIT_INPUT_INVALID' using errcode = 'P0001';
  end if;

  foreach v_subject_hash in array p_subject_hashes
  loop
    if v_subject_hash !~ '^[0-9a-f]{64}$' then
      raise exception 'SUPREME_RATE_LIMIT_SUBJECT_INVALID' using errcode = 'P0001';
    end if;

    insert into public.supreme_chat_rate_limits(
      subject_hash,
      request_count,
      window_started_at,
      updated_at
    )
    values (v_subject_hash, 1, now(), now())
    on conflict (subject_hash) do update
    set
      request_count = case
        when public.supreme_chat_rate_limits.window_started_at
          <= now() - make_interval(secs => p_window_seconds)
        then 1
        else public.supreme_chat_rate_limits.request_count + 1
      end,
      window_started_at = case
        when public.supreme_chat_rate_limits.window_started_at
          <= now() - make_interval(secs => p_window_seconds)
        then now()
        else public.supreme_chat_rate_limits.window_started_at
      end,
      updated_at = now()
    returning request_count into v_request_count;

    if v_request_count > p_limit then
      v_allowed := false;
    end if;
  end loop;

  return v_allowed;
end;
$$;

create or replace function public.cleanup_supreme_chat_rate_limits()
returns bigint
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_deleted_count bigint;
begin
  delete from public.supreme_chat_rate_limits
  where updated_at < now() - interval '24 hours';

  get diagnostics v_deleted_count = row_count;
  return v_deleted_count;
end;
$$;

set constraints
  secure_prompt_heads_draft_version_fk,
  secure_prompt_heads_published_version_fk
  immediate;

alter table public.secure_prompt_heads enable row level security;
alter table public.secure_prompt_versions enable row level security;
alter table public.supreme_chat_rate_limits enable row level security;

revoke all on table public.secure_prompt_heads from public, anon, authenticated;
revoke all on table public.secure_prompt_versions from public, anon, authenticated;
revoke all on table public.secure_prompt_heads from service_role;
revoke all on table public.secure_prompt_versions from service_role;
revoke all on table public.supreme_chat_rate_limits from public, anon, authenticated;
revoke all on table public.supreme_chat_rate_limits from service_role;
grant select on table public.secure_prompt_heads to service_role;
grant select on table public.secure_prompt_versions to service_role;

revoke all on function public.prevent_secure_prompt_version_mutation() from public, anon, authenticated;
revoke all on function public.prevent_active_secure_prompt_version_delete() from public, anon, authenticated;
revoke all on function public.save_secure_prompt_draft(text, uuid, text, text, integer, text, integer, bigint, uuid, text, text, text) from public, anon, authenticated, service_role;
revoke all on function public.publish_secure_prompt_version(text, uuid, bigint, uuid, text, text, text, text) from public, anon, authenticated, service_role;
revoke all on function public.disable_secure_prompt(text, uuid, text, text, text) from public, anon, authenticated, service_role;
revoke all on function public.get_published_secure_prompt(text) from public, anon, authenticated, service_role;
revoke all on function public.check_supreme_chat_rate_limit(text[], integer, integer) from public, anon, authenticated, service_role;
revoke all on function public.cleanup_supreme_chat_rate_limits() from public, anon, authenticated, service_role;

grant execute on function public.save_secure_prompt_draft(text, uuid, text, text, integer, text, integer, bigint, uuid, text, text, text) to service_role;
grant execute on function public.publish_secure_prompt_version(text, uuid, bigint, uuid, text, text, text, text) to service_role;
grant execute on function public.disable_secure_prompt(text, uuid, text, text, text) to service_role;
grant execute on function public.get_published_secure_prompt(text) to service_role;
grant execute on function public.check_supreme_chat_rate_limit(text[], integer, integer) to service_role;
grant execute on function public.cleanup_supreme_chat_rate_limits() to service_role;

commit;
