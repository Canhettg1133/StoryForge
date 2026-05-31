import { describe, expect, it, vi } from 'vitest';

import { createOpenAIProxyHandler } from '../../../api/openai-proxy.js';
import { createTranslatorOpenAIProxyHandler } from '../../../api/translator-openai-proxy.js';

const allowFeature = async () => ({
  ok: true,
  user: { id: 'user-1' },
  decision: { allowed: true },
});

const handler = createOpenAIProxyHandler({ requireFeatureImpl: allowFeature });

function createFeatureGate(allowedFeatures = []) {
  const allowed = new Set(allowedFeatures);
  const calls = [];
  const requireFeatureImpl = async (req, feature, context = {}) => {
    calls.push({ feature, context });
    const ok = allowed.has(feature);
    return {
      ok,
      user: { id: 'user-1' },
      decision: {
        allowed: ok,
        status: ok ? 200 : 403,
        reason: ok ? 'FEATURE_ALLOWED' : 'FEATURE_NOT_ALLOWED',
        feature,
      },
    };
  };
  return { calls, requireFeatureImpl };
}

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

  it('does not trust spoofed workflow/provider features from the request body', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const gate = createFeatureGate(['translator.access']);
    const spoofHandler = createOpenAIProxyHandler({ requireFeatureImpl: gate.requireFeatureImpl });
    const { req, res } = createReqRes({
      body: {
        action: 'chat',
        baseUrl: 'https://proxy.example.com',
        chatCompletionsPath: '/v1/chat/completions',
        accessFeature: 'translator.access',
        workflowFeature: 'translator.access',
        providerFeature: 'translator.access',
        payload: { model: 'm', messages: [{ role: 'user', content: 'hello' }] },
      },
      headers: {
        authorization: 'Bearer storyforge-token',
        'x-storyforge-upstream-key': 'test-key',
      },
    });

    await spoofHandler(req, res);

    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).feature).toBe('ai_chat.access');
    expect(gate.calls.map((call) => call.feature)).toContain('ai_chat.access');
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('infers custom proxy from parsed baseUrl even when body claims AG provider', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const gate = createFeatureGate(['ai_chat.access', 'provider.ag_proxy']);
    const spoofHandler = createOpenAIProxyHandler({ requireFeatureImpl: gate.requireFeatureImpl });
    const { req, res } = createReqRes({
      body: {
        action: 'chat',
        baseUrl: 'https://proxy.example.com',
        chatCompletionsPath: '/v1/chat/completions',
        providerFeature: 'provider.ag_proxy',
        payload: { model: 'm', messages: [{ role: 'user', content: 'hello' }] },
      },
      headers: {
        authorization: 'Bearer storyforge-token',
        'x-storyforge-upstream-key': 'test-key',
      },
    });

    await spoofHandler(req, res);

    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).feature).toBe('provider.custom_proxy');
    expect(gate.calls.map((call) => call.feature)).toEqual(['ai_chat.access', 'provider.custom_proxy']);
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('does not classify crafted AG-looking hostnames as AG proxy', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const gate = createFeatureGate(['ai_chat.access', 'provider.ag_proxy']);
    const spoofHandler = createOpenAIProxyHandler({ requireFeatureImpl: gate.requireFeatureImpl });
    const { req, res } = createReqRes({
      body: {
        action: 'chat',
        baseUrl: 'https://ag.beijixingxing.com.evil.com',
        payload: { model: 'm', messages: [{ role: 'user', content: 'hello' }] },
      },
      headers: {
        authorization: 'Bearer storyforge-token',
        'x-storyforge-upstream-key': 'test-key',
      },
    });

    await spoofHandler(req, res);

    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).feature).toBe('provider.custom_proxy');
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('rejects relay targets with URL userinfo before entitlement checks', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const gate = createFeatureGate(['ai_chat.access', 'provider.custom_proxy']);
    const spoofHandler = createOpenAIProxyHandler({ requireFeatureImpl: gate.requireFeatureImpl });
    const { req, res } = createReqRes({
      body: {
        action: 'chat',
        baseUrl: 'https://ag.beijixingxing.com@evil.com',
        payload: { model: 'm', messages: [{ role: 'user', content: 'hello' }] },
      },
      headers: {
        authorization: 'Bearer storyforge-token',
        'x-storyforge-upstream-key': 'test-key',
      },
    });

    await spoofHandler(req, res);

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).code).toBe('OPENAI_PROXY_TARGET_BLOCKED');
    expect(gate.calls).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
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
      headers: {
        authorization: 'Bearer storyforge-token',
        'x-storyforge-upstream-key': 'test-key',
      },
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
      headers: {
        authorization: 'Bearer storyforge-token',
        'x-storyforge-upstream-key': 'test-key',
      },
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
      headers: {
        authorization: 'Bearer storyforge-token',
        'x-storyforge-upstream-key': 'test-key',
      },
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

  it('uses the same workflow and provider guard for batch requests', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const gate = createFeatureGate(['ai_chat.access']);
    const batchHandler = createOpenAIProxyHandler({ requireFeatureImpl: gate.requireFeatureImpl });
    const { req, res } = createReqRes({
      body: {
        action: 'chat_stream_batch',
        baseUrl: 'https://proxy.example.com',
        chatCompletionsPath: '/v1/chat/completions',
        payloads: [
          { model: 'custom-model', messages: [{ role: 'user', content: 'a' }] },
          { model: 'custom-model', messages: [{ role: 'user', content: 'b' }] },
        ],
      },
      headers: {
        authorization: 'Bearer storyforge-token',
        'x-storyforge-upstream-key': 'test-key',
      },
    });

    await batchHandler(req, res);

    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).feature).toBe('provider.custom_proxy');
    expect(gate.calls.map((call) => call.feature)).toEqual(['ai_chat.access', 'provider.custom_proxy']);
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('does not use Authorization as the upstream provider key', async () => {
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
      headers: { authorization: 'Bearer storyforge-token' },
    });
    const { res } = createReqRes();

    await handler(req, res);

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).code).toBe('OPENAI_PROXY_UPSTREAM_KEY_REQUIRED');
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

