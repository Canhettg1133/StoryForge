import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readJson(path) {
  return JSON.parse(readFileSync(resolve(process.cwd(), path), 'utf8'));
}

function readObjectLiteral(source, name) {
  const start = source.indexOf(`const ${name} = Object.freeze({`);
  expect(start).toBeGreaterThanOrEqual(0);
  const braceStart = source.indexOf('{', start);
  let depth = 0;
  for (let index = braceStart; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') depth -= 1;
    if (depth === 0) return source.slice(braceStart + 1, index);
  }
  throw new Error(`Cannot read ${name}`);
}

describe('production security headers', () => {
  it('sets baseline clickjacking, content sniffing, referrer, permissions, and CSP headers', () => {
    const vercel = readJson('vercel.json');
    const globalHeaders = vercel.headers?.find((entry) => entry.source === '/(.*)')?.headers || [];
    const headers = Object.fromEntries(globalHeaders.map((entry) => [entry.key, entry.value]));

    expect(headers['Strict-Transport-Security']).toContain('max-age=31536000');
    expect(headers['X-Content-Type-Options']).toBe('nosniff');
    expect(headers['Referrer-Policy']).toBe('strict-origin-when-cross-origin');
    expect(headers['Permissions-Policy']).toContain('camera=()');
    expect(headers['Content-Security-Policy']).toContain("frame-ancestors 'self'");
    expect(headers['Content-Security-Policy']).toContain("object-src 'none'");
    expect(headers['Content-Security-Policy']).toContain("base-uri 'self'");
    expect(headers['Content-Security-Policy']).not.toContain('upgrade-insecure-requests');
    expect(headers['Content-Security-Policy']).not.toContain("script-src 'self'");

    const reportOnly = headers['Content-Security-Policy-Report-Only'];
    expect(reportOnly).toContain("default-src 'self'");
    expect(reportOnly).toContain("script-src 'self'");
    expect(reportOnly).toContain("script-src-attr 'none'");
    expect(reportOnly).toContain("worker-src 'self' blob:");
    expect(reportOnly).not.toContain("script-src 'self' 'unsafe-inline'");
    expect(reportOnly).not.toContain("'unsafe-eval'");
    expect(reportOnly).toContain("connect-src 'self' https: wss:");
    expect(reportOnly).toContain('http://localhost:*');
    expect(reportOnly).toContain('http://127.0.0.1:*');
  });

  it('keeps remote HTTPS custom proxies and local Ollama endpoints observable during CSP rollout', () => {
    const vercel = readJson('vercel.json');
    const globalHeaders = vercel.headers?.find((entry) => entry.source === '/(.*)')?.headers || [];
    const reportOnly = globalHeaders.find((entry) => entry.key === 'Content-Security-Policy-Report-Only')?.value || '';

    expect(reportOnly).toMatch(/connect-src[^;]*\bhttps:/u);
    expect(reportOnly).toMatch(/connect-src[^;]*\bwss:/u);
    expect(reportOnly).toMatch(/connect-src[^;]*http:\/\/localhost:\*/u);
    expect(reportOnly).toMatch(/connect-src[^;]*http:\/\/127\.0\.0\.1:\*/u);
  });

  it('keeps translator runtime free of inline JavaScript event attributes', () => {
    const runtimeFiles = [
      'public/translator-runtime/index.html',
      'public/translator-runtime/js/app.js',
      'public/translator-runtime/js/history/history.js',
      'public/translator-runtime/js/ui/file-handler.js',
      'public/translator-runtime/js/ui/chunk-tracker.js',
      'public/translator-runtime/js/proxy/proxy-api.js',
      'public/translator-runtime/js/gemini/model-rotation.js',
      'public/translator-runtime/js/local-ai/ollama.js',
    ];
    const combined = runtimeFiles.map((file) => readFileSync(resolve(process.cwd(), file), 'utf8')).join('\n');
    expect(combined).not.toMatch(/\bon[a-z]+\s*=\s*["']/iu);
  });

  it('preserves Enter-to-add behavior without inline key handlers', () => {
    const html = readFileSync(resolve(process.cwd(), 'public/translator-runtime/index.html'), 'utf8');
    const initSource = readFileSync(resolve(process.cwd(), 'public/translator-runtime/js/init.js'), 'utf8');

    expect(html).toContain('id="newProxyKeyInput"');
    expect(html).toContain('data-keydown-action="addProxyKey"');
    expect(html).toContain('id="newCustomProxyKeyInput"');
    expect(html).toContain('data-keydown-action="addCustomProxyKey"');
    expect(initSource).toContain('TRANSLATOR_KEYDOWN_ACTIONS');
    expect(initSource).toContain("event.key !== 'Enter'");
  });

  it('maps every delegated translator action to a static handler', () => {
    const runtimeFiles = [
      'public/translator-runtime/index.html',
      'public/translator-runtime/js/app.js',
      'public/translator-runtime/js/gemini/model-rotation.js',
      'public/translator-runtime/js/history/history.js',
      'public/translator-runtime/js/local-ai/ollama.js',
      'public/translator-runtime/js/proxy/proxy-api.js',
      'public/translator-runtime/js/ui/chunk-tracker.js',
      'public/translator-runtime/js/ui/file-handler.js',
    ];
    const combined = runtimeFiles.map((file) => readFileSync(resolve(process.cwd(), file), 'utf8')).join('\n');
    const initSource = readFileSync(resolve(process.cwd(), 'public/translator-runtime/js/init.js'), 'utf8');
    const mappings = [
      ['data-click-action', 'TRANSLATOR_CLICK_ACTIONS'],
      ['data-change-action', 'TRANSLATOR_CHANGE_ACTIONS'],
      ['data-input-action', 'TRANSLATOR_INPUT_ACTIONS'],
      ['data-keydown-action', 'TRANSLATOR_KEYDOWN_ACTIONS'],
    ];

    for (const [attribute, objectName] of mappings) {
      const actions = [...combined.matchAll(new RegExp(`${attribute}=["']([^"']+)["']`, 'gu'))]
        .map((match) => match[1]);
      const handlerBody = readObjectLiteral(initSource, objectName);
      for (const action of new Set(actions)) {
        expect(handlerBody, `${attribute}=${action}`).toMatch(new RegExp(`\\b${action}\\s*:`, 'u'));
      }
    }
  });

  it('prevents stale SPA HTML while keeping hashed assets cacheable', () => {
    const vercel = readJson('vercel.json');
    const spaHeaders = vercel.headers?.find((entry) => entry.source.includes('(?!api/|assets/'))?.headers || [];
    const assetHeaders = vercel.headers?.find((entry) => entry.source === '/assets/(.*)')?.headers || [];
    const spa = Object.fromEntries(spaHeaders.map((entry) => [entry.key, entry.value]));
    const assets = Object.fromEntries(assetHeaders.map((entry) => [entry.key, entry.value]));

    expect(spa['Cache-Control']).toContain('no-store');
    expect(assets['Cache-Control']).toContain('immutable');
  });
});
