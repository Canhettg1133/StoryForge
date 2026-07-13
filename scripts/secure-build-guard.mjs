import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const SERVER_ONLY_SECRET_MARKERS = Object.freeze([
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_SECRET_KEY',
  'SUPABASE_SERVICE_KEY',
  'VITE_SUPABASE_SERVICE_ROLE_KEY',
  'VITE_SUPABASE_SECRET_KEY',
  'VITE_SUPABASE_SERVICE_KEY',
]);

const SERVER_ONLY_SECRET_VALUE_ENV_KEYS = Object.freeze([
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_SECRET_KEY',
  'SUPABASE_SERVICE_KEY',
  'VITE_SUPABASE_SERVICE_ROLE_KEY',
  'VITE_SUPABASE_SECRET_KEY',
  'VITE_SUPABASE_SERVICE_KEY',
]);

const TEXT_BUNDLE_EXTENSIONS = new Set([
  '.css',
  '.html',
  '.js',
  '.json',
  '.mjs',
  '.svg',
  '.txt',
]);

function walkFiles(root) {
  const files = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(absolute));
    } else {
      files.push(absolute);
    }
  }
  return files;
}

function isTextBundle(filePath) {
  return TEXT_BUNDLE_EXTENSIONS.has(path.extname(filePath));
}

export function assertNoPublicSourceMaps(rootDir) {
  const files = walkFiles(rootDir);
  const sourceMaps = files.filter((file) => file.endsWith('.map'));
  if (sourceMaps.length > 0) {
    throw new Error(`Public sourcemaps are not allowed in production builds: ${sourceMaps.join(', ')}`);
  }

  const jsWithSourceMapComments = files
    .filter((file) => file.endsWith('.js'))
    .filter((file) => readFileSync(file, 'utf8').includes('sourceMappingURL='));
  if (jsWithSourceMapComments.length > 0) {
    throw new Error(`Production JS still references sourcemaps: ${jsWithSourceMapComments.join(', ')}`);
  }
}

export function assertNoServerOnlySecretMarkers(rootDir, env = process.env) {
  const files = walkFiles(rootDir).filter(isTextBundle);
  const secretValues = SERVER_ONLY_SECRET_VALUE_ENV_KEYS
    .map((key) => ({ key, value: String(env[key] || '').trim() }))
    .filter((item) => item.value.length >= 16);
  const leaks = [];

  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    const relativeFile = path.relative(rootDir, file) || path.basename(file);

    for (const marker of SERVER_ONLY_SECRET_MARKERS) {
      if (source.includes(marker)) {
        leaks.push(`${relativeFile} contains server-only marker ${marker}`);
      }
    }

    for (const item of secretValues) {
      if (source.includes(item.value)) {
        leaks.push(`${relativeFile} contains value from ${item.key}`);
      }
    }
  }

  if (leaks.length > 0) {
    throw new Error(`Production build exposes server-only Supabase secret data: ${leaks.join('; ')}`);
  }
}

function assertObfuscationManifest(rootDir) {
  const manifestPath = path.join(rootDir, '.storyforge-obfuscated.json');
  if (!existsSync(manifestPath)) {
    throw new Error('Missing StoryForge obfuscation manifest. Run obfuscate-first-party before the secure build guard.');
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (!Array.isArray(manifest.processed) || manifest.processed.length === 0) {
    throw new Error('No first-party JS files were obfuscated.');
  }
}

const rootDir = path.resolve(process.argv[2] || 'dist');
if (!existsSync(rootDir)) {
  throw new Error(`Build output not found: ${rootDir}`);
}

assertNoPublicSourceMaps(rootDir);
assertNoServerOnlySecretMarkers(rootDir);
assertObfuscationManifest(rootDir);
console.log(`[secure-build-guard] ${rootDir} passed production hardening checks.`);
