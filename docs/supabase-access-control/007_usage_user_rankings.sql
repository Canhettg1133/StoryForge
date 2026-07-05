create or replace function public.admin_usage_user_rankings(
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_task text default 'all',
  p_plan text default 'vip_lifetime',
  p_provider text default '',
  p_status text default '',
  p_search text default '',
  p_limit integer default 20
)
returns table (
  rank_order integer,
  user_id uuid,
  email text,
  display_name text,
  plan_key text,
  plan_name text,
  total_count bigint,
  event_count bigint,
  ok_count bigint,
  error_count bigint,
  blocked_count bigint,
  last_used_at timestamptz,
  task_summary text,
  matching_user_count bigint,
  matching_total_count bigint,
  matching_event_count bigint,
  matching_ok_count bigint,
  matching_issue_count bigint,
  matching_last_used_at timestamptz
)
language sql
security definer
set search_path = public
as $$
with normalized as (
  select
    coalesce(p_from, null) as from_at,
    coalesce(p_to, null) as to_at,
    case
      when lower(coalesce(p_task, 'all')) in (
        'all',
        'writing',
        'translation',
        'story_chat',
        'free_chat',
        'planning',
        'analysis',
        'image_generation'
      ) then lower(coalesce(p_task, 'all'))
      else 'all'
    end as task_key,
    case
      when lower(coalesce(p_plan, 'vip_lifetime')) in ('vip', 'lifetime') then lower(coalesce(p_plan, 'vip_lifetime'))
      else 'vip_lifetime'
    end as plan_key,
    lower(coalesce(p_provider, '')) as provider_key,
    lower(coalesce(p_status, '')) as status_key,
    trim(coalesce(p_search, '')) as search_text,
    case
      when coalesce(p_limit, 20) > 50 then 50
      when coalesce(p_limit, 20) in (10, 20, 50) then coalesce(p_limit, 20)
      else 20
    end as row_limit
),
active_plans as (
  select distinct on (user_plan.user_id)
    user_plan.user_id,
    plan.key as plan_key,
    plan.name as plan_name
  from public.user_plans user_plan
  join public.plans plan on plan.id = user_plan.plan_id
  cross join normalized input
  where user_plan.status = 'active'
    and user_plan.starts_at <= now()
    and (user_plan.expires_at is null or user_plan.expires_at > now())
    and plan.key in ('vip', 'lifetime')
    and (input.plan_key = 'vip_lifetime' or plan.key = input.plan_key)
  order by
    user_plan.user_id,
    case plan.key when 'lifetime' then 2 when 'vip' then 1 else 0 end desc,
    user_plan.starts_at desc
),
candidate as (
  select
    usage_event.user_id,
    profile.email,
    profile.display_name,
    active_plans.plan_key,
    active_plans.plan_name,
    usage_event.count,
    usage_event.status,
    usage_event.created_at,
    case
      when usage_event.feature_key = 'translator.access'
        or usage_event.metadata ->> 'workflowFeature' = 'translator.access'
        then 'translation'
      when usage_event.metadata ->> 'taskGroup' = 'story_chat'
        then 'story_chat'
      when usage_event.metadata ->> 'taskGroup' = 'free_chat'
        then 'free_chat'
      when usage_event.metadata ->> 'taskGroup' = 'story_planning'
        then 'planning'
      when usage_event.metadata ->> 'taskGroup' = 'story_analysis'
        then 'analysis'
      when usage_event.metadata ->> 'action' = 'image_generation'
        or usage_event.metadata ->> 'taskType' = 'cover_generation'
        or usage_event.metadata ->> 'taskGroup' = 'story_publishing'
        then 'image_generation'
      when usage_event.metadata ->> 'taskGroup' = 'story_writing'
        or usage_event.metadata ->> 'taskType' in ('continue', 'scene_draft', 'arc_chapter_draft', 'rewrite', 'expand', 'style_write')
        then 'writing'
      else 'other'
    end as task_key,
    case
      when usage_event.feature_key = 'translator.access'
        or usage_event.metadata ->> 'workflowFeature' = 'translator.access'
        then 'Dịch truyện'
      when usage_event.metadata ->> 'taskGroup' = 'story_chat'
        then 'Chat truyện'
      when usage_event.metadata ->> 'taskGroup' = 'free_chat'
        then 'Chat tự do'
      when usage_event.metadata ->> 'taskGroup' = 'story_planning'
        then 'Lên kế hoạch'
      when usage_event.metadata ->> 'taskGroup' = 'story_analysis'
        then 'Phân tích'
      when usage_event.metadata ->> 'action' = 'image_generation'
        or usage_event.metadata ->> 'taskType' = 'cover_generation'
        or usage_event.metadata ->> 'taskGroup' = 'story_publishing'
        then 'Tạo ảnh'
      when usage_event.metadata ->> 'taskGroup' = 'story_writing'
        or usage_event.metadata ->> 'taskType' in ('continue', 'scene_draft', 'arc_chapter_draft', 'rewrite', 'expand', 'style_write')
        then 'Viết truyện'
      else 'Tác vụ khác'
    end as task_label
  from public.usage_events usage_event
  join active_plans on active_plans.user_id = usage_event.user_id
  join public.profiles profile on profile.user_id = usage_event.user_id
  cross join normalized input
  where (input.from_at is null or usage_event.created_at >= input.from_at)
    and (input.to_at is null or usage_event.created_at < input.to_at)
    and (input.provider_key = '' or lower(usage_event.provider) = input.provider_key)
    and (input.status_key = '' or lower(usage_event.status) = input.status_key)
    and (
      input.search_text = ''
      or profile.email ilike '%' || input.search_text || '%'
      or profile.display_name ilike '%' || input.search_text || '%'
      or profile.user_id::text ilike '%' || input.search_text || '%'
    )
),
grouped as (
  select
    candidate.user_id,
    candidate.email,
    candidate.display_name,
    candidate.plan_key,
    candidate.plan_name,
    sum(greatest(coalesce(candidate.count, 0), 0)) as total_count,
    count(*) as event_count,
    sum(case when lower(candidate.status) in ('ok', 'success') then greatest(coalesce(candidate.count, 0), 0) else 0 end) as ok_count,
    sum(case when lower(candidate.status) in ('error', 'failed') then greatest(coalesce(candidate.count, 0), 0) else 0 end) as error_count,
    sum(case when lower(candidate.status) in ('blocked', 'denied') then greatest(coalesce(candidate.count, 0), 0) else 0 end) as blocked_count,
    max(candidate.created_at) as last_used_at,
    string_agg(distinct candidate.task_label, ', ' order by candidate.task_label) as task_summary
  from candidate
  cross join normalized input
  where input.task_key = 'all' or candidate.task_key = input.task_key
  group by
    candidate.user_id,
    candidate.email,
    candidate.display_name,
    candidate.plan_key,
    candidate.plan_name
),
ranked as (
  select
    row_number() over (order by grouped.total_count desc, grouped.last_used_at desc, grouped.user_id asc)::integer as rank_order,
    count(*) over () as matching_user_count,
    sum(grouped.total_count) over () as matching_total_count,
    sum(grouped.event_count) over () as matching_event_count,
    sum(grouped.ok_count) over () as matching_ok_count,
    sum(grouped.error_count + grouped.blocked_count) over () as matching_issue_count,
    max(grouped.last_used_at) over () as matching_last_used_at,
    grouped.*
  from grouped
)
select
  ranked.rank_order,
  ranked.user_id,
  ranked.email,
  ranked.display_name,
  ranked.plan_key,
  ranked.plan_name,
  ranked.total_count,
  ranked.event_count,
  ranked.ok_count,
  ranked.error_count,
  ranked.blocked_count,
  ranked.last_used_at,
  ranked.task_summary,
  ranked.matching_user_count,
  ranked.matching_total_count,
  ranked.matching_event_count,
  ranked.matching_ok_count,
  ranked.matching_issue_count,
  ranked.matching_last_used_at
from ranked
cross join normalized input
order by ranked.rank_order
limit (select row_limit from normalized);
$$;
