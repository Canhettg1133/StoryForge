-- Read-only ACL verification after applying migrations 021 and 022.
-- Every acl_matches value must be true before deploying the Admin Worker.

with expected(function_signature) as (
  values
    ('public.update_setup_guides(jsonb,integer,uuid,uuid,text,text)'),
    ('public.admin_extend_vip(uuid,integer,text,uuid,uuid,text,text)')
)
select
  function_signature,
  has_function_privilege('anon', function_signature, 'EXECUTE') as anon_execute,
  has_function_privilege('authenticated', function_signature, 'EXECUTE') as authenticated_execute,
  has_function_privilege('service_role', function_signature, 'EXECUTE') as service_role_execute,
  not has_function_privilege('anon', function_signature, 'EXECUTE')
    and not has_function_privilege('authenticated', function_signature, 'EXECUTE')
    and has_function_privilege('service_role', function_signature, 'EXECUTE')
    as acl_matches
from expected
order by function_signature;


