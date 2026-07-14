import { describe, expect, it, vi } from 'vitest';
import { createCodexToolRuntime } from '../../services/codex/codexToolRuntime.js';
import { runEntityResolutionAgent } from '../../services/codex/entityResolutionAgent.js';

function toolTurn(id, name, args) {
  return {
    message: {
      role: 'assistant',
      content: null,
      tool_calls: [{
        id,
        type: 'function',
        function: { name, arguments: JSON.stringify(args) },
      }],
    },
    toolCallId: id,
    name,
    arguments: args,
  };
}

function runtime() {
  return createCodexToolRuntime({
    projectId: 1,
    chapterId: 11,
    sourceHash: 'source-v1',
    catalogRevision: 'catalog-v1',
    paragraphs: [{ id: 'scene-1:p-1', text: 'Lan buoc vao phong.' }],
    entities: [{
      id: 1,
      project_id: 1,
      entity_kind: 'character',
      name: 'Lan',
      aliases: [],
      role: 'supporting',
    }],
  });
}

describe('entity resolution agent', () => {
  it('forces load first, stages a resolver plan, then runs an independent critic', async () => {
    const requestTurn = vi.fn()
      .mockResolvedValueOnce(toolTurn('load-1', 'load_codex_analysis_context', {}))
      .mockResolvedValueOnce(toolTurn('plan-1', 'submit_entity_resolution_plan', {
        source_hash: 'source-v1',
        catalog_revision: 'catalog-v1',
        decisions: [{
          candidate_key: 'character:lan',
          entity_kind: 'character',
          extracted_name: 'Lan',
          decision: 'match_existing',
          target_entity_ids: [1],
          canonical_name: null,
          aliases: [],
          role_hint: null,
          proposed_changes: [],
          evidence: [{ paragraph_id: 'scene-1:p-1', quote: 'Lan buoc vao phong.' }],
          reasoning: 'Exact grounded mention.',
          risk_flags: [],
        }],
      }))
      .mockResolvedValueOnce(toolTurn('critic-1', 'submit_entity_resolution_critique', {
        source_hash: 'source-v1',
        catalog_revision: 'catalog-v1',
        critiques: [{
          candidate_key: 'character:lan',
          decision: 'agree',
          reasoning: 'The exact target and quote agree.',
          risk_flags: [],
        }],
      }));

    const result = await runEntityResolutionAgent({
      runtime: runtime(),
      model: 'tool-model',
      requestTurn,
    });

    expect(requestTurn).toHaveBeenCalledTimes(3);
    expect(requestTurn.mock.calls[0][0].tools.map((item) => item.function.name)).toEqual([
      'load_codex_analysis_context',
    ]);
    expect(requestTurn.mock.calls[1][0].payload.messages.find((message) => (
      message.tool_call_id === 'load-1'
    ))).toEqual(expect.objectContaining({
      role: 'tool',
      tool_call_id: 'load-1',
      name: 'load_codex_analysis_context',
    }));
    expect(requestTurn.mock.calls[2][0].tools.map((item) => item.function.name)).toEqual([
      'search_story_bible_entities',
      'get_story_bible_entity_context',
      'submit_entity_resolution_critique',
    ]);
    expect(result.turns).toEqual({ resolver: 2, critic: 1, total: 3 });
    expect(result.plan.decisions[0]).toEqual(expect.objectContaining({
      quick_approve: true,
      review_safety: 'quick_approve',
      critic: expect.objectContaining({ decision: 'agree' }),
    }));
  });

  it('lets the critic inspect one alternative before the final required critique turn', async () => {
    const requestTurn = vi.fn()
      .mockResolvedValueOnce(toolTurn('load-1', 'load_codex_analysis_context', {}))
      .mockResolvedValueOnce(toolTurn('plan-1', 'submit_entity_resolution_plan', {
        source_hash: 'source-v1',
        catalog_revision: 'catalog-v1',
        decisions: [{
          candidate_key: 'character:lan',
          entity_kind: 'character',
          extracted_name: 'Lan',
          decision: 'match_existing',
          target_entity_ids: [1],
          canonical_name: null,
          aliases: [],
          role_hint: null,
          proposed_changes: [],
          evidence: [{ paragraph_id: 'scene-1:p-1', quote: 'Lan buoc vao phong.' }],
          reasoning: 'Exact grounded mention.',
          risk_flags: [],
        }],
      }))
      .mockResolvedValueOnce(toolTurn('critic-search-1', 'search_story_bible_entities', {
        query: 'Lan',
        entity_kind: 'character',
        owner_or_holder: null,
        limit: 10,
      }))
      .mockResolvedValueOnce(toolTurn('critic-submit-1', 'submit_entity_resolution_critique', {
        source_hash: 'source-v1',
        catalog_revision: 'catalog-v1',
        critiques: [{
          candidate_key: 'character:lan',
          decision: 'agree',
          reasoning: 'No conflicting alternative was found in the available catalog.',
          risk_flags: [],
        }],
      }));

    const result = await runEntityResolutionAgent({
      runtime: runtime(),
      model: 'tool-model',
      requestTurn,
    });

    expect(requestTurn).toHaveBeenCalledTimes(4);
    expect(requestTurn.mock.calls[3][0].tools.map((item) => item.function.name)).toEqual([
      'submit_entity_resolution_critique',
    ]);
    expect(result.turns).toEqual({ resolver: 2, critic: 2, total: 4 });
  });

  it('fails closed when the resolver never submits a plan within five turns', async () => {
    const requestTurn = vi.fn()
      .mockResolvedValueOnce(toolTurn('load-1', 'load_codex_analysis_context', {}))
      .mockResolvedValue(toolTurn('search-1', 'search_story_bible_entities', {
        query: 'Lan',
        entity_kind: 'character',
        owner_or_holder: null,
        limit: 10,
      }));

    await expect(runEntityResolutionAgent({
      runtime: runtime(),
      model: 'tool-model',
      requestTurn,
    })).rejects.toMatchObject({ code: 'CODEX_RESOLVER_TURN_LIMIT' });
    expect(requestTurn).toHaveBeenCalledTimes(5);
  });

  it('completes a no-entity chapter without inventing a candidate or calling the critic', async () => {
    const requestTurn = vi.fn()
      .mockResolvedValueOnce(toolTurn('load-1', 'load_codex_analysis_context', {}))
      .mockResolvedValueOnce(toolTurn('plan-1', 'submit_entity_resolution_plan', {
        source_hash: 'source-v1',
        catalog_revision: 'catalog-v1',
        decisions: [],
      }));

    const result = await runEntityResolutionAgent({
      runtime: runtime(),
      model: 'tool-model',
      requestTurn,
    });

    expect(requestTurn).toHaveBeenCalledTimes(2);
    expect(result.plan.decisions).toEqual([]);
    expect(result.turns).toEqual({ resolver: 2, critic: 0, total: 2 });
  });

  it('fails closed for providers outside Custom OpenAI and Gemini Proxy AG', async () => {
    await expect(runEntityResolutionAgent({
      runtime: runtime(),
      provider: 'gemini_direct',
      model: 'tool-model',
    })).rejects.toMatchObject({ code: 'CODEX_PROVIDER_UNSUPPORTED' });
  });
});
