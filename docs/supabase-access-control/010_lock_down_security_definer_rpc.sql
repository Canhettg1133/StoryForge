-- Lock down SECURITY DEFINER and trigger helper functions that should never be
-- callable directly by browser roles. Safe to run more than once.

begin;

revoke all on function public.touch_updated_at() from public, anon, authenticated, service_role;
revoke all on function public.ensure_access_version() from public, anon, authenticated, service_role;
revoke all on function public.handle_new_auth_user_profile() from public, anon, authenticated, service_role;
revoke all on function public.bump_access_version(uuid) from public, anon, authenticated, service_role;
revoke all on function public.bump_access_version_from_row() from public, anon, authenticated, service_role;
revoke all on function public.bump_all_access_versions() from public, anon, authenticated, service_role;
revoke all on function public.upsert_site_announcement(jsonb, boolean, uuid) from public, anon, authenticated, service_role;
revoke all on function public.admin_usage_user_rankings(timestamptz, timestamptz, text, text, text, text, text, integer) from public, anon, authenticated, service_role;

grant execute on function public.upsert_site_announcement(jsonb, boolean, uuid) to service_role;
grant execute on function public.admin_usage_user_rankings(timestamptz, timestamptz, text, text, text, text, text, integer) to service_role;

commit;
