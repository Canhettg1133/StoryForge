import { describe, expect, it, vi } from 'vitest';

import handler from '../../../api/openai-proxy.js';

function createReqRes({ method = 'POST', body = {}, headers = {} } = {}) {
  const chunks = [];
  const res = {
    statusCode: 200,
    headers: {},
    setHeader(key, value) {
      this.headers[key.toLowerCase()] = value;
    },
    write(chunk) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    },
    end(chunk) {
      if (chunk) this.write(chunk);
      this.body = Buffer.concat(chunks).toString('utf8');
      this.ended = true;
    },
  };

  return {
    req: { method, body, headers },
    res,
  };
}

describe('/api/openai-proxy', () => {
  it('rejects arbitrary actions', async () => {
    const { req, res } = createReqRes({
      body: { action: 'delete', baseUrl: 'https://proxy.example.com' },
    });

    await handler(req, res);

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).code).toBe('OPENAI_PROXY_BAD_ACTION');
  });

  it('rejects private relay targets', async () => {
    const { req, res } = createReqRes({
      body: { action: 'models', baseUrl: 'https://127.0.0.1:1234' },
    });

    await handler(req, res);

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).code).toBe('OPENAI_PROXY_TARGET_BLOCKED');
  });

  it('forwards model listing requests to /v1/models', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      data: [{ id: 'model-a' }],
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    const { req, res } = createReqRes({
      body: {
        action: 'models',
        baseUrl: 'https://proxy.example.com/v1',
        modelsPath: '/v1/models',
      },
      headers: { authorization: 'Bearer test-key' },
    });

    await handler(req, res);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://proxy.example.com/v1/models',
      expect.objectContaining({
        method: 'GET',
        redirect: 'manual',
        headers: expect.objectContaining({ Authorization: 'Bearer test-key' }),
      }),
    );
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).data[0].id).toBe('model-a');
    vi.unstubAllGlobals();
  });

  it('forwards chat payloads without changing the model or messages', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: 'ok' } }],
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    const payload = {
      model: 'custom-model',
      messages: [{ role: 'user', content: 'hello' }],
      stream: false,
      max_tokens: 100,
    };
    const { req, res } = createReqRes({
      body: {
        action: 'chat',
        baseUrl: 'https://proxy.example.com',
        chatCompletionsPath: '/v1/chat/completions',
        payload,
      },
      headers: { authorization: 'Bearer test-key' },
    });

    await handler(req, res);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://proxy.example.com/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
        redirect: 'manual',
        body: JSON.stringify(payload),
      }),
    );
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).choices[0].message.content).toBe('ok');
    vi.unstubAllGlobals();
  });

  it('does not accept Authorization from the JSON body', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      data: [],
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    const { req } = createReqRes({
      body: {
        action: 'models',
        baseUrl: 'https://proxy.example.com',
        authorization: 'Bearer body-key',
      },
    });
    const { res } = createReqRes();

    await handler(req, res);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://proxy.example.com/v1/models',
      expect.objectContaining({
        headers: {},
      }),
    );
    vi.unstubAllGlobals();
  });
});
