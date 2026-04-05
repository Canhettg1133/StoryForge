import { afterEach, describe, expect, it, vi } from 'vitest';
import { ANALYSIS_PROVIDERS } from '../../services/analysis/analysisConfig.js';
import SessionClient from '../../services/analysis/sessionClient.js';

function createJsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json',
    },
  });
}

describe('Phase 6B - SessionClient API key rotation', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rotates to next key when Gemini proxy returns 502', async () => {
    const fetchMock = vi.fn(async (url, options = {}) => {
      const requestUrl = String(url || '');

      // Ignore debug telemetry calls inside resolveProxyUrl.
      if (requestUrl.includes('/ingest/')) {
        return createJsonResponse({ ok: true }, 200);
      }

      const token = String(options?.headers?.Authorization || '').replace('Bearer ', '').trim();
      if (token === 'bad-key') {
        return createJsonResponse({ error: { message: 'Bad upstream' } }, 502);
      }

      return createJsonResponse({
        choices: [{ message: { content: '{"ok":true}' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }, 200);
    });

    vi.stubGlobal('fetch', fetchMock);

    const client = new SessionClient({
      provider: ANALYSIS_PROVIDERS.GEMINI_PROXY,
      model: 'gemini-2.5-flash',
      apiKeys: ['bad-key', 'good-key'],
      proxyUrl: 'http://proxy.local',
    });

    const result = await client.startSession('hello', 'system');

    expect(result.text).toContain('"ok":true');

    const authHeaders = fetchMock.mock.calls
      .map((call) => call?.[1]?.headers?.Authorization)
      .filter(Boolean);

    expect(authHeaders).toContain('Bearer bad-key');
    expect(authHeaders).toContain('Bearer good-key');
  });
});
