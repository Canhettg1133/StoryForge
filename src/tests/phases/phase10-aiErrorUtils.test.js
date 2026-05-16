import { describe, expect, it } from 'vitest';

import { AI_ERROR_CODES, normalizeAIError, shouldFallbackForError } from '../../services/ai/errorUtils.js';

describe('AI error normalization', () => {
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
});
