import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readJson(path) {
  return JSON.parse(readFileSync(resolve(process.cwd(), path), 'utf8'));
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
    expect(headers['Content-Security-Policy-Report-Only']).toContain("default-src 'self'");
    expect(headers['Content-Security-Policy-Report-Only']).toContain("connect-src 'self' https: wss:");
  });
});
