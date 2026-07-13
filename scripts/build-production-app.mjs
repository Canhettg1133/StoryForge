import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import process from 'node:process';

const TARGETS = {
  user: {
    label: 'StoryForge user app',
    outDir: 'dist',
    viteArgs: ['build'],
    requiredEnv: ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'],
  },
  admin: {
    label: 'StoryForge admin app',
    outDir: 'apps/admin/dist',
    viteArgs: ['build', '--config', 'apps/admin/vite.config.js'],
    requiredEnv: ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY', 'VITE_ADMIN_API_BASE_URL'],
  },
};

const SERVER_ONLY_SUPABASE_ENV_KEYS = Object.freeze([
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_SECRET_KEY',
  'SUPABASE_SERVICE_KEY',
]);

export function isClientBuildEnvKey(key) {
  return String(key || '').startsWith('VITE_');
}

export function isForbiddenPublicSupabaseSecretEnvKey(key) {
  return /^VITE_.*SUPABASE.*(?:SERVICE|SECRET).*KEY$/iu.test(String(key || ''));
}

export function assertNoForbiddenPublicSupabaseEnv(env = process.env) {
  const offenders = Object.keys(env || {}).filter(isForbiddenPublicSupabaseSecretEnvKey);
  if (offenders.length > 0) {
    throw new Error(
      [
        `Forbidden public Supabase secret env: ${offenders.join(', ')}`,
        'Supabase service role keys must stay in Worker/Vercel server secrets and must never use the VITE_ prefix.',
      ].join('\n'),
    );
  }
}

export function sanitizeClientBuildEnv(env = process.env) {
  const safeEnv = { ...env };
  for (const key of SERVER_ONLY_SUPABASE_ENV_KEYS) {
    delete safeEnv[key];
  }
  return safeEnv;
}

function parseEnvValue(rawValue) {
  let value = String(rawValue || '').trim();
  const quote = value[0];
  if ((quote === '"' || quote === "'") && value.endsWith(quote)) {
    value = value.slice(1, -1);
  }
  if (quote === '"') {
    value = value
      .replace(/\\n/g, '\n')
      .replace(/\\r/g, '\r')
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\');
  }
  return value;
}

export function loadEnvFile(filePath, env = process.env, options = {}) {
  if (!existsSync(filePath)) return [];
  const { allowKey = null, override = false } = options;
  const loaded = [];
  const lines = readFileSync(filePath, 'utf8').split(/\r?\n/u);
  for (const line of lines) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/u);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (allowKey && !allowKey(key)) continue;
    if (!override && env[key]) continue;
    const value = parseEnvValue(rawValue);
    if (!value) continue;
    env[key] = value;
    loaded.push(key);
  }
  return loaded;
}

export function loadVercelProductionEnv(cwd = process.cwd(), env = process.env) {
  return loadEnvFile(path.join(cwd, '.vercel', '.env.production.local'), env, {
    allowKey: isClientBuildEnvKey,
  });
}

export function loadProductionBuildEnv(cwd = process.cwd(), env = process.env) {
  return [
    ...loadEnvFile(path.join(cwd, '.env'), env, { allowKey: isClientBuildEnvKey }),
    ...loadEnvFile(path.join(cwd, '.env.local'), env, { allowKey: isClientBuildEnvKey }),
    ...loadEnvFile(path.join(cwd, '.env.production'), env, { allowKey: isClientBuildEnvKey }),
    ...loadEnvFile(path.join(cwd, '.env.production.local'), env, { allowKey: isClientBuildEnvKey }),
    ...loadVercelProductionEnv(cwd, env),
  ];
}

export function assertRequiredEnv(keys, env = process.env) {
  const missing = keys.filter((key) => !String(env[key] || '').trim());
  if (missing.length > 0) {
    throw new Error(
      [
        `Missing required production client env: ${missing.join(', ')}`,
        'Run `npx vercel env pull .vercel/.env.production.local --environment=production --yes` or configure them in Vercel.',
      ].join('\n'),
    );
  }
}

function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    shell: false,
    env: options.env || process.env,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

export function main(argv = process.argv.slice(2)) {
  const targetName = argv[0] || 'user';
  const target = TARGETS[targetName];
  if (!target) {
    throw new Error(`Unknown production build target "${targetName}". Use one of: ${Object.keys(TARGETS).join(', ')}`);
  }

  const loaded = loadProductionBuildEnv();
  if (loaded.length > 0) {
    console.log(`[build-production-app] loaded ${loaded.length} production env key(s) from local/Vercel env files`);
  }
  assertNoForbiddenPublicSupabaseEnv();
  assertRequiredEnv(target.requiredEnv);

  const clientBuildEnv = sanitizeClientBuildEnv(process.env);
  console.log(`[build-production-app] building ${target.label}`);
  runCommand(process.execPath, ['node_modules/vite/bin/vite.js', ...target.viteArgs], { env: clientBuildEnv });
  runCommand(process.execPath, ['scripts/obfuscate-first-party.mjs', target.outDir], { env: clientBuildEnv });
  runCommand(process.execPath, ['scripts/secure-build-guard.mjs', target.outDir]);
}

const isDirectRun = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isDirectRun) {
  main();
}
