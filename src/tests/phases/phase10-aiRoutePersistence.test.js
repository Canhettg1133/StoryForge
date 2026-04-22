import { beforeEach, describe, expect, it, vi } from 'vitest';

async function loadAIStore() {
  vi.resetModules();
  const module = await import('../../stores/aiStore.js');
  return module.default;
}

describe('phase10 AI route persistence', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('keeps tracked writing output context until the user explicitly clears it', async () => {
    const useAIStore = await loadAIStore();
    const scope = {
      projectId: 7,
      chapterId: 11,
      sceneId: 13,
      taskId: 'continue',
      scopeLevel: 'scene',
      createdAt: 123,
    };

    expect(typeof useAIStore.getState().setOutputTracking).toBe('function');

    useAIStore.getState().setOutputTracking({
      taskId: 'continue',
      outputScope: scope,
    });
    useAIStore.setState({
      isStreaming: true,
      streamingText: 'Dang viet...',
      completedText: '',
      error: null,
    });

    expect(useAIStore.getState().lastTaskId).toBe('continue');
    expect(useAIStore.getState().outputScope).toEqual(scope);
    expect(useAIStore.getState().streamingText).toBe('Dang viet...');

    useAIStore.getState().clearOutput();

    expect(useAIStore.getState().lastTaskId).toBe(null);
    expect(useAIStore.getState().outputScope).toBe(null);
  });
});
