-- StoryForge Admin API schema.
-- Run in Supabase SQL editor. Admin API uses the service role key through a Worker.

create table if not exists public.storyforge_user_access (
  user_id uuid primary key,
  email text,
  role text not null default 'user' check (role in ('user', 'support', 'admin', 'owner')),
  status text not null default 'active' check (status in ('active', 'suspended', 'disabled')),
  plan text not null default 'free',
  override_reason text,
  override_until timestamptz,
  override_payload jsonb not null default '{}'::jsonb,
  last_seen_at timestamptz,
  auth_updated_at timestamptz,
  access_updated_at timestamptz,
  plan_updated_at timestamptz,
  status_updated_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.storyforge_features (
  id bigserial primary key,
  key text not null unique,
  name text not null,
  description text,
  category text not null default 'core',
  enabled boolean not null default true,
  requires_plan text,
  updated_at timestamptz not null default now()
);

create table if not exists public.storyforge_plan_features (
  id bigserial primary key,
  plan text not null,
  feature_key text not null,
  enabled boolean not null default true,
  limits jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  unique (plan, feature_key)
);

create table if not exists public.storyforge_plan_catalog (
  id bigserial primary key,
  key text not null unique,
  name text not null,
  description text,
  enabled boolean not null default true,
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.storyforge_usage (
  id bigserial primary key,
  user_id uuid,
  email text,
  period text,
  requests integer not null default 0,
  tokens bigint not null default 0,
  cost_cents integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.storyforge_consent_records (
  id bigserial primary key,
  user_id uuid,
  email text,
  kind text not null default 'adult_content',
  version text not null default 'v1',
  accepted boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.storyforge_audit_logs (
  id bigserial primary key,
  actor_user_id text,
  actor_email text,
  actor_role text,
  action text not null,
  target_type text not null,
  target_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_storyforge_user_access_role on public.storyforge_user_access (role);
create index if not exists idx_storyforge_user_access_plan on public.storyforge_user_access (plan);
create index if not exists idx_storyforge_features_category on public.storyforge_features (category);
create index if not exists idx_storyforge_plan_features_plan on public.storyforge_plan_features (plan);
create index if not exists idx_storyforge_audit_created_at on public.storyforge_audit_logs (created_at desc);
create index if not exists idx_storyforge_usage_user_period on public.storyforge_usage (user_id, period);
create index if not exists idx_storyforge_consent_user_kind on public.storyforge_consent_records (user_id, kind);

alter table public.storyforge_user_access enable row level security;
alter table public.storyforge_features enable row level security;
alter table public.storyforge_plan_features enable row level security;
alter table public.storyforge_plan_catalog enable row level security;
alter table public.storyforge_usage enable row level security;
alter table public.storyforge_consent_records enable row level security;
alter table public.storyforge_audit_logs enable row level security;
