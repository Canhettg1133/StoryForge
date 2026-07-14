import { describe, expect, it } from 'vitest';
import {
  buildOpenAICompatibleToolPayload,
  parseOpenAICompatibleToolResponse,
  requestOpenAICompatibleToolTurn,
} from '../../services/ai/openAICompatibleToolClient.js';

const loadContextTool = {
  type: 'function',
  function: {
    name: 'load_codex_analysis_context',
    description: 'Load the bounded local analysis context.',
    strict: true,
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {},
      required: [],
    },
  },
};

describe('OpenAI-compatible Codex tool client', () => {
  it('builds a required non-streaming single-tool payload', () => {
    const payload = buildOpenAICompatibleToolPayload({
      model: 'test-model',
      messages: [{ role: 'system', content: 'Resolve entities.' }],
      tools: [loadContextTool],
    });

    expect(payload).toEqual(expect.objectContaining({
      model: 'test-model',
      stream: false,
      tool_choice: 'required',
      parallel_tool_calls: false,
      tools: [loadContextTool],
    }));
  });

  it('preserves a valid tool call and parses its JSON arguments', () => {
    const parsed = parseOpenAICompatibleToolResponse({
      choices: [{
        finish_reason: 'tool_calls',
        message: {
          role: 'assistant',
          tool_calls: [{
            id: 'call-1',
            type: 'function',
            function: {
              name: 'load_codex_analysis_context',
              arguments: '{}',
            },
          }],
        },
      }],
    }, {
      allowedToolNames: ['load_codex_analysis_context'],
    });

    expect(parsed).toEqual(expect.objectContaining({
      toolCallId: 'call-1',
      name: 'load_codex_analysis_context',
      arguments: {},
    }));
  });

  it('fails closed for unknown or parallel tool calls', () => {
    const response = {
      choices: [{
        message: {
          tool_calls: [
            { id: 'call-1', type: 'function', function: { name: 'unknown_tool', arguments: '{}' } },
            { id: 'call-2', type: 'function', function: { name: 'load_codex_analysis_context', arguments: '{}' } },
          ],
        },
      }],
    };

    expect(() => parseOpenAICompatibleToolResponse(response, {
      allowedToolNames: ['load_codex_analysis_context'],
    })).toThrow(/exactly one tool call/i);
  });

  it('always sends Codex tool calls through the authenticated relay', async () => {
    const fetchImpl = async (url, init) => {
      expect(url).toBe('/api/openai-proxy');
      expect(init.headers).toEqual(expect.objectContaining({
        Authorization: 'Bearer user-token',
        'X-StoryForge-Upstream-Key': 'provider-key',
      }));
      const body = JSON.parse(init.body);
      expect(body).toEqual(expect.objectContaining({
        action: 'chat',
        baseUrl: 'https://proxy.example/v1',
        usage: expect.objectContaining({ taskType: 'codex_entity_resolution' }),
      }));
      expect(body.payload).toEqual(expect.objectContaining({
        stream: false,
        tool_choice: 'required',
        parallel_tool_calls: false,
      }));
      return new Response(JSON.stringify({
        choices: [{
          message: {
            tool_calls: [{
              id: 'call-1',
              type: 'function',
              function: { name: 'load_codex_analysis_context', arguments: '{}' },
            }],
          },
        }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };

    const result = await requestOpenAICompatibleToolTurn({
      profile: {
        baseUrl: 'https://proxy.example/v1',
        chatCompletionsPath: '/chat/completions',
      },
      apiKey: 'provider-key',
      accessToken: 'user-token',
      payload: buildOpenAICompatibleToolPayload({
        model: 'test-model',
        messages: [{ role: 'user', content: 'test' }],
        tools: [loadContextTool],
      }),
      allowedToolNames: ['load_codex_analysis_context'],
      fetchImpl,
    });

    expect(result.name).toBe('load_codex_analysis_context');
  });

  it('retries only transient relay failures within the configured cap', async () => {
    let attempts = 0;
    const waits = [];
    const fetchImpl = async () => {
      attempts += 1;
      if (attempts < 3) {
        return new Response('{}', {
          status: 503,
          headers: { 'Retry-After': '1' },
        });
      }
      return new Response(JSON.stringify({
        choices: [{
          message: {
            tool_calls: [{
              id: 'call-1',
              type: 'function',
              function: { name: 'load_codex_analysis_context', arguments: '{}' },
            }],
          },
        }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };

    await requestOpenAICompatibleToolTurn({
      profile: { baseUrl: 'https://proxy.example/v1' },
      apiKey: 'provider-key',
      accessToken: 'user-token',
      payload: buildOpenAICompatibleToolPayload({
        model: 'test-model',
        messages: [{ role: 'user', content: 'test' }],
        tools: [loadContextTool],
      }),
      allowedToolNames: ['load_codex_analysis_context'],
      fetchImpl,
      sleepImpl: async (ms) => waits.push(ms),
      randomImpl: () => 0,
    });

    expect(attempts).toBe(3);
    expect(waits).toEqual([1000, 1000]);
  });

  it('classifies a Gemini-compatible invalid-argument response without retaining upstream text', async () => {
    await expect(requestOpenAICompatibleToolTurn({
      profile: { baseUrl: 'https://proxy.example/v1' },
      apiKey: 'provider-key',
      accessToken: 'user-token',
      payload: buildOpenAICompatibleToolPayload({
        model: 'test-model',
        messages: [{ role: 'user', content: 'test' }],
        tools: [loadContextTool],
      }),
      allowedToolNames: ['load_codex_analysis_context'],
      fetchImpl: async () => new Response(JSON.stringify({
        detail: 'Request contains an invalid argument.',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }),
    })).rejects.toMatchObject({
      code: 'CODEX_TOOL_UPSTREAM_INVALID_ARGUMENT',
      status: 400,
      retryable: false,
    });
  });

  it('bounds upstream error inspection when a bad request has no content length', async () => {
    let readCount = 0;
    let textCalled = false;
    const chunk = new TextEncoder().encode('x'.repeat(8192));
    const reader = {
      async read() {
        readCount += 1;
        return readCount <= 4 ? { done: false, value: chunk } : { done: true, value: undefined };
      },
      async cancel() {},
    };

    await expect(requestOpenAICompatibleToolTurn({
      profile: { baseUrl: 'https://proxy.example/v1' },
      apiKey: 'provider-key',
      accessToken: 'user-token',
      payload: buildOpenAICompatibleToolPayload({
        model: 'test-model',
        messages: [{ role: 'user', content: 'test' }],
        tools: [loadContextTool],
      }),
      allowedToolNames: ['load_codex_analysis_context'],
      fetchImpl: async () => ({
        ok: false,
        status: 400,
        headers: { get: () => '' },
        body: { getReader: () => reader },
        text: async () => {
          textCalled = true;
          return 'x'.repeat(64 * 1024);
        },
      }),
    })).rejects.toMatchObject({ code: 'CODEX_TOOL_UPSTREAM_BAD_REQUEST' });

    expect(textCalled).toBe(false);
    expect(readCount).toBeLessThanOrEqual(3);
  });

  it('fails closed on a timed-out turn without retrying the timeout', async () => {
    let attempts = 0;
    const fetchImpl = async (_url, init) => {
      attempts += 1;
      return new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
      });
    };

    await expect(requestOpenAICompatibleToolTurn({
      profile: { baseUrl: 'https://proxy.example/v1' },
      apiKey: 'provider-key',
      accessToken: 'user-token',
      payload: buildOpenAICompatibleToolPayload({
        model: 'test-model',
        messages: [{ role: 'user', content: 'test' }],
        tools: [loadContextTool],
      }),
      allowedToolNames: ['load_codex_analysis_context'],
      fetchImpl,
      timeoutMs: 5,
    })).rejects.toMatchObject({ code: 'CODEX_TOOL_TURN_TIMEOUT', retryable: false });
    expect(attempts).toBe(1);
  });

  it('counts retry backoff inside the turn timeout budget', async () => {
    let attempts = 0;

    await expect(requestOpenAICompatibleToolTurn({
      profile: { baseUrl: 'https://proxy.example/v1' },
      apiKey: 'provider-key',
      accessToken: 'user-token',
      payload: buildOpenAICompatibleToolPayload({
        model: 'test-model',
        messages: [{ role: 'user', content: 'test' }],
        tools: [loadContextTool],
      }),
      allowedToolNames: ['load_codex_analysis_context'],
      fetchImpl: async () => {
        attempts += 1;
        return new Response('{}', { status: 503, headers: { 'Retry-After': '0.05' } });
      },
      sleepImpl: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      randomImpl: () => 0,
      timeoutMs: 10,
    })).rejects.toMatchObject({ code: 'CODEX_TOOL_TURN_TIMEOUT', retryable: false });

    expect(attempts).toBe(1);
  });
});
