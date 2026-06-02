-- StoryForge VIP/Admin Access v2 migration for projects that already ran 001/002.
-- Safe to run more than once.

drop index if exists public.one_active_plan_per_user;
drop index if exists public.one_scheduled_plan_per_user;

create index if not exists idx_user_plans_active_union
  on public.user_plans(user_id, plan_id, starts_at desc, expires_at)
  where status = 'active';

create index if not exists idx_user_plans_scheduled
  on public.user_plans(user_id, starts_at desc)
  where status = 'scheduled';

create or replace function public.handle_new_auth_user_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles(
    user_id,
    email,
    display_name,
    metadata
  )
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(
      nullif(new.raw_user_meta_data ->> 'name', ''),
      nullif(new.raw_user_meta_data ->> 'full_name', ''),
      new.email,
      ''
    ),
    jsonb_build_object(
      'auth_created_at', new.created_at,
      'auth_updated_at', new.updated_at,
      'last_sign_in_at', new.last_sign_in_at,
      'provider', coalesce(new.raw_app_meta_data ->> 'provider', '')
    )
  )
  on conflict (user_id) do update set
    email = excluded.email,
    display_name = case
      when public.profiles.display_name = '' then excluded.display_name
      else public.profiles.display_name
    end,
    metadata = public.profiles.metadata || excluded.metadata,
    updated_at = now();

  return new;
end;
$$;

drop trigger if exists on_auth_user_created_access_profile on auth.users;
create trigger on_auth_user_created_access_profile
  after insert or update of email, raw_user_meta_data, raw_app_meta_data, last_sign_in_at on auth.users
  for each row execute function public.handle_new_auth_user_profile();
