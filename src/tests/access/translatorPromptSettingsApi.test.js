import { describe, expect, it } from 'vitest';
import { createTranslatorPromptSettingsHandler } from '../../../api/translator-prompt-settings.js';

function createReqRes({ method = 'GET' } = {}) {
  const chunks = [];
  const res = {
    statusCode: 200,
    headers: {},
    setHeader(key, value) {
      this.headers[key.toLowerCase()] = value;
    },
    end(chunk) {
      if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
      this.body = Buffer.concat(chunks).toString('utf8');
      this.ended = true;
    },
  };
  return { req: { method }, res };
}

describe('/api/translator-prompt-settings', () => {
  it('returns only active public prompt content without admin metadata', async () => {
    const handler = createTranslatorPromptSettingsHandler({
      fetchPromptSettings: async () => [
        {
          domain: 'translator',
          key: 'sacHiepPro',
          content: 'Prompt global cho SH Pro',
          enabled: true,
          revision: 5,
          updated_by: 'owner-1',
          actor_email: 'owner@example.com',
          content_hash: 'sha256:private',
        },
        {
          domain: 'translator',
          key: 'adult',
          content: 'Prompt đang tắt',
          enabled: false,
          revision: 6,
        },
      ],
    });

    const { req, res } = createReqRes();
    await handler(req, res);
    const payload = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(payload).toEqual({
      ok: true,
      source: 'database',
      prompts: {
        sacHiepPro: 'Prompt global cho SH Pro',
      },
      revision: 5,
    });
    expect(JSON.stringify(payload)).not.toContain('owner-1');
    expect(JSON.stringify(payload)).not.toContain('owner@example.com');
    expect(JSON.stringify(payload)).not.toContain('sha256:private');
    expect(JSON.stringify(payload)).not.toContain('Prompt đang tắt');
  });

  it('falls back to an empty prompt map when storage is unavailable', async () => {
    const handler = createTranslatorPromptSettingsHandler({
      fetchPromptSettings: async () => {
        throw new Error('SUPABASE_DOWN');
      },
    });

    const { req, res } = createReqRes();
    await handler(req, res);
    const payload = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(payload).toEqual({
      ok: true,
      source: 'fallback',
      prompts: {},
      revision: 0,
    });
  });

  it('rejects unsupported methods', async () => {
    const handler = createTranslatorPromptSettingsHandler();
    const { req, res } = createReqRes({ method: 'POST' });

    await handler(req, res);
    const payload = JSON.parse(res.body);

    expect(res.statusCode).toBe(405);
    expect(payload.code).toBe('METHOD_NOT_ALLOWED');
  });
});
