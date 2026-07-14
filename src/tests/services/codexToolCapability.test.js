import { beforeEach, describe, expect, it, vi } from 'vitest';

const { requestTurn } = vi.hoisted(() => ({ requestTurn: vi.fn() }));

vi.mock('../../services/access/accessClient.js', () => ({
  getStoryForgeAccessToken: vi.fn(async () => 'access-token'),
}));

vi.mock('../../services/ai/openAICompatibleToolClient.js', () => ({
  buildOpenAICompatibleToolPayload: vi.fn((value) => value),
  requestOpenAICompatibleToolTurn: requestTurn,
}));

import {
  getCodexToolCapability,
  probeCodexToolCapability,
} from '../../services/codex/codexToolCapability.js';

describe('Codex tool capability registry', () => {
  beforeEach(() => {
    localStorage.clear();
    requestTurn.mockReset()
      .mockResolvedValueOnce({
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [{
            id: 'probe-load-1',
            type: 'function',
            function: { name: 'load_codex_analysis_context', arguments: '{}' },
          }],
        },
        toolCallId: 'probe-load-1',
        name: 'load_codex_analysis_context',
        arguments: {},
      })
      .mockResolvedValueOnce({
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [{
            id: 'probe-plan-1',
            type: 'function',
            function: {
              name: 'submit_entity_resolution_plan',
              arguments: JSON.stringify({
                source_hash: 'capability-source',
                catalog_revision: 'capability-catalog',
                decisions: [],
              }),
            },
          }],
        },
        toolCallId: 'probe-plan-1',
        name: 'submit_entity_resolution_plan',
        arguments: {
          source_hash: 'capability-source',
          catalog_revision: 'capability-catalog',
          decisions: [],
        },
      });
  });

  it('invalidates a cached result when the custom proxy endpoint changes', async () => {
    const firstProfile = {
      id: 'custom-openai-proxy',
      baseUrl: 'https://first.example/v1',
      chatCompletionsPath: '/chat/completions',
    };
    const changedProfile = {
      ...firstProfile,
      baseUrl: 'https://second.example/v1',
    };

    await probeCodexToolCapability({
      profile: firstProfile,
      model: 'tool-model',
      apiKey: 'provider-key',
    });

    expect(getCodexToolCapability(firstProfile, 'tool-model')).toMatchObject({ supported: true });
    expect(getCodexToolCapability(changedProfile, 'tool-model')).toBeNull();
    expect(requestTurn).toHaveBeenCalledTimes(2);
    expect(requestTurn.mock.calls[1][0].payload.messages.at(-1)).toEqual(expect.objectContaining({
      role: 'tool',
      tool_call_id: 'probe-load-1',
      name: 'load_codex_analysis_context',
    }));
  });
});
