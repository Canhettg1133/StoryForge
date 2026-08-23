-- Dynamic public setup-guide buttons. Content is public, while updates and
-- their audit records are committed atomically by a service-role-only RPC.

begin;

insert into public.site_settings(key, value_json, revision)
values (
  'setup_guides',
  jsonb_build_object(
    'items',
    jsonb_build_array(
      jsonb_build_object('id', 'gemini-direct', 'label', 'Hướng dẫn Gemini Direct', 'url', '/guide', 'enabled', true, 'icon', 'book'),
      jsonb_build_object('id', 'gemini-proxy', 'label', 'Hướng dẫn Gemini Proxy', 'url', '/guide/proxy', 'enabled', true, 'icon', 'book'),
      jsonb_build_object('id', 'writing-setup', 'label', 'Hướng dẫn setup để viết truyện', 'url', 'https://youtu.be/4tf6rXf_nmo?si=8nnL0KGT1eKNNgYJ', 'enabled', true, 'icon', 'book'),
      jsonb_build_object('id', 'translation-guide', 'label', 'Hướng dẫn dịch truyện', 'url', 'https://youtu.be/jawxmA0Iyfk?si=dHkRVQXAV58JLl-o', 'enabled', true, 'icon', 'book'),
      jsonb_build_object('id', 'google-ai-studio', 'label', 'Mở Google AI Studio', 'url', 'https://aistudio.google.com/app/apikey', 'enabled', true, 'icon', 'external')
    )
  ),
  1
)
on conflict (key) do nothing;

alter table public.admin_audit_logs
  add column if not exists mutation_id uuid;

create unique index if not exists idx_admin_audit_logs_mutation_id
  on public.admin_audit_logs(mutation_id)
  where mutation_id is not null;

drop function if exists public.update_setup_guides(jsonb, integer, uuid);
drop function if exists public.update_setup_guides(jsonb, integer, uuid, uuid, text, text);

