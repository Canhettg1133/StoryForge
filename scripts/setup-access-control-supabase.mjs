import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import pg from 'pg';

const DEFAULT_ADMIN_EMAIL = 'canhettg1112@gmail.com';

function readEnvFile(filePath) {
  try {
    return Object.fromEntries(
      readFileSync(filePath, 'utf8')
        .split(/\r?\n/u)
        .map((line) => line.match(/^\s*([^#=]+?)\s*=\s*(.*)\s*$/u))
        .filter(Boolean)
        .map((match) => [match[1], match[2]]),
    );
  } catch {
    return {};
  }
}

function getArg(name) {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length) || '';
}

function getRequiredDbUrl(env) {
  const dbUrl = getArg('db-url')
    || process.env.SUPABASE_DB_URL
    || env.SUPABASE_DB_URL
    || '';

  if (!dbUrl) {
    throw new Error('Missing SUPABASE_DB_URL. Pass --db-url or add SUPABASE_DB_URL to .env.local.');
  }
  return dbUrl;
}

function getAdminEmail() {
  return getArg('admin-email')
    || process.env.STORYFORGE_ADMIN_EMAIL
    || DEFAULT_ADMIN_EMAIL;
}

async function main() {
  const cwd = process.cwd();
  const env = readEnvFile(resolve(cwd, '.env.local'));
  const dbUrl = getRequiredDbUrl(env);
  const adminEmail = getAdminEmail();
  const schemaSql = readFileSync(resolve(cwd, 'docs/supabase-access-control/001_access_control_schema.sql'), 'utf8');
  const seedSql = readFileSync(resolve(cwd, 'docs/supabase-access-control/002_access_control_seed.sql'), 'utf8');
  const setAdminSql = `
insert into public.profiles (user_id, email, display_name, system_role, status)
select
  id,
  email,
  coalesce(raw_user_meta_data->>'name', raw_user_meta_data->>'full_name', email),
  'admin',
  'active'
from auth.users
where lower(email) = lower($1)
on conflict (user_id) do update
set
  email = excluded.email,
  display_name = excluded.display_name,
  system_role = 'admin',
  status = 'active',
  updated_at = now()
returning user_id, email, system_role, status;
`;

  const client = new pg.Client({
    connectionString: dbUrl,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();
  try {
    await client.query('begin');
    await client.query(schemaSql);
    await client.query(seedSql);
    const adminResult = await client.query(setAdminSql, [adminEmail]);
    if (adminResult.rowCount < 1) {
      throw new Error(`No auth.users row found for ${adminEmail}. Sign in once with that email, then rerun this script.`);
    }
    await client.query('commit');

    const verify = await client.query(`
      select
        (select count(*)::int from public.profiles) as profiles,
        (select count(*)::int from public.plans) as plans,
        (select count(*)::int from public.features) as features,
        (select count(*)::int from public.plan_features) as plan_features
    `);
    console.log(JSON.stringify({
      ok: true,
      admin: adminResult.rows[0],
      counts: verify.rows[0],
    }, null, 2));
  } catch (error) {
    await client.query('rollback').catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
