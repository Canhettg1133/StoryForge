import assert from 'node:assert/strict';
import pg from 'pg';

const { Client } = pg;
const connectionString = String(process.env.CLOUD_SYNC_TEST_DATABASE_URL || '').trim();
if (!connectionString) {
  throw new Error('CLOUD_SYNC_TEST_DATABASE_URL is required. Use an isolated local test database.');
}

const databaseUrl = new URL(connectionString);
if (!['localhost', '127.0.0.1'].includes(databaseUrl.hostname)) {
  throw new Error('Cloud Sync PostgreSQL integration tests refuse non-local databases.');
}

const USER_ONE = '11111111-1111-4111-8111-111111111111';
const USER_TWO = '22222222-2222-4222-8222-222222222222';
const USER_THREE = '99999999-9999-4999-8999-999999999999';
const CONCURRENT_USER = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const LEGACY_QUOTA_USER = 'dddddddd-1111-4111-8111-dddddddddddd';
const SNAPSHOT_ID = '33333333-3333-4333-8333-333333333333';
const WRITE_ID = '44444444-4444-4444-8444-444444444444';
const SHA256 = 'a'.repeat(64);

const client = new Client({ connectionString });

async function scalar(sql, values = []) {
  const result = await client.query(sql, values);
  return result.rows[0]?.value;
}

let savepointCounter = 0;
async function expectRpcError(callback, marker) {
  savepointCounter += 1;
  const savepoint = `expected_error_${savepointCounter}`;
  await client.query(`savepoint ${savepoint}`);
  let caught = null;
  try {
    await callback();
  } catch (error) {
    caught = error;
    await client.query(`rollback to savepoint ${savepoint}`);
  }
  await client.query(`release savepoint ${savepoint}`);
  assert.ok(caught, `Expected RPC error ${marker}`);
  assert.match(String(caught.message), new RegExp(marker, 'u'));
}

