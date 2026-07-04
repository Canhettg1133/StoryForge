create extension if not exists pgcrypto;

create table if not exists public.story_mirror_settings (
  key text primary key default 'global',
  enabled boolean not null default false,
  test_only boolean not null default true,
  test_user_ids uuid[] not null default '{}'::uuid[],
  per_user_quota_bytes bigint not null default 104857600,
  retention_days integer not null default 90,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint story_mirror_settings_key_global check (key = 'global'),
  constraint story_mirror_settings_quota_positive check (per_user_quota_bytes > 0),
  constraint story_mirror_settings_retention_positive check (retention_days between 1 and 365)
);

insert into public.story_mirror_settings (key)
values ('global')
on conflict (key) do nothing;

create table if not exists public.story_mirror_projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  client_project_id text not null,
  title text not null default '',
  genre text not null default '',
  status text not null default 'active',
  word_count integer not null default 0,
  storage_used_bytes bigint not null default 0,
  client_updated_at timestamptz,
  last_synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, client_project_id)
);

create table if not exists public.story_mirror_chapters (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references public.story_mirror_projects(id) on delete cascade,
  client_project_id text not null,
  client_chapter_id text not null,
  title text not null default '',
  order_index integer not null default 0,
  status text not null default 'draft',
  word_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, client_chapter_id)
);

create table if not exists public.story_mirror_scenes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references public.story_mirror_projects(id) on delete cascade,
  chapter_id uuid not null references public.story_mirror_chapters(id) on delete cascade,
  client_project_id text not null,
  client_chapter_id text not null,
  client_scene_id text not null,
  title text not null default '',
  order_index integer not null default 0,
  status text not null default 'draft',
  word_count integer not null default 0,
  content_hash text not null,
  size_bytes bigint not null default 0,
  storage_key text not null,
  client_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, client_scene_id)
);

create table if not exists public.story_mirror_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  idempotency_key text not null,
  resource_type text not null,
  client_project_id text not null default '',
  client_scene_id text not null default '',
  status text not null default 'queued',
  error_code text not null default '',
  error_message text not null default '',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, idempotency_key)
);

create table if not exists public.story_mirror_admin_audit (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references auth.users(id) on delete set null,
  action text not null,
  target_user_id uuid references auth.users(id) on delete set null,
  project_id uuid references public.story_mirror_projects(id) on delete set null,
  scene_id uuid references public.story_mirror_scenes(id) on delete set null,
  details_json jsonb not null default '{}'::jsonb,
  ip_address text not null default '',
  user_agent text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists idx_story_mirror_projects_user_updated
  on public.story_mirror_projects (user_id, updated_at desc);

create index if not exists idx_story_mirror_chapters_project_order
  on public.story_mirror_chapters (project_id, order_index);

create index if not exists idx_story_mirror_scenes_project_order
  on public.story_mirror_scenes (project_id, order_index);

create index if not exists idx_story_mirror_scenes_chapter_order
  on public.story_mirror_scenes (chapter_id, order_index);

create index if not exists idx_story_mirror_events_user_created
  on public.story_mirror_events (user_id, created_at desc);

create index if not exists idx_story_mirror_admin_audit_created
  on public.story_mirror_admin_audit (created_at desc);

alter table public.story_mirror_settings enable row level security;
alter table public.story_mirror_projects enable row level security;
alter table public.story_mirror_chapters enable row level security;
alter table public.story_mirror_scenes enable row level security;
alter table public.story_mirror_events enable row level security;
alter table public.story_mirror_admin_audit enable row level security;

drop policy if exists "story_mirror_projects_own" on public.story_mirror_projects;
drop policy if exists "story_mirror_chapters_own" on public.story_mirror_chapters;
drop policy if exists "story_mirror_scenes_own" on public.story_mirror_scenes;
drop policy if exists "story_mirror_events_own" on public.story_mirror_events;

create policy "story_mirror_projects_own"
  on public.story_mirror_projects
  for select
  using ((select auth.uid()) = user_id);

create policy "story_mirror_chapters_own"
  on public.story_mirror_chapters
  for select
  using ((select auth.uid()) = user_id);

create policy "story_mirror_scenes_own"
  on public.story_mirror_scenes
  for select
  using ((select auth.uid()) = user_id);

create policy "story_mirror_events_own"
  on public.story_mirror_events
  for select
  using ((select auth.uid()) = user_id);
