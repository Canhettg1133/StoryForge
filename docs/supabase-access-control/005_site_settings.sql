create table if not exists public.site_settings (
  key text primary key,
  value_json jsonb not null default '{}'::jsonb,
  revision integer not null default 1 check (revision >= 1),
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists site_settings_touch_updated_at on public.site_settings;
create trigger site_settings_touch_updated_at
  before update on public.site_settings
  for each row execute function public.touch_updated_at();

create or replace function public.upsert_site_announcement(
  p_value_json jsonb,
  p_content_changed boolean,
  p_updated_by uuid
)
returns setof public.site_settings
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.site_settings(key, value_json, revision, updated_by)
  values ('site_announcement', coalesce(p_value_json, '{}'::jsonb), 1, p_updated_by)
  on conflict (key) do update set
    value_json = excluded.value_json,
    revision = case
      when coalesce(p_content_changed, false) then public.site_settings.revision + 1
      else public.site_settings.revision
    end,
    updated_by = excluded.updated_by,
    updated_at = now();

  return query
  select *
  from public.site_settings
  where key = 'site_announcement';
end;
$$;

alter table public.site_settings enable row level security;
