create table if not exists public.prompt_settings (
  domain text not null,
  key text not null,
  content text not null default '',
  enabled boolean not null default false,
  revision integer not null default 1 check (revision >= 1),
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (domain, key),
  constraint prompt_settings_domain_check check (domain in ('translator', 'writing')),
  constraint prompt_settings_key_check check (
    key in ('convert', 'novel', 'wuxia', 'romance', 'adult', 'sacHiep', 'sacHiepPro', 'sacHiepENI')
  ),
  constraint prompt_settings_content_length_check check (char_length(content) <= 60000)
);

drop trigger if exists prompt_settings_touch_updated_at on public.prompt_settings;
create trigger prompt_settings_touch_updated_at
  before update on public.prompt_settings
  for each row execute function public.touch_updated_at();

create or replace function public.upsert_prompt_setting(
  p_domain text,
  p_key text,
  p_content text,
  p_enabled boolean,
  p_expected_revision integer,
  p_updated_by uuid
)
returns setof public.prompt_settings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current_revision integer;
begin
  if p_domain is distinct from 'translator' then
    raise exception 'PROMPT_SETTING_DOMAIN_UNSUPPORTED' using errcode = 'P0001';
  end if;

  if p_key not in ('convert', 'novel', 'wuxia', 'romance', 'adult', 'sacHiep', 'sacHiepPro', 'sacHiepENI') then
    raise exception 'PROMPT_SETTING_KEY_UNSUPPORTED' using errcode = 'P0001';
  end if;

  if p_expected_revision is null or p_expected_revision < 0 then
    raise exception 'PROMPT_SETTING_REVISION_REQUIRED' using errcode = 'P0001';
  end if;

  if char_length(coalesce(p_content, '')) > 60000 then
    raise exception 'PROMPT_SETTING_CONTENT_TOO_LONG' using errcode = 'P0001';
  end if;

  select revision into v_current_revision
  from public.prompt_settings
  where domain = p_domain and key = p_key
  for update;

  if found then
    if v_current_revision <> p_expected_revision then
      raise exception 'PROMPT_SETTING_REVISION_CONFLICT' using errcode = 'P0001';
    end if;

    update public.prompt_settings
    set
      content = coalesce(p_content, ''),
      enabled = coalesce(p_enabled, false),
      revision = revision + 1,
      updated_by = p_updated_by,
      updated_at = now()
    where domain = p_domain and key = p_key;
  else
    if p_expected_revision not in (0, 1) then
      raise exception 'PROMPT_SETTING_REVISION_CONFLICT' using errcode = 'P0001';
    end if;

    insert into public.prompt_settings(domain, key, content, enabled, revision, updated_by)
    values (p_domain, p_key, coalesce(p_content, ''), coalesce(p_enabled, false), 1, p_updated_by);
  end if;

  return query
  select *
  from public.prompt_settings
  where domain = p_domain and key = p_key;
end;
$$;

alter table public.prompt_settings enable row level security;

revoke all on function public.upsert_prompt_setting(text, text, text, boolean, integer, uuid) from public, anon, authenticated, service_role;
grant execute on function public.upsert_prompt_setting(text, text, text, boolean, integer, uuid) to service_role;