describe('/api/translator-openai-proxy', () => {
  it('requires a server-recognized translator template for chat requests', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const gate = createFeatureGate(['translator.access', 'provider.custom_proxy']);
    const translatorHandler = createTranslatorOpenAIProxyHandler({ requireFeatureImpl: gate.requireFeatureImpl });
    const { req, res } = createReqRes({
      body: {
        action: 'chat',
        baseUrl: 'https://proxy.example.com',
        payload: { model: 'm', messages: [{ role: 'user', content: 'hello' }] },
      },
      headers: {
        authorization: 'Bearer storyforge-token',
        'x-storyforge-upstream-key': 'test-key',
      },
    });

    await translatorHandler(req, res);

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).code).toBe('TRANSLATOR_TEMPLATE_REQUIRED');
    expect(gate.calls).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('requires content.adult_mode for adult templates even when adultMode is false', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const gate = createFeatureGate(['translator.access', 'provider.custom_proxy']);
    const translatorHandler = createTranslatorOpenAIProxyHandler({ requireFeatureImpl: gate.requireFeatureImpl });
    const { req, res } = createReqRes({
      body: {
        action: 'chat',
        baseUrl: 'https://proxy.example.com',
        templateId: 'sacHiepENI',
        adultMode: false,
        payload: { model: 'm', messages: [{ role: 'user', content: 'hello' }] },
      },
      headers: {
        authorization: 'Bearer storyforge-token',
        'x-storyforge-upstream-key': 'test-key',
      },
    });

    await translatorHandler(req, res);

    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).feature).toBe('content.adult_mode');
    expect(gate.calls.map((call) => call.feature)).toEqual([
      'translator.access',
      'provider.custom_proxy',
      'content.adult_mode',
    ]);
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
