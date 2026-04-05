import { parseAIJsonValue } from '../../../utils/aiJson.js';
import { coherencePass } from '../pipeline/coherencePass.js';
import { buildCoherencePrompt } from '../prompts/coherencePrompt.js';
import SessionClient from '../sessionClient.js';

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function toObject(value) {
  return value && typeof value === 'object' ? value : {};
}

function hasAnyApiKey(options = {}) {
  const keys = [
    ...(Array.isArray(options.apiKeys) ? options.apiKeys : []),
    options.apiKey,
    process.env.STORYFORGE_GEMINI_PROXY_KEY,
    process.env.STORYFORGE_GEMINI_PROXY_KEYS,
    process.env.STORYFORGE_PROXY_API_KEY,
    process.env.STORYFORGE_GEMINI_DIRECT_API_KEY,
    process.env.STORYFORGE_GEMINI_DIRECT_API_KEYS,
    process.env.GEMINI_API_KEY,
  ];

  return keys.some((item) => String(item || '').trim().length > 0);
}

async function callCoherenceAi({
  incidents = [],
  events = [],
  locations = [],
  options = {},
  signal,
}) {
  if (!options?.ai?.enabled) return null;
  if (!String(options.model || '').trim()) return null;
  if (!hasAnyApiKey(options)) return null;

  const prompt = buildCoherencePrompt({
    incidentCount: incidents.length,
    eventCount: events.length,
    locationCount: locations.length,
    summary: 'Suggest merge/split/normalize actions.',
  });

  const client = new SessionClient({
    provider: options.provider,
    model: options.model,
    apiKey: options.apiKey,
    apiKeys: options.apiKeys,
    proxyUrl: options.proxyUrl,
    directUrl: options.directUrl,
    temperature: Number.isFinite(Number(options.temperature)) ? Number(options.temperature) : 0.2,
    maxOutputTokens: 8000,
  });

  try {
    const response = await client.startSession(
      JSON.stringify({ incidents, events, locations }),
      prompt,
      { signal },
    );

    return parseAIJsonValue(response?.text || '');
  } finally {
    client.endSession();
  }
}

export async function runCoherenceJob({
  incidents = [],
  events = [],
  locations = [],
  options = {},
  signal,
} = {}) {
  const normalizedIncidents = toArray(incidents);
  const normalizedEvents = toArray(events);
  const normalizedLocations = toArray(locations);

  const result = coherencePass(
    normalizedIncidents,
    normalizedEvents,
    normalizedLocations,
    options,
  );

  const aiAdvice = await callCoherenceAi({
    incidents: result.incidents,
    events: result.events,
    locations: result.locations,
    options: toObject(options),
    signal,
  }).catch(() => null);

  return {
    ...result,
    aiAdvice,
  };
}
