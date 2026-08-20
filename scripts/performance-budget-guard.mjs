import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { gzipSync } from 'node:zlib';
import { pathToFileURL } from 'node:url';

const DEFAULT_EAGER_JS_BUDGET = 250 * 1024;
const DEFAULT_FONT_PRELOAD_BUDGET = 160 * 1024;

function getAttribute(tag, name) {
  return tag.match(new RegExp(`\\b${name}=["']([^"']+)["']`, 'iu'))?.[1] || '';
}

function resolvePublicAsset(outDir, publicPath) {
  const cleanPath = decodeURIComponent(String(publicPath || '').split(/[?#]/u, 1)[0]);
  const relativePath = cleanPath.replace(/^\/+/, '');
  const root = path.resolve(outDir);
  const resolved = path.resolve(root, relativePath);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error(`Performance budget asset escapes output directory: ${publicPath}`);
  }
  return resolved;
}

export function analyzeFrontendBudgets(outDir, options = {}) {
  const eagerJsBudget = options.eagerJsBudget ?? DEFAULT_EAGER_JS_BUDGET;
  const fontPreloadBudget = options.fontPreloadBudget ?? DEFAULT_FONT_PRELOAD_BUDGET;
  const html = readFileSync(path.join(outDir, 'index.html'), 'utf8');
  const tags = html.match(/<(?:script|link)\b[^>]*>/giu) || [];
  const eagerJsPaths = new Set();
  const fontPaths = new Set();

  for (const tag of tags) {
    const rel = getAttribute(tag, 'rel').toLowerCase();
    const src = getAttribute(tag, 'src');
    const href = getAttribute(tag, 'href');
    if (/^<script\b/iu.test(tag) && getAttribute(tag, 'type').toLowerCase() === 'module' && src.endsWith('.js')) {
      eagerJsPaths.add(src);
    }
    if (rel === 'modulepreload' && href.endsWith('.js')) eagerJsPaths.add(href);
    if (rel === 'preload' && getAttribute(tag, 'as').toLowerCase() === 'font') fontPaths.add(href);
  }

  const eagerJsBytes = [...eagerJsPaths].reduce((total, publicPath) => {
    const content = readFileSync(resolvePublicAsset(outDir, publicPath));
    return total + gzipSync(content).byteLength;
  }, 0);
  const fontPreloadBytes = [...fontPaths].reduce((total, publicPath) => (
    total + readFileSync(resolvePublicAsset(outDir, publicPath)).byteLength
  ), 0);

  return {
    eagerJsBytes,
    eagerJsBudget,
    fontPreloadBytes,
    fontPreloadBudget,
    eagerJsPaths: [...eagerJsPaths],
    fontPaths: [...fontPaths],
    passed: eagerJsBytes <= eagerJsBudget && fontPreloadBytes <= fontPreloadBudget,
  };
}

export function assertFrontendBudgets(outDir, options = {}) {
  const result = analyzeFrontendBudgets(outDir, options);
  if (!result.passed) {
    throw new Error([
      'Frontend performance budget exceeded.',
      `Eager JavaScript: ${result.eagerJsBytes} / ${result.eagerJsBudget} bytes gzip.`,
      `Preloaded fonts: ${result.fontPreloadBytes} / ${result.fontPreloadBudget} bytes.`,
    ].join('\n'));
  }
  return result;
}

const isDirectRun = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isDirectRun) {
  const outDir = process.argv[2] || 'dist';
  const result = assertFrontendBudgets(outDir);
  console.log(
    `[performance-budget-guard] eager-js=${result.eagerJsBytes}B gzip, preloaded-fonts=${result.fontPreloadBytes}B`,
  );
}
