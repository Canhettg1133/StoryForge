import { describe, expect, it } from 'vitest';

import {
  buildOpenAIProxyEndpoint,
  filterGeminiModelIds,
  isRelayAllowedTarget,
  parseOpenAIModelIds,
  resolveProxyTransportMode,
} from '../../services/ai/openAIProxyCore.js';

describe('openAIProxyCore URL handling', () => {
  it('normalizes root, v1, and full chat completion URLs', () => {
    expect(buildOpenAIProxyEndpoint('https://proxy.example.com', '/v1/chat/completions')).toBe(
      'https://proxy.example.com/v1/chat/completions',
    );
    expect(buildOpenAIProxyEndpoint('https://proxy.example.com/v1', '/v1/chat/completions')).toBe(
      'https://proxy.example.com/v1/chat/completions',
    );
    expect(buildOpenAIProxyEndpoint('https://proxy.example.com/v1/chat/completions', '/v1/chat/completions')).toBe(
      'https://proxy.example.com/v1/chat/completions',
    );
    expect(buildOpenAIProxyEndpoint('https://proxy.example.com/', '/v1/models')).toBe(
      'https://proxy.example.com/v1/models',
    );
    expect(buildOpenAIProxyEndpoint('/api/proxy/v1/chat/completions', '/v1/models')).toBe(
      '/api/proxy/v1/models',
    );
  });

  it('rejects invalid endpoints early', () => {
    expect(() => buildOpenAIProxyEndpoint('', '/v1/models')).toThrow(/Proxy URL/);
    expect(() => buildOpenAIProxyEndpoint('not a url', '/v1/models')).toThrow(/Proxy URL/);
  });
});

describe('openAIProxyCore model parsing and transport policy', () => {
  it('parses OpenAI-compatible model payloads', () => {
    expect(parseOpenAIModelIds({ data: [{ id: 'model-a' }, { id: 'model-b' }, {}] })).toEqual([
      'model-a',
      'model-b',
    ]);
  });

  it('filters fetched proxy models down to Gemini-related ids', () => {
    expect(filterGeminiModelIds([
      'openai/gpt-4.1',
      'gemini-2.5-flash',
      'google/gemini-2.5-pro',
      'qwen/qwen3',
      'models/gemini-embedding',
      'gemini-2.5-flash',
    ])).toEqual([
      'gemini-2.5-flash',
      'google/gemini-2.5-pro',
      'models/gemini-embedding',
    ]);
  });

  it('uses relay for hosted HTTPS targets and direct mode for local targets', () => {
    expect(resolveProxyTransportMode({ baseUrl: 'https://proxy.example.com', transport: 'auto' })).toBe('relay');
    expect(resolveProxyTransportMode({ baseUrl: 'http://localhost:1234/v1', transport: 'auto' })).toBe('direct');
    expect(resolveProxyTransportMode({ baseUrl: 'http://127.0.0.1:1234/v1', transport: 'auto' })).toBe('direct');
    expect(resolveProxyTransportMode({ baseUrl: '/api/proxy', transport: 'vercelRewrite' })).toBe('direct');
  });

  it('allows only public HTTPS targets through the Vercel relay', () => {
    expect(isRelayAllowedTarget('https://proxy.example.com')).toBe(true);
    expect(isRelayAllowedTarget('http://proxy.example.com')).toBe(false);
    expect(isRelayAllowedTarget('https://localhost:1234')).toBe(false);
    expect(isRelayAllowedTarget('https://localhost.:1234')).toBe(false);
    expect(isRelayAllowedTarget('https://127.0.0.1:1234')).toBe(false);
    expect(isRelayAllowedTarget('https://0.0.0.0:1234')).toBe(false);
    expect(isRelayAllowedTarget('https://10.0.0.4')).toBe(false);
    expect(isRelayAllowedTarget('https://100.64.0.4')).toBe(false);
    expect(isRelayAllowedTarget('https://224.0.0.1')).toBe(false);
    expect(isRelayAllowedTarget('/api/proxy')).toBe(false);
  });
});
