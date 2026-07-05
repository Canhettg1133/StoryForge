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
    p_from as from_at,
    p_to as to_at,
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
filtered_usage as not materialized (
  select
    usage_event.user_id,
    profile.email,
    profile.display_name,
    active_plans.plan_key,
    active_plans.plan_name,
    usage_event.count,
    usage_event.status,
    usage_event.created_at,
    usage_event.feature_key,
    usage_event.metadata
  from public.usage_events usage_event
  join active_plans on active_plans.user_id = usage_event.user_id
  join public.profiles profile on profile.user_id = usage_event.user_id
  cross join normalized input
  where usage_event.user_id is not null
    and (input.from_at is null or usage_event.created_at >= input.from_at)
    and (input.to_at is null or usage_event.created_at < input.to_at)
    and (input.provider_key = '' or usage_event.provider = input.provider_key)
    and (input.status_key = '' or usage_event.status = input.status_key)
    and (
      input.search_text = ''
      or profile.email ilike '%' || input.search_text || '%'
      or profile.display_name ilike '%' || input.search_text || '%'
      or profile.user_id::text ilike '%' || input.search_text || '%'
    )
    and (
      input.task_key = 'all'
      or (
        input.task_key = 'translation'
        and (
          usage_event.feature_key = 'translator.access'
          or usage_event.metadata ->> 'workflowFeature' = 'translator.access'
        )
      )
      or (input.task_key = 'story_chat' and usage_event.metadata ->> 'taskGroup' = 'story_chat')
      or (input.task_key = 'free_chat' and usage_event.metadata ->> 'taskGroup' = 'free_chat')
      or (input.task_key = 'planning' and usage_event.metadata ->> 'taskGroup' = 'story_planning')
      or (input.task_key = 'analysis' and usage_event.metadata ->> 'taskGroup' = 'story_analysis')
      or (
        input.task_key = 'image_generation'
        and (
          usage_event.metadata ->> 'action' = 'image_generation'
          or usage_event.metadata ->> 'taskType' = 'cover_generation'
          or usage_event.metadata ->> 'taskGroup' = 'story_publishing'
        )
      )
      or (
        input.task_key = 'writing'
        and (
          usage_event.metadata ->> 'taskGroup' = 'story_writing'
          or usage_event.metadata ->> 'taskType' in ('continue', 'scene_draft', 'arc_chapter_draft', 'rewrite', 'expand', 'style_write')
        )
      )
    )
),
grouped as (
  select
    filtered_usage.user_id,
    filtered_usage.email,
    filtered_usage.display_name,
    filtered_usage.plan_key,
    filtered_usage.plan_name,
    sum(greatest(coalesce(filtered_usage.count, 0), 0)) as total_count,
    count(*) as event_count,
    sum(case when lower(filtered_usage.status) in ('ok', 'success') then greatest(coalesce(filtered_usage.count, 0), 0) else 0 end) as ok_count,
    sum(case when lower(filtered_usage.status) in ('error', 'failed') then greatest(coalesce(filtered_usage.count, 0), 0) else 0 end) as error_count,
    sum(case when lower(filtered_usage.status) in ('blocked', 'denied') then greatest(coalesce(filtered_usage.count, 0), 0) else 0 end) as blocked_count,
    max(filtered_usage.created_at) as last_used_at
  from filtered_usage
  group by
    filtered_usage.user_id,
    filtered_usage.email,
    filtered_usage.display_name,
    filtered_usage.plan_key,
    filtered_usage.plan_name
),
summary as (
  select
    count(*)::bigint as matching_user_count,
    coalesce(sum(grouped.total_count), 0)::bigint as matching_total_count,
    coalesce(sum(grouped.event_count), 0)::bigint as matching_event_count,
    coalesce(sum(grouped.ok_count), 0)::bigint as matching_ok_count,
    coalesce(sum(grouped.error_count + grouped.blocked_count), 0)::bigint as matching_issue_count,
    max(grouped.last_used_at) as matching_last_used_at
  from grouped
),
ranked as (
  select
    row_number() over (order by grouped.total_count desc, grouped.last_used_at desc, grouped.user_id asc)::integer as rank_order,
    grouped.*
  from grouped
),
limited as (
  select ranked.*
  from ranked
  cross join normalized input
  order by ranked.rank_order
  limit (select row_limit from normalized)
)
select
  limited.rank_order,
  limited.user_id,
  limited.email,
  limited.display_name,
  limited.plan_key,
  limited.plan_name,
  limited.total_count,
  limited.event_count,
  limited.ok_count,
  limited.error_count,
  limited.blocked_count,
  limited.last_used_at,
  case input.task_key
    when 'writing' then 'Viết truyện'
    when 'translation' then 'Dịch truyện'
    when 'story_chat' then 'Chat truyện'
    when 'free_chat' then 'Chat tự do'
    when 'planning' then 'Lên kế hoạch'
    when 'analysis' then 'Phân tích'
    when 'image_generation' then 'Tạo ảnh'
    else 'Tất cả việc'
  end as task_summary,
  summary.matching_user_count,
  summary.matching_total_count,
  summary.matching_event_count,
  summary.matching_ok_count,
  summary.matching_issue_count,
  summary.matching_last_used_at
from limited
cross join summary
cross join normalized input
order by limited.rank_order;
$$;
