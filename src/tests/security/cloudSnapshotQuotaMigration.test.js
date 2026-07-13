import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Cloud Sync aggregate quota migration', () => {
  it('serializes writes per user and enforces count and byte quotas inside PostgreSQL', () => {
    const migration = readFileSync(
      resolve(process.cwd(), 'docs/supabase-access-control/015_cloud_snapshot_quota_and_rls.sql'),
      'utf8',
    );

    expect(migration).toContain('pg_advisory_xact_lock');
    expect(migration).toContain('existing_count + 1 > 200');
    expect(migration).toContain('existing_bytes + new.size_bytes > 268435456');
    expect(migration).toContain("if tg_op = 'UPDATE' then");
    expect(migration).toContain('and id <> old.id');
    expect(migration).toContain('before insert or update');
    expect(migration).toContain('set search_path = pg_catalog, public');
    expect(migration).toContain('revoke all on function public.enforce_cloud_snapshot_user_quota() from authenticated');
  });

  it('uses init-plan auth.uid policies and keeps the existing list index', () => {
    const migration = readFileSync(
      resolve(process.cwd(), 'docs/supabase-access-control/015_cloud_snapshot_quota_and_rls.sql'),
      'utf8',
    );

    expect(migration.match(/\(select auth\.uid\(\)\) = user_id/gu)).toHaveLength(5);
    expect(migration).toContain('on public.cloud_snapshots (user_id, scope, updated_at desc)');
  });
});
