import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  fetchGeminiDirectModels,
  GeminiDirectModelsError,
  normalizeGeminiDirectModelId,
} from '../../services/ai/geminiDirectModels.js';

function jsonResponse(body, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    json: vi.fn().mockResolvedValue(body),
  };
}

describe('phase10 Gemini Direct ListModels', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('paginates with an API-key header, filters writing models, and deduplicates ids', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        models: [
          {
            name: 'models/gemini-2.5-flash',
            displayName: 'Gemini 2.5 Flash',
            supportedGenerationMethods: ['generateContent'],
          },
          {
            name: 'models/text-embedding-004',
            supportedGenerationMethods: ['embedContent'],
          },
          {
            name: 'models/imagen-4.0-generate-001',
            supportedGenerationMethods: ['generateContent'],
          },
          {
            name: 'models/gemini-2.0-flash-preview-image-generation',
            supportedGenerationMethods: ['generateContent'],
          },
        ],
        nextPageToken: 'page two/+',
      }))
      .mockResolvedValueOnce(jsonResponse({
        models: [
          {
            name: 'gemini-2.5-flash',
            supportedGenerationMethods: ['generateContent'],
          },
          {
            name: 'models/gemma-3-27b-it',
            displayName: 'Gemma 3 27B',
            supportedGenerationMethods: ['GENERATECONTENT'],
          },
          {
            name: 'models/gemini-live-2.5-flash-preview',
            supportedGenerationMethods: ['generateContent'],
          },
          {
            name: 'models/gemini-2.5-flash-preview-tts',
            supportedGenerationMethods: ['generateContent'],
          },
        ],
      }));

    const models = await fetchGeminiDirectModels({
      apiKey: 'top-secret-key',
      fetchImpl,
    });

    expect(models).toEqual([
      {
        id: 'gemini-2.5-flash',
        label: 'Gemini 2.5 Flash',
        source: 'fetched',
      },
      {
        id: 'gemma-3-27b-it',
        label: 'Gemma 3 27B',
        source: 'fetched',
      },
    ]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[0][0]).toBe('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000');
    expect(fetchImpl.mock.calls[1][0]).toBe('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000&pageToken=page+two%2F%2B');

    for (const [url, options] of fetchImpl.mock.calls) {
      expect(url).not.toContain('top-secret-key');
      expect(url).not.toContain('key=');
      expect(options.headers).toEqual({ 'x-goog-api-key': 'top-secret-key' });
    }
  });

  it('normalizes a model id without accepting unrelated model families', () => {
    expect(normalizeGeminiDirectModelId(' models/gemini-2.5-flash ')).toBe('gemini-2.5-flash');
    expect(normalizeGeminiDirectModelId('gemma-3-27b-it')).toBe('gemma-3-27b-it');
    expect(normalizeGeminiDirectModelId('GEMINI-2.5-PRO')).toBe('gemini-2.5-pro');
    expect(normalizeGeminiDirectModelId('claude-3')).toBe('');
    expect(normalizeGeminiDirectModelId('gemini-embedding-001')).toBe('');
    expect(normalizeGeminiDirectModelId('gemini-2.5-flash?key=unsafe')).toBe('');
    expect(normalizeGeminiDirectModelId('gemini-2.5 flash')).toBe('');
  });

  it('normalizes a configured Gemini base URL and strips existing query credentials', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({
      models: [{
        name: 'models/gemini-2.5-flash',
        supportedGenerationMethods: ['generateContent'],
      }],
    }));

    await fetchGeminiDirectModels({
      apiKey: 'header-only-key',
      baseUrl: 'https://generativelanguage.googleapis.com/?key=must-be-removed',
      fetchImpl,
    });

    expect(fetchImpl.mock.calls[0][0])
      .toBe('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000');
  });

  it.each([
    ['', 'MISSING_KEY'],
    ['   ', 'MISSING_KEY'],
  ])('rejects a missing key before making a request', async (apiKey, code) => {
    const fetchImpl = vi.fn();

    await expect(fetchGeminiDirectModels({ apiKey, fetchImpl }))
      .rejects.toMatchObject({ code });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    [401, 'UNAUTHORIZED'],
    [403, 'UNAUTHORIZED'],
    [429, 'RATE_LIMITED'],
    [500, 'HTTP_ERROR'],
  ])('maps HTTP %s to a stable error without exposing the key', async (status, code) => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}, { ok: false, status }));

    let caught;
    try {
      await fetchGeminiDirectModels({ apiKey: 'never-print-this', fetchImpl });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(GeminiDirectModelsError);
    expect(caught).toMatchObject({ code, status });
    expect(caught.message).not.toContain('never-print-this');
  });

  it('distinguishes network failures, invalid JSON and an empty compatible catalog', async () => {
    const networkFetch = vi.fn().mockRejectedValue(new TypeError('offline'));
    await expect(fetchGeminiDirectModels({ apiKey: 'secret', fetchImpl: networkFetch }))
      .rejects.toMatchObject({ code: 'NETWORK' });

    const invalidJsonFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockRejectedValue(new SyntaxError('broken json')),
    });
    await expect(fetchGeminiDirectModels({ apiKey: 'secret', fetchImpl: invalidJsonFetch }))
      .rejects.toMatchObject({ code: 'INVALID_RESPONSE' });

    const emptyFetch = vi.fn().mockResolvedValue(jsonResponse({
      models: [{
        name: 'models/text-embedding-004',
        supportedGenerationMethods: ['embedContent'],
      }],
    }));
    await expect(fetchGeminiDirectModels({ apiKey: 'secret', fetchImpl: emptyFetch }))
      .rejects.toMatchObject({ code: 'NO_MODELS' });
  });

  it('aborts a stalled request after the configured timeout', async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn((_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    }));

    const pending = expect(fetchGeminiDirectModels({
      apiKey: 'secret',
      fetchImpl,
      timeoutMs: 25,
    })).rejects.toMatchObject({ code: 'TIMEOUT' });
    await vi.advanceTimersByTimeAsync(25);

    await pending;
  });
});
