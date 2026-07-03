alter table public.admin_audit_logs
  add column if not exists actor_snapshot jsonb not null default '{}'::jsonb,
  add column if not exists target_snapshot jsonb not null default '{}'::jsonb,
  add column if not exists action_summary text not null default '',
  add column if not exists change_summary text not null default '',
  add column if not exists resource_label text not null default '';