try {
  await client.connect();
  await client.query('begin');
  await client.query(
    'insert into auth.users(id) values ($1), ($2), ($3), ($4)',
    [USER_ONE, USER_TWO, USER_THREE, LEGACY_QUOTA_USER],
  );

  const authenticatedCanList = await scalar(
    `select has_function_privilege(
      'authenticated', 'public.cloud_sync_list_snapshots(uuid,integer)', 'EXECUTE'
    ) as value`,
  );
  const authenticatedCanReadManifest = await scalar(
    `select has_table_privilege(
      'authenticated', 'public.cloud_snapshot_manifests', 'SELECT'
    ) as value`,
  );
  const manifestRlsEnabled = await scalar(
    `select relrowsecurity as value from pg_class
     where oid = 'public.cloud_snapshot_manifests'::regclass`,
  );
  assert.equal(authenticatedCanList, false);
  assert.equal(authenticatedCanReadManifest, false);
  assert.equal(manifestRlsEnabled, true);

  const opened = await scalar(
    `select public.cloud_sync_open_upload(
      $1, $2, 'project', 'project-1', 'Project 1', 8, 1700000000000,
      2, $3, '{}'::jsonb, null
    ) as value`,
    [USER_ONE, WRITE_ID, SHA256],
  );
  assert.equal(opened.uploadRequired, true);
  assert.equal(opened.snapshotId, opened.snapshotId.toLowerCase());

  const upload = await scalar(
    'select public.cloud_sync_get_upload($1, $2) as value',
    [USER_ONE, opened.uploadId],
  );
  assert.equal(upload.status, 'pending');
  assert.equal(upload.sizeBytes, 2);

  const objectKey = `users/${USER_ONE}/snapshots/project/${opened.snapshotId}/${SHA256}.json`;
  const committed = await scalar(
    'select public.cloud_sync_commit_upload($1, $2, $3, $4, $5) as value',
    [USER_ONE, opened.uploadId, objectKey, 'etag-1', 'version-1'],
  );
  assert.equal(committed.id, opened.snapshotId);
  assert.equal(committed.payloadSha256, SHA256);

  const userOneList = await scalar(
    'select public.cloud_sync_list_snapshots($1, 200) as value',
    [USER_ONE],
  );
  const userTwoList = await scalar(
    'select public.cloud_sync_list_snapshots($1, 200) as value',
    [USER_TWO],
  );
  assert.equal(userOneList.items.length, 1);
  assert.equal(userTwoList.items.length, 0);

  const crossUserRead = await scalar(
    'select public.cloud_sync_get_snapshot($1, $2) as value',
    [USER_TWO, opened.snapshotId],
  );
  assert.equal(crossUserRead, null);

  const retried = await scalar(
    `select public.cloud_sync_open_upload(
      $1, $2, 'project', 'project-1', 'Project 1', 8, 1700000000000,
      2, $3, '{}'::jsonb, null
    ) as value`,
    [USER_ONE, WRITE_ID, SHA256],
  );
  assert.equal(retried.uploadRequired, false);
  assert.equal(retried.manifest.id, committed.id);

  await expectRpcError(
    () => scalar(
      `select public.cloud_sync_open_upload(
        $1, '45454545-4545-4545-8545-454545454545', 'project', 'project-1', 'Project 1',
        8, 1700000000000, 3, $2, '{}'::jsonb, $3
      ) as value`,
      [USER_ONE, SHA256, committed.revisionId],
    ),
    'cloud_sync_invalid_upload',
  );

  await expectRpcError(
    () => scalar(
      `select public.cloud_sync_open_upload(
        $1, $2, 'project', 'project-1', 'Changed idempotency input', 8, 1700000000000,
        2, $3, '{}'::jsonb, null
      ) as value`,
      [USER_ONE, WRITE_ID, SHA256],
    ),
    'cloud_sync_write_conflict',
  );

  await expectRpcError(
    () => scalar(
      `select public.cloud_sync_open_upload(
        $1, $2, 'project', 'project-1', 'Project 1 stale', 8, 1700000000001,
        2, $3, '{}'::jsonb, $4
      ) as value`,
      [USER_ONE, '55555555-5555-4555-8555-555555555555', SHA256, SNAPSHOT_ID],
    ),
    'cloud_sync_revision_conflict',
  );

  await scalar('select public.cloud_sync_delete_snapshot($1, $2) as value', [USER_ONE, opened.snapshotId]);
  const afterDelete = await scalar(
    'select public.cloud_sync_list_snapshots($1, 200) as value',
    [USER_ONE],
  );
  assert.equal(afterDelete.items.length, 0);
  assert.equal(afterDelete.tombstones.length, 1);
  const gcCount = await scalar(
    'select count(*)::integer as value from public.cloud_snapshot_object_gc where object_key = $1',
    [objectKey],
  );
  assert.equal(gcCount, 1);

  const tombstoneBackfill = await scalar(
    `select public.cloud_sync_backfill_manifest(
      $1, $2, 'project', 'project-1', 'Project 1', 8, 1700000000000,
      2, $3, '{}'::jsonb, $4, '2020-01-01T00:00:00Z', '2020-01-01T00:00:00Z'
    ) as value`,
    [USER_ONE, opened.snapshotId, SHA256, objectKey],
  );
  assert.equal(tombstoneBackfill.status, 'tombstoned');

  const expiring = await scalar(
    `select public.cloud_sync_open_upload(
      $1, 'eeeeeeee-1111-4111-8111-eeeeeeeeeeee', 'chat', 'expires', 'Expires',
      1, 1, 2, $2, '{}'::jsonb, null
    ) as value`,
    [USER_ONE, '1'.repeat(64)],
  );
  await client.query(
    "update public.cloud_snapshot_uploads set expires_at = now() - interval '1 minute' where id = $1",
    [expiring.uploadId],
  );
  await scalar(
    `select public.cloud_sync_open_upload(
      $1, 'eeeeeeee-2222-4222-8222-eeeeeeeeeeee', 'chat', 'active', 'Active',
      1, 2, 2, $2, '{}'::jsonb, null
    ) as value`,
    [USER_ONE, '2'.repeat(64)],
  );
  const stillPending = await scalar(
    'select status as value from public.cloud_snapshot_uploads where id = $1',
    [expiring.uploadId],
  );
  assert.equal(stillPending, 'pending');
  const cleanup = await scalar('select public.cloud_sync_cleanup_expired_uploads(50) as value');
  assert.equal(cleanup.cleaned, 1);
  const expiredGc = await scalar(
    'select count(*)::integer as value from public.cloud_snapshot_object_gc where object_key like $1',
    [`%/${expiring.snapshotId}/%`],
  );
  assert.equal(expiredGc, 1);

  const backfillId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const backfillSha = 'c'.repeat(64);
  const backfillKey = `users/${USER_TWO}/snapshots/project/${backfillId}/${backfillSha}.json`;
  const backfilled = await scalar(
    `select public.cloud_sync_backfill_manifest(
      $1, $2, 'project', 'backfill-project', 'Backfill', 8, 1,
      2, $3, '{}'::jsonb, $4, '2025-01-01T00:00:00Z', '2025-01-01T00:00:00Z'
    ) as value`,
    [USER_TWO, backfillId, backfillSha, backfillKey],
  );
  assert.equal(backfilled.status, 'backfilled');
  assert.equal(backfilled.manifest.id, backfillId);

  const staleLegacyId = 'cccccccc-1111-4111-8111-cccccccccccc';
  await client.query(
    `insert into public.cloud_snapshots(
      id, user_id, scope, item_slug, item_title, payload_text, payload_version,
      source_updated_at, size_bytes, metadata
    ) values ($1, $2, 'chat', 'stale-delete', 'Stale delete', '{}', 1, 1, 2, '{}'::jsonb)`,
    [staleLegacyId, USER_ONE],
  );
  const staleReplacement = await scalar(
    `select public.cloud_sync_open_upload(
      $1, 'cccccccc-2222-4222-8222-cccccccccccc', 'chat', 'stale-delete', 'Stale delete',
      1, 2, 2, $2, '{}'::jsonb, null
    ) as value`,
    [USER_ONE, '6'.repeat(64)],
  );
  const staleReplacementKey = `users/${USER_ONE}/snapshots/chat/${staleReplacement.snapshotId}/${'6'.repeat(64)}.json`;
  await scalar(
    'select public.cloud_sync_commit_upload($1, $2, $3, null, null) as value',
    [USER_ONE, staleReplacement.uploadId, staleReplacementKey],
  );
  const supersededLegacyTombstone = await scalar(
    `select count(*)::integer as value from public.cloud_snapshot_tombstones
     where user_id = $1 and scope = 'chat' and item_slug = 'stale-delete'`,
    [USER_ONE],
  );
  assert.equal(supersededLegacyTombstone, 1);

  await client.query(
    `update public.cloud_snapshots set
       payload_text = '{"new":1}', size_bytes = 9, source_updated_at = 3
     where id = $1 and user_id = $2`,
    [staleLegacyId, USER_ONE],
  );
  const revivedTombstone = await scalar(
    `select count(*)::integer as value from public.cloud_snapshot_tombstones
     where user_id = $1 and scope = 'chat' and item_slug = 'stale-delete'`,
    [USER_ONE],
  );
  assert.equal(revivedTombstone, 0);
  const revivedSha = 'dcce99a13be10d16c243c3c003a0545b513ac6697907c012ea6f76c11ea46c7a';
  const revivedKey = `users/${USER_ONE}/snapshots/chat/${staleReplacement.snapshotId}/${revivedSha}.json`;
  const revivedBackfill = await scalar(
    `select public.cloud_sync_backfill_manifest(
      l.user_id, $2, l.scope, l.item_slug, l.item_title, l.payload_version,
      l.source_updated_at, l.size_bytes, $3, l.metadata, $4, l.created_at, l.updated_at
    ) as value
    from public.cloud_snapshots l where l.id = $1`,
    [staleLegacyId, staleReplacement.snapshotId, revivedSha, revivedKey],
  );
  assert.equal(revivedBackfill.status, 'backfilled');
  await scalar(
    'select public.cloud_sync_delete_snapshot($1, $2) as value',
    [USER_ONE, staleLegacyId],
  );
  const staleIdentityCount = await scalar(
    `select (
      (select count(*) from public.cloud_snapshot_manifests
       where user_id = $1 and scope = 'chat' and item_slug = 'stale-delete')
      +
      (select count(*) from public.cloud_snapshots
       where user_id = $1 and scope = 'chat' and item_slug = 'stale-delete')
    )::integer as value`,
    [USER_ONE],
  );
  assert.equal(staleIdentityCount, 0);
  const staleReplacementGc = await scalar(
    'select count(*)::integer as value from public.cloud_snapshot_object_gc where object_key = $1',
    [staleReplacementKey],
  );
  assert.equal(staleReplacementGc, 1);

  await client.query(
    `insert into public.cloud_snapshots(
      id, user_id, scope, item_slug, item_title, payload_text, payload_version,
      source_updated_at, size_bytes, metadata
    )
    select gen_random_uuid(), $1, 'project', 'legacy-' || value, 'Legacy ' || value,
           '{}', 1, value, 2, '{}'::jsonb
    from generate_series(1, 200) value`,
    [LEGACY_QUOTA_USER],
  );
  const replacement = await scalar(
    `select public.cloud_sync_open_upload(
      $1, 'dddddddd-2222-4222-8222-dddddddddddd', 'project', 'legacy-1', 'Legacy 1',
      1, 1, 2, $2, '{}'::jsonb, null
    ) as value`,
    [LEGACY_QUOTA_USER, '7'.repeat(64)],
  );
  const replacementKey = `users/${LEGACY_QUOTA_USER}/snapshots/project/${replacement.snapshotId}/${'7'.repeat(64)}.json`;
  await scalar(
    'select public.cloud_sync_commit_upload($1, $2, $3, null, null) as value',
    [LEGACY_QUOTA_USER, replacement.uploadId, replacementKey],
  );
  const combinedList = await scalar(
    'select public.cloud_sync_list_snapshots($1, 200) as value',
    [LEGACY_QUOTA_USER],
  );
  assert.equal(combinedList.items.length, 1);
  assert.equal(combinedList.legacyItems.length, 199);
  await expectRpcError(
    () => scalar(
      `select public.cloud_sync_open_upload(
        $1, 'dddddddd-3333-4333-8333-dddddddddddd', 'project', 'new-identity', 'New',
        1, 2, 2, $2, '{}'::jsonb, null
      ) as value`,
      [LEGACY_QUOTA_USER, '8'.repeat(64)],
    ),
    'cloud_sync_quota_exceeded',
  );

  const staleGcKey = `users/${USER_TWO}/stale-processing.json`;
  await client.query(
    `insert into public.cloud_snapshot_object_gc(
      user_id, object_key, reason_code, status, updated_at
    ) values ($1, $2, 'TEST_STALE_LEASE', 'processing', now() - interval '16 minutes')`,
    [USER_TWO, staleGcKey],
  );
  const reclaimedGc = await scalar('select public.cloud_sync_claim_gc(100) as value');
  assert.equal(reclaimedGc.some((item) => item.objectKey === staleGcKey), true);

  const legacyId = '66666666-6666-4666-8666-666666666666';
  await client.query(
    `insert into public.cloud_snapshots(
      id, user_id, scope, item_slug, item_title, payload_text, payload_version,
      source_updated_at, size_bytes, metadata
    ) values ($1, $2, 'chat', 'chat-1', 'Chat 1', '{}', 1, 1, 2, '{}'::jsonb)`,
    [legacyId, USER_ONE],
  );
  const withLegacy = await scalar(
    'select public.cloud_sync_list_snapshots($1, 200) as value',
    [USER_ONE],
  );
  assert.equal(withLegacy.legacyItems.length, 1);
  await scalar('select public.cloud_sync_delete_snapshot($1, $2) as value', [USER_ONE, legacyId]);
  const legacyDeleted = await scalar(
    'select public.cloud_sync_list_snapshots($1, 200) as value',
    [USER_ONE],
  );
  assert.equal(legacyDeleted.legacyItems.length, 0);
  assert.equal(legacyDeleted.tombstones.some((item) => item.itemSlug === 'chat-1'), true);

  const cascadeOpen = await scalar(
    `select public.cloud_sync_open_upload(
      $1, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'prompt_bundle',
      'story-creation-settings', 'Prompt', 1, 1, 2, $2, '{}'::jsonb, null
    ) as value`,
    [USER_THREE, 'e'.repeat(64)],
  );
  const cascadeKey = `users/${USER_THREE}/snapshots/prompt_bundle/${cascadeOpen.snapshotId}/${'e'.repeat(64)}.json`;
  await scalar(
    'select public.cloud_sync_commit_upload($1, $2, $3, null, null) as value',
    [USER_THREE, cascadeOpen.uploadId, cascadeKey],
  );
  await client.query('delete from auth.users where id = $1', [USER_THREE]);
  const cascadeManifestCount = await scalar(
    'select count(*)::integer as value from public.cloud_snapshot_manifests where user_id = $1',
    [USER_THREE],
  );
  const cascadeGcCount = await scalar(
    'select count(*)::integer as value from public.cloud_snapshot_object_gc where object_key = $1',
    [cascadeKey],
  );
  assert.equal(cascadeManifestCount, 0);
  assert.equal(cascadeGcCount, 1);

  for (let index = 0; index < 3; index += 1) {
    await scalar(
      `select public.cloud_sync_open_upload(
        $1, $2, 'chat', $3, $3, 1, $4, 2, $5, '{}'::jsonb, null
      ) as value`,
      [
        USER_TWO,
        `77777777-7777-4777-8777-77777777777${index}`,
        `pending-${index}`,
        index + 1,
        String(index + 1).repeat(64),
      ],
    );
  }
  await expectRpcError(
    () => scalar(
      `select public.cloud_sync_open_upload(
        $1, '88888888-8888-4888-8888-888888888888', 'chat', 'pending-4', 'pending-4',
        1, 4, 2, $2, '{}'::jsonb, null
      ) as value`,
      [USER_TWO, 'f'.repeat(64)],
    ),
    'cloud_sync_pending_limit',
  );

  await client.query('rollback');

  await client.query('delete from auth.users where id = $1', [CONCURRENT_USER]);
  await client.query(
    'delete from public.cloud_snapshot_object_gc where object_key like $1',
    [`users/${CONCURRENT_USER}/%`],
  );
  await client.query('insert into auth.users(id) values ($1)', [CONCURRENT_USER]);
  for (let index = 0; index < 2; index += 1) {
    await scalar(
      `select public.cloud_sync_open_upload(
        $1, $2, 'chat', $3, $3, 1, $4, 2, $5, '{}'::jsonb, null
      ) as value`,
      [
        CONCURRENT_USER,
        `aaaaaaaa-2222-4222-8222-aaaaaaaaaaa${index}`,
        `concurrent-base-${index}`,
        index + 1,
        String(index + 1).repeat(64),
      ],
    );
  }

  const contenders = [new Client({ connectionString }), new Client({ connectionString })];
  try {
    await Promise.all(contenders.map((contender) => contender.connect()));
    const results = await Promise.allSettled(contenders.map((contender, index) => contender.query(
      `select public.cloud_sync_open_upload(
        $1, $2, 'chat', $3, $3, 1, $4, 2, $5, '{}'::jsonb, null
      ) as value`,
      [
        CONCURRENT_USER,
        `aaaaaaaa-3333-4333-8333-aaaaaaaaaaa${index}`,
        `concurrent-race-${index}`,
        index + 10,
        String(index + 3).repeat(64),
      ],
    )));
    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
    const rejection = results.find((result) => result.status === 'rejected');
    assert.match(String(rejection?.reason?.message), /cloud_sync_pending_limit/u);
  } finally {
    await Promise.allSettled(contenders.map((contender) => contender.end()));
  }

  await client.query('delete from auth.users where id = $1', [CONCURRENT_USER]);
  await client.query(
    'delete from public.cloud_snapshot_object_gc where object_key like $1',
    [`users/${CONCURRENT_USER}/%`],
  );
  process.stdout.write('Cloud Sync PostgreSQL integration checks passed.\n');
} catch (error) {
  try {
    await client.query('rollback');
  } catch {
    // Connection may already be closed.
  }
  throw error;
} finally {
  await client.end();
}
