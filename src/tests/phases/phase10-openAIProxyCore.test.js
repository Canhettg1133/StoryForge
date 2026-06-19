import { describe, expect, it } from 'vitest';

import {
  AG_PROXY_PROFILE_ID,
  buildOpenAIProxyEndpoint,
  classifyProxyModel,
  CUSTOM_PROXY_PROFILE_ID,
  filterGeminiModelIds,
  groupProxyModelsForDisplay,
  isMixedContentBlockedProxyUrl,
  isRelayAllowedTarget,
  parseOpenAIModelIds,
  resolveProxyTransportMode,
  upgradeMixedContentProxyUrl,
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

  it('classifies proxy models by channel and family independently', () => {
    expect(classifyProxyModel(
      'gemini-3-flash-high-真流-[星星公益站-CLI渠道]',
      { profileId: AG_PROXY_PROFILE_ID },
    )).toMatchObject({
      channel: 'Google CLI',
      family: 'Gemini',
      confidence: 'high',
    });
    expect(classifyProxyModel('agy-gemini-3.1-flash-lite', { profileId: CUSTOM_PROXY_PROFILE_ID }))
      .toMatchObject({ channel: 'Antigravity', family: 'Gemini', confidence: 'high' });
    expect(classifyProxyModel('gemini-3-flash-preview-[星星公益站-反重力渠道]', { profileId: AG_PROXY_PROFILE_ID }))
      .toMatchObject({ channel: 'Antigravity', family: 'Gemini', confidence: 'high' });
    expect(classifyProxyModel('claude-sonnet-4-6-[星星公益站-反重力渠道]', { profileId: AG_PROXY_PROFILE_ID }))
      .toMatchObject({ channel: 'Antigravity', family: 'Claude', confidence: 'high' });

    expect(classifyProxyModel('anthropic/claude-3-5-sonnet', { profileId: AG_PROXY_PROFILE_ID }))
      .toMatchObject({ channel: 'AG Proxy', family: 'Claude', confidence: 'high' });
    expect(classifyProxyModel('claude-sonnet-4', { profileId: CUSTOM_PROXY_PROFILE_ID }))
      .toMatchObject({ channel: 'Custom Proxy', family: 'Claude', confidence: 'high' });
    expect(classifyProxyModel('openai/gpt-4.1', { profileId: CUSTOM_PROXY_PROFILE_ID }))
      .toMatchObject({ family: 'OpenAI', confidence: 'high' });
    expect(classifyProxyModel('o4-mini', { profileId: CUSTOM_PROXY_PROFILE_ID }))
      .toMatchObject({ family: 'OpenAI', confidence: 'high' });
    expect(classifyProxyModel('minimax/abab6.5s-chat', { profileId: CUSTOM_PROXY_PROFILE_ID }))
      .toMatchObject({ family: 'Mimo/MiniMax', confidence: 'high' });
    expect(classifyProxyModel('mimo/chat-latest', { profileId: CUSTOM_PROXY_PROFILE_ID }))
      .toMatchObject({ family: 'Mimo/MiniMax', confidence: 'high' });
    expect(classifyProxyModel('jj/chat-v1', { profileId: CUSTOM_PROXY_PROFILE_ID }))
      .toMatchObject({ family: 'JJ', confidence: 'high' });
    expect(classifyProxyModel('banjj-helper', { profileId: CUSTOM_PROXY_PROFILE_ID }))
      .toMatchObject({ family: 'Khác', confidence: 'unknown' });
  });

  it('keeps ambiguous aliases as best guesses with low confidence', () => {
    expect(classifyProxyModel('sonnet-latest', { profileId: AG_PROXY_PROFILE_ID }))
      .toMatchObject({ channel: 'AG Proxy', family: 'Claude', confidence: 'low' });
    expect(classifyProxyModel('flash-high', { profileId: AG_PROXY_PROFILE_ID }))
      .toMatchObject({ channel: 'AG Proxy', family: 'Gemini', confidence: 'low' });
  });

  it('groups proxy models by channel and sorts each group by family', () => {
    const groups = groupProxyModelsForDisplay([
      'anthropic/claude-3-5-sonnet',
      'gemini-3-flash-high-真流-[星星公益站-CLI渠道]',
      'openai/gpt-4.1',
      'gcli-gemini-3.1-pro-preview-live',
    ], { profileId: AG_PROXY_PROFILE_ID });

    expect(groups.map((group) => group.channel)).toEqual(['Google CLI', 'AG Proxy']);
    expect(groups[0].models.map((model) => model.id)).toEqual([
      'gcli-gemini-3.1-pro-preview-live',
      'gemini-3-flash-high-真流-[星星公益站-CLI渠道]',
    ]);
    expect(groups[1].families.map((family) => family.family)).toEqual(['Claude', 'OpenAI']);
  });

  it('uses relay for hosted HTTPS targets and direct mode for local targets', () => {
    expect(resolveProxyTransportMode({ baseUrl: 'https://proxy.example.com', transport: 'auto' })).toBe('relay');
    expect(resolveProxyTransportMode({ baseUrl: 'https://proxy.example.com', transport: 'direct' })).toBe('direct');
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

  it('detects public HTTP proxy targets that HTTPS pages would block as mixed content', () => {
    expect(isMixedContentBlockedProxyUrl('http://proxy.example.com/v1', 'https:')).toBe(true);
    expect(isMixedContentBlockedProxyUrl('http://localhost:1234/v1', 'https:')).toBe(false);
    expect(isMixedContentBlockedProxyUrl('http://127.0.0.1:1234/v1', 'https:')).toBe(false);
    expect(isMixedContentBlockedProxyUrl('http://proxy.example.com/v1', 'http:')).toBe(false);
    expect(isMixedContentBlockedProxyUrl('https://proxy.example.com/v1', 'https:')).toBe(false);
    expect(isMixedContentBlockedProxyUrl('/api/proxy', 'https:')).toBe(false);
  });

  it('upgrades public HTTP proxy targets to HTTPS on HTTPS pages', () => {
    expect(upgradeMixedContentProxyUrl('http://proxy.example.com/v1', 'https:')).toBe('https://proxy.example.com/v1');
    expect(upgradeMixedContentProxyUrl('http://localhost:1234/v1', 'https:')).toBe('http://localhost:1234/v1');
    expect(upgradeMixedContentProxyUrl('http://proxy.example.com/v1', 'http:')).toBe('http://proxy.example.com/v1');
    expect(upgradeMixedContentProxyUrl('https://proxy.example.com/v1', 'https:')).toBe('https://proxy.example.com/v1');
    expect(upgradeMixedContentProxyUrl('/api/proxy', 'https:')).toBe('/api/proxy');
  });
});
