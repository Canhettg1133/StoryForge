-- Read-only verification after applying 010_lock_down_security_definer_rpc.sql.
-- Every acl_matches value must be true before the Admin API is deployed.

with expected(function_signature, service_role_should_execute) as (
  values
    ('public.touch_updated_at()', false),
    ('public.ensure_access_version()', false),
    ('public.handle_new_auth_user_profile()', false),
    ('public.bump_access_version(uuid)', false),
    ('public.bump_access_version_from_row()', false),
    ('public.bump_all_access_versions()', false),
    ('public.upsert_site_announcement(jsonb,boolean,uuid)', true),
    ('public.admin_usage_user_rankings(timestamp with time zone,timestamp with time zone,text,text,text,text,text,integer)', true)
)
select
  function_signature,
  has_function_privilege('anon', function_signature, 'EXECUTE') as anon_execute,
  has_function_privilege('authenticated', function_signature, 'EXECUTE') as authenticated_execute,
  has_function_privilege('service_role', function_signature, 'EXECUTE') as service_role_execute,
  not has_function_privilege('anon', function_signature, 'EXECUTE')
    and not has_function_privilege('authenticated', function_signature, 'EXECUTE')
    and has_function_privilege('service_role', function_signature, 'EXECUTE') = service_role_should_execute
    as acl_matches
from expected
order by function_signature;
