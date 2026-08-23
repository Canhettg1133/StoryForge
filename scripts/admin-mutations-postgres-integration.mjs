import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import pg from 'pg';

const { Client } = pg;
const connectionString = String(process.env.ADMIN_MUTATION_TEST_DATABASE_URL || '').trim();
if (!connectionString) {
  throw new Error('ADMIN_MUTATION_TEST_DATABASE_URL is required. Use an isolated local test database.');
}

const databaseUrl = new URL(connectionString);
const databaseName = decodeURIComponent(databaseUrl.pathname.slice(1));
if (!['localhost', '127.0.0.1'].includes(databaseUrl.hostname) || !/(^|_)test($|_)/iu.test(databaseName)) {
  throw new Error('Admin mutation integration tests require a local database whose name contains "test".');
}

const ACTOR = '10000000-0000-4000-8000-000000000001';
const NEW_VIP_USER = '10000000-0000-4000-8000-000000000002';
const MONTH_END_USER = '10000000-0000-4000-8000-000000000003';
const DUPLICATE_USER = '10000000-0000-4000-8000-000000000004';
const UNLIMITED_USER = '10000000-0000-4000-8000-000000000005';
const AUDIT_FAILURE_USER = '10000000-0000-4000-8000-000000000006';
const CONCURRENT_USER = '10000000-0000-4000-8000-000000000007';
const LOCK_WAIT_USER = '10000000-0000-4000-8000-000000000008';

const GUIDE_MUTATION = '20000000-0000-4000-8000-000000000001';
const GUIDE_FAILURE_MUTATION = '20000000-0000-4000-8000-000000000002';
const VIP_MUTATION = '30000000-0000-4000-8000-000000000001';

const client = new Client({ connectionString });

async function loadMigration(name) {
  return readFile(resolve(process.cwd(), 'docs/supabase-access-control', name), 'utf8');
}

async function scalar(activeClient, sql, values = []) {
  const result = await activeClient.query(sql, values);
  return result.rows[0]?.value;
}

async function expectDatabaseError(callback, marker) {
  let caught;
  try {
    await callback();
  } catch (error) {
    caught = error;
  }
  assert.ok(caught, `Expected database error ${marker}`);
  assert.match(String(caught.message), new RegExp(marker, 'u'));
}

async function extendVip(activeClient, {
  userId,
  amount,
  unit,
  mutationId,
}) {
  const result = await activeClient.query(
    `select * from public.admin_extend_vip(
      $1::uuid, $2::integer, $3::text, $4::uuid, $5::uuid, $6::text, $7::text
    )`,
    [userId, amount, unit, ACTOR, mutationId, '127.0.0.1', 'integration-test'],
  );
  return result.rows[0];
}

async function updateGuides(activeClient, items, expectedRevision, mutationId) {
  const result = await activeClient.query(
    `select * from public.update_setup_guides(
      $1::jsonb, $2::integer, $3::uuid, $4::uuid, $5::text, $6::text
    )`,
    [JSON.stringify(items), expectedRevision, ACTOR, mutationId, '127.0.0.1', 'integration-test'],
  );
  return result.rows[0];
}

const users = [
  ACTOR,
  NEW_VIP_USER,
  MONTH_END_USER,
  DUPLICATE_USER,
  UNLIMITED_USER,
  AUDIT_FAILURE_USER,
  CONCURRENT_USER,
  LOCK_WAIT_USER,
];

