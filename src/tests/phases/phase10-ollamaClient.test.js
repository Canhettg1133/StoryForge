import { beforeEach, describe, expect, it, vi } from 'vitest';

async function loadClientStack() {
  vi.resetModules();
  const [clientModule, routerModule] = await Promise.all([
    import('../../services/ai/client.js'),
    import('../../services/ai/router.js'),
  ]);

  clientModule.default.setRouter(routerModule.default);

  return {
    aiService: clientModule.default,
    routerModule,
    modelRouter: routerModule.default,
    saveSettings: clientModule.saveSettings,
  };
}

function sendOnce(aiService, routerModule) {
  return new Promise((resolve, reject) => {
    aiService.send({
      taskType: routerModule.TASK_TYPES.FREE_PROMPT,
      messages: [{ role: 'user', content: 'Viet tiep canh nay.' }],
      stream: false,
      onComplete: resolve,
      onError: reject,
    });
  });
}

describe('Ollama client integration', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it('normalizes the saved Ollama URL before testing connection', async () => {
    const { aiService, saveSettings, routerModule } = await loadClientStack();
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      models: [{ name: 'qwen3:4b' }],
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    saveSettings({ ollamaUrl: 'http://localhost:11434/' });

    const result = await aiService.testConnection(routerModule.PROVIDERS.OLLAMA);

    expect(result).toEqual({ success: true, models: ['qwen3:4b'] });
    expect(fetchMock.mock.calls[0][0]).toBe('http://localhost:11434/api/tags');
  });

  it('uses translator-style Ollama presets and extracts thinking responses', async () => {
    const { aiService, modelRouter, routerModule, saveSettings } = await loadClientStack();
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      message: {
        content: '',
        thinking: 'Ban viet hoan chinh tu thinking.',
      },
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    saveSettings({ ollamaUrl: 'http://localhost:11434/' });
    modelRouter.setPreferredProvider(routerModule.PROVIDERS.OLLAMA);
    modelRouter.setOllamaModel('qwen3:4b');

    const text = await sendOnce(aiService, routerModule);

    const [, request] = fetchMock.mock.calls[0];
    const payload = JSON.parse(request.body);
    expect(fetchMock.mock.calls[0][0]).toBe('http://localhost:11434/api/chat');
    expect(payload).toMatchObject({
      model: 'qwen3:4b',
      stream: false,
      think: true,
      options: expect.objectContaining({
        num_ctx: 8192,
        num_predict: 4096,
      }),
    });
    expect(text).toBe('Ban viet hoan chinh tu thinking.');
  });
});
