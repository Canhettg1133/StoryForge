import { describe, expect, it, vi } from 'vitest';

import { createOpenAIProxyHandler } from '../../../api/openai-proxy.js';

const handler = createOpenAIProxyHandler({
  requireFeatureImpl: async (_req, featureKey) => ({
    ok: true,
    decision: { allowed: true, feature: featureKey },
    user: { id: 'test-user' },
  }),
});

function createReqRes({ method = 'POST', body = {}, headers = {} } = {}) {
  const chunks = [];
  const res = {
    statusCode: 200,
    headers: {},
    headersSent: false,
    writableEnded: false,
    setHeader(key, value) {
      if (this.headersSent) {
        throw new Error('Cannot set headers after they are sent to the client');
      }
      this.headers[key.toLowerCase()] = value;
    },
    flushHeaders() {
      this.headersSent = true;
    },
    write(chunk) {
      this.headersSent = true;
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    },
    end(chunk) {
      if (chunk) this.write(chunk);
      this.body = Buffer.concat(chunks).toString('utf8');
      this.ended = true;
      this.headersSent = true;
      this.writableEnded = true;
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
      headers: { 'x-storyforge-upstream-key': 'test-key' },
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
      headers: { 'x-storyforge-upstream-key': 'test-key' },
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

  it('logs only allowlisted usage metadata for admin activity labels', async () => {
    const insertMock = vi.fn(async () => ({ error: null }));
    const loggingHandler = createOpenAIProxyHandler({
      requireFeatureImpl: async (_req, featureKey) => ({
        ok: true,
        decision: { allowed: true, feature: featureKey },
        user: { id: 'usage-user' },
        supabase: {
          from: (table) => {
            expect(table).toBe('usage_events');
            return { insert: insertMock };
          },
        },
      }),
    });
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: 'ok' } }],
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    const { req, res } = createReqRes({
      body: {
        action: 'chat',
        baseUrl: 'https://proxy.example.com',
        chatCompletionsPath: '/v1/chat/completions',
        usage: {
          taskType: 'continue',
          taskGroup: 'story_writing',
          taskLabel: 'Viết truyện',
          surface: 'writer',
          chatMode: 'story',
          prompt: 'khong duoc luu',
          messages: [{ content: 'khong duoc luu' }],
        },
        payload: {
          model: 'custom-model',
          messages: [{ role: 'user', content: 'hello' }],
          stream: false,
        },
      },
      headers: { 'x-storyforge-upstream-key': 'test-key' },
    });

    await loggingHandler(req, res);

    expect(res.statusCode).toBe(200);
    expect(insertMock).toHaveBeenCalledWith(expect.objectContaining({
      user_id: 'usage-user',
      feature_key: 'ai_chat.access',
      metadata: expect.objectContaining({
        action: 'chat',
        taskType: 'continue',
        taskGroup: 'story_writing',
        taskLabel: 'Viết truyện',
        surface: 'writer',
        chatMode: 'story',
      }),
    }));
    const inserted = insertMock.mock.calls[0][0];
    expect(JSON.stringify(inserted.metadata)).not.toContain('prompt');
    expect(JSON.stringify(inserted.metadata)).not.toContain('khong duoc luu');
    vi.unstubAllGlobals();
  });

  it('records chat usage before streaming chunks to the client', async () => {
    const insertMock = vi.fn(async () => ({ error: null }));
    const loggingHandler = createOpenAIProxyHandler({
      requireFeatureImpl: async (_req, featureKey) => ({
        ok: true,
        decision: { allowed: true, feature: featureKey },
        user: { id: 'stream-user' },
        supabase: {
          from: (table) => {
            expect(table).toBe('usage_events');
            return { insert: insertMock };
          },
        },
      }),
    });
    const encoder = new TextEncoder();
    const fetchMock = vi.fn(async () => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"a"}}]}\n\n'));
        controller.close();
      },
    }), {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    const { req, res } = createReqRes({
      body: {
        action: 'chat',
        baseUrl: 'https://proxy.example.com',
        chatCompletionsPath: '/v1/chat/completions',
        usage: {
          taskType: 'arc_chapter_draft',
          taskGroup: 'story_writing',
          taskLabel: 'Viết truyện',
          surface: 'writer',
        },
        payload: {
          model: 'custom-model',
          messages: [{ role: 'user', content: 'write chapter' }],
          stream: true,
        },
      },
      headers: { 'x-storyforge-upstream-key': 'test-key' },
    });
    const write = res.write.bind(res);
    res.write = (chunk) => {
      expect(insertMock).toHaveBeenCalledTimes(1);
      return write(chunk);
    };

    await loggingHandler(req, res);

    expect(res.statusCode).toBe(200);
    expect(insertMock).toHaveBeenCalledWith(expect.objectContaining({
      user_id: 'stream-user',
      status: 'ok',
      metadata: expect.objectContaining({
        taskType: 'arc_chapter_draft',
        taskLabel: 'Viết truyện',
      }),
    }));
    vi.unstubAllGlobals();
  });

  it('streams chat_stream_batch results as each upstream payload resolves', async () => {
    const fetchMock = vi.fn(async (url, options) => new Response(JSON.stringify({
      choices: [{ message: { content: JSON.parse(options.body).messages[0].content } }],
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    const payloads = [
      { model: 'custom-model', messages: [{ role: 'user', content: 'a' }] },
      { model: 'custom-model', messages: [{ role: 'user', content: 'b' }] },
    ];
    const { req, res } = createReqRes({
      body: {
        action: 'chat_stream_batch',
        baseUrl: 'https://proxy.example.com',
        chatCompletionsPath: '/v1/chat/completions',
        payloads,
      },
      headers: { 'x-storyforge-upstream-key': 'test-key' },
    });

    await handler(req, res);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toBe('https://proxy.example.com/v1/chat/completions');
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer test-key');
    expect(fetchMock.mock.calls[0][1].body).toBe(JSON.stringify(payloads[0]));
    expect(fetchMock.mock.calls[1][1].body).toBe(JSON.stringify(payloads[1]));
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/x-ndjson');
    const lines = res.body.trim().split('\n').map((line) => JSON.parse(line));
    expect(lines).toHaveLength(2);
    expect(lines.map((line) => line.index).sort()).toEqual([0, 1]);
    expect(lines.every((line) => line.ok && line.status === 200)).toBe(true);
    vi.unstubAllGlobals();
  });

  it('does not send a second JSON error after an upstream stream already flushed headers', async () => {
    let readCount = 0;
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: {
        get: (key) => (String(key).toLowerCase() === 'content-type' ? 'application/json' : ''),
      },
      body: {
        getReader: () => ({
          async read() {
            readCount += 1;
            if (readCount === 1) {
              return { done: false, value: Buffer.from('{"partial":') };
            }
            throw new Error('upstream stream broke');
          },
        }),
      },
    }));
    vi.stubGlobal('fetch', fetchMock);

    const { req, res } = createReqRes({
      body: {
        action: 'chat',
        baseUrl: 'https://proxy.example.com',
        chatCompletionsPath: '/v1/chat/completions',
        payload: { model: 'custom-model', messages: [{ role: 'user', content: 'hello' }] },
      },
      headers: { 'x-storyforge-upstream-key': 'test-key' },
    });

    await expect(handler(req, res)).resolves.toBeUndefined();

    expect(res.statusCode).toBe(200);
    expect(res.headersSent).toBe(true);
    expect(res.writableEnded).toBe(true);
    expect(res.body).toBe('{"partial":');
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
      headers: { 'x-storyforge-upstream-key': 'header-key' },
    });
    const { res } = createReqRes();

    await handler(req, res);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://proxy.example.com/v1/models',
      expect.objectContaining({
        headers: { Authorization: 'Bearer header-key' },
      }),
    );
    vi.unstubAllGlobals();
  });
});
