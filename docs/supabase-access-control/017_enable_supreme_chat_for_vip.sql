-- Enable Chat Tối Thượng and Story Mirror for every active VIP and Lifetime plan.
-- The existing plan_features trigger refreshes access_versions only when a row changes.

begin;

insert into public.features(key, name, description, category, active)
values
  (
    'ai_chat.supreme',
    'Chat Tối Thượng',
    'Cho phép sử dụng chế độ Chat Tối Thượng với prompt bảo mật phía server.',
    'ai',
    true
  ),
  (
    'story_mirror.access',
    'Story Mirror',
    'Cho phép đồng bộ Story Mirror qua worker backend.',
    'story_mirror',
    true
  )
on conflict (key) do update
set
  name = excluded.name,
  description = excluded.description,
  category = excluded.category,
  active = excluded.active,
  updated_at = now()
where
  public.features.name is distinct from excluded.name
  or public.features.description is distinct from excluded.description
  or public.features.category is distinct from excluded.category
  or public.features.active is distinct from excluded.active;

with paid_plans as (
  select id
  from public.plans
  where key in ('vip', 'lifetime')
),
paid_features(feature_key) as (
  values
    ('ai_chat.supreme'),
    ('story_mirror.access')
)
insert into public.plan_features(plan_id, feature_key, enabled)
select paid_plans.id, paid_features.feature_key, true
from paid_plans
cross join paid_features
on conflict (plan_id, feature_key) do update
set
  enabled = excluded.enabled,
  updated_at = now()
where public.plan_features.enabled is distinct from excluded.enabled;

commit;
