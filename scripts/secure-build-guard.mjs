import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

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
assertObfuscationManifest(rootDir);
console.log(`[secure-build-guard] ${rootDir} passed production hardening checks.`);
