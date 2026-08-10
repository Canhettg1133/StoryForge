// @vitest-environment node
import {
  exportJWK,
  generateKeyPair,
  SignJWT,
} from 'jose';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  authenticateRequest,
  clearCloudSyncJwksCache,
} from '../../../apps/cloud-sync-worker/src/auth.js';

const USER_ID = '11111111-1111-4111-8111-111111111111';

function base64Url(value) {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function token(alg = 'HS256') {
  return `${base64Url({ alg, typ: 'JWT' })}.${base64Url({
    sub: USER_ID,
    role: 'authenticated',
    aud: 'authenticated',
    iss: 'https://storyforge.supabase.co/auth/v1',
    exp: Math.floor(Date.now() / 1000) + 300,
  })}.test-signature`;
}

function request(accessToken) {
  return new Request('https://cloud-sync.storyforge.test/cloud-sync/v1/snapshots', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

const env = {
  SUPABASE_URL: 'https://storyforge.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: 'publishable-key',
  SUPABASE_SERVICE_ROLE_KEY: 'must-not-be-forwarded',
};

afterEach(() => {
  clearCloudSyncJwksCache();
  vi.unstubAllGlobals();
});

describe('Cloud Sync Worker authentication', () => {
  async function createEs256Token({
    issuer = `${env.SUPABASE_URL}/auth/v1`,
    expiresAt = Math.floor(Date.now() / 1000) + 300,
    role = 'authenticated',
    audience = 'authenticated',
    signingKeyPair,
  } = {}) {
    const keyPair = signingKeyPair || await generateKeyPair('ES256');
    const accessToken = await new SignJWT({ role })
      .setProtectedHeader({ alg: 'ES256', kid: 'test-signing-key' })
      .setSubject(USER_ID)
      .setIssuer(issuer)
      .setAudience(audience)
      .setExpirationTime(expiresAt)
      .sign(keyPair.privateKey);
    return { accessToken, keyPair };
  }

  async function stubJwks(publicKey) {
    const jwk = await exportJWK(publicKey);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      keys: [{ ...jwk, alg: 'ES256', kid: 'test-signing-key', use: 'sig' }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'max-age=60' },
    })));
  }

  it('verifies a production-style ES256 token through the exact Supabase JWKS issuer', async () => {
    clearCloudSyncJwksCache();
    const { accessToken, keyPair } = await createEs256Token();
    await stubJwks(keyPair.publicKey);

    await expect(authenticateRequest(request(accessToken), env)).resolves.toEqual({
      id: USER_ID,
      role: 'authenticated',
    });
  });

  it.each([
    ['expired', { expiresAt: Math.floor(Date.now() / 1000) - 60 }],
    ['wrong issuer', { issuer: 'https://other-project.supabase.co/auth/v1' }],
    ['wrong audience', { audience: 'anon' }],
    ['missing authenticated role', { role: 'anon' }],
  ])('rejects an ES256 token with %s claims', async (_label, overrides) => {
    clearCloudSyncJwksCache();
    const { accessToken, keyPair } = await createEs256Token(overrides);
    await stubJwks(keyPair.publicKey);

    await expect(authenticateRequest(request(accessToken), env))
      .rejects.toMatchObject({ code: 'UNAUTHORIZED', status: 401 });
  });

  it('rejects an ES256 token signed by a key that is not in JWKS', async () => {
    clearCloudSyncJwksCache();
    const trusted = await generateKeyPair('ES256');
    const untrusted = await generateKeyPair('ES256');
    const { accessToken } = await createEs256Token({ signingKeyPair: untrusted });
    await stubJwks(trusted.publicKey);

    await expect(authenticateRequest(request(accessToken), env))
      .rejects.toMatchObject({ code: 'UNAUTHORIZED', status: 401 });
  });

  it('delegates only legacy HS256 tokens to Supabase Auth with the publishable key', async () => {
    const fetchImpl = vi.fn(async (_url, init) => new Response(JSON.stringify({
      id: USER_ID,
      role: 'authenticated',
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    const accessToken = token();

    await expect(authenticateRequest(request(accessToken), env, fetchImpl)).resolves.toEqual({
      id: USER_ID,
      role: 'authenticated',
    });
    const headers = new Headers(fetchImpl.mock.calls[0][1].headers);
    expect(headers.get('apikey')).toBe('publishable-key');
    expect(headers.get('Authorization')).toBe(`Bearer ${accessToken}`);
    expect(JSON.stringify(fetchImpl.mock.calls[0])).not.toContain('must-not-be-forwarded');
  });

  it('rejects unsupported JWT algorithms before any network fallback', async () => {
    const fetchImpl = vi.fn();
    const accessToken = token('HS384');

    await expect(authenticateRequest(request(accessToken), env, fetchImpl))
      .rejects.toMatchObject({ code: 'UNAUTHORIZED', status: 401 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects a legacy token when Supabase Auth does not return an authenticated user', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      id: USER_ID,
      role: 'anon',
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

    await expect(authenticateRequest(request(token()), env, fetchImpl))
      .rejects.toMatchObject({ code: 'UNAUTHORIZED', status: 401 });
  });

  it('does not invent a role when the legacy user response omits it', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ id: USER_ID }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));

    await expect(authenticateRequest(request(token()), env, fetchImpl))
      .rejects.toMatchObject({ code: 'UNAUTHORIZED', status: 401 });
  });

  it('rejects a non-UUID subject returned by the legacy auth fallback', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      id: '../other-user',
      role: 'authenticated',
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

    await expect(authenticateRequest(request(token()), env, fetchImpl))
      .rejects.toMatchObject({ code: 'UNAUTHORIZED', status: 401 });
  });
});
