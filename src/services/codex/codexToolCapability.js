import { getStoryForgeAccessToken } from '../access/accessClient.js';
import {
  buildOpenAICompatibleToolPayload,
  requestOpenAICompatibleToolTurn,
} from '../ai/openAICompatibleToolClient.js';
import {
  CODEX_TOOL_NAMES,
  getCodexResolverTools,
} from './codexToolRuntime.js';

const STORAGE_KEY = 'sf-codex-tool-capabilities-v4';
const PROBE_TOOL_NAME = CODEX_TOOL_NAMES.SUBMIT_PLAN;

function readRegistry() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
  } catch {
    return {};
  }
}

function capabilityKey(profile, model) {
  return JSON.stringify([
    String(profile?.id || '').trim(),
    String(profile?.baseUrl || '').trim().replace(/\/+$/u, ''),
    String(profile?.chatCompletionsPath || '/v1/chat/completions').trim(),
    String(model || '').trim(),
  ]);
}

export function getCodexToolCapability(profile, model) {
  return readRegistry()[capabilityKey(profile, model)] || null;
}

function saveCapability(profile, model, result) {
  const registry = readRegistry();
  registry[capabilityKey(profile, model)] = result;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(registry));
  return result;
}

export async function probeCodexToolCapability({
  profile,
  model,
  apiKey,
  accessToken,
}) {
  const checkedAt = Date.now();
  try {
    const token = accessToken || await getStoryForgeAccessToken();
    const firstTools = getCodexResolverTools({ firstTurn: true });
    const messages = [
      { role: 'system', content: 'This is a two-turn capability check. Do not request or infer any user data.' },
      {
        role: 'user',
        content: 'First call load_codex_analysis_context. After its synthetic result, call submit_entity_resolution_plan with source_hash="capability-source", catalog_revision="capability-catalog", and an empty decisions array.',
      },
    ];
    const firstPayload = buildOpenAICompatibleToolPayload({
      model,
      messages,
      tools: firstTools,
      temperature: 0,
      max_tokens: 128,
    });
    const firstResponse = await requestOpenAICompatibleToolTurn({
      profile,
      apiKey,
      accessToken: token,
      payload: firstPayload,
      allowedToolNames: [CODEX_TOOL_NAMES.LOAD_CONTEXT],
      usage: {
        taskType: 'codex_tool_capability',
        taskGroup: 'codex',
        surface: 'settings',
      },
    });
    if (firstResponse.name !== CODEX_TOOL_NAMES.LOAD_CONTEXT) {
      throw new Error('Model did not call the required first Codex tool.');
    }

    messages.push(firstResponse.message, {
      role: 'tool',
      tool_call_id: firstResponse.toolCallId,
      name: firstResponse.name,
      content: JSON.stringify({
        ok: true,
        data: {
          capability_probe: true,
          chapter: { items: [], next_cursor: null },
          catalog: { items: [], next_cursor: null },
          source_hash: 'capability-source',
          catalog_revision: 'capability-catalog',
        },
      }),
    });
    const secondTools = getCodexResolverTools({ firstTurn: false });
    const secondPayload = buildOpenAICompatibleToolPayload({
      model,
      messages,
      tools: secondTools,
      temperature: 0,
      max_tokens: 256,
    });
    const secondResponse = await requestOpenAICompatibleToolTurn({
      profile,
      apiKey,
      accessToken: token,
      payload: secondPayload,
      allowedToolNames: secondTools.map((item) => item.function.name),
      usage: {
        taskType: 'codex_tool_capability',
        taskGroup: 'codex',
        surface: 'settings',
      },
    });
    if (
      secondResponse.name !== PROBE_TOOL_NAME
      || secondResponse.arguments?.source_hash !== 'capability-source'
      || secondResponse.arguments?.catalog_revision !== 'capability-catalog'
      || !Array.isArray(secondResponse.arguments?.decisions)
      || secondResponse.arguments.decisions.length !== 0
    ) {
      throw new Error('Model did not complete the second Codex tool turn safely.');
    }
    return saveCapability(profile, model, { supported: true, checked_at: checkedAt, error_code: '' });
  } catch (error) {
    const result = {
      supported: false,
      checked_at: checkedAt,
      error_code: String(error?.code || 'CODEX_TOOLS_UNSUPPORTED').slice(0, 120),
    };
    saveCapability(profile, model, result);
    return result;
  }
}

export { PROBE_TOOL_NAME, STORAGE_KEY as CODEX_TOOL_CAPABILITY_STORAGE_KEY };
