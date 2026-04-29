import { describe, expect, it, vi } from 'vitest';
import {
  buildAIStudioRawGenerateRequest,
  callAIStudioRelayTransport,
  toRelayWebSocketUrl,
} from '../../services/ai/aiStudioRelayClient.js';

class MockWebSocket {
  static instances = [];
  static OPEN = 1;
  static CLOSED = 3;

  constructor(url) {
    this.url = url;
    this.readyState = MockWebSocket.OPEN;
    this.sent = [];
    this.listeners = new Map();
    MockWebSocket.instances.push(this);
    setTimeout(() => this.emit('open', {}), 0);
  }

  addEventListener(type, handler) {
    const handlers = this.listeners.get(type) || [];
    handlers.push(handler);
    this.listeners.set(type, handlers);
  }

  removeEventListener(type, handler) {
    const handlers = this.listeners.get(type) || [];
    this.listeners.set(type, handlers.filter((item) => item !== handler));
  }

  send(message) {
    this.sent.push(message);
  }

  close() {
    this.readyState = MockWebSocket.CLOSED;
    this.emit('close', {});
  }

  emit(type, event) {
    for (const handler of this.listeners.get(type) || []) {
      handler(event);
    }
  }

  serverMessage(payload) {
    this.emit('message', { data: JSON.stringify(payload) });
  }
}

function resetMockSockets() {
  MockWebSocket.instances = [];
}

async function waitForAssertion(assertion) {
  const startedAt = Date.now();
  let lastError = null;
  while (Date.now() - startedAt < 1000) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }
  throw lastError;
}

