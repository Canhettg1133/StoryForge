import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = resolve(
  process.cwd(),
  'docs/supabase-access-control/018_cloud_sync_r2_manifests.sql',
);

describe('Cloud Sync R2 additive migration', () => {
  it('creates all four RLS-protected metadata/outbox tables without dropping legacy data', () => {
    const sql = readFileSync(migrationPath, 'utf8');
    for (const table of [
      'cloud_snapshot_manifests',
      'cloud_snapshot_uploads',
      'cloud_snapshot_object_gc',
      'cloud_snapshot_tombstones',
    ]) {
      expect(sql).toContain(`create table if not exists public.${table}`);
      expect(sql).toContain(`alter table public.${table} enable row level security`);
      expect(sql).toContain(`revoke all on table public.${table} from anon, authenticated`);
    }
    expect(sql).not.toMatch(/drop\s+table\s+(if\s+exists\s+)?public\.cloud_snapshots/iu);
    expect(sql).not.toMatch(/truncate\s+(table\s+)?public\.cloud_snapshots/iu);
    expect(sql).not.toMatch(/update\s+public\.cloud_snapshots\s+set\s+payload_text\s*=\s*''/iu);
  });

  it('locks quota reservations and enforces count, bytes, pending, CAS, and tombstones', () => {
    const sql = readFileSync(migrationPath, 'utf8');
    expect(sql).toContain('pg_advisory_xact_lock');
    expect(sql).toContain('268435456');
    expect(sql).toContain('67108864');
    expect(sql).toContain('existing_snapshot_count >= 200');
    expect(sql).toContain('active_upload_count >= 3');
    expect(sql).toContain('expected_revision_id');
    expect(sql).toContain('cloud_snapshot_tombstones');
    expect(sql).toContain('cloud_sync_touch_legacy_snapshot');
    expect(sql).toContain('cloud_sync_revive_legacy_snapshot');
    expect(sql).toContain('union all');
    expect(sql).toContain('legacy_identity_size');
    expect(sql).toContain("status = 'processing' and updated_at <= now() - interval '15 minutes'");
    expect(sql).toContain("status in ('committed', 'aborted', 'expired')");
  });

  it('keeps every Worker RPC service-role-only with a fixed search_path', () => {
    const sql = readFileSync(migrationPath, 'utf8');
    const rpcNames = [
      'cloud_sync_list_snapshots',
      'cloud_sync_open_upload',
      'cloud_sync_get_upload',
      'cloud_sync_commit_upload',
      'cloud_sync_abort_upload',
      'cloud_sync_get_snapshot',
      'cloud_sync_delete_snapshot',
      'cloud_sync_cleanup_expired_uploads',
      'cloud_sync_claim_gc',
      'cloud_sync_complete_gc',
      'cloud_sync_fail_gc',
      'cloud_sync_backfill_manifest',
    ];

    for (const name of rpcNames) {
      expect(sql).toMatch(new RegExp(`function\\s+public\\.${name}\\s*\\(`, 'iu'));
      expect(sql).toMatch(new RegExp(`revoke all on function public\\.${name}\\([^;]*from public`, 'iu'));
      expect(sql).toMatch(new RegExp(`grant execute on function public\\.${name}\\([^;]*to service_role`, 'iu'));
    }
    expect(sql.match(/security definer/giu)?.length).toBeGreaterThanOrEqual(rpcNames.length);
    expect(sql.match(/set search_path = pg_catalog, public/giu)?.length).toBeGreaterThanOrEqual(rpcNames.length);
  });

  it('queues object deletion for direct deletes and auth-user cascades', () => {
    const sql = readFileSync(migrationPath, 'utf8');
    expect(sql).toContain('cloud_sync_enqueue_manifest_gc');
    expect(sql).toContain('after delete on public.cloud_snapshot_manifests');
    expect(sql).toContain('cloud_sync_enqueue_upload_gc');
    expect(sql).toContain('after delete on public.cloud_snapshot_uploads');
  });

  it('keeps legacy freeze and destructive removal in separately gated migrations', () => {
    const freeze = readFileSync(resolve(
      process.cwd(),
      'docs/supabase-access-control/019_cloud_sync_freeze_legacy_writes.sql',
    ), 'utf8');
    const removal = readFileSync(resolve(
      process.cwd(),
      'docs/supabase-access-control/020_cloud_sync_drop_legacy_after_7d.sql',
    ), 'utf8');

    expect(freeze).toContain('revoke insert, update, delete on table public.cloud_snapshots from authenticated');
    expect(freeze).not.toContain('drop table public.cloud_snapshots');
    expect(removal).toContain("cloud_sync_legacy_drop_approved = 'after-7-day-reconciliation'");
    expect(removal).toContain("interval '7 days'");
    expect(removal).toContain('cloud_sync_legacy_reconciliation_incomplete');
    expect(removal).toContain('drop table public.cloud_snapshots');
    expect(removal).toContain('drop function public.cloud_sync_backfill_manifest');
    expect(removal).toContain('drop function if exists public.enforce_cloud_snapshot_user_quota');
    expect(removal).toContain('drop function if exists public.cloud_sync_touch_legacy_snapshot');
    expect(removal).toContain('drop function if exists public.cloud_sync_revive_legacy_snapshot');
    expect(removal).not.toMatch(/delete\s+from\s+public\.cloud_snapshots/iu);
  });
});
