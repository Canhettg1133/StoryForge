import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function read(path) {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

describe('Supabase SECURITY DEFINER ACL migration', () => {
  it('removes public execution and grants only the two admin RPCs to service_role', () => {
    const migration = read('docs/supabase-access-control/010_lock_down_security_definer_rpc.sql');
    const restrictedSignatures = [
      'public.touch_updated_at()',
      'public.ensure_access_version()',
      'public.handle_new_auth_user_profile()',
      'public.bump_access_version(uuid)',
      'public.bump_access_version_from_row()',
      'public.bump_all_access_versions()',
      'public.upsert_site_announcement(jsonb, boolean, uuid)',
      'public.admin_usage_user_rankings(timestamptz, timestamptz, text, text, text, text, text, integer)',
    ];

    for (const signature of restrictedSignatures) {
      expect(migration).toContain(`revoke all on function ${signature} from public, anon, authenticated, service_role;`);
    }

    expect(migration).toContain(
      'grant execute on function public.upsert_site_announcement(jsonb, boolean, uuid) to service_role;',
    );
    expect(migration).toContain(
      'grant execute on function public.admin_usage_user_rankings(timestamptz, timestamptz, text, text, text, text, text, integer) to service_role;',
    );
    expect(migration).not.toContain('alter default privileges');
  });

  it('includes a read-only production verification query for browser and service roles', () => {
    const verification = read('docs/supabase-access-control/verify_010_security_definer_acl.sql');

    expect(verification).toContain("has_function_privilege('anon'");
    expect(verification).toContain("has_function_privilege('authenticated'");
    expect(verification).toContain("has_function_privilege('service_role'");
    expect(verification).toContain('public.upsert_site_announcement(jsonb,boolean,uuid)');
    expect(verification).toContain('public.admin_usage_user_rankings(timestamp with time zone,timestamp with time zone,text,text,text,text,text,integer)');
  });
});
