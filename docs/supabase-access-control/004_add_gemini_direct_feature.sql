-- Add Gemini Direct to the VIP/access catalog.
-- Safe to run more than once.

insert into public.features(key, name, description, category, active)
values (
  'provider.gemini_direct',
  'Gemini Direct',
  'Cho phép dùng Gemini Direct qua API key AI Studio.',
  'provider',
  true
)
on conflict (key) do update set
  name = excluded.name,
  description = excluded.description,
  category = excluded.category,
  active = excluded.active,
  updated_at = now();

with plan_map as (
  select id, key from public.plans where key in ('vip', 'lifetime')
)
insert into public.plan_features(plan_id, feature_key, enabled)
select plan_map.id, 'provider.gemini_direct', true
from plan_map
on conflict (plan_id, feature_key) do update set
  enabled = excluded.enabled,
  updated_at = now();
