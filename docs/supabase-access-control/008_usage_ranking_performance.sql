-- Run outside a transaction: PostgreSQL does not allow CREATE INDEX CONCURRENTLY
-- inside a transaction block. This migration only adds read-path indexes and
-- does not rewrite existing data.

create index concurrently if not exists idx_usage_events_ranking_recent
  on public.usage_events(created_at desc, user_id)
  include (count, provider, status, feature_key)
  where user_id is not null;

create index concurrently if not exists idx_usage_events_ranking_provider_status_recent
  on public.usage_events(provider, status, created_at desc, user_id)
  include (count, feature_key)
  where user_id is not null;

create index concurrently if not exists idx_user_plans_active_plan_user_current
  on public.user_plans(plan_id, user_id, starts_at desc, expires_at)
  where status = 'active';
