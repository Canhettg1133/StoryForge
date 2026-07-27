import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ADMIN_PERMISSIONS } from '../../../packages/access/src/index.js';
import { encryptSecurePrompt } from '../../../api/_lib/supreme-chat/crypto.js';
import { routeSecurePromptsAdmin } from '../../../apps/admin-api-worker/src/securePrompts/index.js';

const KEY_BYTES = Uint8Array.from({ length: 32 }, (_, index) => 255 - index);
const KEY_BASE64 = Buffer.from(KEY_BYTES).toString('base64');
const VERSION_ID = '56a8a14f-94ae-4a5e-ab1d-5fca5d75ee39';
const OWNER = { id: '7d74228d-20db-4d68-a7de-4f7916c65621' };
const ENV = {
  SUPREME_PROMPT_ACTIVE_KEY_VERSION: '1',
  SUPREME_PROMPT_ENCRYPTION_KEY_V1: KEY_BASE64,
};

function request(method) {
  return new Request('https://admin.example/secure-prompts/supreme-chat', { method });
}

function baseHelpers(overrides = {}) {
  return {
    requirePermission: vi.fn(),
    readJsonLimited: vi.fn(),
    supabaseRest: vi.fn(),
    auditMutation: vi.fn(),
    withResponseHeaders: (payload) => payload,
    ...overrides,
  };
}

