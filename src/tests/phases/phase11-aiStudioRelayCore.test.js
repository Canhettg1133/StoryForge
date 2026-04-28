import { describe, expect, it, vi } from 'vitest';
import {
  RelayRoomCore,
  createRoomCode,
  sanitizeRelayLogEvent,
} from '../../../relay-worker/src/room-core.js';
import relayWorker from '../../../relay-worker/src/index.js';
import { isTrustedAIStudioOrigin } from '../../../relay-worker/src/index.js';

class FakeSocket {
  constructor() {
    this.sent = [];
    this.closed = false;
    this.listeners = new Map();
  }

  addEventListener(type, handler) {
    const handlers = this.listeners.get(type) || [];
    handlers.push(handler);
    this.listeners.set(type, handlers);
  }

  send(message) {
    this.sent.push(message);
  }

  close(code = 1000, reason = '') {
    this.closed = true;
    this.closeCode = code;
    this.closeReason = reason;
  }

  emitMessage(payload) {
    for (const handler of this.listeners.get('message') || []) {
      handler({ data: JSON.stringify(payload) });
    }
  }

  emitClose() {
    for (const handler of this.listeners.get('close') || []) {
      handler({});
    }
  }
}

describe('AI Studio Relay room core', () => {
  it('trusts the current AI Studio app origin for connector CORS', () => {
    expect(isTrustedAIStudioOrigin('https://ai.studio')).toBe(true);
    expect(isTrustedAIStudioOrigin('https://aistudio.google.com')).toBe(true);
    expect(isTrustedAIStudioOrigin('https://preview.googleusercontent.com')).toBe(true);
    expect(isTrustedAIStudioOrigin('http://ai.studio')).toBe(false);
  });

  it('allows sandboxed AI Studio connector fetches with opaque null origin', async () => {
    const env = {
      ALLOWED_ORIGINS: 'https://story-forge-virid.vercel.app,https://ai.studio',
    };
    const request = new Request('https://relay.example.test/health', {
      headers: { Origin: 'null' },
    });

    const response = await relayWorker.fetch(request, env);

    expect(response.status).toBe(200);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('null');
  });

  it('creates readable room codes without ambiguous state', () => {
    expect(createRoomCode(() => 0)).toBe('AAA-AAA');
    expect(createRoomCode(() => 0.999999)).toMatch(/^[A-Z0-9]{3}-[A-Z0-9]{3}$/);
  });

  it('rejects duplicate roles in the same room', () => {
    const room = new RelayRoomCore({ roomCode: 'ABC-123', logger: vi.fn() });
    const first = new FakeSocket();
    const duplicate = new FakeSocket();

    expect(room.connect('client', first)).toEqual({ ok: true });
    expect(room.connect('client', duplicate)).toEqual({
      ok: false,
      status: 409,
      error: 'ROLE_ALREADY_CONNECTED',
    });
  });

  it('forwards messages between client and connector without exposing body in logs', () => {
    const logger = vi.fn();
    const room = new RelayRoomCore({ roomCode: 'ABC-123', logger });
    const client = new FakeSocket();
    const connector = new FakeSocket();

    room.connect('client', client);
    room.connect('connector', connector);
    client.emitMessage({
      type: 'generate',
      requestId: 'req-1',
      model: 'gemini-2.5-flash',
      messages: [{ role: 'user', content: 'secret prompt' }],
      stream: true,
    });

    const forwarded = connector.sent
      .map((item) => JSON.parse(item))
      .find((item) => item.type === 'generate');
    expect(forwarded.messages[0].content).toBe('secret prompt');

    const loggedPayload = JSON.stringify(logger.mock.calls);
    expect(loggedPayload).not.toContain('secret prompt');
    expect(loggedPayload).toContain('generate');
  });

  it('reports connected state for room status', () => {
    const room = new RelayRoomCore({ roomCode: 'ABC-123', logger: vi.fn(), now: () => 10 });
    room.connect('client', new FakeSocket());

    expect(room.getStatus()).toMatchObject({
      code: 'ABC-123',
      clientConnected: true,
      connectorConnected: false,
    });
  });

  it('queues WebSocket client messages for a polling connector fallback', () => {
    const room = new RelayRoomCore({ roomCode: 'ABC-123', logger: vi.fn(), now: () => 10 });
    const client = new FakeSocket();
    room.connect('client', client);
    room.poll('connector');

    client.emitMessage({
      type: 'generate',
      requestId: 'req-poll',
      model: 'gemini-2.5-flash',
      messages: [{ role: 'user', content: 'queued prompt' }],
      stream: true,
    });

    const polled = room.poll('connector');
    expect(polled.messages).toEqual([
      expect.objectContaining({
        type: 'generate',
        requestId: 'req-poll',
        messages: [{ role: 'user', content: 'queued prompt' }],
      }),
    ]);
  });

  it('keeps a polling connector available through a short mobile background pause', () => {
    let now = 10;
    const room = new RelayRoomCore({ roomCode: 'ABC-123', logger: vi.fn(), now: () => now });
    const client = new FakeSocket();
    room.connect('client', client);
    room.poll('connector');

    now += 4 * 60 * 1000;
    client.emitMessage({
      type: 'generate',
      requestId: 'req-mobile-bg',
      model: 'gemini-2.5-flash',
      messages: [{ role: 'user', content: 'mobile queued prompt' }],
      stream: true,
    });

    const polled = room.poll('connector');
    expect(polled.messages).toEqual([
      expect.objectContaining({
        type: 'generate',
        requestId: 'req-mobile-bg',
        messages: [{ role: 'user', content: 'mobile queued prompt' }],
      }),
    ]);
  });

  it('forwards polling connector messages back to the WebSocket client', () => {
    const room = new RelayRoomCore({ roomCode: 'ABC-123', logger: vi.fn(), now: () => 10 });
    const client = new FakeSocket();
    room.connect('client', client);
    room.poll('connector');

    const result = room.sendFromHttp('connector', JSON.stringify({
      type: 'chunk',
      requestId: 'req-poll',
      text: 'hello',
    }));

    expect(result).toMatchObject({ ok: true, forwarded: 'websocket' });
    expect(client.sent.map((item) => JSON.parse(item))).toContainEqual({
      type: 'chunk',
      requestId: 'req-poll',
      text: 'hello',
    });
  });

  it('sanitizes relay log events to metadata only', () => {
    const event = sanitizeRelayLogEvent({
      roomCode: 'ABC-123',
      role: 'client',
      eventType: 'generate',
      byteLength: 123,
      messages: [{ content: 'do not log' }],
      text: 'do not log',
    });

    expect(event).toEqual({
      roomCodeHash: expect.any(String),
      role: 'client',
      eventType: 'generate',
      byteLength: 123,
      status: undefined,
      errorCode: undefined,
    });
    expect(JSON.stringify(event)).not.toContain('do not log');
  });
});
