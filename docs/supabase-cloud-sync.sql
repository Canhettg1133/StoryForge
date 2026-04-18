create extension if not exists pgcrypto;

create table if not exists public.cloud_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  scope text not null check (scope in ('project', 'chat', 'prompt_bundle')),
  item_slug text not null,
  item_title text not null default '',
  payload_text text not null,
  payload_version integer not null default 1,
  source_updated_at bigint,
  size_bytes integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, scope, item_slug)
);

create index if not exists idx_cloud_snapshots_user_scope_updated
  on public.cloud_snapshots (user_id, scope, updated_at desc);

alter table public.cloud_snapshots enable row level security;

drop policy if exists "cloud_snapshots_select_own" on public.cloud_snapshots;
drop policy if exists "cloud_snapshots_insert_own" on public.cloud_snapshots;
drop policy if exists "cloud_snapshots_update_own" on public.cloud_snapshots;
drop policy if exists "cloud_snapshots_delete_own" on public.cloud_snapshots;

create policy "cloud_snapshots_select_own"
  on public.cloud_snapshots
  for select
  using (auth.uid() = user_id);

create policy "cloud_snapshots_insert_own"
  on public.cloud_snapshots
  for insert
  with check (auth.uid() = user_id);

create policy "cloud_snapshots_update_own"
  on public.cloud_snapshots
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "cloud_snapshots_delete_own"
  on public.cloud_snapshots
  for delete
  using (auth.uid() = user_id);
