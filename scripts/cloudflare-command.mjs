import { existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { loadEnvFile } from './build-production-app.mjs';

const TARGETS = new Set(['preview', 'production']);
const ACTIONS = new Set(['dev', 'build', 'preview', 'dry-run', 'deploy']);

export function resolveCloudflareBuildEnv(target, baseEnv = {}) {
  if (!TARGETS.has(target)) throw new Error(`Unknown Cloudflare target: ${target}`);
  const env = {
    ...baseEnv,
    STORYFORGE_CLOUDFLARE: 'true',
    CLOUDFLARE_ENV: target === 'preview' ? 'preview' : '',
    VITE_DEPLOYMENT_MODE: 'production',
  };
  delete env.VITE_CLOUD_SYNC_BASE_URL;

  if (target === 'preview') {
    env.VITE_ENABLE_CLOUD_SYNC = 'true';
    env.VITE_CLOUD_AUTO_SYNC_ENABLED = 'true';
    env.VITE_ENABLE_STORY_MIRROR = 'true';
  }
  return env;
}

export function resolveWranglerArgs(action, target) {
  const args = ['deploy'];
  if (target === 'preview') args.push('--env', 'preview');
  if (action === 'dry-run') args.push('--dry-run');
  return args;
}

export function resolveCloudflarePreviewEnv(baseEnv = {}) {
  const env = { ...baseEnv };
  delete env.CLOUDFLARE_ENV;
  return env;
}

export function cleanCloudflareBuildOutput(cwd = process.cwd()) {
  rmSync(path.resolve(cwd, 'dist'), { recursive: true, force: true });
}

function runNode(scriptPath, args, env) {
  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    stdio: 'inherit',
    shell: false,
    env,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}

function loadTargetEnv(target) {
  const env = { ...process.env };
  const targetFile = path.resolve(`.env.cloudflare.${target}.local`);
  if (existsSync(targetFile)) loadEnvFile(targetFile, env, { override: true });
  return resolveCloudflareBuildEnv(target, env);
}

function build(env) {
  cleanCloudflareBuildOutput();
  runNode('scripts/build-production-app.mjs', ['user'], env);
}

export function main(argv = process.argv.slice(2)) {
  const action = argv[0] || 'build';
  const target = argv[1] || 'preview';
  if (!ACTIONS.has(action)) throw new Error(`Unknown Cloudflare action: ${action}`);
  if (!TARGETS.has(target)) throw new Error(`Unknown Cloudflare target: ${target}`);
  const env = loadTargetEnv(target);

  if (action === 'dev') {
    runNode('node_modules/vite/bin/vite.js', [], env);
    return;
  }
  build(env);
  if (action === 'build') return;
  if (action === 'preview') {
    runNode('node_modules/vite/bin/vite.js', ['preview'], resolveCloudflarePreviewEnv(env));
    return;
  }
  runNode('node_modules/wrangler/bin/wrangler.js', resolveWranglerArgs(action, target), env);
}

const isDirectRun = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isDirectRun) main();