describe('AI Studio Relay client transport', () => {
  it('converts http relay URLs to websocket room URLs', () => {
    expect(toRelayWebSocketUrl('https://relay.example.com', 'ABC-123')).toBe(
      'wss://relay.example.com/rooms/ABC-123?role=client',
    );
    expect(toRelayWebSocketUrl('http://localhost:8787/', 'ABC-123')).toBe(
      'ws://localhost:8787/rooms/ABC-123?role=client',
    );
  });

  it('builds raw Gemini proxy requests for the connector', () => {
    const request = buildAIStudioRawGenerateRequest({
      requestId: 'req-raw',
      model: 'models/gemini-2.5-flash',
      messages: [
        { role: 'system', content: 'system rule' },
        { role: 'user', content: 'hello' },
      ],
      stream: true,
    });

    expect(request).toMatchObject({
      request_id: 'req-raw',
      method: 'POST',
      path: '/v1beta/models/gemini-2.5-flash:streamGenerateContent',
      query_params: { alt: 'sse' },
    });
    expect(request.body.systemInstruction.parts[0].text).toBe('system rule');
    expect(request.body.contents).toEqual([
      { role: 'user', parts: [{ text: 'hello' }] },
    ]);
  });

  it('parses raw proxy Gemini SSE chunks into text tokens', async () => {
    resetMockSockets();
    const onToken = vi.fn();
    const onComplete = vi.fn();

    const promise = callAIStudioRelayTransport({
      relayUrl: 'https://relay.example.com',
      roomCode: 'ABC-123',
      model: 'gemini-2.5-flash',
      messages: [{ role: 'user', content: 'hello' }],
      WebSocketImpl: MockWebSocket,
      onToken,
      onComplete,
      requestId: 'req-raw',
      timeoutMs: 1000,
    });

    await waitForAssertion(() => expect(MockWebSocket.instances[0]?.sent.length).toBe(1));
    expect(JSON.parse(MockWebSocket.instances[0].sent[0])).toMatchObject({
      request_id: 'req-raw',
      path: '/v1beta/models/gemini-2.5-flash:streamGenerateContent',
    });

    MockWebSocket.instances[0].serverMessage({
      request_id: 'req-raw',
      event_type: 'response_headers',
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    });
    MockWebSocket.instances[0].serverMessage({
      request_id: 'req-raw',
      event_type: 'chunk',
      data: 'data: {"candidates":[{"content":{"parts":[{"text":"Xin "}]}}]}\n\n',
    });
    MockWebSocket.instances[0].serverMessage({
      request_id: 'req-raw',
      event_type: 'chunk',
      data: 'data: {"candidates":[{"content":{"parts":[{"text":"chao"}]}}]}\n\n',
    });
    MockWebSocket.instances[0].serverMessage({
      request_id: 'req-raw',
      event_type: 'stream_close',
    });

    await expect(promise).resolves.toBe('Xin chao');
    expect(onToken).toHaveBeenNthCalledWith(1, 'Xin ', 'Xin ');
    expect(onToken).toHaveBeenNthCalledWith(2, 'chao', 'Xin chao');
    expect(onComplete).toHaveBeenCalledWith('Xin chao');
  });

  it('rejects raw proxy streams that complete without text', async () => {
    resetMockSockets();
    const onError = vi.fn();

    const promise = callAIStudioRelayTransport({
      relayUrl: 'https://relay.example.com',
      roomCode: 'ABC-123',
      model: 'gemini-2.5-flash',
      messages: [{ role: 'user', content: 'hello' }],
      WebSocketImpl: MockWebSocket,
      onError,
      requestId: 'req-empty',
      timeoutMs: 1000,
    });

    await waitForAssertion(() => expect(MockWebSocket.instances[0]?.sent.length).toBe(1));
    MockWebSocket.instances[0].serverMessage({
      request_id: 'req-empty',
      event_type: 'response_headers',
      status: 200,
    });
    MockWebSocket.instances[0].serverMessage({
      request_id: 'req-empty',
      event_type: 'chunk',
      data: 'data: {"candidates":[{"finishReason":"SAFETY"}]}\n\n',
    });
    MockWebSocket.instances[0].serverMessage({
      request_id: 'req-empty',
      event_type: 'stream_close',
    });

    await expect(promise).rejects.toMatchObject({ code: 'AI_STUDIO_RELAY_EMPTY_STREAM' });
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: 'AI_STUDIO_RELAY_EMPTY_STREAM' }));
  });

  it('streams chunk messages into onToken and resolves on done', async () => {
    resetMockSockets();
    const onToken = vi.fn();
    const onComplete = vi.fn();

    const promise = callAIStudioRelayTransport({
      relayUrl: 'https://relay.example.com',
      roomCode: 'ABC-123',
      model: 'gemini-2.5-flash',
      messages: [{ role: 'user', content: 'hello' }],
      WebSocketImpl: MockWebSocket,
      onToken,
      onComplete,
      requestId: 'req-1',
      timeoutMs: 1000,
    });

    await waitForAssertion(() => expect(MockWebSocket.instances[0]?.sent.length).toBe(1));
    MockWebSocket.instances[0].serverMessage({ type: 'chunk', requestId: 'req-1', text: 'Xin ' });
    MockWebSocket.instances[0].serverMessage({ type: 'chunk', requestId: 'req-1', text: 'chao' });
    MockWebSocket.instances[0].serverMessage({ type: 'done', requestId: 'req-1' });

    await expect(promise).resolves.toBe('Xin chao');
    expect(onToken).toHaveBeenNthCalledWith(1, 'Xin ', 'Xin ');
    expect(onToken).toHaveBeenNthCalledWith(2, 'chao', 'Xin chao');
    expect(onComplete).toHaveBeenCalledWith('Xin chao');
  });

  it('keeps the default request timeout longer than the mobile polling grace window', async () => {
    vi.useFakeTimers();
    resetMockSockets();
    const onError = vi.fn();

    try {
      const promise = callAIStudioRelayTransport({
        relayUrl: 'https://relay.example.com',
        roomCode: 'ABC-123',
        model: 'gemini-2.5-flash',
        messages: [{ role: 'user', content: 'hello' }],
        WebSocketImpl: MockWebSocket,
        onError,
        requestId: 'req-mobile-grace',
      });

      promise.catch(() => {});
      await vi.advanceTimersByTimeAsync(0);
      expect(MockWebSocket.instances[0]?.sent.length).toBe(1);

      await vi.advanceTimersByTimeAsync(6 * 60 * 1000);
      expect(onError).not.toHaveBeenCalled();

      MockWebSocket.instances[0].serverMessage({ type: 'done', requestId: 'req-mobile-grace', text: 'ok' });
      await expect(promise).resolves.toBe('ok');
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects and calls onError when connector returns an error', async () => {
    resetMockSockets();
    const onError = vi.fn();

    const promise = callAIStudioRelayTransport({
      relayUrl: 'https://relay.example.com',
      roomCode: 'ABC-123',
      model: 'gemini-2.5-flash',
      messages: [{ role: 'user', content: 'hello' }],
      WebSocketImpl: MockWebSocket,
      onError,
      requestId: 'req-2',
      timeoutMs: 1000,
    });

    await waitForAssertion(() => expect(MockWebSocket.instances[0]?.sent.length).toBe(1));
    MockWebSocket.instances[0].serverMessage({
      type: 'error',
      requestId: 'req-2',
      code: 'QUOTA',
      message: 'quota hit',
    });

    await expect(promise).rejects.toMatchObject({ code: 'QUOTA', message: 'quota hit' });
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: 'QUOTA' }));
  });

  it('sends cancel when the active request is aborted', async () => {
    resetMockSockets();
    const controller = new AbortController();

    const promise = callAIStudioRelayTransport({
      relayUrl: 'https://relay.example.com',
      roomCode: 'ABC-123',
      model: 'gemini-2.5-flash',
      messages: [{ role: 'user', content: 'hello' }],
      WebSocketImpl: MockWebSocket,
      signal: controller.signal,
      requestId: 'req-3',
      timeoutMs: 1000,
    });

    await waitForAssertion(() => expect(MockWebSocket.instances[0]?.sent.length).toBe(1));
    controller.abort();

    await expect(promise).resolves.toBe('');
    const sentTypes = MockWebSocket.instances[0].sent.map((item) => JSON.parse(item).type);
    expect(sentTypes).toContain('cancel');
  });
});
