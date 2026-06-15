create extension if not exists pgcrypto;

create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null default '',
  display_name text not null default '',
  system_role text not null default 'user' check (system_role in ('user', 'support', 'admin', 'owner')),
  status text not null default 'active' check (status in ('active', 'banned', 'deleted')),
  age_confirmed_at timestamptz,
  adult_terms_accepted_at timestamptz,
  adult_terms_version text not null default '',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.plans (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  name text not null,
  description text not null default '',
  active boolean not null default true,
  sort_order integer not null default 100,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.user_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  plan_id uuid not null references public.plans(id) on delete restrict,
  status text not null default 'active' check (status in ('active', 'scheduled', 'expired', 'cancelled')),
  starts_at timestamptz not null default now(),
  expires_at timestamptz,
  source text not null default 'manual',
  granted_by uuid references auth.users(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (expires_at is null or expires_at > starts_at)
);

drop index if exists public.one_active_plan_per_user;
drop index if exists public.one_scheduled_plan_per_user;

create index if not exists idx_user_plans_active_union
  on public.user_plans(user_id, plan_id, starts_at desc, expires_at)
  where status = 'active';

create index if not exists idx_user_plans_scheduled
  on public.user_plans(user_id, starts_at desc)
  where status = 'scheduled';

create index if not exists idx_user_plans_resolver
  on public.user_plans(user_id, status, starts_at desc, expires_at);

create table if not exists public.features (
  key text primary key,
  name text not null,
  description text not null default '',
  category text not null default 'general',
  active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.plan_features (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.plans(id) on delete cascade,
  feature_key text not null references public.features(key) on delete cascade,
  enabled boolean not null default true,
  limit_json jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (plan_id, feature_key)
);

create index if not exists idx_plan_features_plan_feature
  on public.plan_features(plan_id, feature_key);

create table if not exists public.user_entitlement_overrides (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  feature_key text not null references public.features(key) on delete cascade,
  enabled boolean not null,
  reason text not null default '',
  limit_json jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  expires_at timestamptz,
  revoked_at timestamptz,
  granted_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_user_entitlement_overrides_latest
  on public.user_entitlement_overrides(user_id, feature_key, revoked_at, expires_at, created_at desc, id desc);

create table if not exists public.consent_versions (
  id uuid primary key default gen_random_uuid(),
  key text not null,
  version text not null,
  title text not null,
  body text not null default '',
  active boolean not null default false,
  effective_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (key, version)
);

create unique index if not exists one_active_consent_version_per_key
  on public.consent_versions(key)
  where active = true;

create table if not exists public.usage_events (
  id uuid primary key default gen_random_uuid(),
  request_id text not null,
  user_id uuid references public.profiles(user_id) on delete set null,
  feature_key text references public.features(key) on delete set null,
  provider text not null default '',
  model text not null default '',
  event_type text not null default 'request',
  count integer not null default 1,
  request_size integer not null default 0,
  response_size integer not null default 0,
  status text not null default 'ok',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (request_id, event_type)
);

create index if not exists idx_usage_events_user_created
  on public.usage_events(user_id, created_at desc);

create index if not exists idx_usage_events_feature_provider_created
  on public.usage_events(feature_key, provider, created_at desc);

create table if not exists public.admin_audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references public.profiles(user_id) on delete set null,
  action text not null,
  target_user_id uuid references public.profiles(user_id) on delete set null,
  target_feature_key text references public.features(key) on delete set null,
  before_json jsonb not null default '{}'::jsonb,
  after_json jsonb not null default '{}'::jsonb,
  ip_address text not null default '',
  user_agent text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists idx_admin_audit_logs_created
  on public.admin_audit_logs(created_at desc);

create index if not exists idx_admin_audit_logs_target_feature
  on public.admin_audit_logs(target_feature_key, created_at desc);

create table if not exists public.access_versions (
  user_id uuid primary key references public.profiles(user_id) on delete cascade,
  version integer not null default 1,
  updated_at timestamptz not null default now()
);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.ensure_access_version()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.access_versions(user_id, version, updated_at)
  values (new.user_id, 1, now())
  on conflict (user_id) do nothing;
  return new;
end;
$$;

create or replace function public.handle_new_auth_user_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles(
    user_id,
    email,
    display_name,
    metadata
  )
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(
      nullif(new.raw_user_meta_data ->> 'name', ''),
      nullif(new.raw_user_meta_data ->> 'full_name', ''),
      new.email,
      ''
    ),
    jsonb_build_object(
      'auth_created_at', new.created_at,
      'auth_updated_at', new.updated_at,
      'last_sign_in_at', new.last_sign_in_at,
      'provider', coalesce(new.raw_app_meta_data ->> 'provider', '')
    )
  )
  on conflict (user_id) do update set
    email = excluded.email,
    display_name = case
      when public.profiles.display_name = '' then excluded.display_name
      else public.profiles.display_name
    end,
    metadata = public.profiles.metadata || excluded.metadata,
    updated_at = now();

  return new;
end;
$$;

create or replace function public.bump_access_version(target_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if target_user_id is null then
    return;
  end if;

  insert into public.access_versions(user_id, version, updated_at)
  values (target_user_id, 2, now())
  on conflict (user_id)
  do update set
    version = public.access_versions.version + 1,
    updated_at = now();
end;
$$;

create or replace function public.bump_access_version_from_row()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_user_id uuid;
begin
  if tg_op = 'DELETE' then
    target_user_id = old.user_id;
  else
    target_user_id = new.user_id;
  end if;
  perform public.bump_access_version(target_user_id);
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create or replace function public.bump_all_access_versions()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.access_versions
  set version = version + 1,
      updated_at = now()
  where true;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function public.touch_updated_at();

drop trigger if exists profiles_ensure_access_version on public.profiles;
create trigger profiles_ensure_access_version
  after insert on public.profiles
  for each row execute function public.ensure_access_version();

drop trigger if exists profiles_bump_access_version on public.profiles;
create trigger profiles_bump_access_version
  after update of status, system_role, age_confirmed_at, adult_terms_accepted_at, adult_terms_version on public.profiles
  for each row execute function public.bump_access_version_from_row();

drop trigger if exists on_auth_user_created_access_profile on auth.users;
create trigger on_auth_user_created_access_profile
  after insert or update of email, raw_user_meta_data, raw_app_meta_data, last_sign_in_at on auth.users
  for each row execute function public.handle_new_auth_user_profile();

drop trigger if exists user_plans_touch_updated_at on public.user_plans;
create trigger user_plans_touch_updated_at
  before update on public.user_plans
  for each row execute function public.touch_updated_at();

drop trigger if exists user_plans_bump_access_version on public.user_plans;
create trigger user_plans_bump_access_version
  after insert or update or delete on public.user_plans
  for each row execute function public.bump_access_version_from_row();

drop trigger if exists features_touch_updated_at on public.features;
create trigger features_touch_updated_at
  before update on public.features
  for each row execute function public.touch_updated_at();

drop trigger if exists plan_features_touch_updated_at on public.plan_features;
create trigger plan_features_touch_updated_at
  before update on public.plan_features
  for each row execute function public.touch_updated_at();

drop trigger if exists plan_features_bump_all_access_versions on public.plan_features;
create trigger plan_features_bump_all_access_versions
  after insert or update or delete on public.plan_features
  for each row execute function public.bump_all_access_versions();

drop trigger if exists user_entitlement_overrides_touch_updated_at on public.user_entitlement_overrides;
create trigger user_entitlement_overrides_touch_updated_at
  before update on public.user_entitlement_overrides
  for each row execute function public.touch_updated_at();

drop trigger if exists user_entitlement_overrides_bump_access_version on public.user_entitlement_overrides;
create trigger user_entitlement_overrides_bump_access_version
  after insert or update or delete on public.user_entitlement_overrides
  for each row execute function public.bump_access_version_from_row();

drop trigger if exists consent_versions_bump_all_access_versions on public.consent_versions;
create trigger consent_versions_bump_all_access_versions
  after insert or update or delete on public.consent_versions
  for each row execute function public.bump_all_access_versions();

alter table public.profiles enable row level security;
alter table public.plans enable row level security;
alter table public.user_plans enable row level security;
alter table public.features enable row level security;
alter table public.plan_features enable row level security;
alter table public.user_entitlement_overrides enable row level security;
alter table public.consent_versions enable row level security;
alter table public.usage_events enable row level security;
alter table public.admin_audit_logs enable row level security;
alter table public.access_versions enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
  on public.profiles for select
  using (auth.uid() = user_id);

drop policy if exists "profiles_update_own_consent" on public.profiles;

drop policy if exists "plans_select_authenticated" on public.plans;
create policy "plans_select_authenticated"
  on public.plans for select
  to authenticated
  using (active = true);

drop policy if exists "features_select_authenticated" on public.features;
create policy "features_select_authenticated"
  on public.features for select
  to authenticated
  using (active = true);

drop policy if exists "plan_features_select_authenticated" on public.plan_features;
create policy "plan_features_select_authenticated"
  on public.plan_features for select
  to authenticated
  using (true);

drop policy if exists "user_plans_select_own" on public.user_plans;
create policy "user_plans_select_own"
  on public.user_plans for select
  using (auth.uid() = user_id);

drop policy if exists "overrides_select_own" on public.user_entitlement_overrides;
create policy "overrides_select_own"
  on public.user_entitlement_overrides for select
  using (auth.uid() = user_id);

drop policy if exists "consent_versions_select_authenticated" on public.consent_versions;
create policy "consent_versions_select_authenticated"
  on public.consent_versions for select
  to authenticated
  using (active = true);

drop policy if exists "usage_events_select_own" on public.usage_events;
create policy "usage_events_select_own"
  on public.usage_events for select
  using (auth.uid() = user_id);

drop policy if exists "access_versions_select_own" on public.access_versions;
create policy "access_versions_select_own"
  on public.access_versions for select
  using (auth.uid() = user_id);
