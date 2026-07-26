import { beforeEach, describe, expect, it, vi } from 'vitest';

async function loadColdAIClient() {
  vi.resetModules();
  const clientModule = await import('../../services/ai/client.js');
  const routerModule = await import('../../services/ai/router.js');
  return {
    aiService: clientModule.default,
    modelRouter: routerModule.default,
    routerModule,
  };
}

describe('phase10 AI client bootstrap', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it('routes a request after importing the client without loading an AI store', async () => {
    const { aiService, routerModule } = await loadColdAIClient();
    const fetchMock = vi.fn((_url, request = {}) => new Promise((_resolve, reject) => {
      request.signal?.addEventListener('abort', () => {
        reject(new DOMException('Aborted', 'AbortError'));
      }, { once: true });
    }));
    vi.stubGlobal('fetch', fetchMock);

    const request = aiService.send({
      taskType: routerModule.TASK_TYPES.PROJECT_WIZARD,
      messages: [{ role: 'user', content: 'Tao truyen moi.' }],
      stream: false,
      routeOptions: {
        providerOverride: routerModule.PROVIDERS.OLLAMA,
        modelOverride: 'llama3',
      },
    });

    expect(request.routeInfo).toEqual(expect.objectContaining({
      provider: routerModule.PROVIDERS.OLLAMA,
      model: 'llama3',
    }));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    request.abort();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  it('reports a configuration error instead of throwing when the router is unavailable', async () => {
    const { aiService, modelRouter, routerModule } = await loadColdAIClient();
    const onError = vi.fn();
    aiService.setRouter(null);

    const request = aiService.send({
      taskType: routerModule.TASK_TYPES.FREE_PROMPT,
      messages: [{ role: 'user', content: 'Xin chao.' }],
      onError,
    });

    expect(request).toEqual({
      abort: expect.any(Function),
      routeInfo: null,
    });
    expect(onError).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({
      code: 'AI_ROUTER_NOT_INITIALIZED',
    }));
    expect(aiService.isActive()).toBe(false);

    aiService.setRouter(modelRouter);
  });
});
