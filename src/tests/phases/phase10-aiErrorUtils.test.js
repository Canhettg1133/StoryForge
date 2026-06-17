import { describe, expect, it } from 'vitest';

import { AI_ERROR_CODES, normalizeAIError, shouldFallbackForError } from '../../services/ai/errorUtils.js';
import {
  AG_PROXY_PROFILE_ID,
  CUSTOM_PROXY_PROFILE_ID,
} from '../../services/ai/openAIProxyCore.js';

describe('AI error normalization', () => {
  it('labels missing keys for the ag proxy profile as Gemini Proxy', () => {
    const error = normalizeAIError({
      code: AI_ERROR_CODES.MISSING_API_KEY,
      rawMessage: 'MISSING_API_KEY',
    }, {
      provider: 'openai_proxy',
      proxyProfileId: AG_PROXY_PROFILE_ID,
      model: 'gemini-3.1-pro-high-[星星公益站-反重力渠道]',
    });

    expect(error.code).toBe(AI_ERROR_CODES.MISSING_API_KEY);
    expect(error.message).toContain('Gemini Proxy');
    expect(error.message).not.toContain('OpenAI-compatible Proxy');
  });

  it('keeps missing key messages distinct for custom OpenAI-compatible proxy profiles', () => {
    const error = normalizeAIError({
      code: AI_ERROR_CODES.MISSING_API_KEY,
      rawMessage: 'MISSING_API_KEY',
    }, {
      provider: 'openai_proxy',
      proxyProfileId: CUSTOM_PROXY_PROFILE_ID,
      model: 'custom-model',
    });

    expect(error.code).toBe(AI_ERROR_CODES.MISSING_API_KEY);
    expect(error.message).toContain('Custom OpenAI-compatible Proxy');
  });

  it('normalizes Antigravity quota_exceeded JSON bodies without surfacing raw JSON', () => {
    const rawMessage = 'Antigravity gemini3 daily limit reached (0/0 Requests)';
    const error = normalizeAIError({
      status: 400,
      bodyText: JSON.stringify({
        error: {
          message: rawMessage,
          type: 'quota_exceeded',
        },
      }),
    }, {
      provider: 'openai_proxy',
      model: 'gemini-3-flash-high-真流-[星星公益站-CLI渠道]',
    });

    expect(error.code).toBe(AI_ERROR_CODES.QUOTA_EXCEEDED);
    expect(error.message).toContain('Gemini Proxy');
    expect(error.message).toContain('hết quota ngày');
    expect(error.message).toContain('Gemini 3');
    expect(error.message).not.toContain('{"error"');
    expect(error.rawMessage).toBe(rawMessage);
    expect(shouldFallbackForError(error)).toBe(true);
  });

  it('normalizes streamed quota_exceeded payload errors', () => {
    const rawMessage = 'Antigravity gemini3 daily limit reached (0/0 Requests)';
    const error = normalizeAIError({
      code: 'quota_exceeded',
      rawMessage,
      error: {
        message: rawMessage,
        type: 'quota_exceeded',
      },
    }, {
      provider: 'openai_proxy',
      model: 'gemini-3-flash-high-真流-[星星公益站-CLI渠道]',
    });

    expect(error.code).toBe(AI_ERROR_CODES.QUOTA_EXCEEDED);
    expect(error.message).toContain('hết quota ngày');
    expect(error.rawMessage).toBe(rawMessage);
  });

  it('normalizes mixed-content proxy URL errors with a specific fix hint', () => {
    const error = normalizeAIError({
      rawMessage: 'OPENAI_PROXY_MIXED_CONTENT_BLOCKED: Proxy URL uses public HTTP on an HTTPS page.',
    }, {
      provider: 'openai_proxy',
      proxyProfileId: CUSTOM_PROXY_PROFILE_ID,
      model: 'custom-model',
    });

    expect(error.code).toBe(AI_ERROR_CODES.NETWORK_ERROR);
    expect(error.message).toContain('Proxy URL');
    expect(error.message).toContain('HTTPS');
    expect(error.message).toContain('Mixed Content');
  });
});