try {
  await client.connect();

  // This script deliberately resets only a validated, isolated local test DB.
  await client.query('drop schema if exists public cascade; create schema public');
  await client.query('drop schema if exists auth cascade; create schema auth');
  await client.query(`
    do $$
    begin
      if not exists (select 1 from pg_roles where rolname = 'anon') then
        create role anon nologin;
      end if;
      if not exists (select 1 from pg_roles where rolname = 'authenticated') then
        create role authenticated nologin;
      end if;
      if not exists (select 1 from pg_roles where rolname = 'service_role') then
        create role service_role nologin;
      end if;
    end
    $$;
  `);
  await client.query(`
    create table auth.users (
      id uuid primary key,
      email text,
      raw_user_meta_data jsonb not null default '{}'::jsonb,
      raw_app_meta_data jsonb not null default '{}'::jsonb,
      last_sign_in_at timestamptz,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    create function auth.uid() returns uuid
    language sql stable
    as $$ select null::uuid $$;
  `);

  for (const migration of [
    '001_access_control_schema.sql',
    '005_site_settings.sql',
    '006_admin_audit_snapshots.sql',
    '021_setup_guides.sql',
    '022_extend_vip.sql',
  ]) {
    await client.query(await loadMigration(migration));
  }

  await client.query(
    `insert into auth.users(id, email)
     select value::uuid, value || '@example.test'
     from unnest($1::text[]) as value`,
    [users],
  );
  await client.query(`
    insert into public.plans(key, name, active, sort_order)
    values ('free', 'Free', true, 10), ('vip', 'VIP', true, 20), ('lifetime', 'Lifetime', true, 30)
  `);

  for (const signature of [
    'public.update_setup_guides(jsonb,integer,uuid,uuid,text,text)',
    'public.admin_extend_vip(uuid,integer,text,uuid,uuid,text,text)',
  ]) {
    assert.equal(await scalar(client, `select has_function_privilege('anon', $1, 'EXECUTE') as value`, [signature]), false);
    assert.equal(await scalar(client, `select has_function_privilege('authenticated', $1, 'EXECUTE') as value`, [signature]), false);
    assert.equal(await scalar(client, `select has_function_privilege('service_role', $1, 'EXECUTE') as value`, [signature]), true);
  }

  const guideItems = [{
    id: 'guide-one', label: 'Guide one', url: '/guide', enabled: true, icon: 'book',
  }];
  const guideSaved = await updateGuides(client, guideItems, 1, GUIDE_MUTATION);
  assert.equal(guideSaved.revision, 2);
  assert.equal(guideSaved.previous_revision, 1);

  const guideRetried = await updateGuides(client, guideItems, 1, GUIDE_MUTATION);
  assert.equal(guideRetried.revision, 2);
  assert.equal(new Date(guideRetried.updated_at).toISOString(), new Date(guideSaved.updated_at).toISOString());
  assert.equal(await scalar(client, `select revision as value from public.site_settings where key = 'setup_guides'`), 2);
  assert.equal(await scalar(client, `select count(*)::integer as value from public.admin_audit_logs where mutation_id = $1`, [GUIDE_MUTATION]), 1);
  await expectDatabaseError(
    () => updateGuides(client, [{ ...guideItems[0], label: 'Changed' }], 1, GUIDE_MUTATION),
    'ADMIN_MUTATION_ID_CONFLICT',
  );

  await client.query(`
    alter table public.admin_audit_logs
    add constraint admin_mutation_test_block_guide_audit
    check (action <> 'setup_guides.update') not valid
  `);
  await expectDatabaseError(
    () => updateGuides(client, guideItems, 2, GUIDE_FAILURE_MUTATION),
    'admin_mutation_test_block_guide_audit',
  );
  assert.equal(await scalar(client, `select revision as value from public.site_settings where key = 'setup_guides'`), 2);
  await client.query('alter table public.admin_audit_logs drop constraint admin_mutation_test_block_guide_audit');

  const firstVip = await extendVip(client, {
    userId: NEW_VIP_USER, amount: 30, unit: 'day', mutationId: VIP_MUTATION,
  });
  assert.equal(firstVip.previous_expires_at, null);
  assert.ok(new Date(firstVip.expires_at).getTime() > Date.now() + (29 * 24 * 60 * 60 * 1000));

  const retriedVip = await extendVip(client, {
    userId: NEW_VIP_USER, amount: 30, unit: 'day', mutationId: VIP_MUTATION,
  });
  assert.equal(retriedVip.id, firstVip.id);
  assert.equal(new Date(retriedVip.expires_at).toISOString(), new Date(firstVip.expires_at).toISOString());
  assert.equal(await scalar(client, 'select count(*)::integer as value from public.user_plans where user_id = $1', [NEW_VIP_USER]), 1);
  assert.equal(await scalar(client, 'select count(*)::integer as value from public.admin_audit_logs where mutation_id = $1', [VIP_MUTATION]), 1);

  await client.query(
    `insert into public.user_plans(user_id, plan_id, starts_at, expires_at)
     select $1, id, '2026-01-01T00:00:00Z', '2028-01-31T00:00:00Z'
     from public.plans where key = 'vip'`,
    [MONTH_END_USER],
  );
  const monthEnd = await extendVip(client, {
    userId: MONTH_END_USER,
    amount: 1,
    unit: 'month',
    mutationId: '30000000-0000-4000-8000-000000000002',
  });
  assert.equal(new Date(monthEnd.expires_at).toISOString(), '2028-02-29T00:00:00.000Z');

  await client.query(
    `insert into public.user_plans(user_id, plan_id, status, starts_at, expires_at)
     select $1, id, status, starts_at::timestamptz, expires_at::timestamptz
     from public.plans
     cross join (values
       ('active', '2026-01-01T00:00:00Z', '2028-01-01T00:00:00Z'),
       ('active', '2026-01-01T00:00:00Z', '2029-01-01T00:00:00Z'),
       ('scheduled', '2030-01-01T00:00:00Z', '2031-01-01T00:00:00Z')
     ) as rows(status, starts_at, expires_at)
     where public.plans.key = 'vip'`,
    [DUPLICATE_USER],
  );
  const consolidated = await extendVip(client, {
    userId: DUPLICATE_USER,
    amount: 1,
    unit: 'day',
    mutationId: '30000000-0000-4000-8000-000000000003',
  });
  assert.equal(new Date(consolidated.previous_expires_at).toISOString(), '2029-01-01T00:00:00.000Z');
  assert.equal(new Date(consolidated.expires_at).toISOString(), '2029-01-02T00:00:00.000Z');
  assert.equal(consolidated.consolidated_count, 1);
  assert.equal(await scalar(client, `select count(*)::integer as value from public.user_plans where user_id = $1 and status = 'scheduled'`, [DUPLICATE_USER]), 1);

  await client.query(
    `insert into public.user_plans(user_id, plan_id, starts_at, expires_at)
     select $1, id, now(), null from public.plans where key = 'lifetime'`,
    [UNLIMITED_USER],
  );
  await expectDatabaseError(
    () => extendVip(client, {
      userId: UNLIMITED_USER,
      amount: 1,
      unit: 'day',
      mutationId: '30000000-0000-4000-8000-000000000004',
    }),
    'VIP_EXTENSION_UNLIMITED',
  );
  await client.query('delete from public.user_plans where user_id = $1', [UNLIMITED_USER]);
  await client.query(
    `insert into public.user_plans(user_id, plan_id, starts_at, expires_at)
     select $1, id, now(), null from public.plans where key = 'vip'`,
    [UNLIMITED_USER],
  );
  await expectDatabaseError(
    () => extendVip(client, {
      userId: UNLIMITED_USER,
      amount: 1,
      unit: 'month',
      mutationId: '30000000-0000-4000-8000-000000000010',
    }),
    'VIP_EXTENSION_UNLIMITED',
  );
  await expectDatabaseError(
    () => extendVip(client, {
      userId: NEW_VIP_USER,
      amount: 1,
      unit: null,
      mutationId: '30000000-0000-4000-8000-000000000005',
    }),
    'VIP_EXTENSION_UNIT_INVALID',
  );
  for (const [amount, unit] of [[0, 'day'], [3651, 'day'], [121, 'month']]) {
    await expectDatabaseError(
      () => extendVip(client, {
        userId: NEW_VIP_USER,
        amount,
        unit,
        mutationId: `30000000-0000-4000-8000-0000000000${11 + amount.toString().length}`,
      }),
      'VIP_EXTENSION_AMOUNT_INVALID',
    );
  }

  await client.query(`
    alter table public.admin_audit_logs
    add constraint admin_mutation_test_block_vip_audit
    check (action <> 'users.plan.extend') not valid
  `);
  await expectDatabaseError(
    () => extendVip(client, {
      userId: AUDIT_FAILURE_USER,
      amount: 1,
      unit: 'day',
      mutationId: '30000000-0000-4000-8000-000000000006',
    }),
    'admin_mutation_test_block_vip_audit',
  );
  assert.equal(await scalar(client, 'select count(*)::integer as value from public.user_plans where user_id = $1', [AUDIT_FAILURE_USER]), 0);
  await client.query('alter table public.admin_audit_logs drop constraint admin_mutation_test_block_vip_audit');

  const contenders = [new Client({ connectionString }), new Client({ connectionString })];
  try {
    await Promise.all(contenders.map((contender) => contender.connect()));
    await Promise.all([
      extendVip(contenders[0], {
        userId: CONCURRENT_USER,
        amount: 1,
        unit: 'day',
        mutationId: '30000000-0000-4000-8000-000000000007',
      }),
      extendVip(contenders[1], {
        userId: CONCURRENT_USER,
        amount: 1,
        unit: 'day',
        mutationId: '30000000-0000-4000-8000-000000000008',
      }),
    ]);
  } finally {
    await Promise.allSettled(contenders.map((contender) => contender.end()));
  }
  assert.equal(
    await scalar(client, `select count(*)::integer as value from public.user_plans where user_id = $1 and status = 'active'`, [CONCURRENT_USER]),
    1,
  );
  assert.equal(
    await scalar(client, `select round(extract(epoch from (expires_at - starts_at)) / 86400)::integer as value from public.user_plans where user_id = $1 and status = 'active'`, [CONCURRENT_USER]),
    2,
  );

  await client.query(
    `insert into public.user_plans(user_id, plan_id, starts_at, expires_at)
     select $1, id, clock_timestamp(), clock_timestamp() + interval '1 second'
     from public.plans where key = 'vip'`,
    [LOCK_WAIT_USER],
  );
  const locker = new Client({ connectionString });
  const waiter = new Client({ connectionString });
  try {
    await Promise.all([locker.connect(), waiter.connect()]);
    await locker.query('begin');
    await locker.query('select 1 from public.profiles where user_id = $1 for update', [LOCK_WAIT_USER]);
    const waitingExtension = extendVip(waiter, {
      userId: LOCK_WAIT_USER,
      amount: 1,
      unit: 'day',
      mutationId: '30000000-0000-4000-8000-000000000009',
    });
    await new Promise((resolveWait) => setTimeout(resolveWait, 1500));
    const releasedAt = Date.now();
    await locker.query('commit');
    const waitedResult = await waitingExtension;
    assert.equal(waitedResult.previous_expires_at, null);
    assert.ok(new Date(waitedResult.starts_at).getTime() >= releasedAt - 250);
  } finally {
    await Promise.allSettled([locker.query('rollback'), waiter.query('rollback')]);
    await Promise.allSettled([locker.end(), waiter.end()]);
  }

  const unsafeSnapshots = await scalar(
    client,
    `select count(*)::integer as value
     from public.admin_audit_logs
     where action in ('setup_guides.update', 'users.plan.extend')
       and (actor_snapshot <> '{}'::jsonb or target_snapshot <> '{}'::jsonb)`,
  );
  assert.equal(unsafeSnapshots, 0);
  const duplicatedIdentityJson = await scalar(
    client,
    `select count(*)::integer as value
     from public.admin_audit_logs
     where action in ('setup_guides.update', 'users.plan.extend')
       and (after_json ? 'user_id' or before_json::text like '%@%' or after_json::text like '%@%')`,
  );
  assert.equal(duplicatedIdentityJson, 0);

  process.stdout.write('Admin mutation PostgreSQL integration checks passed.\n');
} finally {
  await client.end();
}


