import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('isolated review AI client', () => {
  let singleton;
  let isolated;
  beforeEach(() => { localStorage.clear(); vi.resetModules(); });
  afterEach(() => { singleton?.abort(); isolated?.abort(); vi.unstubAllGlobals(); });

  it.each(['review', 'writing'])('cancelling %s does not cancel the other client', async (cancelTarget) => {
    const requests = [];
    vi.stubGlobal('fetch', vi.fn((_url, init) => new Promise((resolve, reject) => {
      requests.push({ signal: init.signal, resolve });
      init.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    })));
    const clientModule = await import('../../services/ai/client.js');
    singleton = clientModule.default;
    expect(clientModule.createAIService).toBeTypeOf('function');
    isolated = clientModule.createAIService({ router: {
      route: () => ({ provider: 'ollama', model: 'small-test' }), getFallbacks: () => [],
    } });
    const writingComplete = vi.fn();
    const reviewComplete = vi.fn();
    const writingError = vi.fn();
    const reviewError = vi.fn();
    const writing = singleton.send({ taskType: 'chapter_summary', stream: false,
      routeOptions: { providerOverride: 'ollama', modelOverride: 'small-test' },
      messages: [{ role: 'user', content: 'writing' }], onComplete: writingComplete, onError: writingError });
    const review = isolated.send({ taskType: 'prose_ai_signals', stream: false,
      messages: [{ role: 'user', content: 'review' }], onComplete: reviewComplete, onError: reviewError });
    expect(requests).toHaveLength(2);
    const cancelledIndex = cancelTarget === 'review' ? 1 : 0;
    (cancelTarget === 'review' ? review : writing).abort();
    expect(requests[cancelledIndex].signal.aborted).toBe(true);
    expect(requests[1 - cancelledIndex].signal.aborted).toBe(false);
    requests[1 - cancelledIndex].resolve(new Response(JSON.stringify({ message: { content: 'ok' }, done: true })));
    await vi.waitFor(() => expect(cancelTarget === 'review' ? writingComplete : reviewComplete).toHaveBeenCalledOnce());
    expect(cancelTarget === 'review' ? reviewError : writingError).toHaveBeenCalledOnce();
  });
});
