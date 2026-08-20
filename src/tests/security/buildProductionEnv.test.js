import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  assertNoForbiddenPublicSupabaseEnv,
  assertRequiredEnv,
  loadEnvFile,
  loadProductionBuildEnv,
  loadVercelProductionEnv,
  resolveFrontendBudgetOutDir,
  sanitizeClientBuildEnv,
} from '../../../scripts/build-production-app.mjs';

describe('production build env loading', () => {
  it('targets the Cloudflare client bundle when enforcing frontend budgets', () => {
    expect(resolveFrontendBudgetOutDir('dist', { STORYFORGE_CLOUDFLARE: 'true' }))
      .toBe(path.join('dist', 'client'));
    expect(resolveFrontendBudgetOutDir('dist', {})).toBe('dist');
  });

  it('loads Vercel production env for local prebuilt deploys without overriding existing values', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'storyforge-env-'));
    const vercelDir = path.join(root, '.vercel');
    mkdirSync(vercelDir);
    writeFileSync(
      path.join(vercelDir, '.env.production.local'),
      [
        'VITE_SUPABASE_URL=https://storyforge.supabase.co',
        'VITE_SUPABASE_ANON_KEY="anon-key"',
        'VITE_ADMIN_API_BASE_URL=https://admin.example.test',
        '',
      ].join('\n'),
    );
    const env = { VITE_SUPABASE_URL: 'https://existing.supabase.co' };

    try {
      const loaded = loadVercelProductionEnv(root, env);

      expect(loaded).toEqual(['VITE_SUPABASE_ANON_KEY', 'VITE_ADMIN_API_BASE_URL']);
      expect(env.VITE_SUPABASE_URL).toBe('https://existing.supabase.co');
      expect(env.VITE_SUPABASE_ANON_KEY).toBe('anon-key');
      expect(env.VITE_ADMIN_API_BASE_URL).toBe('https://admin.example.test');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('loads root Vite env before falling back to Vercel production env', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'storyforge-root-env-'));
    const vercelDir = path.join(root, '.vercel');
    mkdirSync(vercelDir);
    writeFileSync(path.join(root, '.env.local'), [
      'VITE_SUPABASE_URL=https://local.supabase.co',
      'VITE_SUPABASE_ANON_KEY=local-anon-key',
      '',
    ].join('\n'));
    writeFileSync(path.join(vercelDir, '.env.production.local'), [
      'VITE_SUPABASE_URL=',
      'VITE_ADMIN_API_BASE_URL=https://admin.example.test',
      '',
    ].join('\n'));
    const env = {};

    try {
      const loaded = loadProductionBuildEnv(root, env);

      expect(loaded).toEqual([
        'VITE_SUPABASE_URL',
        'VITE_SUPABASE_ANON_KEY',
        'VITE_ADMIN_API_BASE_URL',
      ]);
      expect(env.VITE_SUPABASE_URL).toBe('https://local.supabase.co');
      expect(env.VITE_SUPABASE_ANON_KEY).toBe('local-anon-key');
      expect(env.VITE_ADMIN_API_BASE_URL).toBe('https://admin.example.test');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('does not load server-only Supabase secrets into the client production build env', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'storyforge-client-env-'));
    writeFileSync(path.join(root, '.env.local'), [
      'VITE_SUPABASE_URL=https://local.supabase.co',
      'VITE_SUPABASE_ANON_KEY=local-anon-key',
      'SUPABASE_SERVICE_ROLE_KEY=server-only-service-role-key',
      'SUPABASE_SECRET_KEY=server-only-secret-key',
      '',
    ].join('\n'));
    const env = {};

    try {
      expect(loadProductionBuildEnv(root, env)).toEqual([
        'VITE_SUPABASE_URL',
        'VITE_SUPABASE_ANON_KEY',
      ]);
      expect(env.VITE_SUPABASE_URL).toBe('https://local.supabase.co');
      expect(env.VITE_SUPABASE_ANON_KEY).toBe('local-anon-key');
      expect(env.SUPABASE_SERVICE_ROLE_KEY).toBeUndefined();
      expect(env.SUPABASE_SECRET_KEY).toBeUndefined();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects Supabase service role keys when they are accidentally prefixed as public Vite env', () => {
    expect(() => assertNoForbiddenPublicSupabaseEnv({
      VITE_SUPABASE_URL: 'https://storyforge.supabase.co',
      VITE_SUPABASE_ANON_KEY: 'anon-key',
      VITE_SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
    })).toThrow(/VITE_SUPABASE_SERVICE_ROLE_KEY/u);
  });

  it('removes server-only Supabase secrets from the Vite child-process env', () => {
    const env = sanitizeClientBuildEnv({
      VITE_SUPABASE_URL: 'https://storyforge.supabase.co',
      VITE_SUPABASE_ANON_KEY: 'anon-key',
      SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
      SUPABASE_SECRET_KEY: 'secret-key',
      SUPABASE_SERVICE_KEY: 'legacy-service-key',
    });

    expect(env.VITE_SUPABASE_URL).toBe('https://storyforge.supabase.co');
    expect(env.VITE_SUPABASE_ANON_KEY).toBe('anon-key');
    expect(env.SUPABASE_SERVICE_ROLE_KEY).toBeUndefined();
    expect(env.SUPABASE_SECRET_KEY).toBeUndefined();
    expect(env.SUPABASE_SERVICE_KEY).toBeUndefined();
  });

  it('reports missing production client env keys before building', () => {
    expect(() => assertRequiredEnv(['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'], {
      VITE_SUPABASE_URL: 'https://storyforge.supabase.co',
    })).toThrow(/VITE_SUPABASE_ANON_KEY/u);
  });

  it('parses exported and quoted env file values', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'storyforge-env-file-'));
    const envPath = path.join(root, '.env.production.local');
    writeFileSync(envPath, [
      'export VITE_SUPABASE_URL="https://storyforge.supabase.co"',
      "VITE_SUPABASE_ANON_KEY='anon-key'",
      '',
    ].join('\n'));
    const env = {};

    try {
      expect(loadEnvFile(envPath, env)).toEqual(['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY']);
      expect(env.VITE_SUPABASE_URL).toBe('https://storyforge.supabase.co');
      expect(env.VITE_SUPABASE_ANON_KEY).toBe('anon-key');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('skips empty env values so a later source can supply the key', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'storyforge-empty-env-'));
    const envPath = path.join(root, '.env.production.local');
    writeFileSync(envPath, [
      'VITE_SUPABASE_URL=',
      'VITE_SUPABASE_ANON_KEY=anon-key',
      '',
    ].join('\n'));
    const env = {};

    try {
      expect(loadEnvFile(envPath, env)).toEqual(['VITE_SUPABASE_ANON_KEY']);
      expect(env.VITE_SUPABASE_URL).toBeUndefined();
      expect(env.VITE_SUPABASE_ANON_KEY).toBe('anon-key');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