create function public.update_setup_guides(
  p_items jsonb,
  p_expected_revision integer,
  p_updated_by uuid,
  p_mutation_id uuid,
  p_client_ip text,
  p_user_agent text
)
returns table (
  key text,
  value_json jsonb,
  revision integer,
  previous_value_json jsonb,
  previous_revision integer,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_current public.site_settings%rowtype;
  v_saved public.site_settings%rowtype;
  v_audit public.admin_audit_logs%rowtype;
  v_item jsonb;
  v_id text;
  v_label text;
  v_url text;
  v_icon text;
  v_before jsonb;
  v_after jsonb;
begin
  if p_updated_by is null then
    raise exception 'ADMIN_ACTOR_REQUIRED';
  end if;
  if p_mutation_id is null then
    raise exception 'ADMIN_MUTATION_ID_REQUIRED';
  end if;
  if p_expected_revision is null or p_expected_revision < 1 then
    raise exception 'SETUP_GUIDES_REVISION_INVALID';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'SETUP_GUIDES_ITEMS_INVALID';
  end if;
  if jsonb_array_length(p_items) > 12 then
    raise exception 'SETUP_GUIDES_ITEMS_LIMIT';
  end if;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    if jsonb_typeof(v_item) <> 'object'
      or exists (
        select 1
        from jsonb_object_keys(v_item) as field_name
        where field_name not in ('id', 'label', 'url', 'enabled', 'icon')
      )
    then
      raise exception 'SETUP_GUIDES_ITEM_INVALID';
    end if;

    v_id := btrim(coalesce(v_item->>'id', ''));
    v_label := btrim(coalesce(v_item->>'label', ''));
    v_url := btrim(coalesce(v_item->>'url', ''));
    v_icon := lower(btrim(coalesce(v_item->>'icon', '')));

    if v_id !~ '^[a-z0-9][a-z0-9_-]{0,63}$' then
      raise exception 'SETUP_GUIDES_ID_INVALID';
    end if;
    if char_length(v_label) < 1 or char_length(v_label) > 64 or v_label ~ '[[:cntrl:]<>]' then
      raise exception 'SETUP_GUIDES_LABEL_INVALID';
    end if;
    if char_length(v_url) < 1 or char_length(v_url) > 2048 or v_url ~ '[[:cntrl:]<>\\]' then
      raise exception 'SETUP_GUIDES_URL_INVALID';
    end if;
    if not (
      (left(v_url, 1) = '/' and left(v_url, 2) <> '//')
      or (
        v_url ~* '^https://[^/?#]+'
        and v_url !~* '^https://[^/?#]*@'
      )
    ) then
      raise exception 'SETUP_GUIDES_URL_INVALID';
    end if;
    if jsonb_typeof(v_item->'enabled') is distinct from 'boolean' then
      raise exception 'SETUP_GUIDES_ENABLED_INVALID';
    end if;
    if v_icon not in ('book', 'external') then
      raise exception 'SETUP_GUIDES_ICON_INVALID';
    end if;
  end loop;

  if exists (
    select 1
    from jsonb_array_elements(p_items) item
    group by btrim(item->>'id')
    having count(*) > 1
  ) then
    raise exception 'SETUP_GUIDES_ID_DUPLICATE';
  end if;

  -- Serialize equal retry tokens before reading the audit row. This makes an
  -- in-flight retry wait for, then reuse, the first committed result.
  perform pg_advisory_xact_lock(hashtextextended(p_mutation_id::text, 0));

  select settings.*
  into v_current
  from public.site_settings as settings
  where settings.key = 'setup_guides'
  for update;

  if not found then
    raise exception 'SETUP_GUIDES_NOT_INITIALIZED';
  end if;

  select audit.*
  into v_audit
  from public.admin_audit_logs as audit
  where audit.mutation_id = p_mutation_id;

  if found then
    if v_audit.action is distinct from 'setup_guides.update'
      or v_audit.actor_user_id is distinct from p_updated_by
      or (v_audit.before_json->>'revision')::integer is distinct from p_expected_revision
      or v_audit.after_json->'items' is distinct from p_items
    then
      raise exception 'ADMIN_MUTATION_ID_CONFLICT';
    end if;

    return query select
      'setup_guides'::text,
      jsonb_build_object('items', v_audit.after_json->'items'),
      (v_audit.after_json->>'revision')::integer,
      jsonb_build_object('items', v_audit.before_json->'items'),
      (v_audit.before_json->>'revision')::integer,
      v_audit.created_at;
    return;
  end if;

  if v_current.revision <> p_expected_revision then
    raise exception 'SETUP_GUIDES_REVISION_CONFLICT';
  end if;

  update public.site_settings as settings
  set value_json = jsonb_build_object('items', p_items),
      revision = settings.revision + 1,
      updated_by = p_updated_by,
      updated_at = clock_timestamp()
  where settings.key = 'setup_guides'
  returning settings.* into v_saved;

  v_before := jsonb_build_object(
    'key', 'setup_guides',
    'revision', v_current.revision,
    'items', v_current.value_json->'items'
  );
  v_after := jsonb_build_object(
    'key', 'setup_guides',
    'revision', v_saved.revision,
    'items', p_items
  );

  insert into public.admin_audit_logs(
    mutation_id,
    actor_user_id,
    action,
    before_json,
    after_json,
    actor_snapshot,
    target_snapshot,
    action_summary,
    change_summary,
    resource_label,
    ip_address,
    user_agent
  ) values (
    p_mutation_id,
    p_updated_by,
    'setup_guides.update',
    v_before,
    v_after,
    '{}'::jsonb,
    '{}'::jsonb,
    'Cập nhật danh sách hướng dẫn setup',
    format('Revision %s → %s', v_current.revision, v_saved.revision),
    'Setup guides',
    left(coalesce(p_client_ip, ''), 255),
    left(coalesce(p_user_agent, ''), 512)
  );

  return query select
    v_saved.key,
    v_saved.value_json,
    v_saved.revision,
    v_current.value_json,
    v_current.revision,
    v_saved.updated_at;
end;
$$;

revoke all on function public.update_setup_guides(jsonb, integer, uuid, uuid, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.update_setup_guides(jsonb, integer, uuid, uuid, text, text)
  to service_role;

commit;


