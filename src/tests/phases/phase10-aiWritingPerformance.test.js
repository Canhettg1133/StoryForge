import { beforeEach, describe, expect, it, vi } from 'vitest';

let capturedSendOptions = null;

vi.mock('../../services/ai/client', () => ({
  default: {
    setRouter: vi.fn(),
    send: vi.fn((options) => {
      capturedSendOptions = options;
      return {
        abort: vi.fn(),
        routeInfo: { provider: 'test', model: 'test-model' },
      };
    }),
    abort: vi.fn(),
  },
}));

vi.mock('../../services/ai/promptBuilder', () => ({
  buildPrompt: vi.fn(() => [{ role: 'user', content: 'write' }]),
}));

vi.mock('../../services/ai/contextEngine', () => ({
  gatherContext: vi.fn(async () => ({})),
}));

vi.mock('../../services/db/database', () => ({
  default: {
    chapterMeta: {
      where: vi.fn(() => ({
        equals: vi.fn(() => ({
          first: vi.fn(async () => null),
        })),
      })),
      add: vi.fn(async () => 1),
      update: vi.fn(async () => 1),
    },
  },
}));

async function loadAIStore() {
  vi.resetModules();
  capturedSendOptions = null;
  const module = await import('../../stores/aiStore.js');
  return module.default;
}

describe('phase10 AI writing performance', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
  });

  it('throttles streaming state updates without losing the final writing text', async () => {
    const useAIStore = await loadAIStore();
    const streamingValues = [];
    let lastStreamingText = useAIStore.getState().streamingText;
    const unsubscribe = useAIStore.subscribe((state) => {
      if (state.streamingText !== lastStreamingText) {
        lastStreamingText = state.streamingText;
        streamingValues.push(state.streamingText);
      }
    });

    await useAIStore.getState().runTask({
      taskType: 'continue',
      context: { projectId: null, chapterId: 10, sceneId: 20 },
    });

    expect(capturedSendOptions).toBeTruthy();

    const finalText = Array.from({ length: 120 }, (_, index) => `dòng ${index}`).join('\n');
    for (let i = 1; i <= 120; i += 1) {
      capturedSendOptions.onToken('x', finalText.slice(0, i * 4));
    }

    expect(streamingValues.length).toBeLessThan(30);

    await vi.advanceTimersByTimeAsync(250);
    capturedSendOptions.onComplete(finalText, { provider: 'test', model: 'test-model', elapsed: 1234 });
    await vi.runOnlyPendingTimersAsync();

    expect(useAIStore.getState().completedText).toBe(finalText);
    expect(useAIStore.getState().streamingText).toBe('');
    expect(useAIStore.getState().isStreaming).toBe(false);

    unsubscribe();
  });
});
