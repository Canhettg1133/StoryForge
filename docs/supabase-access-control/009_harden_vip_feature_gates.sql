-- Add server-enforced VIP gates for Story Mirror and AI project cover generation.
-- Safe to run more than once.

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

insert into public.features(key, name, description, category, active)
values
  (
    'story_mirror.access',
    'Story Mirror',
    'Cho phép đồng bộ Story Mirror qua worker backend.',
    'story_mirror',
    true
  ),
  (
    'project.cover_generation',
    'Tạo bìa AI',
    'Cho phép tạo bìa dự án bằng AI qua relay backend.',
    'project',
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
),
feature_map as (
  select key from public.features
  where key in (
    'story_mirror.access',
    'project.cover_generation'
  )
)
insert into public.plan_features(plan_id, feature_key, enabled)
select plan_map.id, feature_map.key, true
from plan_map
cross join feature_map
on conflict (plan_id, feature_key) do update set
  enabled = excluded.enabled,
  updated_at = now();
