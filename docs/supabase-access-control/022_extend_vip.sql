-- Atomic, idempotent VIP extension. The profile-row lock serializes concurrent
-- extensions; mutation and audit either both commit or both roll back.

begin;

alter table public.admin_audit_logs
  add column if not exists mutation_id uuid;

create unique index if not exists idx_admin_audit_logs_mutation_id
  on public.admin_audit_logs(mutation_id)
  where mutation_id is not null;

drop function if exists public.admin_extend_vip(uuid, integer, text, uuid);
drop function if exists public.admin_extend_vip(uuid, integer, text, uuid, uuid, text, text);

create function public.admin_extend_vip(
  p_user_id uuid,
  p_amount integer,
  p_unit text,
  p_granted_by uuid,
  p_mutation_id uuid,
  p_client_ip text,
  p_user_agent text
)
returns table (
  id uuid,
  user_id uuid,
  plan_id uuid,
  status text,
  starts_at timestamptz,
  previous_expires_at timestamptz,
  expires_at timestamptz,
  consolidated_count integer
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_now timestamptz;
  v_vip_plan_id uuid;
  v_canonical public.user_plans%rowtype;
  v_audit public.admin_audit_logs%rowtype;
  v_previous_expires_at timestamptz;
  v_base_expires_at timestamptz;
  v_next_expires_at timestamptz;
  v_consolidated_count integer := 0;
  v_before jsonb;
  v_after jsonb;
begin
  if p_user_id is null then
    raise exception 'VIP_EXTENSION_USER_REQUIRED';
  end if;
  if p_granted_by is null then
    raise exception 'ADMIN_ACTOR_REQUIRED';
  end if;
  if p_mutation_id is null then
    raise exception 'ADMIN_MUTATION_ID_REQUIRED';
  end if;
  if p_unit is null or p_unit not in ('day', 'month') then
    raise exception 'VIP_EXTENSION_UNIT_INVALID';
  end if;
  if p_amount is null
    or (p_unit = 'day' and (p_amount < 1 or p_amount > 3650))
    or (p_unit = 'month' and (p_amount < 1 or p_amount > 120))
  then
    raise exception 'VIP_EXTENSION_AMOUNT_INVALID';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_mutation_id::text, 0));

  perform 1
  from public.profiles as profile
  where profile.user_id = p_user_id
  for update;
  if not found then
    raise exception 'VIP_EXTENSION_USER_NOT_FOUND';
  end if;

  -- Read database time only after acquiring the serialization lock. A request
  -- that waited past the old expiry therefore extends from the true current time.
  v_now := clock_timestamp();

  select audit.*
  into v_audit
  from public.admin_audit_logs as audit
  where audit.mutation_id = p_mutation_id;

  if found then
    if v_audit.action is distinct from 'users.plan.extend'
      or v_audit.actor_user_id is distinct from p_granted_by
      or v_audit.target_user_id is distinct from p_user_id
      or v_audit.after_json->>'planKey' is distinct from 'vip'
      or (v_audit.after_json->>'amount')::integer is distinct from p_amount
      or v_audit.after_json->>'unit' is distinct from p_unit
    then
      raise exception 'ADMIN_MUTATION_ID_CONFLICT';
    end if;

    return query select
      (v_audit.after_json->>'id')::uuid,
      v_audit.target_user_id,
      (v_audit.after_json->>'plan_id')::uuid,
      v_audit.after_json->>'status',
      (v_audit.after_json->>'starts_at')::timestamptz,
      nullif(v_audit.after_json->>'previous_expires_at', '')::timestamptz,
      (v_audit.after_json->>'expires_at')::timestamptz,
      (v_audit.after_json->>'consolidated_count')::integer;
    return;
  end if;

  select plan.id
  into v_vip_plan_id
  from public.plans as plan
  where plan.key = 'vip' and plan.active = true
  limit 1;
  if v_vip_plan_id is null then
    raise exception 'VIP_EXTENSION_PLAN_NOT_FOUND';
  end if;

  if exists (
    select 1
    from public.user_plans as up
    join public.plans as plan on plan.id = up.plan_id
    where up.user_id = p_user_id
      and up.status = 'active'
      and up.starts_at <= v_now
      and (up.expires_at is null or up.expires_at > v_now)
      and (plan.key = 'lifetime' or (plan.key = 'vip' and up.expires_at is null))
  ) then
    raise exception 'VIP_EXTENSION_UNLIMITED';
  end if;

  select up.*
  into v_canonical
  from public.user_plans as up
  where up.user_id = p_user_id
    and up.plan_id = v_vip_plan_id
    and up.status = 'active'
    and up.starts_at <= v_now
    and up.expires_at > v_now
  order by up.expires_at desc, up.created_at desc, up.id desc
  limit 1
  for update;

  v_previous_expires_at := v_canonical.expires_at;
  v_base_expires_at := coalesce(v_previous_expires_at, v_now);
  if p_unit = 'day' then
    v_next_expires_at := v_base_expires_at + make_interval(days => p_amount);
  else
    v_next_expires_at := v_base_expires_at + make_interval(months => p_amount);
  end if;

  if v_canonical.id is null then
    insert into public.user_plans(
      user_id,
      plan_id,
      status,
      starts_at,
      expires_at,
      source,
      granted_by,
      metadata
    ) values (
      p_user_id,
      v_vip_plan_id,
      'active',
      v_now,
      v_next_expires_at,
      'manual',
      p_granted_by,
      jsonb_build_object(
        'last_extension_amount', p_amount,
        'last_extension_unit', p_unit,
        'last_extended_at', v_now
      )
    )
    returning * into v_canonical;
  else
    update public.user_plans as up
    set expires_at = v_next_expires_at,
        granted_by = p_granted_by,
        metadata = coalesce(up.metadata, '{}'::jsonb) || jsonb_build_object(
          'last_extension_amount', p_amount,
          'last_extension_unit', p_unit,
          'last_extended_at', v_now
        )
    where up.id = v_canonical.id
    returning * into v_canonical;

    update public.user_plans as duplicate
    set status = 'cancelled',
        metadata = coalesce(duplicate.metadata, '{}'::jsonb) || jsonb_build_object(
          'consolidated_into', v_canonical.id,
          'consolidated_at', v_now,
          'consolidation_reason', 'admin_vip_extension'
        )
    where duplicate.user_id = p_user_id
      and duplicate.plan_id = v_vip_plan_id
      and duplicate.id <> v_canonical.id
      and duplicate.status = 'active'
      and duplicate.starts_at <= v_now
      and duplicate.expires_at > v_now;
    get diagnostics v_consolidated_count = row_count;
  end if;

  v_before := jsonb_build_object(
    'planKey', 'vip',
    'expires_at', v_previous_expires_at
  );
  v_after := jsonb_build_object(
    'id', v_canonical.id,
    'plan_id', v_canonical.plan_id,
    'status', v_canonical.status,
    'starts_at', v_canonical.starts_at,
    'previous_expires_at', v_previous_expires_at,
    'expires_at', v_canonical.expires_at,
    'consolidated_count', v_consolidated_count,
    'planKey', 'vip',
    'amount', p_amount,
    'unit', p_unit
  );

  insert into public.admin_audit_logs(
    mutation_id,
    actor_user_id,
    action,
    target_user_id,
    before_json,
    after_json,
    actor_snapshot,
    target_snapshot,
    action_summary,
    change_summary,
    resource_label,
    ip_address,
    user_agent
  ) values (
    p_mutation_id,
    p_granted_by,
    'users.plan.extend',
    p_user_id,
    v_before,
    v_after,
    '{}'::jsonb,
    '{}'::jsonb,
    'Gia hạn gói VIP',
    format('Cộng %s %s; hạn mới %s', p_amount, p_unit, v_canonical.expires_at),
    'VIP',
    left(coalesce(p_client_ip, ''), 255),
    left(coalesce(p_user_agent, ''), 512)
  );

  return query select
    v_canonical.id,
    v_canonical.user_id,
    v_canonical.plan_id,
    v_canonical.status,
    v_canonical.starts_at,
    v_previous_expires_at,
    v_canonical.expires_at,
    v_consolidated_count;
end;
$$;

revoke all on function public.admin_extend_vip(uuid, integer, text, uuid, uuid, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_extend_vip(uuid, integer, text, uuid, uuid, text, text)
  to service_role;

commit;