describe('Supreme Admin runtime boundary', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('encrypts a new draft before storage and audits metadata only', async () => {
    const plaintext = 'PROMPT OWNER CHỈ ĐƯỢC LƯU DƯỚI DẠNG MÃ HÓA';
    const helpers = baseHelpers({
      readJsonLimited: vi.fn().mockResolvedValue({
        content: plaintext,
        expectedDraftRevision: 2,
      }),
      supabaseRest: vi.fn().mockImplementation(async (_config, resource, options) => {
        if (resource !== 'rpc/save_secure_prompt_draft') return [];
        return [{
          id: options.body.p_version_id,
          prompt_key: 'supreme_chat',
          revision: 3,
          ciphertext: options.body.p_ciphertext,
          iv: options.body.p_iv,
          encryption_key_version: 1,
          content_hash: options.body.p_content_hash,
          content_length: options.body.p_content_length,
          created_by: OWNER.id,
          created_at: '2026-07-27T00:00:00.000Z',
        }];
      }),
    });

    await routeSecurePromptsAdmin({
      request: request('PUT'),
      env: ENV,
      config: {},
      actor: OWNER,
      segments: ['supreme-chat', 'draft'],
      helpers,
    });

    expect(helpers.requirePermission).toHaveBeenCalledWith(
      OWNER,
      ADMIN_PERMISSIONS.SECURE_PROMPTS_WRITE,
    );
    const rpcCall = helpers.supabaseRest.mock.calls.find(
      ([, resource]) => resource === 'rpc/save_secure_prompt_draft',
    );
    expect(rpcCall).toBeTruthy();
    expect(rpcCall[2].body.p_ciphertext).not.toContain(plaintext);
    expect(JSON.stringify(rpcCall[2].body)).not.toContain(plaintext);
    expect(rpcCall[2].body).toMatchObject({
      p_request_id: expect.any(String),
      p_ip_address: expect.any(String),
      p_user_agent: expect.any(String),
    });
    expect(helpers.auditMutation).not.toHaveBeenCalled();
  });

  it('decrypts only the selected draft while history remains metadata-only', async () => {
    const plaintext = 'NỘI DUNG DRAFT TỐI THƯỢNG';
    const encrypted = await encryptSecurePrompt({
      plaintext,
      key: KEY_BYTES,
      promptKey: 'supreme_chat',
      versionId: VERSION_ID,
      keyVersion: 1,
    });
    const version = {
      id: VERSION_ID,
      prompt_key: 'supreme_chat',
      revision: 4,
      ciphertext: encrypted.ciphertext,
      iv: encrypted.iv,
      encryption_key_version: 1,
      content_hash: 'sha256:test',
      content_length: plaintext.length,
      created_by: OWNER.id,
      created_at: '2026-07-27T00:00:00.000Z',
    };
    const helpers = baseHelpers({
      supabaseRest: vi.fn().mockImplementation(async (_config, resource) => {
        if (resource === 'secure_prompt_heads') {
          return [{
            prompt_key: 'supreme_chat',
            draft_version_id: VERSION_ID,
            published_version_id: VERSION_ID,
            enabled: true,
            updated_by: OWNER.id,
            updated_at: '2026-07-27T00:00:00.000Z',
          }];
        }
        if (resource === 'secure_prompt_versions') return [version];
        return [];
      }),
    });

    const payload = await routeSecurePromptsAdmin({
      request: request('GET'),
      env: ENV,
      config: {},
      actor: OWNER,
      segments: ['supreme-chat'],
      helpers,
    });

    expect(helpers.requirePermission).toHaveBeenCalledWith(
      OWNER,
      ADMIN_PERMISSIONS.SECURE_PROMPTS_READ,
    );
    expect(payload.draftContent).toBe(plaintext);
    expect(payload.versions).toEqual([expect.objectContaining({
      id: VERSION_ID,
      revision: 4,
      contentHash: 'sha256:test',
    })]);
    expect(JSON.stringify(payload.versions)).not.toContain(plaintext);
    expect(JSON.stringify(payload.versions)).not.toContain(encrypted.ciphertext);
    const historyCall = helpers.supabaseRest.mock.calls.find(
      ([, resource, options]) => (
        resource === 'secure_prompt_versions'
        && options.query.includes('order=revision.desc')
      ),
    );
    expect(historyCall[2].query).not.toContain('ciphertext');
    expect(historyCall[2].query).not.toContain('iv');
  });

  it('accepts a 60,000-character Unicode draft within the declared body and ciphertext limits', async () => {
    const content = '漢'.repeat(60000);
    const serializedBytes = new TextEncoder().encode(JSON.stringify({
      content,
      expectedDraftRevision: 0,
    })).byteLength;
    const helpers = baseHelpers({
      readJsonLimited: vi.fn().mockResolvedValue({
        content,
        expectedDraftRevision: 0,
      }),
      supabaseRest: vi.fn().mockImplementation(async (_config, resource, options) => {
        if (resource !== 'rpc/save_secure_prompt_draft') return [];
        return [{
          id: options.body.p_version_id,
          prompt_key: 'supreme_chat',
          revision: 1,
          ciphertext: options.body.p_ciphertext,
          iv: options.body.p_iv,
          encryption_key_version: 1,
          content_hash: options.body.p_content_hash,
          content_length: options.body.p_content_length,
        }];
      }),
    });

    await routeSecurePromptsAdmin({
      request: request('PUT'),
      env: ENV,
      config: {},
      actor: OWNER,
      segments: ['supreme-chat', 'draft'],
      helpers,
    });

    expect(helpers.readJsonLimited.mock.calls[0][1]).toBeGreaterThanOrEqual(serializedBytes);
    const rpcCall = helpers.supabaseRest.mock.calls.find(
      ([, resource]) => resource === 'rpc/save_secure_prompt_draft',
    );
    expect(rpcCall[2].body.p_content_length).toBe(60000);
    expect(rpcCall[2].body.p_ciphertext.length).toBeLessThanOrEqual(400000);
  });

  it('keeps the JSON body cap compatible with 60,000 escaped control characters', async () => {
    const content = '\u0000'.repeat(60000);
    const serializedBytes = new TextEncoder().encode(JSON.stringify({
      content,
      expectedDraftRevision: 0,
    })).byteLength;
    const helpers = baseHelpers({
      readJsonLimited: vi.fn(async (_request, maxBytes) => {
        if (maxBytes < serializedBytes) throw new Error('BODY_CAP_TOO_SMALL');
        return {
          content,
          expectedDraftRevision: 0,
        };
      }),
    });

    await expect(routeSecurePromptsAdmin({
      request: request('PUT'),
      env: ENV,
      config: {},
      actor: OWNER,
      segments: ['supreme-chat', 'draft'],
      helpers,
    })).resolves.toMatchObject({ ok: true });

    expect(helpers.readJsonLimited.mock.calls[0][1]).toBeGreaterThanOrEqual(serializedBytes);
  });

  it('fails closed when the encryption secret is unavailable', async () => {
    const helpers = baseHelpers({
      readJsonLimited: vi.fn().mockResolvedValue({
        content: 'Prompt hợp lệ',
        expectedDraftRevision: 0,
      }),
    });

    await expect(routeSecurePromptsAdmin({
      request: request('PUT'),
      env: { SUPREME_PROMPT_ACTIVE_KEY_VERSION: '1' },
      config: {},
      actor: OWNER,
      segments: ['supreme-chat', 'draft'],
      helpers,
    })).rejects.toMatchObject({
      code: 'SECURE_PROMPT_ENCRYPTION_UNAVAILABLE',
      status: 503,
    });
    expect(helpers.supabaseRest).not.toHaveBeenCalled();
    expect(helpers.auditMutation).not.toHaveBeenCalled();
  });

  it('publishes with metadata-only audit context inside the RPC transaction', async () => {
    const version = {
      id: VERSION_ID,
      prompt_key: 'supreme_chat',
      revision: 4,
      encryption_key_version: 1,
      content_hash: 'sha256:published',
      content_length: 123,
      created_by: OWNER.id,
      created_at: '2026-07-27T00:00:00.000Z',
      ciphertext: 'ciphertext',
      iv: 'iv',
    };
    const helpers = baseHelpers({
      readJsonLimited: vi.fn().mockResolvedValue({
        versionId: VERSION_ID,
        expectedPublishedRevision: 3,
      }),
      supabaseRest: vi.fn().mockImplementation(async (_config, resource) => {
        if (resource === 'secure_prompt_heads') {
          return [{
            prompt_key: 'supreme_chat',
            draft_version_id: VERSION_ID,
            published_version_id: 'previous-version',
            enabled: true,
          }];
        }
        if (resource === 'secure_prompt_versions') return [version];
        if (resource === 'rpc/publish_secure_prompt_version') return [{}];
        return [];
      }),
    });

    await routeSecurePromptsAdmin({
      request: new Request('https://admin.example/secure-prompts/supreme-chat/publish', {
        method: 'POST',
        headers: {
          'X-Request-Id': 'admin-request-1',
          'User-Agent': 'Vitest',
        },
      }),
      env: ENV,
      config: {},
      actor: OWNER,
      segments: ['supreme-chat', 'publish'],
      helpers,
    });

    const rpcCall = helpers.supabaseRest.mock.calls.find(
      ([, resource]) => resource === 'rpc/publish_secure_prompt_version',
    );
    expect(rpcCall[2].body).toMatchObject({
      p_audit_action: 'secure_prompt.publish',
      p_request_id: 'admin-request-1',
      p_user_agent: 'Vitest',
    });
    expect(JSON.stringify(rpcCall[2].body)).not.toContain(version.ciphertext);
    expect(helpers.auditMutation).not.toHaveBeenCalled();
  });

  it('paginates prompt history as metadata without loading or decrypting draft content', async () => {
    const versions = Array.from({ length: 26 }, (_, index) => ({
      id: `version-${50 - index}`,
      prompt_key: 'supreme_chat',
      revision: 50 - index,
      encryption_key_version: 1,
      content_hash: `sha256:${50 - index}`,
      content_length: 100 + index,
      created_by: OWNER.id,
      created_at: '2026-07-27T00:00:00.000Z',
    }));
    const helpers = baseHelpers({
      supabaseRest: vi.fn().mockImplementation(async (_config, resource, options) => {
        expect(resource).toBe('secure_prompt_versions');
        expect(options.query).toContain('revision=lt.51');
        expect(options.query).toContain('limit=26');
        expect(options.query).not.toContain('ciphertext');
        expect(options.query).not.toContain('iv');
        return versions;
      }),
    });

    const payload = await routeSecurePromptsAdmin({
      request: new Request(
        'https://admin.example/secure-prompts/supreme-chat?metadataOnly=1&historyBeforeRevision=51',
      ),
      env: ENV,
      config: {},
      actor: OWNER,
      segments: ['supreme-chat'],
      helpers,
    });

    expect(payload).not.toHaveProperty('draftContent');
    expect(payload.versions).toHaveLength(25);
    expect(payload.historyNextBeforeRevision).toBe(26);
    expect(helpers.supabaseRest).toHaveBeenCalledTimes(1);
  });
});
