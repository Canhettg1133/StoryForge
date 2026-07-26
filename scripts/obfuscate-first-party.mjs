import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import JavaScriptObfuscator from 'javascript-obfuscator';

function walkJsFiles(root) {
  const files = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkJsFiles(absolute));
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      files.push(absolute);
    }
  }
  return files;
}

function isVendorChunk(file) {
  return path.basename(file).startsWith('vendor');
}

const rootDir = path.resolve(process.argv[2] || 'dist');
if (!existsSync(rootDir)) {
  throw new Error(`Build output not found: ${rootDir}`);
}

const manifest = {
  processed: [],
  skipped: [],
};

for (const file of walkJsFiles(rootDir)) {
  const relative = path.relative(rootDir, file).replace(/\\/g, '/');
  if (isVendorChunk(file)) {
    manifest.skipped.push(relative);
    continue;
  }

  const source = readFileSync(file, 'utf8');
  const result = JavaScriptObfuscator.obfuscate(source, {
    compact: true,
    controlFlowFlattening: false,
    deadCodeInjection: false,
    identifierNamesGenerator: 'mangled',
    renameGlobals: false,
    selfDefending: false,
    stringArray: false,
    transformObjectKeys: false,
  });
  writeFileSync(file, result.getObfuscatedCode());
  manifest.processed.push(relative);
}

writeFileSync(
  path.join(rootDir, '.storyforge-obfuscated.json'),
  `${JSON.stringify(manifest, null, 2)}\n`,
);
console.log(`[obfuscate-first-party] processed=${manifest.processed.length} skipped=${manifest.skipped.length}`);
